export type TerminalConnectionStatus = "connecting" | "connected" | "disconnected";

export type TerminalTarget = {
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
};

export type TerminalMessageKind = "stdout" | "stderr" | "system" | "control";

export type TerminalParsedMessage = {
  kind: TerminalMessageKind;
  text: string;
  state?: string;
  code?: string;
  control?: "clear";
};

type ParsedFrame = {
  type?: string;
  content?: unknown;
  contentB64?: string;
  state?: string;
  code?: string;
};

function resolveDefaultWsBase(): string {
  if (typeof window === "undefined") {
    return "ws://localhost:4100";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}`;
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);
const DEFAULT_WS_CONNECT_TIMEOUT_MS = 5000;
const DEFAULT_RUNTIME_GATEWAY_PORT = "4100";
const SENSITIVE_QUERY_KEYS = new Set([
  "runtimetoken",
  "token",
  "authorization",
  "auth",
  "access_token",
  "refresh_token",
  "id_token",
  "jwt",
  "signature",
  "sig",
]);

function normalizeToWsProtocol(raw: string): string {
  if (raw.startsWith("http://")) return `ws://${raw.slice("http://".length)}`;
  if (raw.startsWith("https://")) return `wss://${raw.slice("https://".length)}`;
  return raw;
}

export function buildTerminalWsUrl(target: TerminalTarget, baseWsUrl?: string): string {
  const fallback = `${resolveDefaultWsBase()}/ws/terminal`;
  const rawBase = normalizeToWsProtocol((baseWsUrl ?? fallback).trim());
  let wsUrl: URL;
  try {
    wsUrl = new URL(rawBase, fallback);
  } catch {
    wsUrl = new URL(fallback);
  }

  if (!wsUrl.pathname || wsUrl.pathname === "/") {
    wsUrl.pathname = "/ws/terminal";
  }

  wsUrl.searchParams.set("clusterId", target.clusterId);
  wsUrl.searchParams.set("namespace", target.namespace);
  wsUrl.searchParams.set("pod", target.pod);
  wsUrl.searchParams.set("container", target.container);

  return wsUrl.toString();
}

export function buildGatewayWsCandidates(gatewayWsUrl: string): string[] {
  const candidates = new Set<string>();
  const normalizedInput = normalizeToWsProtocol(gatewayWsUrl.trim());
  if (!normalizedInput) {
    return [];
  }

  const addCandidate = (value: string | URL | null | undefined) => {
    if (!value) {
      return;
    }
    try {
      const candidate = typeof value === "string" ? new URL(value) : new URL(value.toString());
      if (candidate.protocol !== "ws:" && candidate.protocol !== "wss:") {
        return;
      }
      candidates.add(candidate.toString());
    } catch {
      // ignore invalid candidate
    }
  };

  let parsed: URL;
  try {
    parsed = new URL(normalizedInput);
    addCandidate(parsed);
  } catch {
    try {
      parsed = new URL(normalizedInput, `${resolveDefaultWsBase()}/ws/terminal`);
      addCandidate(parsed);
    } catch {
      return [];
    }
  }

  if (typeof window === "undefined") {
    return [...candidates];
  }

  const browserWsProtocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const browserHost = window.location.host;
  const browserHostname = window.location.hostname;
  const isBrowserLoopback = loopbackHosts.has(browserHostname);

  if (parsed.protocol !== browserWsProtocol) {
    const protocolFallback = new URL(parsed.toString());
    protocolFallback.protocol = browserWsProtocol;
    addCandidate(protocolFallback);
  }

  const sameOriginPathFallback = new URL(parsed.toString());
  sameOriginPathFallback.protocol = browserWsProtocol;
  sameOriginPathFallback.host = browserHost;
  sameOriginPathFallback.hostname = window.location.hostname;
  sameOriginPathFallback.port = window.location.port;
  addCandidate(sameOriginPathFallback);

  if (browserHostname && !isBrowserLoopback && loopbackHosts.has(parsed.hostname)) {
    const directHostFallback = new URL(parsed.toString());
    directHostFallback.hostname = browserHostname;
    directHostFallback.protocol = browserWsProtocol;
    addCandidate(directHostFallback);
  }

  if (browserHost && !isBrowserLoopback && loopbackHosts.has(parsed.hostname)) {
    const hostFallback = new URL(parsed.toString());
    hostFallback.host = browserHost;
    hostFallback.protocol = browserWsProtocol;
    addCandidate(hostFallback);
  }

  // Only try same-origin fallback when browser is not loopback.
  // On local development, same-origin (localhost:3000) usually has no /ws/terminal proxy.
  if (browserHost && !isBrowserLoopback && parsed.host !== browserHost) {
    const sameOriginFallback = new URL(parsed.toString());
    sameOriginFallback.host = browserHost;
    sameOriginFallback.protocol = browserWsProtocol;
    addCandidate(sameOriginFallback);
  }

  const ordered: string[] = [];
  const pushOrdered = (candidate: URL) => {
    const raw = candidate.toString();
    if (!candidates.has(raw)) {
      return;
    }
    ordered.push(raw);
    candidates.delete(raw);
  };

  if (typeof window !== "undefined") {
    const parsedIsLoopback = loopbackHosts.has(parsed.hostname);
    const browserPreferred = new URL(parsed.toString());
    browserPreferred.protocol = browserWsProtocol;

    if (browserHost) {
      const sameOrigin = new URL(parsed.toString());
      sameOrigin.protocol = browserWsProtocol;
      sameOrigin.host = browserHost;
      pushOrdered(sameOrigin);
    }

    // Local dev: Next websocket rewrite may not be active or stable.
    // When page runs on localhost/127.0.0.1, always keep direct gateway :4100 fallback.
    if (parsedIsLoopback && isBrowserLoopback) {
      const directGateway = new URL(parsed.toString());
      directGateway.protocol = browserWsProtocol;
      directGateway.hostname = browserHostname;
      directGateway.port = DEFAULT_RUNTIME_GATEWAY_PORT;
      pushOrdered(directGateway);
    }

    // Remote browser + loopback gateway URL:
    // always try non-loopback host first, keep loopback last fallback.
    if (browserHostname && !isBrowserLoopback && parsedIsLoopback) {
      const remoteHostWithGatewayPort = new URL(parsed.toString());
      remoteHostWithGatewayPort.protocol = browserWsProtocol;
      remoteHostWithGatewayPort.hostname = browserHostname;
      pushOrdered(remoteHostWithGatewayPort);
    }

    if (browserHost && !isBrowserLoopback && parsedIsLoopback) {
      const sameHostWithPagePort = new URL(parsed.toString());
      sameHostWithPagePort.protocol = browserWsProtocol;
      sameHostWithPagePort.host = browserHost;
      pushOrdered(sameHostWithPagePort);
    }

    if (browserHost && !isBrowserLoopback && parsed.host !== browserHost) {
      const sameOrigin = new URL(parsed.toString());
      sameOrigin.protocol = browserWsProtocol;
      sameOrigin.host = browserHost;
      pushOrdered(sameOrigin);
    }

    if (!parsedIsLoopback || isBrowserLoopback) {
      pushOrdered(browserPreferred);
    }

    if (parsedIsLoopback && !isBrowserLoopback) {
      pushOrdered(browserPreferred);
    }
  }

  for (const leftover of candidates) {
    ordered.push(leftover);
  }
  return ordered;
}

export function redactGatewayWsDisplay(input: string): string {
  const normalizedInput = normalizeToWsProtocol(input.trim());
  if (!normalizedInput) {
    return "";
  }
  try {
    const wsUrl = new URL(normalizedInput);
    const host = loopbackHosts.has(wsUrl.hostname) ? "<loopback>" : wsUrl.host;
    return `${wsUrl.protocol}//${host}${wsUrl.pathname}`;
  } catch {
    return "runtime-gateway";
  }
}

export async function connectWsWithCandidates(
  candidates: string[],
  onSocketReady: (socket: WebSocket) => void,
): Promise<WebSocket> {
  if (candidates.length === 0) {
    throw new Error("未找到可用的 WebSocket 地址");
  }

  let lastError: unknown = null;
  for (const candidate of candidates) {
    try {
      const socket = await connectSingleWsCandidate(candidate, onSocketReady);
      return socket;
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("创建 WebSocket 连接失败");
}

function connectSingleWsCandidate(
  candidate: string,
  onSocketReady: (socket: WebSocket) => void,
): Promise<WebSocket> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const finish = (result: { socket?: WebSocket; error?: Error }) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (result.socket) {
        resolve(result.socket);
      } else {
        reject(result.error ?? new Error("WebSocket 连接失败"));
      }
    };

    let socket: WebSocket;
    try {
      socket = new WebSocket(candidate);
    } catch (error) {
      finish({
        error: error instanceof Error ? error : new Error("创建 WebSocket 连接失败"),
      });
      return;
    }

    onSocketReady(socket);

    timer = setTimeout(() => {
      if (settled) return;
      try {
        socket.close(4000, "connect-timeout");
      } catch {
        // noop
      }
      finish({
        error: new Error(`WebSocket 连接超时：${sanitizeWsUrlForDisplay(candidate)}`),
      });
    }, DEFAULT_WS_CONNECT_TIMEOUT_MS);

    socket.onopen = () => {
      finish({ socket });
    };

    socket.onerror = () => {
      if (settled) {
        return;
      }
      finish({
        error: new Error(`WebSocket 连接失败：${sanitizeWsUrlForDisplay(candidate)}`),
      });
      try {
        socket.close();
      } catch {
        // noop
      }
    };

    socket.onclose = (event) => {
      if (settled) {
        return;
      }
      finish({
        error: new Error(
          `WebSocket 已关闭（code=${event.code}）：${sanitizeWsUrlForDisplay(candidate)}`,
        ),
      });
    };
  });
}

function maskSensitiveValue(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return "***";
  }
  if (trimmed.length <= 12) {
    return "***";
  }
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-3)}`;
}

export function sanitizeWsUrlForDisplay(input: string, maxLength = 180): string {
  const raw = input.trim();
  if (!raw) {
    return "";
  }
  try {
    const parsed = new URL(raw);
    parsed.searchParams.forEach((value, key) => {
      const lowerKey = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.has(lowerKey) || value.length > 32) {
        parsed.searchParams.set(key, maskSensitiveValue(value));
      }
    });
    const next = parsed.toString();
    if (next.length <= maxLength) {
      return next;
    }
    return `${next.slice(0, Math.max(0, maxLength - 3))}...`;
  } catch {
    if (raw.length <= maxLength) {
      return raw;
    }
    return `${raw.slice(0, Math.max(0, maxLength - 3))}...`;
  }
}

export function sanitizeSensitiveMessage(input: string, maxLength = 220): string {
  const raw = input.trim();
  if (!raw) {
    return "";
  }
  const withUrlMasked = raw.replace(/wss?:\/\/[^\s)]+/gi, (segment) =>
    sanitizeWsUrlForDisplay(segment, 200),
  );
  const withTokenMasked = withUrlMasked
    .replace(
      /([?&](?:runtimeToken|token|authorization|access_token|refresh_token|id_token)=)([^&\s]+)/gi,
      (_all, prefix: string, value: string) =>
        `${prefix}${maskSensitiveValue(value)}`,
    )
    .replace(/\b([A-Za-z0-9._-]{64,})\b/g, (token) => maskSensitiveValue(token));
  if (withTokenMasked.length <= maxLength) {
    return withTokenMasked;
  }
  return `${withTokenMasked.slice(0, Math.max(0, maxLength - 3))}...`;
}

function stringifyUnknown(value: unknown): string {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value == null) return "";
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function decodeBase64Text(value?: string): string {
  if (!value) return "";
  try {
    if (typeof window === "undefined") {
      return Buffer.from(value, "base64").toString("utf8");
    }
    const binary = window.atob(value);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder().decode(bytes);
  } catch {
    return "";
  }
}

function parseFrame(frame: ParsedFrame): TerminalParsedMessage {
  const text = decodeBase64Text(frame.contentB64) || stringifyUnknown(frame.content);
  if (text === "\u001bc") {
    return {
      kind: "control",
      text: "",
      state: frame.state,
      code: frame.code,
      control: "clear",
    };
  }

  const kind = frame.type === "stderr" ? "stderr" : frame.type === "stdout" ? "stdout" : "system";
  return {
    kind,
    text,
    state: frame.state,
    code: frame.code,
  };
}

export function parseTerminalMessagePayload(payload: unknown): TerminalParsedMessage {
  if (payload instanceof ArrayBuffer) {
    const text = new TextDecoder().decode(payload);
    if (text === "\u001bc") {
      return { kind: "control", text: "", control: "clear" };
    }
    return { kind: "stdout", text };
  }

  if (typeof payload === "string") {
    try {
      return parseFrame(JSON.parse(payload) as ParsedFrame);
    } catch {
      if (payload === "\u001bc") {
        return { kind: "control", text: "", control: "clear" };
      }
      return { kind: "stdout", text: payload };
    }
  }

  return { kind: "stdout", text: stringifyUnknown(payload) };
}

export function buildTerminalInputPayload(input: string): string {
  return JSON.stringify({
    type: "input",
    input,
  });
}

export function buildTerminalResizePayload(cols: number, rows: number): string {
  return JSON.stringify({
    type: "resize",
    cols: Math.max(1, Math.floor(cols)),
    rows: Math.max(1, Math.floor(rows)),
  });
}

export function buildTerminalPingPayload(): string {
  return JSON.stringify({
    type: "ping",
  });
}
