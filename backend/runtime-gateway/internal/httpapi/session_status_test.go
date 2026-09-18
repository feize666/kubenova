package httpapi

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func TestCheckRuntimeSession(t *testing.T) {
	for _, tc := range []struct {
		name   string
		status int
		body   string
		valid  bool
	}{
		{"active", 200, `{"data":{"active":true}}`, true},
		{"inactive", 200, `{"data":{"active":false}}`, false},
		{"missing", 200, `{}`, false},
		{"flat", 200, `{"active":true}`, false},
		{"null", 200, `{"data":null}`, false},
		{"wrong-type", 200, `{"data":{"active":"true"}}`, false},
		{"invalid-json", 200, `invalid secret-token`, false},
		{"trailing-json", 200, `{"data":{"active":true}}{}`, false},
		{"unauthorized", 401, `secret-token`, false},
		{"server-error", 500, `{"data":{"active":true}}`, false},
		{"too-large", 200, `{"data":{"active":true},"padding":"` + strings.Repeat("x", 16384) + `"}`, false},
	} {
		t.Run(tc.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.Method != http.MethodPost || r.URL.EscapedPath() != "/api/runtime/internal/sessions/session%2Fid/status" || r.URL.RawQuery != "" {
					t.Errorf("unexpected request: %s %s", r.Method, r.URL)
				}
				if r.Header.Get("X-Runtime-Gateway-Secret") != "internal-secret" || r.Header.Get("Content-Type") != "application/json" {
					t.Error("missing authentication or content-type header")
				}
				var body map[string]string
				if err := json.NewDecoder(r.Body).Decode(&body); err != nil || len(body) != 2 || body["runtimeToken"] != "secret-token" || body["path"] != "/runtime/logs" {
					t.Errorf("unexpected request body: %#v, %v", body, err)
				}
				w.WriteHeader(tc.status)
				io.WriteString(w, tc.body)
			}))
			defer server.Close()
			t.Setenv("CONTROL_API_BASE_URL", server.URL)
			t.Setenv("RUNTIME_GATEWAY_INTERNAL_SECRET", "internal-secret")
			err := checkRuntimeSession(context.Background(), runtimeTokenPayload{SessionID: "session/id", Path: "/runtime/logs"}, "secret-token")
			if (err == nil) != tc.valid {
				t.Fatalf("valid=%v, err=%v", tc.valid, err)
			}
			if err != nil && strings.Contains(err.Error(), "secret-token") {
				t.Fatal("error leaked token")
			}
		})
	}
}

func TestCheckRuntimeSessionRejectsRedirect(t *testing.T) {
	var redirected atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		redirected.Add(1)
		io.WriteString(w, `{"data":{"active":true}}`)
	}))
	defer target.Close()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Redirect(w, r, target.URL, http.StatusTemporaryRedirect)
	}))
	defer server.Close()
	t.Setenv("CONTROL_API_BASE_URL", server.URL)
	if err := checkRuntimeSession(context.Background(), runtimeTokenPayload{SessionID: "session"}, "secret-token"); err == nil || redirected.Load() != 0 {
		t.Fatalf("redirect accepted: err=%v requests=%d", err, redirected.Load())
	}
}

func TestWatchRuntimeSessionCancellationAndInvalidation(t *testing.T) {
	for _, active := range []bool{true, false} {
		t.Run(map[bool]string{true: "cancel", false: "invalidate"}[active], func(t *testing.T) {
			called := make(chan struct{}, 1)
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				json.NewEncoder(w).Encode(map[string]any{"data": map[string]bool{"active": active}})
				called <- struct{}{}
			}))
			defer server.Close()
			t.Setenv("CONTROL_API_BASE_URL", server.URL)
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			var invalid atomic.Int32
			done := make(chan struct{})
			go func() {
				watchRuntimeSession(ctx, runtimeTokenPayload{SessionID: "session"}, "token", func() { invalid.Add(1) })
				close(done)
			}()
			select {
			case <-called:
			case <-time.After(time.Second):
				t.Fatal("initial check was not immediate")
			}
			if active {
				cancel()
			}
			select {
			case <-done:
			case <-time.After(time.Second):
				t.Fatal("watcher did not exit")
			}
			want := int32(1)
			if active {
				want = 0
			}
			if invalid.Load() != want {
				t.Fatalf("invalid callbacks=%d, want %d", invalid.Load(), want)
			}
		})
	}
}

func TestCheckRuntimeSessionHonorsContext(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer server.Close()
	defer close(release)
	t.Setenv("CONTROL_API_BASE_URL", server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Millisecond)
	defer cancel()
	start := time.Now()
	if err := checkRuntimeSession(ctx, runtimeTokenPayload{SessionID: "session"}, "secret-token"); err == nil {
		t.Fatal("canceled request accepted")
	}
	if time.Since(start) > time.Second {
		t.Fatal("request ignored context")
	}
}

func TestCheckRuntimeSessionTimeout(t *testing.T) {
	release := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { <-release }))
	defer server.Close()
	defer close(release)
	t.Setenv("CONTROL_API_BASE_URL", server.URL)
	start := time.Now()
	if err := checkRuntimeSession(context.Background(), runtimeTokenPayload{SessionID: "session"}, "token"); err == nil {
		t.Fatal("stalled request accepted")
	}
	if elapsed := time.Since(start); elapsed < time.Second || elapsed > 3*time.Second {
		t.Fatalf("unexpected timeout: %s", elapsed)
	}
}

func TestWatchRuntimeSessionAlreadyCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	watchRuntimeSession(ctx, runtimeTokenPayload{}, "token", func() { t.Error("cancellation invalidated session") })
}

func TestWatchRuntimeSessionRechecks(t *testing.T) {
	var requests atomic.Int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		json.NewEncoder(w).Encode(map[string]any{"data": map[string]bool{"active": requests.Add(1) == 1}})
	}))
	defer server.Close()
	t.Setenv("CONTROL_API_BASE_URL", server.URL)
	ctx, cancel := context.WithTimeout(context.Background(), 7*time.Second)
	defer cancel()
	var invalid int
	watchRuntimeSession(ctx, runtimeTokenPayload{SessionID: "session"}, "token", func() { invalid++ })
	if requests.Load() != 2 || invalid != 1 {
		t.Fatalf("requests=%d invalid=%d", requests.Load(), invalid)
	}
}
