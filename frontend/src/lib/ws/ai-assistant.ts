import { io, type Socket } from "socket.io-client";
import type { AiConversationMessage, AiConversationSession, AiActionDescriptor } from "@/lib/api/ai-assistant";
import { CONTROL_API_BASE } from "@/lib/api/client";

export type AiStreamHandlers = {
  onDelta: (delta: string) => void;
  onDone: (payload: AiStreamDonePayload) => void;
  onError: (payload: AiStreamErrorPayload) => void;
  onStatus?: (status: "connecting" | "connected" | "disconnected") => void;
};

export type AiStreamDonePayload = {
  requestId?: string;
  sessionId: string;
  user: AiConversationMessage;
  assistant: AiConversationMessage;
  session: AiConversationSession;
  actionDescriptors: AiActionDescriptor[];
};

export type AiStreamErrorPayload = {
  requestId?: string;
  code: string;
  message: string;
};

export type AiStreamSendPayload = {
  requestId: string;
  sessionId: string;
  message: string;
  clusterId?: string;
  namespace?: string;
  resourceKind?: string;
  resourceName?: string;
};

const AI_WS_NAMESPACE = "/ws/ai-assistant";
const PROXY_PATH = "/ai-ws/socketio";
const DIRECT_PATH = "/socket.io";
const loopbackHosts = new Set(["localhost", "127.0.0.1", "::1"]);

function httpToWsProtocol(raw: string): string {
  if (raw.startsWith("https://")) return `wss://${raw.slice("https://".length)}`;
  if (raw.startsWith("http://")) return `ws://${raw.slice("http://".length)}`;
  return raw;
}

/**
 * 计算 socket.io 连接的候选地址。
 *
 * 首选同源代理路径 `/ai-ws/socket.io`（由 Next rewrite 转发到 control-api），
 * 这样在任何访问主机名下都能工作，也不受 CORS 影响。若配置了可直连的
 * control-api 基址，再追加一个直连候选兜底。
 */
export function buildAiAssistantWsCandidates(): string[] {
  const candidates: string[] = [];

  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "https:" : "http:";
    candidates.push(`${protocol}//${window.location.host}`);
  }

  const configured = CONTROL_API_BASE.trim().replace(/\/+$/, "");
  if (configured && /^https?:\/\//i.test(configured)) {
    candidates.push(configured);
  }

  if (typeof window !== "undefined") {
    const hostname = window.location.hostname;
    if (hostname && !loopbackHosts.has(hostname)) {
      // 局域网/内网直连访问时，control-api 默认监听 4000 端口。
      candidates.push(`${window.location.protocol}//${hostname}:4000`);
    }
  }

  return [...new Set(candidates)];
}

export type AiAssistantStreamClient = {
  connected: boolean;
  send: (payload: AiStreamSendPayload) => boolean;
  dispose: () => void;
};

type CreateOptions = {
  token: string;
  handlers: AiStreamHandlers;
};

/**
 * 建立一个 AI 助手流式连接。返回的客户端可在同一条连接上发送多条消息；
 * 连接失败时通过 onStatus('disconnected') 通知调用方回退到非流式 REST 调用。
 */
export function createAiAssistantStreamClient(options: CreateOptions): AiAssistantStreamClient {
  const { token, handlers } = options;
  const candidates = buildAiAssistantWsCandidates();
  let socket: Socket | null = null;
  let disposed = false;
  let candidateIndex = 0;
  let pending: AiStreamSendPayload | null = null;

  const attach = (instance: Socket) => {
    instance.on("connect", () => {
      handlers.onStatus?.("connected");
      if (pending) {
        const payload = pending;
        pending = null;
        instance.emit("chat.send", payload);
      }
    });
    instance.on("disconnect", () => {
      if (!disposed) handlers.onStatus?.("disconnected");
    });
    instance.on("connect_error", () => {
      if (disposed) return;
      // 同源代理不可用时，依次尝试直连候选。
      if (candidateIndex < candidates.length - 1) {
        candidateIndex += 1;
        instance.close();
        connect();
        return;
      }
      handlers.onStatus?.("disconnected");
    });
    instance.on("chat.delta", (frame: { requestId?: string; delta?: string }) => {
      if (typeof frame?.delta === "string" && frame.delta.length > 0) {
        handlers.onDelta(frame.delta);
      }
    });
    instance.on("chat.done", (frame: AiStreamDonePayload) => {
      handlers.onDone(frame);
    });
    instance.on("chat.error", (frame: AiStreamErrorPayload) => {
      handlers.onError(frame);
    });
  };

  const connect = () => {
    if (disposed) return;
    const base = candidates[candidateIndex];
    if (!base) {
      handlers.onStatus?.("disconnected");
      return;
    }
    handlers.onStatus?.("connecting");
    const isSameOrigin = typeof window !== "undefined" && base === `${window.location.protocol}//${window.location.host}`;
    socket = io(`${httpToWsProtocol(base).replace(/\/+$/, "")}${AI_WS_NAMESPACE}`, {
      path: isSameOrigin ? PROXY_PATH : DIRECT_PATH,
      // Next 的 rewrites 会把带尾斜杠的路径 308 重定向，socket.io 的
      // engine.io 握手不接受该跳转，因此固定不带尾斜杠。
      addTrailingSlash: false,
      transports: ["websocket", "polling"],
      auth: { token },
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 6000,
      withCredentials: true,
    });
    attach(socket);
  };

  connect();

  return {
    get connected() {
      return Boolean(socket?.connected);
    },
    send(payload) {
      if (!socket) return false;
      if (!socket.connected) {
        pending = payload;
        return true;
      }
      socket.emit("chat.send", payload);
      return true;
    },
    dispose() {
      disposed = true;
      pending = null;
      socket?.close();
      socket = null;
    },
  };
}
