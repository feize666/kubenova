package httpapi

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestRuntimeWatchRevocation(t *testing.T) {
	revoke := make(chan struct{})
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != "POST" || r.Header.Get("X-Runtime-Gateway-Secret") != "fixture" {
			t.Error("missing internal auth")
		}
		fmt.Fprintln(w, `{"active":true}`)
		w.(http.Flusher).Flush()
		select {
		case <-revoke:
		case <-r.Context().Done():
		}
	}))
	defer server.Close()
	t.Setenv("RUNTIME_PUSH_REVOCATION_ENABLED", "true")
	t.Setenv("CONTROL_API_BASE_URL", server.URL)
	t.Setenv("RUNTIME_GATEWAY_INTERNAL_SECRET", "fixture")
	invalid := make(chan struct{}, 1)
	closeWatch, err := subscribeRuntimeSession(context.Background(), runtimeTokenPayload{SessionID: "fixture", Path: "/ws/logs"}, "fixture", func() { invalid <- struct{}{} })
	if err != nil {
		t.Fatal(err)
	}
	defer closeWatch()
	close(revoke)
	select {
	case <-invalid:
	case <-time.After(time.Second):
		t.Fatal("revoke did not cancel")
	}
}

func TestRuntimeWatchRejectsInvalidReady(t *testing.T) {
	for _, body := range []string{`{"active":false}`, `{}`, `not-json`} {
		server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { fmt.Fprintln(w, body) }))
		t.Setenv("RUNTIME_PUSH_REVOCATION_ENABLED", "true")
		t.Setenv("CONTROL_API_BASE_URL", server.URL)
		_, err := subscribeRuntimeSession(context.Background(), runtimeTokenPayload{SessionID: "fixture"}, "fixture", func() {})
		server.Close()
		if err == nil {
			t.Fatal("invalid stream accepted")
		}
	}
}
