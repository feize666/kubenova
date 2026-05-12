import {
  connectWsWithCandidates,
  sanitizeSensitiveMessage,
  sanitizeWsUrlForDisplay,
} from "./terminal";

export type LogsConnectionStatus = "未连接" | "连接中" | "重连中" | "已连接" | "连接异常";

export interface RuntimeLogItem {
  id: string;
  text: string;
  ts: number;
  type?: "stdout" | "stderr" | "system";
  state?: string;
  code?: string;
}

interface RuntimeLogsSocketOptions {
  url: string;
  candidates?: string[];
  onStatusChange?: (status: LogsConnectionStatus) => void;
  onLogs?: (items: RuntimeLogItem[]) => void;
  onError?: (error: string) => void;
  onOpen?: () => void;
  onReconnectStateChange?: (state: LogsReconnectState) => void;
  reconnect?: {
    enabled?: boolean;
    initialDelayMs?: number;
    maxDelayMs?: number;
    factor?: number;
    jitterRatio?: number;
    maxAttempts?: number;
  };
}

export interface LogsReconnectState {
  attempt: number;
  maxAttempts: number;
  nextDelayMs: number;
  stopped: boolean;
}

interface RuntimeLogPayload {
  type?: unknown;
  state?: unknown;
  code?: unknown;
  message?: unknown;
  log?: unknown;
  line?: unknown;
  content?: unknown;
  contentB64?: unknown;
  timestamp?: unknown;
  time?: unknown;
}

const MAX_ID_SUFFIX = 1_000_000;

function toText(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value == null) {
    return "";
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function toTimestamp(raw: unknown): number {
  if (typeof raw === "number" && Number.isFinite(raw)) {
    return raw;
  }
  if (typeof raw === "string") {
    const parsed = Date.parse(raw);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }
  return Date.now();
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

function makeLogItem(
  text: string,
  ts: number,
  meta?: Pick<RuntimeLogItem, "type" | "state" | "code">,
): RuntimeLogItem {
  return {
    id: `${ts}-${Math.floor(Math.random() * MAX_ID_SUFFIX)}`,
    text,
    ts,
    ...meta,
  };
}

function parseJsonPayload(payload: RuntimeLogPayload): RuntimeLogItem[] {
  const ts = toTimestamp(payload.timestamp ?? payload.time);
  const candidate =
    payload.message ?? payload.log ?? payload.line ?? payload.content ?? decodeBase64Text(typeof payload.contentB64 === "string" ? payload.contentB64 : undefined);
  const itemType =
    payload.type === "stderr" ? "stderr" : payload.type === "stdout" ? "stdout" : payload.type === "system" ? "system" : undefined;
  const state = typeof payload.state === "string" ? payload.state : undefined;
  const code = typeof payload.code === "string" ? payload.code : undefined;

  if (Array.isArray(candidate)) {
    return candidate
      .map((entry) => makeLogItem(toText(entry), ts, { type: itemType, state, code }))
      .filter((item) => item.text.trim().length > 0);
  }

  const text = toText(candidate);
  if (!text.trim()) {
    return [];
  }

  return text
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0)
    .map((line) => makeLogItem(line, ts, { type: itemType, state, code }));
}

function parseRawMessage(raw: unknown): RuntimeLogItem[] {
  if (raw instanceof ArrayBuffer) {
    return parseRawMessage(new TextDecoder().decode(raw));
  }

  if (typeof raw !== "string") {
    const plain = toText(raw);
    if (!plain.trim()) {
      return [];
    }
    return plain
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => makeLogItem(line, Date.now()));
  }

  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((entry) => makeLogItem(toText(entry), Date.now())).filter((item) => item.text.trim().length > 0);
    }
    if (parsed && typeof parsed === "object") {
      return parseJsonPayload(parsed as RuntimeLogPayload);
    }
    const text = toText(parsed);
    if (!text.trim()) {
      return [];
    }
    return [makeLogItem(text, Date.now())];
  } catch {
    return trimmed
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter((line) => line.length > 0)
      .map((line) => makeLogItem(line, Date.now()));
  }
}

export class RuntimeLogsSocket {
  private ws: WebSocket | null = null;

  private readonly options: RuntimeLogsSocketOptions;

  private hasError = false;

  private manualClose = false;

  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  private reconnectAttempt = 0;

  private reconnecting = false;

  private readonly reconnectEnabled: boolean;

  private readonly reconnectInitialDelayMs: number;

  private readonly reconnectMaxDelayMs: number;

  private readonly reconnectFactor: number;

  private readonly reconnectJitterRatio: number;

  private readonly reconnectMaxAttempts: number;

  private readonly wsCandidates: string[];

  constructor(options: RuntimeLogsSocketOptions) {
    this.options = options;
    const normalizedCandidates = (options.candidates ?? [])
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
    this.wsCandidates = normalizedCandidates.length > 0 ? normalizedCandidates : [options.url.trim()].filter(Boolean);
    this.reconnectEnabled = options.reconnect?.enabled ?? true;
    this.reconnectInitialDelayMs = Math.max(300, options.reconnect?.initialDelayMs ?? 1_000);
    this.reconnectMaxDelayMs = Math.max(this.reconnectInitialDelayMs, options.reconnect?.maxDelayMs ?? 20_000);
    this.reconnectFactor = Math.max(1.1, options.reconnect?.factor ?? 2);
    this.reconnectJitterRatio = Math.min(0.5, Math.max(0, options.reconnect?.jitterRatio ?? 0.2));
    this.reconnectMaxAttempts = Math.max(1, options.reconnect?.maxAttempts ?? 8);
  }

  connect(): void {
    this.connectInternal({ resetReconnectAttempt: true });
  }

  reconnectNow(): void {
    this.connectInternal({ resetReconnectAttempt: true });
  }

  static parseSocketMessage(eventName: string, payload: unknown): RuntimeLogItem[] {
    if (eventName === "logs.ack" || eventName === "runtime.ready" || eventName === "connect" || eventName === "disconnect") {
      return [];
    }
    if (eventName === "runtime.error") {
      const text =
        typeof payload === "object" && payload && !Array.isArray(payload)
          ? toText((payload as { message?: unknown }).message ?? payload)
          : toText(payload);
      if (!text.trim()) {
        return [];
      }
      return [makeLogItem(text, Date.now(), { type: "system" })];
    }
    return parseRawMessage(payload);
  }

  static isTerminalStateMessage(eventName: string): boolean {
    return eventName === "runtime.ready" || eventName === "connect" || eventName === "disconnect" || eventName === "logs.ack";
  }

  private connectInternal(input: { resetReconnectAttempt: boolean }): void {
    this.clearReconnectTimer();
    if (input.resetReconnectAttempt) {
      this.reconnectAttempt = 0;
      this.reconnecting = false;
      this.options.onReconnectStateChange?.({
        attempt: this.reconnectAttempt,
        maxAttempts: this.reconnectMaxAttempts,
        nextDelayMs: 0,
        stopped: false,
      });
    }

    this.options.onError?.("");
    this.options.onStatusChange?.(this.reconnecting ? "重连中" : "连接中");
    this.hasError = false;
    this.manualClose = false;
    this.teardownSocket();

    void this.openWithCandidates();
  }

  private async openWithCandidates(): Promise<void> {
    try {
      const socket = await connectWsWithCandidates(this.wsCandidates, (nextSocket) => {
        this.ws = nextSocket;
      });
      this.ws = socket;
      this.bindSocketEvents(socket);
      this.handleConnected();
    } catch (error) {
      this.handleUnexpectedClose();
      this.options.onError?.(
        sanitizeSensitiveMessage(
          error instanceof Error
            ? error.message
            : "创建 WebSocket 连接失败，请检查服务是否启动",
        ),
      );
    }
  }

  private bindSocketEvents(socket: WebSocket): void {
    socket.onmessage = (event) => {
      if (typeof event.data === "string") {
        try {
          const frame = JSON.parse(event.data) as { event?: unknown; data?: unknown; payload?: unknown; type?: unknown };
          const eventName = typeof frame.event === "string" ? frame.event : typeof frame.type === "string" ? frame.type : "";
          if (eventName && RuntimeLogsSocket.isTerminalStateMessage(eventName)) {
            const payload = frame.data ?? frame.payload;
            const items = RuntimeLogsSocket.parseSocketMessage(eventName, payload);
            if (items.length > 0) {
              this.options.onLogs?.(items);
            }
            return;
          }
          if (eventName) {
            const payload = frame.data ?? frame.payload;
            const items = RuntimeLogsSocket.parseSocketMessage(eventName, payload);
            if (items.length > 0) {
              this.options.onLogs?.(items);
            }
            return;
          }
        } catch {
          // fall back to raw message parsing
        }
      }

      const items = parseRawMessage(event.data);
      if (items.length > 0) {
        this.options.onLogs?.(items);
      }
    };

    socket.onerror = () => {
      this.hasError = true;
      const safeUrl = sanitizeWsUrlForDisplay(socket.url || this.wsCandidates[0] || "");
      this.options.onError?.(`连接发生错误，正在尝试自动重连。目标地址：${safeUrl}`);
    };

    socket.onclose = () => {
      if (this.manualClose) {
        this.options.onStatusChange?.("未连接");
        return;
      }
      this.handleUnexpectedClose();
    };
  }

  private handleConnected(): void {
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnecting = false;
    this.options.onReconnectStateChange?.({
      attempt: 0,
      maxAttempts: this.reconnectMaxAttempts,
      nextDelayMs: 0,
      stopped: false,
    });
    this.options.onStatusChange?.("已连接");
    this.options.onError?.("");
    this.options.onOpen?.();
  }

  disconnect(): void {
    this.manualClose = true;
    this.clearReconnectTimer();
    this.reconnectAttempt = 0;
    this.reconnecting = false;
    this.teardownSocket();
    this.hasError = false;
    this.options.onReconnectStateChange?.({
      attempt: 0,
      maxAttempts: this.reconnectMaxAttempts,
      nextDelayMs: 0,
      stopped: true,
    });
    this.options.onStatusChange?.("未连接");
    this.options.onError?.("");
  }

  send(payload: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      return;
    }
    this.ws.send(payload);
  }

  private handleUnexpectedClose(): void {
    if (!this.reconnectEnabled) {
      this.options.onStatusChange?.("连接异常");
      this.options.onError?.("连接已断开，请点击“重新接入”或退出");
      return;
    }
    if (this.reconnectAttempt >= this.reconnectMaxAttempts) {
      this.options.onReconnectStateChange?.({
        attempt: this.reconnectAttempt,
        maxAttempts: this.reconnectMaxAttempts,
        nextDelayMs: 0,
        stopped: true,
      });
      this.options.onStatusChange?.("连接异常");
      this.options.onError?.("自动重连次数已达上限，请手动重试或退出");
      return;
    }

    this.reconnectAttempt += 1;
    this.reconnecting = true;
    const delay = this.getReconnectDelay(this.reconnectAttempt);
    this.options.onStatusChange?.("重连中");
    this.options.onReconnectStateChange?.({
      attempt: this.reconnectAttempt,
      maxAttempts: this.reconnectMaxAttempts,
      nextDelayMs: delay,
      stopped: false,
    });
    this.options.onError?.(`连接已断开，${Math.ceil(delay / 1000)} 秒后第 ${this.reconnectAttempt} 次重连`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connectInternal({ resetReconnectAttempt: false });
    }, delay);
  }

  private getReconnectDelay(attempt: number): number {
    const raw = this.reconnectInitialDelayMs * Math.pow(this.reconnectFactor, Math.max(0, attempt - 1));
    const capped = Math.min(this.reconnectMaxDelayMs, raw);
    const jitter = 1 + (Math.random() * 2 - 1) * this.reconnectJitterRatio;
    return Math.max(200, Math.floor(capped * jitter));
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer != null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private teardownSocket(): void {
    if (!this.ws) {
      return;
    }
    this.ws.onopen = null;
    this.ws.onmessage = null;
    this.ws.onerror = null;
    this.ws.onclose = null;
    this.ws.close();
    this.ws = null;
  }
}

function resolveDefaultLogsWsUrl(): string {
  if (typeof window === "undefined") {
    return "ws://127.0.0.1:4100/ws/logs";
  }
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/ws/logs`;
}

export const RUNTIME_LOGS_WS_URL = resolveDefaultLogsWsUrl();

export function createRuntimeLogsSubscribePayload(input: {
  tailLines?: number;
  sinceSeconds?: number;
  keyword?: string;
  level?: string;
}): string {
  const payload: Record<string, number | string> = {};
  if (typeof input.tailLines === "number" && Number.isFinite(input.tailLines) && input.tailLines > 0) {
    payload.tailLines = Math.floor(input.tailLines);
  }
  if (typeof input.sinceSeconds === "number" && Number.isFinite(input.sinceSeconds) && input.sinceSeconds > 0) {
    payload.sinceSeconds = Math.floor(input.sinceSeconds);
  }
  if (typeof input.keyword === "string" && input.keyword.trim()) {
    payload.keyword = input.keyword.trim();
  }
  if (typeof input.level === "string" && input.level.trim()) {
    payload.level = input.level.trim();
  }
  return JSON.stringify({
    type: "subscribe",
    ...payload,
  });
}
