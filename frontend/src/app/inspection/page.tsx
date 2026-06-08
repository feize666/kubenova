"use client";

import { DownloadOutlined, ReloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  DatePicker,
  Descriptions,
  message,
  Row,
  Select,
  Space,
  Statistic,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { BusinessDetailDrawer, type BusinessDetailSection } from "@/components/business-detail-drawer";
import { OpsFilterChip, OpsIconActionButton, OpsModalShell, OpsPageHeader, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import {
  ResourceFilterToolbar,
  ResourceFilterToolbarItem,
} from "@/components/resource-filter-toolbar";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";
import { getClusters } from "@/lib/api/clusters";
import type { ResourceDetailRequest } from "@/lib/api/resources";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { buildTablePagination } from "@/lib/table/pagination";
import { buildResourceRefDetailRequest } from "@/lib/resource-navigation";
import {
  getCapabilityBaseline,
  type CapabilityBaselineMatrixItem,
  type CapabilityBaselineStatus,
} from "@/lib/api/capabilities";
import {
  executeInspectionAction,
  exportInspectionReport,
  getClusterInspection,
  rerunClusterInspection,
  type InspectionExportFormat,
  type InspectionActionResult,
  type InspectionActionType,
  type MonitoringTimePreset,
  type InspectionIssue,
} from "@/lib/api/monitoring";

const { RangePicker } = DatePicker;
const TIME_PRESETS: Array<{ label: string; value: MonitoringTimePreset | "custom" }> = [
  { label: "15m", value: "15m" },
  { label: "1h", value: "1h" },
  { label: "6h", value: "6h" },
  { label: "24h", value: "24h" },
  { label: "7d", value: "7d" },
  { label: "自定义", value: "custom" },
];
const PAGE_QUERY_STALE_TIME_MS = 20_000;
const PAGE_QUERY_GC_TIME_MS = 5 * 60_000;

function severityTag(level: InspectionIssue["severity"]) {
  if (level === "critical") return <OpsStatusTag tone="critical">严重</OpsStatusTag>;
  if (level === "warning") return <OpsStatusTag tone="warning">警告</OpsStatusTag>;
  return <OpsStatusTag tone="info">提示</OpsStatusTag>;
}

const CATEGORY_LABEL: Record<InspectionIssue["category"], string> = {
  cluster: "集群",
  namespace: "名称空间",
  workload: "工作负载",
  network: "网络",
  storage: "存储",
  config: "配置",
  security: "安全",
  alert: "告警",
};

function capabilityStatusTag(status: CapabilityBaselineStatus) {
  if (status === "implemented") return <OpsStatusTag tone="success">已实现</OpsStatusTag>;
  if (status === "planned") return <OpsStatusTag tone="processing">规划中</OpsStatusTag>;
  if (status === "in-progress") return <OpsStatusTag tone="info">进行中</OpsStatusTag>;
  if (status === "blocked") return <OpsStatusTag tone="danger">阻塞</OpsStatusTag>;
  if (status === "gap") return <OpsStatusTag tone="warning">待补齐</OpsStatusTag>;
  return <OpsStatusTag tone="unknown">未知</OpsStatusTag>;
}

function inspectionActionLabel(action: InspectionActionType) {
  if (action === "create-hpa-draft") return "生成 HPA 草案";
  return "生成修复 YAML";
}

function sanitizeFilenameSegment(value: string, fallback: string) {
  const normalized = value.trim().replace(/[\\/:*?"<>|\s]+/g, "-");
  return normalized || fallback;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/x-yaml;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function InspectionPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [exportFormat, setExportFormat] = useState<InspectionExportFormat>("xlsx");
  const [activeResult, setActiveResult] = useState<InspectionActionResult | null>(null);
  const [issueDetail, setIssueDetail] = useState<InspectionIssue | null>(null);
  const [capabilityDetail, setCapabilityDetail] = useState<CapabilityBaselineMatrixItem | null>(null);
  const [resourceDetailTarget, setResourceDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [refreshingInspection, setRefreshingInspection] = useState(false);
  const [timePreset, setTimePreset] = useState<MonitoringTimePreset | "custom">("24h");
  const [customRange, setCustomRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [capabilityPage, setCapabilityPage] = useState(1);
  const [capabilityPageSize, setCapabilityPageSize] = useState(10);
  const [issuePage, setIssuePage] = useState(1);
  const [issuePageSize, setIssuePageSize] = useState(12);
  const [capabilityFilters, setCapabilityFilters] = useState<HeadlampTableFilters>({});
  const [issueFilters, setIssueFilters] = useState<HeadlampTableFilters>({});
  const enabled = !isInitializing && Boolean(accessToken);
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/inspection",
  });
  const timeQuery = useMemo(() => {
    if (timePreset !== "custom") {
      return { range: timePreset };
    }
    if (customRange?.[0] && customRange?.[1]) {
      return {
        from: customRange[0].toISOString(),
        to: customRange[1].toISOString(),
      };
    }
    return { range: "24h" as MonitoringTimePreset };
  }, [customRange, timePreset]);

  const clustersQuery = useQuery({
    queryKey: ["clusters", "inspection", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true, pageSize: 200 }, accessToken!),
    enabled,
    staleTime: 2 * 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
  });

  const reportQuery = useQuery({
    queryKey: ["monitoring", "inspection", clusterId, namespace, timeQuery.range, timeQuery.from, timeQuery.to, accessToken],
    queryFn: () =>
      getClusterInspection({
        clusterId: clusterId || undefined,
        namespace: namespace || undefined,
        ...timeQuery,
        token: accessToken || undefined,
      }),
    enabled,
    staleTime: PAGE_QUERY_STALE_TIME_MS,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: 30_000,
  });
  const refetchInspectionReport = reportQuery.refetch;

  const capabilityQuery = useQuery({
    queryKey: ["capability-baseline", accessToken],
    queryFn: () => getCapabilityBaseline(accessToken || undefined),
    enabled,
    staleTime: 60_000,
    gcTime: PAGE_QUERY_GC_TIME_MS,
    refetchOnWindowFocus: false,
    refetchInterval: 60_000,
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set(
          (reportQuery.data?.items ?? [])
            .map((item) => item.namespace?.trim() ?? "")
            .filter((item) => item.length > 0),
        ),
      ),
    [reportQuery.data?.items],
  );

  const actionMutation = useMutation({
    mutationFn: ({ issue, action }: { issue: InspectionIssue; action: InspectionActionType }) =>
      executeInspectionAction(issue.id, action, {
        clusterId: clusterId || undefined,
        token: accessToken || undefined,
      }),
    onSuccess: (result) => {
      setActiveResult(result);
      void reportQuery.refetch();
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "执行修复动作失败");
    },
  });
  const mutateInspectionAction = actionMutation.mutate;
  const inspectionActionPending = actionMutation.isPending;

  const exportMutation = useMutation({
    mutationFn: async () =>
      exportInspectionReport({
        clusterId: clusterId || undefined,
        format: exportFormat,
        ...timeQuery,
        token: accessToken || undefined,
      }),
    onSuccess: ({ blob, filename }) => {
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      message.success(`报告已导出：${filename}`);
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "导出巡检报告失败");
    },
  });

  const handleRefreshInspection = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setRefreshingInspection(true);
    message.loading({ key: "inspection-refresh", content: "正在重新巡检..." });
    try {
      await rerunClusterInspection({
        clusterId: clusterId || undefined,
        ...timeQuery,
        token: accessToken || undefined,
      });
      await refetchInspectionReport();
      message.success({ key: "inspection-refresh", content: "重新巡检完成，数据已更新" });
    } catch (error) {
      message.error({
        key: "inspection-refresh",
        content: error instanceof Error ? error.message : "巡检失败，请稍后重试",
      });
    } finally {
      setRefreshingInspection(false);
    }
  }, [accessToken, clusterId, enabled, refetchInspectionReport, timeQuery]);

  const columns = useMemo<Array<HeadlampResourceTableColumn<InspectionIssue>>>(() => [
    {
      title: "严重级别",
      dataIndex: "severity",
      key: "severity",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以级别过滤",
        options: [
          { label: "严重", value: "critical" },
          { label: "警告", value: "warning" },
          { label: "提示", value: "info" },
        ],
      },
      render: (v: InspectionIssue["severity"]) => severityTag(v),
    },
    {
      title: "分类",
      dataIndex: "category",
      key: "category",
      width: 110,
      filter: {
        type: "select",
        placeholder: "以分类过滤",
        options: Object.entries(CATEGORY_LABEL).map(([value, label]) => ({ label, value })),
      },
      render: (v: InspectionIssue["category"]) => CATEGORY_LABEL[v] ?? v,
    },
    {
      title: "问题",
      dataIndex: "title",
      key: "title",
      width: 220,
      required: true,
      filter: { type: "text", placeholder: "以问题过滤" },
      render: (value: string, record) => (
        <Typography.Link onClick={() => setIssueDetail(record)}>{value}</Typography.Link>
      ),
    },
    {
      title: "资源",
      dataIndex: "resourceRef",
      key: "resourceRef",
      width: 260,
      ellipsis: true,
      filter: { type: "text", placeholder: "以资源过滤" },
      render: (value: string, record) => {
        const request = buildResourceRefDetailRequest({
          resourceRef: value,
          clusterId: record.clusterId ?? clusterId,
          namespace: record.namespace ?? namespace,
          clusterMap,
        });
        return request ? (
          <Typography.Link onClick={() => setResourceDetailTarget(request)}>{value}</Typography.Link>
        ) : (
          value
        );
      },
    },
    {
      title: "集群",
      dataIndex: "clusterId",
      key: "clusterId",
      width: 150,
      render: (value: string | null | undefined) =>
        value ? getClusterDisplayName(clusterMap, value) : <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: 150,
      render: (value: string | null | undefined) => value || <Typography.Text type="secondary">-</Typography.Text>,
    },
    {
      title: "诊断证据",
      dataIndex: "evidence",
      key: "evidence",
      width: 220,
      filter: { type: "text", placeholder: "以证据过滤" },
      render: (v?: string) => v || "-",
    },
    {
      title: "修复建议",
      dataIndex: "suggestion",
      key: "suggestion",
      width: 420,
      ellipsis: true,
      filter: { type: "text", placeholder: "以建议过滤" },
    },
    {
      title: "修复动作",
      key: "actions",
      required: true,
      width: 156,
      render: (_, record) => {
        const actions = record.actions ?? [];
        if (actions.length === 0) {
          return "-";
        }
        return (
          <Space wrap size={[6, 6]} className="inspection-action-buttons">
            {actions.map((action) => (
              <Button
                key={`${record.id}-${action.type}`}
                className="inspection-action-button"
                size="small"
                type={action.type === "create-hpa-draft" ? "primary" : "default"}
                loading={inspectionActionPending}
                title={action.label}
                onClick={() => mutateInspectionAction({ issue: record, action: action.type })}
              >
                {action.label}
              </Button>
            ))}
          </Space>
        );
      },
    },
  ], [clusterId, clusterMap, inspectionActionPending, mutateInspectionAction, namespace]);

  const capabilityColumns = useMemo<Array<HeadlampResourceTableColumn<CapabilityBaselineMatrixItem>>>(() => [
    {
      title: "类别",
      dataIndex: "category",
      key: "category",
      width: 180,
      filter: { type: "text", placeholder: "以类别过滤" },
    },
    {
      title: "能力项",
      dataIndex: "capabilityName",
      key: "capabilityName",
      width: 260,
      required: true,
      filter: { type: "text", placeholder: "以能力项过滤" },
      render: (value: string, record) => (
        <Typography.Link onClick={() => setCapabilityDetail(record)}>{value}</Typography.Link>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 120,
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: [
          { label: "已实现", value: "implemented" },
          { label: "规划中", value: "planned" },
          { label: "进行中", value: "in-progress" },
          { label: "阻塞", value: "blocked" },
          { label: "待补齐", value: "gap" },
        ],
      },
      render: (value: CapabilityBaselineStatus) => capabilityStatusTag(value),
    },
    {
      title: "Rancher 对标",
      dataIndex: "rancherAlignment",
      key: "rancherAlignment",
      width: 220,
      filter: { type: "text", placeholder: "以 Rancher 过滤" },
      render: (value?: string) => value || "-",
    },
    {
      title: "KubeSphere 对标",
      dataIndex: "kubesphereAlignment",
      key: "kubesphereAlignment",
      width: 220,
      filter: { type: "text", placeholder: "以 KubeSphere 过滤" },
      render: (value?: string) => value || "-",
    },
    {
      title: "关联任务",
      dataIndex: "trackedTask",
      key: "trackedTask",
      width: 180,
      filter: { type: "text", placeholder: "以任务过滤" },
      render: (value: string | null | undefined, record) => {
        if (record.status === "planned") {
          return value ? (
            <OpsFilterChip tone="info">{value}</OpsFilterChip>
          ) : (
            <OpsStatusTag tone="danger">未关联任务</OpsStatusTag>
          );
        }
        return value || "-";
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value?: string | null) => (value ? new Date(value).toLocaleString("zh-CN") : "-"),
    },
  ], []);

  const tablePreferencesClient = useMemo(
    () => createTablePreferencesClient(accessToken || undefined),
    [accessToken],
  );

  const capabilityStats = useMemo(() => {
    const items = capabilityQuery.data?.items ?? [];
    const stats = {
      total: items.length,
      implemented: 0,
      planned: 0,
      gap: 0,
    };
    for (const item of items) {
      if (item.status === "implemented") stats.implemented += 1;
      if (item.status === "planned") stats.planned += 1;
      if (item.status === "gap") stats.gap += 1;
    }
    return {
      total: capabilityQuery.data?.summary?.total ?? stats.total,
      implemented: capabilityQuery.data?.summary?.implemented ?? stats.implemented,
      planned: capabilityQuery.data?.summary?.planned ?? stats.planned,
      gap: capabilityQuery.data?.summary?.gap ?? stats.gap,
    };
  }, [capabilityQuery.data]);

  const capabilityItems = useMemo(() => {
    const raw = capabilityQuery.data?.items ?? [];
    const categoryFilter = typeof capabilityFilters.category === "string" ? capabilityFilters.category.toLowerCase() : "";
    const capabilityFilter = typeof capabilityFilters.capabilityName === "string" ? capabilityFilters.capabilityName.toLowerCase() : "";
    const statusFilter = typeof capabilityFilters.status === "string" ? capabilityFilters.status : "";
    const rancherFilter = typeof capabilityFilters.rancherAlignment === "string" ? capabilityFilters.rancherAlignment.toLowerCase() : "";
    const kubesphereFilter =
      typeof capabilityFilters.kubesphereAlignment === "string" ? capabilityFilters.kubesphereAlignment.toLowerCase() : "";
    const taskFilter = typeof capabilityFilters.trackedTask === "string" ? capabilityFilters.trackedTask.toLowerCase() : "";
    return raw.filter((item) => {
      const matchCategory = categoryFilter ? item.category.toLowerCase().includes(categoryFilter) : true;
      const matchCapability = capabilityFilter ? item.capabilityName.toLowerCase().includes(capabilityFilter) : true;
      const matchStatus = statusFilter ? item.status === statusFilter : true;
      const matchRancher = rancherFilter ? (item.rancherAlignment ?? "").toLowerCase().includes(rancherFilter) : true;
      const matchKubesphere = kubesphereFilter
        ? (item.kubesphereAlignment ?? "").toLowerCase().includes(kubesphereFilter)
        : true;
      const matchTask = taskFilter ? (item.trackedTask ?? "").toLowerCase().includes(taskFilter) : true;
      return matchCategory && matchCapability && matchStatus && matchRancher && matchKubesphere && matchTask;
    });
  }, [
    capabilityFilters.capabilityName,
    capabilityFilters.category,
    capabilityFilters.kubesphereAlignment,
    capabilityFilters.rancherAlignment,
    capabilityFilters.status,
    capabilityFilters.trackedTask,
    capabilityQuery.data?.items,
  ]);
  const capabilityPagedItems = useMemo(() => {
    const start = (capabilityPage - 1) * capabilityPageSize;
    return capabilityItems.slice(start, start + capabilityPageSize);
  }, [capabilityItems, capabilityPage, capabilityPageSize]);

  const issueItems = useMemo(() => reportQuery.data?.items ?? [], [reportQuery.data?.items]);
  const issueItemsFiltered = useMemo(() => {
    const severityFilter = typeof issueFilters.severity === "string" ? issueFilters.severity : "";
    const categoryFilter = typeof issueFilters.category === "string" ? issueFilters.category : "";
    const titleFilter = typeof issueFilters.title === "string" ? issueFilters.title.toLowerCase() : "";
    const resourceFilter = typeof issueFilters.resourceRef === "string" ? issueFilters.resourceRef.toLowerCase() : "";
    const evidenceFilter = typeof issueFilters.evidence === "string" ? issueFilters.evidence.toLowerCase() : "";
    const suggestionFilter = typeof issueFilters.suggestion === "string" ? issueFilters.suggestion.toLowerCase() : "";
    const byNamespace = namespace.trim()
      ? issueItems.filter((item) => (item.namespace ?? "").trim() === namespace.trim())
      : issueItems;
    const loweredKeyword = keyword.trim().toLowerCase();
    return byNamespace.filter((item) =>
      {
        const searchText = [item.title, item.resourceRef, item.evidence ?? "", item.suggestion].join(" ").toLowerCase();
        const matchKeyword = loweredKeyword ? searchText.includes(loweredKeyword) : true;
        const matchSeverity = severityFilter ? item.severity === severityFilter : true;
        const matchCategory = categoryFilter ? item.category === categoryFilter : true;
        const matchTitle = titleFilter ? item.title.toLowerCase().includes(titleFilter) : true;
        const matchResource = resourceFilter ? item.resourceRef.toLowerCase().includes(resourceFilter) : true;
        const matchEvidence = evidenceFilter ? (item.evidence ?? "").toLowerCase().includes(evidenceFilter) : true;
        const matchSuggestion = suggestionFilter ? item.suggestion.toLowerCase().includes(suggestionFilter) : true;
        return matchKeyword && matchSeverity && matchCategory && matchTitle && matchResource && matchEvidence && matchSuggestion;
      },
    );
  }, [
    issueFilters.category,
    issueFilters.evidence,
    issueFilters.resourceRef,
    issueFilters.severity,
    issueFilters.suggestion,
    issueFilters.title,
    issueItems,
    keyword,
    namespace,
  ]);
  const capabilityMaxPage = useMemo(
    () => Math.max(1, Math.ceil(capabilityItems.length / capabilityPageSize)),
    [capabilityItems.length, capabilityPageSize],
  );
  const issueMaxPage = useMemo(
    () => Math.max(1, Math.ceil(issueItemsFiltered.length / issuePageSize)),
    [issueItemsFiltered.length, issuePageSize],
  );
  const issuePagedItems = useMemo(() => {
    const start = (issuePage - 1) * issuePageSize;
    return issueItemsFiltered.slice(start, start + issuePageSize);
  }, [issueItemsFiltered, issuePage, issuePageSize]);
  const capabilityPagination = useMemo(
    () =>
      buildTablePagination({
        current: capabilityPage,
        pageSize: capabilityPageSize,
        total: capabilityItems.length,
        onChange: (nextPage, nextPageSize) => {
          if (nextPageSize !== capabilityPageSize) {
            setCapabilityPageSize(nextPageSize);
            setCapabilityPage(1);
            return;
          }
          setCapabilityPage(nextPage);
        },
      }),
    [capabilityItems.length, capabilityPage, capabilityPageSize],
  );
  const issuePagination = useMemo(
    () =>
      buildTablePagination({
        current: issuePage,
        pageSize: issuePageSize,
        total: issueItemsFiltered.length,
        onChange: (nextPage, nextPageSize) => {
          if (nextPageSize !== issuePageSize) {
            setIssuePageSize(nextPageSize);
            setIssuePage(1);
            return;
          }
          setIssuePage(nextPage);
        },
      }),
    [issueItemsFiltered.length, issuePage, issuePageSize],
  );

  useEffect(() => {
    setCapabilityPage((prev) => Math.min(prev, capabilityMaxPage));
  }, [capabilityMaxPage]);

  useEffect(() => {
    setIssuePage(1);
  }, [timeQuery.from, timeQuery.range, timeQuery.to]);

  useEffect(() => {
    setIssuePage((prev) => Math.min(prev, issueMaxPage));
  }, [issueMaxPage]);

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsPageHeader
        title="集群资源巡检"
        subtitle="参考主流 Kubernetes 平台，统一巡检集群、名称空间、工作负载、网络、存储、配置与活跃告警。"
      />

      <OpsSurface variant="toolbar" padding="sm">
        <ResourceFilterToolbar
          actions={
            <>
              <OpsIconActionButton icon={<ReloadOutlined />} onClick={() => void handleRefreshInspection()} loading={refreshingInspection}>
                重新巡检
              </OpsIconActionButton>
              <Select
                style={{ width: 130 }}
                value={exportFormat}
                onChange={(value) => setExportFormat(value)}
                options={[
                  { label: "JSON", value: "json" },
                  { label: "CSV", value: "csv" },
                  { label: "Excel", value: "xlsx" },
                ]}
              />
              <OpsIconActionButton
                opsTone="primary"
                opsVariant="primary"
                icon={<DownloadOutlined />}
                onClick={() => exportMutation.mutate()}
                loading={exportMutation.isPending}
                disabled={!enabled}
                disabledReason={!enabled ? "登录后可导出报告" : undefined}
              >
                导出报告
              </OpsIconActionButton>
              <Typography.Text type="secondary">
                最后更新时间：{reportQuery.dataUpdatedAt ? new Date(reportQuery.dataUpdatedAt).toLocaleString("zh-CN") : "-"}
              </Typography.Text>
            </>
          }
        >
          <ResourceFilterToolbarItem width="auto">
            <ResourceScopeFilterButton
              clusterId={clusterId}
              namespace={namespace}
              clusterOptions={clusterOptions}
              clusterLoading={clustersQuery.isLoading}
              knownNamespaces={knownNamespaces}
              namespaceDisabled={namespaceDisabled}
              namespacePlaceholder={namespacePlaceholder}
              onApply={({ clusterId: nextClusterId, namespace: nextNamespace }) => {
                onScopeChange(nextClusterId, nextNamespace);
                setIssuePage(1);
              }}
            />
          </ResourceFilterToolbarItem>
          <ResourceFilterToolbarItem label="时间范围" width="sm">
            <Select
              style={{ width: "100%" }}
              value={timePreset}
              onChange={(value: MonitoringTimePreset | "custom") => setTimePreset(value)}
              options={TIME_PRESETS}
            />
          </ResourceFilterToolbarItem>
          {timePreset === "custom" ? (
            <ResourceFilterToolbarItem label="自定义时间" width="xl">
              <RangePicker
                showTime
                format="YYYY-MM-DD HH:mm:ss"
                value={customRange}
                onChange={(value) => setCustomRange(value as [Dayjs, Dayjs] | null)}
              />
            </ResourceFilterToolbarItem>
          ) : null}
        </ResourceFilterToolbar>
      </OpsSurface>

      {!enabled ? <Alert type="warning" showIcon message="请先登录后再执行资源巡检。" /> : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="巡检评分" value={reportQuery.data?.summary.score ?? 0} suffix="/ 100" />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="资源总数" value={reportQuery.data?.summary.totalResources ?? 0} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="严重问题" value={reportQuery.data?.summary.critical ?? 0} styles={{ content: { color: "#cf1322" } }} />
          </Card>
        </Col>
        <Col xs={24} md={6}>
          <Card>
            <Statistic title="警告问题" value={reportQuery.data?.summary.warning ?? 0} styles={{ content: { color: "#d48806" } }} />
          </Card>
        </Col>
      </Row>

      {capabilityQuery.isError ? (
        <Alert
          type="warning"
          showIcon
          title="能力基线矩阵加载失败"
          description={capabilityQuery.error instanceof Error ? capabilityQuery.error.message : "请求失败"}
        />
      ) : null}

      {capabilityQuery.data?.integrityIssues.length ? (
        <Alert
          type="warning"
          showIcon
          title="能力基线存在数据完整性问题"
          description={
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {capabilityQuery.data.integrityIssues.map((issue) => (
                <li key={issue}>{issue}</li>
              ))}
            </ul>
          }
        />
      ) : null}

      <OpsSurface
        variant="panel"
        padding="sm"
        title="能力基线矩阵（Rancher / KubeSphere 对标）"
        actions={
          <Typography.Text type="secondary">
            最后更新时间：{capabilityQuery.data?.updatedAt ? new Date(capabilityQuery.data.updatedAt).toLocaleString("zh-CN") : "-"}
          </Typography.Text>
        }
      >
        <Row gutter={[16, 16]} style={{ marginBottom: 8 }}>
          <Col xs={24} md={6}>
            <Statistic title="能力项总数" value={capabilityStats.total} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="已实现" value={capabilityStats.implemented} styles={{ content: { color: "#389e0d" } }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="规划中" value={capabilityStats.planned} styles={{ content: { color: "#1677ff" } }} />
          </Col>
          <Col xs={24} md={6}>
            <Statistic title="待补齐" value={capabilityStats.gap} styles={{ content: { color: "#d48806" } }} />
          </Col>
        </Row>

        <ResourceTable<CapabilityBaselineMatrixItem>
          rowKey={(record) => `${record.category}-${record.capabilityName}`}
          tableKey="business.inspection.capabilityBaseline"
          columns={capabilityColumns as ColumnsType<CapabilityBaselineMatrixItem>}
          dataSource={capabilityPagedItems}
          preferencesClient={tablePreferencesClient}
          filters={capabilityFilters}
          onFiltersChange={(nextFilters) => {
            setCapabilityFilters(nextFilters);
            setCapabilityPage(1);
          }}
          loading={capabilityQuery.isLoading}
          pagination={capabilityPagination}
          scroll={{ x: 1300 }}
        />
      </OpsSurface>

      {reportQuery.isError ? (
        <Alert
          type="error"
          showIcon
          title="巡检失败"
          description={reportQuery.error instanceof Error ? reportQuery.error.message : "请求失败"}
        />
      ) : null}

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<InspectionIssue>
          rowKey="id"
          tableKey="business.inspection.issues"
          columns={columns as ColumnsType<InspectionIssue>}
          onResourceNavigate={(request) => setResourceDetailTarget(request)}
          dataSource={issuePagedItems}
          preferencesClient={tablePreferencesClient}
          globalSearch={{
            value: keywordInput,
            onChange: (value) => {
              setKeywordInput(value);
              setKeyword(value.trim());
              setIssuePage(1);
            },
            placeholder: "搜索问题 / 资源 / 证据 / 修复建议",
          }}
          filters={issueFilters}
          onFiltersChange={(nextFilters) => {
            setIssueFilters(nextFilters);
            setIssuePage(1);
          }}
          loading={reportQuery.isLoading}
          pagination={issuePagination}
          className="inspection-issues-table"
          layoutOptions={{
            actionWidth: 156,
            autoFit: {
              rows: issuePagedItems,
              min: 96,
              max: 420,
              sampleSize: 12,
            },
          }}
        />
      </OpsSurface>

      <OpsModalShell
        open={Boolean(activeResult)}
        width={900}
        title={activeResult?.action === "create-hpa-draft" ? "HPA 草案" : "修复 YAML"}
        description="查看巡检动作生成的修复内容，可下载 YAML 后再应用。"
        identity={activeResult?.issueId ?? "巡检动作"}
        onCancel={() => setActiveResult(null)}
        footer={
          <Space>
            <Button
              icon={<DownloadOutlined />}
              disabled={!activeResult?.generatedYaml?.trim()}
              onClick={() => {
                if (!activeResult?.generatedYaml?.trim()) {
                  return;
                }
                const target = activeResult.target;
                const kind = sanitizeFilenameSegment(target?.kind ?? "resource", "resource");
                const name = sanitizeFilenameSegment(target?.name ?? activeResult.issueId, "item");
                downloadTextFile(activeResult.generatedYaml, `${kind}-${name}.yaml`);
              }}
            >
              下载 YAML
            </Button>
            <Button onClick={() => setActiveResult(null)} type="primary">
              关闭
            </Button>
          </Space>
        }
      >
        {activeResult ? (
          <Space orientation="vertical" size={12} style={{ width: "100%" }}>
            <Alert type={activeResult.success ? "success" : "error"} showIcon message={activeResult.message} />
            <Descriptions size="small" bordered column={1}>
              <Descriptions.Item label="问题编号">{activeResult.issueId}</Descriptions.Item>
              <Descriptions.Item label="处理方式">{inspectionActionLabel(activeResult.action)}</Descriptions.Item>
              <Descriptions.Item label="目标资源">
                {activeResult.target
                  ? `${activeResult.target.kind}/${activeResult.target.namespace ?? "-"}/${activeResult.target.name ?? "-"}`
                  : "-"}
              </Descriptions.Item>
            </Descriptions>
            <Card size="small" title="生成结果">
              <pre style={{ margin: 0, overflowX: "auto", whiteSpace: "pre-wrap" }}>
                {activeResult.generatedYaml || "(无返回内容)"}
              </pre>
            </Card>
          </Space>
        ) : null}
      </OpsModalShell>
      <BusinessDetailDrawer
        open={Boolean(issueDetail)}
        title={issueDetail ? `巡检问题 · ${issueDetail.title}` : "巡检问题"}
        subtitle={issueDetail ? `${CATEGORY_LABEL[issueDetail.category] ?? issueDetail.category} / ${issueDetail.resourceRef}` : undefined}
        onClose={() => setIssueDetail(null)}
        sections={buildInspectionIssueDetailSections(issueDetail)}
      />
      <ResourceDetailDrawer
        open={Boolean(resourceDetailTarget)}
        onClose={() => setResourceDetailTarget(null)}
        request={resourceDetailTarget}
        onNavigateRequest={(request) => setResourceDetailTarget(request)}
        token={accessToken ?? undefined}
      />
      <BusinessDetailDrawer
        open={Boolean(capabilityDetail)}
        title={capabilityDetail ? `能力项 · ${capabilityDetail.capabilityName}` : "能力项"}
        subtitle={capabilityDetail?.category}
        onClose={() => setCapabilityDetail(null)}
        sections={buildCapabilityDetailSections(capabilityDetail)}
      />
    </Space>
  );
}

function buildInspectionIssueDetailSections(record: InspectionIssue | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "basic",
      title: "问题信息",
      items: [
        { key: "severity", label: "严重级别", value: severityTag(record.severity) },
        { key: "category", label: "分类", value: CATEGORY_LABEL[record.category] ?? record.category },
        { key: "title", label: "问题", value: record.title },
        { key: "resourceRef", label: "资源", value: <Typography.Text code>{record.resourceRef}</Typography.Text> },
      ],
    },
    {
      key: "diagnosis",
      title: "诊断与建议",
      items: [
        { key: "evidence", label: "诊断证据", value: record.evidence || "-" },
        { key: "suggestion", label: "修复建议", value: record.suggestion },
        { key: "actions", label: "可用动作", value: record.actions?.map((action) => action.label).join("、") || "-" },
      ],
    },
  ];
}

function buildCapabilityDetailSections(record: CapabilityBaselineMatrixItem | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "basic",
      title: "能力信息",
      items: [
        { key: "category", label: "类别", value: record.category },
        { key: "capabilityName", label: "能力项", value: record.capabilityName },
        { key: "status", label: "状态", value: capabilityStatusTag(record.status) },
        { key: "trackedTask", label: "关联任务", value: record.trackedTask || "-" },
      ],
    },
    {
      key: "alignment",
      title: "平台对标",
      items: [
        { key: "rancherAlignment", label: "Rancher 对标", value: record.rancherAlignment || "-" },
        { key: "kubesphereAlignment", label: "KubeSphere 对标", value: record.kubesphereAlignment || "-" },
        { key: "updatedAt", label: "更新时间", value: record.updatedAt ? new Date(record.updatedAt).toLocaleString("zh-CN") : "-" },
      ],
    },
  ];
}
