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
    const browserPreferred = new URL(parsed.toString());
    browserPreferred.protocol = browserWsProtocol;
    pushOrdered(browserPreferred);

    if (browserHostname && !isBrowserLoopback && loopbackHosts.has(parsed.hostname)) {
      const remoteHostWithGatewayPort = new URL(parsed.toString());
      remoteHostWithGatewayPort.protocol = browserWsProtocol;
      remoteHostWithGatewayPort.hostname = browserHostname;
      pushOrdered(remoteHostWithGatewayPort);
    }

    if (browserHost && !isBrowserLoopback && loopbackHosts.has(parsed.hostname)) {
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
  }

  for (const leftover of candidates) {
    ordered.push(leftover);
  }
  return ordered;
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
