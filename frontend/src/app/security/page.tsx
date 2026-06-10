"use client";

import {
  AuditOutlined,
  ExclamationCircleOutlined,
  FileTextOutlined,
  LockOutlined,
  ReloadOutlined,
  SafetyCertificateOutlined,
  WarningOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Col,
  Row,
  Skeleton,
  Space,
  Tabs,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { BusinessDetailDrawer, type BusinessDetailSection } from "@/components/business-detail-drawer";
import { OpsFilterChip, OpsMetricTile, OpsPageHeader, OpsStatusTag, OpsSurface, type OpsFilterChipTone, type OpsStatusTone } from "@/components/ops";
import {
  ResourceActionDropdown,
  type ResourceActionItem,
} from "@/components/resource-action-bar";
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
import {
  buildNamespaceDetailRequest,
  buildResourceRefDetailRequest,
  resolveClusterId,
} from "@/lib/resource-navigation";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { buildTablePagination } from "@/lib/table/pagination";
import { usePersistentTableSortState } from "@/lib/table/use-persistent-table-sort-state";
import { TABLE_COL_WIDTH } from "@/lib/table-column-widths";
import {
  type AuditLogRecord,
  type SecurityEvent,
  getAuditLogs,
  getSecurityEvents,
  getSecurityStats,
  resolveSecurityEvent,
} from "@/lib/api/security";

const DEFAULT_PAGE_SIZE = 20;
const CLIENT_FETCH_SIZE = 500;

function formatTime(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function compareText(left: string | undefined, right: string | undefined): number {
  return (left ?? "").localeCompare(right ?? "", "zh-CN", { sensitivity: "base" });
}

function compareTime(left: string | undefined, right: string | undefined): number {
  return (Date.parse(left ?? "") || 0) - (Date.parse(right ?? "") || 0);
}

function normalizeValue(value: string | undefined | null): string {
  return (value ?? "").trim().toLowerCase();
}

function matchesClusterSelection(cluster: string | undefined, selectedClusterId: string, clusterMap: Record<string, string>): boolean {
  if (!selectedClusterId) return true;
  const normalizedCluster = normalizeValue(cluster);
  if (!normalizedCluster) return false;
  return (
    normalizedCluster === normalizeValue(selectedClusterId) ||
    normalizedCluster === normalizeValue(clusterMap[selectedClusterId])
  );
}

function getEventTypeLabel(type: string): string {
  const map: Record<string, string> = {
    VulnerabilityScan: "漏洞扫描",
    PrivilegeEscalation: "权限提升",
    AuthenticationFailure: "认证失败",
    NetworkPolicyViolation: "网络策略违规",
    PolicyViolation: "策略违规",
    SecretExposure: "敏感信息暴露",
    RBACViolation: "RBAC 权限违规",
  };
  return map[type] ?? type;
}

function getActionLabel(action: string): string {
  const map: Record<string, string> = {
    create: "创建",
    update: "更新",
    delete: "删除",
    enable: "启用",
    disable: "禁用",
    batch: "批量操作",
    scale: "扩缩容",
    restart: "重启",
    rollback: "回滚",
    query: "查询",
  };
  return map[action] ?? action;
}

function SeverityTag({ severity }: { severity: string }) {
  const map: Record<string, { tone: OpsStatusTone; label: string }> = {
    critical: { tone: "danger", label: "严重" },
    high: { tone: "danger", label: "高危" },
    medium: { tone: "warning", label: "中危" },
    low: { tone: "info", label: "低危" },
  };
  const cfg = map[severity] ?? { tone: "neutral", label: severity };
  return <OpsStatusTag tone={cfg.tone}>{cfg.label}</OpsStatusTag>;
}

function EventStatusTag({ status }: { status: string }) {
  if (status === "resolved") {
    return <OpsStatusTag tone="success">已解决</OpsStatusTag>;
  }
  return <OpsStatusTag tone="danger">待处理</OpsStatusTag>;
}

function ActionTag({ action }: { action: string }) {
  const map: Record<string, OpsFilterChipTone> = {
    create: "success",
    update: "info",
    delete: "danger",
    enable: "success",
    disable: "warning",
    batch: "neutral",
    scale: "info",
    restart: "warning",
    rollback: "warning",
    query: "neutral",
  };
  return <OpsFilterChip tone={map[action] ?? "neutral"}>{getActionLabel(action)}</OpsFilterChip>;
}

function ResultTag({ result }: { result: string }) {
  if (result === "success") {
    return <OpsStatusTag tone="success">成功</OpsStatusTag>;
  }
  return <OpsStatusTag tone="danger">失败</OpsStatusTag>;
}

function SecurityEventsTab() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [messageApi, contextHolder] = message.useMessage();
  const [refreshingEvents, setRefreshingEvents] = useState(false);
  const [detailRecord, setDetailRecord] = useState<SecurityEvent | null>(null);
  const [resourceDetailTarget, setResourceDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const [severityFilter, setSeverityFilter] = useState<string | undefined>(undefined);
  const [statusFilter, setStatusFilter] = useState<string | undefined>(undefined);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const enabled = !isInitializing && Boolean(accessToken);
  const {
    sortBy,
    sortOrder,
    getSortableColumnProps,
    handleTableChange,
  } = usePersistentTableSortState<SecurityEvent>({
    storageKey: "security.events.sort",
    allowedSortBy: ["severity", "title", "type", "resourceName", "cluster", "occurredAt", "status"],
    defaultSortBy: "occurredAt",
    defaultSortOrder: "desc",
  });
  const clustersQuery = useQuery({
    queryKey: ["clusters", "security-events", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken),
    enabled,
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const clusterOptions = useMemo(
    () => [{ label: "全部集群", value: "" }, ...(clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id }))],
    [clustersQuery.data?.items],
  );
  const { data, isLoading } = useQuery({
    queryKey: ["security", "events", clusterId, namespace, severityFilter, statusFilter, accessToken],
    queryFn: () =>
      getSecurityEvents(
        {
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
          severity: severityFilter,
          status: statusFilter,
          page: 1,
          pageSize: CLIENT_FETCH_SIZE,
        },
        accessToken || undefined,
      ),
    enabled,
    refetchInterval: 30_000,
  });

  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set(
          (data?.items ?? [])
            .filter((item) => matchesClusterSelection(item.cluster, clusterId, clusterMap))
            .map((item) => item.namespace?.trim() ?? "")
            .filter((item) => item.length > 0),
        ),
      ),
    [clusterId, clusterMap, data?.items],
  );

  const resolveMutation = useMutation({
    mutationFn: (id: string) => resolveSecurityEvent(id, accessToken || undefined),
    onSuccess: () => {
      void messageApi.success("已标记为已解决");
      void queryClient.invalidateQueries({ queryKey: ["security", "events"] });
      void queryClient.invalidateQueries({ queryKey: ["security", "stats"] });
    },
    onError: () => {
      void messageApi.error("操作失败，请稍后重试");
    },
  });

  const filteredItems = useMemo(() => {
    const raw = data?.items ?? [];
    const titleFilter = typeof tableFilters.title === "string" ? tableFilters.title.toLowerCase() : "";
    const typeFilter = typeof tableFilters.type === "string" ? tableFilters.type : "";
    const resourceFilter = typeof tableFilters.resourceName === "string" ? tableFilters.resourceName.toLowerCase() : "";
    const scoped = raw.filter((item) => {
      if (!matchesClusterSelection(item.cluster, clusterId, clusterMap)) return false;
      if (namespace && (item.namespace ?? "") !== namespace) return false;
      return true;
    });
    const kw = keyword.trim().toLowerCase();
    return scoped.filter((item) => {
      const searchText = `${item.title} ${item.type} ${item.resourceName} ${item.cluster}`.toLowerCase();
      const matchKeyword = kw ? searchText.includes(kw) : true;
      const matchTitle = titleFilter ? item.title.toLowerCase().includes(titleFilter) : true;
      const matchType = typeFilter ? item.type === typeFilter : true;
      const matchResource = resourceFilter ? item.resourceName.toLowerCase().includes(resourceFilter) : true;
      return matchKeyword && matchTitle && matchType && matchResource;
    });
  }, [clusterId, clusterMap, data?.items, keyword, namespace, tableFilters.resourceName, tableFilters.title, tableFilters.type]);
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/security",
  });

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (!sortBy || !sortOrder) return list;
    const direction = sortOrder === "asc" ? 1 : -1;
    list.sort((left, right) => {
      switch (sortBy) {
        case "severity":
          return direction * compareText(left.severity, right.severity);
        case "title":
          return direction * compareText(left.title, right.title);
        case "type":
          return direction * compareText(left.type, right.type);
        case "resourceName":
          return direction * compareText(left.resourceName, right.resourceName);
        case "cluster":
          return direction * compareText(left.cluster, right.cluster);
        case "occurredAt":
          return direction * compareTime(left.occurredAt, right.occurredAt);
        case "status":
          return direction * compareText(left.status, right.status);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredItems, sortBy, sortOrder]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [page, pageSize, sortedItems]);
  const tableRows = useMemo(
    () =>
      pagedItems.map((item) => ({
        ...item,
        clusterId: resolveClusterId(item.cluster, clusterMap),
      })),
    [clusterMap, pagedItems],
  );

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sortedItems.length / pageSize));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, pageSize, sortedItems.length]);

  const handleRefreshEvents = async () => {
    setRefreshingEvents(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["security", "events"] });
    } finally {
      setRefreshingEvents(false);
    }
  };

  const columns: Array<HeadlampResourceTableColumn<SecurityEvent>> = [
    {
      title: "严重程度",
      dataIndex: "severity",
      key: "severity",
      width: 90,
      filter: {
        type: "select",
        placeholder: "以严重度过滤",
        options: [
          { label: "严重", value: "critical" },
          { label: "高危", value: "high" },
          { label: "中危", value: "medium" },
          { label: "低危", value: "low" },
        ],
      },
      ...getSortableColumnProps("severity", isLoading && !data),
      render: (v: string) => <SeverityTag severity={v} />,
    },
    {
      title: "事件标题",
      dataIndex: "title",
      key: "title",
      required: true,
      width: 240,
      filter: { type: "text", placeholder: "以标题过滤" },
      ...getSortableColumnProps("title", isLoading && !data),
      ellipsis: true,
      render: (v: string, record) => (
        <Tooltip title={`事件类型: ${getEventTypeLabel(record.type)}`}>
          <Typography.Link onClick={() => setDetailRecord(record)}>{v}</Typography.Link>
        </Tooltip>
      ),
    },
    {
      title: "事件类型",
      dataIndex: "type",
      key: "type",
      width: 180,
      filter: {
        type: "select",
        placeholder: "以事件类型过滤",
        options: [
          { label: "漏洞扫描", value: "VulnerabilityScan" },
          { label: "权限提升", value: "PrivilegeEscalation" },
          { label: "认证失败", value: "AuthenticationFailure" },
          { label: "网络策略违规", value: "NetworkPolicyViolation" },
          { label: "策略违规", value: "PolicyViolation" },
          { label: "敏感信息暴露", value: "SecretExposure" },
          { label: "RBAC 权限违规", value: "RBACViolation" },
        ],
      },
      ...getSortableColumnProps("type", isLoading && !data),
      render: (v: string) => (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {getEventTypeLabel(v)}
        </Typography.Text>
      ),
    },
    {
      title: "资源名称",
      dataIndex: "resourceName",
      key: "resourceName",
      width: 180,
      ellipsis: true,
      filter: { type: "text", placeholder: "以资源过滤" },
      ...getSortableColumnProps("resourceName", isLoading && !data),
      render: (v: string, record) => {
        const request = buildResourceRefDetailRequest({
          resourceRef: v,
          resourceName: v,
          clusterId: record.cluster,
          namespace: record.namespace,
          clusterMap,
        });
        const content = (
          <Typography.Text code ellipsis={{ tooltip: v }} style={{ fontSize: 12, maxWidth: 150 }}>
            {v}
          </Typography.Text>
        );
        return request ? (
          <Typography.Link onClick={() => setResourceDetailTarget(request)}>{content}</Typography.Link>
        ) : content;
      },
    },
    {
      title: "集群",
      dataIndex: "cluster",
      key: "cluster",
      width: TABLE_COL_WIDTH.cluster,
      ellipsis: true,
      ...getSortableColumnProps("cluster", isLoading && !data),
      render: (v: string) => (
        <OpsFilterChip tone="neutral" style={{ maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis" }}>
          {getClusterDisplayName(clusterMap, v)}
        </OpsFilterChip>
      ),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ellipsis: true,
      render: (value: string | null | undefined, record) => {
        const namespaceText = value?.trim();
        if (!namespaceText) return <Typography.Text type="secondary">-</Typography.Text>;
        const request = buildNamespaceDetailRequest({
          clusterId: record.cluster,
          namespace: namespaceText,
          clusterMap,
        });
        return request ? (
          <Typography.Link onClick={() => setResourceDetailTarget(request)}>{namespaceText}</Typography.Link>
        ) : namespaceText;
      },
    },
    {
      title: "发生时间",
      dataIndex: "occurredAt",
      key: "occurredAt",
      width: 155,
      ...getSortableColumnProps("occurredAt", isLoading && !data),
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }}>{formatTime(v)}</Typography.Text>
      ),
    },
    {
      title: "状态",
      dataIndex: "status",
      key: "status",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以状态过滤",
        options: [
          { label: "待处理", value: "open" },
          { label: "已解决", value: "resolved" },
        ],
      },
      ...getSortableColumnProps("status", isLoading && !data),
      render: (v: string) => <EventStatusTag status={v} />,
    },
    {
      title: "操作",
      key: "action",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_, record) => {
        const actions: ResourceActionItem[] = [
          {
            key: "resolve",
            label: record.status === "resolved" ? "已处理" : "标记已解决",
            disabled:
              record.status === "resolved" ||
              (resolveMutation.isPending && resolveMutation.variables === record.id),
            onClick: () => resolveMutation.mutate(record.id),
          },
        ];
        return (
          <ResourceActionDropdown actions={actions} ariaLabel={`${record.title} 更多操作`} />
        );
      },
    },
  ];

  return (
    <>
      {contextHolder}
      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
        <ResourceFilterToolbar>
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
                setPage(1);
              }}
            />
          </ResourceFilterToolbarItem>
        </ResourceFilterToolbar>

        <ResourceTable<SecurityEvent>
          rowKey="id"
          tableKey="business.security.events"
          columns={columns as ColumnsType<SecurityEvent>}
          onResourceNavigate={(request) => setResourceDetailTarget(request)}
          dataSource={tableRows}
          bordered
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keyword,
            onChange: (value) => {
              setKeyword(value);
              setPage(1);
            },
            placeholder: "搜索标题 / 类型 / 资源 / 集群",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            setSeverityFilter(typeof nextFilters.severity === "string" ? nextFilters.severity : undefined);
            setStatusFilter(typeof nextFilters.status === "string" ? nextFilters.status : undefined);
            setPage(1);
          }}
          toolbarExtra={
            <Button
              icon={<ReloadOutlined />}
              loading={refreshingEvents}
              onClick={() => void handleRefreshEvents()}
            >
              刷新
            </Button>
          }
          loading={isLoading}
          size="small"
          scroll={{ x: 1000 }}
          onChange={(pagination, filters, sorter, extra) => {
            handleTableChange(pagination, filters, sorter, extra, isLoading && !data);
            if (extra.action === "sort") {
              setPage(1);
            }
          }}
          pagination={buildTablePagination({
            current: page,
            pageSize,
            total: sortedItems.length,
            onChange: (nextPage, nextPageSize) => {
              if (typeof nextPageSize === "number" && nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            },
          })}
          rowClassName={(record) =>
            record.severity === "critical" && record.status === "open"
              ? "ant-table-row-danger"
              : ""
          }
        />
      </Space>
      <BusinessDetailDrawer
        open={Boolean(detailRecord)}
        title={detailRecord ? `安全事件 · ${detailRecord.title}` : "安全事件"}
        subtitle={detailRecord ? `${getEventTypeLabel(detailRecord.type)} / ${detailRecord.resourceName}` : undefined}
        onClose={() => setDetailRecord(null)}
        sections={buildSecurityEventDetailSections(detailRecord, clusterMap)}
      />
      <ResourceDetailDrawer
        open={Boolean(resourceDetailTarget)}
        onClose={() => setResourceDetailTarget(null)}
        request={resourceDetailTarget}
        onNavigateRequest={(request) => setResourceDetailTarget(request)}
        token={accessToken ?? undefined}
      />
    </>
  );
}

function AuditLogsTab() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [refreshingAuditLogs, setRefreshingAuditLogs] = useState(false);
  const [detailRecord, setDetailRecord] = useState<AuditLogRecord | null>(null);

  const [actionFilter, setActionFilter] = useState<string | undefined>(undefined);
  const [resultFilter, setResultFilter] = useState<string | undefined>(undefined);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_PAGE_SIZE);

  const enabled = !isInitializing && Boolean(accessToken);
  const {
    sortBy,
    sortOrder,
    getSortableColumnProps,
    handleTableChange,
  } = usePersistentTableSortState<AuditLogRecord>({
    storageKey: "security.audit-logs.sort",
    allowedSortBy: ["actor", "role", "action", "resourceType", "resourceId", "result", "timestamp"],
    defaultSortBy: "timestamp",
    defaultSortOrder: "desc",
  });

  const { data, isLoading } = useQuery({
    queryKey: ["security", "audit-logs", actionFilter, resultFilter, accessToken],
    queryFn: () =>
      getAuditLogs(
        { action: actionFilter, result: resultFilter, page: 1, pageSize: CLIENT_FETCH_SIZE },
        accessToken || undefined,
      ),
    enabled,
  });

  const filteredItems = useMemo(() => {
    const raw = data?.items ?? [];
    const kw = keyword.trim().toLowerCase();
    const actorFilter = typeof tableFilters.actor === "string" ? tableFilters.actor.toLowerCase() : "";
    const roleFilter = typeof tableFilters.role === "string" ? tableFilters.role.toLowerCase() : "";
    const resourceTypeFilter = typeof tableFilters.resourceType === "string" ? tableFilters.resourceType.toLowerCase() : "";
    const resourceIdFilter = typeof tableFilters.resourceId === "string" ? tableFilters.resourceId.toLowerCase() : "";
    return raw.filter((item) => {
      const searchText = `${item.actor} ${item.resourceType} ${item.resourceId}`.toLowerCase();
      const matchKeyword = kw ? searchText.includes(kw) : true;
      const matchActor = actorFilter ? item.actor.toLowerCase().includes(actorFilter) : true;
      const matchRole = roleFilter ? item.role.toLowerCase().includes(roleFilter) : true;
      const matchResourceType = resourceTypeFilter ? item.resourceType.toLowerCase().includes(resourceTypeFilter) : true;
      const matchResourceId = resourceIdFilter ? item.resourceId.toLowerCase().includes(resourceIdFilter) : true;
      return matchKeyword && matchActor && matchRole && matchResourceType && matchResourceId;
    });
  }, [data?.items, keyword, tableFilters.actor, tableFilters.resourceId, tableFilters.resourceType, tableFilters.role]);

  const sortedItems = useMemo(() => {
    const list = [...filteredItems];
    if (!sortBy || !sortOrder) return list;
    const direction = sortOrder === "asc" ? 1 : -1;
    list.sort((left, right) => {
      switch (sortBy) {
        case "actor":
          return direction * compareText(left.actor, right.actor);
        case "role":
          return direction * compareText(left.role, right.role);
        case "action":
          return direction * compareText(left.action, right.action);
        case "resourceType":
          return direction * compareText(left.resourceType, right.resourceType);
        case "resourceId":
          return direction * compareText(left.resourceId, right.resourceId);
        case "result":
          return direction * compareText(left.result, right.result);
        case "timestamp":
          return direction * compareTime(left.timestamp, right.timestamp);
        default:
          return 0;
      }
    });
    return list;
  }, [filteredItems, sortBy, sortOrder]);

  const pagedItems = useMemo(() => {
    const start = (page - 1) * pageSize;
    return sortedItems.slice(start, start + pageSize);
  }, [page, pageSize, sortedItems]);

  useEffect(() => {
    const maxPage = Math.max(1, Math.ceil(sortedItems.length / pageSize));
    if (page > maxPage) {
      setPage(maxPage);
    }
  }, [page, pageSize, sortedItems.length]);

  const handleRefreshAuditLogs = async () => {
    setRefreshingAuditLogs(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ["security", "audit-logs"] });
    } finally {
      setRefreshingAuditLogs(false);
    }
  };

  const columns: Array<HeadlampResourceTableColumn<AuditLogRecord>> = [
    {
      title: "操作用户",
      dataIndex: "actor",
      key: "actor",
      width: 130,
      required: true,
      ellipsis: true,
      filter: { type: "text", placeholder: "以用户过滤" },
      ...getSortableColumnProps("actor", isLoading && !data),
      render: (v: string, record) => (
        <Space size={4}>
          <Tooltip title={v}>
            <Typography.Link
              strong
              ellipsis
              style={{ fontSize: 13, maxWidth: 104 }}
              onClick={() => setDetailRecord(record)}
            >
              {v}
            </Typography.Link>
          </Tooltip>
        </Space>
      ),
    },
    {
      title: "角色",
      dataIndex: "role",
      key: "role",
      width: 140,
      ellipsis: true,
      filter: { type: "text", placeholder: "以角色过滤" },
      ...getSortableColumnProps("role", isLoading && !data),
      render: (v: string) => (
        <Typography.Text type="secondary" ellipsis={{ tooltip: v }} style={{ fontSize: 12, maxWidth: 112 }}>
          {v}
        </Typography.Text>
      ),
    },
    {
      title: "操作类型",
      dataIndex: "action",
      key: "action",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以操作过滤",
        options: [
          { label: "创建", value: "create" },
          { label: "更新", value: "update" },
          { label: "删除", value: "delete" },
          { label: "启用", value: "enable" },
          { label: "禁用", value: "disable" },
          { label: "查询", value: "query" },
        ],
      },
      ...getSortableColumnProps("action", isLoading && !data),
      render: (v: string) => <ActionTag action={v} />,
    },
    {
      title: "资源类型",
      dataIndex: "resourceType",
      key: "resourceType",
      width: 160,
      ellipsis: true,
      filter: { type: "text", placeholder: "以资源类型过滤" },
      ...getSortableColumnProps("resourceType", isLoading && !data),
      render: (v: string) => (
        <OpsFilterChip tone="neutral" style={{ margin: 0, maxWidth: 132, overflow: "hidden", textOverflow: "ellipsis" }}>
          {v}
        </OpsFilterChip>
      ),
    },
    {
      title: "资源名称",
      dataIndex: "resourceId",
      key: "resourceId",
      width: 260,
      filter: { type: "text", placeholder: "以资源名过滤" },
      ...getSortableColumnProps("resourceId", isLoading && !data),
      ellipsis: true,
      render: (v: string, record) => (
        <Tooltip title={v}>
          <Typography.Link
            code
            ellipsis
            style={{ fontSize: 12, maxWidth: 230 }}
            onClick={() => setDetailRecord(record)}
          >
            {v}
          </Typography.Link>
        </Tooltip>
      ),
    },
    {
      title: "结果",
      dataIndex: "result",
      key: "result",
      width: 80,
      filter: {
        type: "select",
        placeholder: "以结果过滤",
        options: [
          { label: "成功", value: "success" },
          { label: "失败", value: "failure" },
        ],
      },
      ...getSortableColumnProps("result", isLoading && !data),
      render: (v: string) => <ResultTag result={v} />,
    },
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 155,
      ...getSortableColumnProps("timestamp", isLoading && !data),
      render: (v: string) => (
        <Typography.Text style={{ fontSize: 12 }}>{formatTime(v)}</Typography.Text>
      ),
    },
  ];

  return (
    <>
      <ResourceTable<AuditLogRecord>
        rowKey="id"
        tableKey="business.security.auditLogs"
        columns={columns as ColumnsType<AuditLogRecord>}
        dataSource={pagedItems}
        preferencesClient={createTablePreferencesClient(accessToken || undefined)}
        globalSearch={{
          value: keyword,
          onChange: (value) => {
            setKeyword(value);
            setPage(1);
          },
          placeholder: "搜索用户 / 资源类型 / 资源名",
        }}
        filters={tableFilters}
        onFiltersChange={(nextFilters) => {
          setTableFilters(nextFilters);
          setActionFilter(typeof nextFilters.action === "string" ? nextFilters.action : undefined);
          setResultFilter(typeof nextFilters.result === "string" ? nextFilters.result : undefined);
          setPage(1);
        }}
        toolbarExtra={
          <Button
            icon={<ReloadOutlined />}
            loading={refreshingAuditLogs}
            onClick={() => void handleRefreshAuditLogs()}
          >
            刷新
          </Button>
        }
        loading={isLoading}
        size="small"
        scroll={{ x: 900 }}
        onChange={(pagination, filters, sorter, extra) => {
          handleTableChange(pagination, filters, sorter, extra, isLoading && !data);
          if (extra.action === "sort") {
            setPage(1);
          }
        }}
        pagination={buildTablePagination({
          current: page,
          pageSize,
          total: sortedItems.length,
          onChange: (nextPage, nextPageSize) => {
            if (typeof nextPageSize === "number" && nextPageSize !== pageSize) {
              setPageSize(nextPageSize);
              setPage(1);
              return;
            }
            setPage(nextPage);
          },
        })}
      />
      <BusinessDetailDrawer
        open={Boolean(detailRecord)}
        title={detailRecord ? `审计日志 · ${detailRecord.actor}` : "审计日志"}
        subtitle={detailRecord ? `${getActionLabel(detailRecord.action)} / ${detailRecord.resourceType}` : undefined}
        onClose={() => setDetailRecord(null)}
        sections={buildAuditLogDetailSections(detailRecord)}
      />
    </>
  );
}

function buildSecurityEventDetailSections(
  record: SecurityEvent | null,
  clusterMap: Record<string, string>,
): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "event",
      title: "事件信息",
      items: [
        { key: "title", label: "事件标题", value: record.title },
        { key: "severity", label: "严重程度", value: <SeverityTag severity={record.severity} /> },
        { key: "type", label: "事件类型", value: getEventTypeLabel(record.type) },
        { key: "status", label: "状态", value: <EventStatusTag status={record.status} /> },
      ],
    },
    {
      key: "resource",
      title: "资源范围",
      items: [
        { key: "cluster", label: "集群", value: getClusterDisplayName(clusterMap, record.cluster) },
        { key: "namespace", label: "名称空间", value: record.namespace || "-" },
        { key: "resourceName", label: "资源名称", value: <Typography.Text code>{record.resourceName}</Typography.Text> },
      ],
    },
    {
      key: "time",
      title: "时间",
      items: [{ key: "occurredAt", label: "发生时间", value: formatTime(record.occurredAt) }],
    },
  ];
}

function buildAuditLogDetailSections(record: AuditLogRecord | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "actor",
      title: "操作者",
      items: [
        { key: "actor", label: "操作用户", value: record.actor },
        { key: "role", label: "角色", value: record.role },
      ],
    },
    {
      key: "operation",
      title: "操作信息",
      items: [
        { key: "action", label: "操作类型", value: <ActionTag action={record.action} /> },
        { key: "result", label: "结果", value: <ResultTag result={record.result} /> },
        { key: "timestamp", label: "时间", value: formatTime(record.timestamp) },
      ],
    },
    {
      key: "resource",
      title: "资源",
      items: [
        { key: "resourceType", label: "资源类型", value: record.resourceType },
        { key: "resourceId", label: "资源名称", value: <Typography.Text code>{record.resourceId}</Typography.Text> },
      ],
    },
  ];
}

export default function SecurityPage() {
  const { accessToken, isInitializing } = useAuth();
  const enabled = !isInitializing && Boolean(accessToken);

  const { data: stats, isLoading: statsLoading } = useQuery({
    queryKey: ["security", "stats"],
    queryFn: () => getSecurityStats(accessToken || undefined),
    enabled,
    refetchInterval: 60_000,
  });

  const complianceTone =
    (stats?.complianceScore ?? 0) >= 90
      ? "success"
      : (stats?.complianceScore ?? 0) >= 70
        ? "warning"
        : "danger";

  const tabItems = [
    {
      key: "events",
      label: (
        <Space>
          <WarningOutlined />
          安全事件
        </Space>
      ),
      children: (
        <OpsSurface variant="panel" padding="sm">
          <SecurityEventsTab />
        </OpsSurface>
      ),
    },
    {
      key: "audit-logs",
      label: (
        <Space>
          <AuditOutlined />
          审计日志
        </Space>
      ),
      children: (
        <OpsSurface variant="panel" padding="sm">
          <AuditLogsTab />
        </OpsSurface>
      ),
    },
  ];

  return (
    <div>
      <OpsPageHeader
        className="resource-page-header"
        title="安全审计"
        subtitle="聚合漏洞扫描、安全事件与操作审计日志，全面掌握集群安全态势。"
      />

      {/* 统计卡片 */}
      <Skeleton loading={statsLoading} active paragraph={{ rows: 1 }}>
        <Row gutter={[16, 16]} style={{ marginBottom: 24 }}>
          <Col xs={24} sm={12} lg={6}>
            <OpsMetricTile
              icon={<LockOutlined />}
              label="高危漏洞数"
              meta={(stats?.criticalVulnerabilities ?? 0) > 0 ? "需立即处理" : undefined}
              tone={(stats?.criticalVulnerabilities ?? 0) > 0 ? "danger" : "success"}
              value={stats?.criticalVulnerabilities ?? 0}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <OpsMetricTile
              icon={<ExclamationCircleOutlined />}
              label="待处理事件"
              tone={(stats?.openEvents ?? 0) > 0 ? "warning" : "success"}
              value={stats?.openEvents ?? 0}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <OpsMetricTile
              icon={<SafetyCertificateOutlined />}
              label="合规评分"
              suffix="%"
              tone={complianceTone}
              value={stats?.complianceScore ?? 0}
            />
          </Col>
          <Col xs={24} sm={12} lg={6}>
            <OpsMetricTile
              icon={<FileTextOutlined />}
              label="今日审计日志"
              tone="info"
              value={stats?.todayAuditLogs ?? 0}
            />
          </Col>
        </Row>
      </Skeleton>

      {/* 安全事件 + 审计日志 Tabs */}
      <Tabs defaultActiveKey="events" items={tabItems} />
    </div>
  );
}
