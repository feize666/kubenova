"use client";

import {
  AudioOutlined,
  ApiOutlined,
  ClusterOutlined,
  DeleteOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  MenuUnfoldOutlined,
  SendOutlined,
  StopOutlined,
  UserOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  Layout,
  List,
  Modal,
  Row,
  Result,
  Select,
  Space,
  Spin,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type KeyboardEvent,
} from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import {
  AiDeleteSessionDialog,
  type AiDeleteSessionTarget,
} from "@/components/ai/delete-session-dialog";
import {
  OpsCommandPreview,
  OpsDrawerShell,
  OpsFilterChip,
  OpsIconActionButton,
  OpsStatusTag,
  OpsSurface,
} from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import {
  createSession,
  executeAction,
  deleteSession,
  getAiSuggestions,
  getPresetQuestions,
  listSessions,
  listAiProviders,
  listAiProviderCatalog,
  getSession,
  pingAiConfig,
  sendMessage,
  normalizeAiAssistantActionOperation,
  uploadAttachment,
  type AiMessageAttachment,
  type AiActionDescriptor,
  type AiActionExecuteRequest,
  type AiAssistantCanonicalOperation,
  type AiVoiceInputMeta,
  type AiConversationMessage,
  type AiConversationSession,
  type AiProvider,
  type AiProviderCatalogItem,
  type PresetQuestion,
  type SendMessageResponse,
} from "@/lib/api/ai-assistant";
import { createAiAssistantStreamClient } from "@/lib/ws/ai-assistant";
import { getClusterIdFromPathname } from "@/lib/cluster-workspace";

const { Sider, Content } = Layout;
const { TextArea } = Input;

const QUICK_PROMPTS = [
  "请总结过去1小时活跃告警并给出处置优先级",
  "请分析近期 Pod 重启异常的潜在根因",
  "请给出当前工作负载扩缩容与资源优化建议",
  "请评估当前发布风险并给出回滚判定条件",
];
const AI_ASSISTANT_CURRENT_SESSION_KEY =
  "kubenova.ai.assistant.currentSessionId";
const AI_ASSISTANT_SESSIONS_CACHE_KEY = "kubenova.ai.assistant.sessions";
const AI_ASSISTANT_MESSAGES_CACHE_PREFIX = "kubenova.ai.assistant.messages.";
const CHAT_WORKSPACE_DESKTOP_HEIGHT =
  "clamp(520px, calc(100vh - 240px), 720px)";
const PAGE_QUERY_GC_TIME_MS = 5 * 60_000;
const HIGH_RISK_ACTIONS = new Set<AiAssistantCanonicalOperation>([
  "restart-workload",
  "vm-power-on",
  "vm-power-off",
  "vm-restart",
  "import-helm-repository-presets",
]);

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
}

interface BrowserSpeechRecognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onstart: (() => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  start: () => void;
  stop: () => void;
}

type SpeechRecognitionCtor = new () => BrowserSpeechRecognition;

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("zh-CN", {
    hour12: false,
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function getMarkdownCodePreviewKind(language: string, content: string) {
  const normalizedLanguage = language.toLowerCase();
  const normalizedContent = content.trim().toLowerCase();
  if (
    ["bash", "shell", "sh", "zsh", "powershell", "ps1", "cmd"].includes(
      normalizedLanguage,
    )
  ) {
    return "command";
  }
  if (
    normalizedLanguage === "log" ||
    normalizedContent.startsWith("kubectl ")
  ) {
    return "log";
  }
  return "code";
}

function formatHighRiskActionPreview(action: AiActionExecuteRequest) {
  const target = action.target ?? {};
  const lines = [`operation: ${action.operation}`];
  if (target.clusterId) lines.push(`cluster: ${target.clusterId}`);
  if (target.namespace) lines.push(`namespace: ${target.namespace}`);
  if (target.kind && target.name)
    lines.push(`resource: ${target.kind}/${target.name}`);
  if (target.resourceType) lines.push(`resourceType: ${target.resourceType}`);
  if (target.resourceId) lines.push(`resourceId: ${target.resourceId}`);
  if (target.provider) lines.push(`provider: ${target.provider}`);
  if (target.vmId) lines.push(`vmId: ${target.vmId}`);
  if (target.reason) lines.push(`targetReason: ${target.reason}`);
  if (action.reason) lines.push(`reason: ${action.reason}`);
  if (action.options && Object.keys(action.options).length > 0) {
    lines.push("options:");
    lines.push(JSON.stringify(action.options, null, 2));
  }
  return lines.join("\n");
}

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => (
          <p
            style={{
              margin: "0 0 8px",
              lineHeight: 1.7,
              wordBreak: "break-word",
              overflowWrap: "anywhere",
            }}
          >
            {children}
          </p>
        ),
        ul: ({ children }) => (
          <ul style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ul>
        ),
        ol: ({ children }) => (
          <ol style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ol>
        ),
        li: ({ children }) => (
          <li style={{ marginBottom: 2, lineHeight: 1.6 }}>{children}</li>
        ),
        pre: ({ children }) => <>{children}</>,
        code: ({ children, className }) => {
          const text = String(children ?? "").replace(/\n$/, "");
          const isBlock =
            className?.startsWith("language-") || text.includes("\n");
          const language = className?.replace(/^language-/, "") || "";
          if (isBlock) {
            const kind = getMarkdownCodePreviewKind(language, text);
            return (
              <OpsCommandPreview
                content={text}
                kind={kind}
                language={language || undefined}
                title={
                  kind === "command"
                    ? "命令建议"
                    : kind === "log"
                      ? "日志片段"
                      : "代码片段"
                }
                tone={kind === "command" ? "info" : "neutral"}
                wrap={kind !== "command"}
                style={{ margin: "8px 0" }}
              />
            );
          }
          return (
            <code
              style={{
                background: "var(--ai-chat-inline-code-bg)",
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: "0.88em",
                fontFamily: "var(--kn-font-mono)",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            >
              {children}
            </code>
          );
        },
      }}
    >
      {content}
    </ReactMarkdown>
  );
}

function MessageBubble({
  message,
  onAction,
  loadingActionId,
  streaming = false,
}: {
  message: AiConversationMessage;
  onAction: (descriptor: AiActionDescriptor) => void;
  loadingActionId: string | null;
  /** 流式生成中的气泡：显示光标并把新内容滚入视野。 */
  streaming?: boolean;
}) {
  const isUser = message.role === "user";
  const displayedContent = message.content;
  const attachments = message.attachments ?? [];

  return (
    <div
      style={{
        display: "flex",
        flexDirection: isUser ? "row-reverse" : "row",
        alignItems: "flex-start",
        gap: 10,
        marginBottom: 16,
        maxWidth: "100%",
        minWidth: 0,
      }}
    >
      <Avatar
        size={32}
        icon={isUser ? <UserOutlined /> : <RobotOutlined />}
        style={{
          background: isUser ? "#2f54eb" : "#1677ff",
          color: "#fff",
          flexShrink: 0,
        }}
      />
      <div
        style={{
          maxWidth: "78%",
          minWidth: 0,
          display: "flex",
          flexDirection: "column",
          alignItems: isUser ? "flex-end" : "flex-start",
        }}
      >
        <div
          style={{
            background: isUser
              ? "#1677ff"
              : "var(--ai-chat-assistant-bubble-bg)",
            color: isUser ? "#fff" : "var(--surface-text)",
            borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: 1.65,
            border: isUser
              ? "none"
              : "1px solid var(--ai-chat-assistant-bubble-border)",
            boxShadow: isUser
              ? "none"
              : "var(--ai-chat-assistant-bubble-shadow)",
            maxWidth: "100%",
            overflowX: "hidden",
            // 气泡不再自己滚动：长回复随消息流自然铺开，由外层对话区统一滚动，
            // 避免出现"框内小滚动条"，阅读与流式输出都更连贯。
            overflowY: "visible",
            wordBreak: "break-word",
            overflowWrap: "anywhere",
          }}
        >
          {isUser ? (
            <div
              style={{
                whiteSpace: "pre-wrap",
                wordBreak: "break-word",
                overflowWrap: "anywhere",
              }}
            >
              {message.content}
            </div>
          ) : (
            <div className={streaming ? "ai-assistant-streaming-body" : undefined}>
              <MarkdownContent content={displayedContent} />
            </div>
          )}
          {attachments.length > 0 ? (
            <div
              style={{
                marginTop: 8,
                display: "flex",
                flexWrap: "wrap",
                gap: 6,
              }}
            >
              {attachments.map((attachment) => (
                <OpsFilterChip
                  key={attachment.id}
                  tone={attachment.category === "image" ? "info" : "neutral"}
                  style={{ marginInlineEnd: 0 }}
                >
                  {attachment.fileName} · {formatFileSize(attachment.size)}
                </OpsFilterChip>
              ))}
            </div>
          ) : null}
          {message.voiceInput?.transcript ? (
            <Typography.Text
              style={{
                display: "block",
                marginTop: 8,
                fontSize: 12,
                color: isUser
                  ? "rgba(255,255,255,0.88)"
                  : "var(--ai-chat-assistant-muted)",
              }}
            >
              语音输入：{message.voiceInput.transcript}
            </Typography.Text>
          ) : null}
          {!isUser && (message.actionDescriptors?.length ?? 0) > 0 ? (
            <Space wrap size={[6, 6]} style={{ marginTop: 8 }}>
              {message.actionDescriptors!.map((descriptor) => (
                <OpsIconActionButton
                  key={descriptor.id}
                  size="small"
                  opsTone={
                    descriptor.riskLevel === "critical"
                      ? "danger"
                      : descriptor.riskLevel === "high"
                        ? "primary"
                        : "default"
                  }
                  loading={loadingActionId === descriptor.id}
                  onClick={() => onAction(descriptor)}
                >
                  {descriptor.label}
                </OpsIconActionButton>
              ))}
            </Space>
          ) : null}
        </div>
        <Typography.Text
          type="secondary"
          style={{ fontSize: 11, marginTop: 4 }}
        >
          {formatTime(message.createdAt)}
        </Typography.Text>
      </div>
    </div>
  );
}

interface SessionItem {
  id: string;
  title: string;
  updatedAt: string;
  messageCount: number;
}

/**
 * Groups sessions by recency the way mainstream AI consoles do, so a long
 * history stays scannable instead of turning into one flat list.
 */
function groupSessionsByRecency(
  sessions: SessionItem[],
): Array<{ label: string; items: SessionItem[] }> {
  const now = Date.now();
  const dayMs = 24 * 60 * 60 * 1000;
  const buckets: Array<{ label: string; items: SessionItem[] }> = [
    { label: "今天", items: [] },
    { label: "昨天", items: [] },
    { label: "近 7 天", items: [] },
    { label: "更早", items: [] },
  ];
  for (const session of sessions) {
    const updated = new Date(session.updatedAt).getTime();
    const age = Number.isFinite(updated) ? now - updated : Number.POSITIVE_INFINITY;
    if (age < dayMs) buckets[0]!.items.push(session);
    else if (age < 2 * dayMs) buckets[1]!.items.push(session);
    else if (age < 7 * dayMs) buckets[2]!.items.push(session);
    else buckets[3]!.items.push(session);
  }
  return buckets.filter((bucket) => bucket.items.length > 0);
}


export default function AiAssistantPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { accessToken, isInitializing, role } = useAuth();
  const isAdmin = role === "admin" || role === "platform-admin";
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [sessionListCollapsed, setSessionListCollapsed] = useState(false);
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<
    AiMessageAttachment[]
  >([]);
  const [voiceInputMeta, setVoiceInputMeta] = useState<AiVoiceInputMeta | null>(
    null,
  );
  const [recording, setRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [alertDrawerOpen, setAlertDrawerOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionClusterId, setActionClusterId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deferredQueryReady, setDeferredQueryReady] = useState(false);
  const [cacheHydrated, setCacheHydrated] = useState(false);
  // 流式回复：streamingText 为当前正在生成的助手文本，done 后由服务端权威
  // 消息替换，保证与刷新后看到的内容完全一致。
  const [streamingText, setStreamingText] = useState("");
  const [streamReady, setStreamReady] = useState<boolean | null>(null);

  const requestedClusterId = searchParams.get("clusterId")?.trim() || getClusterIdFromPathname(pathname) || "";

  const [alertForm, setAlertForm] = useState({
    title: "Pod 持续重启",
    severity: "critical",
    namespace: "default",
    kind: "Pod",
    source: "webhook",
    description: "容器连续重启，疑似启动依赖异常",
  });

  const inputRef = useRef<TextAreaRef>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const streamClientRef = useRef<ReturnType<typeof createAiAssistantStreamClient> | null>(null);
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordStartAtRef = useRef<number>(0);

  const { data: presets } = useQuery<PresetQuestion[]>({
    queryKey: ["ai-assistant", "presets"],
    queryFn: () => getPresetQuestions(accessToken || undefined),
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    staleTime: 5 * 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const { data: suggestions } = useQuery({
    queryKey: ["ai-assistant", "suggestions"],
    queryFn: () => getAiSuggestions(accessToken || undefined),
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    staleTime: 20_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: 30000,
  });
  const { data: clustersData } = useQuery({
    queryKey: ["ai-assistant", "clusters", accessToken],
    queryFn: async () => {
      const { getClusters } = await import("@/lib/api/clusters");
      return getClusters(
        { state: "active", selectableOnly: true },
        accessToken!,
      );
    },
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    staleTime: 2 * 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (requestedClusterId && requestedClusterId !== actionClusterId) {
      setActionClusterId(requestedClusterId);
    }
  }, [actionClusterId, requestedClusterId]);

  useEffect(() => {
    if (!actionClusterId && clustersData?.items?.length) {
      const preferred =
        clustersData.items.find((item) => item.hasKubeconfig !== false)?.id ??
        clustersData.items[0]!.id;
      setActionClusterId(preferred);
    }
  }, [actionClusterId, clustersData?.items]);

  const {
    data: pingData,
    isFetching: pingLoading,
    refetch: refetchPing,
  } = useQuery({
    queryKey: ["ai-assistant", "config-ping"],
    queryFn: () => pingAiConfig(accessToken || undefined),
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    retry: false,
    staleTime: 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const {
    data: providersData,
    isFetching: providersLoading,
    refetch: refetchProviders,
  } = useQuery({
    queryKey: ["ai-assistant", "providers"],
    queryFn: () => listAiProviders(accessToken || undefined),
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    retry: false,
    staleTime: 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  // The model pill describes what is actually wired up: the ping result is the
  // authority for reachability, the provider list supplies vendor and model.
  const { data: vendorCatalog } = useQuery<AiProviderCatalogItem[]>({
    queryKey: ["ai-assistant", "provider-catalog"],
    queryFn: () => listAiProviderCatalog(accessToken || undefined),
    enabled:
      deferredQueryReady && !isInitializing && Boolean(accessToken) && isAdmin,
    staleTime: 30 * 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const vendorLabels = useMemo(() => {
    const map = new Map<string, string>();
    for (const item of vendorCatalog ?? []) map.set(item.id, item.label);
    return map;
  }, [vendorCatalog]);

  const activeProvider = useMemo<AiProvider | undefined>(() => {
    const providers = providersData ?? [];
    return (
      providers.find((item) => item.enabled && item.isDefault) ??
      providers.find((item) => item.enabled) ??
      providers[0]
    );
  }, [providersData]);

  const modelPill = useMemo(() => {
    const configured = Boolean(activeProvider);
    const label = activeProvider
      ? [
          vendorLabels.get(activeProvider.vendor) ?? activeProvider.vendor,
          activeProvider.modelName,
        ]
          .filter(Boolean)
          .join(" · ")
      : "未配置模型";
    const tone = !configured
      ? "neutral"
      : pingData?.ok
        ? "success"
        : "danger";
    return {
      label,
      tone,
      title: !configured
        ? "尚未配置 AI 模型，点击前往配置"
        : pingData?.ok
          ? `模型可用：${label}`
          : `模型不可用：${pingData?.message ?? "未检测"}`,
    };
  }, [activeProvider, pingData, vendorLabels]);

  useEffect(() => {
    if (isInitializing || !accessToken || !isAdmin) {
      setDeferredQueryReady(false);
      return;
    }
    const timeout = window.setTimeout(() => setDeferredQueryReady(true), 200);
    return () => window.clearTimeout(timeout);
  }, [accessToken, isAdmin, isInitializing]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({
      behavior: loading ? "smooth" : "auto",
    });
  }, [messages.length, loading, streamingText]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ctor =
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionCtor;
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).SpeechRecognition ??
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionCtor;
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).webkitSpeechRecognition;
    setVoiceSupported(Boolean(ctor));
    return () => {
      recognitionRef.current?.stop();
      recognitionRef.current = null;
    };
  }, []);

  const syncSession = useCallback((session: AiConversationSession) => {
    const item: SessionItem = {
      id: session.id,
      title: session.title,
      updatedAt: session.updatedAt,
      messageCount: session.messages.length,
    };
    setSessions((prev) => {
      const existed = prev.some((s) => s.id === item.id);
      const merged = existed
        ? prev.map((s) => (s.id === item.id ? item : s))
        : [item, ...prev];
      return merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const updateMessagesWithLatest = useCallback(
    (msgs: AiConversationMessage[]) => {
      setMessages(msgs);
    },
    [],
  );

  // 建立一次流式连接并长期复用；连接失败时把 streamReady 置为 false，
  // 发送逻辑会自动回退到原来的非流式 REST 调用。
  useEffect(() => {
    if (!cacheHydrated || isInitializing || !isAdmin || !accessToken) {
      return undefined;
    }
    const client = createAiAssistantStreamClient({
      token: accessToken,
      handlers: {
        onStatus: (status) => setStreamReady(status === "connected"),
        onDelta: (delta) => setStreamingText((prev) => prev + delta),
        onDone: (payload) => {
          setStreamingText("");
          setLoading(false);
          syncSession(payload.session);
          updateMessagesWithLatest(payload.session.messages);
        },
        onError: (payload) => {
          setStreamingText("");
          setLoading(false);
          void message.error(payload.message);
        },
      },
    });
    streamClientRef.current = client;
    return () => {
      client.dispose();
      streamClientRef.current = null;
      setStreamReady(null);
    };
  }, [accessToken, cacheHydrated, isAdmin, isInitializing, syncSession, updateMessagesWithLatest]);

  useEffect(() => {
    if (typeof window === "undefined" || !cacheHydrated) {
      return;
    }
    localStorage.setItem(
      AI_ASSISTANT_SESSIONS_CACHE_KEY,
      JSON.stringify(sessions),
    );
  }, [cacheHydrated, sessions]);

  useEffect(() => {
    if (typeof window === "undefined" || !cacheHydrated) {
      return;
    }
    if (!currentSessionId) {
      localStorage.removeItem(AI_ASSISTANT_CURRENT_SESSION_KEY);
      return;
    }
    localStorage.setItem(AI_ASSISTANT_CURRENT_SESSION_KEY, currentSessionId);
  }, [cacheHydrated, currentSessionId]);

  useEffect(() => {
    if (typeof window === "undefined" || !cacheHydrated || !currentSessionId) {
      return;
    }
    localStorage.setItem(
      `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${currentSessionId}`,
      JSON.stringify(messages),
    );
  }, [cacheHydrated, currentSessionId, messages]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (isInitializing || !accessToken || !isAdmin) {
      setCacheHydrated(false);
      return;
    }
    let cancelled = false;
    setCacheHydrated(false);

    const cachedSessionsRaw = localStorage.getItem(
      AI_ASSISTANT_SESSIONS_CACHE_KEY,
    );
    if (cachedSessionsRaw) {
      try {
        const parsed = JSON.parse(cachedSessionsRaw) as SessionItem[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setSessions(parsed);
        }
      } catch {
        localStorage.removeItem(AI_ASSISTANT_SESSIONS_CACHE_KEY);
      }
    }

    const cachedCurrent = localStorage.getItem(
      AI_ASSISTANT_CURRENT_SESSION_KEY,
    );
    if (cachedCurrent) {
      setCurrentSessionId(cachedCurrent);
      const cachedMessagesRaw = localStorage.getItem(
        `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${cachedCurrent}`,
      );
      if (cachedMessagesRaw) {
        try {
          const parsed = JSON.parse(
            cachedMessagesRaw,
          ) as AiConversationMessage[];
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          }
        } catch {
          localStorage.removeItem(
            `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${cachedCurrent}`,
          );
        }
      }
    }
    setCacheHydrated(true);

    void (async () => {
      try {
        const remoteSessions = await listSessions(accessToken);
        if (cancelled) {
          return;
        }
        const items: SessionItem[] = remoteSessions.map((session) => ({
          id: session.id,
          title: session.title,
          updatedAt: session.updatedAt,
          messageCount: session.messages.length,
        }));
        setSessions(items);

        const targetSessionId = cachedCurrent || items[0]?.id || null;
        if (!targetSessionId) {
          setCurrentSessionId(null);
          setMessages([]);
          return;
        }

        setCurrentSessionId(targetSessionId);
        const session = await getSession(targetSessionId, accessToken);
        if (cancelled) {
          return;
        }
        syncSession(session);
        setMessages(session.messages);
      } catch {
        if (cancelled) {
          return;
        }
        if (cachedCurrent) {
          setCurrentSessionId(null);
          setMessages([]);
          localStorage.removeItem(AI_ASSISTANT_CURRENT_SESSION_KEY);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [accessToken, isAdmin, isInitializing, syncSession]);

  const handleNewSession = useCallback(async () => {
    if (!accessToken || creating) {
      return;
    }
    setCreating(true);
    try {
      const result = await createSession(
        {
          title: "KubeNova 会话",
          surface: "console",
          clusterId: actionClusterId || undefined,
          namespace: alertForm.namespace || undefined,
        },
        accessToken,
      );
      const session =
        "session" in result
          ? (result as SendMessageResponse).session
          : (result as AiConversationSession);
      syncSession(session);
      setCurrentSessionId(session.id);
      setMessages(session.messages);
    } catch (error) {
      const text = error instanceof Error ? error.message : "创建会话失败";
      message.error(text);
    } finally {
      setCreating(false);
    }
  }, [
    accessToken,
    actionClusterId,
    alertForm.namespace,
    creating,
    syncSession,
  ]);

  const handleSelectSession = useCallback(
    async (sessionId: string) => {
      if (!accessToken || sessionId === currentSessionId) {
        return;
      }
      try {
        setCurrentSessionId(sessionId);
        const session = await getSession(sessionId, accessToken);
        syncSession(session);
        setMessages(session.messages);
        if (session.clusterContext?.clusterId) {
          setActionClusterId(session.clusterContext.clusterId);
        }
        if (session.clusterContext?.namespace) {
          setAlertForm((prev) => ({
            ...prev,
            namespace: session.clusterContext?.namespace ?? prev.namespace,
          }));
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "读取会话失败";
        message.error(text);
      }
    },
    [accessToken, currentSessionId, syncSession],
  );

  const handleDeleteSession = useCallback(
    async (sessionId: string) => {
      if (!accessToken) {
        return;
      }
      const toDelete = sessions.find((item) => item.id === sessionId);
      setDeleteTargetId(toDelete?.id ?? sessionId);
      setDeleteDialogOpen(true);
    },
    [accessToken, sessions],
  );

  const deleteTarget: AiDeleteSessionTarget | null = useMemo(() => {
    if (!deleteTargetId) {
      return null;
    }
    const found = sessions.find((item) => item.id === deleteTargetId);
    if (found) {
      return {
        id: found.id,
        title: found.title,
        updatedAt: found.updatedAt,
        messageCount: found.messageCount,
      };
    }
    return {
      id: deleteTargetId,
      title: deleteTargetId,
      updatedAt: new Date().toISOString(),
      messageCount: 0,
    };
  }, [deleteTargetId, sessions]);

  const handleCancelDelete = useCallback(() => {
    if (deleting) {
      return;
    }
    setDeleteDialogOpen(false);
    setDeleteTargetId(null);
  }, [deleting]);

  const handleConfirmDelete = useCallback(async () => {
    if (!accessToken || !deleteTargetId) {
      return;
    }
    setDeleting(true);
    try {
      await deleteSession(deleteTargetId, accessToken);
      const remaining = sessions.filter((item) => item.id !== deleteTargetId);
      setSessions(remaining);
      localStorage.removeItem(
        `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${deleteTargetId}`,
      );
      if (currentSessionId === deleteTargetId) {
        const fallbackSessionId = remaining[0]?.id ?? null;
        setCurrentSessionId(fallbackSessionId);
        if (!fallbackSessionId) {
          setMessages([]);
        } else {
          try {
            const session = await getSession(fallbackSessionId, accessToken);
            syncSession(session);
            setMessages(session.messages);
          } catch {
            setMessages([]);
          }
        }
      }
      message.success("会话已删除");
      setDeleteDialogOpen(false);
      setDeleteTargetId(null);
    } catch (error) {
      const text = error instanceof Error ? error.message : "删除会话失败";
      message.error(text);
    } finally {
      setDeleting(false);
    }
  }, [accessToken, currentSessionId, deleteTargetId, sessions, syncSession]);

  const handleFileChoose = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleFileChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (!files?.length || !accessToken) {
        return;
      }
      const list = Array.from(files);
      try {
        const uploaded = await Promise.all(
          list.map(async (file) => {
            try {
              return await uploadAttachment(file, accessToken);
            } catch {
              // 后端可先占位，前端兜底生成本地附件元数据
              return {
                id: `local-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
                fileName: file.name,
                mimeType: file.type || "application/octet-stream",
                size: file.size,
                category: file.type.startsWith("image/") ? "image" : "file",
                uploadedAt: new Date().toISOString(),
                placeholder: true,
              } as AiMessageAttachment;
            }
          }),
        );
        setPendingAttachments((prev) => [...prev, ...uploaded]);
      } finally {
        event.target.value = "";
      }
    },
    [accessToken],
  );

  const handleRemovePendingAttachment = useCallback((id: string) => {
    setPendingAttachments((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const toggleRecording = useCallback(() => {
    if (recording) {
      recognitionRef.current?.stop();
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionCtor;
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).SpeechRecognition ??
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionCtor;
          webkitSpeechRecognition?: SpeechRecognitionCtor;
        }
      ).webkitSpeechRecognition;

    if (!Ctor) {
      message.warning("当前浏览器不支持语音输入");
      return;
    }

    const recognition = new Ctor();
    recognition.lang = "zh-CN";
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.onstart = () => {
      recordStartAtRef.current = Date.now();
      setRecording(true);
      message.info("开始录音，请说话");
    };
    recognition.onerror = (event) => {
      setRecording(false);
      const err = event.error || "unknown";
      message.warning(`语音识别失败：${err}`);
    };
    recognition.onend = () => {
      setRecording(false);
      recognitionRef.current = null;
    };
    recognition.onresult = (event) => {
      let transcript = "";
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        transcript += event.results[i]?.[0]?.transcript ?? "";
      }
      const cleaned = transcript.trim();
      if (!cleaned) {
        return;
      }
      setInputText((prev) =>
        prev.trim() ? `${prev.trim()}\n${cleaned}` : cleaned,
      );
      const durationMs = Math.max(0, Date.now() - recordStartAtRef.current);
      setVoiceInputMeta({
        transcript: cleaned,
        durationMs,
        language: "zh-CN",
      });
      message.success("已写入语音转文本");
    };

    recognitionRef.current = recognition;
    recognition.start();
  }, [recording]);

  const handleSend = useCallback(
    async (text: string) => {
      const textPayload = text.trim();
      if (loading || !accessToken) {
        return;
      }
      const attachmentsToSend = [...pendingAttachments];
      const voiceToSend = voiceInputMeta ?? undefined;
      const payload =
        textPayload ||
        (attachmentsToSend.length > 0
          ? "请基于我上传的附件给出诊断建议。"
          : "");
      if (!payload) {
        return;
      }

      setInputText("");
      setPendingAttachments([]);
      setVoiceInputMeta(null);

      if (!currentSessionId) {
        const canStreamFirstMessage =
          attachmentsToSend.length === 0 &&
          !voiceToSend &&
          streamReady !== false &&
          Boolean(streamClientRef.current);

        // 流式可用时先只建会话，再把首条消息交给 WebSocket，这样首条回复
        // 也能在对话区逐步铺开；带附件/语音时仍走 REST（网关暂不处理附件）。
        if (canStreamFirstMessage) {
          setLoading(true);
          try {
            const created = await createSession(
              {
                title: payload.slice(0, 30),
                surface: "console",
                clusterId: actionClusterId || undefined,
                namespace: alertForm.namespace || undefined,
                resourceKind: alertForm.kind || undefined,
              },
              accessToken,
            );
            const session =
              "session" in created
                ? (created as SendMessageResponse).session
                : (created as AiConversationSession);
            syncSession(session);
            setCurrentSessionId(session.id);

            const optimisticFirst: AiConversationMessage = {
              id: `optimistic-${Date.now()}`,
              role: "user",
              content: payload,
              createdAt: new Date().toISOString(),
            };
            setMessages([...session.messages, optimisticFirst]);
            streamClientRef.current?.send({
              requestId: `req-${Date.now()}`,
              sessionId: session.id,
              message: payload,
              clusterId: actionClusterId || undefined,
              namespace: alertForm.namespace || undefined,
              resourceKind: alertForm.kind || undefined,
            });
          } catch (error) {
            const text = error instanceof Error ? error.message : "发送失败";
            message.error(text);
            setLoading(false);
          }
          return;
        }

        setLoading(true);
        try {
          const result = await createSession(
            {
              title: payload.slice(0, 30),
              message: payload,
              attachments: attachmentsToSend.length
                ? attachmentsToSend
                : undefined,
              voiceInput: voiceToSend,
              surface: "console",
              clusterId: actionClusterId || undefined,
              namespace: alertForm.namespace || undefined,
              resourceKind: alertForm.kind || undefined,
            },
            accessToken,
          );
          const session =
            "session" in result
              ? (result as SendMessageResponse).session
              : (result as AiConversationSession);
          syncSession(session);
          setCurrentSessionId(session.id);
          updateMessagesWithLatest(session.messages);
        } catch (error) {
          const text = error instanceof Error ? error.message : "发送失败";
          message.error(text);
        } finally {
          setLoading(false);
        }
        return;
      }

      const optimistic: AiConversationMessage = {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content: payload,
        createdAt: new Date().toISOString(),
        attachments: attachmentsToSend,
        voiceInput: voiceToSend,
      };
      setMessages((prev) => [...prev, optimistic]);
      setLoading(true);

      // 优先走流式通道，让回复在对话区逐步铺开；若通道不可用则回退 REST。
      const dispatched = streamClientRef.current?.send({
        requestId: `req-${Date.now()}`,
        sessionId: currentSessionId,
        message: payload,
        clusterId: actionClusterId || undefined,
        namespace: alertForm.namespace || undefined,
        resourceKind: alertForm.kind || undefined,
      });
      if (dispatched && streamReady !== false) {
        return;
      }

      try {
        const resp = await sendMessage(
          currentSessionId,
          {
            message: payload,
            attachments: attachmentsToSend.length
              ? attachmentsToSend
              : undefined,
            voiceInput: voiceToSend,
            clusterId: actionClusterId || undefined,
            namespace: alertForm.namespace || undefined,
            resourceKind: alertForm.kind || undefined,
          },
          accessToken,
        );
        syncSession(resp.session);
        updateMessagesWithLatest(resp.session.messages);
      } catch (error) {
        setMessages((prev) => prev.filter((m) => m.id !== optimistic.id));
        const text = error instanceof Error ? error.message : "发送失败";
        message.error(text);
      } finally {
        setLoading(false);
      }
    },
    [
      accessToken,
      actionClusterId,
      alertForm.kind,
      alertForm.namespace,
      currentSessionId,
      loading,
      pendingAttachments,
      streamReady,
      syncSession,
      updateMessagesWithLatest,
      voiceInputMeta,
    ],
  );

  const parseKindAndName = (resourceId?: string) => {
    if (!resourceId) return null;
    const parts = resourceId.split("/");
    if (parts.length !== 2) return null;
    const kind = parts[0]?.trim();
    const name = parts[1]?.trim();
    if (!kind || !name) return null;
    return { kind, name };
  };

  const appendAssistantExecutionMessage = useCallback((content: string) => {
    const msg: AiConversationMessage = {
      id: `local-exec-${Date.now()}`,
      role: "assistant",
      content,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, msg]);
  }, []);

  const buildExecutionMessage = useCallback(
    (
      descriptor: AiActionDescriptor,
      result: Awaited<ReturnType<typeof executeAction>>,
    ) => {
      const lines: string[] = [];
      lines.push(
        result.status === "success"
          ? `动作执行成功：${descriptor.label}`
          : `动作执行失败：${descriptor.label}`,
      );
      lines.push(`请求ID：${result.requestId}`);
      lines.push(`操作：${result.operation}`);
      if (result.error?.message) {
        lines.push(`错误：${result.error.message}`);
      }
      if (result.result?.length) {
        lines.push("结果：");
        lines.push("```json");
        lines.push(JSON.stringify(result.result, null, 2));
        lines.push("```");
      }
      if (result.rollbackSuggestion) {
        lines.push(`回滚建议：${result.rollbackSuggestion}`);
      }
      if (result.writeback && !result.writeback.persisted) {
        lines.push(`会话回写失败：${result.writeback.error ?? "unknown"}`);
      }
      return lines.join("\n");
    },
    [],
  );

  const confirmHighRiskAction = useCallback(
    (
      descriptor: AiActionDescriptor,
      action: AiActionExecuteRequest,
    ): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;
        Modal.confirm({
          title: descriptor.confirmation?.title || "确认执行高风险动作",
          okText: "确认执行",
          cancelText: "取消",
          okButtonProps: { danger: true },
          content: (
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>{descriptor.label}</Typography.Text>
              {descriptor.confirmation?.summary ? (
                <Typography.Text type="secondary">
                  {descriptor.confirmation.summary}
                </Typography.Text>
              ) : null}
              <OpsCommandPreview
                allowCopy={false}
                content={formatHighRiskActionPreview(action)}
                kind="approval"
                language="Action"
                title="高风险动作摘要"
                tone="danger"
                wrap
              />
              <Typography.Text type="danger">
                该操作可能造成业务波动，请确认目标后再继续。
              </Typography.Text>
            </Space>
          ),
          onOk: () => {
            settled = true;
            resolve(true);
          },
          onCancel: () => {
            settled = true;
            resolve(false);
          },
          afterClose: () => {
            if (!settled) {
              resolve(false);
            }
          },
        });
      }),
    [],
  );

  const handleExecuteDescriptor = useCallback(
    async (descriptor: AiActionDescriptor) => {
      if (!accessToken) {
        message.warning("请先登录");
        return;
      }
      if (descriptor.kind === "navigate" && descriptor.routePath) {
        router.push(descriptor.routePath);
        return;
      }
      if (descriptor.kind === "apply-filter" && descriptor.routePath) {
        const query = new URLSearchParams();
        if (descriptor.filterKey && descriptor.filterValue) {
          query.set(descriptor.filterKey, descriptor.filterValue);
        }
        router.push(
          query.toString()
            ? `${descriptor.routePath}?${query.toString()}`
            : descriptor.routePath,
        );
        return;
      }

      const op = normalizeAiAssistantActionOperation(
        typeof descriptor.operation === "string"
          ? descriptor.operation
          : undefined,
      );
      if (!op) {
        message.warning("该动作缺少可执行 operation 或 operation 不受支持");
        return;
      }

      const action: AiActionExecuteRequest = {
        operation: op,
        sessionId: currentSessionId || undefined,
      };
      const targetFromDescriptor = descriptor.target ?? {};
      const parsedResource = parseKindAndName(descriptor.resourceId);
      if (op.startsWith("query-")) {
        const clusterId = targetFromDescriptor.clusterId ?? actionClusterId;
        if (!clusterId) {
          message.warning("查询类动作需要集群上下文");
          return;
        }
        action.target = {
          ...targetFromDescriptor,
          clusterId,
          namespace:
            targetFromDescriptor.namespace ?? alertForm.namespace ?? undefined,
        };
        action.options = {
          ...descriptor.options,
          namespace:
            descriptor.options?.namespace ??
            targetFromDescriptor.namespace ??
            alertForm.namespace ??
            undefined,
          limit: descriptor.options?.limit ?? 20,
        };
      } else if (op === "import-helm-repository-presets") {
        const clusterId = targetFromDescriptor.clusterId ?? actionClusterId;
        if (!clusterId) {
          message.warning("导入仓库模板需要集群上下文");
          return;
        }
        action.target = {
          ...targetFromDescriptor,
          clusterId,
        };
        action.options = {
          ...descriptor.options,
          sync: descriptor.options?.sync ?? true,
          presetNames: descriptor.options?.presetNames,
        };
      } else if (op === "restart-workload") {
        const clusterId = targetFromDescriptor.clusterId ?? actionClusterId;
        if (!clusterId) {
          message.warning("请先选择集群上下文后再执行重启动作");
          return;
        }
        action.target = {
          clusterId,
          namespace:
            targetFromDescriptor.namespace ?? alertForm.namespace ?? "default",
          kind:
            targetFromDescriptor.kind ?? parsedResource?.kind ?? "Deployment",
          name: targetFromDescriptor.name ?? parsedResource?.name ?? "",
        };
        if (!action.target.name) {
          message.warning("该动作缺少资源名称，无法执行重启");
          return;
        }
      } else if (
        op === "vm-power-on" ||
        op === "vm-power-off" ||
        op === "vm-restart"
      ) {
        const vmId = targetFromDescriptor.vmId ?? parsedResource?.name ?? "";
        const provider =
          targetFromDescriptor.provider ?? parsedResource?.kind ?? "";
        const clusterId = targetFromDescriptor.clusterId ?? actionClusterId;
        if (!provider || !vmId) {
          message.warning("该虚机动作缺少 provider/vmId，无法执行");
          return;
        }
        action.target = {
          clusterId: clusterId || undefined,
          namespace:
            targetFromDescriptor.namespace ?? alertForm.namespace ?? undefined,
          provider,
          vmId,
        };
      }

      if (HIGH_RISK_ACTIONS.has(op)) {
        const confirmed = await confirmHighRiskAction(descriptor, action);
        if (!confirmed) {
          appendAssistantExecutionMessage(`动作已取消：${descriptor.label}`);
          return;
        }
      }

      try {
        setActionLoadingId(descriptor.id);
        const result = await executeAction(action, accessToken);
        let sessionRefreshed = false;
        if (currentSessionId) {
          try {
            const latestSession = await getSession(
              currentSessionId,
              accessToken,
            );
            syncSession(latestSession);
            updateMessagesWithLatest(latestSession.messages);
            sessionRefreshed = true;
          } catch {
            sessionRefreshed = false;
          }
        }
        if (!sessionRefreshed || result.writeback?.persisted === false) {
          appendAssistantExecutionMessage(
            buildExecutionMessage(descriptor, result),
          );
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : "动作执行失败";
        appendAssistantExecutionMessage(`动作执行失败：${text}`);
      } finally {
        setActionLoadingId(null);
      }
    },
    [
      accessToken,
      actionClusterId,
      alertForm.namespace,
      appendAssistantExecutionMessage,
      buildExecutionMessage,
      confirmHighRiskAction,
      currentSessionId,
      router,
      syncSession,
      updateMessagesWithLatest,
    ],
  );

  const handlePreset = useCallback(
    async (preset: PresetQuestion) => {
      if (!accessToken || loading) {
        return;
      }
      setLoading(true);
      try {
        const result = await createSession(
          {
            title: preset.title,
            presetQuestionId: preset.id,
            surface: "console",
            clusterId: actionClusterId || undefined,
            namespace: alertForm.namespace || undefined,
          },
          accessToken,
        );
        const session =
          "session" in result
            ? (result as SendMessageResponse).session
            : (result as AiConversationSession);
        syncSession(session);
        setCurrentSessionId(session.id);
        updateMessagesWithLatest(session.messages);
      } catch (error) {
        const text = error instanceof Error ? error.message : "启动预设失败";
        message.error(text);
      } finally {
        setLoading(false);
      }
    },
    [
      accessToken,
      actionClusterId,
      alertForm.namespace,
      loading,
      syncSession,
      updateMessagesWithLatest,
    ],
  );

  const handleTriggerDiagnosis = useCallback(async () => {
    const prompt = [
      `【告警接入】`,
      `标题: ${alertForm.title}`,
      `严重级别: ${alertForm.severity}`,
      `名称空间: ${alertForm.namespace}`,
      `资源类型: ${alertForm.kind}`,
      `来源: ${alertForm.source}`,
      `描述: ${alertForm.description}`,
      "请输出：1) 影响面 2) 根因推断 3) 处置步骤 4) 风险等级",
    ].join("\n");
    await handleSend(prompt);
  }, [alertForm, handleSend]);

  const handleInputEnter = useCallback(
    (event: KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        void handleSend(inputText);
      }
    },
    [handleSend, inputText],
  );

  const currentSession = useMemo(
    () => sessions.find((s) => s.id === currentSessionId),
    [currentSessionId, sessions],
  );

  const sessionGroups = useMemo(
    () => groupSessionsByRecency(sessions),
    [sessions],
  );

  // Starter cards for an empty conversation. Preset questions come from the
  // backend so they can track live alerts; the local list is the fallback.
  const starterPrompts = useMemo<
    Array<{ key: string; label: string; prompt: string; category: string }>
  >(() => {
    const remote = (presets ?? [])
      .filter((item) => item.question?.trim())
      .slice(0, 4)
      .map((item) => ({
        key: item.id,
        label: item.title,
        prompt: item.question,
        category: item.category,
      }));
    if (remote.length > 0) return remote;
    return QUICK_PROMPTS.map((prompt, index) => ({
      key: `quick-${index}`,
      label: prompt,
      prompt,
      category: "快捷提问",
    }));
  }, [presets]);

  const criticalCount = useMemo(
    () =>
      suggestions?.items.filter((item) => item.severity === "critical")
        .length ?? 0,
    [suggestions],
  );
  const highCount = useMemo(
    () =>
      suggestions?.items.filter((item) => item.severity === "high").length ?? 0,
    [suggestions],
  );
  const clusterOptions = useMemo(
    () =>
      (clustersData?.items ?? []).map((cluster) => ({
        label: `${cluster.name} (${cluster.id})`,
        value: cluster.id,
      })),
    [clustersData?.items],
  );

  if (!isInitializing && !isAdmin) {
    return (
      <OpsSurface variant="panel" padding="md">
        <Result
          status="403"
          title="无权限访问 KubeNova 中台"
          subTitle="当前账号不是管理员，无法查看会话、建议与执行任何 AI 运维动作。"
          extra={
            <OpsIconActionButton
              opsTone="primary"
              onClick={() => router.push("/")}
            >
              返回首页
            </OpsIconActionButton>
          }
        />
      </OpsSurface>
    );
  }

  const alertSimulator = (
    <>
      <Input
        id="alert-title"
        name="alert-title"
        value={alertForm.title}
        onChange={(e) =>
          setAlertForm((prev) => ({ ...prev, title: e.target.value }))
        }
        placeholder="告警标题"
      />
      <Space.Compact style={{ width: "100%" }}>
        <Select
          id="alert-severity"
          value={alertForm.severity}
          style={{ width: "35%" }}
          options={[
            { label: "critical", value: "critical" },
            { label: "high", value: "high" },
            { label: "medium", value: "medium" },
            { label: "low", value: "low" },
          ]}
          onChange={(value) =>
            setAlertForm((prev) => ({ ...prev, severity: value }))
          }
        />
        <Input
          id="alert-namespace"
          name="alert-namespace"
          value={alertForm.namespace}
          onChange={(e) =>
            setAlertForm((prev) => ({ ...prev, namespace: e.target.value }))
          }
          placeholder="namespace"
        />
      </Space.Compact>
      <Space.Compact style={{ width: "100%" }}>
        <Select
          id="alert-kind"
          value={alertForm.kind}
          style={{ width: "35%" }}
          options={["Pod", "Deployment", "StatefulSet", "Node"].map((v) => ({
            label: v,
            value: v,
          }))}
          onChange={(value) =>
            setAlertForm((prev) => ({ ...prev, kind: value }))
          }
        />
        <Input
          id="alert-source"
          name="alert-source"
          value={alertForm.source}
          onChange={(e) =>
            setAlertForm((prev) => ({ ...prev, source: e.target.value }))
          }
          placeholder="source"
        />
      </Space.Compact>
      <TextArea
        id="alert-description"
        name="alert-description"
        value={alertForm.description}
        onChange={(e) =>
          setAlertForm((prev) => ({ ...prev, description: e.target.value }))
        }
        autoSize={{ minRows: 3, maxRows: 5 }}
        placeholder="告警详情"
      />
      <OpsIconActionButton
        opsTone="primary"
        onClick={() => void handleTriggerDiagnosis()}
        loading={loading}
      >
        触发诊断
      </OpsIconActionButton>

      <Divider style={{ margin: "8px 0" }} />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        预置场景
      </Typography.Text>
      <Space orientation="vertical" style={{ width: "100%" }}>
        {(presets ?? []).map((preset) => (
          <OpsIconActionButton
            key={preset.id}
            block
            icon={<ClusterOutlined />}
            style={{ textAlign: "left", justifyContent: "flex-start" }}
            onClick={() => void handlePreset(preset)}
            disabled={loading || !accessToken}
          >
            {preset.title}
          </OpsIconActionButton>
        ))}
      </Space>
    </>
  );

  return (
    <div
      className="resource-workbench ops-workbench-shell ops-workbench-shell--ai"
      style={{
        display: "grid",
        gridTemplateRows: "auto minmax(0, 1fr)",
        gap: 12,
        width: "100%",
        minWidth: 0,
        minHeight: 0,
        overflow: "visible",
      }}
    >
      <OpsSurface
        className="ai-assistant-hero-surface"
        variant="panel"
        padding="sm"
        style={{ flex: "0 0 auto", minWidth: 0, overflow: "hidden" }}
      >
        <ResourcePageHeader
          path="/ai-assistant"
          embedded
          className="resource-workbench__header ai-assistant-workbench__header"
          title={
            <span className="resource-workbench__title-row">
              <span className="resource-workbench__title-row">
                <Image className="ai-assistant-title-icon" src="/kubenova-ai-icon.svg" alt="" aria-hidden="true" width={28} height={28} priority />
                <span className="resource-workbench__title">AI 助手</span>
              </span>
              <OpsFilterChip tone="info" className="resource-workbench__kind-chip" style={{ margin: 0 }}>
                ChatOps
              </OpsFilterChip>
            </span>
          }
          description="通过告警接入、智能诊断、ChatOps 会话和可执行建议形成闭环运维。"
          extra={
            <Space wrap size={8}>
              <OpsIconActionButton
                icon={<ApiOutlined />}
                onClick={() => setAlertDrawerOpen(true)}
                disabled={isInitializing || !accessToken}
              >
                告警接入
              </OpsIconActionButton>
              <OpsIconActionButton
                icon={<ReloadOutlined />}
                loading={pingLoading || providersLoading}
                onClick={() => {
                  void refetchPing();
                  void refetchProviders();
                }}
                disabled={isInitializing || !accessToken}
              >
                检测模型
              </OpsIconActionButton>
              <button
                type="button"
                className="ai-assistant-model-pill"
                data-tone={modelPill.tone}
                onClick={() => router.push("/settings/ai")}
                title={modelPill.title}
              >
                <span className="ai-assistant-model-pill__dot" aria-hidden="true" />
                <span className="ai-assistant-model-pill__body">
                  <strong>AI 模型</strong>
                  <em>{modelPill.label}</em>
                </span>
              </button>
              <OpsIconActionButton
                opsTone="primary"
                icon={<RobotOutlined />}
                onClick={() => {
                  if (!actionClusterId) {
                    message.warning("请先选择一个集群");
                    return;
                  }
                  void handleSend("请分析当前集群的健康状态，并基于实时告警、资源、事件和拓扑给出根因候选、影响范围与排障建议。");
                }}
                disabled={isInitializing || !accessToken || !actionClusterId || loading}
              >
                分析当前集群
              </OpsIconActionButton>
            </Space>
          }
        />

        <div className="ai-assistant-status-bar">
          <div className="ai-assistant-status-bar__item" data-tone="info">
            <span>活跃告警</span>
            <strong>{suggestions?.items.length ?? 0}</strong>
            <small>严重 {criticalCount} · 高风险 {highCount}</small>
          </div>
          <div className="ai-assistant-status-bar__item" data-tone="danger">
            <span>严重告警</span>
            <strong>{criticalCount}</strong>
            <small>{criticalCount > 0 ? "需优先诊断" : "当前无严重告警"}</small>
          </div>
          <div className="ai-assistant-status-bar__item" data-tone="warning">
            <span>高风险告警</span>
            <strong>{highCount}</strong>
            <small>{highCount > 0 ? "建议纳入处置队列" : "当前无高风险告警"}</small>
          </div>
        </div>
      </OpsSurface>

      <Row
        gutter={[12, 12]}
        style={{ flex: 1, minHeight: 0, minWidth: 0, alignItems: "stretch" }}
      >
        <Col
          xs={24}
          xl={24}
          style={{ display: "flex", minHeight: 0, minWidth: 0 }}
        >
          <OpsSurface
            title="ChatOps"
            actions={
              <OpsStatusTag tone="processing">
                {currentSessionId ? "会话中" : "待启动"}
              </OpsStatusTag>
            }
            variant="workbench"
            padding="none"
            className="ai-assistant-chat-surface"
            style={{
              flex: 1,
              height: CHAT_WORKSPACE_DESKTOP_HEIGHT,
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            <Layout
              style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}
            >
              <Sider
                width={260}
                collapsedWidth={0}
                collapsed={sessionListCollapsed}
                collapsible
                trigger={null}
                style={{
                  background: "var(--ai-chat-sider-bg)",
                  borderRight: "1px solid var(--ai-chat-sider-border)",
                  display: "flex",
                  flexDirection: "column",
                  minHeight: 0,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <div className="ai-assistant-session-rail">
                  <OpsIconActionButton
                    opsTone="primary"
                    block
                    icon={<PlusOutlined />}
                    loading={creating}
                    onClick={() => void handleNewSession()}
                    disabled={isInitializing || !accessToken}
                  >
                    新建会话
                  </OpsIconActionButton>

                  <div className="ai-assistant-session-rail__body">
                    {sessionGroups.length === 0 ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description="暂无会话"
                        style={{ marginTop: 32 }}
                      />
                    ) : (
                      sessionGroups.map((group) => (
                        <div key={group.label} className="ai-assistant-session-group">
                          <div className="ai-assistant-session-group__label">
                            {group.label}
                          </div>
                          <List
                            size="small"
                            split={false}
                            dataSource={group.items}
                            renderItem={(session) => (
                              <List.Item
                                className="ai-assistant-session-item"
                                data-active={
                                  session.id === currentSessionId ? "true" : undefined
                                }
                                onClick={() => void handleSelectSession(session.id)}
                                onKeyDown={(event) => {
                                  if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    void handleSelectSession(session.id);
                                  }
                                }}
                                role="button"
                                tabIndex={0}
                                aria-current={
                                  session.id === currentSessionId ? "true" : undefined
                                }
                              >
                                <div className="ai-assistant-session-item__body">
                                  <Typography.Text
                                    strong={session.id === currentSessionId}
                                    ellipsis
                                    style={{ display: "block" }}
                                  >
                                    {session.title}
                                  </Typography.Text>
                                  <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                    {session.messageCount} 条 · {formatTime(session.updatedAt)}
                                  </Typography.Text>
                                </div>
                                <Tooltip title="删除会话">
                                  <OpsIconActionButton
                                    size="small"
                                    opsTone="danger"
                                    className="ai-assistant-session-item__delete resource-table-icon-action-compact"
                                    icon={<DeleteOutlined />}
                                    aria-label="删除会话"
                                    onClick={(event) => {
                                      event.stopPropagation();
                                      void handleDeleteSession(session.id);
                                    }}
                                  />
                                </Tooltip>
                              </List.Item>
                            )}
                          />
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </Sider>

              <Content
                style={{
                  display: "flex",
                  flexDirection: "column",
                  background: "var(--ai-chat-content-bg)",
                  minHeight: 0,
                  minWidth: 0,
                  overflow: "hidden",
                }}
              >
                <div
                  className="ai-assistant-chat-context-header"
                  style={{
                    padding: "12px 16px 8px",
                    borderBottom: "1px solid var(--ai-chat-header-border)",
                    background: "var(--ai-chat-header-bg)",
                    overflowX: "hidden",
                  }}
                >
                  <Space size={8} wrap style={{ width: "100%" }}>
                    <Tooltip
                      title={sessionListCollapsed ? "展开会话历史" : "收起会话历史"}
                    >
                      <OpsIconActionButton
                        className="resource-table-icon-action-compact"
                        aria-label={sessionListCollapsed ? "展开会话历史" : "收起会话历史"}
                        icon={<MenuUnfoldOutlined />}
                        onClick={() => setSessionListCollapsed((prev) => !prev)}
                      />
                    </Tooltip>
                    <Typography.Text type="secondary">
                      执行上下文集群:
                    </Typography.Text>
                    <Select
                      id="ai-action-cluster"
                      style={{ width: 220, maxWidth: "100%" }}
                      value={actionClusterId || undefined}
                      onChange={setActionClusterId}
                      placeholder="选择集群"
                      options={clusterOptions}
                    />
                    {currentSession ? (
                      <OpsFilterChip tone="neutral">
                        {currentSession.title}
                      </OpsFilterChip>
                    ) : null}
                  </Space>
                </div>

                <div
                  style={{
                    flex: 1,
                    minHeight: 0,
                    minWidth: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    overscrollBehaviorY: "contain",
                    scrollbarGutter: "stable",
                    padding: "14px 16px",
                  }}
                >
                  {messages.length === 0 ? (
                    <div className="ai-assistant-starter">
                      <div className="ai-assistant-starter__intro">
                        <Image
                          className="ai-assistant-starter__icon"
                          src="/kubenova-ai-icon.svg"
                          alt=""
                          aria-hidden="true"
                          width={44}
                          height={44}
                          priority
                        />
                        <h2>开始一条 ChatOps 会话</h2>
                        <p>
                          描述你遇到的运维问题，或从下面选择一个典型场景，AI 会结合实时集群上下文给出分析与建议。
                        </p>
                      </div>
                      <div className="ai-assistant-starter__grid">
                        {starterPrompts.map((item) => (
                          <button
                            key={item.key}
                            type="button"
                            className="ai-assistant-starter__card"
                            onClick={() => void handleSend(item.prompt)}
                            disabled={loading || !accessToken}
                          >
                            <span className="ai-assistant-starter__card-category">
                              {item.category}
                            </span>
                            <span className="ai-assistant-starter__card-label">
                              {item.label}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    messages.map((item) => (
                      <MessageBubble
                        key={item.id}
                        message={item}
                        onAction={handleExecuteDescriptor}
                        loadingActionId={actionLoadingId}
                      />
                    ))
                  )}

                  {streamingText ? (
                    <MessageBubble
                      key="assistant-streaming"
                      message={{
                        id: "assistant-streaming",
                        role: "assistant",
                        content: streamingText,
                        createdAt: new Date().toISOString(),
                      }}
                      onAction={handleExecuteDescriptor}
                      loadingActionId={actionLoadingId}
                      streaming
                    />
                  ) : null}

                  {loading && !streamingText && (
                    <div
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        padding: 12,
                      }}
                    >
                      <Spin size="small" />
                      <Typography.Text
                        type="secondary"
                        style={{ fontSize: 13 }}
                      >
                        KubeNova 中台正在分析...
                      </Typography.Text>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div
                  style={{
                    padding: "8px 12px",
                    borderTop: "1px solid var(--ai-chat-composer-border)",
                    background: "var(--ai-chat-composer-bg)",
                    overflowX: "hidden",
                  }}
                >
                  <input
                    id="ai-assistant-file-input"
                    name="ai-assistant-file-input"
                    ref={fileInputRef}
                    type="file"
                    multiple
                    style={{ display: "none" }}
                    accept="image/*,.txt,.log,.json,.yaml,.yml,.md,.pdf,.csv"
                    onChange={(event) => {
                      void handleFileChange(event);
                    }}
                  />

                  {pendingAttachments.length > 0 || voiceInputMeta ? (
                    <div style={{ marginBottom: 8 }}>
                      <Space wrap size={[6, 6]}>
                        {pendingAttachments.map((attachment) => (
                          <OpsFilterChip
                            key={attachment.id}
                            tone={
                              attachment.category === "image"
                                ? "info"
                                : "neutral"
                            }
                            closable
                            onClose={(event) => {
                              event.preventDefault();
                              handleRemovePendingAttachment(attachment.id);
                            }}
                          >
                            {attachment.fileName} ·{" "}
                            {formatFileSize(attachment.size)}
                          </OpsFilterChip>
                        ))}
                        {voiceInputMeta ? (
                          <OpsFilterChip
                            tone="warning"
                            icon={<AudioOutlined />}
                          >
                            语音转写{" "}
                            {voiceInputMeta.durationMs
                              ? `${Math.round(voiceInputMeta.durationMs / 1000)}s`
                              : ""}
                          </OpsFilterChip>
                        ) : null}
                      </Space>
                    </div>
                  ) : null}

                  <div
                    className="ai-assistant-composer"
                  >
                    <Tooltip title="上传文件/图片">
                      <OpsIconActionButton
                        className="resource-table-icon-action-compact ai-assistant-composer__tool"
                        icon={<PaperClipOutlined />}
                        aria-label="上传文件或图片"
                        onClick={handleFileChoose}
                        disabled={loading || isInitializing || !accessToken}
                      />
                    </Tooltip>
                    <Tooltip title={recording ? "停止录音" : "语音输入"}>
                      <OpsIconActionButton
                        className="resource-table-icon-action-compact ai-assistant-composer__tool"
                        icon={recording ? <StopOutlined /> : <AudioOutlined />}
                        aria-label={recording ? "停止录音" : "语音输入"}
                        onClick={toggleRecording}
                        disabled={
                          !voiceSupported ||
                          loading ||
                          isInitializing ||
                          !accessToken
                        }
                        opsTone={recording ? "danger" : "default"}
                      />
                    </Tooltip>
                    <TextArea
                      id="ai-assistant-input"
                      name="ai-assistant-input"
                      ref={inputRef}
                      value={inputText}
                      onChange={(e) => setInputText(e.target.value)}
                      onKeyDown={handleInputEnter}
                      autoSize={{ minRows: 1, maxRows: 4 }}
                      placeholder="输入运维问题（Enter 发送，Shift+Enter 换行）"
                      disabled={loading || isInitializing || !accessToken}
                      variant="borderless"
                      className="ai-assistant-composer__input"
                      style={{ minWidth: 0 }}
                    />
                    <Tooltip title="发送">
                      <OpsIconActionButton
                        opsTone="primary"
                        className="resource-table-icon-action-compact ai-assistant-composer__send"
                        icon={<SendOutlined />}
                        aria-label="发送消息"
                        onClick={() => void handleSend(inputText)}
                        loading={loading}
                        disabled={
                          (!inputText.trim() &&
                            pendingAttachments.length === 0) ||
                          isInitializing ||
                          !accessToken
                        }
                      />
                    </Tooltip>
                  </div>
                </div>
              </Content>
            </Layout>
          </OpsSurface>
        </Col>
      </Row>

      <AiDeleteSessionDialog
        open={deleteDialogOpen}
        target={deleteTarget}
        loading={deleting}
        onCancel={handleCancelDelete}
        onConfirm={() => void handleConfirmDelete()}
      />
      <OpsDrawerShell
        title={
          <Space>
            <ApiOutlined />
            告警接入模拟
          </Space>
        }
        open={alertDrawerOpen}
        onClose={() => setAlertDrawerOpen(false)}
        variant="business"
        styles={{ body: { padding: 12, overflowY: "auto" } }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {alertSimulator}
        </div>
      </OpsDrawerShell>
    </div>
  );
}
