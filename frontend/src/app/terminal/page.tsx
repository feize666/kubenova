"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";
import {
  CheckCircleOutlined,
  CloseCircleOutlined,
  ColumnWidthOutlined,
  CopyOutlined,
  DisconnectOutlined,
  LoadingOutlined,
  ReloadOutlined,
} from "@ant-design/icons";
import { App, Button, Card, Select, Space, Tag, Tooltip, Typography, theme } from "antd";
import { ApiError } from "@/lib/api/client";
import { createRuntimeSession, resolveSafeRuntimeReturnTo, type CreateRuntimeSessionResponse } from "@/lib/api/runtime";
import {
  buildTerminalInputPayload,
  buildTerminalPingPayload,
  buildTerminalResizePayload,
  parseTerminalMessagePayload,
  type TerminalConnectionStatus,
  type TerminalParsedMessage,
} from "@/lib/ws/terminal";
import { useAuth } from "@/components/auth-context";
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

const STATUS_LABEL: Record<TerminalConnectionStatus, string> = {
  connecting: "连接中",
  connected: "在线",
  disconnected: "离线",
};

const STATUS_COLOR: Record<TerminalConnectionStatus, string> = {
  connecting: "processing",
  connected: "success",
  disconnected: "default",
};

const MAX_RECONNECTS = 5;
const INITIAL_RECONNECT_DELAY_MS = 1000;
const CONNECT_TIMEOUT_MS = 10000;
const SESSION_RENEW_WINDOW_MS = 60000;

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
    return { text: "集群 kubeconfig 无效，请修复集群凭据后再重试终端连接。", blockReconnect: true };
  }
  if (lowered.includes("auth") || lowered.includes("token") || lowered.includes("unauthorized")) {
    return { text: "终端鉴权失败，请重新登录并重新创建终端会话。", blockReconnect: true };
  }
  if (normalized === "RUNTIME_GATEWAY_BOOTSTRAP_FAILED") {
    return { text: "runtime-gateway 引导失败，请检查 runtime-gateway 与 control-api。", blockReconnect: false };
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
      text: `WebSocket 握手失败（1006），请检查浏览器到 runtime-gateway 的连通性。目标地址：${targetWsUrl}`,
      blockReconnect: false,
    };
  }
  if (code === 1008) {
    return { text: "终端鉴权失败（1008），请重新登录后重试。", blockReconnect: true };
  }
  if (code === 1013) {
    return { text: "runtime-gateway 当前不可用（1013），请检查网关健康状态。", blockReconnect: false };
  }

  return { text: `连接断开（code=${code}），请检查 runtime-gateway 日志。`, blockReconnect: false };
}

export default function TerminalPage() {
  const router = useRouter();
  const { token } = theme.useToken();
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const searchParams = useSearchParams();

  const [status, setStatus] = useState<TerminalConnectionStatus>("disconnected");
  const [sessionInfo, setSessionInfo] = useState<RuntimeSessionView | null>(null);
  const [selectedContainer, setSelectedContainer] = useState(searchParams.get("container")?.trim() || "");
  const [lastNotice, setLastNotice] = useState<string>("");
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
      setLastNotice("自动重连失败，请手动点击“新建会话”重试。");
      return;
    }
    const attempt = reconnectCountRef.current + 1;
    reconnectCountRef.current = attempt;
    const delayMs = INITIAL_RECONNECT_DELAY_MS * 2 ** (attempt - 1);
    setLastNotice(`将在 ${Math.floor(delayMs / 1000)} 秒后进行第 ${attempt} 次自动重连...`);
    clearReconnectTimer();
    reconnectTimerRef.current = setTimeout(() => {
      void connectTerminal({ isAutoReconnect: true, userInitiated: false });
    }, delayMs);
  };

  const disconnectTerminal = (showToast = false) => {
    clearReconnectTimer();
    clearConnectTimeout();
    reconnectCountRef.current = 0;
    manualDisconnectRef.current = true;
    blockReconnectRef.current = true;
    connectingRef.current = false;
    generationRef.current += 1;
    closeSocketSilently(wsRef.current);
    wsRef.current = null;
    setStatus("disconnected");
    setLastNotice("终端已手动断开。");
    manualDisconnectRef.current = false;
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
      const mapped = normalizeRuntimeError(error.code, error.message || "创建运行时会话失败");
      return new RuntimeConnectError(mapped.text, mapped.blockReconnect);
    }
    if (error instanceof RuntimeConnectError) {
      return error;
    }
    if (error instanceof Error && error.message) {
      return new RuntimeConnectError(error.message);
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
        if (attemptUserInitiatedRef.current) {
          const codeKey = (parsed.code || mapped.text || "runtime-error").toLowerCase();
          toastOnce(`runtime-error-${codeKey}`, "error", mapped.text);
        }
        return;
      }
      if (parsed.text) {
        setLastNotice(parsed.text);
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
      setLastNotice(isAutoReconnect ? "正在执行自动重连..." : "正在准备运行时会话...");
      writeSystemLine(isAutoReconnect ? "正在执行自动重连..." : "正在准备运行时会话...");

      const session = await readSession(forceNewSession);
      if (!isCurrent()) return;
      setSessionInfo(session);

      const socket = new WebSocket(session.gatewayWsUrl);
      socket.binaryType = "arraybuffer";
      wsRef.current = socket;
      clearConnectTimeout();
      connectTimeoutRef.current = setTimeout(() => {
        if (!isCurrent() || socket.readyState !== WebSocket.CONNECTING) return;
        socket.close(4000, "connect-timeout");
      }, CONNECT_TIMEOUT_MS);

      socket.onopen = () => {
        if (!isCurrent()) return;
        clearConnectTimeout();
        clearReconnectTimer();
        reconnectCountRef.current = 0;
        setStatus("connected");
        connectingRef.current = false;
        setLastNotice("WebSocket 已建立，等待容器 shell 输出。");
        writeSystemLine("WebSocket 已建立，等待容器 shell 输出。");
        if (allowConnectedToastRef.current && !hasConnectedNoticeRef.current) {
          hasConnectedNoticeRef.current = true;
          allowConnectedToastRef.current = false;
          toastOnce("terminal-connected", "success", "终端已连接");
        }
        focusTerminal();
        requestAnimationFrame(() => fitTerminal());
      };

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
        setLastWarning(`连接发生错误，等待关闭事件确认失败原因。目标地址：${session.gatewayWsUrl}`);
      };

      socket.onclose = (event) => {
        if (!isCurrent()) return;
        clearConnectTimeout();
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
          targetWsUrl: session.gatewayWsUrl,
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
          connectingRef.current = false;
          return;
        }
        connectingRef.current = false;
        scheduleReconnect();
      };
    } catch (error) {
      if (!isCurrent()) return;
      clearConnectTimeout();
      setStatus("disconnected");
      wsRef.current = null;
      sessionCacheRef.current = null;
      const explained = explainCreateError(error);
      setLastWarning(explained.message);
      writeSystemLine(explained.message);
      if (userInitiated) {
        toastOnce(`create-error-${explained.message}`, "error", explained.message);
      }
      connectingRef.current = false;
      if (explained.blockReconnect) {
        blockReconnectRef.current = true;
        return;
      }
      scheduleReconnect();
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

    const terminal = new Terminal({
      cursorBlink: true,
      convertEol: true,
      fontFamily: token.fontFamilyCode,
      fontSize: 13,
      lineHeight: 1.35,
      scrollback: 5000,
      theme: {
        background: "#08101a",
        foreground: "#dbeafe",
        cursor: "#60a5fa",
        cursorAccent: "#08101a",
        selectionBackground: "rgba(59,130,246,0.28)",
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

    return () => {
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
    setLastNotice("");
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

  return (
    <Card className="cyber-panel terminal-workspace-card" styles={{ body: { padding: 20 } }} style={{ borderRadius: 28, overflow: "hidden" }}>
      <div style={{ display: "grid", gap: 16 }}>
        <div
          style={{
            display: "grid",
            gap: 14,
            padding: 18,
            borderRadius: 24,
            border: `1px solid ${token.colorBorderSecondary}`,
            background:
              token.colorBgContainer === "#111827"
                ? "linear-gradient(135deg, rgba(15,23,42,0.94), rgba(8,47,73,0.92))"
                : "linear-gradient(135deg, rgba(255,255,255,0.98), rgba(239,246,255,0.98))",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
            <div style={{ display: "grid", gap: 8 }}>
              <Space wrap size={10}>
                <Typography.Title level={3} style={{ margin: 0 }}>
                  Terminal Workspace
                </Typography.Title>
                <Tag color={STATUS_COLOR[status]}>{STATUS_LABEL[status]}</Tag>
                {podPhase ? <Tag color={podPhase === "Running" ? "success" : "warning"}>Pod {podPhase}</Tag> : null}
              </Space>
              <Typography.Text type="secondary">
                {targetBase.clusterId || "-"} / {targetBase.namespace || "-"} / {targetBase.pod || "-"} · 来源 {sourceLabel}
              </Typography.Text>
            </div>
            <Space wrap>
              <Select
                value={selectedContainer || undefined}
                style={{ minWidth: 180 }}
                placeholder="选择容器"
                options={availableContainers.map((container) => ({ label: container, value: container }))}
                onChange={(value) => setSelectedContainer(value)}
              />
              <Button icon={<ReloadOutlined />} onClick={() => void connectTerminal({ forceNewSession: true, userInitiated: true })} disabled={status === "connecting" || missingParams.length > 0}>
                新建会话
              </Button>
              <Button icon={<DisconnectOutlined />} onClick={handleDisconnectAndReturn} disabled={status === "disconnected"}>
                断开
              </Button>
              <Button icon={<ColumnWidthOutlined />} onClick={clearTerminal}>
                清屏
              </Button>
              <Button icon={<CopyOutlined />} onClick={copyTerminal}>
                复制
              </Button>
            </Space>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <Tag variant="filled">Container {selectedContainer || "-"}</Tag>
            <Tooltip title={sessionInfo?.gatewayWsUrl || "未创建"}>
              <Tag variant="filled" color="blue">Gateway {sessionInfo?.sessionId ? "已绑定" : "未创建"}</Tag>
            </Tooltip>
            <Tag variant="filled">TTL {formatExpiry(sessionInfo?.expiresAtMs)}</Tag>
            {sessionInfo?.sessionId ? <Tag variant="filled">Session {sessionInfo.sessionId.slice(0, 8)}</Tag> : null}
            {sessionInfo?.reconnectable === false ? <Tag color="warning">不可重连</Tag> : null}
          </div>
        </div>

        {missingParams.length > 0 ? (
          <Card style={{ borderRadius: 20, borderColor: "rgba(245,158,11,0.28)", background: "rgba(245,158,11,0.08)" }}>
            <Typography.Text>{missingText}</Typography.Text>
          </Card>
        ) : null}

        {lastWarning ? (
          <Card style={{ borderRadius: 20, borderColor: "rgba(248,113,113,0.28)", background: "rgba(248,113,113,0.08)" }}>
            <Typography.Text>{lastWarning}</Typography.Text>
          </Card>
        ) : null}

        <div
          style={{
            position: "relative",
            borderRadius: 28,
            overflow: "hidden",
            border: "1px solid rgba(148,163,184,0.2)",
            background: "radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 24%), linear-gradient(180deg, #07111f 0%, #08101a 100%)",
            minHeight: "72vh",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "14px 18px",
              borderBottom: "1px solid rgba(148,163,184,0.15)",
              background: "rgba(2,6,23,0.65)",
            }}
          >
            <Space size={8}>
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#f97316", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#22c55e", display: "inline-block" }} />
              <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#38bdf8", display: "inline-block" }} />
              <Typography.Text style={{ color: "#e2e8f0", fontWeight: 600 }}>
                {targetBase.pod || "terminal"}.{targetBase.namespace || "default"}
              </Typography.Text>
            </Space>
            <Space size={8}>
              {status === "connecting" ? <LoadingOutlined style={{ color: "#38bdf8" }} /> : null}
              {status === "connected" ? <CheckCircleOutlined style={{ color: "#22c55e" }} /> : null}
              {status === "disconnected" ? <CloseCircleOutlined style={{ color: "#94a3b8" }} /> : null}
              <Typography.Text style={{ color: "#cbd5e1" }}>{STATUS_LABEL[status]}</Typography.Text>
            </Space>
          </div>

          <div style={{ minHeight: "calc(72vh - 58px)", display: "grid" }}>
            <div ref={terminalHostRef} className="terminal-xterm-host" />
          </div>
        </div>

        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          点击终端区域后直接输入命令。方向键、删除键、粘贴与 shell 内部行编辑均在终端内完成，切换容器将自动重建终端会话。
          {lastNotice ? ` 当前状态：${lastNotice}` : ""}
        </Typography.Text>
      </div>
    </Card>
  );
}
