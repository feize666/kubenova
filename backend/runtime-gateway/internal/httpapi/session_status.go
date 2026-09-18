package httpapi

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/url"
	"time"
)

var runtimeSessionStatusClient = &http.Client{
	Timeout: 2 * time.Second,
	CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	},
}

func checkRuntimeSession(ctx context.Context, payload runtimeTokenPayload, token string) error {
	body, err := json.Marshal(struct {
		RuntimeToken string `json:"runtimeToken"`
		Path         string `json:"path"`
	}{RuntimeToken: token, Path: payload.Path})
	if err != nil {
		return errors.New("failed to encode runtime session status request")
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost,
		getControlAPIBaseURL()+"/api/runtime/internal/sessions/"+url.PathEscape(payload.SessionID)+"/status", bytes.NewReader(body))
	if err != nil {
		return errors.New("failed to create runtime session status request")
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Runtime-Gateway-Secret", getRuntimeGatewayInternalSecret())
	resp, err := runtimeSessionStatusClient.Do(req)
	if err != nil {
		return errors.New("runtime session status request failed")
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return errors.New("runtime session status rejected")
	}
	const maxResponseBytes = 16 << 10
	response, err := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes+1))
	if err != nil || len(response) > maxResponseBytes {
		return errors.New("invalid runtime session status response")
	}
	var envelope struct {
		Data struct {
			Active bool `json:"active"`
		} `json:"data"`
	}
	if err := json.Unmarshal(response, &envelope); err != nil || !envelope.Data.Active {
		return errors.New("runtime session is not active")
	}
	return nil
}

func watchRuntimeSession(ctx context.Context, payload runtimeTokenPayload, token string, onInvalid func()) {
	ticker := time.NewTicker(5 * time.Second)
	defer ticker.Stop()
	for {
		if ctx.Err() != nil {
			return
		}
		if err := checkRuntimeSession(ctx, payload, token); err != nil {
			if ctx.Err() == nil {
				onInvalid()
			}
			return
		}
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
		}
	}
}
