"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  DatePicker,
  Input,
  Popover,
  Select,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import {
  DownOutlined,
  ArrowLeftOutlined,
  ClearOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import dayjs from "dayjs";
import type { Dayjs } from "dayjs";
import { useAuth } from "@/components/auth-context";
import {
  OpsFilterChip,
  OpsFrameShell,
  OpsIconActionButton,
  OpsStatusTag,
  OpsSurface,
  type OpsFrameShellState,
  type OpsStatusTone,
} from "@/components/ops";
import {
  createLogsStreamSession,
  getLogs,
  type LogRecord,
} from "@/lib/api/logs";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { resolveSafeRuntimeReturnTo } from "@/lib/api/runtime";
import {
  RuntimeLogsSocket,
  type LogsConnectionStatus,
  type LogsReconnectState,
  type RuntimeLogItem,
} from "@/lib/ws/logs";
import {
  buildGatewayWsCandidates,
  sanitizeSensitiveMessage,
} from "@/lib/ws/terminal";

type SeverityFilter = "INFO" | "WARN" | "ERROR";
type TimeMode = "quick" | "relative" | "absolute" | "recent";
type TimeUnit = "s" | "m" | "h" | "d";

const { RangePicker } = DatePicker;
const LOG_TIME_FORMAT = "YYYY-MM-DD HH:mm:ss";

const TAIL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "100", value: 100 },
  { label: "200", value: 200 },
  { label: "1000", value: 1000 },
  { label: "2500", value: 2500 },
  { label: "全部", value: -1 },
];

const QUICK_TIME_OPTIONS: Array<{
  label: string;
  from: string;
  seconds: number;
}> = [
  { label: "最近 15 分钟", from: "now-15m", seconds: 15 * 60 },
  { label: "最近 1 小时", from: "now-1h", seconds: 60 * 60 },
  { label: "最近 6 小时", from: "now-6h", seconds: 6 * 60 * 60 },
  { label: "最近 24 小时", from: "now-24h", seconds: 24 * 60 * 60 },
];

const RECENT_TIME_OPTIONS: Array<{
  label: string;
  from: string;
  seconds: number;
}> = [
  { label: "最近 5 分钟", from: "now-5m", seconds: 5 * 60 },
  { label: "最近 15 分钟", from: "now-15m", seconds: 15 * 60 },
  { label: "最近 30 分钟", from: "now-30m", seconds: 30 * 60 },
  { label: "最近 1 小时", from: "now-1h", seconds: 60 * 60 },
  { label: "最近 4 小时", from: "now-4h", seconds: 4 * 60 * 60 },
  { label: "最近 12 小时", from: "now-12h", seconds: 12 * 60 * 60 },
  { label: "最近 24 小时", from: "now-24h", seconds: 24 * 60 * 60 },
];

const TIME_MODE_OPTIONS: Array<{ label: string; value: TimeMode }> = [
  { label: "快捷", value: "quick" },
  { label: "相对时间", value: "relative" },
  { label: "绝对时间", value: "absolute" },
  { label: "最近使用", value: "recent" },
];

const TIME_UNIT_OPTIONS: Array<{ label: string; value: TimeUnit }> = [
  { label: "秒前", value: "s" },
  { label: "分钟前", value: "m" },
  { label: "小时前", value: "h" },
  { label: "天前", value: "d" },
];

const REFRESH_INTERVAL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "关闭", value: 0 },
  { label: "2秒", value: 2 },
  { label: "5秒", value: 5 },
  { label: "10秒", value: 10 },
  { label: "30秒", value: 30 },
  { label: "60秒", value: 60 },
];

const LEVEL_FILTER_OPTIONS: Array<{ label: string; value: SeverityFilter }> = [
  { label: "INFO", value: "INFO" },
  { label: "WARN", value: "WARN" },
  { label: "ERROR", value: "ERROR" },
];

const FALLBACK_TERMINAL_OPTIONS = {
  fontFamily:
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, Liberation Mono, monospace",
  fontSize: 13,
  lineHeight: 1.25,
  cursorBlink: false,
  convertEol: true,
  allowProposedApi: false,
};

function pickBool(raw: string | null, fallback: boolean): boolean {
  if (raw == null) return fallback;
  const normalized = raw.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return fallback;
}

function pickPositive(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function pickTailLines(raw: string | null, fallback: number): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  if (Number.isFinite(parsed) && (parsed === -1 || parsed > 0)) {
    return parsed;
  }
  return fallback;
}

function pickRefreshInterval(raw: string | null, fallback = 0): number {
  const parsed = Number.parseInt(raw ?? "", 10);
  return [0, 2, 5, 10, 30, 60].includes(parsed) ? parsed : fallback;
}

function normalizeLogTimeParam(raw: string | null): string {
  if (!raw?.trim()) return "";
  const parsed = dayjs(raw.trim());
  if (!parsed.isValid() || parsed.isAfter(dayjs())) return "";
  return parsed.toISOString();
}

function toLogTimeParam(value: Dayjs): string {
  return value.millisecond(0).toISOString();
}

function pickTimeMode(raw: string | null, fallback: TimeMode): TimeMode {
  return raw === "quick" ||
    raw === "relative" ||
    raw === "absolute" ||
    raw === "recent"
    ? raw
    : fallback;
}

function secondsToNowExpression(seconds: number): string {
  if (seconds % (24 * 60 * 60) === 0) return `now-${seconds / (24 * 60 * 60)}d`;
  if (seconds % (60 * 60) === 0) return `now-${seconds / (60 * 60)}h`;
  if (seconds % 60 === 0) return `now-${seconds / 60}m`;
  return `now-${seconds}s`;
}

function parseNowExpression(raw: string): number | null {
  const match = raw.trim().match(/^now-(\d+)([smhd])$/);
  if (!match) return null;
  const amount = Number.parseInt(match[1], 10);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const multipliers: Record<TimeUnit, number> = {
    s: 1,
    m: 60,
    h: 3600,
    d: 86400,
  };
  return amount * multipliers[match[2] as TimeUnit];
}

function secondsToRelativeInput(seconds: number): {
  amount: string;
  unit: TimeUnit;
} {
  if (seconds % 86400 === 0)
    return { amount: String(seconds / 86400), unit: "d" };
  if (seconds % 3600 === 0)
    return { amount: String(seconds / 3600), unit: "h" };
  if (seconds % 60 === 0) return { amount: String(seconds / 60), unit: "m" };
  return { amount: String(seconds), unit: "s" };
}

function normalizeTimeEndpoint(raw: string | null, fallback: string): string {
  const value = raw?.trim();
  if (!value) return fallback;
  if (value === "now") return "now";
  if (parseNowExpression(value) !== null) return value;
  const parsed = dayjs(value);
  if (!parsed.isValid()) return fallback;
  const capped = parsed.isAfter(dayjs()) ? dayjs() : parsed;
  return toLogTimeParam(capped);
}

function inferInitialTimeState(searchParams: URLSearchParams): {
  mode: TimeMode;
  from: string;
  to: string;
  sinceSeconds: number;
  sinceTime: string;
  untilTime: string;
  follow: boolean;
  relativeAmount: string;
  relativeUnit: TimeUnit;
} {
  const legacySinceSeconds = pickPositive(
    searchParams.get("sinceSeconds"),
    60 * 60,
  );
  const legacySinceTime = normalizeLogTimeParam(searchParams.get("sinceTime"));
  const legacyUntilTime = normalizeLogTimeParam(searchParams.get("untilTime"));
  const hasModernRange = Boolean(
    searchParams.get("from") || searchParams.get("to"),
  );
  const fallbackFrom =
    legacySinceTime || secondsToNowExpression(legacySinceSeconds);
  const fallbackTo = legacyUntilTime || "now";
  const from = normalizeTimeEndpoint(searchParams.get("from"), fallbackFrom);
  const to = normalizeTimeEndpoint(searchParams.get("to"), fallbackTo);
  const relativeSeconds = parseNowExpression(from) ?? legacySinceSeconds;
  const relativeInput = secondsToRelativeInput(relativeSeconds);
  const modeFallback: TimeMode =
    legacySinceTime || legacyUntilTime ? "absolute" : "quick";
  const mode = hasModernRange
    ? pickTimeMode(
        searchParams.get("timeMode"),
        parseNowExpression(from) ? "quick" : "absolute",
      )
    : pickTimeMode(searchParams.get("timeMode"), modeFallback);
  const toFollowsNow = to === "now";

  return {
    mode,
    from,
    to,
    sinceSeconds:
      toFollowsNow && parseNowExpression(from)
        ? parseNowExpression(from)!
        : legacySinceSeconds,
    sinceTime: parseNowExpression(from) ? "" : normalizeLogTimeParam(from),
    untilTime: toFollowsNow ? "" : normalizeLogTimeParam(to),
    follow: toFollowsNow ? pickBool(searchParams.get("follow"), true) : false,
    relativeAmount: relativeInput.amount,
    relativeUnit: relativeInput.unit,
  };
}

function disabledFutureLogDate(current: Dayjs | null): boolean {
  return Boolean(current?.isAfter(dayjs(), "day"));
}

function range(size: number): number[] {
  return Array.from({ length: size }, (_, index) => index);
}

function disabledFutureLogTime(current: Dayjs | null) {
  const now = dayjs();
  if (!current?.isSame(now, "day")) {
    return {};
  }
  return {
    disabledHours: () => range(24).filter((hour) => hour > now.hour()),
    disabledMinutes: (selectedHour: number) =>
      selectedHour === now.hour()
        ? range(60).filter((minute) => minute > now.minute())
        : [],
    disabledSeconds: (selectedHour: number, selectedMinute: number) =>
      selectedHour === now.hour() && selectedMinute === now.minute()
        ? range(60).filter((second) => second > now.second())
        : [],
  };
}

function buildBackHref(searchParams: URLSearchParams): string {
  const returnTo = resolveSafeRuntimeReturnTo(searchParams.get("returnTo"));
  if (returnTo) return returnTo;

  const params = new URLSearchParams();
  const clusterId =
    searchParams.get("returnClusterId")?.trim() ||
    searchParams.get("clusterId")?.trim() ||
    "";
  const namespace =
    searchParams.get("returnNamespace")?.trim() ||
    searchParams.get("namespace")?.trim() ||
    "";
  const keyword =
    searchParams.get("returnKeyword")?.trim() ||
    searchParams.get("pod")?.trim() ||
    "";
  const phase = searchParams.get("returnPhase")?.trim() || "";
  const page = searchParams.get("returnPage")?.trim() || "";

  if (clusterId) params.set("clusterId", clusterId);
  if (namespace) params.set("namespace", namespace);
  if (keyword) params.set("keyword", keyword);
  if (phase) params.set("phase", phase);
  if (page && Number.isFinite(Number.parseInt(page, 10)))
    params.set("page", page);

  return `/workloads/pods${params.toString() ? `?${params.toString()}` : ""}`;
}

function inferSeverity(text: string): SeverityFilter {
  const upper = text.toUpperCase();
  if (
    upper.includes("ERROR") ||
    upper.includes("FATAL") ||
    upper.includes("ERR ") ||
    upper.includes(" E!")
  ) {
    return "ERROR";
  }
  if (
    upper.includes("WARN") ||
    upper.includes("WRN ") ||
    upper.includes(" W!")
  ) {
    return "WARN";
  }
  return "INFO";
}

function safeJsonFormat(text: string): string {
  const trimmed = text.trim();
  if (!(trimmed.startsWith("{") || trimmed.startsWith("["))) {
    return text;
  }
  try {
    return JSON.stringify(JSON.parse(trimmed), null, 2);
  } catch {
    return text;
  }
}

function formatMetaLine(input: {
  item: RuntimeLogItem;
  beautify: boolean;
  formatJson: boolean;
  includeTimestamp: boolean;
}): string {
  const { item, beautify, formatJson, includeTimestamp } = input;
  const ts = new Date(item.ts).toISOString();
  const level = inferSeverity(item.text);
  const body = formatJson ? safeJsonFormat(item.text) : item.text;
  if (!beautify) {
    return body;
  }
  if (includeTimestamp) {
    return `${ts} ${level.toLowerCase()} ${body}`;
  }
  return `${level.toLowerCase()} ${body}`;
}

function colorizeTerminalLogLine(text: string): string {
  const level = inferSeverity(text);
  if (level === "ERROR") return `\x1b[31m${text}\x1b[0m`;
  if (level === "WARN") return `\x1b[33m${text}\x1b[0m`;
  return `\x1b[36m${text}\x1b[0m`;
}

function toDownloadText(
  lines: RuntimeLogItem[],
  options: {
    beautify: boolean;
    formatJson: boolean;
    includeTimestamp: boolean;
  },
): string {
  return lines
    .map((line) =>
      formatMetaLine({
        item: line,
        beautify: options.beautify,
        formatJson: options.formatJson,
        includeTimestamp: options.includeTimestamp,
      }),
    )
    .join("\n");
}

function applySeverityFilter(
  lines: RuntimeLogItem[],
  selected: SeverityFilter[],
): RuntimeLogItem[] {
  if (!selected.length) return lines;
  const set = new Set(selected);
  return lines.filter((line) => set.has(inferSeverity(line.text)));
}

function writeTerminalBatch(
  terminal: Terminal | null,
  lines: RuntimeLogItem[],
  options: {
    beautify: boolean;
    formatJson: boolean;
    includeTimestamp: boolean;
  },
): void {
  if (!terminal || lines.length === 0) return;
  terminal.write(
    lines
      .map((line) => {
        const formatted = formatMetaLine({
          item: line,
          beautify: options.beautify,
          formatJson: options.formatJson,
          includeTimestamp: options.includeTimestamp,
        });
        return `${colorizeTerminalLogLine(formatted)}\r\n`;
      })
      .join(""),
  );
}

function mapHistoryRecordsToRuntimeLogs(
  records: LogRecord[],
): RuntimeLogItem[] {
  return records.map((record) => ({
    id: record.id,
    text: record.message,
    ts: Date.parse(record.timestamp) || Date.now(),
    type: record.level === "ERROR" ? "stderr" : "stdout",
  }));
}

function isPreviousLogNotFoundError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  const text = error.message.toLowerCase();
  return (
    text.includes("previous terminated container") && text.includes("not found")
  );
}

function normalizeLogError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error || "");
  const lowered = message.toLowerCase();
  if (lowered.includes("pods") && lowered.includes("not found")) {
    return "目标 Pod 不存在或已重建，请回到资源页重新进入日志。";
  }
  if (
    lowered.includes("previous terminated container") &&
    lowered.includes("not found")
  ) {
    return "上一个实例不存在，已回退到当前实例。";
  }
  if (
    lowered.includes("unauthorized") ||
    lowered.includes("forbidden") ||
    lowered.includes("鉴权")
  ) {
    return "日志读取权限不足，请检查登录状态与资源权限。";
  }
  if (lowered.includes("http-code: 400") || lowered.includes("badrequest")) {
    return "日志读取请求无效，请刷新后重试。";
  }
  if (lowered.includes("http-code: 404") || lowered.includes("notfound")) {
    return "目标日志资源不存在或已重建，请返回资源页重新进入。";
  }
  return sanitizeSensitiveMessage(message || "日志连接失败");
}

function formatConnectionTag(status: LogsConnectionStatus): {
  tone: OpsStatusTone;
  text: string;
} {
  if (status === "已连接") return { tone: "success", text: "已连接" };
  if (status === "连接中") return { tone: "processing", text: "连接中" };
  if (status === "重连中") return { tone: "warning", text: "重连中" };
  if (status === "连接异常") return { tone: "danger", text: "连接异常" };
  return { tone: "neutral", text: "未连接" };
}

function mapLogsFrameState(args: {
  effectivePrevious: boolean;
  follow: boolean;
  isConnecting: boolean;
  reconnectState: LogsReconnectState | null;
  streamError: string;
  streamStatus: LogsConnectionStatus;
}): OpsFrameShellState {
  if (args.streamStatus === "连接异常" || args.streamError) return "error";
  if (args.reconnectState || args.streamStatus === "重连中")
    return "reconnecting";
  if (args.isConnecting || args.streamStatus === "连接中") return "connecting";
  if (args.streamStatus === "已连接" && args.follow && !args.effectivePrevious)
    return "streaming";
  if (args.streamStatus === "已连接") return "paused";
  return "disconnected";
}

function formatRelativeTimeLabel(seconds: number): string {
  const input = secondsToRelativeInput(seconds);
  const unitLabels: Record<TimeUnit, string> = {
    s: "秒",
    m: "分钟",
    h: "小时",
    d: "天",
  };
  return `最近 ${input.amount} ${unitLabels[input.unit]}`;
}

function readCssVar(name: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  return (
    getComputedStyle(document.documentElement).getPropertyValue(name).trim() ||
    fallback
  );
}

function readOpsTerminalTheme() {
  return {
    background: readCssVar(
      "--ops-terminal-bg",
      readCssVar("--kn-surface", "#ffffff"),
    ),
    foreground: readCssVar(
      "--ops-terminal-fg",
      readCssVar("--kn-text", "#151922"),
    ),
    cursor: readCssVar("--ops-log-info", "#67e8f9"),
    selectionBackground: readCssVar(
      "--ops-terminal-selection",
      readCssVar("--kn-primary-subtle", "rgba(35, 92, 255, 0.14)"),
    ),
    black: "#0f172a",
    brightBlack: "#64748b",
    blue: "#60a5fa",
    brightBlue: "#93c5fd",
    cyan: "#22d3ee",
    brightCyan: "#67e8f9",
    green: "#34d399",
    brightGreen: "#86efac",
    red: "#fb7185",
    brightRed: "#fda4af",
    yellow: "#fbbf24",
    brightYellow: "#fde68a",
    white: "#e5edf7",
    brightWhite: "#ffffff",
  };
}

export default function LogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { accessToken, isInitializing } = useAuth();

  const clusterId = searchParams.get("clusterId")?.trim() || "";
  const namespace = searchParams.get("namespace")?.trim() || "";
  const pod = searchParams.get("pod")?.trim() || "";
  const routeContainer = searchParams.get("container")?.trim() || "";
  const resourceName = searchParams.get("resourceName")?.trim() || pod;
  const clusterNameHint =
    searchParams.get("clusterName")?.trim() ||
    searchParams.get("returnClusterName")?.trim() ||
    "";

  const [container, setContainer] = useState(routeContainer);
  const [tailLines, setTailLines] = useState(
    pickTailLines(searchParams.get("tailLines"), 200),
  );
  const currentQuery = searchParams.toString();
  const initialTimeState = useMemo(
    () => inferInitialTimeState(new URLSearchParams(currentQuery)),
    [currentQuery],
  );
  const [timeMode, setTimeMode] = useState<TimeMode>(initialTimeState.mode);
  const [from, setFrom] = useState(initialTimeState.from);
  const [to, setTo] = useState(initialTimeState.to);
  const [sinceSeconds, setSinceSeconds] = useState(
    initialTimeState.sinceSeconds,
  );
  const [sinceTime, setSinceTime] = useState(initialTimeState.sinceTime);
  const [untilTime, setUntilTime] = useState(initialTimeState.untilTime);
  const [relativeAmount, setRelativeAmount] = useState(
    initialTimeState.relativeAmount,
  );
  const [relativeUnit, setRelativeUnit] = useState<TimeUnit>(
    initialTimeState.relativeUnit,
  );
  const [refreshIntervalSeconds, setRefreshIntervalSeconds] = useState(
    pickRefreshInterval(searchParams.get("refreshIntervalSeconds")),
  );
  const [follow, setFollow] = useState(initialTimeState.follow);
  const [previous, setPrevious] = useState(
    pickBool(searchParams.get("previous"), false),
  );
  const [timestamps, setTimestamps] = useState(
    pickBool(searchParams.get("timestamps"), true),
  );
  const [severity, setSeverity] = useState<SeverityFilter[]>([]);
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);

  const [streamStatus, setStreamStatus] =
    useState<LogsConnectionStatus>("未连接");
  const [streamError, setStreamError] = useState("");
  const [reconnectState, setReconnectState] =
    useState<LogsReconnectState | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  const [rawLines, setRawLines] = useState<RuntimeLogItem[]>([]);
  const [lastLogTimestamp, setLastLogTimestamp] = useState("");
  const [emptyReason, setEmptyReason] = useState("");

  const [beautifyEnabled, setBeautifyEnabled] = useState(true);
  const [formatEnabled, setFormatEnabled] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);
  const [searchResultText, setSearchResultText] =
    useState("输入关键字后开始查找");
  const [previousUnavailable, setPreviousUnavailable] = useState(false);

  const socketRef = useRef<RuntimeLogsSocket | null>(null);
  const streamGenerationRef = useRef(0);
  const preloadRequestKeyRef = useRef("");
  const lastRouteStateKeyRef = useRef("");
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);
  const rawLinesRef = useRef<RuntimeLogItem[]>([]);

  useEffect(() => {
    setContainer(routeContainer);
  }, [routeContainer]);

  useEffect(() => {
    const params = new URLSearchParams(currentQuery);
    const nextRouteStateKey = JSON.stringify({
      clusterId,
      namespace,
      pod,
      container: routeContainer,
      tailLines: params.get("tailLines") ?? "",
      timeMode: params.get("timeMode") ?? "",
      from: params.get("from") ?? "",
      to: params.get("to") ?? "",
      sinceSeconds: params.get("sinceSeconds") ?? "",
      sinceTime: params.get("sinceTime") ?? "",
      untilTime: params.get("untilTime") ?? "",
      refreshIntervalSeconds: params.get("refreshIntervalSeconds") ?? "",
      follow: params.get("follow") ?? "",
      previous: params.get("previous") ?? "",
      timestamps: params.get("timestamps") ?? "",
    });
    if (lastRouteStateKeyRef.current === nextRouteStateKey) {
      return;
    }
    lastRouteStateKeyRef.current = nextRouteStateKey;
    const nextTimeState = inferInitialTimeState(params);
    setTailLines(pickTailLines(params.get("tailLines"), 200));
    setTimeMode(nextTimeState.mode);
    setFrom(nextTimeState.from);
    setTo(nextTimeState.to);
    setSinceSeconds(nextTimeState.sinceSeconds);
    setSinceTime(nextTimeState.sinceTime);
    setUntilTime(nextTimeState.untilTime);
    setRelativeAmount(nextTimeState.relativeAmount);
    setRelativeUnit(nextTimeState.relativeUnit);
    setRefreshIntervalSeconds(
      pickRefreshInterval(params.get("refreshIntervalSeconds")),
    );
    setFollow(nextTimeState.follow);
    setPrevious(pickBool(params.get("previous"), false));
    setTimestamps(pickBool(params.get("timestamps"), true));
    setSeverity([]);
    setAvailableContainers([]);
    setRawLines([]);
    setLastLogTimestamp("");
    setEmptyReason("");
    setStreamStatus("未连接");
    setStreamError("");
    setReconnectState(null);
    setPreviousUnavailable(false);
    streamGenerationRef.current += 1;
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, [clusterId, currentQuery, namespace, pod, routeContainer]);

  const backHref = useMemo(
    () => buildBackHref(new URLSearchParams(currentQuery)),
    [currentQuery],
  );

  const clusterQuery = useQuery({
    queryKey: ["clusters", "list", accessToken],
    queryFn: () =>
      getClusters(
        { pageSize: 200, state: "active", selectableOnly: true },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterMap = useMemo(
    () =>
      Object.fromEntries(
        (clusterQuery.data?.items ?? []).map((item) => [item.id, item.name]),
      ),
    [clusterQuery.data?.items],
  );

  const clusterDisplayName = useMemo(
    () => getClusterDisplayName(clusterMap, clusterId, clusterNameHint),
    [clusterMap, clusterId, clusterNameHint],
  );
  const effectivePrevious = previous && !previousUnavailable;

  const containerOptions = useMemo(() => {
    const names = new Set<string>();
    for (const item of availableContainers) {
      const normalized = item.trim();
      if (normalized) names.add(normalized);
    }
    if (container) names.add(container);
    if (routeContainer) names.add(routeContainer);
    return Array.from(names);
  }, [availableContainers, container, routeContainer]);

  useEffect(() => {
    if (!container) {
      if (containerOptions.length > 0) {
        setContainer(containerOptions[0]);
      }
      return;
    }
    if (!containerOptions.includes(container) && containerOptions.length > 0) {
      setContainer(containerOptions[0]);
    }
  }, [container, containerOptions]);

  useEffect(() => {
    if (!terminalHostRef.current || terminalRef.current) {
      return;
    }

    const terminal = new Terminal({
      ...FALLBACK_TERMINAL_OPTIONS,
      theme: readOpsTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    const searchAddon = new SearchAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(searchAddon);
    terminal.open(terminalHostRef.current);
    fitAddon.fit();

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    searchAddonRef.current = searchAddon;

    let rafId = 0;
    const fitTerminal = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => fitAddon.fit());
    };
    const resizeObserver =
      typeof ResizeObserver !== "undefined"
        ? new ResizeObserver(() => {
            fitTerminal();
          })
        : null;
    resizeObserver?.observe(terminalHostRef.current);
    const onResize = () => fitTerminal();
    window.addEventListener("resize", onResize);
    const themeObserver =
      typeof MutationObserver !== "undefined"
        ? new MutationObserver(() => {
            terminal.options.theme = readOpsTerminalTheme();
            fitTerminal();
          })
        : null;
    themeObserver?.observe(document.documentElement, {
      attributeFilter: ["data-theme"],
      attributes: true,
    });

    return () => {
      if (rafId) cancelAnimationFrame(rafId);
      themeObserver?.disconnect();
      resizeObserver?.disconnect();
      window.removeEventListener("resize", onResize);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  const clearStreamSocket = useCallback(() => {
    streamGenerationRef.current += 1;
    preloadRequestKeyRef.current = "";
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, []);

  const renderOptions = useMemo(
    () => ({
      beautify: beautifyEnabled,
      formatJson: formatEnabled,
      includeTimestamp: timestamps,
    }),
    [beautifyEnabled, formatEnabled, timestamps],
  );

  const customTimeRange = useMemo<[Dayjs, Dayjs] | null>(() => {
    if (!sinceTime || !untilTime) return null;
    const start = dayjs(sinceTime);
    const end = dayjs(untilTime);
    if (!start.isValid() || !end.isValid()) return null;
    return [start, end];
  }, [sinceTime, untilTime]);

  const isFollowingNow = to === "now";
  const emptyStateHint = useMemo(
    () => ({
      title: "暂无日志",
      description:
        emptyReason === "TIME_RANGE_NO_MATCH" && lastLogTimestamp
          ? `当前时间范围无日志。最近一条日志时间：${dayjs(lastLogTimestamp).format(LOG_TIME_FORMAT)}。可扩大范围或切换最近 15 分钟。`
          : emptyReason === "NO_PARSEABLE_TIMESTAMPS"
            ? "当前日志没有可解析时间戳，无法按绝对时间过滤。可切换到相对时间或开启时间戳。"
            : emptyReason === "FILTER_NO_MATCH"
              ? "时间范围内有日志，但被级别或关键字过滤掉。"
              : "当前时间范围内没有匹配日志，可调整过滤器或刷新。",
      visible: rawLines.length === 0 && !isConnecting && !streamError,
    }),
    [emptyReason, isConnecting, lastLogTimestamp, rawLines.length, streamError],
  );

  const selectedTimeLabel = useMemo(() => {
    const endLabel = isFollowingNow
      ? "现在"
      : dayjs(to).format(LOG_TIME_FORMAT);
    const quick = QUICK_TIME_OPTIONS.find(
      (item) => item.from === from && isFollowingNow,
    );
    if (quick && (timeMode === "quick" || timeMode === "recent")) {
      return quick.label;
    }
    if (parseNowExpression(from) !== null && isFollowingNow) {
      return `${formatRelativeTimeLabel(parseNowExpression(from)!)} 至现在`;
    }
    return `${dayjs(from).format(LOG_TIME_FORMAT)} 至 ${endLabel}`;
  }, [from, isFollowingNow, timeMode, to]);

  const replayToTerminal = useCallback(
    (source: RuntimeLogItem[]) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.clear();
      const filtered = applySeverityFilter(source, severity);
      writeTerminalBatch(terminal, filtered, renderOptions);
      fitAddonRef.current?.fit();
      if (searchText.trim()) {
        const found = searchAddonRef.current?.findNext(searchText, {
          regex: searchRegex,
          caseSensitive: searchCaseSensitive,
        });
        setSearchResultText(found ? "已定位到匹配项" : "暂无结果");
      } else {
        setSearchResultText("输入关键字后开始查找");
      }
    },
    [renderOptions, searchCaseSensitive, searchRegex, searchText, severity],
  );

  useEffect(() => {
    if (!searchVisible) {
      return;
    }
    const query = searchText.trim();
    if (!query) {
      setSearchResultText("输入关键字后开始查找");
      return;
    }
    const addon = searchAddonRef.current;
    if (!addon) {
      setSearchResultText("查找组件未就绪");
      return;
    }
    const found = addon.findNext(query, {
      regex: searchRegex,
      caseSensitive: searchCaseSensitive,
    });
    setSearchResultText(found ? "已定位到匹配项" : "暂无结果");
  }, [searchVisible, searchText, searchRegex, searchCaseSensitive, rawLines]);

  useEffect(() => {
    const host = terminalHostRef.current;
    if (!host) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      const isCopy =
        (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "c";
      if (!isCopy) {
        return;
      }
      const selection = terminalRef.current?.getSelection()?.trim() || "";
      if (!selection) {
        return;
      }
      event.preventDefault();
      void navigator.clipboard.writeText(selection).catch(() => undefined);
    };

    host.addEventListener("keydown", handleKeyDown);
    return () => {
      host.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  const syncRuntimeQueryToUrl = useCallback(
    (next: {
      container?: string;
      tailLines?: number;
      sinceSeconds?: number | null;
      sinceTime?: string | null;
      untilTime?: string | null;
      timeMode?: TimeMode;
      from?: string | null;
      to?: string | null;
      refreshIntervalSeconds?: number;
      follow?: boolean;
      previous?: boolean;
      timestamps?: boolean;
    }) => {
      const params = new URLSearchParams(currentQuery);
      if (typeof next.container === "string")
        params.set("container", next.container);
      if (typeof next.tailLines === "number")
        params.set("tailLines", String(next.tailLines));
      if (typeof next.sinceSeconds === "number")
        params.set("sinceSeconds", String(next.sinceSeconds));
      if (next.sinceSeconds === null) params.delete("sinceSeconds");
      if (typeof next.sinceTime === "string")
        params.set("sinceTime", next.sinceTime);
      if (next.sinceTime === null) params.delete("sinceTime");
      if (typeof next.untilTime === "string")
        params.set("untilTime", next.untilTime);
      if (next.untilTime === null) params.delete("untilTime");
      if (typeof next.timeMode === "string")
        params.set("timeMode", next.timeMode);
      if (typeof next.from === "string") params.set("from", next.from);
      if (next.from === null) params.delete("from");
      if (typeof next.to === "string") params.set("to", next.to);
      if (next.to === null) params.delete("to");
      if (typeof next.refreshIntervalSeconds === "number") {
        params.set(
          "refreshIntervalSeconds",
          String(next.refreshIntervalSeconds),
        );
      }
      if (typeof next.follow === "boolean")
        params.set("follow", String(next.follow));
      if (typeof next.previous === "boolean")
        params.set("previous", String(next.previous));
      if (typeof next.timestamps === "boolean")
        params.set("timestamps", String(next.timestamps));
      const nextQuery = params.toString();
      if (nextQuery === currentQuery) {
        return;
      }
      router.replace(`${pathname}?${nextQuery}`, { scroll: false });
    },
    [currentQuery, pathname, router],
  );

  const applyHistoryRange = useCallback(
    (value: number) => {
      const nextFrom = secondsToNowExpression(value);
      setSinceSeconds(value);
      setSinceTime("");
      setUntilTime("");
      setTimeMode("quick");
      setFrom(nextFrom);
      setTo("now");
      setFollow(true);
      syncRuntimeQueryToUrl({
        timeMode: "quick",
        from: nextFrom,
        to: "now",
        sinceSeconds: value,
        sinceTime: null,
        untilTime: null,
        follow: true,
      });
    },
    [syncRuntimeQueryToUrl],
  );

  const applyTimeRange = useCallback(
    (input: { mode: TimeMode; from: string; to: string }) => {
      const now = dayjs();
      const relativeSeconds = parseNowExpression(input.from);
      const toFollowsNow = input.to === "now";
      const nextFrom = normalizeTimeEndpoint(
        input.from,
        secondsToNowExpression(sinceSeconds),
      );
      const nextTo = normalizeTimeEndpoint(input.to, "now");
      const nextSinceTime =
        relativeSeconds === null ? normalizeLogTimeParam(nextFrom) : "";
      const nextUntilTime = toFollowsNow ? "" : normalizeLogTimeParam(nextTo);
      if (
        nextSinceTime &&
        nextUntilTime &&
        dayjs(nextSinceTime).isAfter(dayjs(nextUntilTime))
      ) {
        return;
      }
      if (nextUntilTime && dayjs(nextUntilTime).isAfter(now)) {
        return;
      }
      const nextSinceSeconds = relativeSeconds ?? sinceSeconds;
      const nextRelativeInput = secondsToRelativeInput(nextSinceSeconds);
      setTimeMode(input.mode);
      setFrom(nextFrom);
      setTo(nextTo);
      setSinceSeconds(nextSinceSeconds);
      setSinceTime(nextSinceTime);
      setUntilTime(nextUntilTime);
      setRelativeAmount(nextRelativeInput.amount);
      setRelativeUnit(nextRelativeInput.unit);
      setFollow(toFollowsNow);
      syncRuntimeQueryToUrl({
        timeMode: input.mode,
        from: nextFrom,
        to: nextTo,
        sinceSeconds: relativeSeconds === null ? null : nextSinceSeconds,
        sinceTime: nextSinceTime || null,
        untilTime: nextUntilTime || null,
        follow: toFollowsNow,
      });
    },
    [sinceSeconds, syncRuntimeQueryToUrl],
  );

  const applyRelativeTimeRange = useCallback(() => {
    const amount = Number.parseInt(relativeAmount, 10);
    if (!Number.isFinite(amount) || amount <= 0) return;
    applyTimeRange({
      mode: "relative",
      from: `now-${amount}${relativeUnit}`,
      to: "now",
    });
  }, [applyTimeRange, relativeAmount, relativeUnit]);

  const applyCustomTimeRange = useCallback(
    (value: null | [Dayjs | null, Dayjs | null]) => {
      if (!value?.[0] || !value[1]) {
        return;
      }
      const now = dayjs();
      const start = value[0].isAfter(now) ? now : value[0];
      const end = value[1].isAfter(now) ? now : value[1];
      if (start.isAfter(end)) {
        return;
      }
      applyTimeRange({
        mode: "absolute",
        from: toLogTimeParam(start),
        to: toLogTimeParam(end),
      });
    },
    [applyTimeRange],
  );

  const fallbackFromPrevious = useCallback(() => {
    setPreviousUnavailable(true);
    setPrevious(false);
    syncRuntimeQueryToUrl({ previous: false });
  }, [syncRuntimeQueryToUrl]);

  const connectStream = useCallback(
    async (options?: { resetLines?: boolean; preloadHistory?: boolean }) => {
      if (
        isInitializing ||
        !accessToken ||
        !clusterId ||
        !namespace ||
        !pod ||
        !container
      ) {
        return;
      }
      const effectiveUntilTime = isFollowingNow ? "" : untilTime;
      const preloadKey = options?.preloadHistory
        ? JSON.stringify({
            clusterId,
            namespace,
            pod,
            container,
            tailLines,
            sinceSeconds: customTimeRange ? undefined : sinceSeconds,
            sinceTime,
            untilTime: effectiveUntilTime,
            previous: effectivePrevious,
            timestamps,
          })
        : "";
      if (preloadKey && preloadRequestKeyRef.current === preloadKey) {
        return;
      }
      clearStreamSocket();
      setIsConnecting(true);
      setStreamStatus("连接中");
      setStreamError("");
      setReconnectState(null);

      if (options?.resetLines) {
        setRawLines([]);
        terminalRef.current?.clear();
      }

      const currentGeneration = streamGenerationRef.current;
      try {
        if (options?.preloadHistory) {
          preloadRequestKeyRef.current = preloadKey;
          let seed;
          try {
            seed = await getLogs(
              {
                clusterId,
                namespace,
                pod,
                container,
                tailLines: tailLines > 0 ? tailLines : undefined,
                sinceSeconds: customTimeRange ? undefined : sinceSeconds,
                sinceTime: sinceTime || undefined,
                untilTime: effectiveUntilTime || undefined,
                previous: effectivePrevious,
                timestamps,
                page: 1,
                pageSize:
                  tailLines > 0
                    ? Math.min(Math.max(tailLines, 100), 2500)
                    : 2500,
              },
              accessToken,
            );
          } catch (error) {
            if (effectivePrevious && isPreviousLogNotFoundError(error)) {
              fallbackFromPrevious();
              seed = await getLogs(
                {
                  clusterId,
                  namespace,
                  pod,
                  container,
                  tailLines: tailLines > 0 ? tailLines : undefined,
                  sinceSeconds: customTimeRange ? undefined : sinceSeconds,
                  sinceTime: sinceTime || undefined,
                  untilTime: effectiveUntilTime || undefined,
                  previous: false,
                  timestamps,
                  page: 1,
                  pageSize:
                    tailLines > 0
                      ? Math.min(Math.max(tailLines, 100), 2500)
                      : 2500,
                },
                accessToken,
              );
            } else {
              throw error;
            }
          }
          if (currentGeneration !== streamGenerationRef.current) return;
          const seedLines = mapHistoryRecordsToRuntimeLogs(seed.items);
          setLastLogTimestamp(seed.lastLogTimestamp ?? "");
          setEmptyReason(seed.emptyReason ?? "");
          setRawLines(seedLines);
          replayToTerminal(seedLines);
          preloadRequestKeyRef.current = "";
        }

        // "上一个实例" 和暂停跟随只展示历史日志，不进入实时流/重连循环。
        if (effectivePrevious || !follow) {
          if (currentGeneration !== streamGenerationRef.current) {
            return;
          }
          setStreamStatus("已连接");
          setStreamError("");
          setReconnectState(null);
          return;
        }

        let session;
        try {
          session = await createLogsStreamSession(
            {
              clusterId,
              namespace,
              pod,
              container,
              tailLines,
              sinceSeconds: customTimeRange ? undefined : sinceSeconds,
              sinceTime: sinceTime || undefined,
              untilTime: effectiveUntilTime || undefined,
              follow,
              previous: effectivePrevious,
              timestamps,
            },
            accessToken,
          );
        } catch (error) {
          if (effectivePrevious && isPreviousLogNotFoundError(error)) {
            fallbackFromPrevious();
            session = await createLogsStreamSession(
              {
                clusterId,
                namespace,
                pod,
                container,
                tailLines,
                sinceSeconds: customTimeRange ? undefined : sinceSeconds,
                sinceTime: sinceTime || undefined,
                untilTime: effectiveUntilTime || undefined,
                follow,
                previous: false,
                timestamps,
              },
              accessToken,
            );
          } else {
            throw error;
          }
        }
        if (currentGeneration !== streamGenerationRef.current) {
          return;
        }
        const sessionContainers = session.target?.availableContainers ?? [];
        setAvailableContainers((current) => {
          const merged = new Set<string>();
          for (const item of current) {
            const normalized = item.trim();
            if (normalized) merged.add(normalized);
          }
          for (const item of sessionContainers) {
            const normalized = item.trim();
            if (normalized) merged.add(normalized);
          }
          if (container) merged.add(container);
          return Array.from(merged);
        });

        const candidates = buildGatewayWsCandidates(session.gatewayWsUrl);
        if (candidates.length === 0) {
          setStreamStatus("连接异常");
          setStreamError("未获取到可用日志 WebSocket 地址");
          return;
        }

        const socket = new RuntimeLogsSocket({
          url: candidates[0],
          candidates,
          onStatusChange: (status) => {
            if (currentGeneration !== streamGenerationRef.current) return;
            setStreamStatus(status);
            if (status === "已连接") {
              setStreamError("");
            }
          },
          onError: (error) => {
            if (currentGeneration !== streamGenerationRef.current) return;
            setStreamError(error);
          },
          onReconnectStateChange: (state) => {
            if (currentGeneration !== streamGenerationRef.current) return;
            setReconnectState(
              state.stopped || state.attempt === 0 ? null : state,
            );
          },
          onOpen: () => {
            if (currentGeneration !== streamGenerationRef.current) return;
            setStreamError("");
            setReconnectState(null);
          },
          onLogs: (items) => {
            if (currentGeneration !== streamGenerationRef.current) return;
            if (items.length === 0) return;
            setRawLines((current) => {
              const next = [...current, ...items].slice(-6000);
              const filtered = applySeverityFilter(items, severity);
              writeTerminalBatch(terminalRef.current, filtered, renderOptions);
              return next;
            });
          },
          reconnect: {
            enabled: follow,
          },
        });

        socketRef.current = socket;
        socket.connect();
      } catch (error) {
        preloadRequestKeyRef.current = "";
        if (currentGeneration !== streamGenerationRef.current) {
          return;
        }
        setStreamStatus("连接异常");
        setStreamError(normalizeLogError(error));
      } finally {
        if (!options?.preloadHistory) {
          preloadRequestKeyRef.current = "";
        }
        if (currentGeneration === streamGenerationRef.current) {
          setIsConnecting(false);
        }
      }
    },
    [
      isInitializing,
      accessToken,
      clusterId,
      namespace,
      pod,
      container,
      clearStreamSocket,
      tailLines,
      sinceSeconds,
      sinceTime,
      untilTime,
      isFollowingNow,
      customTimeRange,
      follow,
      effectivePrevious,
      fallbackFromPrevious,
      timestamps,
      replayToTerminal,
      severity,
      renderOptions,
    ],
  );

  useEffect(() => {
    if (
      !accessToken ||
      isInitializing ||
      !clusterId ||
      !namespace ||
      !pod ||
      !container
    ) {
      return;
    }
    void connectStream({ resetLines: true, preloadHistory: true });
    return () => {
      clearStreamSocket();
    };
  }, [
    accessToken,
    isInitializing,
    clusterId,
    namespace,
    pod,
    container,
    tailLines,
    sinceSeconds,
    sinceTime,
    untilTime,
    customTimeRange,
    follow,
    effectivePrevious,
    timestamps,
    clearStreamSocket,
    connectStream,
  ]);

  useEffect(() => {
    rawLinesRef.current = rawLines;
    replayToTerminal(rawLines);
  }, [rawLines, severity, renderOptions, replayToTerminal]);

  useEffect(() => {
    if (rawLinesRef.current.length === 0 || !terminalRef.current) {
      return;
    }
    const timer = window.setTimeout(() => {
      const terminalRows =
        terminalHostRef.current
          ?.querySelector(".xterm-rows")
          ?.textContent?.trim() ?? "";
      if (!terminalRows && rawLinesRef.current.length > 0) {
        replayToTerminal(rawLinesRef.current);
      }
    }, 50);
    return () => window.clearTimeout(timer);
  }, [replayToTerminal, streamStatus]);

  const reconnectNow = () => {
    void connectStream({ resetLines: false, preloadHistory: false });
  };

  const hardRefresh = () => {
    void connectStream({ resetLines: true, preloadHistory: true });
  };

  useEffect(() => {
    if (refreshIntervalSeconds <= 0 || (follow && !effectivePrevious)) {
      return;
    }
    const timer = window.setInterval(() => {
      void connectStream({ resetLines: true, preloadHistory: true });
    }, refreshIntervalSeconds * 1000);
    return () => window.clearInterval(timer);
  }, [connectStream, effectivePrevious, follow, refreshIntervalSeconds]);

  const clearAll = () => {
    setRawLines([]);
    terminalRef.current?.clear();
    setStreamError("");
  };

  const downloadLogs = () => {
    const content = toDownloadText(
      applySeverityFilter(rawLines, severity),
      renderOptions,
    );
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${namespace}-${pod}-${container || "container"}-logs.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const runSearch = (direction: "next" | "prev") => {
    const query = searchText.trim();
    if (!query) {
      return;
    }
    const addon = searchAddonRef.current;
    if (!addon) {
      return;
    }
    if (direction === "next") {
      const found = addon.findNext(query, {
        regex: searchRegex,
        caseSensitive: searchCaseSensitive,
      });
      setSearchResultText(found ? "已定位到匹配项" : "暂无结果");
    } else {
      const found = addon.findPrevious(query, {
        regex: searchRegex,
        caseSensitive: searchCaseSensitive,
      });
      setSearchResultText(found ? "已定位到匹配项" : "暂无结果");
    }
  };

  const exitBack = () => {
    clearStreamSocket();
    router.replace(backHref);
  };

  const connectionMeta = formatConnectionTag(streamStatus);
  const logsFrameState = mapLogsFrameState({
    effectivePrevious,
    follow,
    isConnecting,
    reconnectState,
    streamError,
    streamStatus,
  });
  const scopeSubtitle = `${clusterDisplayName} / ${namespace || "-"} / ${resourceName || pod || "-"} / ${
    container || "-"
  }`;
  const filteredLineCount = applySeverityFilter(rawLines, severity).length;
  const streamModeLabel = effectivePrevious
    ? "Previous"
    : follow
      ? "Follow"
      : "Paused";
  const refreshLabel =
    refreshIntervalSeconds > 0 && (effectivePrevious || !follow)
      ? `${refreshIntervalSeconds}s`
      : follow && !effectivePrevious
        ? "stream"
        : "manual";
  const lastLogLabel = lastLogTimestamp
    ? dayjs(lastLogTimestamp).format("HH:mm:ss")
    : "-";

  return (
    <OpsFrameShell
      className="logs-workbench-shell"
      bodyClassName="logs-workbench-body"
      title="Pod 日志工作区"
      subtitle={scopeSubtitle}
      state={logsFrameState}
      status={
        <OpsStatusTag tone={connectionMeta.tone}>
          {connectionMeta.text}
        </OpsStatusTag>
      }
      toolbar={
        <Space wrap size={8} className="logs-workbench-top-actions">
          <Tooltip title="重新加载日志">
            <OpsIconActionButton
              icon={<ReloadOutlined />}
              onClick={hardRefresh}
              loading={isConnecting}
            >
              刷新
            </OpsIconActionButton>
          </Tooltip>
          <OpsIconActionButton
            icon={<ArrowLeftOutlined />}
            opsTone="danger"
            opsVariant="danger"
            onClick={exitBack}
          >
            退出
          </OpsIconActionButton>
        </Space>
      }
      chips={
        <Space wrap size={8} className="logs-workbench-chips">
          <OpsFilterChip tone={effectivePrevious ? "neutral" : "info"}>
            {effectivePrevious
              ? "上一个实例"
              : follow
                ? "实时跟随"
                : "跟随已暂停"}
          </OpsFilterChip>
          <OpsFilterChip tone={isFollowingNow ? "success" : "warning"}>
            {isFollowingNow ? "结束时间=现在，跟随当前时间" : "固定结束时间"}
          </OpsFilterChip>
          <OpsFilterChip tone="neutral">{selectedTimeLabel}</OpsFilterChip>
          <OpsFilterChip tone="info">
            {tailLines === -1 ? "全部行" : `${tailLines} 行`}
          </OpsFilterChip>
          {severity.length > 0 ? (
            <OpsFilterChip tone="warning">{severity.join(" / ")}</OpsFilterChip>
          ) : null}
          {previousUnavailable ? (
            <OpsFilterChip tone="warning">
              上一个实例不存在，已回退到当前实例
            </OpsFilterChip>
          ) : null}
          {reconnectState ? (
            <OpsFilterChip tone="warning">
              重连 {reconnectState.attempt}/{reconnectState.maxAttempts}
            </OpsFilterChip>
          ) : null}
        </Space>
      }
      error={
        streamError ? (
          <Alert
            type={streamStatus === "连接异常" ? "error" : "warning"}
            showIcon
            title="实时流提示"
            description={streamError}
          />
        ) : undefined
      }
    >
      <Space
        orientation="vertical"
        size={12}
        className="logs-workbench-stack"
        style={{ width: "100%" }}
      >
        <div className="logs-signal-row" aria-label="日志流状态">
          <div
            className={`logs-signal-card logs-signal-card--${connectionMeta.tone}`}
          >
            <span>Stream</span>
            <strong>{connectionMeta.text}</strong>
          </div>
          <div className="logs-signal-card">
            <span>Mode</span>
            <strong>{streamModeLabel}</strong>
          </div>
          <div className="logs-signal-card">
            <span>Lines</span>
            <strong>
              {filteredLineCount}/{rawLines.length}
            </strong>
          </div>
          <div className="logs-signal-card">
            <span>Last</span>
            <strong>{lastLogLabel}</strong>
          </div>
          <div className="logs-signal-card">
            <span>Refresh</span>
            <strong>{refreshLabel}</strong>
          </div>
        </div>

        <OpsSurface
          variant="toolbar"
          padding="sm"
          className="logs-toolbar-card"
        >
          <Space orientation="vertical" size={10} style={{ width: "100%" }}>
            <div className="headlamp-log-toolbar">
              <div className="headlamp-log-group headlamp-log-group-main">
                <div className="headlamp-log-control">
                  <span>容器</span>
                  <Select
                    value={container || undefined}
                    onChange={(value) => {
                      setContainer(value);
                      syncRuntimeQueryToUrl({ container: value });
                    }}
                    options={containerOptions.map((name) => ({
                      label: name,
                      value: name,
                    }))}
                    style={{ width: 200 }}
                  />
                </div>

                <div className="headlamp-log-control">
                  <span>行</span>
                  <Select
                    value={tailLines}
                    onChange={(value) => {
                      setTailLines(value);
                      syncRuntimeQueryToUrl({ tailLines: value });
                    }}
                    options={TAIL_OPTIONS}
                    style={{ width: 104 }}
                  />
                </div>

                <div className="headlamp-log-control">
                  <span>时间</span>
                  <Popover
                    trigger="click"
                    placement="bottomLeft"
                    content={
                      <div className="headlamp-time-popover">
                        <div className="headlamp-time-tabs">
                          <Select
                            value={timeMode}
                            onChange={(value) => setTimeMode(value)}
                            options={TIME_MODE_OPTIONS}
                            style={{ width: 150 }}
                          />
                          <Select
                            value={refreshIntervalSeconds}
                            onChange={(value) => {
                              setRefreshIntervalSeconds(value);
                              syncRuntimeQueryToUrl({
                                refreshIntervalSeconds: value,
                              });
                            }}
                            options={REFRESH_INTERVAL_OPTIONS}
                            style={{ width: 120 }}
                          />
                          <Button
                            icon={<ReloadOutlined />}
                            onClick={hardRefresh}
                            loading={isConnecting}
                          >
                            刷新
                          </Button>
                        </div>
                        <div className="headlamp-time-section">
                          {timeMode === "quick" ? (
                            <>
                              <Typography.Text strong>快捷选择</Typography.Text>
                              <Space wrap size={8}>
                                {QUICK_TIME_OPTIONS.map((item) => (
                                  <Button
                                    key={item.from}
                                    size="small"
                                    type={
                                      from === item.from && isFollowingNow
                                        ? "primary"
                                        : "default"
                                    }
                                    onClick={() =>
                                      applyHistoryRange(item.seconds)
                                    }
                                  >
                                    {item.label}
                                  </Button>
                                ))}
                              </Space>
                            </>
                          ) : null}
                          {timeMode === "relative" ? (
                            <>
                              <Typography.Text strong>相对时间</Typography.Text>
                              <Space wrap>
                                <Input
                                  value={relativeAmount}
                                  onChange={(event) =>
                                    setRelativeAmount(
                                      event.target.value.replace(/\D/g, ""),
                                    )
                                  }
                                  onPressEnter={applyRelativeTimeRange}
                                  style={{ width: 96 }}
                                />
                                <Select
                                  value={relativeUnit}
                                  onChange={setRelativeUnit}
                                  options={TIME_UNIT_OPTIONS}
                                  style={{ width: 150 }}
                                />
                                <Button
                                  type="primary"
                                  onClick={applyRelativeTimeRange}
                                >
                                  应用
                                </Button>
                              </Space>
                            </>
                          ) : null}
                          {timeMode === "absolute" ? (
                            <>
                              <Typography.Text strong>
                                绝对时间范围
                              </Typography.Text>
                              <RangePicker
                                showTime
                                allowClear={false}
                                format={LOG_TIME_FORMAT}
                                value={customTimeRange}
                                disabledDate={disabledFutureLogDate}
                                disabledTime={disabledFutureLogTime}
                                onChange={applyCustomTimeRange}
                                style={{ width: 390 }}
                              />
                              <Typography.Text
                                type="secondary"
                                className="headlamp-time-help"
                              >
                                绝对时间不能晚于当前；固定结束时间会关闭实时跟随。
                              </Typography.Text>
                            </>
                          ) : null}
                          {timeMode === "recent" ? (
                            <>
                              <Typography.Text strong>
                                最近使用范围
                              </Typography.Text>
                              <Space wrap size={8}>
                                {RECENT_TIME_OPTIONS.map((item) => (
                                  <Button
                                    key={item.from}
                                    size="small"
                                    type={
                                      from === item.from && isFollowingNow
                                        ? "primary"
                                        : "default"
                                    }
                                    onClick={() =>
                                      applyTimeRange({
                                        mode: "recent",
                                        from: item.from,
                                        to: "now",
                                      })
                                    }
                                  >
                                    {item.label}
                                  </Button>
                                ))}
                              </Space>
                            </>
                          ) : null}
                        </div>
                        <Typography.Text
                          type="secondary"
                          className="headlamp-time-help"
                        >
                          地址栏使用 timeMode/from/to/refreshIntervalSeconds；旧
                          sinceSeconds/sinceTime/untilTime 仍可读取。
                        </Typography.Text>
                      </div>
                    }
                  >
                    <Button className="headlamp-time-trigger">
                      <span>{selectedTimeLabel}</span>
                      <DownOutlined />
                    </Button>
                  </Popover>
                </div>
              </div>

              <div className="headlamp-log-group headlamp-log-group-mode">
                <div className="headlamp-log-switch">
                  <Switch
                    checked={previous}
                    aria-label="显示上一个实例日志"
                    onChange={(checked) => {
                      setPreviousUnavailable(false);
                      setPrevious(checked);
                      syncRuntimeQueryToUrl({ previous: checked });
                    }}
                    size="small"
                  />
                  <span>上一个</span>
                </div>

                <div className="headlamp-log-switch">
                  <Switch
                    checked={timestamps}
                    aria-label="显示时间戳"
                    onChange={(checked) => {
                      setTimestamps(checked);
                      syncRuntimeQueryToUrl({ timestamps: checked });
                    }}
                    size="small"
                  />
                  <span>时间戳</span>
                </div>

                <div className="headlamp-log-switch">
                  <Switch
                    checked={follow}
                    disabled={!isFollowingNow}
                    aria-label="实时跟随日志"
                    onChange={(checked) => {
                      if (!isFollowingNow) return;
                      setFollow(checked);
                      syncRuntimeQueryToUrl({ follow: checked });
                    }}
                    size="small"
                  />
                  <span>跟随</span>
                </div>

                <div className="headlamp-log-switch">
                  <Switch
                    checked={beautifyEnabled}
                    aria-label="启用日志美化"
                    onChange={setBeautifyEnabled}
                    size="small"
                  />
                  <span>美化</span>
                </div>

                <div className="headlamp-log-switch">
                  <Switch
                    checked={formatEnabled}
                    aria-label="启用日志格式化"
                    onChange={setFormatEnabled}
                    size="small"
                  />
                  <span>格式化</span>
                </div>
              </div>

              <div className="headlamp-log-group headlamp-log-group-actions">
                <div className="headlamp-log-control">
                  <span>级别</span>
                  <Select
                    mode="multiple"
                    maxTagCount={2}
                    allowClear
                    placeholder="全部"
                    value={severity}
                    onChange={(value) => setSeverity(value as SeverityFilter[])}
                    options={LEVEL_FILTER_OPTIONS}
                    style={{ width: 150 }}
                  />
                </div>

                <div className="headlamp-log-actions">
                  <Tooltip title="查找">
                    <Popover
                      trigger="click"
                      placement="bottomRight"
                      open={searchVisible}
                      onOpenChange={setSearchVisible}
                      content={
                        <div className="headlamp-search-popover">
                          <Input
                            className="headlamp-log-search-input"
                            value={searchText}
                            onChange={(event) =>
                              setSearchText(event.target.value)
                            }
                            placeholder="查找"
                            allowClear
                            style={{ width: 220 }}
                            onPressEnter={() => runSearch("next")}
                          />
                          <Tooltip title="区分大小写">
                            <button
                              type="button"
                              className={`headlamp-search-flag${searchCaseSensitive ? " active" : ""}`}
                              aria-label="区分大小写"
                              aria-pressed={searchCaseSensitive}
                              onClick={() =>
                                setSearchCaseSensitive((value) => !value)
                              }
                            >
                              Aa
                            </button>
                          </Tooltip>
                          <Tooltip title="使用正则表达式">
                            <button
                              type="button"
                              className={`headlamp-search-flag${searchRegex ? " active" : ""}`}
                              aria-label="使用正则表达式"
                              aria-pressed={searchRegex}
                              onClick={() => setSearchRegex((value) => !value)}
                            >
                              .*
                            </button>
                          </Tooltip>
                          <Tooltip title="上一个匹配">
                            <button
                              type="button"
                              className="headlamp-search-icon"
                              aria-label="上一个匹配"
                              onClick={() => runSearch("prev")}
                            >
                              ↑
                            </button>
                          </Tooltip>
                          <Tooltip title="下一个匹配">
                            <button
                              type="button"
                              className="headlamp-search-icon"
                              aria-label="下一个匹配"
                              onClick={() => runSearch("next")}
                            >
                              ↓
                            </button>
                          </Tooltip>
                          <Tooltip title="关闭查找">
                            <button
                              type="button"
                              className="headlamp-search-icon"
                              aria-label="关闭查找"
                              onClick={() => setSearchVisible(false)}
                            >
                              ×
                            </button>
                          </Tooltip>
                          <span className="headlamp-search-status">
                            {searchResultText}
                          </span>
                        </div>
                      }
                    >
                      <OpsIconActionButton
                        opsVariant="icon"
                        icon={<SearchOutlined />}
                        aria-label="查找日志"
                      />
                    </Popover>
                  </Tooltip>
                  <Tooltip title="清除">
                    <OpsIconActionButton
                      opsVariant="icon"
                      icon={<ClearOutlined />}
                      aria-label="清除日志"
                      onClick={clearAll}
                    />
                  </Tooltip>
                  <Tooltip title="下载">
                    <OpsIconActionButton
                      opsVariant="icon"
                      icon={<DownloadOutlined />}
                      aria-label="下载日志"
                      onClick={downloadLogs}
                    />
                  </Tooltip>
                  <Tooltip title="重新接入">
                    <OpsIconActionButton
                      opsVariant="icon"
                      icon={<ReloadOutlined />}
                      aria-label="重新接入日志"
                      onClick={reconnectNow}
                      loading={isConnecting}
                    />
                  </Tooltip>
                </div>
              </div>
            </div>
          </Space>
        </OpsSurface>

        <OpsSurface
          variant="code"
          padding="none"
          className="logs-terminal-card"
        >
          <div
            className={`logs-terminal-frame logs-terminal-frame--${logsFrameState}`}
          >
            <div className="logs-terminal-titlebar">
              <div className="logs-terminal-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="logs-terminal-title">
                {clusterDisplayName} · {pod || "pod"}.{namespace || "default"}
              </div>
              <div
                className={`logs-terminal-state logs-terminal-state--${connectionMeta.tone}`}
              >
                {connectionMeta.text}
              </div>
            </div>
            <div className="logs-terminal-telemetry" aria-label="日志终端状态">
              <div
                className={`logs-terminal-telemetry__item logs-terminal-telemetry__item--${connectionMeta.tone}`}
              >
                <span>Stream</span>
                <strong>{connectionMeta.text}</strong>
              </div>
              <div className="logs-terminal-telemetry__item">
                <span>Mode</span>
                <strong>{streamModeLabel}</strong>
              </div>
              <div className="logs-terminal-telemetry__item">
                <span>Lines</span>
                <strong>
                  {filteredLineCount}/{rawLines.length}
                </strong>
              </div>
              <div className="logs-terminal-telemetry__item">
                <span>Container</span>
                <strong>{container || "-"}</strong>
              </div>
            </div>
            <div className="logs-terminal-host" ref={terminalHostRef} />
            {emptyStateHint.visible ? (
              <div className="logs-empty-hint">
                <Typography.Text strong>{emptyStateHint.title}</Typography.Text>
                <Typography.Text type="secondary">
                  {emptyStateHint.description}
                </Typography.Text>
              </div>
            ) : null}
          </div>
          {streamStatus === "连接异常" ? (
            <Button
              type="primary"
              className="logs-reconnect-button"
              onClick={reconnectNow}
              loading={isConnecting}
            >
              重新连接
            </Button>
          ) : null}
        </OpsSurface>
      </Space>

      <style jsx>{`
        :global(html[data-theme="light"]) {
          --ops-terminal-bg: #050b14;
          --ops-terminal-fg: #dff6ff;
          --ops-terminal-selection: rgba(34, 211, 238, 0.34);
        }

        :global(.logs-workbench-shell.ops-frame-shell) {
          --logs-console-frame-bg: linear-gradient(
            180deg,
            #ffffff 0%,
            #f7f9fc 100%
          );
          --logs-console-header-bg: rgba(255, 255, 255, 0.92);
          --logs-console-chip-bg: rgba(248, 250, 252, 0.9);
          --logs-console-border: rgba(35, 92, 255, 0.16);
          --logs-console-divider: rgba(100, 116, 139, 0.16);
          --logs-console-text: var(--kn-text, #151922);
          --logs-console-muted: var(--kn-text-secondary, #5d6675);
          --logs-signal-bg: rgba(255, 255, 255, 0.86);
          --logs-signal-border: rgba(35, 92, 255, 0.14);
          --logs-signal-text: #172033;
          --logs-signal-muted: #5d6675;
          --logs-toolbar-bg: #ffffff;
          --logs-toolbar-panel-bg: linear-gradient(180deg, #ffffff, #f9fbff);
          --logs-toolbar-border: rgba(148, 163, 184, 0.26);
          --logs-control-bg: #ffffff;
          --logs-control-border: rgba(148, 163, 184, 0.34);
          --logs-control-text: var(--kn-text, #151922);
          --logs-control-muted: var(--kn-text-secondary, #5d6675);
          --logs-terminal-frame-bg:
            radial-gradient(circle at 16% 0%, rgba(34, 211, 238, 0.14), transparent 30%),
            linear-gradient(
              90deg,
              transparent 0 23px,
              rgba(56, 189, 248, 0.052) 23px 24px,
              transparent 24px 48px
            ),
            linear-gradient(180deg, #081525 0%, var(--ops-terminal-bg) 100%);
          --logs-terminal-frame-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            inset 0 0 34px rgba(34, 211, 238, 0.1);
          --logs-terminal-titlebar-bg: rgba(7, 15, 27, 0.96);
          --logs-terminal-titlebar-border: rgba(56, 189, 248, 0.2);
          --logs-terminal-telemetry-bg: rgba(8, 18, 31, 0.86);
          --logs-terminal-telemetry-border: rgba(56, 189, 248, 0.14);
          --logs-terminal-telemetry-muted: rgba(203, 213, 225, 0.68);
          --logs-terminal-telemetry-text: rgba(248, 250, 252, 0.94);
          --logs-terminal-bg: var(--ops-terminal-bg, #050b14);
          --logs-terminal-fg: var(--ops-terminal-fg, #dff6ff);
          --logs-empty-bg: rgba(7, 15, 27, 0.94);
          --logs-empty-border: rgba(56, 189, 248, 0.24);
          --logs-empty-shadow: 0 12px 24px rgba(2, 8, 23, 0.24);
          min-height: calc(100vh - 112px);
          border-color: var(--logs-console-border);
          background: var(--logs-console-frame-bg);
          box-shadow: var(--kn-shadow-subtle, 0 1px 2px rgba(15, 23, 42, 0.06));
        }

        :global(html[data-theme="dark"])
          :global(.logs-workbench-shell.ops-frame-shell) {
          --logs-console-frame-bg: linear-gradient(
            180deg,
            rgba(8, 18, 31, 0.98),
            rgba(3, 10, 20, 0.98)
          );
          --logs-console-header-bg: rgba(8, 18, 31, 0.92);
          --logs-console-chip-bg: rgba(12, 25, 42, 0.86);
          --logs-console-border: rgba(56, 189, 248, 0.22);
          --logs-console-divider: rgba(56, 189, 248, 0.14);
          --logs-console-text: #edf6ff;
          --logs-console-muted: rgba(203, 213, 225, 0.72);
          --logs-signal-bg: rgba(8, 18, 31, 0.78);
          --logs-signal-border: rgba(56, 189, 248, 0.13);
          --logs-signal-text: rgba(248, 250, 252, 0.94);
          --logs-signal-muted: rgba(203, 213, 225, 0.68);
          --logs-toolbar-bg: rgba(9, 18, 31, 0.92);
          --logs-toolbar-panel-bg: linear-gradient(
            180deg,
            rgba(12, 25, 42, 0.96),
            rgba(8, 17, 31, 0.96)
          );
          --logs-toolbar-border: rgba(148, 163, 184, 0.18);
          --logs-control-bg: rgba(2, 8, 23, 0.34);
          --logs-control-border: rgba(148, 163, 184, 0.22);
          --logs-control-text: rgba(248, 250, 252, 0.92);
          --logs-control-muted: rgba(226, 232, 240, 0.74);
          --logs-terminal-frame-bg:
            linear-gradient(
              90deg,
              transparent 0 23px,
              rgba(56, 189, 248, 0.055) 23px 24px,
              transparent 24px 48px
            ),
            linear-gradient(180deg, #081525 0%, var(--ops-terminal-bg) 100%);
          --logs-terminal-frame-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.035);
          --logs-terminal-titlebar-bg: rgba(8, 18, 31, 0.96);
          --logs-terminal-titlebar-border: rgba(56, 189, 248, 0.16);
          --logs-terminal-telemetry-bg: rgba(8, 18, 31, 0.78);
          --logs-terminal-telemetry-border: rgba(56, 189, 248, 0.12);
          --logs-terminal-telemetry-muted: rgba(203, 213, 225, 0.68);
          --logs-terminal-telemetry-text: rgba(248, 250, 252, 0.94);
          --logs-terminal-bg: var(--ops-terminal-bg, #061120);
          --logs-terminal-fg: var(--ops-terminal-fg, #eef6ff);
          --logs-empty-bg: rgba(8, 18, 31, 0.94);
          --logs-empty-border: rgba(56, 189, 248, 0.2);
          --logs-empty-shadow: 0 8px 16px rgba(2, 8, 23, 0.28);
          border-color: var(--logs-console-border);
          background: var(--logs-console-frame-bg);
          box-shadow:
            0 1px 2px rgba(2, 8, 23, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.035);
        }

        :global(.logs-workbench-shell .ops-frame-shell__header) {
          border-bottom-color: var(--kn-border, var(--logs-console-divider));
          background: color-mix(
            in srgb,
            var(--kn-surface, var(--logs-console-header-bg)) 90%,
            transparent
          );
          backdrop-filter: blur(12px) saturate(1.08);
        }

        :global(.logs-workbench-shell .ops-frame-shell__title) {
          color: var(--kn-text, var(--logs-console-text));
        }

        :global(.logs-workbench-shell .ops-frame-shell__subtitle) {
          color: var(--kn-text-secondary, var(--logs-console-muted));
        }

        :global(.logs-workbench-shell .ops-frame-shell__chips) {
          border-bottom-color: var(--logs-console-divider);
          background: var(--logs-console-chip-bg);
        }

        :global(.logs-workbench-shell .ops-frame-shell__body) {
          background: transparent;
        }

        :global(.logs-workbench-shell .ops-frame-shell__title) {
          letter-spacing: 0;
        }

        :global(.logs-workbench-top-actions.ant-space) {
          align-items: center;
          row-gap: 6px;
        }

        :global(.logs-workbench-chips.ant-space) {
          width: 100%;
        }

        :global(.logs-workbench-stack.ant-space) {
          display: flex;
        }

        .logs-signal-row {
          display: grid;
          grid-template-columns: 1.2fr repeat(4, minmax(104px, 1fr));
          gap: 8px;
          width: 100%;
        }

        .logs-signal-card {
          display: grid;
          gap: 3px;
          min-width: 0;
          padding: 10px 12px;
          border: 1px solid var(--logs-signal-border);
          border-radius: 8px;
          background: var(--logs-signal-bg);
          color: var(--logs-signal-text);
          box-shadow: inset 0 1px 0
            color-mix(in srgb, var(--logs-signal-text) 8%, transparent);
        }

        .logs-signal-card span {
          overflow: hidden;
          color: var(--logs-signal-muted);
          font-size: 11px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-signal-card strong {
          overflow: hidden;
          color: inherit;
          font-family: var(--kn-font-mono);
          font-size: 13px;
          font-weight: 750;
          line-height: 1.25;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-signal-card--success strong {
          color: var(--ops-status-success-text);
        }

        .logs-signal-card--warning strong,
        .logs-signal-card--processing strong {
          color: var(--ops-status-warning-text);
        }

        .logs-signal-card--danger strong {
          color: var(--ops-status-danger-text);
        }

        .logs-terminal-frame {
          position: relative;
          border-radius: 8px 8px 0 0;
          overflow: hidden;
          border: 1px solid rgba(35, 92, 255, 0.16);
          background: var(--logs-terminal-frame-bg);
          box-shadow: var(--logs-terminal-frame-shadow);
        }

        .logs-terminal-frame--error,
        .logs-terminal-frame--expired {
          border-color: rgba(248, 113, 113, 0.38);
        }

        .logs-terminal-frame--reconnecting,
        .logs-terminal-frame--connecting {
          border-color: rgba(251, 191, 36, 0.34);
        }

        .logs-terminal-frame--streaming {
          border-color: rgba(34, 211, 238, 0.36);
        }

        :global(.logs-toolbar-card.ops-surface),
        :global(.logs-terminal-card.ops-surface) {
          border-radius: 8px;
          border-color: var(--logs-toolbar-border);
          background: var(--logs-toolbar-bg);
          overflow: hidden;
        }

        :global(.logs-toolbar-card.ops-surface) {
          border-color: var(--logs-toolbar-border);
          background: var(--logs-toolbar-panel-bg);
        }

        :global(.logs-terminal-card.ops-surface) {
          border-color: var(--logs-console-border);
          background: var(--logs-terminal-bg);
          color: var(--logs-terminal-fg);
        }

        .headlamp-log-toolbar {
          display: grid;
          grid-template-columns: minmax(0, 1fr) 290px;
          grid-template-areas:
            "main actions"
            "mode actions";
          justify-content: space-between;
          gap: 8px;
          width: 100%;
          align-items: stretch;
          overflow: visible;
          padding: 0;
        }

        .headlamp-log-group {
          display: flex;
          align-items: end;
          gap: 8px;
          flex-wrap: wrap;
          min-width: 0;
          min-height: 58px;
          padding: 8px 10px;
          border: 1px solid var(--logs-toolbar-border);
          border-radius: 8px;
          background: color-mix(in srgb, var(--logs-toolbar-bg) 88%, #eef4ff);
          backdrop-filter: blur(10px) saturate(1.08);
        }

        .headlamp-log-group-main {
          grid-area: main;
          align-content: end;
        }

        .headlamp-log-group-mode {
          grid-area: mode;
          align-content: end;
          justify-content: flex-start;
          min-height: 42px;
        }

        .headlamp-log-group-actions {
          grid-area: actions;
          display: inline-flex;
          justify-content: flex-end;
          align-content: end;
          align-self: stretch;
          flex-wrap: wrap;
          width: 100%;
          background: color-mix(in srgb, var(--logs-toolbar-bg) 92%, #eaf2ff);
        }

        .headlamp-log-control {
          display: inline-grid;
          gap: 5px;
          flex: 0 0 auto;
          color: var(--logs-control-muted);
          font-size: 11px;
          line-height: 1.2;
        }

        .headlamp-log-control > span {
          height: 16px;
          display: inline-flex;
          align-items: center;
          text-transform: uppercase;
          letter-spacing: 0;
        }

        .headlamp-log-switch {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          flex: 0 0 auto;
          white-space: nowrap;
          color: var(--logs-control-text);
          font-size: 12px;
          font-weight: 650;
        }

        .headlamp-log-actions {
          display: inline-flex;
          align-items: center;
          justify-content: flex-end;
          gap: 4px;
          height: 32px;
          flex: 0 0 auto;
          width: 100%;
        }

        .headlamp-log-toolbar :global(.ant-select-selector),
        .headlamp-log-toolbar :global(.ant-input),
        .headlamp-log-toolbar :global(.ant-btn),
        .headlamp-log-toolbar :global(.ant-picker) {
          border-color: var(--logs-control-border) !important;
          background: var(--logs-control-bg) !important;
          color: var(--logs-control-text) !important;
        }

        .headlamp-log-toolbar :global(.ant-select-arrow),
        .headlamp-log-toolbar :global(.ant-select-selection-placeholder),
        .headlamp-log-toolbar :global(.ant-select-selection-item),
        .headlamp-log-toolbar :global(.ant-btn .anticon) {
          color: var(--logs-control-muted) !important;
        }

        .headlamp-log-toolbar :global(.ant-select:hover .ant-select-selector),
        .headlamp-log-toolbar :global(.ant-select-focused .ant-select-selector),
        .headlamp-log-toolbar :global(.ant-input:hover),
        .headlamp-log-toolbar :global(.ant-input:focus),
        .headlamp-log-toolbar :global(.ant-picker:hover),
        .headlamp-log-toolbar :global(.ant-picker-focused),
        .headlamp-log-toolbar :global(.ant-btn:hover),
        .headlamp-log-toolbar :global(.ant-btn:focus-visible) {
          border-color: var(--ant-color-primary) !important;
          color: var(--ant-color-primary) !important;
          background: color-mix(
            in srgb,
            var(--logs-control-bg) 88%,
            var(--kn-primary-subtle, rgba(35, 92, 255, 0.1))
          ) !important;
        }

        .headlamp-time-trigger {
          width: min(320px, 34vw);
          justify-content: space-between;
        }

        .headlamp-time-trigger span {
          display: inline-block;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .headlamp-time-popover {
          display: grid;
          gap: 14px;
          width: min(430px, calc(100vw - 48px));
        }

        .headlamp-time-tabs {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .headlamp-time-section {
          display: grid;
          gap: 8px;
        }

        .headlamp-time-help {
          font-size: 12px;
        }

        .headlamp-search-popover {
          display: flex;
          align-items: center;
          gap: 8px;
          min-width: 520px;
          color: var(--logs-control-text);
        }

        .headlamp-search-status {
          color: var(--logs-control-muted);
          font-size: 13px;
          white-space: nowrap;
          margin-left: 8px;
        }

        .headlamp-search-flag,
        .headlamp-search-icon {
          border: 0;
          border-radius: 6px;
          background: color-mix(
            in srgb,
            var(--logs-control-bg) 92%,
            var(--kn-primary-subtle, rgba(35, 92, 255, 0.1))
          );
          color: var(--logs-control-text);
          cursor: pointer;
          font: inherit;
          min-width: 28px;
          height: 28px;
          padding: 0 6px;
        }

        .headlamp-search-flag:hover,
        .headlamp-search-flag.active,
        .headlamp-search-icon:hover,
        .headlamp-search-icon:active {
          color: var(--ant-color-primary);
        }

        .headlamp-search-flag:focus-visible,
        .headlamp-search-icon:focus-visible {
          outline: none;
          border-radius: 6px;
          box-shadow: var(--kn-focus-ring);
          color: var(--ant-color-primary);
        }

        .headlamp-search-popover
          :global(.headlamp-log-search-input .ant-input) {
          color: var(--logs-control-text);
        }

        .headlamp-search-popover
          :global(.headlamp-log-search-input .ant-input::placeholder) {
          color: var(--logs-control-muted);
        }

        .headlamp-search-popover
          :global(.headlamp-log-search-input .ant-input-prefix),
        .headlamp-search-popover
          :global(.headlamp-log-search-input .ant-input-clear-icon) {
          color: var(--logs-control-muted);
        }

        .logs-terminal-titlebar {
          height: 40px;
          padding: 0 12px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: var(--logs-terminal-titlebar-bg);
          border-bottom: 1px solid var(--logs-terminal-titlebar-border);
          color: var(--logs-terminal-fg);
          font-size: 12px;
        }

        .logs-terminal-dots {
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }

        .logs-terminal-dots span {
          width: 8px;
          height: 8px;
          border-radius: 50%;
          display: inline-block;
          box-shadow: 0 0 0 1px
            color-mix(in srgb, var(--logs-terminal-fg) 12%, transparent);
        }

        .logs-terminal-dots span:nth-child(1) {
          background: var(--ops-log-warning);
        }
        .logs-terminal-dots span:nth-child(2) {
          background: var(--ops-status-success-text);
        }
        .logs-terminal-dots span:nth-child(3) {
          background: var(--ops-log-info);
        }

        .logs-terminal-title {
          font-weight: 600;
          color: var(--logs-terminal-fg);
          text-align: center;
          flex: 1;
          margin: 0 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-terminal-state {
          color: var(--ops-log-info);
          font-family: var(--kn-font-mono);
          font-size: 11px;
          font-weight: 700;
          text-transform: uppercase;
        }

        .logs-terminal-state--success {
          color: var(--ops-status-success-text);
        }

        .logs-terminal-state--warning,
        .logs-terminal-state--processing {
          color: var(--ops-status-warning-text);
        }

        .logs-terminal-state--danger {
          color: var(--ops-status-danger-text);
        }

        .logs-terminal-telemetry {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 1px;
          border-bottom: 1px solid var(--logs-terminal-telemetry-border);
          background: var(--logs-terminal-telemetry-border);
        }

        .logs-terminal-telemetry__item {
          display: grid;
          gap: 2px;
          min-width: 0;
          padding: 8px 12px;
          background: var(--logs-terminal-telemetry-bg);
          color: var(--logs-terminal-telemetry-text);
        }

        .logs-terminal-telemetry__item span {
          overflow: hidden;
          color: var(--logs-terminal-telemetry-muted);
          font-size: 11px;
          line-height: 1.2;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-terminal-telemetry__item strong {
          overflow: hidden;
          color: inherit;
          font-family: var(--kn-font-mono);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.25;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-terminal-telemetry__item--success strong {
          color: var(--ops-status-success-text);
        }

        .logs-terminal-telemetry__item--warning strong,
        .logs-terminal-telemetry__item--processing strong {
          color: var(--ops-status-warning-text);
        }

        .logs-terminal-telemetry__item--danger strong {
          color: var(--ops-status-danger-text);
        }

        .logs-terminal-host {
          position: relative;
          width: 100%;
          min-height: 58vh;
          max-height: 72vh;
          background:
            linear-gradient(
              180deg,
              color-mix(in srgb, var(--logs-terminal-fg) 4%, transparent),
              transparent 42%
            ),
            var(--logs-terminal-bg);
          overflow: hidden;
          padding: 14px;
        }

        .logs-terminal-host::before {
          content: "";
          position: absolute;
          inset: 11px 14px auto;
          z-index: 2;
          height: 1px;
          pointer-events: none;
          background: linear-gradient(
            90deg,
            transparent,
            var(--ops-log-info),
            transparent
          );
          opacity: 0.38;
        }

        .logs-empty-hint {
          position: absolute;
          left: 50%;
          top: 52%;
          transform: translate(-50%, -50%);
          display: grid;
          gap: 6px;
          min-width: min(360px, calc(100% - 32px));
          padding: 16px 18px;
          border: 1px solid var(--logs-empty-border);
          border-radius: 8px;
          background: var(--logs-empty-bg);
          box-shadow: var(--logs-empty-shadow);
          text-align: center;
          pointer-events: none;
        }

        :global(.logs-reconnect-button.ant-btn) {
          width: 100%;
          height: 40px;
          border-radius: 0;
          border-inline: 0;
          border-bottom: 0;
          background: var(--ant-color-primary);
        }

        .logs-empty-hint :global(.ant-typography) {
          color: var(--logs-terminal-fg);
        }

        .logs-empty-hint :global(.ant-typography-secondary) {
          color: color-mix(
            in srgb,
            var(--logs-terminal-fg) 68%,
            transparent
          ) !important;
        }

        :global(.logs-workbench-body) :global(.xterm) {
          height: 100%;
        }

        :global(.logs-workbench-body) :global(.xterm-viewport) {
          scrollbar-width: thin;
        }

        :global(.logs-workbench-body) :global(.xterm-rows) {
          color: var(--logs-terminal-fg);
          text-shadow: none;
        }

        @media (max-width: 1440px) {
          .logs-signal-row {
            grid-template-columns: repeat(3, minmax(0, 1fr));
          }

          .headlamp-log-toolbar {
            grid-template-columns: 1fr;
            grid-template-areas:
              "main"
              "mode"
              "actions";
            justify-content: stretch;
          }

          .headlamp-log-group-mode,
          .headlamp-log-group-actions {
            justify-self: stretch;
          }

          .headlamp-log-group-actions {
            width: auto;
          }
        }

        @media (max-width: 900px) {
          .logs-signal-row {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .headlamp-log-group,
          .headlamp-log-group-actions {
            width: 100%;
            flex-wrap: wrap;
            justify-content: flex-start;
          }

          .headlamp-log-actions {
            width: 100%;
            height: auto;
            flex-wrap: wrap;
            justify-content: flex-start;
          }

          .headlamp-log-control {
            width: 100%;
          }

          .headlamp-log-control :global(.ant-select),
          .headlamp-log-control :global(.ant-picker),
          .headlamp-log-control :global(.ant-input) {
            width: 100% !important;
            max-width: 100%;
          }

          .headlamp-time-trigger {
            width: 100%;
            max-width: calc(100vw - 72px);
          }

          .headlamp-time-popover :global(.ant-picker-range) {
            width: 100% !important;
          }

          .headlamp-search-popover {
            min-width: 300px;
            flex-wrap: wrap;
          }

          .headlamp-search-status {
            width: 100%;
            margin-left: 0;
          }

          .logs-terminal-host {
            min-height: 48vh;
            max-height: 62vh;
          }

          .logs-terminal-telemetry {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .logs-terminal-titlebar {
            padding: 0 10px;
            gap: 8px;
          }
        }
      `}</style>
    </OpsFrameShell>
  );
}
