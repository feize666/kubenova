package httpapi

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"testing"
	"time"
)

func TestRuntimeTokenTimeClaimsValidation(t *testing.T) {
	payload := runtimeTokenPayload{
		SessionID: "session-1",
		UserID:    "user-1",
		Type:      "logs",
		ClusterID: "cluster-1",
		Namespace: "default",
		Pod:       "pod-1",
		Container: "app",
		Path:      "/ws/logs",
		Exp:       time.Now().Add(time.Hour).Unix(),
		SinceTime: "not-rfc3339",
	}

	_, code, _ := validateRuntimeToken(signRuntimeTokenForTest(t, payload), "/ws/logs", runtimeTokenQueryForTest(payload))
	if code != "RUNTIME_TOKEN_SINCE_TIME_INVALID" {
		t.Fatalf("expected invalid sinceTime code, got %q", code)
	}

	payload.SinceTime = time.Now().Add(-20 * time.Minute).UTC().Format(time.RFC3339)
	payload.UntilTime = "not-rfc3339"
	_, code, _ = validateRuntimeToken(signRuntimeTokenForTest(t, payload), "/ws/logs", runtimeTokenQueryForTest(payload))
	if code != "RUNTIME_TOKEN_UNTIL_TIME_INVALID" {
		t.Fatalf("expected invalid untilTime code, got %q", code)
	}

	payload.UntilTime = time.Now().Add(-10 * time.Minute).UTC().Format(time.RFC3339)
	payload.RefreshIntervalSeconds = -1
	_, code, _ = validateRuntimeToken(signRuntimeTokenForTest(t, payload), "/ws/logs", runtimeTokenQueryForTest(payload))
	if code != "RUNTIME_TOKEN_REFRESH_INTERVAL_SECONDS_INVALID" {
		t.Fatalf("expected invalid refreshIntervalSeconds code, got %q", code)
	}

	payload.RefreshIntervalSeconds = 5
	_, code, _ = validateRuntimeToken(signRuntimeTokenForTest(t, payload), "/ws/logs", runtimeTokenQueryForTest(payload))
	if code != "" {
		t.Fatalf("expected valid token, got code %q", code)
	}
}

func TestUntilTimeLogLineFiltering(t *testing.T) {
	until := time.Date(2026, 5, 18, 10, 0, 0, 0, time.UTC)

	if isLogLineAfterUntilTime("2026-05-18T10:00:00Z equal allowed", &until) {
		t.Fatal("equal timestamp should pass untilTime filter")
	}
	if !isLogLineAfterUntilTime("2026-05-18T10:00:00.000000001Z after rejected", &until) {
		t.Fatal("later timestamp should stop untilTime stream")
	}
	if isLogLineAfterUntilTime("no timestamp line", &until) {
		t.Fatal("unparseable timestamp should preserve existing line behavior")
	}
	if !isLogLineAfterUntilTime(`10.0.0.1 - - [18/May/2026:18:00:01 +0800] "GET / HTTP/1.1" 200 2`, &until) {
		t.Fatal("nginx common log timestamp after untilTime should stop stream")
	}
	if isLogLineAfterUntilTime(`10.0.0.1 - - [18/May/2026:18:00:00 +0800] "GET / HTTP/1.1" 200 2`, &until) {
		t.Fatal("nginx common log timestamp equal to untilTime should pass")
	}
}

func TestParseLogLineTimestampSupportsRFC3339AndNginxCommonLogTime(t *testing.T) {
	rfc3339Line := "2026-05-18T10:00:00.123456789Z app started"
	parsed, ok := parseLogLineTimestamp(rfc3339Line)
	if !ok {
		t.Fatal("expected RFC3339 log prefix to parse")
	}
	if parsed.Format(time.RFC3339Nano) != "2026-05-18T10:00:00.123456789Z" {
		t.Fatalf("unexpected RFC3339 timestamp: %s", parsed.Format(time.RFC3339Nano))
	}

	nginxLine := `10.0.0.1 - - [18/May/2026:23:32:48 +0800] "GET / HTTP/1.1" 200 2`
	parsed, ok = parseLogLineTimestamp(nginxLine)
	if !ok {
		t.Fatal("expected nginx common log timestamp to parse")
	}
	if parsed.UTC().Format(time.RFC3339) != "2026-05-18T15:32:48Z" {
		t.Fatalf("unexpected nginx timestamp: %s", parsed.UTC().Format(time.RFC3339))
	}
}

func TestResolveLogStreamEmptyReason(t *testing.T) {
	if got := resolveLogStreamEmptyReason(0, 0, 0, 0, 0, true); got != "NO_LOG_LINES" {
		t.Fatalf("expected NO_LOG_LINES, got %q", got)
	}
	if got := resolveLogStreamEmptyReason(2, 0, 0, 0, 0, true); got != "NO_PARSEABLE_TIMESTAMPS" {
		t.Fatalf("expected NO_PARSEABLE_TIMESTAMPS, got %q", got)
	}
	if got := resolveLogStreamEmptyReason(2, 0, 2, 0, 0, true); got != "TIME_RANGE_NO_MATCH" {
		t.Fatalf("expected TIME_RANGE_NO_MATCH, got %q", got)
	}
	if got := resolveLogStreamEmptyReason(2, 0, 2, 2, 0, false); got != "FILTER_NO_MATCH" {
		t.Fatalf("expected FILTER_NO_MATCH, got %q", got)
	}
	if got := resolveLogStreamEmptyReason(2, 1, 2, 2, 1, true); got != "" {
		t.Fatalf("expected empty reason, got %q", got)
	}
}

func TestDescribeLogStreamOptionsIncludesTimeParams(t *testing.T) {
	description := describeLogStreamOptions(&logStreamOptions{
		SinceSeconds:           60,
		SinceTime:              "2026-05-18T10:00:00Z",
		UntilTime:              "2026-05-18T10:10:00Z",
		RefreshIntervalSeconds: 5,
	})

	expected := "sinceSeconds=60, sinceTime=2026-05-18T10:00:00Z, untilTime=2026-05-18T10:10:00Z, refreshIntervalSeconds=5"
	if description != expected {
		t.Fatalf("unexpected description:\nwant %q\n got %q", expected, description)
	}
}

func signRuntimeTokenForTest(t *testing.T, payload runtimeTokenPayload) string {
	t.Helper()

	headerBytes, err := json.Marshal(map[string]string{"alg": "HS256", "typ": "JWT"})
	if err != nil {
		t.Fatal(err)
	}
	payloadBytes, err := json.Marshal(payload)
	if err != nil {
		t.Fatal(err)
	}

	header := base64.RawURLEncoding.EncodeToString(headerBytes)
	body := base64.RawURLEncoding.EncodeToString(payloadBytes)
	unsigned := header + "." + body
	mac := hmac.New(sha256.New, []byte(defaultRuntimeTokenSecret))
	_, _ = mac.Write([]byte(unsigned))
	return unsigned + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func runtimeTokenQueryForTest(payload runtimeTokenPayload) map[string][]string {
	return map[string][]string{
		"sessionId": {payload.SessionID},
		"clusterId": {payload.ClusterID},
		"namespace": {payload.Namespace},
		"pod":       {payload.Pod},
		"container": {payload.Container},
	}
}
