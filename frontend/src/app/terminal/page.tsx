"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ArrowLeftOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { App, Button, Select, Space, Tooltip, Typography, theme } from "antd";
import { ApiError } from "@/lib/api/client";
import { getClusters } from "@/lib/api/clusters";
import { createRuntimeSession, resolveSafeRuntimeReturnTo, type CreateRuntimeSessionResponse } from "@/lib/api/runtime";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  buildTerminalInputPayload,
  buildTerminalPingPayload,
  buildTerminalResizePayload,
  buildGatewayWsCandidates,
  connectWsWithCandidates,
  parseTerminalMessagePayload,
  redactGatewayWsDisplay,
  sanitizeSensitiveMessage,
  sanitizeWsUrlForDisplay,
  type TerminalConnectionStatus,
  type TerminalParsedMessage,
} from "@/lib/ws/terminal";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsFrameShell, OpsStatusTag, type OpsFrameShellState, type OpsStatusTone } from "@/components/ops";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";

type RuntimeSessionView = {
  sessionId?: string;
  gatewayWsUrl: string;
  expiresAtMs?: number;
  reconnectable?: boolean;
  sessionState?: "ready" | "expired" | "closed";
  target?: CreateRuntimeSessionResponse["target"];
};

type SessionCache = RuntimeSessionView & {
  cacheKey: string;
};

type TerminalVisualState = TerminalConnectionStatus | "expired" | "non-reconnectable" | "error";

const VISUAL_STATUS_LABEL: Record<TerminalVisualState, string> = {
  connecting: "连接中",
  connected: "已连接",
  disconnected: "已断开",
  expired: "已过期",
  "non-reconnectable": "不可重连",
  error: "异常",
};

const VISUAL_STATUS_TONE: Record<TerminalVisualState, OpsStatusTone> = {
  connecting: "processing",
  connected: "success",
  disconnected: "neutral",
  expired: "danger",
  "non-reconnectable": "warning",
  error: "danger",
};

const VISUAL_FRAME_STATE: Record<TerminalVisualState, OpsFrameShellState> = {
  connecting: "connecting",
  connected: "connected",
  disconnected: "disconnected",
  expired: "expired",
  "non-reconnectable": "paused",
  error: "error",
};

const MAX_RECONNECTS = 12;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_JITTER_RATIO = 0.2;
const CONNECT_TIMEOUT_MS = 10000;
const SESSION_RENEW_WINDOW_MS = 60000;
const HEARTBEAT_INTERVAL_MS = 20000;

class RuntimeConnectError extends Error {
  readonly blockReconnect: boolean;

  constructor(message: string, blockReconnect = false) {
    super(message);
    this.name = "RuntimeConnectError";
    this.blockReconnect = blockReconnect;
  }
}

function parseExpiry(expiresAt?: string): number | undefined {
  if (!expiresAt) return undefined;
  const value = Date.parse(expiresAt);
  return Number.isNaN(value) ? undefined : value;
}

function formatExpiry(expiresAtMs?: number): string {
  if (!expiresAtMs) return "未返回";
  const diff = expiresAtMs - Date.now();
  if (diff <= 0) return "已过期";
  const minutes = Math.floor(diff / 60000);
  const seconds = Math.floor((diff % 60000) / 1000);
  return `${minutes}m ${seconds}s`;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

function normalizeRuntimeError(code?: string, fallback?: string): { text: string; blockReconnect: boolean } {
  const normalized = (code ?? "").trim();
  const lowered = normalized.toLowerCase();

  if (lowered.includes("session_not_found") || lowered.includes("session_closed") || lowered.includes("会话不存在")) {
    return { text: "终端会话不存在或已关闭，请重新从资源页进入终端。", blockReconnect: true };
  }
  if (lowered.includes("expired") || lowered.includes("已过期")) {
    return { text: "终端会话已过期，请重新创建终端会话。", blockReconnect: true };
  }
  if (lowered.includes("container_not_found") || (lowered.includes("容器") && lowered.includes("不存在"))) {
    return { text: "目标容器不存在，请切换到有效容器后重试。", blockReconnect: true };
  }
  if (lowered.includes("pod_not_found") || (lowered.includes("pod") && lowered.includes("不存在"))) {
    return { text: "目标 Pod 不存在或已重建，请回到资源页重新进入终端。", blockReconnect: true };
  }
  if (lowered.includes("kubeconfig_invalid") || (lowered.includes("kubeconfig") && lowered.includes("invalid"))) {
    return { text: "集群接入凭据无效，请修复后再重试终端连接。", blockReconnect: true };
  }
  if (lowered.includes("auth") || lowered.includes("token") || lowered.includes("unauthorized")) {
    return { text: "终端鉴权失败，请重新登录并重新创建终端会话。", blockReconnect: true };
  }
  if (normalized === "RUNTIME_GATEWAY_BOOTSTRAP_FAILED") {
    return { text: "终端服务初始化失败，请稍后重试。", blockReconnect: false };
  }

  return { text: fallback || "终端连接失败，请稍后重试。", blockReconnect: false };
}

function mapCloseError(input: {
  code: number;
  reason?: string;
  targetWsUrl: string;
  expiresAtMs?: number;
}): { text: string; blockReconnect: boolean } {
  const { code, reason, targetWsUrl, expiresAtMs } = input;
  const safeWsUrl = redactGatewayWsDisplay(targetWsUrl);

  if (reason?.trim()) {
    const mapped = normalizeRuntimeError(reason, reason);
    if (mapped.text !== reason) {
      return mapped;
    }
  }
  if (expiresAtMs && expiresAtMs <= Date.now()) {
    return { text: "终端会话已过期，请重新创建终端会话。", blockReconnect: true };
  }
  if (code === 1006) {
    return {
      text: `终端连接超时，请检查网络后重试。目标地址：${safeWsUrl}`,
      blockReconnect: false,
    };
  }
  if (code === 1008) {
    return { text: "终端鉴权失败（1008），请重新登录后重试。", blockReconnect: true };
  }
  if (code === 1013) {
    return { text: "终端服务暂不可用，请稍后重试。", blockReconnect: false };
  }

  return { text: `终端连接已断开（code=${code}），请重新连接。`, blockReconnect: false };
}

export default function TerminalPage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const searchParams = useSearchParams();
  const clustersQuery = useQuery({
    queryKey: ["clusters", "list", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const [status, setStatus] = useState<TerminalConnectionStatus>("disconnected");
  const [sessionInfo, setSessionInfo] = useState<RuntimeSessionView | null>(null);
  const [selectedContainer, setSelectedContainer] = useState(searchParams.get("container")?.trim() || "");
  const [lastWarning, setLastWarning] = useState<string>("");

  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const sessionCacheRef = useRef<SessionCache | null>(null);
  const generationRef = useRef(0);
  const connectingRef = useRef(false);
  const manualDisconnectRef = useRef(false);
  const blockReconnectRef = useRef(false);
  const reconnectCountRef = useRef(0);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const connectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const heartbeatTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const connectTerminalRef = useRef<((options?: { forceNewSession?: boolean; isAutoReconnect?: boolean; userInitiated?: boolean }) => Promise<void>) | null>(null);
  const lastToastAtRef = useRef<Record<string, number>>({});
  const hasConnectedNoticeRef = useRef(false);
  const allowConnectedToastRef = useRef(false);
  const attemptUserInitiatedRef = useRef(false);

  const targetBase = useMemo(
    () => ({
      clusterId: searchParams.get("clusterId")?.trim() || "",
      namespace: searchParams.get("namespace")?.trim() || "",
      pod: searchParams.get("pod")?.trim() || "",
    }),
    [searchParams],
  );
  const clusterNameHint =
    searchParams.get("clusterName")?.trim() ||
    searchParams.get("returnClusterName")?.trim() ||
    "";
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const clusterDisplayName = useMemo(
    () => getClusterDisplayName(clusterMap, targetBase.clusterId, clusterNameHint),
    [clusterMap, clusterNameHint, targetBase.clusterId],
  );
  const fromPage = searchParams.get("from") ?? "";
  const returnTo = searchParams.get("returnTo")?.trim() ?? "";
  const returnClusterId = searchParams.get("returnClusterId")?.trim() ?? "";
  const returnNamespace = searchParams.get("returnNamespace")?.trim() ?? "";
  const returnKeyword = searchParams.get("returnKeyword")?.trim() ?? "";
  const returnPhase = searchParams.get("returnPhase")?.trim() ?? "";
  const returnPage = searchParams.get("returnPage")?.trim() ?? "";

  const missingParams = useMemo(
    () =>
      [
        ["clusterId", targetBase.clusterId],
        ["namespace", targetBase.namespace],
        ["pod", targetBase.pod],
        ["container", selectedContainer],
      ]
        .filter(([, value]) => !value)
        .map(([key]) => key),
    [selectedContainer, targetBase.clusterId, targetBase.namespace, targetBase.pod],
  );

  const targetKey = useMemo(
    () => [targetBase.clusterId, targetBase.namespace, targetBase.pod, selectedContainer].join("|"),
    [selectedContainer, targetBase.clusterId, targetBase.namespace, targetBase.pod],
  );

  const availableContainers = sessionInfo?.target?.availableContainers ?? (selectedContainer ? [selectedContainer] : []);
  const podPhase = sessionInfo?.target?.podPhase;
  const sourceLabel = fromPage || "手动打开";

  const fallbackReturnTo = useMemo(() => {
    const safeReturnTo = resolveSafeRuntimeReturnTo(returnTo);
    if (safeReturnTo) {
      return safeReturnTo;
    }
    const params = new URLSearchParams();
    const clusterId = returnClusterId || targetBase.clusterId;
    const namespace = returnNamespace || targetBase.namespace;
    const keyword = returnKeyword || targetBase.pod;
    if (clusterId) params.set("clusterId", clusterId);
    if (namespace) params.set("namespace", namespace);
    if (keyword) params.set("keyword", keyword);
    if (returnPhase) params.set("phase", returnPhase);
    const pageNumber = Number.parseInt(returnPage, 10);
    if (Number.isFinite(pageNumber) && pageNumber > 0) {
      params.set("page", String(pageNumber));
    }
    return `/workloads/pods${params.toString() ? `?${params.toString()}` : ""}`;
  }, [
    returnClusterId,
    returnKeyword,
    returnNamespace,
    returnPage,
    returnPhase,
    returnTo,
    targetBase.clusterId,
    targetBase.namespace,
    targetBase.pod,
  ]);

  const writeTerminal = (text: string) => {
    const terminal = terminalRef.current;
    if (!terminal || !text) return;
    terminal.write(text);
  };

  const writeSystemLine = (text: string) => {
    if (!text) return;
    const terminal = terminalRef.current;
    if (!terminal) return;
    terminal.writeln(text.replace(/\n/g, "\r\n"));
  };

  const clearReconnectTimer = () => {
    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }
  };

  const clearConnectTimeout = () => {
    if (connectTimeoutRef.current) {
      clearTimeout(connectTimeoutRef.current);
      connectTimeoutRef.current = null;
    }
  };

  const clearHeartbeatTimer = () => {
    if (heartbeatTimerRef.current) {
      clearInterval(heartbeatTimerRef.current);
      heartbeatTimerRef.current = null;
    }
  };

  const startHeartbeat = () => {
    clearHeartbeatTimer();
    heartbeatTimerRef.current = setInterval(() => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(buildTerminalPingPayload());
    }, HEARTBEAT_INTERVAL_MS);
  };

  const closeSocketSilently = (socket: WebSocket | null) => {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
  };

  const openGatewaySocket = async (
    gatewayWsUrl: string,
    onSocketReady: (socket: WebSocket) => void,
  ): Promise<WebSocket> => {
    const candidates = buildGatewayWsCandidates(gatewayWsUrl);
    return connectWsWithCandidates(candidates, onSocketReady);
  };

  const sessionAlmostExpired = (expiresAtMs?: number) => {
    if (!expiresAtMs) return false;
    return expiresAtMs - Date.now() <= SESSION_RENEW_WINDOW_MS;
  };

  const focusTerminal = () => {
    terminalRef.current?.focus();
  };

  const fitTerminal = () => {
    fitAddonRef.current?.fit();
    const terminal = terminalRef.current;
    const socket = wsRef.current;
    if (!terminal || !socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(buildTerminalResizePayload(terminal.cols, terminal.rows));
  };

  const readSession = async (forceNewSession = false) => {
    const cached = sessionCacheRef.current;
    if (!forceNewSession && cached && cached.cacheKey === targetKey && !sessionAlmostExpired(cached.expiresAtMs)) {
      return cached;
    }

    const session = await createRuntimeSession(
      {
        type: "terminal",
        clusterId: targetBase.clusterId,
        namespace: targetBase.namespace,
        pod: targetBase.pod,
        container: selectedContainer,
      },
      accessToken as string,
    );

    const nextSession: SessionCache = {
      sessionId: session.sessionId,
      gatewayWsUrl: session.gatewayWsUrl,
      expiresAtMs: parseExpiry(session.expiresAt),
      reconnectable: session.reconnectable,
      sessionState: session.sessionState,
      target: session.target,
      cacheKey: targetKey,
    };
    sessionCacheRef.current = nextSession;
    return nextSession;
  };

  const scheduleReconnect = () => {
    if (manualDisconnectRef.current || blockReconnectRef.current) return;
    if (reconnectCountRef.current >= MAX_RECONNECTS) {
      setLastWarning("自动重连已达到上限，请手动重新连接。");
      return;
    }
    const attempt = reconnectCountRef.current + 1;
    reconnectCountRef.current = attempt;
    const baseDelayMs = Math.min(MAX_RECONNECT_DELAY_MS, INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1));
    const jitterFactor = 1 + (Math.random() * 2 - 1) * RECONNECT_JITTER_RATIO;
    const delayMs = Math.max(300, Math.floor(baseDelayMs * jitterFactor));
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      void connectTerminal({ isAutoReconnect: true, userInitiated: false });
    }, delayMs);
  };

  const disconnectTerminal = (showToast = false) => {
    clearReconnectTimer();
    clearConnectTimeout();
    clearHeartbeatTimer();
    reconnectCountRef.current = 0;
    manualDisconnectRef.current = true;
    blockReconnectRef.current = true;
    connectingRef.current = false;
    generationRef.current += 1;
    closeSocketSilently(wsRef.current);
    wsRef.current = null;
    setStatus("disconnected");
    if (showToast) {
      message.info("终端已断开");
    }
  };

  const handleDisconnectAndReturn = () => {
    disconnectTerminal(true);
    if (fallbackReturnTo) {
      router.replace(fallbackReturnTo);
    }
  };

  const explainCreateError = (error: unknown): RuntimeConnectError => {
    if (error instanceof ApiError) {
      const mapped = normalizeRuntimeError(error.code, sanitizeSensitiveMessage(error.message || "创建运行时会话失败"));
      return new RuntimeConnectError(mapped.text, mapped.blockReconnect);
    }
    if (error instanceof RuntimeConnectError) {
      return error;
    }
    if (error instanceof Error && error.message) {
      return new RuntimeConnectError(sanitizeSensitiveMessage(error.message));
    }
    return new RuntimeConnectError("创建运行时会话失败，请稍后重试");
  };

  const handleParsedMessage = (parsed: TerminalParsedMessage) => {
    if (parsed.control === "clear") {
      terminalRef.current?.clear();
      return;
    }
    if (parsed.kind === "system") {
      if (parsed.state === "connecting" || parsed.state === "connected" || parsed.state === "disconnected") {
        setStatus(parsed.state);
      }
      if (parsed.state === "error") {
        const mapped = normalizeRuntimeError(parsed.code, parsed.text);
        if (mapped.blockReconnect) {
          blockReconnectRef.current = true;
        }
        setLastWarning(mapped.text);
        setStatus("disconnected");
        if (attemptUserInitiatedRef.current) {
          const codeKey = (parsed.code || mapped.text || "runtime-error").toLowerCase();
          toastOnce(`runtime-error-${codeKey}`, "error", mapped.text);
        }
        return;
      }
      if (parsed.text) {
        writeSystemLine(parsed.text);
      }
      return;
    }

    if (parsed.text) {
      writeTerminal(parsed.text);
    }
  };

  const toastOnce = (
    key: string,
    kind: "success" | "error" | "warning" | "info",
    text: string,
    windowMs = 5000,
  ) => {
    const now = Date.now();
    const last = lastToastAtRef.current[key] ?? 0;
    if (now - last < windowMs) {
      return;
    }
    lastToastAtRef.current[key] = now;
    if (kind === "success") message.success(text);
    if (kind === "error") message.error(text);
    if (kind === "warning") message.warning(text);
    if (kind === "info") message.info(text);
  };

  const connectTerminal = async (options?: { forceNewSession?: boolean; isAutoReconnect?: boolean; userInitiated?: boolean }) => {
    const { forceNewSession = false, isAutoReconnect = false, userInitiated = false } = options ?? {};
    if (connectingRef.current || status === "connecting") return;
    if (isInitializing) {
      if (userInitiated) {
        toastOnce("auth-loading", "info", "认证信息加载中，请稍后重试");
      }
      return;
    }
    if (!accessToken) {
      if (userInitiated) {
        toastOnce("auth-missing", "warning", "请先登录后再连接终端");
      }
      return;
    }
    if (missingParams.length > 0) {
      if (userInitiated) {
        toastOnce("params-missing", "warning", `缺少连接参数：${missingParams.join(", ")}`);
      }
      return;
    }

    const currentGeneration = ++generationRef.current;
    const isCurrent = () => currentGeneration === generationRef.current;

    connectingRef.current = true;
    manualDisconnectRef.current = false;
    attemptUserInitiatedRef.current = userInitiated && !isAutoReconnect;
    if (attemptUserInitiatedRef.current) {
      allowConnectedToastRef.current = true;
      hasConnectedNoticeRef.current = false;
    }
    try {
      if (!isAutoReconnect) {
        clearReconnectTimer();
        reconnectCountRef.current = 0;
        blockReconnectRef.current = false;
      }

      closeSocketSilently(wsRef.current);
      wsRef.current = null;
      setStatus("connecting");
      setLastWarning("");
      writeSystemLine(isAutoReconnect ? "正在执行自动重连..." : "正在准备运行时会话...");

      const session = await readSession(forceNewSession);
      if (!isCurrent()) return;
      setSessionInfo(session);

      const socket = await openGatewaySocket(session.gatewayWsUrl, (nextSocket) => {
        nextSocket.binaryType = "arraybuffer";
        wsRef.current = nextSocket;
      });
      if (!isCurrent()) return;
      clearConnectTimeout();
      connectTimeoutRef.current = setTimeout(() => {
        if (!isCurrent() || socket.readyState !== WebSocket.CONNECTING) return;
        socket.close(4000, "connect-timeout");
      }, CONNECT_TIMEOUT_MS);

      let openHandled = false;
      const handleOpen = () => {
        if (openHandled) return;
        openHandled = true;
        if (!isCurrent()) return;
        clearConnectTimeout();
        clearReconnectTimer();
        reconnectCountRef.current = 0;
        setStatus("connected");
        connectingRef.current = false;
        startHeartbeat();
        writeSystemLine("终端连接已建立，等待容器输出。");
        if (allowConnectedToastRef.current && !hasConnectedNoticeRef.current) {
          hasConnectedNoticeRef.current = true;
          allowConnectedToastRef.current = false;
          toastOnce("terminal-connected", "success", "终端已连接");
        }
        focusTerminal();
        requestAnimationFrame(() => fitTerminal());
      };
      socket.onopen = handleOpen;
      if (socket.readyState === WebSocket.OPEN) {
        handleOpen();
      }

      socket.onmessage = (event) => {
        if (!isCurrent()) return;
        if (event.data instanceof ArrayBuffer) {
          const text = new TextDecoder().decode(event.data);
          writeTerminal(text);
          return;
        }
        if (typeof Blob !== "undefined" && event.data instanceof Blob) {
          event.data.arrayBuffer().then((buffer) => {
            writeTerminal(new TextDecoder().decode(buffer));
          });
          return;
        }
        handleParsedMessage(parseTerminalMessagePayload(event.data));
      };

      socket.onerror = () => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        const safeWsUrl = redactGatewayWsDisplay(socket.url || session.gatewayWsUrl);
        setLastWarning(`连接发生错误，等待关闭事件确认失败原因。目标地址：${safeWsUrl}`);
      };

      socket.onclose = (event) => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        clearHeartbeatTimer();
        wsRef.current = null;
        setStatus("disconnected");

        if (manualDisconnectRef.current) {
          manualDisconnectRef.current = false;
          connectingRef.current = false;
          return;
        }

        sessionCacheRef.current = null;
        const mapped = mapCloseError({
          code: event.code,
          reason: event.reason,
          targetWsUrl: socket.url || session.gatewayWsUrl,
          expiresAtMs: session.expiresAtMs,
        });
        setLastWarning(mapped.text);
        writeSystemLine(mapped.text);
        if (mapped.blockReconnect) {
          blockReconnectRef.current = true;
          if (userInitiated) {
            const closeErrorKey = `close-${event.code}-${(event.reason || "unknown").toLowerCase()}`;
            toastOnce(`runtime-error-${closeErrorKey}`, "error", mapped.text);
          }
        }
        connectingRef.current = false;
        if (!blockReconnectRef.current) {
          scheduleReconnect();
        }
      };
      } catch (error) {
      if (!isCurrent()) return;
      clearConnectTimeout();
      clearHeartbeatTimer();
      setStatus("disconnected");
      wsRef.current = null;
      sessionCacheRef.current = null;
      const explained = explainCreateError(error);
      const safeMessage = sanitizeSensitiveMessage(explained.message);
      setLastWarning(safeMessage);
      writeSystemLine(safeMessage);
      if (userInitiated) {
        toastOnce(`create-error-${safeMessage}`, "error", safeMessage);
      }
      connectingRef.current = false;
      if (explained.blockReconnect) {
        blockReconnectRef.current = true;
      } else {
        scheduleReconnect();
      }
    }
  };
  connectTerminalRef.current = connectTerminal;

  const clearTerminal = () => {
    terminalRef.current?.clear();
    message.success("终端已清屏");
    focusTerminal();
  };

  const copyTerminal = async () => {
    try {
      const terminal = terminalRef.current;
      if (!terminal) throw new Error("terminal unavailable");
      terminal.selectAll();
      const all = terminal.getSelection();
      terminal.clearSelection();
      await navigator.clipboard.writeText(all);
      message.success("终端内容已复制");
      focusTerminal();
    } catch {
      message.error("复制失败，请检查浏览器权限");
    }
  };

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host || terminalRef.current) return;
    const terminalBackground = readCssVar("--ops-terminal-bg", "#061120");
    const terminalForeground = readCssVar("--ops-terminal-fg", "#eef6ff");
    const terminalSelection = readCssVar("--ops-terminal-selection", "rgba(56, 189, 248, 0.45)");
    const statusInfo = readCssVar("--ops-status-info-text", "#38bdf8");

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: token.fontFamilyCode,
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: terminalBackground,
        foreground: terminalForeground,
        cursor: statusInfo,
        cursorAccent: terminalBackground,
        selectionBackground: terminalSelection,
        black: "#020617",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#f59e0b",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc",
      },
    });
    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(host);
    fitAddon.fit();
    terminal.writeln("Terminal Workspace 已初始化，等待会话建立...");
    terminal.onData((input) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(buildTerminalInputPayload(input));
    });
    terminal.onResize(({ cols, rows }) => {
      const socket = wsRef.current;
      if (!socket || socket.readyState !== WebSocket.OPEN) return;
      socket.send(buildTerminalResizePayload(cols, rows));
    });

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    let rafId = 0;
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            if (rafId) cancelAnimationFrame(rafId);
            rafId = requestAnimationFrame(() => {
              fitTerminal();
            });
          })
        : null;
    resizeObserver?.observe(host);

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      resizeObserver?.disconnect();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
    };
  }, [token.fontFamilyCode]);

  useEffect(() => {
    setSelectedContainer(searchParams.get("container")?.trim() || "");
  }, [searchParams]);

  useEffect(() => {
    clearReconnectTimer();
    clearConnectTimeout();
    generationRef.current += 1;
    connectingRef.current = false;
    sessionCacheRef.current = null;
    closeSocketSilently(wsRef.current);
    wsRef.current = null;
    setStatus("disconnected");
    setSessionInfo(null);
    setLastWarning("");
    hasConnectedNoticeRef.current = false;
    terminalRef.current?.clear();
    terminalRef.current?.writeln("正在准备运行时会话...");
  }, [targetKey]);

  useEffect(() => {
    if (isInitializing || !accessToken || missingParams.length > 0 || !terminalRef.current) {
      return;
    }
    void connectTerminalRef.current?.();
  }, [accessToken, isInitializing, missingParams.length, targetKey]);

  useEffect(() => {
    if (status === "connected") {
      focusTerminal();
    }
  }, [status]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const handleWindowResize = () => fitTerminal();
    const handleVisibility = () => {
      if (document.visibilityState === "visible" && status === "connected") {
        fitTerminal();
        focusTerminal();
        if (wsRef.current?.readyState === WebSocket.OPEN) {
          wsRef.current.send(buildTerminalPingPayload());
        }
      }
    };
    window.addEventListener("resize", handleWindowResize);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [status]);

  useEffect(() => {
    return () => {
      clearReconnectTimer();
      clearConnectTimeout();
      clearHeartbeatTimer();
      generationRef.current += 1;
      manualDisconnectRef.current = true;
      blockReconnectRef.current = true;
      closeSocketSilently(wsRef.current);
      wsRef.current = null;
    };
  }, []);

  const missingText = missingParams.length
    ? `缺少连接参数：${missingParams.join("、")}。请从资源页面点击“进入终端”，或补全 ?clusterId=&namespace=&pod=&container=`
    : "";
  const isExpiredVisual =
    sessionInfo?.sessionState === "expired" ||
    (sessionInfo?.expiresAtMs ? sessionInfo.expiresAtMs <= Date.now() : false) ||
    lastWarning.includes("已过期");
  const isNonReconnectableVisual = sessionInfo?.reconnectable === false;
  const visualState: TerminalVisualState = isExpiredVisual
    ? "expired"
    : lastWarning
      ? "error"
      : isNonReconnectableVisual
        ? "non-reconnectable"
        : status;
  const visualTone = VISUAL_STATUS_TONE[visualState];
  const visualToneClass =
    visualTone === "success"
      ? "success"
      : visualTone === "warning"
        ? "warning"
        : visualTone === "danger"
          ? "danger"
          : visualTone === "processing"
            ? "processing"
            : "neutral";
  const gatewayLabel = sessionInfo?.gatewayWsUrl ? "已绑定" : "未创建";
  const reconnectLocked = blockReconnectRef.current || isNonReconnectableVisual || isExpiredVisual;

  return (
    <>
      <OpsFrameShell
        className="terminal-workbench-shell"
        bodyClassName="terminal-workbench-body"
        state={VISUAL_FRAME_STATE[visualState]}
        title="Terminal Workbench"
        subtitle={`${clusterDisplayName} / ${targetBase.namespace || "-"} / ${targetBase.pod || "-"} · 来源 ${sourceLabel}`}
        status={<OpsStatusTag tone={visualTone}>{VISUAL_STATUS_LABEL[visualState]}</OpsStatusTag>}
        toolbar={(
          <Space wrap size={8} className="terminal-workbench-toolbar">
            <Select
              value={selectedContainer || undefined}
              className="terminal-workbench-container-select"
              placeholder="选择容器"
              options={availableContainers.map((container) => ({ label: container, value: container }))}
              onChange={(value) => setSelectedContainer(value)}
            />
            <Tooltip title="新建会话">
              <Button
                icon={<ReloadOutlined />}
                onClick={() => void connectTerminal({ forceNewSession: true, userInitiated: true })}
                disabled={status === "connecting" || missingParams.length > 0}
              >
                新建会话
              </Button>
            </Tooltip>
            <Tooltip title="断开终端连接">
              <Button onClick={() => disconnectTerminal(true)}>断开</Button>
            </Tooltip>
            <Tooltip title="退出终端">
              <Button danger icon={<ArrowLeftOutlined />} onClick={() => handleDisconnectAndReturn()}>
                退出
              </Button>
            </Tooltip>
            <Tooltip title="清屏">
              <Button icon={<ColumnWidthOutlined />} onClick={clearTerminal}>
                清屏
              </Button>
            </Tooltip>
            <Tooltip title="复制终端内容">
              <Button icon={<CopyOutlined />} onClick={copyTerminal}>
                复制
              </Button>
            </Tooltip>
          </Space>
        )}
        chips={(
          <>
            <OpsFilterChip tone={visualTone === "danger" ? "danger" : visualTone === "warning" ? "warning" : visualTone === "success" ? "success" : "info"}>
              连接 {VISUAL_STATUS_LABEL[visualState]}
            </OpsFilterChip>
            <OpsFilterChip tone="neutral">Cluster {clusterDisplayName}</OpsFilterChip>
            <OpsFilterChip tone="neutral">Namespace {targetBase.namespace || "-"}</OpsFilterChip>
            <OpsFilterChip tone="neutral">Pod {targetBase.pod || "-"}</OpsFilterChip>
            <OpsFilterChip tone="neutral">Container {selectedContainer || "-"}</OpsFilterChip>
            <Tooltip title={sessionInfo?.gatewayWsUrl ? sanitizeWsUrlForDisplay(sessionInfo.gatewayWsUrl) : "未创建"}>
              <OpsFilterChip tone={sessionInfo?.gatewayWsUrl ? "success" : "info"}>Gateway {gatewayLabel}</OpsFilterChip>
            </Tooltip>
            <OpsFilterChip tone={isExpiredVisual ? "danger" : "neutral"}>TTL {formatExpiry(sessionInfo?.expiresAtMs)}</OpsFilterChip>
            <OpsFilterChip tone={sessionInfo?.sessionId ? "neutral" : "info"}>
              Session {sessionInfo?.sessionId ? sessionInfo.sessionId.slice(0, 8) : "未创建"}
            </OpsFilterChip>
            {reconnectLocked ? <OpsFilterChip tone="warning">不可重连</OpsFilterChip> : null}
            {podPhase ? <OpsFilterChip tone={podPhase === "Running" ? "success" : "warning"}>Pod {podPhase}</OpsFilterChip> : null}
          </>
        )}
        warning={missingParams.length > 0 ? <Typography.Text>{missingText}</Typography.Text> : null}
        error={lastWarning ? <Typography.Text>{lastWarning}</Typography.Text> : null}
      >
        <div className={`terminal-workbench-stage terminal-workbench-stage--${visualState}`}>
          <div className="terminal-workbench-titlebar">
            <div className="terminal-workbench-title-group">
              <span className="terminal-workbench-dot terminal-workbench-dot--warn" />
              <span className="terminal-workbench-dot terminal-workbench-dot--success" />
              <span className="terminal-workbench-dot terminal-workbench-dot--info" />
              <Typography.Text className="terminal-workbench-title">
                {clusterDisplayName} · {targetBase.pod || "terminal"}.{targetBase.namespace || "default"}
              </Typography.Text>
            </div>
            <div className="terminal-workbench-live-state">
              {visualState === "connecting" ? <LoadingOutlined className="terminal-workbench-status-icon terminal-workbench-status-icon--processing" /> : null}
              {visualState === "connected" ? <CheckCircleOutlined className="terminal-workbench-status-icon terminal-workbench-status-icon--success" /> : null}
              {visualState !== "connecting" && visualState !== "connected" ? (
                <CloseCircleOutlined className={`terminal-workbench-status-icon terminal-workbench-status-icon--${visualToneClass}`} />
              ) : null}
              <OpsStatusTag tone={visualTone}>{VISUAL_STATUS_LABEL[visualState]}</OpsStatusTag>
            </div>
          </div>

          <div className="terminal-workbench-terminal-area">
            <div ref={terminalHostRef} className="terminal-xterm-host" />
          </div>
        </div>
      </OpsFrameShell>
      <style jsx global>{`
        .terminal-workbench-shell.ops-frame-shell {
          min-height: calc(100vh - 112px);
          border-radius: 10px;
        }

        .terminal-workbench-shell .ops-frame-shell__header {
          align-items: center;
        }

        .terminal-workbench-shell .ops-frame-shell__title {
          font-size: 18px;
        }

        .terminal-workbench-body {
          display: grid;
          min-height: 0;
          padding: 14px;
        }

        .terminal-workbench-toolbar.ant-space {
          row-gap: 8px;
        }

        .terminal-workbench-container-select.ant-select {
          min-width: 180px;
        }

        .terminal-workbench-stage {
          position: relative;
          display: grid;
          grid-template-rows: auto minmax(0, 1fr);
          min-height: 72vh;
          overflow: hidden;
          border: 1px solid var(--ops-frame-border);
          border-radius: 10px;
          background: var(--ops-terminal-bg);
          box-shadow: inset 0 1px 0 var(--ops-frame-divider), 0 1px 2px rgba(15, 23, 42, 0.08);
        }

        .terminal-workbench-stage--connecting,
        .terminal-workbench-stage--connected {
          border-color: var(--ops-status-info-border);
        }

        .terminal-workbench-stage--expired,
        .terminal-workbench-stage--error {
          border-color: var(--ops-status-danger-border);
        }

        .terminal-workbench-stage--non-reconnectable {
          border-color: var(--ops-status-warning-border);
        }

        .terminal-workbench-titlebar {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 10px 14px;
          border-bottom: 1px solid var(--ops-frame-divider);
          background: var(--ops-frame-header-bg);
        }

        .terminal-workbench-title-group,
        .terminal-workbench-live-state {
          display: inline-flex;
          align-items: center;
          min-width: 0;
          gap: 8px;
        }

        .terminal-workbench-title.ant-typography {
          min-width: 0;
          margin: 0;
          overflow: hidden;
          color: var(--ops-terminal-fg);
          font-weight: 650;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .terminal-workbench-dot {
          width: 9px;
          height: 9px;
          flex: 0 0 auto;
          border-radius: 50%;
          box-shadow: 0 0 0 1px var(--ops-frame-divider);
        }

        .terminal-workbench-dot--warn {
          background: var(--ops-status-warning-text);
        }

        .terminal-workbench-dot--success {
          background: var(--ops-status-success-text);
        }

        .terminal-workbench-dot--info {
          background: var(--ops-status-info-text);
        }

        .terminal-workbench-status-icon {
          color: var(--ops-status-neutral-text);
        }

        .terminal-workbench-status-icon--processing {
          color: var(--ops-status-info-text);
        }

        .terminal-workbench-status-icon--success {
          color: var(--ops-status-success-text);
        }

        .terminal-workbench-status-icon--warning {
          color: var(--ops-status-warning-text);
        }

        .terminal-workbench-status-icon--danger {
          color: var(--ops-status-danger-text);
        }

        .terminal-workbench-terminal-area {
          height: 72vh;
          max-height: 72vh;
          min-height: 0;
          overflow: hidden;
        }

        @media (max-width: 720px) {
          .terminal-workbench-body {
            padding: 10px;
          }

          .terminal-workbench-titlebar {
            align-items: flex-start;
            flex-direction: column;
          }

          .terminal-workbench-container-select.ant-select {
            width: 100%;
          }
        }
      `}</style>
    </>
  );
}
