"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Select, Spin, Tooltip, message } from "antd";
import {
  MenuFoldOutlined,
  MinusOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { usePathname } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/components/auth-context";
import {
  createSession,
  getAiAssistantAccess,
  listSessions,
  sendMessage,
  type AiConversationMessage,
  type AiConversationSession,
  type SendMessageResponse,
} from "@/lib/api/ai-assistant";
import { createAiAssistantStreamClient } from "@/lib/ws/ai-assistant";
import { FloatingActions } from "./floating-actions";

const POSITION_KEY = "kubenova.ai.assistant.floating.position";
const SIZE_KEY = "kubenova.ai.assistant.floating.size";
const PANEL_WIDTH = 620;
const PANEL_HEIGHT = 900;
const NARROW_BREAKPOINT = 992;
const EDGE_GAP = 20;
const GLOBAL_SESSION_VALUE = "__global__";
/**
 * 头部同时承担拖拽与按钮点击。指针按下时若命中这些交互元素，必须放弃拖拽，
 * 否则 setPointerCapture 会把后续 click 重定向到头部容器，按钮就点不动了。
 */
const DRAG_EXEMPT_SELECTOR =
  "button, a, input, textarea, select, [role='button'], .ant-select, .ant-btn, [data-no-drag]";

type Position = { right: number; bottom: number };
type ResizeCorner = "nw" | "ne" | "sw" | "se";

function readStoredPosition(): Position {
  if (typeof window === "undefined") return { right: EDGE_GAP, bottom: EDGE_GAP };
  try {
    const raw = window.localStorage.getItem(POSITION_KEY);
    if (!raw) return { right: EDGE_GAP, bottom: EDGE_GAP };
    const parsed = JSON.parse(raw) as Partial<Position>;
    return {
      right: typeof parsed.right === "number" ? parsed.right : EDGE_GAP,
      bottom: typeof parsed.bottom === "number" ? parsed.bottom : EDGE_GAP,
    };
  } catch {
    return { right: EDGE_GAP, bottom: EDGE_GAP };
  }
}

function extractClusterIdFromPath(pathname: string): string | undefined {
  const match = /^\/clusters\/([^/?#]+)/.exec(pathname ?? "");
  return match?.[1];
}

function shortenDisplayName(name: string, max = 28): string {
  const trimmed = name.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max - 1)}…` : trimmed;
}

/**
 * 轻量 Markdown 渲染，与 /ai-assistant 页保持一致的排版语义（标题、列表、
 * 行内代码、代码块），但用流式浮层的紧凑字号。
 */
function FloatingMarkdown({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p className="kn-ai-float__md-p">{children}</p>,
        ul: ({ children }) => <ul className="kn-ai-float__md-ul">{children}</ul>,
        ol: ({ children }) => <ol className="kn-ai-float__md-ol">{children}</ol>,
        li: ({ children }) => <li className="kn-ai-float__md-li">{children}</li>,
        h1: ({ children }) => <h4 className="kn-ai-float__md-h">{children}</h4>,
        h2: ({ children }) => <h4 className="kn-ai-float__md-h">{children}</h4>,
        h3: ({ children }) => <h4 className="kn-ai-float__md-h">{children}</h4>,
        h4: ({ children }) => <h4 className="kn-ai-float__md-h">{children}</h4>,
        pre: ({ children }) => <pre className="kn-ai-float__md-pre">{children}</pre>,
        code: ({ children, className }) => (
          <code
            className={
              className ? `kn-ai-float__md-code ${className}` : "kn-ai-float__md-code"
            }
          >
            {children}
          </code>
        ),
        a: ({ children, href }) => (
          <a className="kn-ai-float__md-link" href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

/**
 * 全站悬浮 AI 助手。
 *
 * 复用与 /ai-assistant 页一致的会话 API。管理员使用流式通道；受限授权用户
 * 仅能选择其授权集群/命名空间并走 REST。集群上下文自动继承当前路由，也允许改选。
 */
export function FloatingAiAssistant({
  open,
  onOpenChange: setOpen,
  onCollapseSidebar,
  insetRight = 0,
}: {
  open: boolean;
  onOpenChange: React.Dispatch<React.SetStateAction<boolean>>;
  onCollapseSidebar: () => void;
  insetRight?: number;
}) {
  const pathname = usePathname();
  const { accessToken, role, isInitializing } = useAuth();

  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position>({ right: EDGE_GAP, bottom: EDGE_GAP });
  const [isNarrow, setIsNarrow] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });
  const [panelSize, setPanelSize] = useState({ width: PANEL_WIDTH, height: PANEL_HEIGHT });
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [clusterId, setClusterId] = useState<string | undefined>(undefined);
  const [namespace, setNamespace] = useState<string | undefined>(undefined);
  const [streamReady, setStreamReady] = useState<boolean | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const resizedGeometryRef = useRef<{ position: Position; size: { width: number; height: number } } | null>(null);
  const resizeRef = useRef<{ pointerId: number; corner: ResizeCorner; x: number; y: number; left: number; top: number; right: number; bottom: number } | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
  } | null>(null);
  const clientRef = useRef<ReturnType<typeof createAiAssistantStreamClient> | null>(null);
  const failedInputRef = useRef("");
  const activeRequestRef = useRef<string | null>(null);
  const selectedClusterRef = useRef<string | undefined>(undefined);
  const requestClusterRef = useRef<string | undefined>(undefined);

  const isAdmin = useMemo(() => {
    const normalized = String(role ?? "").trim().toLowerCase();
    return normalized === "admin" || normalized === "platform-admin";
  }, [role]);
  const accessQuery = useQuery({
    queryKey: ["ai-assistant", "access", accessToken],
    queryFn: () => getAiAssistantAccess(accessToken || undefined),
    enabled: mounted && Boolean(accessToken) && !isAdmin,
    staleTime: 30_000,
  });
  const canUseAssistant = isAdmin || Boolean(accessQuery.data?.allowed);

  const routeClusterId = extractClusterIdFromPath(pathname ?? "");

  useEffect(() => {
    setMounted(true);
    setPosition(readStoredPosition());
    try {
      const stored = JSON.parse(window.localStorage.getItem(SIZE_KEY) ?? "null");
      if (Number.isFinite(stored?.width) && Number.isFinite(stored?.height)) {
        setPanelSize({ width: Math.max(360, stored.width), height: Math.max(360, stored.height) });
      }
    } catch {
      // Resizing remains available when browser storage is blocked.
    }
    const onResize = () => {
      setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
      setViewport({ width: window.innerWidth, height: window.innerHeight });
    };
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!routeClusterId) return;
    // 自动继承当前集群上下文，但用户手动改选后不再覆盖。
    if (isAdmin || accessQuery.data?.scopes.some(scope => scope.clusterId === routeClusterId)) {
      setClusterId((prev) => prev ?? routeClusterId);
    }
  }, [accessQuery.data?.scopes, isAdmin, routeClusterId]);

  useEffect(() => {
    if (isAdmin || !accessQuery.data?.scopes.length) return;
    const scopes = accessQuery.data.scopes;
    const selected = scopes.find(scope => scope.clusterId === clusterId) ?? scopes[0]!;
    if (!clusterId || !scopes.some(scope => scope.clusterId === clusterId)) setClusterId(selected.clusterId);
    if (!selected.namespaces.includes(namespace ?? "")) setNamespace(selected.namespaces[0]);
  }, [accessQuery.data, clusterId, isAdmin, namespace]);

  const { data: clustersData } = useQuery({
    queryKey: ["ai-assistant", "floating-clusters", accessToken],
    queryFn: async () => {
      const { getClusters } = await import("@/lib/api/clusters");
      return getClusters({ state: "active", selectableOnly: true }, accessToken!);
    },
    enabled: mounted && canUseAssistant && Boolean(accessToken),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    let cancelled = false;
    selectedClusterRef.current = clusterId;
    setSessionId(null);
    setMessages([]);
    if (!accessToken) return () => { cancelled = true; };
    void listSessions(accessToken).then((sessions) => {
      if (cancelled) return;
      const session = sessions.find((item) =>
        item.surface === (isAdmin ? "mini" : "console") &&
        (item.clusterContext?.clusterId ?? undefined) === clusterId &&
        (isAdmin || (item.clusterContext?.namespace ?? undefined) === namespace),
      );
      if (session) {
        setSessionId(session.id);
        setMessages(session.messages);
      }
    }).catch(() => undefined);
    return () => { cancelled = true; };
  }, [accessToken, clusterId, isAdmin, namespace]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingText, scrollToBottom]);

  // 面板收起时保持连接，避免中断正在生成的回复。
  useEffect(() => {
    if (!mounted || !isAdmin || !accessToken) {
      return undefined;
    }
    const client = createAiAssistantStreamClient({
      token: accessToken,
      handlers: {
        onStatus: (status) => setStreamReady(status === "connected"),
        onDelta: (delta) => setStreamingText((prev) => prev + delta),
        onDone: (payload) => {
          setStreamingText("");
          setSending(false);
          if (requestClusterRef.current !== selectedClusterRef.current) return;
          setSessionId(payload.session.id);
          setMessages(payload.session.messages);
          activeRequestRef.current = null;
          void listSessions(accessToken).catch(() => undefined);
        },
        onError: (payload) => {
          setStreamingText("");
          setSending(false);
          if (requestClusterRef.current !== selectedClusterRef.current) return;
          activeRequestRef.current = null;
          setInput(failedInputRef.current);
          void message.error(payload.message || "模型调用失败，请重试");
        },
      },
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
      setStreamReady(null);
    };
  }, [mounted, isAdmin, accessToken]);

  const persistPosition = useCallback((next: Position) => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
    } catch {
      // Storage may be disabled; dragging must still work for this session.
    }
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isNarrow) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(DRAG_EXEMPT_SELECTOR)) {
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      const rect = event.currentTarget.parentElement!.getBoundingClientRect();
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: { right: window.innerWidth - rect.right, bottom: window.innerHeight - rect.bottom },
      };
      setDragOffset({ x: 0, y: 0 });
    },
    [isNarrow],
  );

  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    setDragOffset({
      x: event.clientX - drag.startX,
      y: event.clientY - drag.startY,
    });
  }, []);

  const onPointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const drag = dragRef.current;
      dragRef.current = null;
      if (!drag || drag.pointerId !== event.pointerId) return;
      const dx = event.clientX - drag.startX;
      const dy = event.clientY - drag.startY;
      setDragOffset(null);
      if (Math.abs(dx) < 3 && Math.abs(dy) < 3) return;
      const width = Math.min(panelSize.width, window.innerWidth - insetRight - EDGE_GAP * 2);
      const height = Math.min(panelSize.height, window.innerHeight - EDGE_GAP * 2);
      const next: Position = {
        right: Math.max(insetRight + EDGE_GAP, Math.min(window.innerWidth - width - EDGE_GAP, drag.origin.right - dx)),
        bottom: Math.max(EDGE_GAP, Math.min(window.innerHeight - height - EDGE_GAP, drag.origin.bottom - dy)),
      };
      setPosition(next);
      persistPosition(next);
    },
    [persistPosition, insetRight, panelSize],
  );

  function startResize(event: React.PointerEvent<HTMLButtonElement>, corner: ResizeCorner) {
    if (event.button !== 0) return;
    const rect = event.currentTarget.parentElement!.getBoundingClientRect();
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    resizedGeometryRef.current = null;
    resizeRef.current = { pointerId: event.pointerId, corner, x: event.clientX, y: event.clientY, left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
  }

  function moveResize(event: React.PointerEvent<HTMLButtonElement>) {
    const resize = resizeRef.current;
    if (!resize || resize.pointerId !== event.pointerId) return;
    const dx = event.clientX - resize.x;
    const dy = event.clientY - resize.y;
    const minHeight = Math.min(360, window.innerHeight - EDGE_GAP * 2);
    const left = resize.corner.endsWith("w") ? Math.max(EDGE_GAP, Math.min(resize.left + dx, resize.right - 360)) : resize.left;
    const right = resize.corner.endsWith("e") ? Math.min(window.innerWidth - insetRight - EDGE_GAP, Math.max(resize.right + dx, resize.left + 360)) : resize.right;
    const top = resize.corner.startsWith("n") ? Math.max(EDGE_GAP, Math.min(resize.top + dy, resize.bottom - minHeight)) : resize.top;
    const bottom = resize.corner.startsWith("s") ? Math.min(window.innerHeight - EDGE_GAP, Math.max(resize.bottom + dy, resize.top + minHeight)) : resize.bottom;
    const geometry = {
      size: { width: right - left, height: bottom - top },
      position: { right: window.innerWidth - right, bottom: window.innerHeight - bottom },
    };
    resizedGeometryRef.current = geometry;
    setPanelSize(geometry.size);
    setPosition(geometry.position);
  }

  function stopResize(event: React.PointerEvent<HTMLButtonElement>) {
    if (resizeRef.current?.pointerId !== event.pointerId) return;
    resizeRef.current = null;
    const geometry = resizedGeometryRef.current;
    resizedGeometryRef.current = null;
    if (!geometry) return;
    persistPosition(geometry.position);
    try { window.localStorage.setItem(SIZE_KEY, JSON.stringify(geometry.size)); } catch { /* Optional persistence. */ }
  }

  const handleSend = useCallback(
    async (text: string) => {
      const payload = text.trim();
      if (!payload || sending || !accessToken) return;
      failedInputRef.current = payload;

      const optimistic: AiConversationMessage = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: payload,
        createdAt: new Date().toISOString(),
      };

      // 还没有会话时先建会话，再把首条消息交给 WebSocket，让首条回复同样
      // 逐步铺开；流式通道不可用时回退 REST。
      if (!sessionId) {
        setSending(true);
        setMessages([optimistic]);
        let streamHandedOff = false;
        try {
          const result = await createSession(
            {
              title: payload.slice(0, 30),
              surface: isAdmin ? "mini" : "console",
              clusterId,
              namespace,
            },
            accessToken,
          );
          const session =
            "session" in result
              ? (result as SendMessageResponse).session
              : (result as AiConversationSession);
          setSessionId(session.id);
          setMessages([...session.messages, optimistic]);
          void listSessions(accessToken).catch(() => undefined);

          const requestId = `req-${Date.now()}`;
          activeRequestRef.current = requestId;
          requestClusterRef.current = clusterId;
          const dispatched = clientRef.current?.send({
            requestId,
            sessionId: session.id,
            message: payload,
            clusterId,
            namespace,
          });
          if (dispatched && streamReady !== false) {
            // 已交给流式通道；sending 由 chat.done / chat.error 收尾。
            streamHandedOff = true;
            return;
          }

          const resp = await sendMessage(
            session.id,
            { message: payload, clusterId, namespace },
            accessToken,
          );
          setMessages(resp.session.messages);
          setInput("");
          failedInputRef.current = "";
        } catch (error) {
          setMessages([optimistic]);
          setInput(payload);
          void message.error(error instanceof Error ? error.message : "发送失败");
        } finally {
          if (!streamHandedOff) {
            setSending(false);
          }
        }
        return;
      }

      setMessages((prev) => [...prev, optimistic]);
      setSending(true);
      setStreamingText("");

      const requestId = `req-${Date.now()}`;
      activeRequestRef.current = requestId;
      requestClusterRef.current = clusterId;
      const dispatched = clientRef.current?.send({
        requestId,
        sessionId,
        message: payload,
        clusterId,
      });

      if (dispatched && streamReady !== false) {
        return;
      }

      try {
        const resp = await sendMessage(
          sessionId,
          { message: payload, clusterId, namespace },
          accessToken,
        );
        setMessages(resp.session.messages);
        setInput("");
        failedInputRef.current = "";
        void listSessions(accessToken).catch(() => undefined);
      } catch (error) {
        setMessages((prev) => prev.filter((item) => item.id !== optimistic.id));
        setInput(payload);
        void message.error(error instanceof Error ? error.message : "发送失败");
      } finally {
        setSending(false);
      }
    },
    [accessToken, clusterId, namespace, sending, sessionId, streamReady],
  );

  const toggleOpen = useCallback(() => setOpen((prev) => !prev), [setOpen]);

  useEffect(() => {
    const openFromContext = (event: Event) => {
      const detail = (event as CustomEvent<{ clusterId?: string; prompt?: string }>).detail;
      if (detail?.clusterId) setClusterId(detail.clusterId);
      setOpen(true);
      if (detail?.prompt) window.setTimeout(() => void handleSend(detail.prompt!), 0);
    };
    window.addEventListener("kubenova:ai-open", openFromContext);
    return () => window.removeEventListener("kubenova:ai-open", openFromContext);
  }, [handleSend, setOpen]);

  const collapseLauncher = useCallback(() => {
    setOpen(false);
    onCollapseSidebar();
  }, [onCollapseSidebar, setOpen]);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStreamingText("");
    setInput("");
  }, []);

  if (!mounted || isInitializing || !canUseAssistant) {
    return null;
  }

  const dragStyle: React.CSSProperties = dragOffset
    ? { transform: `translate(${dragOffset.x}px, ${dragOffset.y}px)`, transition: "none" }
    : {};

  const panelWidth = Math.min(panelSize.width, viewport.width - insetRight - EDGE_GAP * 2);
  const panelHeight = Math.min(panelSize.height, viewport.height - EDGE_GAP * 2);
  const panelStyle: React.CSSProperties = isNarrow
    ? { right: 0, bottom: 0, left: 0, top: 0, width: "100%", height: "100%", borderRadius: 0 }
    : {
      right: Math.max(insetRight + EDGE_GAP, Math.min(position.right, viewport.width - panelWidth - EDGE_GAP)),
      bottom: Math.max(EDGE_GAP, Math.min(position.bottom, viewport.height - panelHeight - EDGE_GAP)),
      width: panelWidth,
      height: panelHeight,
    };

  const clusterOptions = [...(isAdmin ? [{ value: GLOBAL_SESSION_VALUE, label: "全局会话" }] : []), ...(clustersData?.items ?? [])
    .filter(item => isAdmin || accessQuery.data?.scopes.some(scope => scope.clusterId === item.id))
    .map((item) => ({
    value: item.id,
    label: shortenDisplayName(item.name || item.id),
  }))];
  const namespaceOptions = (accessQuery.data?.scopes.find(scope => scope.clusterId === clusterId)?.namespaces ?? [])
    .map(value => ({ value, label: value }));

  return (
    <>
      {open ? (
        <div
          className={`kn-ai-float${isNarrow ? " kn-ai-float--fullscreen" : ""}`}
          style={{ ...panelStyle, ...dragStyle }}
          role="dialog"
          aria-label="AI 助手"
        >
          {!isNarrow ? (["nw", "ne", "sw", "se"] as const).map((corner) => (
            <button
              key={corner}
              type="button"
              className={`kn-ai-float__resize kn-ai-float__resize--${corner}`}
              aria-label={`${{ nw: "左上", ne: "右上", sw: "左下", se: "右下" }[corner]}角调整对话框大小`}
              onPointerDown={(event) => startResize(event, corner)}
              onPointerMove={moveResize}
              onPointerUp={stopResize}
              onPointerCancel={stopResize}
              onLostPointerCapture={stopResize}
              onKeyDown={(event) => {
                if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) return;
                event.preventDefault();
                const dx = event.key === "ArrowRight" ? 20 : event.key === "ArrowLeft" ? -20 : 0;
                const dy = event.key === "ArrowDown" ? 20 : event.key === "ArrowUp" ? -20 : 0;
                const rect = event.currentTarget.parentElement!.getBoundingClientRect();
                const width = Math.max(360, Math.min(
                  panelWidth + (corner.endsWith("w") ? -dx : dx),
                  corner.endsWith("w") ? rect.right - EDGE_GAP : viewport.width - insetRight - EDGE_GAP - rect.left,
                ));
                const minHeight = Math.min(360, viewport.height - EDGE_GAP * 2);
                const height = Math.max(minHeight, Math.min(
                  panelHeight + (corner.startsWith("n") ? -dy : dy),
                  corner.startsWith("n") ? rect.bottom - EDGE_GAP : viewport.height - EDGE_GAP - rect.top,
                ));
                const next = {
                  right: viewport.width - rect.right - (corner.endsWith("e") ? width - panelWidth : 0),
                  bottom: viewport.height - rect.bottom - (corner.startsWith("s") ? height - panelHeight : 0),
                };
                setPanelSize({ width, height });
                setPosition(next);
                persistPosition(next);
                try { window.localStorage.setItem(SIZE_KEY, JSON.stringify({ width, height })); } catch { /* Optional persistence. */ }
              }}
            />
          )) : null}
          <div
            className="kn-ai-float__header"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
          >
            <div className="kn-ai-float__title">
              <span className="kn-ai-float__logo">
                <RobotOutlined />
              </span>
              <div className="kn-ai-float__title-text">
                <strong>AI 助手</strong>
                <span>
                  {streamReady === false
                    ? "非流式模式"
                    : streamReady === null
                      ? "连接中…"
                      : "流式已连接"}
                </span>
              </div>
            </div>
            <div className="kn-ai-float__actions">
              <Tooltip title="新建会话">
                <Button
                  type="text"
                  size="small"
                  aria-label="新建会话"
                  icon={<PlusOutlined />}
                  onClick={resetSession}
                />
              </Tooltip>
              <Tooltip title="收起侧边栏">
                <Button type="text" size="small" aria-label="收起侧边栏" icon={<MenuFoldOutlined />} onClick={collapseLauncher} />
              </Tooltip>
              <Tooltip title="收起面板">
                <Button
                  type="text"
                  size="small"
                  aria-label="收起面板"
                  icon={<MinusOutlined />}
                  onClick={toggleOpen}
                />
              </Tooltip>
            </div>
          </div>

          <div className="kn-ai-float__context">
            <span className="kn-ai-float__context-label">集群</span>
            <Select
              size="small"
              variant="borderless"
              value={clusterId ?? GLOBAL_SESSION_VALUE}
                onChange={(value) => {
                  const nextCluster = value === GLOBAL_SESSION_VALUE ? undefined : value;
                  setClusterId(nextCluster);
                  if (!isAdmin) {
                    setNamespace(accessQuery.data?.scopes.find(scope => scope.clusterId === nextCluster)?.namespaces[0]);
                  }
                }}
              options={clusterOptions}
              placeholder="选择集群"
              className="kn-ai-float__select"
              popupMatchSelectWidth={false}
            />
            {!isAdmin ? (
              <>
                <span className="kn-ai-float__context-label">命名空间</span>
                <Select
                  size="small"
                  variant="borderless"
                  value={namespace}
                  onChange={setNamespace}
                  options={namespaceOptions}
                  placeholder="选择已授权命名空间"
                  className="kn-ai-float__select"
                  popupMatchSelectWidth={false}
                />
              </>
            ) : null}
          </div>

          <div className="kn-ai-float__body" ref={listRef}>
            {messages.length === 0 && !streamingText ? (
              <div className="kn-ai-float__empty">
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="问我集群状态、Pod 故障或资源配置建议"
                />
              </div>
            ) : (
              <>
                {messages.map((item) => (
                  <div
                    key={item.id}
                    className={`kn-ai-float__msg kn-ai-float__msg--${item.role}`}
                  >
                    <div className="kn-ai-float__msg-content">
                      {item.role === "assistant" ? (
                        <FloatingMarkdown content={item.content} />
                      ) : (
                        item.content
                      )}
                      {item.role === "assistant" && item.actionDescriptors?.length ? (
                        <FloatingActions descriptors={item.actionDescriptors} token={accessToken ?? ""}
                          sessionId={sessionId ?? undefined} clusterId={clusterId} namespace={namespace} />
                      ) : null}
                    </div>
                  </div>
                ))}
                {streamingText ? (
                  <div className="kn-ai-float__msg kn-ai-float__msg--assistant kn-ai-float__msg--streaming">
                    <div className="kn-ai-float__msg-content">
                      <FloatingMarkdown content={streamingText} />
                    </div>
                  </div>
                ) : null}
                {sending && !streamingText ? (
                  <div className="kn-ai-float__pending">
                    <Spin size="small" /> <span>正在生成…</span>
                  </div>
                ) : null}
              </>
            )}
          </div>

          <div className="kn-ai-float__composer">
            <textarea
              className="kn-ai-float__input"
              placeholder="输入问题，Enter 发送 / Shift+Enter 换行"
              value={input}
              rows={1}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  void handleSend(input);
                }
              }}
            />
            <Button
              type="primary"
              size="small"
              icon={<SendOutlined />}
              loading={sending}
              disabled={!input.trim()}
              onClick={() => void handleSend(input)}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
