package httpapi

import (
	"bufio"
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"os"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	corev1 "k8s.io/api/core/v1"
	metav1 "k8s.io/apimachinery/pkg/apis/meta/v1"
	"k8s.io/client-go/kubernetes"
	"k8s.io/client-go/kubernetes/scheme"
	"k8s.io/client-go/rest"
	"k8s.io/client-go/tools/clientcmd"
	"k8s.io/client-go/tools/remotecommand"

	"github.com/gorilla/websocket"
)

const (
	defaultRuntimeTokenSecret     = "dev-runtime-token-secret"
	defaultControlAPIBaseURL      = "http://localhost:4000"
	defaultRuntimeGatewayDeadline = 60 * time.Second
	wsWriteTimeout                = 10 * time.Second
	wsPingPeriod                  = 20 * time.Second
	wsPongWait                    = 60 * time.Second
)

type runtimeTokenPayload struct {
	SessionID string `json:"sessionId"`
	UserID    string `json:"userId"`
	Type      string `json:"type"`
	ClusterID string `json:"clusterId"`
	Namespace string `json:"namespace"`
	Pod       string `json:"pod"`
	Container string `json:"container"`
	Level     string `json:"level,omitempty"`
	Keyword   string `json:"keyword,omitempty"`
	TailLines int64  `json:"tailLines,omitempty"`
	SinceSecs int64  `json:"sinceSeconds,omitempty"`
	Follow    *bool  `json:"follow,omitempty"`
	Previous  *bool  `json:"previous,omitempty"`
	Timestamp *bool  `json:"timestamps,omitempty"`
	Path      string `json:"path"`
	Exp       int64  `json:"exp"`
}

type WSFrame struct {
	Type      string `json:"type"`
	Timestamp string `json:"timestamp"`
	Content   string `json:"content,omitempty"`
	// ContentB64 carries the raw byte stream in base64, so clients can render
	// terminal output (including ANSI/VT control sequences) without UTF-8 loss.
	// Legacy clients can continue using Content as best-effort text.
	ContentB64 string `json:"contentB64,omitempty"`
	State      string `json:"state,omitempty"`
	Code       string `json:"code,omitempty"`
}

type authErrorResponse struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type runtimeAuthContext struct {
	Payload      runtimeTokenPayload
	RuntimeToken string
}

type internalBootstrapResponse struct {
	SessionID        string            `json:"sessionId"`
	ClusterID        string            `json:"clusterId"`
	Namespace        string            `json:"namespace"`
	Pod              string            `json:"pod"`
	Container        string            `json:"container"`
	Type             string            `json:"type"`
	Path             string            `json:"path"`
	Kubeconfig       string            `json:"kubeconfig"`
	ShellCommand     []string          `json:"shellCommand"`
	LogStreamOptions *logStreamOptions `json:"logStreamOptions,omitempty"`
	ExpiresAt        string            `json:"expiresAt"`
	Reconnectable    bool              `json:"reconnectable"`
	SessionState     string            `json:"sessionState"`
	Target           *runtimeTarget    `json:"target,omitempty"`
}

type runtimeTarget struct {
	ClusterID           string   `json:"clusterId"`
	Namespace           string   `json:"namespace"`
	Pod                 string   `json:"pod"`
	Container           string   `json:"container"`
	AvailableContainers []string `json:"availableContainers,omitempty"`
	PodPhase            string   `json:"podPhase,omitempty"`
}

type internalBootstrapEnvelope struct {
	Data internalBootstrapResponse `json:"data"`
}

type logStreamOptions struct {
	Level        string `json:"level,omitempty"`
	Keyword      string `json:"keyword,omitempty"`
	TailLines    int64  `json:"tailLines,omitempty"`
	SinceSeconds int64  `json:"sinceSeconds,omitempty"`
	Follow       *bool  `json:"follow,omitempty"`
	Previous     *bool  `json:"previous,omitempty"`
	Timestamps   *bool  `json:"timestamps,omitempty"`
}

type terminalClientEnvelope struct {
	Type  string `json:"type"`
	Input string `json:"input,omitempty"`
	Cols  uint16 `json:"cols,omitempty"`
	Rows  uint16 `json:"rows,omitempty"`
}

type logsClientEnvelope struct {
	Type string `json:"type"`
}

type terminalWSWriter struct {
	io *wsConnIO
}

type terminalWSReader struct {
	inputCh chan []byte
	sizeCh  chan remotecommand.TerminalSize
	doneCh  chan struct{}

	mu     sync.Mutex
	buffer []byte
	closed bool
}

type wsJSONError struct {
	Code    string `json:"code"`
	Message string `json:"message"`
}

type wsConnIO struct {
	conn *websocket.Conn
	mu   sync.Mutex
}

type runtimeStreamError struct {
	Code      string
	Message   string
	CloseCode int
}

func getAllowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("ALLOWED_ORIGINS"))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	allowed := make([]string, 0, len(parts))
	for _, o := range parts {
		if o = strings.TrimSpace(o); o != "" {
			allowed = append(allowed, o)
		}
	}
	return allowed
}

var upgrader = websocket.Upgrader{
	ReadBufferSize:  1024,
	WriteBufferSize: 1024,
	CheckOrigin: func(r *http.Request) bool {
		origin := strings.TrimSpace(r.Header.Get("Origin"))
		allowedOrigins := getAllowedOrigins()
		isProd := strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production")

		// Browser WebSocket requests always include Origin. Non-browser clients (smoke tests, CLI tools)
		// may omit Origin entirely. Allow empty Origin only in non-production and only when no explicit
		// origin allowlist is configured, to keep production safety intact.
		if origin == "" {
			return !isProd && len(allowedOrigins) == 0
		}

		if len(allowedOrigins) == 0 && !isProd {
			return true
		}
		if isAllowedOrigin(origin, allowedOrigins) {
			return true
		}
		log.Printf(
			"runtime ws origin rejected: origin=%s remote=%s allowed=%s",
			origin,
			r.RemoteAddr,
			strings.Join(allowedOrigins, ","),
		)
		return false
	},
}

var kubeconfigDataFieldPattern = regexp.MustCompile(`(?m)^(\s*(?:certificate-authority-data|client-certificate-data|client-key-data)\s*:\s*)(\S+)\s*$`)

func writeFrame(conn *websocket.Conn, frame WSFrame) error {
	frame.Timestamp = time.Now().Format(time.RFC3339)
	conn.SetWriteDeadline(time.Now().Add(wsWriteTimeout))
	return conn.WriteJSON(frame)
}

func (w *wsConnIO) writeFrame(frame WSFrame) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return writeFrame(w.conn, frame)
}

func (w *wsConnIO) writeControl(messageType int, data []byte) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.conn.WriteControl(messageType, data, time.Now().Add(wsWriteTimeout))
}

func validateRuntimeAuth(w http.ResponseWriter, r *http.Request) (auth runtimeAuthContext, ok bool) {
	sessionID := strings.TrimSpace(r.URL.Query().Get("sessionId"))
	runtimeToken := strings.TrimSpace(r.URL.Query().Get("runtimeToken"))

	if sessionID == "" || runtimeToken == "" {
		writeAuthError(w, http.StatusUnauthorized, "RUNTIME_AUTH_MISSING_FIELDS", "missing sessionId or runtimeToken")
		return runtimeAuthContext{}, false
	}
	tokenPayload, code, msg := validateRuntimeToken(runtimeToken, r.URL.Path, r.URL.Query())
	if code != "" {
		log.Printf(
			"runtime auth failed: code=%s path=%s origin=%s remote=%s",
			code,
			r.URL.Path,
			strings.TrimSpace(r.Header.Get("Origin")),
			r.RemoteAddr,
		)
		writeAuthError(w, http.StatusUnauthorized, code, msg)
		return runtimeAuthContext{}, false
	}
	return runtimeAuthContext{
		Payload:      tokenPayload,
		RuntimeToken: runtimeToken,
	}, true
}

func isAllowedOrigin(origin string, allowedOrigins []string) bool {
	origin = strings.TrimSpace(origin)
	if origin == "" {
		return false
	}
	if isDevLocalOrigin(origin) {
		return true
	}
	for _, allowed := range allowedOrigins {
		allowed = strings.TrimSpace(allowed)
		if allowed == "" {
			continue
		}
		if origin == allowed {
			return true
		}
		if strings.HasSuffix(allowed, ":*") {
			prefix := strings.TrimSuffix(allowed, ":*")
			if strings.HasPrefix(origin, prefix+":") {
				return true
			}
		}
	}
	return false
}

func isDevLocalOrigin(origin string) bool {
	if strings.EqualFold(strings.TrimSpace(os.Getenv("NODE_ENV")), "production") {
		return false
	}
	parsed, err := url.Parse(origin)
	if err != nil {
		return false
	}
	host := strings.ToLower(parsed.Hostname())
	return host == "localhost" || host == "127.0.0.1" || host == "::1"
}

func validateRuntimeToken(token string, requestPath string, queryValues map[string][]string) (runtimeTokenPayload, string, string) {
	parts := strings.Split(token, ".")
	if len(parts) != 3 {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_FORMAT_INVALID", "runtimeToken format is invalid"
	}

	unsigned := parts[0] + "." + parts[1]
	expectedMAC := hmac.New(sha256.New, []byte(getRuntimeTokenSecret()))
	_, _ = expectedMAC.Write([]byte(unsigned))
	expectedSig := expectedMAC.Sum(nil)

	receivedSig, err := base64.RawURLEncoding.DecodeString(parts[2])
	if err != nil {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_SIGNATURE_INVALID", "runtimeToken signature is invalid"
	}
	if !hmac.Equal(receivedSig, expectedSig) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_SIGNATURE_INVALID", "runtimeToken signature is invalid"
	}

	payloadBytes, err := base64.RawURLEncoding.DecodeString(parts[1])
	if err != nil {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_PAYLOAD_INVALID", "runtimeToken payload cannot be decoded"
	}

	var payload runtimeTokenPayload
	if err = json.Unmarshal(payloadBytes, &payload); err != nil {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_PAYLOAD_INVALID", "runtimeToken payload is invalid"
	}
	if strings.TrimSpace(payload.SessionID) == "" ||
		strings.TrimSpace(payload.UserID) == "" ||
		strings.TrimSpace(payload.Type) == "" ||
		strings.TrimSpace(payload.ClusterID) == "" ||
		strings.TrimSpace(payload.Namespace) == "" ||
		strings.TrimSpace(payload.Pod) == "" ||
		strings.TrimSpace(payload.Container) == "" ||
		strings.TrimSpace(payload.Path) == "" ||
		payload.Exp <= 0 {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_CLAIMS_INCOMPLETE", "runtimeToken claims are incomplete"
	}
	if requestPath != payload.Path {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_PATH_MISMATCH", "runtimeToken path claim mismatch"
	}
	expectedType := "logs"
	if requestPath == "/ws/terminal" {
		expectedType = "terminal"
	}
	if requestPath != "/ws/terminal" && requestPath != "/ws/logs" {
		return runtimeTokenPayload{}, "RUNTIME_PATH_UNSUPPORTED", "websocket path is unsupported"
	}
	if payload.Type != expectedType {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_TYPE_MISMATCH", "runtimeToken type claim mismatch"
	}
	if payload.SessionID != strings.TrimSpace(firstQueryValue(queryValues, "sessionId")) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_SESSION_MISMATCH", "runtimeToken sessionId claim mismatch"
	}
	if payload.ClusterID != strings.TrimSpace(firstQueryValue(queryValues, "clusterId")) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_CLUSTER_MISMATCH", "runtimeToken clusterId claim mismatch"
	}
	if payload.Namespace != strings.TrimSpace(firstQueryValue(queryValues, "namespace")) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_NAMESPACE_MISMATCH", "runtimeToken namespace claim mismatch"
	}
	if payload.Pod != strings.TrimSpace(firstQueryValue(queryValues, "pod")) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_POD_MISMATCH", "runtimeToken pod claim mismatch"
	}
	if payload.Container != strings.TrimSpace(firstQueryValue(queryValues, "container")) {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_CONTAINER_MISMATCH", "runtimeToken container claim mismatch"
	}
	if payload.Level != "" && payload.Level != "INFO" && payload.Level != "WARN" && payload.Level != "ERROR" {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_LOG_LEVEL_INVALID", "runtimeToken log level claim is invalid"
	}
	if payload.TailLines < -1 {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_TAIL_LINES_INVALID", "runtimeToken tailLines claim is invalid"
	}
	if payload.SinceSecs < 0 {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_SINCE_SECONDS_INVALID", "runtimeToken sinceSeconds claim is invalid"
	}
	if time.Now().Unix() >= payload.Exp {
		return runtimeTokenPayload{}, "RUNTIME_TOKEN_EXPIRED", "runtimeToken is expired"
	}
	return payload, "", ""
}

func getRuntimeTokenSecret() string {
	secret := strings.TrimSpace(os.Getenv("RUNTIME_TOKEN_SECRET"))
	if secret == "" {
		return defaultRuntimeTokenSecret
	}
	return secret
}

func getRuntimeGatewayInternalSecret() string {
	secret := strings.TrimSpace(os.Getenv("RUNTIME_GATEWAY_INTERNAL_SECRET"))
	if secret == "" {
		return getRuntimeTokenSecret()
	}
	return secret
}

func getControlAPIBaseURL() string {
	raw := strings.TrimSpace(os.Getenv("CONTROL_API_BASE_URL"))
	if raw == "" {
		return defaultControlAPIBaseURL
	}
	return strings.TrimRight(raw, "/")
}

func writeAuthError(w http.ResponseWriter, statusCode int, code string, message string) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(statusCode)
	_ = json.NewEncoder(w).Encode(authErrorResponse{
		Code:    code,
		Message: message,
	})
}

func firstQueryValue(values map[string][]string, key string) string {
	v := values[key]
	if len(v) == 0 {
		return ""
	}
	return v[0]
}

func TerminalWS(w http.ResponseWriter, r *http.Request) {
	authContext, ok := validateRuntimeAuth(w, r)
	if !ok {
		return
	}
	tokenPayload := authContext.Payload
	log.Printf(
		"terminal ws accepted: sessionId=%s clusterId=%s ns=%s pod=%s container=%s remote=%s",
		tokenPayload.SessionID,
		tokenPayload.ClusterID,
		tokenPayload.Namespace,
		tokenPayload.Pod,
		tokenPayload.Container,
		r.RemoteAddr,
	)

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	connIO := &wsConnIO{conn: conn}

	conn.SetReadLimit(1024 * 1024)
	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})

	if err = connIO.writeFrame(WSFrame{Type: "system", State: "connecting", Content: "终端连接中"}); err != nil {
		return
	}

	bootstrap, err := fetchRuntimeBootstrap(r.Context(), tokenPayload, authContext.RuntimeToken)
	if err != nil {
		log.Printf("terminal ws bootstrap failed: sessionId=%s err=%v", tokenPayload.SessionID, err)
		streamErr := classifyRuntimeError("RUNTIME_BOOTSTRAP_FAILED", err)
		writeTerminalError(connIO, streamErr)
		return
	}

	writer := &terminalWSWriter{io: connIO}
	reader := newTerminalWSReader()
	defer reader.Close()

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	go pumpTerminalClientMessages(ctx, conn, reader, writer)
	go pumpWebsocketKeepalive(ctx, connIO)

	if err = writer.writeFrame(WSFrame{
		Type:    "system",
		State:   "connected",
		Content: fmt.Sprintf("终端已连接: %s/%s (%s)", bootstrap.Namespace, bootstrap.Pod, bootstrap.Container),
	}); err != nil {
		return
	}

	if err = streamTerminalSession(ctx, bootstrap, reader, writer); err != nil {
		log.Printf(
			"terminal ws stream failed: sessionId=%s ns=%s pod=%s container=%s err=%v",
			bootstrap.SessionID,
			bootstrap.Namespace,
			bootstrap.Pod,
			bootstrap.Container,
			err,
		)
		streamErr := classifyRuntimeError("RUNTIME_EXEC_FAILED", err)
		writeTerminalError(connIO, streamErr)
	}
}

func LogsWS(w http.ResponseWriter, r *http.Request) {
	authContext, ok := validateRuntimeAuth(w, r)
	if !ok {
		return
	}
	tokenPayload := authContext.Payload

	conn, err := upgrader.Upgrade(w, r, nil)
	if err != nil {
		return
	}
	defer conn.Close()
	connIO := &wsConnIO{conn: conn}

	conn.SetReadLimit(1024 * 1024)
	conn.SetReadDeadline(time.Now().Add(wsPongWait))
	conn.SetPongHandler(func(string) error {
		return conn.SetReadDeadline(time.Now().Add(wsPongWait))
	})

	if err = connIO.writeFrame(WSFrame{Type: "system", State: "connecting", Content: "日志流连接中"}); err != nil {
		return
	}

	bootstrap, err := fetchRuntimeBootstrap(r.Context(), tokenPayload, authContext.RuntimeToken)
	if err != nil {
		log.Printf("logs ws bootstrap failed: sessionId=%s err=%v", tokenPayload.SessionID, err)
		streamErr := classifyRuntimeError("RUNTIME_BOOTSTRAP_FAILED", err)
		writeTerminalError(connIO, streamErr)
		return
	}

	ctx, cancel := context.WithCancel(r.Context())
	defer cancel()

	writer := &terminalWSWriter{io: connIO}
	go pumpLogsClientMessages(ctx, cancel, conn, writer)
	go pumpWebsocketKeepalive(ctx, connIO)

	description := fmt.Sprintf("日志流已连接: %s/%s (%s)", bootstrap.Namespace, bootstrap.Pod, bootstrap.Container)
	if bootstrap.LogStreamOptions != nil {
		description = fmt.Sprintf("%s，过滤条件: %s", description, describeLogStreamOptions(bootstrap.LogStreamOptions))
	}
	if err = writer.writeFrame(WSFrame{Type: "system", State: "connected", Content: description}); err != nil {
		return
	}

	if err = streamPodLogs(ctx, bootstrap, writer, parsePreviousFlag(r)); err != nil {
		log.Printf(
			"logs ws stream failed: sessionId=%s ns=%s pod=%s container=%s err=%v",
			bootstrap.SessionID,
			bootstrap.Namespace,
			bootstrap.Pod,
			bootstrap.Container,
			err,
		)
		streamErr := classifyRuntimeError("RUNTIME_LOG_STREAM_FAILED", err)
		writeTerminalError(connIO, streamErr)
	}
}

func fetchRuntimeBootstrap(
	ctx context.Context,
	payload runtimeTokenPayload,
	runtimeToken string,
) (*internalBootstrapResponse, error) {
	requestURL, err := url.Parse(
		fmt.Sprintf(
			"%s/api/runtime/internal/sessions/%s/bootstrap",
			getControlAPIBaseURL(),
			url.PathEscape(payload.SessionID),
		),
	)
	if err != nil {
		return nil, fmt.Errorf("failed to build bootstrap url: %w", err)
	}

	query := requestURL.Query()
	query.Set("runtimeToken", runtimeToken)
	query.Set("path", payload.Path)
	requestURL.RawQuery = query.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, requestURL.String(), nil)
	if err != nil {
		return nil, fmt.Errorf("failed to create bootstrap request: %w", err)
	}
	req.Header.Set("X-Runtime-Gateway-Secret", getRuntimeGatewayInternalSecret())

	client := &http.Client{Timeout: defaultRuntimeGatewayDeadline}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("control-api bootstrap request failed: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		var apiErr wsJSONError
		if decodeErr := json.NewDecoder(resp.Body).Decode(&apiErr); decodeErr == nil && apiErr.Message != "" {
			if apiErr.Code != "" {
				return nil, fmt.Errorf("%s: %s", apiErr.Code, apiErr.Message)
			}
			return nil, fmt.Errorf("%s", apiErr.Message)
		}
		bodyBytes, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		body := strings.TrimSpace(string(bodyBytes))
		if body == "" {
			body = resp.Status
		}
		return nil, fmt.Errorf("control-api bootstrap failed: %s", body)
	}

	bodyBytes, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return nil, fmt.Errorf("failed to read bootstrap response: %w", err)
	}

	var bootstrap internalBootstrapResponse
	if err = json.Unmarshal(bodyBytes, &bootstrap); err != nil {
		return nil, fmt.Errorf("failed to decode bootstrap response: %w", err)
	}
	if bootstrap.Kubeconfig == "" {
		var enveloped internalBootstrapEnvelope
		if err = json.Unmarshal(bodyBytes, &enveloped); err == nil && enveloped.Data.Kubeconfig != "" {
			bootstrap = enveloped.Data
		}
	}
	if bootstrap.Kubeconfig == "" {
		return nil, errors.New("bootstrap response missing kubeconfig")
	}
	if len(bootstrap.ShellCommand) == 0 {
		bootstrap.ShellCommand = []string{"/bin/sh"}
	}
	log.Printf(
		"runtime bootstrap ok: sessionId=%s type=%s path=%s ns=%s pod=%s container=%s",
		bootstrap.SessionID,
		bootstrap.Type,
		bootstrap.Path,
		bootstrap.Namespace,
		bootstrap.Pod,
		bootstrap.Container,
	)
	return &bootstrap, nil
}

func streamPodLogs(
	ctx context.Context,
	bootstrap *internalBootstrapResponse,
	writer *terminalWSWriter,
	previous bool,
) error {
	config, err := clientcmd.RESTConfigFromKubeConfig([]byte(bootstrap.Kubeconfig))
	if err != nil {
		return fmt.Errorf("kubeconfig is invalid: %w", err)
	}

	restConfig := rest.CopyConfig(config)
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}

	options := &corev1.PodLogOptions{
		Container:  bootstrap.Container,
		Follow:     true,
		Timestamps: true,
		Previous:   previous,
	}
	if bootstrap.LogStreamOptions != nil {
		if bootstrap.LogStreamOptions.Follow != nil {
			options.Follow = *bootstrap.LogStreamOptions.Follow
		}
		if bootstrap.LogStreamOptions.Previous != nil {
			options.Previous = *bootstrap.LogStreamOptions.Previous
		}
		if bootstrap.LogStreamOptions.Timestamps != nil {
			options.Timestamps = *bootstrap.LogStreamOptions.Timestamps
		}
		if bootstrap.LogStreamOptions.TailLines > 0 {
			options.TailLines = &bootstrap.LogStreamOptions.TailLines
		}
		if bootstrap.LogStreamOptions.SinceSeconds > 0 {
			options.SinceSeconds = &bootstrap.LogStreamOptions.SinceSeconds
		}
	}

	stream, err := clientset.CoreV1().
		Pods(bootstrap.Namespace).
		GetLogs(bootstrap.Pod, options).
		Stream(ctx)
	if err != nil {
		if previous && isPreviousLogUnavailableError(err) {
			_ = writer.writeFrame(WSFrame{
				Type:    "system",
				State:   "warning",
				Code:    "RUNTIME_PREVIOUS_LOG_NOT_FOUND",
				Content: "未找到 previous terminated 容器日志，已自动切换到当前容器实时日志。",
			})
			options.Previous = false
			stream, err = clientset.CoreV1().
				Pods(bootstrap.Namespace).
				GetLogs(bootstrap.Pod, options).
				Stream(ctx)
		}
	}
	if err != nil {
		if isExpectedCancellationError(err) {
			return nil
		}
		return fmt.Errorf("failed to open pod log stream: %w", err)
	}
	defer stream.Close()

	scanner := bufio.NewScanner(stream)
	buffer := make([]byte, 0, 64*1024)
	scanner.Buffer(buffer, 1024*1024)

	for scanner.Scan() {
		select {
		case <-ctx.Done():
			return nil
		default:
		}

		line := strings.TrimRight(scanner.Text(), "\r")
		if line == "" {
			continue
		}
		if !matchesLogFilters(line, bootstrap.LogStreamOptions) {
			continue
		}
		if err = writer.writeFrame(WSFrame{Type: "log", Content: line}); err != nil {
			return err
		}
	}
	if scanErr := scanner.Err(); scanErr != nil && ctx.Err() == nil {
		if isExpectedCancellationError(scanErr) {
			return nil
		}
		return fmt.Errorf("log stream interrupted: %w", scanErr)
	}
	_ = writer.writeFrame(WSFrame{Type: "system", State: "disconnected", Content: "日志流已结束"})
	return nil
}

func matchesLogFilters(line string, options *logStreamOptions) bool {
	if options == nil {
		return true
	}

	message := line
	if idx := strings.IndexByte(line, ' '); idx > 0 {
		message = line[idx+1:]
	}
	if options.Keyword != "" && !strings.Contains(strings.ToLower(message), strings.ToLower(options.Keyword)) {
		return false
	}
	if options.Level == "" {
		return true
	}
	return inferLogLevel(message) == options.Level
}

func inferLogLevel(message string) string {
	upper := strings.ToUpper(message)
	switch {
	case strings.Contains(upper, "ERROR"), strings.Contains(upper, "FATAL"), strings.Contains(upper, "ERR "):
		return "ERROR"
	case strings.Contains(upper, "WARN"), strings.Contains(upper, "WRN "):
		return "WARN"
	default:
		return "INFO"
	}
}

func describeLogStreamOptions(options *logStreamOptions) string {
	if options == nil {
		return "默认实时日志"
	}
	parts := make([]string, 0, 4)
	if options.Level != "" {
		parts = append(parts, "level="+options.Level)
	}
	if options.Keyword != "" {
		parts = append(parts, "keyword="+options.Keyword)
	}
	if options.TailLines > 0 {
		parts = append(parts, fmt.Sprintf("tailLines=%d", options.TailLines))
	}
	if options.SinceSeconds > 0 {
		parts = append(parts, fmt.Sprintf("sinceSeconds=%d", options.SinceSeconds))
	}
	if options.Follow != nil {
		parts = append(parts, fmt.Sprintf("follow=%t", *options.Follow))
	}
	if options.Previous != nil {
		parts = append(parts, fmt.Sprintf("previous=%t", *options.Previous))
	}
	if options.Timestamps != nil {
		parts = append(parts, fmt.Sprintf("timestamps=%t", *options.Timestamps))
	}
	if len(parts) == 0 {
		return "默认实时日志"
	}
	return strings.Join(parts, ", ")
}

func streamTerminalSession(
	ctx context.Context,
	bootstrap *internalBootstrapResponse,
	reader *terminalWSReader,
	writer *terminalWSWriter,
) error {
	normalizedKubeconfig := normalizeKubeconfigBase64Data(bootstrap.Kubeconfig)
	config, err := clientcmd.RESTConfigFromKubeConfig([]byte(normalizedKubeconfig))
	if err != nil {
		return fmt.Errorf("kubeconfig is invalid: %w", err)
	}

	restConfig := rest.CopyConfig(config)
	clientset, err := kubernetes.NewForConfig(restConfig)
	if err != nil {
		return fmt.Errorf("failed to create kubernetes client: %w", err)
	}
	execContainer, fallbackReason, err := resolveExecContainer(ctx, clientset, bootstrap)
	if err != nil {
		return err
	}
	if fallbackReason != "" {
		_ = writer.writeFrame(WSFrame{
			Type:    "system",
			State:   "warning",
			Code:    "RUNTIME_CONTAINER_FALLBACK",
			Content: fallbackReason,
		})
		log.Printf(
			"terminal container fallback: sessionId=%s ns=%s pod=%s requested=%s selected=%s",
			bootstrap.SessionID,
			bootstrap.Namespace,
			bootstrap.Pod,
			bootstrap.Container,
			execContainer,
		)
	}

	request := clientset.CoreV1().RESTClient().
		Post().
		Resource("pods").
		Name(bootstrap.Pod).
		Namespace(bootstrap.Namespace).
		SubResource("exec").
		VersionedParams(&corev1.PodExecOptions{
			Container: execContainer,
			Command:   bootstrap.ShellCommand,
			Stdin:     true,
			Stdout:    true,
			Stderr:    true,
			TTY:       true,
		}, scheme.ParameterCodec)

	executor, err := remotecommand.NewSPDYExecutor(restConfig, http.MethodPost, request.URL())
	if err != nil {
		return fmt.Errorf("failed to create exec executor: %w", err)
	}

	streamErr := executor.StreamWithContext(ctx, remotecommand.StreamOptions{
		Stdin:             reader,
		Stdout:            writer.stdout(),
		Stderr:            writer.stderr(),
		Tty:               true,
		TerminalSizeQueue: reader,
	})
	if streamErr == nil {
		_ = writer.writeFrame(WSFrame{Type: "system", State: "disconnected", Content: "终端会话已结束"})
		return nil
	}
	if ctx.Err() != nil {
		return nil
	}
	return streamErr
}

func resolveExecContainer(
	ctx context.Context,
	clientset *kubernetes.Clientset,
	bootstrap *internalBootstrapResponse,
) (container string, fallbackReason string, err error) {
	pod, err := clientset.CoreV1().
		Pods(bootstrap.Namespace).
		Get(ctx, bootstrap.Pod, metav1.GetOptions{})
	if err != nil {
		return "", "", fmt.Errorf("failed to read pod before exec: %w", err)
	}

	requested := strings.TrimSpace(bootstrap.Container)
	for _, item := range pod.Spec.Containers {
		if item.Name == requested {
			return requested, "", nil
		}
	}

	if len(pod.Spec.Containers) == 0 {
		return "", "", fmt.Errorf(
			"pod %s/%s has no containers for exec",
			bootstrap.Namespace,
			bootstrap.Pod,
		)
	}

	selected := pod.Spec.Containers[0].Name
	if requested == "" {
		return selected, "容器参数为空，已自动回退到第一个可执行容器。", nil
	}
	return selected, fmt.Sprintf("容器 %s 不存在，已自动回退到 %s。", requested, selected), nil
}

func classifyRuntimeError(defaultCode string, err error) runtimeStreamError {
	message := "runtime stream failed"
	if err != nil && strings.TrimSpace(err.Error()) != "" {
		message = err.Error()
	}

	lower := strings.ToLower(message)
	switch {
	case strings.Contains(lower, "kubeconfig is invalid"):
		return runtimeStreamError{
			Code:      "RUNTIME_KUBECONFIG_INVALID",
			Message:   message,
			CloseCode: websocket.ClosePolicyViolation,
		}
	case strings.Contains(lower, "已过期"),
		strings.Contains(lower, "expired"):
		return runtimeStreamError{
			Code:      "RUNTIME_SESSION_EXPIRED",
			Message:   message,
			CloseCode: websocket.ClosePolicyViolation,
		}
	case strings.Contains(lower, "无效或已过期"),
		strings.Contains(lower, "token"),
		strings.Contains(lower, "forbidden"),
		strings.Contains(lower, "unauthorized"):
		return runtimeStreamError{
			Code:      "RUNTIME_AUTH_FAILED",
			Message:   message,
			CloseCode: websocket.ClosePolicyViolation,
		}
	case strings.Contains(lower, "session_not_found"),
		strings.Contains(lower, "session_closed"),
		strings.Contains(lower, "会话不存在"),
		strings.Contains(lower, "会话已关闭"):
		code := "RUNTIME_SESSION_NOT_FOUND"
		if strings.Contains(lower, "session_closed") || strings.Contains(lower, "会话已关闭") {
			code = "RUNTIME_SESSION_CLOSED"
		}
		return runtimeStreamError{
			Code:      code,
			Message:   message,
			CloseCode: websocket.ClosePolicyViolation,
		}
	case strings.Contains(lower, "container") && strings.Contains(lower, "not found"):
		return runtimeStreamError{
			Code:      "RUNTIME_CONTAINER_NOT_FOUND",
			Message:   message,
			CloseCode: websocket.CloseUnsupportedData,
		}
	case strings.Contains(lower, "pods") && strings.Contains(lower, "not found"):
		return runtimeStreamError{
			Code:      "RUNTIME_POD_NOT_FOUND",
			Message:   message,
			CloseCode: websocket.CloseUnsupportedData,
		}
	case strings.Contains(lower, "bootstrap"),
		strings.Contains(lower, "kubeconfig"):
		return runtimeStreamError{
			Code:      "RUNTIME_GATEWAY_BOOTSTRAP_FAILED",
			Message:   message,
			CloseCode: websocket.CloseTryAgainLater,
		}
	default:
		return runtimeStreamError{
			Code:      defaultCode,
			Message:   message,
			CloseCode: websocket.CloseInternalServerErr,
		}
	}
}

func normalizeKubeconfigBase64Data(raw string) string {
	if strings.TrimSpace(raw) == "" {
		return raw
	}
	return kubeconfigDataFieldPattern.ReplaceAllStringFunc(raw, func(line string) string {
		matches := kubeconfigDataFieldPattern.FindStringSubmatch(line)
		if len(matches) != 3 {
			return line
		}
		prefix := matches[1]
		value := matches[2]
		trimmed := strings.Trim(strings.TrimSpace(value), `"'`)
		if trimmed == "" {
			return line
		}
		normalized := strings.NewReplacer("-", "+", "_", "/", "\n", "", "\r", "", "\t", "", " ", "").Replace(trimmed)
		if rem := len(normalized) % 4; rem != 0 {
			normalized += strings.Repeat("=", 4-rem)
		}
		return prefix + normalized
	})
}

func runtimeErrorState(streamErr runtimeStreamError) string {
	switch streamErr.Code {
	case "RUNTIME_SESSION_EXPIRED":
		return "expired"
	case "RUNTIME_SESSION_NOT_FOUND", "RUNTIME_SESSION_CLOSED":
		return "disconnected"
	default:
		return "error"
	}
}

func writeTerminalError(connIO *wsConnIO, streamErr runtimeStreamError) {
	_ = connIO.writeFrame(WSFrame{
		Type:    "error",
		State:   runtimeErrorState(streamErr),
		Code:    streamErr.Code,
		Content: streamErr.Message,
	})
	closeCode := streamErr.CloseCode
	if closeCode == 0 {
		closeCode = websocket.CloseInternalServerErr
	}
	_ = connIO.writeControl(
		websocket.CloseMessage,
		websocket.FormatCloseMessage(closeCode, streamErr.Code),
	)
}

func pumpTerminalClientMessages(
	ctx context.Context,
	conn *websocket.Conn,
	reader *terminalWSReader,
	writer *terminalWSWriter,
) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			reader.Close()
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		if handled, handleErr := handleTerminalEnvelope(payload, reader, writer); handled {
			if handleErr != nil {
				_ = writer.writeFrame(WSFrame{
					Type:    "system",
					State:   "error",
					Code:    "RUNTIME_BAD_REQUEST",
					Content: handleErr.Error(),
				})
			}
			continue
		}

		reader.PushInput(normalizeTerminalInput(payload))
	}
}

func pumpLogsClientMessages(
	ctx context.Context,
	cancel context.CancelFunc,
	conn *websocket.Conn,
	writer *terminalWSWriter,
) {
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}

		messageType, payload, err := conn.ReadMessage()
		if err != nil {
			if websocket.IsCloseError(
				err,
				websocket.CloseNormalClosure,
				websocket.CloseGoingAway,
				websocket.CloseNoStatusReceived,
			) || isExpectedCancellationError(err) {
				return
			}
			cancel()
			return
		}
		if messageType != websocket.TextMessage && messageType != websocket.BinaryMessage {
			continue
		}

		if handled, handleErr := handleLogsEnvelope(payload, writer); handled {
			if handleErr != nil {
				_ = writer.writeFrame(WSFrame{
					Type:    "system",
					State:   "error",
					Code:    "RUNTIME_BAD_REQUEST",
					Content: handleErr.Error(),
				})
			}
			continue
		}
	}
}

func parsePreviousFlag(r *http.Request) bool {
	raw := strings.TrimSpace(r.URL.Query().Get("previous"))
	if raw == "" {
		return false
	}
	parsed, err := strconv.ParseBool(raw)
	if err != nil {
		return false
	}
	return parsed
}

func isExpectedCancellationError(err error) bool {
	if err == nil {
		return false
	}
	if errors.Is(err, context.Canceled) || errors.Is(err, io.EOF) {
		return true
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "context canceled") ||
		strings.Contains(lower, "use of closed network connection") ||
		strings.Contains(lower, "close sent")
}

func isPreviousLogUnavailableError(err error) bool {
	if err == nil {
		return false
	}
	lower := strings.ToLower(err.Error())
	return strings.Contains(lower, "previous terminated container") &&
		strings.Contains(lower, "not found")
}

func handleTerminalEnvelope(
	payload []byte,
	reader *terminalWSReader,
	writer *terminalWSWriter,
) (bool, error) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return false, nil
	}

	var envelope terminalClientEnvelope
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return true, fmt.Errorf("terminal control message is invalid json")
	}

	switch envelope.Type {
	case "input":
		if envelope.Input == "" {
			return true, fmt.Errorf("input payload is empty")
		}
		reader.PushInput([]byte(envelope.Input))
		return true, nil
	case "resize":
		if envelope.Cols == 0 || envelope.Rows == 0 {
			return true, fmt.Errorf("resize payload requires positive cols and rows")
		}
		reader.PushSize(envelope.Cols, envelope.Rows)
		return true, nil
	case "ping":
		return true, writer.writeFrame(WSFrame{
			Type:    "system",
			State:   "keepalive",
			Content: "pong",
		})
	case "":
		return false, nil
	default:
		return true, fmt.Errorf("unsupported terminal message type: %s", envelope.Type)
	}
}

func handleLogsEnvelope(payload []byte, writer *terminalWSWriter) (bool, error) {
	trimmed := bytes.TrimSpace(payload)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return false, nil
	}

	var envelope logsClientEnvelope
	if err := json.Unmarshal(trimmed, &envelope); err != nil {
		return true, fmt.Errorf("logs control message is invalid json")
	}

	switch envelope.Type {
	case "ping":
		return true, writer.writeFrame(WSFrame{
			Type:    "system",
			State:   "keepalive",
			Content: "pong",
		})
	case "":
		return false, nil
	default:
		return true, fmt.Errorf("unsupported logs message type: %s", envelope.Type)
	}
}

func normalizeTerminalInput(input []byte) []byte {
	if len(input) == 0 {
		return input
	}
	if bytes.HasSuffix(input, []byte("\n")) || bytes.HasSuffix(input, []byte("\r")) {
		return input
	}
	return append(append([]byte{}, input...), '\n')
}

func pumpWebsocketKeepalive(ctx context.Context, connIO *wsConnIO) {
	ticker := time.NewTicker(wsPingPeriod)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if err := connIO.writeControl(websocket.PingMessage, []byte("ping")); err != nil {
				return
			}
		}
	}
}

func newTerminalWSReader() *terminalWSReader {
	return &terminalWSReader{
		inputCh: make(chan []byte, 64),
		sizeCh:  make(chan remotecommand.TerminalSize, 8),
		doneCh:  make(chan struct{}),
	}
}

func (r *terminalWSReader) Read(p []byte) (int, error) {
	r.mu.Lock()
	if len(r.buffer) > 0 {
		n := copy(p, r.buffer)
		r.buffer = r.buffer[n:]
		r.mu.Unlock()
		return n, nil
	}
	r.mu.Unlock()

	select {
	case <-r.doneCh:
		return 0, io.EOF
	case chunk, ok := <-r.inputCh:
		if !ok {
			return 0, io.EOF
		}
		n := copy(p, chunk)
		if n < len(chunk) {
			r.mu.Lock()
			r.buffer = append(r.buffer[:0], chunk[n:]...)
			r.mu.Unlock()
		}
		return n, nil
	}
}

func (r *terminalWSReader) Next() *remotecommand.TerminalSize {
	select {
	case <-r.doneCh:
		return nil
	case size, ok := <-r.sizeCh:
		if !ok {
			return nil
		}
		return &size
	}
}

func (r *terminalWSReader) PushInput(input []byte) {
	if len(input) == 0 {
		return
	}
	select {
	case <-r.doneCh:
		return
	case r.inputCh <- append([]byte{}, input...):
	default:
	}
}

func (r *terminalWSReader) PushSize(cols uint16, rows uint16) {
	select {
	case <-r.doneCh:
		return
	case r.sizeCh <- remotecommand.TerminalSize{Width: cols, Height: rows}:
	default:
	}
}

func (r *terminalWSReader) Close() {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.closed {
		return
	}
	r.closed = true
	close(r.doneCh)
}

func (w *terminalWSWriter) stdout() io.Writer {
	return terminalStreamWriterFunc(func(p []byte) (int, error) {
		if len(p) == 0 {
			return 0, nil
		}
		// Preserve raw bytes for terminal fidelity; keep Content for backwards compatibility.
		if err := w.writeFrame(WSFrame{
			Type:       "stdout",
			Content:    string(p),
			ContentB64: base64.StdEncoding.EncodeToString(p),
		}); err != nil {
			return 0, err
		}
		return len(p), nil
	})
}

func (w *terminalWSWriter) stderr() io.Writer {
	return terminalStreamWriterFunc(func(p []byte) (int, error) {
		if len(p) == 0 {
			return 0, nil
		}
		// Preserve raw bytes for terminal fidelity; keep Content for backwards compatibility.
		if err := w.writeFrame(WSFrame{
			Type:       "stderr",
			Content:    string(p),
			ContentB64: base64.StdEncoding.EncodeToString(p),
		}); err != nil {
			return 0, err
		}
		return len(p), nil
	})
}

func (w *terminalWSWriter) writeFrame(frame WSFrame) error {
	return w.io.writeFrame(frame)
}

type terminalStreamWriterFunc func([]byte) (int, error)

func (f terminalStreamWriterFunc) Write(p []byte) (int, error) {
	return f(p)
}
