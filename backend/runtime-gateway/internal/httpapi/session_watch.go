package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"net/http"
	"net/url"
	"os"
	"time"
)

// Establish authorization before opening the upstream stream. EOF fails closed.
func subscribeRuntimeSession(ctx context.Context, payload runtimeTokenPayload, token string, onInvalid func()) (func(), error) {
	if os.Getenv("RUNTIME_PUSH_REVOCATION_ENABLED") != "true" {
		return func() {}, nil
	}
	watchCtx, cancel := context.WithCancel(ctx)
	body, _ := json.Marshal(map[string]string{"runtimeToken": token, "path": payload.Path})
	req, err := http.NewRequestWithContext(watchCtx, http.MethodPost, getControlAPIBaseURL()+"/api/runtime/internal/sessions/"+url.PathEscape(payload.SessionID)+"/watch", bytes.NewReader(body))
	if err != nil {
		cancel()
		return nil, errors.New("invalid runtime watch request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runtime-Gateway-Secret", getRuntimeGatewayInternalSecret())
	client := &http.Client{CheckRedirect: func(_ *http.Request, _ []*http.Request) error { return http.ErrUseLastResponse }}
	deadline := time.AfterFunc(5*time.Second, cancel)
	response, err := client.Do(req)
	if err != nil {
		deadline.Stop()
		cancel()
		return nil, errors.New("runtime watch unavailable")
	}
	closeWatch := func() { cancel(); response.Body.Close() }
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 1024), 4096)
	active := func() bool {
		if !scanner.Scan() {
			return false
		}
		var frame struct {
			Active bool `json:"active"`
		}
		return json.Unmarshal(scanner.Bytes(), &frame) == nil && frame.Active
	}
	if response.StatusCode != http.StatusOK || !active() || watchCtx.Err() != nil {
		deadline.Stop()
		closeWatch()
		return nil, errors.New("runtime watch rejected")
	}
	deadline.Stop()
	go func() {
		defer closeWatch()
		// Missing heartbeats indicate a broken control channel, not continuing permission.
		timeout := time.AfterFunc(20*time.Second, closeWatch)
		defer timeout.Stop()
		for active() {
			timeout.Reset(20 * time.Second)
		}
		if ctx.Err() == nil {
			onInvalid()
		}
	}()
	return closeWatch, nil
}
