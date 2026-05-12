"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  Alert,
  Button,
  Card,
  Input,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
  Typography,
  theme,
} from "antd";
import {
  ArrowLeftOutlined,
  ClearOutlined,
  CopyOutlined,
  DownloadOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { SearchAddon } from "@xterm/addon-search";
import { useAuth } from "@/components/auth-context";
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
import { buildGatewayWsCandidates } from "@/lib/ws/terminal";

type SeverityFilter = "INFO" | "WARN" | "ERROR";

const TAIL_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "100", value: 100 },
  { label: "200", value: 200 },
  { label: "1000", value: 1000 },
  { label: "2500", value: 2500 },
  { label: "全部", value: -1 },
];

const HISTORY_RANGE_OPTIONS: Array<{ label: string; value: number }> = [
  { label: "15m", value: 15 * 60 },
  { label: "1h", value: 60 * 60 },
  { label: "6h", value: 6 * 60 * 60 },
  { label: "24h", value: 24 * 60 * 60 },
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
  if (page && Number.isFinite(Number.parseInt(page, 10))) params.set("page", page);

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
  if (upper.includes("WARN") || upper.includes("WRN ") || upper.includes(" W!")) {
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

function toDownloadText(lines: RuntimeLogItem[], options: { beautify: boolean; formatJson: boolean; includeTimestamp: boolean }): string {
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

function applySeverityFilter(lines: RuntimeLogItem[], selected: SeverityFilter[]): RuntimeLogItem[] {
  if (!selected.length) return lines;
  const set = new Set(selected);
  return lines.filter((line) => set.has(inferSeverity(line.text)));
}

function writeTerminalBatch(
  terminal: Terminal | null,
  lines: RuntimeLogItem[],
  options: { beautify: boolean; formatJson: boolean; includeTimestamp: boolean },
): void {
  if (!terminal || lines.length === 0) return;
  terminal.write(
    lines
      .map((line) =>
        `${formatMetaLine({
          item: line,
          beautify: options.beautify,
          formatJson: options.formatJson,
          includeTimestamp: options.includeTimestamp,
        })}\r\n`,
      )
      .join(""),
  );
}

function mapHistoryRecordsToRuntimeLogs(records: LogRecord[]): RuntimeLogItem[] {
  return records.map((record) => ({
    id: record.id,
    text: record.message,
    ts: Date.parse(record.timestamp) || Date.now(),
    type: record.level === "ERROR" ? "stderr" : "stdout",
  }));
}

function formatConnectionTag(status: LogsConnectionStatus): { color: string; text: string } {
  if (status === "已连接") return { color: "green", text: "已连接" };
  if (status === "连接中") return { color: "blue", text: "连接中" };
  if (status === "重连中") return { color: "gold", text: "重连中" };
  if (status === "连接异常") return { color: "red", text: "连接异常" };
  return { color: "default", text: "未连接" };
}

export default function LogsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { token } = theme.useToken();
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
  const [sinceSeconds, setSinceSeconds] = useState(
    pickPositive(searchParams.get("sinceSeconds"), 60 * 60),
  );
  const [follow, setFollow] = useState(pickBool(searchParams.get("follow"), true));
  const [previous, setPrevious] = useState(
    pickBool(searchParams.get("previous"), false),
  );
  const [timestamps, setTimestamps] = useState(
    pickBool(searchParams.get("timestamps"), true),
  );
  const [severity, setSeverity] = useState<SeverityFilter[]>([]);
  const [availableContainers, setAvailableContainers] = useState<string[]>([]);

  const [streamStatus, setStreamStatus] = useState<LogsConnectionStatus>("未连接");
  const [streamError, setStreamError] = useState("");
  const [reconnectState, setReconnectState] = useState<LogsReconnectState | null>(
    null,
  );
  const [isConnecting, setIsConnecting] = useState(false);
  const [rawLines, setRawLines] = useState<RuntimeLogItem[]>([]);

  const [beautifyEnabled, setBeautifyEnabled] = useState(true);
  const [formatEnabled, setFormatEnabled] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [searchVisible, setSearchVisible] = useState(false);

  const socketRef = useRef<RuntimeLogsSocket | null>(null);
  const streamGenerationRef = useRef(0);
  const terminalHostRef = useRef<HTMLDivElement | null>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const searchAddonRef = useRef<SearchAddon | null>(null);

  useEffect(() => {
    setContainer(routeContainer);
  }, [routeContainer]);

  useEffect(() => {
    setTailLines(pickTailLines(searchParams.get("tailLines"), 200));
    setSinceSeconds(pickPositive(searchParams.get("sinceSeconds"), 60 * 60));
    setFollow(pickBool(searchParams.get("follow"), true));
    setPrevious(pickBool(searchParams.get("previous"), false));
    setTimestamps(pickBool(searchParams.get("timestamps"), true));
    setSeverity([]);
    setAvailableContainers([]);
    setRawLines([]);
    setStreamStatus("未连接");
    setStreamError("");
    setReconnectState(null);
    streamGenerationRef.current += 1;
    socketRef.current?.disconnect();
    socketRef.current = null;
  }, [clusterId, namespace, pod, routeContainer, searchParams]);

  const backHref = useMemo(
    () => buildBackHref(new URLSearchParams(searchParams.toString())),
    [searchParams],
  );

  const clusterQuery = useQuery({
    queryKey: ["clusters", "list", accessToken],
    queryFn: () =>
      getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterMap = useMemo(
    () =>
      Object.fromEntries((clusterQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clusterQuery.data?.items],
  );

  const clusterDisplayName = useMemo(
    () => getClusterDisplayName(clusterMap, clusterId, clusterNameHint),
    [clusterMap, clusterId, clusterNameHint],
  );

  const historySeedQuery = useQuery({
    queryKey: [
      "logs",
      "seed",
      clusterId,
      namespace,
      pod,
      container,
      tailLines,
      sinceSeconds,
      previous,
      timestamps,
      accessToken,
    ],
    queryFn: () =>
      getLogs(
        {
          clusterId: clusterId || undefined,
          namespace: namespace || undefined,
          pod: pod || undefined,
          container: container || undefined,
          tailLines: tailLines > 0 ? tailLines : undefined,
          sinceSeconds,
          previous,
          timestamps,
          page: 1,
          pageSize: tailLines > 0 ? Math.min(Math.max(tailLines, 100), 2500) : 2500,
        },
        accessToken,
      ),
    enabled:
      !isInitializing &&
      Boolean(accessToken) &&
      Boolean(clusterId && namespace && pod && container),
  });

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
      theme: {
        background: "#07111f",
        foreground: "#dbeafe",
        cursor: "#38bdf8",
        selectionBackground: "rgba(56, 189, 248, 0.35)",
      },
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

    const onResize = () => fitAddon.fit();
    window.addEventListener("resize", onResize);

    return () => {
      window.removeEventListener("resize", onResize);
      terminalRef.current?.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      searchAddonRef.current = null;
    };
  }, []);

  const clearStreamSocket = useCallback(() => {
    streamGenerationRef.current += 1;
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

  const replayToTerminal = useCallback(
    (source: RuntimeLogItem[]) => {
      const terminal = terminalRef.current;
      if (!terminal) return;
      terminal.clear();
      const filtered = applySeverityFilter(source, severity);
      writeTerminalBatch(terminal, filtered, renderOptions);
      fitAddonRef.current?.fit();
      if (searchText.trim()) {
        searchAddonRef.current?.findNext(searchText, {
          regex: searchRegex,
          caseSensitive: searchCaseSensitive,
        });
      }
    },
    [renderOptions, searchCaseSensitive, searchRegex, searchText, severity],
  );

  const connectStream = useCallback(
    async (options?: { resetLines?: boolean; preloadHistory?: boolean }) => {
      if (isInitializing || !accessToken || !clusterId || !namespace || !pod || !container) {
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
          const seed = await getLogs(
            {
              clusterId,
              namespace,
              pod,
              container,
              tailLines: tailLines > 0 ? tailLines : undefined,
              sinceSeconds,
              previous,
              timestamps,
              page: 1,
              pageSize: tailLines > 0 ? Math.min(Math.max(tailLines, 100), 2500) : 2500,
            },
            accessToken,
          );
          if (currentGeneration !== streamGenerationRef.current) return;
          const seedLines = mapHistoryRecordsToRuntimeLogs(seed.items);
          setRawLines(seedLines);
          replayToTerminal(seedLines);
        }

        const session = await createLogsStreamSession(
          {
            clusterId,
            namespace,
            pod,
            container,
            tailLines,
            sinceSeconds,
            follow,
            previous,
            timestamps,
          },
          accessToken,
        );
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
          onStatusChange: setStreamStatus,
          onError: setStreamError,
          onReconnectStateChange: setReconnectState,
          onOpen: () => setStreamError(""),
          onLogs: (items) => {
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
        if (currentGeneration !== streamGenerationRef.current) {
          return;
        }
        setStreamStatus("连接异常");
        setStreamError(error instanceof Error ? error.message : "日志连接失败");
      } finally {
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
      follow,
      previous,
      timestamps,
      replayToTerminal,
      severity,
      renderOptions,
    ],
  );

  useEffect(() => {
    if (!accessToken || isInitializing || !clusterId || !namespace || !pod || !container) {
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
    follow,
    previous,
    timestamps,
    clearStreamSocket,
    connectStream,
  ]);

  useEffect(() => {
    replayToTerminal(rawLines);
  }, [rawLines, severity, renderOptions, replayToTerminal]);

  const syncRuntimeQueryToUrl = useCallback(
    (next: {
      container?: string;
      tailLines?: number;
      sinceSeconds?: number;
      follow?: boolean;
      previous?: boolean;
      timestamps?: boolean;
    }) => {
      const params = new URLSearchParams(searchParams.toString());
      if (typeof next.container === "string") params.set("container", next.container);
      if (typeof next.tailLines === "number") params.set("tailLines", String(next.tailLines));
      if (typeof next.sinceSeconds === "number") params.set("sinceSeconds", String(next.sinceSeconds));
      if (typeof next.follow === "boolean") params.set("follow", String(next.follow));
      if (typeof next.previous === "boolean") params.set("previous", String(next.previous));
      if (typeof next.timestamps === "boolean") params.set("timestamps", String(next.timestamps));
      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  const reconnectNow = () => {
    void connectStream({ resetLines: false, preloadHistory: false });
  };

  const hardRefresh = () => {
    void connectStream({ resetLines: true, preloadHistory: true });
  };

  const clearAll = () => {
    setRawLines([]);
    terminalRef.current?.clear();
    setStreamError("");
  };

  const downloadLogs = () => {
    const content = toDownloadText(applySeverityFilter(rawLines, severity), renderOptions);
    const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${namespace}-${pod}-${container || "container"}-logs.txt`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  const copyLogs = async () => {
    const content = toDownloadText(applySeverityFilter(rawLines, severity), renderOptions);
    if (!content) return;
    try {
      await navigator.clipboard.writeText(content);
    } catch {
      // ignore
    }
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
      addon.findNext(query, {
        regex: searchRegex,
        caseSensitive: searchCaseSensitive,
      });
    } else {
      addon.findPrevious(query, {
        regex: searchRegex,
        caseSensitive: searchCaseSensitive,
      });
    }
  };

  const exitBack = () => {
    clearStreamSocket();
    router.replace(backHref);
  };

  const connectionMeta = formatConnectionTag(streamStatus);

  return (
    <Card className="cyber-panel logs-workspace-card" styles={{ body: { padding: 20 } }} style={{ borderRadius: 24 }}>
      <Space orientation="vertical" size={16} style={{ width: "100%" }}>
        <Card
          style={{
            borderRadius: 18,
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
              <div>
                <Space size={10} wrap>
                  <Typography.Title level={3} style={{ margin: 0 }}>
                    Pod 日志工作区
                  </Typography.Title>
                  <Tag color={connectionMeta.color}>{connectionMeta.text}</Tag>
                </Space>
                <Typography.Text type="secondary">
                  {clusterDisplayName} / {namespace || "-"} / {resourceName || pod} / {container || "-"}
                </Typography.Text>
              </div>
              <Space wrap>
                <Button icon={<ReloadOutlined />} onClick={hardRefresh} loading={isConnecting}>
                  刷新
                </Button>
                <Button icon={<ArrowLeftOutlined />} danger onClick={exitBack}>
                  退出
                </Button>
              </Space>
            </div>

            <div className="headlamp-log-toolbar">
              <div className="headlamp-log-control">
                <span>容器</span>
                <Select
                  value={container || undefined}
                  onChange={(value) => {
                    setContainer(value);
                    syncRuntimeQueryToUrl({ container: value });
                  }}
                  options={containerOptions.map((name) => ({ label: name, value: name }))}
                  style={{ width: 190 }}
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
                <Select
                  value={sinceSeconds}
                  onChange={(value) => {
                    setSinceSeconds(value);
                    syncRuntimeQueryToUrl({ sinceSeconds: value });
                  }}
                  options={HISTORY_RANGE_OPTIONS}
                  style={{ width: 104 }}
                />
              </div>

              <div className="headlamp-log-switch">
                <Switch
                  checked={previous}
                  onChange={(checked) => {
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
                  onChange={(checked) => {
                    setFollow(checked);
                    syncRuntimeQueryToUrl({ follow: checked });
                  }}
                  size="small"
                />
                <span>跟随</span>
              </div>

              <div className="headlamp-log-control">
                <span>Severity</span>
                <Select
                  mode="multiple"
                  maxTagCount={2}
                  allowClear
                  placeholder="All"
                  value={severity}
                  onChange={(value) => setSeverity(value as SeverityFilter[])}
                  options={LEVEL_FILTER_OPTIONS}
                  style={{ width: 150 }}
                />
              </div>

              <div className="headlamp-log-switch">
                <Switch
                  checked={beautifyEnabled}
                  onChange={setBeautifyEnabled}
                  size="small"
                />
                <span>美化</span>
              </div>

              <div className="headlamp-log-switch">
                <Switch
                  checked={formatEnabled}
                  onChange={setFormatEnabled}
                  size="small"
                />
                <span>格式化</span>
              </div>

              <div className="headlamp-log-actions">
                <Tooltip title="查找">
                  <Button
                    type="text"
                    icon={<SearchOutlined />}
                    onClick={() => setSearchVisible((current) => !current)}
                  />
                </Tooltip>
                <Tooltip title="清除">
                  <Button type="text" icon={<ClearOutlined />} onClick={clearAll} />
                </Tooltip>
                <Tooltip title="复制">
                  <Button type="text" icon={<CopyOutlined />} onClick={copyLogs} />
                </Tooltip>
                <Tooltip title="下载">
                  <Button type="text" icon={<DownloadOutlined />} onClick={downloadLogs} />
                </Tooltip>
                <Tooltip title="重新接入">
                  <Button
                    type="text"
                    icon={<ReloadOutlined />}
                    onClick={reconnectNow}
                    loading={isConnecting}
                  />
                </Tooltip>
              </div>
            </div>

            {searchVisible ? (
              <div className="headlamp-log-searchbar">
                <Input
                  value={searchText}
                  onChange={(event) => setSearchText(event.target.value)}
                  placeholder="查找日志..."
                  allowClear
                  prefix={<SearchOutlined />}
                  style={{ width: 260 }}
                  onPressEnter={() => runSearch("next")}
                />
                <Button onClick={() => runSearch("prev")}>上一个</Button>
                <Button onClick={() => runSearch("next")}>下一个</Button>
                <Space size={4}>
                  <Switch checked={searchRegex} onChange={setSearchRegex} size="small" />
                  <span>正则</span>
                </Space>
                <Space size={4}>
                  <Switch
                    checked={searchCaseSensitive}
                    onChange={setSearchCaseSensitive}
                    size="small"
                  />
                  <span>区分大小写</span>
                </Space>
              </div>
            ) : null}

            <Space wrap size={8}>
              <Tag color="blue">{follow ? "实时跟随" : "跟随已暂停"}</Tag>
              {reconnectState ? (
                <Tag color="gold">
                  重连 {reconnectState.attempt}/{reconnectState.maxAttempts}
                </Tag>
              ) : null}
            </Space>

            {streamError ? (
              <Alert
                type={streamStatus === "连接异常" ? "error" : "warning"}
                showIcon
                message="实时流提示"
                description={streamError}
              />
            ) : null}
            {historySeedQuery.error instanceof Error ? (
              <Alert type="warning" showIcon message="历史日志预加载失败" description={historySeedQuery.error.message} />
            ) : null}
          </Space>
        </Card>

        <Card
          styles={{ body: { padding: 0 } }}
          style={{
            borderRadius: 18,
            borderColor: token.colorBorderSecondary,
            background: token.colorBgContainer,
          }}
        >
          <div className="logs-terminal-frame">
            <div className="logs-terminal-titlebar">
              <div className="logs-terminal-dots">
                <span />
                <span />
                <span />
              </div>
              <div className="logs-terminal-title">
                {clusterDisplayName} · {pod || "pod"}.{namespace || "default"}
              </div>
              <div className="logs-terminal-state">{connectionMeta.text}</div>
            </div>
            <div className="logs-terminal-host" ref={terminalHostRef} />
          </div>
          {streamStatus === "连接异常" ? (
            <Button
              type="primary"
              style={{ width: "100%", borderRadius: 0, height: 40 }}
              onClick={reconnectNow}
              loading={isConnecting}
            >
              Reconnect
            </Button>
          ) : null}
        </Card>
      </Space>

      <style jsx>{`
        .logs-terminal-frame {
          border-radius: 16px 16px 0 0;
          overflow: hidden;
          border: 1px solid rgba(148, 163, 184, 0.22);
          background: radial-gradient(circle at top, rgba(56, 189, 248, 0.12), transparent 28%),
            linear-gradient(180deg, #07111f 0%, #08101a 100%);
        }

        .headlamp-log-toolbar {
          display: flex;
          align-items: flex-end;
          gap: 10px;
          width: 100%;
          overflow-x: auto;
          padding: 4px 0;
        }

        .headlamp-log-control {
          display: inline-grid;
          gap: 3px;
          flex: 0 0 auto;
          color: var(--ant-color-text-secondary);
          font-size: 12px;
        }

        .headlamp-log-switch {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          height: 32px;
          flex: 0 0 auto;
          white-space: nowrap;
        }

        .headlamp-log-actions {
          margin-left: auto;
          display: inline-flex;
          align-items: center;
          gap: 4px;
          height: 32px;
          flex: 0 0 auto;
        }

        .headlamp-log-searchbar {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          padding-top: 2px;
        }

        .logs-terminal-titlebar {
          height: 46px;
          padding: 0 14px;
          display: flex;
          align-items: center;
          justify-content: space-between;
          background: rgba(2, 6, 23, 0.72);
          border-bottom: 1px solid rgba(148, 163, 184, 0.18);
          color: #cbd5e1;
          font-size: 12px;
        }

        .logs-terminal-dots {
          display: inline-flex;
          gap: 8px;
          align-items: center;
        }

        .logs-terminal-dots span {
          width: 10px;
          height: 10px;
          border-radius: 999px;
          display: inline-block;
        }

        .logs-terminal-dots span:nth-child(1) {
          background: #f97316;
        }
        .logs-terminal-dots span:nth-child(2) {
          background: #22c55e;
        }
        .logs-terminal-dots span:nth-child(3) {
          background: #38bdf8;
        }

        .logs-terminal-title {
          font-weight: 600;
          color: #dbeafe;
          text-align: center;
          flex: 1;
          margin: 0 12px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }

        .logs-terminal-state {
          color: #93c5fd;
        }

        .logs-terminal-host {
          width: 100%;
          min-height: 58vh;
          max-height: 72vh;
          background: transparent;
          overflow: hidden;
          padding: 12px;
        }

        .logs-workspace-card :global(.xterm) {
          height: 100%;
        }

        .logs-workspace-card :global(.xterm-viewport) {
          scrollbar-width: thin;
        }

        .logs-workspace-card :global(.xterm-rows) {
          color: #dbeafe;
        }

        @media (max-width: 768px) {
          .headlamp-log-toolbar {
            align-items: flex-end;
          }

          .headlamp-log-actions {
            margin-left: 0;
          }

          .logs-terminal-host {
            min-height: 48vh;
            max-height: 62vh;
          }

          .logs-terminal-titlebar {
            padding: 0 10px;
            gap: 8px;
          }
        }
      `}</style>
    </Card>
  );
}
