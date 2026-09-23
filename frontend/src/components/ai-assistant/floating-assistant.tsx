"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Empty, Select, Spin, Tooltip, message } from "antd";
import {
  ExpandOutlined,
  MinusOutlined,
  PlusOutlined,
  RobotOutlined,
  SendOutlined,
} from "@ant-design/icons";
import { usePathname, useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useAuth } from "@/components/auth-context";
import {
  createSession,
  listSessions,
  sendMessage,
  type AiConversationMessage,
  type AiConversationSession,
  type SendMessageResponse,
} from "@/lib/api/ai-assistant";
import { createAiAssistantStreamClient } from "@/lib/ws/ai-assistant";

const POSITION_KEY = "kubenova.ai.assistant.floating.position";
const OPEN_KEY = "kubenova.ai.assistant.floating.open";
const PANEL_WIDTH = 400;
const PANEL_HEIGHT = 560;
const NARROW_BREAKPOINT = 992;
const EDGE_GAP = 20;
/**
 * 头部同时承担拖拽与按钮点击。指针按下时若命中这些交互元素，必须放弃拖拽，
 * 否则 setPointerCapture 会把后续 click 重定向到头部容器，按钮就点不动了。
 */
const DRAG_EXEMPT_SELECTOR =
  "button, a, input, textarea, select, [role='button'], .ant-select, .ant-btn, [data-no-drag]";

type Position = { right: number; bottom: number };

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

function readStoredOpen(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(OPEN_KEY) === "1";
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
 * 仅管理员可见；复用与 /ai-assistant 页完全一致的会话与消息 API，并通过
 * control-api 的 socket.io 命名空间做流式增量渲染；集群上下文自动继承当前
 * 路由，也允许在浮层内改选。窄屏下自动全屏化。
 */
export function FloatingAiAssistant() {
  const router = useRouter();
  const pathname = usePathname();
  const { accessToken, role, isInitializing } = useAuth();

  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [position, setPosition] = useState<Position>({ right: EDGE_GAP, bottom: EDGE_GAP });
  const [isNarrow, setIsNarrow] = useState(false);
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number } | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [streamingText, setStreamingText] = useState("");
  const [clusterId, setClusterId] = useState<string | undefined>(undefined);
  const [streamReady, setStreamReady] = useState<boolean | null>(null);

  const listRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    origin: Position;
  } | null>(null);
  const clientRef = useRef<ReturnType<typeof createAiAssistantStreamClient> | null>(null);

  const isAdmin = useMemo(() => {
    const normalized = String(role ?? "").trim().toLowerCase();
    return normalized === "admin" || normalized === "platform-admin";
  }, [role]);

  const routeClusterId = extractClusterIdFromPath(pathname ?? "");

  useEffect(() => {
    setMounted(true);
    setPosition(readStoredPosition());
    setOpen(readStoredOpen());
    const onResize = () => setIsNarrow(window.innerWidth < NARROW_BREAKPOINT);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  useEffect(() => {
    if (!routeClusterId) return;
    // 自动继承当前集群上下文，但用户手动改选后不再覆盖。
    setClusterId((prev) => prev ?? routeClusterId);
  }, [routeClusterId]);

  const { data: clustersData } = useQuery({
    queryKey: ["ai-assistant", "floating-clusters", accessToken],
    queryFn: async () => {
      const { getClusters } = await import("@/lib/api/clusters");
      return getClusters({ state: "active", selectableOnly: true }, accessToken!);
    },
    enabled: mounted && open && isAdmin && Boolean(accessToken),
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (!clusterId && clustersData?.items?.length) {
      const preferred =
        clustersData.items.find((item) => item.hasKubeconfig !== false)?.id ??
        clustersData.items[0]?.id;
      if (preferred) setClusterId(preferred);
    }
  }, [clusterId, clustersData]);

  const scrollToBottom = useCallback(() => {
    requestAnimationFrame(() => {
      const node = listRef.current;
      if (node) node.scrollTop = node.scrollHeight;
    });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages.length, streamingText, scrollToBottom]);

  // 建立流式连接；失败则回退到非流式 REST 调用，保证功能始终可用。
  useEffect(() => {
    if (!mounted || !open || !isAdmin || !accessToken) {
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
          setSessionId(payload.session.id);
          setMessages(payload.session.messages);
          void listSessions(accessToken).catch(() => undefined);
        },
        onError: (payload) => {
          setStreamingText("");
          setSending(false);
          void message.error(payload.message);
        },
      },
    });
    clientRef.current = client;
    return () => {
      client.dispose();
      clientRef.current = null;
      setStreamReady(null);
    };
  }, [mounted, open, isAdmin, accessToken]);

  const persistPosition = useCallback((next: Position) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(POSITION_KEY, JSON.stringify(next));
  }, []);

  const onPointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (isNarrow) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest(DRAG_EXEMPT_SELECTOR)) {
        return;
      }
      (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
      dragRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        origin: position,
      };
      setDragOffset({ x: 0, y: 0 });
    },
    [isNarrow, position],
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
      const next: Position = {
        right: Math.max(EDGE_GAP, Math.min(window.innerWidth - 80, drag.origin.right - dx)),
        bottom: Math.max(EDGE_GAP, Math.min(window.innerHeight - 80, drag.origin.bottom - dy)),
      };
      setPosition(next);
      persistPosition(next);
    },
    [persistPosition],
  );

  const handleSend = useCallback(
    async (text: string) => {
      const payload = text.trim();
      if (!payload || sending || !accessToken) return;
      setInput("");

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
              surface: "mini",
              clusterId,
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

          const dispatched = clientRef.current?.send({
            requestId: `req-${Date.now()}`,
            sessionId: session.id,
            message: payload,
            clusterId,
          });
          if (dispatched && streamReady !== false) {
            // 已交给流式通道；sending 由 chat.done / chat.error 收尾。
            streamHandedOff = true;
            return;
          }

          const resp = await sendMessage(
            session.id,
            { message: payload, clusterId },
            accessToken,
          );
          setMessages(resp.session.messages);
        } catch (error) {
          setMessages([optimistic]);
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
          { message: payload, clusterId },
          accessToken,
        );
        setMessages(resp.session.messages);
        void listSessions(accessToken).catch(() => undefined);
      } catch (error) {
        setMessages((prev) => prev.filter((item) => item.id !== optimistic.id));
        void message.error(error instanceof Error ? error.message : "发送失败");
      } finally {
        setSending(false);
      }
    },
    [accessToken, clusterId, sending, sessionId, streamReady],
  );

  const toggleOpen = useCallback(() => {
    setOpen((prev) => {
      const next = !prev;
      if (typeof window !== "undefined") {
        window.localStorage.setItem(OPEN_KEY, next ? "1" : "0");
      }
      return next;
    });
  }, []);

  const resetSession = useCallback(() => {
    setSessionId(null);
    setMessages([]);
    setStreamingText("");
    setInput("");
  }, []);

  if (!mounted || isInitializing || !isAdmin) {
    return null;
  }

  const dragStyle: React.CSSProperties = dragOffset
    ? { transform: `translate(${-dragOffset.x}px, ${dragOffset.y}px)`, transition: "none" }
    : {};

  const panelStyle: React.CSSProperties = isNarrow
    ? { right: 0, bottom: 0, left: 0, top: 0, width: "100%", height: "100%", borderRadius: 0 }
    : { right: position.right, bottom: position.bottom, width: PANEL_WIDTH, height: PANEL_HEIGHT };

  const clusterOptions = (clustersData?.items ?? []).map((item) => ({
    value: item.id,
    label: shortenDisplayName(item.name || item.id),
  }));

  return (
    <>
      {!open ? (
        <button
          type="button"
          className="kn-ai-fab"
          aria-label="打开 AI 助手"
          onClick={toggleOpen}
        >
          <RobotOutlined />
          <span className="kn-ai-fab__label">AI 助手</span>
        </button>
      ) : null}

      {open ? (
        <div
          className={`kn-ai-float${isNarrow ? " kn-ai-float--fullscreen" : ""}`}
          style={{ ...panelStyle, ...dragStyle }}
          role="dialog"
          aria-label="AI 助手"
        >
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
              <Tooltip title="展开完整页面">
                <Button
                  type="text"
                  size="small"
                  aria-label="展开完整页面"
                  icon={<ExpandOutlined />}
                  onClick={() => router.push("/ai-assistant")}
                />
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
              value={clusterId}
              onChange={setClusterId}
              options={clusterOptions}
              placeholder="选择集群"
              className="kn-ai-float__select"
              popupMatchSelectWidth={false}
            />
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
