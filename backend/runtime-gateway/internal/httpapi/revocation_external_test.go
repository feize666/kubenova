package httpapi

import (
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

// Invoked by control-api/test/runtime-watch-postgres.cjs against its isolated database.
func TestPostgresRevocationExternal(t *testing.T) {
	token := os.Getenv("KUBENOVA_TEST_RUNTIME_TOKEN")
	if token == "" {
		t.Skip("requires isolated control-api PostgreSQL fixture")
	}
	gateway := httptest.NewServer(http.HandlerFunc(LogsWS))
	defer gateway.Close()
	query := url.Values{"runtimeToken": {token}, "sessionId": {"fixture"}, "clusterId": {"fixture-cluster"}, "namespace": {"ai"}, "pod": {"fixture-pod"}, "container": {"app"}}
	conn, _, err := websocket.DefaultDialer.Dial("ws"+strings.TrimPrefix(gateway.URL, "http")+"/ws/logs?"+query.Encode(), nil)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	conn.SetReadDeadline(time.Now().Add(5 * time.Second))
	for {
		_, _, err = conn.ReadMessage()
		if err != nil {
			break
		}
	}
	if timeout, ok := err.(interface{ Timeout() bool }); ok && timeout.Timeout() {
		t.Fatal("database revocation did not close actual gateway WebSocket")
	}
}
