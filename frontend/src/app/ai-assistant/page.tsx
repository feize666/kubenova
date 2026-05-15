"use client";

import {
  AudioOutlined,
  ApiOutlined,
  ClusterOutlined,
  DeleteOutlined,
  MessageOutlined,
  PaperClipOutlined,
  PlusOutlined,
  ReloadOutlined,
  RobotOutlined,
  SendOutlined,
  SettingOutlined,
  StopOutlined,
  UserOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import {
  Avatar,
  Button,
  Card,
  Col,
  Divider,
  Drawer,
  Empty,
  Form,
  Grid,
  Input,
  InputNumber,
  Layout,
  List,
  Modal,
  Row,
  Result,
  Select,
  Space,
  Spin,
  Statistic,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { TextAreaRef } from "antd/es/input/TextArea";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/components/auth-context";
import { AiDeleteSessionDialog, type AiDeleteSessionTarget } from "@/components/ai/delete-session-dialog";
import {
  createSession,
  executeAction,
  deleteSession,
  getAiConfig,
  getAiSuggestions,
  getPresetQuestions,
  listSessions,
  getSession,
  pingAiConfig,
  saveAiConfig,
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
  type AiModelConfig,
  type PresetQuestion,
  type SaveAiConfigInput,
  type SendMessageResponse,
} from "@/lib/api/ai-assistant";

const { Sider, Content } = Layout;
const { TextArea } = Input;

const QUICK_PROMPTS = [
  "请总结过去1小时活跃告警并给出处置优先级",
  "请分析近期 Pod 重启异常的潜在根因",
  "请给出当前工作负载扩缩容与资源优化建议",
  "请评估当前发布风险并给出回滚判定条件",
];
const AI_ASSISTANT_CURRENT_SESSION_KEY = "kubenova.ai.assistant.currentSessionId";
const AI_ASSISTANT_SESSIONS_CACHE_KEY = "kubenova.ai.assistant.sessions";
const AI_ASSISTANT_MESSAGES_CACHE_PREFIX = "kubenova.ai.assistant.messages.";
const CHAT_WORKSPACE_DESKTOP_HEIGHT = "clamp(520px, calc(100vh - 240px), 720px)";
const MESSAGE_BUBBLE_MAX_HEIGHT = "min(42vh, 320px)";
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

function MarkdownContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        p: ({ children }) => <p style={{ margin: "0 0 8px", lineHeight: 1.7, wordBreak: "break-word", overflowWrap: "anywhere" }}>{children}</p>,
        ul: ({ children }) => <ul style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ul>,
        ol: ({ children }) => <ol style={{ margin: "4px 0 8px", paddingLeft: 20 }}>{children}</ol>,
        li: ({ children }) => <li style={{ marginBottom: 2, lineHeight: 1.6 }}>{children}</li>,
        code: ({ children, className }) => {
          const text = String(children ?? "");
          const isBlock = className?.startsWith("language-") || text.includes("\n");
          if (isBlock) {
            return (
              <pre
                style={{
                  background: "var(--ai-chat-code-bg)",
                  borderRadius: 6,
                  padding: "8px 12px",
                  maxWidth: "100%",
                  overflowX: "auto",
                  overflowY: "auto",
                  maxHeight: 320,
                  overscrollBehaviorX: "contain",
                  overscrollBehaviorY: "contain",
                  fontSize: 12,
                  margin: "8px 0",
                  lineHeight: 1.5,
                }}
              >
                <code>{children}</code>
              </pre>
            );
          }
          return (
            <code
              style={{
                background: "var(--ai-chat-inline-code-bg)",
                borderRadius: 3,
                padding: "1px 5px",
                fontSize: "0.88em",
                fontFamily: "monospace",
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
}: {
  message: AiConversationMessage;
  onAction: (descriptor: AiActionDescriptor) => void;
  loadingActionId: string | null;
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
        style={{ background: isUser ? "#2f54eb" : "#1677ff", color: "#fff", flexShrink: 0 }}
      />
      <div style={{ maxWidth: "78%", minWidth: 0, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
        <div
          style={{
            background: isUser ? "#1677ff" : "var(--ai-chat-assistant-bubble-bg)",
            color: isUser ? "#fff" : "var(--surface-text)",
            borderRadius: isUser ? "16px 4px 16px 16px" : "4px 16px 16px 16px",
            padding: "10px 14px",
            fontSize: 14,
            lineHeight: 1.65,
            border: isUser ? "none" : "1px solid var(--ai-chat-assistant-bubble-border)",
            boxShadow: isUser ? "none" : "var(--ai-chat-assistant-bubble-shadow)",
            maxWidth: "100%",
            overflowX: "hidden",
            maxHeight: MESSAGE_BUBBLE_MAX_HEIGHT,
            overflowY: "auto",
            overscrollBehaviorY: "contain",
          }}
        >
          {isUser ? <div style={{ whiteSpace: "pre-wrap", wordBreak: "break-word", overflowWrap: "anywhere" }}>{message.content}</div> : <MarkdownContent content={displayedContent} />}
          {attachments.length > 0 ? (
            <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
              {attachments.map((attachment) => (
                <Tag key={attachment.id} color={attachment.category === "image" ? "blue" : "geekblue"} style={{ marginInlineEnd: 0 }}>
                  {attachment.fileName} · {formatFileSize(attachment.size)}
                </Tag>
              ))}
            </div>
          ) : null}
          {message.voiceInput?.transcript ? (
            <Typography.Text
              style={{
                display: "block",
                marginTop: 8,
                fontSize: 12,
                color: isUser ? "rgba(255,255,255,0.88)" : "var(--ai-chat-assistant-muted)",
              }}
            >
              语音输入：{message.voiceInput.transcript}
            </Typography.Text>
          ) : null}
          {!isUser && (message.actionDescriptors?.length ?? 0) > 0 ? (
            <Space wrap size={[6, 6]} style={{ marginTop: 8 }}>
              {message.actionDescriptors!.map((descriptor) => (
                <Button
                  key={descriptor.id}
                  size="small"
                  type={descriptor.riskLevel === "high" || descriptor.riskLevel === "critical" ? "primary" : "default"}
                  danger={descriptor.riskLevel === "critical"}
                  loading={loadingActionId === descriptor.id}
                  onClick={() => onAction(descriptor)}
                >
                  {descriptor.label}
                </Button>
              ))}
            </Space>
          ) : null}
        </div>
        <Typography.Text type="secondary" style={{ fontSize: 11, marginTop: 4 }}>
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

function ModelSettingsDrawer({ open, onClose, token }: { open: boolean; onClose: () => void; token?: string }) {
  const [form] = Form.useForm();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) {
      return;
    }
    setLoading(true);
    getAiConfig(token)
      .then((cfg: AiModelConfig) => {
        form.setFieldsValue({
          baseUrl: cfg.baseUrl,
          apiKey: "",
          modelName: cfg.modelName,
          maxTokens: cfg.maxTokens,
          timeoutMs: cfg.timeoutMs ?? 30000,
        });
      })
      .catch(() => {
        form.setFieldsValue({
          baseUrl: "https://api.openai.com/v1",
          apiKey: "",
          modelName: "gpt-4o-mini",
          maxTokens: 2048,
          timeoutMs: 30000,
        });
      })
      .finally(() => setLoading(false));
  }, [open, token, form]);

  const handleSave = useCallback(async () => {
    let values: {
      baseUrl: string;
      apiKey?: string;
      modelName: string;
      maxTokens: number;
      timeoutMs: number;
    };
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSaving(true);
    try {
      const payload: SaveAiConfigInput = {
        baseUrl: values.baseUrl,
        modelName: values.modelName,
        maxTokens: values.maxTokens,
        timeoutMs: values.timeoutMs,
      };
      if (values.apiKey?.trim()) {
        payload.apiKey = values.apiKey.trim();
      }
      await saveAiConfig(payload, token);
      message.success("模型中转站配置已保存");
      onClose();
    } catch (error) {
      const text = error instanceof Error ? error.message : "保存失败";
      message.error(text);
    } finally {
      setSaving(false);
    }
  }, [form, token, onClose]);

  return (
    <Drawer
      title="模型中转站设置"
      open={open}
      onClose={onClose}
      size="default"
      footer={
        <Space style={{ width: "100%", justifyContent: "flex-end" }}>
          <Button onClick={onClose}>取消</Button>
          <Button type="primary" loading={saving} onClick={() => void handleSave()}>
            保存
          </Button>
        </Space>
      }
    >
      <Spin spinning={loading}>
        <Form form={form} layout="vertical">
          <Form.Item
            label="Base URL"
            name="baseUrl"
            rules={[{ required: true, message: "请输入中转站 Base URL" }]}
            extra="支持 OpenAI chat/completions 兼容地址，例如 https://xxx/v1"
          >
            <Input id="ai-model-base-url" name="ai-model-base-url" placeholder="https://api.openai.com/v1" />
          </Form.Item>

          <Form.Item label="API Key" name="apiKey" extra="留空表示不修改当前 Key">
            <Input.Password id="ai-model-api-key" name="ai-model-api-key" placeholder="sk-..." autoComplete="off" />
          </Form.Item>

          <Form.Item label="Model" name="modelName" rules={[{ required: true, message: "请输入模型名称" }]}>
            <Input id="ai-model-name" name="ai-model-name" placeholder="gpt-4o-mini" />
          </Form.Item>

          <Form.Item label="最大 Tokens" name="maxTokens" rules={[{ required: true, message: "请输入最大 Tokens" }]}>
            <InputNumber id="ai-model-max-tokens" name="ai-model-max-tokens" min={128} max={131072} step={256} style={{ width: "100%" }} />
          </Form.Item>

          <Form.Item label="请求超时(ms)" name="timeoutMs" rules={[{ required: true, message: "请输入超时时间" }]}>
            <InputNumber id="ai-model-timeout" name="ai-model-timeout" min={3000} max={180000} step={1000} style={{ width: "100%" }} />
          </Form.Item>

          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            也可在 `.env.ai.local` 配置：`AI_MODEL_BASE_URL`、`AI_MODEL_API_KEY`、`AI_MODEL_NAME`、`AI_MODEL_MAX_TOKENS`、`AI_MODEL_TIMEOUT_MS`。
          </Typography.Text>
        </Form>
      </Spin>
    </Drawer>
  );
}

export default function AiAssistantPage() {
  const router = useRouter();
  const { accessToken, isInitializing, role } = useAuth();
  const isAdmin = role === "admin" || role === "platform-admin";
  const screens = Grid.useBreakpoint();
  const showAlertPanelInline = Boolean(screens.xl);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<AiConversationMessage[]>([]);
  const [inputText, setInputText] = useState("");
  const [pendingAttachments, setPendingAttachments] = useState<AiMessageAttachment[]>([]);
  const [voiceInputMeta, setVoiceInputMeta] = useState<AiVoiceInputMeta | null>(null);
  const [recording, setRecording] = useState(false);
  const [voiceSupported, setVoiceSupported] = useState(false);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [alertDrawerOpen, setAlertDrawerOpen] = useState(false);
  const [actionLoadingId, setActionLoadingId] = useState<string | null>(null);
  const [actionClusterId, setActionClusterId] = useState("");
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

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
  const recognitionRef = useRef<BrowserSpeechRecognition | null>(null);
  const recordStartAtRef = useRef<number>(0);

  const { data: presets } = useQuery<PresetQuestion[]>({
    queryKey: ["ai-assistant", "presets"],
    queryFn: () => getPresetQuestions(accessToken || undefined),
    enabled: !isInitializing && Boolean(accessToken) && isAdmin,
  });

  const { data: suggestions } = useQuery({
    queryKey: ["ai-assistant", "suggestions"],
    queryFn: () => getAiSuggestions(accessToken || undefined),
    enabled: !isInitializing && Boolean(accessToken) && isAdmin,
    refetchInterval: 30000,
  });
  const { data: clustersData } = useQuery({
    queryKey: ["ai-assistant", "clusters", accessToken],
    queryFn: async () => {
      const { getClusters } = await import("@/lib/api/clusters");
      return getClusters({ state: "active", selectableOnly: true }, accessToken!);
    },
    enabled: !isInitializing && Boolean(accessToken) && isAdmin,
  });

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
    enabled: !isInitializing && Boolean(accessToken) && isAdmin,
    retry: false,
    staleTime: 60_000,
  });

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const ctor = (
      window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).SpeechRecognition
      ?? (
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
      const merged = existed ? prev.map((s) => (s.id === item.id ? item : s)) : [item, ...prev];
      return merged.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    });
  }, []);

  const updateMessagesWithLatest = useCallback((msgs: AiConversationMessage[]) => {
    setMessages(msgs);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    localStorage.setItem(AI_ASSISTANT_SESSIONS_CACHE_KEY, JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    if (!currentSessionId) {
      localStorage.removeItem(AI_ASSISTANT_CURRENT_SESSION_KEY);
      return;
    }
    localStorage.setItem(AI_ASSISTANT_CURRENT_SESSION_KEY, currentSessionId);
  }, [currentSessionId]);

  useEffect(() => {
    if (typeof window === "undefined" || !currentSessionId) {
      return;
    }
    localStorage.setItem(
      `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${currentSessionId}`,
      JSON.stringify(messages),
    );
  }, [currentSessionId, messages]);

  useEffect(() => {
    if (typeof window === "undefined" || isInitializing || !accessToken || !isAdmin) {
      return;
    }
    let cancelled = false;

    const cachedSessionsRaw = localStorage.getItem(AI_ASSISTANT_SESSIONS_CACHE_KEY);
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

    const cachedCurrent = localStorage.getItem(AI_ASSISTANT_CURRENT_SESSION_KEY);
    if (cachedCurrent) {
      setCurrentSessionId(cachedCurrent);
      const cachedMessagesRaw = localStorage.getItem(
        `${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${cachedCurrent}`,
      );
      if (cachedMessagesRaw) {
        try {
          const parsed = JSON.parse(cachedMessagesRaw) as AiConversationMessage[];
          if (Array.isArray(parsed)) {
            setMessages(parsed);
          }
        } catch {
          localStorage.removeItem(`${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${cachedCurrent}`);
        }
      }
    }

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
          title: "AIOps 会话",
          surface: "console",
          clusterId: actionClusterId || undefined,
          namespace: alertForm.namespace || undefined,
        },
        accessToken,
      );
      const session = "session" in result ? (result as SendMessageResponse).session : (result as AiConversationSession);
      syncSession(session);
      setCurrentSessionId(session.id);
      setMessages(session.messages);
    } catch (error) {
      const text = error instanceof Error ? error.message : "创建会话失败";
      message.error(text);
    } finally {
      setCreating(false);
    }
  }, [accessToken, actionClusterId, alertForm.namespace, creating, syncSession]);

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
          setAlertForm((prev) => ({ ...prev, namespace: session.clusterContext?.namespace ?? prev.namespace }));
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
      localStorage.removeItem(`${AI_ASSISTANT_MESSAGES_CACHE_PREFIX}${deleteTargetId}`);
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

    const Ctor = (
      window as unknown as {
        SpeechRecognition?: SpeechRecognitionCtor;
        webkitSpeechRecognition?: SpeechRecognitionCtor;
      }
    ).SpeechRecognition
      ?? (
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
      setInputText((prev) => (prev.trim() ? `${prev.trim()}\n${cleaned}` : cleaned));
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
      const payload = textPayload || (attachmentsToSend.length > 0 ? "请基于我上传的附件给出诊断建议。" : "");
      if (!payload) {
        return;
      }

      setInputText("");
      setPendingAttachments([]);
      setVoiceInputMeta(null);

      if (!currentSessionId) {
        setLoading(true);
        try {
          const result = await createSession(
            {
              title: payload.slice(0, 30),
              message: payload,
              attachments: attachmentsToSend.length ? attachmentsToSend : undefined,
              voiceInput: voiceToSend,
              surface: "console",
              clusterId: actionClusterId || undefined,
              namespace: alertForm.namespace || undefined,
              resourceKind: alertForm.kind || undefined,
            },
            accessToken,
          );
          const session = "session" in result ? (result as SendMessageResponse).session : (result as AiConversationSession);
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

      try {
        const resp = await sendMessage(
          currentSessionId,
          {
            message: payload,
            attachments: attachmentsToSend.length ? attachmentsToSend : undefined,
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
    [accessToken, actionClusterId, alertForm.kind, alertForm.namespace, currentSessionId, loading, pendingAttachments, syncSession, updateMessagesWithLatest, voiceInputMeta],
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

  const buildExecutionMessage = useCallback((descriptor: AiActionDescriptor, result: Awaited<ReturnType<typeof executeAction>>) => {
    const lines: string[] = [];
    lines.push(result.status === "success" ? `动作执行成功：${descriptor.label}` : `动作执行失败：${descriptor.label}`);
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
  }, []);

  const confirmHighRiskAction = useCallback(
    (descriptor: AiActionDescriptor, action: AiActionExecuteRequest): Promise<boolean> =>
      new Promise((resolve) => {
        let settled = false;
        const target = action.target ?? {};
        Modal.confirm({
          title: descriptor.confirmation?.title || "确认执行高风险动作",
          okText: "确认执行",
          cancelText: "取消",
          okButtonProps: { danger: true },
          content: (
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>{descriptor.label}</Typography.Text>
              <Typography.Text type="secondary">操作: {action.operation}</Typography.Text>
              {descriptor.confirmation?.summary ? (
                <Typography.Text type="secondary">{descriptor.confirmation.summary}</Typography.Text>
              ) : null}
              {target.clusterId ? <Typography.Text type="secondary">集群: {target.clusterId}</Typography.Text> : null}
              {target.namespace ? <Typography.Text type="secondary">名称空间: {target.namespace}</Typography.Text> : null}
              {target.kind && target.name ? (
                <Typography.Text type="secondary">目标资源: {target.kind}/{target.name}</Typography.Text>
              ) : null}
              {target.provider ? <Typography.Text type="secondary">云厂商: {target.provider}</Typography.Text> : null}
              {target.vmId ? <Typography.Text type="secondary">虚机ID: {target.vmId}</Typography.Text> : null}
              <Typography.Text type="danger">该操作可能造成业务波动，请确认目标后再继续。</Typography.Text>
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
        router.push(query.toString() ? `${descriptor.routePath}?${query.toString()}` : descriptor.routePath);
        return;
      }

      const op = normalizeAiAssistantActionOperation(
        typeof descriptor.operation === "string" ? descriptor.operation : undefined,
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
          namespace: targetFromDescriptor.namespace ?? alertForm.namespace ?? undefined,
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
          namespace: targetFromDescriptor.namespace ?? alertForm.namespace ?? "default",
          kind: targetFromDescriptor.kind ?? parsedResource?.kind ?? "Deployment",
          name: targetFromDescriptor.name ?? parsedResource?.name ?? "",
        };
        if (!action.target.name) {
          message.warning("该动作缺少资源名称，无法执行重启");
          return;
        }
      } else if (op === "vm-power-on" || op === "vm-power-off" || op === "vm-restart") {
        const vmId = targetFromDescriptor.vmId ?? parsedResource?.name ?? "";
        const provider = targetFromDescriptor.provider ?? parsedResource?.kind ?? "";
        const clusterId = targetFromDescriptor.clusterId ?? actionClusterId;
        if (!provider || !vmId) {
          message.warning("该虚机动作缺少 provider/vmId，无法执行");
          return;
        }
        action.target = {
          clusterId: clusterId || undefined,
          namespace: targetFromDescriptor.namespace ?? alertForm.namespace ?? undefined,
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
            const latestSession = await getSession(currentSessionId, accessToken);
            syncSession(latestSession);
            updateMessagesWithLatest(latestSession.messages);
            sessionRefreshed = true;
          } catch {
            sessionRefreshed = false;
          }
        }
        if (!sessionRefreshed || result.writeback?.persisted === false) {
          appendAssistantExecutionMessage(buildExecutionMessage(descriptor, result));
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
        const session = "session" in result ? (result as SendMessageResponse).session : (result as AiConversationSession);
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
    [accessToken, actionClusterId, alertForm.namespace, loading, syncSession, updateMessagesWithLatest],
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

  const currentSession = sessions.find((s) => s.id === currentSessionId);

  const criticalCount = useMemo(() => suggestions?.items.filter((item) => item.severity === "critical").length ?? 0, [suggestions]);
  const highCount = useMemo(() => suggestions?.items.filter((item) => item.severity === "high").length ?? 0, [suggestions]);

  if (!isInitializing && !isAdmin) {
    return (
      <Card style={{ borderRadius: 12 }}>
        <Result
          status="403"
          title="无权限访问 AIOps 中台"
          subTitle="当前账号不是管理员，无法查看会话、建议与执行任何 AI 运维动作。"
          extra={
            <Button type="primary" onClick={() => router.push("/")}>
              返回首页
            </Button>
          }
        />
      </Card>
    );
  }

  const alertSimulator = (
    <>
      <Input
        id="alert-title"
        name="alert-title"
        value={alertForm.title}
        onChange={(e) => setAlertForm((prev) => ({ ...prev, title: e.target.value }))}
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
          onChange={(value) => setAlertForm((prev) => ({ ...prev, severity: value }))}
        />
        <Input
          id="alert-namespace"
          name="alert-namespace"
          value={alertForm.namespace}
          onChange={(e) => setAlertForm((prev) => ({ ...prev, namespace: e.target.value }))}
          placeholder="namespace"
        />
      </Space.Compact>
      <Space.Compact style={{ width: "100%" }}>
        <Select
          id="alert-kind"
          value={alertForm.kind}
          style={{ width: "35%" }}
          options={["Pod", "Deployment", "StatefulSet", "Node"].map((v) => ({ label: v, value: v }))}
          onChange={(value) => setAlertForm((prev) => ({ ...prev, kind: value }))}
        />
        <Input
          id="alert-source"
          name="alert-source"
          value={alertForm.source}
          onChange={(e) => setAlertForm((prev) => ({ ...prev, source: e.target.value }))}
          placeholder="source"
        />
      </Space.Compact>
      <TextArea
        id="alert-description"
        name="alert-description"
        value={alertForm.description}
        onChange={(e) => setAlertForm((prev) => ({ ...prev, description: e.target.value }))}
        autoSize={{ minRows: 3, maxRows: 5 }}
        placeholder="告警详情"
      />
      <Button type="primary" onClick={() => void handleTriggerDiagnosis()} loading={loading}>
        触发诊断
      </Button>

      <Divider style={{ margin: "8px 0" }} />

      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        预置场景
      </Typography.Text>
      <Space orientation="vertical" style={{ width: "100%" }}>
        {(presets ?? []).map((preset) => (
          <Button
            key={preset.id}
            block
            icon={<ClusterOutlined />}
            style={{ textAlign: "left", justifyContent: "flex-start" }}
            onClick={() => void handlePreset(preset)}
            disabled={loading || !accessToken}
          >
            {preset.title}
          </Button>
        ))}
      </Space>
    </>
  );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        width: "100%",
        minWidth: 0,
        height: "calc(100vh - 110px)",
        minHeight: 0,
        overflow: "hidden",
      }}
    >
      <Card style={{ borderRadius: 12, flex: "0 0 auto", minWidth: 0, overflow: "hidden" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
          <div>
            <Typography.Title level={3} style={{ margin: 0 }}>
              AIOps中台
            </Typography.Title>
            <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
              通过告警接入、智能诊断、ChatOps 会话和可执行建议形成闭环运维。
            </Typography.Paragraph>
          </div>
          <Space>
            {!showAlertPanelInline ? (
              <Button icon={<ApiOutlined />} onClick={() => setAlertDrawerOpen(true)} disabled={isInitializing || !accessToken}>
                告警接入
              </Button>
            ) : null}
            <Button
              icon={<ReloadOutlined />}
              loading={pingLoading}
              onClick={() => void refetchPing()}
              disabled={isInitializing || !accessToken}
            >
              检测中转站
            </Button>
            <Button
              type="primary"
              icon={<SettingOutlined />}
              onClick={() => setSettingsOpen(true)}
              disabled={isInitializing || !accessToken}
            >
              模型设置
            </Button>
          </Space>
        </div>

        <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="活跃告警" value={suggestions?.items.length ?? 0} prefix={<WarningOutlined />} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="严重告警" value={criticalCount} styles={{ content: { color: "#cf1322" } }} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Statistic title="高风险告警" value={highCount} styles={{ content: { color: "#d46b08" } }} />
            </Card>
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <Card size="small">
              <Space orientation="vertical" size={4} style={{ width: "100%" }}>
                <Typography.Text type="secondary">模型中转站</Typography.Text>
                <Tag color={pingData?.ok ? "success" : "error"} style={{ width: "fit-content" }}>
                  {pingData?.ok ? "在线" : "不可用"}
                </Tag>
                <Typography.Text style={{ fontSize: 12 }} ellipsis>
                  {pingData?.config.modelName ?? "未配置模型"}
                </Typography.Text>
              </Space>
            </Card>
          </Col>
        </Row>
      </Card>

      <Row gutter={[12, 12]} style={{ flex: 1, minHeight: 0, minWidth: 0, alignItems: "stretch" }}>
        {showAlertPanelInline ? (
          <Col xs={24} xl={9} style={{ display: "flex", minHeight: 0, minWidth: 0 }}>
            <Card
              title={
                <Space>
                  <ApiOutlined />
                  告警接入模拟
                </Space>
              }
              extra={<Tag color="blue">Webhook</Tag>}
              style={{
                borderRadius: 12,
                flex: 1,
                minHeight: 0,
                display: "flex",
                flexDirection: "column",
              }}
              styles={{
                body: {
                  flex: 1,
                  minHeight: 0,
                  display: "flex",
                  flexDirection: "column",
                  gap: 10,
                  overflowY: "auto",
                },
              }}
            >
              {alertSimulator}
            </Card>
          </Col>
        ) : null}

        <Col xs={24} xl={showAlertPanelInline ? 15 : 24} style={{ display: "flex", minHeight: 0, minWidth: 0 }}>
          <Card
            title={
              <Space>
                <MessageOutlined />
                ChatOps
              </Space>
            }
            extra={
              <Tag color="processing">
                {currentSessionId ? "会话中" : "待启动"}
              </Tag>
            }
            style={{
              borderRadius: 12,
              flex: 1,
              height: screens.xl ? CHAT_WORKSPACE_DESKTOP_HEIGHT : "calc(100vh - 220px)",
              minHeight: 0,
              minWidth: 0,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
            styles={{ body: { padding: 0, flex: 1, minHeight: 0, minWidth: 0, display: "flex", overflow: "hidden" } }}
          >
            <Layout style={{ flex: 1, minHeight: 0, minWidth: 0, overflow: "hidden" }}>
              <Sider
                width={240}
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
                <div style={{ padding: 12 }}>
                  <Button
                    type="primary"
                    block
                    icon={<PlusOutlined />}
                    loading={creating}
                    onClick={() => void handleNewSession()}
                    disabled={isInitializing || !accessToken}
                  >
                    新建会话
                  </Button>
                </div>

                <Divider style={{ margin: "0 0 6px" }} />

                <div
                  style={{
                    padding: "0 8px 8px",
                    flex: 1,
                    minHeight: 0,
                    overflowY: "auto",
                    overflowX: "hidden",
                    overscrollBehaviorY: "contain",
                    scrollbarGutter: "stable",
                  }}
                >
                  {sessions.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无会话" style={{ marginTop: 32 }} />
                  ) : (
                    <List
                      size="small"
                      dataSource={sessions}
                      renderItem={(session) => (
                        <List.Item
                          onClick={() => void handleSelectSession(session.id)}
                          style={{
                            cursor: "pointer",
                            marginBottom: 4,
                            borderRadius: 8,
                            border: session.id === currentSessionId ? "1px solid rgba(22,119,255,0.35)" : "1px solid transparent",
                            background: session.id === currentSessionId ? "rgba(22,119,255,0.06)" : "transparent",
                            padding: "8px 10px",
                          }}
                        >
                          <div style={{ width: "100%", display: "flex", alignItems: "center", gap: 8 }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <Typography.Text strong={session.id === currentSessionId} ellipsis style={{ display: "block" }}>
                                {session.title}
                              </Typography.Text>
                              <Typography.Text type="secondary" style={{ fontSize: 11 }}>
                                {session.messageCount} 条 · {formatTime(session.updatedAt)}
                              </Typography.Text>
                            </div>
                            <Tooltip title="删除会话">
                              <Button
                                size="small"
                                type="text"
                                danger
                                icon={<DeleteOutlined />}
                                onClick={(event) => {
                                  event.stopPropagation();
                                  void handleDeleteSession(session.id);
                                }}
                              />
                            </Tooltip>
                          </div>
                        </List.Item>
                      )}
                    />
                  )}
                </div>
              </Sider>

              <Content style={{ display: "flex", flexDirection: "column", background: "var(--ai-chat-content-bg)", minHeight: 0, minWidth: 0, overflow: "hidden" }}>
                <div style={{ padding: "12px 16px 8px", borderBottom: "1px solid var(--ai-chat-header-border)", background: "var(--ai-chat-header-bg)", overflowX: "hidden" }}>
                  <Space size={8} wrap style={{ width: "100%" }}>
                    <Typography.Text type="secondary">执行上下文集群:</Typography.Text>
                    <Select
                      id="ai-action-cluster"
                      style={{ width: 220, maxWidth: "100%" }}
                      value={actionClusterId || undefined}
                      onChange={setActionClusterId}
                      placeholder="选择集群"
                      options={(clustersData?.items ?? []).map((cluster) => ({
                        label: `${cluster.name} (${cluster.id})`,
                        value: cluster.id,
                      }))}
                    />
                    {currentSession ? <Tag>{currentSession.title}</Tag> : null}
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
                    <div style={{ paddingTop: 48 }}>
                      <Empty description="开始一条 ChatOps 会话" image={Empty.PRESENTED_IMAGE_SIMPLE} />
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

                  {loading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: 12 }}>
                      <Spin size="small" />
                      <Typography.Text type="secondary" style={{ fontSize: 13 }}>
                        AIOps 中台正在分析...
                      </Typography.Text>
                    </div>
                  )}
                  <div ref={messagesEndRef} />
                </div>

                <div style={{ padding: "8px 12px", borderTop: "1px solid var(--ai-chat-composer-border)", background: "var(--ai-chat-composer-bg)", overflowX: "hidden" }}>
                  <Space wrap size={[6, 6]} style={{ marginBottom: 8 }}>
                    {QUICK_PROMPTS.map((prompt) => (
                      <Button key={prompt} size="small" onClick={() => void handleSend(prompt)} disabled={loading || !accessToken}>
                        {prompt.slice(0, 14)}...
                      </Button>
                    ))}
                  </Space>

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

                  {(pendingAttachments.length > 0 || voiceInputMeta) ? (
                    <div style={{ marginBottom: 8 }}>
                      <Space wrap size={[6, 6]}>
                        {pendingAttachments.map((attachment) => (
                          <Tag
                            key={attachment.id}
                            color={attachment.category === "image" ? "blue" : "geekblue"}
                            closable
                            onClose={(event) => {
                              event.preventDefault();
                              handleRemovePendingAttachment(attachment.id);
                            }}
                          >
                            {attachment.fileName} · {formatFileSize(attachment.size)}
                          </Tag>
                        ))}
                        {voiceInputMeta ? (
                          <Tag color="purple" icon={<AudioOutlined />}>
                            语音转写 {voiceInputMeta.durationMs ? `${Math.round(voiceInputMeta.durationMs / 1000)}s` : ""}
                          </Tag>
                        ) : null}
                      </Space>
                    </div>
                  ) : null}

                  <div style={{ display: "flex", gap: 8, alignItems: "flex-end", minWidth: 0 }}>
                    <Space orientation="vertical" size={6}>
                      <Tooltip title="上传文件/图片">
                        <Button
                          icon={<PaperClipOutlined />}
                          onClick={handleFileChoose}
                          disabled={loading || isInitializing || !accessToken}
                        />
                      </Tooltip>
                      <Tooltip title={recording ? "停止录音" : "语音输入"}>
                        <Button
                          icon={recording ? <StopOutlined /> : <AudioOutlined />}
                          onClick={toggleRecording}
                          disabled={!voiceSupported || loading || isInitializing || !accessToken}
                          type={recording ? "primary" : "default"}
                          danger={recording}
                        />
                      </Tooltip>
                    </Space>
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
                      style={{ minWidth: 0 }}
                    />
                    <Tooltip title="发送">
                      <Button
                        type="primary"
                        icon={<SendOutlined />}
                        onClick={() => void handleSend(inputText)}
                        loading={loading}
                        disabled={
                          (!inputText.trim() && pendingAttachments.length === 0) ||
                          isInitializing ||
                          !accessToken
                        }
                      />
                    </Tooltip>
                  </div>
                </div>
              </Content>
            </Layout>
          </Card>
        </Col>
      </Row>

      <ModelSettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} token={accessToken || undefined} />
      <AiDeleteSessionDialog
        open={deleteDialogOpen}
        target={deleteTarget}
        loading={deleting}
        onCancel={handleCancelDelete}
        onConfirm={() => void handleConfirmDelete()}
      />
      <Drawer
        title={
          <Space>
            <ApiOutlined />
            告警接入模拟
          </Space>
        }
        open={!showAlertPanelInline && alertDrawerOpen}
        onClose={() => setAlertDrawerOpen(false)}
        size="default"
        styles={{ body: { padding: 12 } }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {alertSimulator}
        </div>
      </Drawer>
    </div>
  );
}
