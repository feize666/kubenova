package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

func TestBootstrapTransportErrorDoesNotExposeToken(t *testing.T) {
	control := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {}))
	control.Close()
	t.Setenv("CONTROL_API_BASE_URL", control.URL)
	_, err := fetchRuntimeBootstrap(context.Background(), runtimeTokenPayload{SessionID: "s", Path: "/ws/logs"}, "private-runtime-token")
	if err == nil {
		t.Fatal("unreachable control API accepted")
	}
	if strings.Contains(err.Error(), "private-runtime-token") {
		t.Fatal("transport error exposed runtime token")
	}
}

func TestIdleLogStreamRevocationClosesWebsocketAndUpstream(t *testing.T) {
	for _, failure := range []string{"revoked", "unavailable", "push"} {
		t.Run(failure, func(t *testing.T) {
			var invalidate atomic.Bool
			revoke := make(chan struct{})
			started, stopped := make(chan struct{}), make(chan struct{})
			kube := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if r.URL.Path != "/api/v1/namespaces/ai/pods/p/log" {
					http.NotFound(w, r)
					return
				}
				w.Header().Set("Content-Type", "text/plain")
				w.WriteHeader(http.StatusOK)
				w.(http.Flusher).Flush()
				close(started)
				<-r.Context().Done()
				close(stopped)
			}))
			defer kube.Close()
			config := fmt.Sprintf("apiVersion: v1\nkind: Config\nclusters:\n- name: test\n  cluster:\n    server: %s\ncontexts:\n- name: test\n  context:\n    cluster: test\n    user: test\ncurrent-context: test\nusers:\n- name: test\n  user: {}\n", kube.URL)
			control := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				if strings.HasSuffix(r.URL.Path, "/watch") {
					w.Header().Set("Content-Type", "application/x-ndjson")
					fmt.Fprintln(w, `{"active":true}`)
					w.(http.Flusher).Flush()
					select {
					case <-revoke:
					case <-r.Context().Done():
					}
					return
				}
				if strings.HasSuffix(r.URL.Path, "/status") {
					if invalidate.Load() && failure == "unavailable" {
						http.Error(w, "unavailable", http.StatusServiceUnavailable)
						return
					}
					json.NewEncoder(w).Encode(map[string]any{"data": map[string]bool{"active": failure == "push" || !invalidate.Load()}})
					return
				}
				json.NewEncoder(w).Encode(internalBootstrapEnvelope{Data: internalBootstrapResponse{SessionID: "s", ClusterID: "c", Namespace: "ai", Pod: "p", Container: "app", Type: "logs", Path: "/ws/logs", Kubeconfig: config}})
			}))
			defer control.Close()
			t.Setenv("CONTROL_API_BASE_URL", control.URL)
			t.Setenv("RUNTIME_PUSH_REVOCATION_ENABLED", fmt.Sprint(failure == "push"))
			t.Setenv("RUNTIME_TOKEN_SECRET", defaultRuntimeTokenSecret)
			gateway := httptest.NewServer(http.HandlerFunc(LogsWS))
			defer gateway.Close()
			payload := runtimeTokenPayload{SessionID: "s", UserID: "u", Type: "logs", ClusterID: "c", Namespace: "ai", Pod: "p", Container: "app", Path: "/ws/logs", Exp: time.Now().Add(time.Minute).Unix()}
			query := url.Values(runtimeTokenQueryForTest(payload))
			query.Set("runtimeToken", signRuntimeTokenForTest(t, payload))
			conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(gateway.URL, "http")+"/ws/logs?"+query.Encode(), nil)
			if err != nil {
				t.Fatal(err)
			}
			defer conn.Close()
			select {
			case <-started:
			case <-time.After(3 * time.Second):
				t.Fatal("Kubernetes log stream did not start")
			}
			invalidate.Store(true)
			deadline := 8 * time.Second
			if failure == "push" {
				close(revoke)
				deadline = 2 * time.Second
			}
			conn.SetReadDeadline(time.Now().Add(deadline))
			for {
				_, _, err = conn.ReadMessage()
				if err != nil {
					break
				}
			}
			if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
				t.Fatal("revocation did not close websocket")
			}
			select {
			case <-stopped:
			case <-time.After(time.Second):
				t.Fatal("revocation left idle Kubernetes log request active")
			}
		})
	}
}
