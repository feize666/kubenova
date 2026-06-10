"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Col, Form, Input, Row, Select, Space, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsFormSection, OpsModalShell, OpsSurface } from "@/components/ops";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceCreateMethodTabs, type ResourceCreateMode } from "@/components/resource-create-method-tabs";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { ResourceTable } from "@/components/resource-table";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { matchLabelExpressions, parseResourceSearchInput } from "@/components/resource-action-bar";
import { getClusters } from "@/lib/api/clusters";
import {
  applyResourceYaml,
  createDynamicResource,
  deleteDynamicResource,
  getDynamicResourceDetail,
  getDynamicResources,
  refreshResourceDiscovery,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
  type ResourceDetailRequest,
} from "@/lib/api/resources";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination, type HeadlampTableFilters } from "@/lib/table";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type DynamicConfigResourcePageProps = {
  path: string;
  tableKey: string;
  titleKind: string;
  group?: string;
  version: string;
  resource: string;
  kind: string;
  emptyDescription: string;
  resourceType: "limitrange" | "resourcequota";
};

type CreateConfigPolicyFormValues = {
  clusterId: string;
  namespace: string;
  name: string;
  limitType?: "Container" | "Pod" | "PersistentVolumeClaim";
  defaultCpu?: string;
  defaultMemory?: string;
  defaultRequestCpu?: string;
  defaultRequestMemory?: string;
  minCpu?: string;
  minMemory?: string;
  maxCpu?: string;
  maxMemory?: string;
  minStorage?: string;
  maxStorage?: string;
  maxLimitRequestRatioCpu?: string;
  maxLimitRequestRatioMemory?: string;
  requestsCpu?: string;
  limitsCpu?: string;
  requestsMemory?: string;
  limitsMemory?: string;
  pods?: string;
  persistentVolumeClaims?: string;
  requestsStorage?: string;
  customHardText?: string;
};

type DynamicRawById = Record<string, Record<string, unknown>>;

const DNS_LABEL_RULE = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asRecordString(value: unknown): Record<string, string> {
  const record = asRecord(value);
  return Object.fromEntries(
    Object.entries(record).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}

function compactEntries(entries: Array<[string, string | undefined]>): Array<[string, string]> {
  return entries
    .map(([key, value]) => [key, value?.trim() ?? ""] as [string, string])
    .filter(([, value]) => value.length > 0);
}

function parseCpuQuantity(value?: string): number | null {
  const text = value?.trim();
  if (!text) return null;
  if (text.endsWith("m")) {
    const numberValue = Number(text.slice(0, -1));
    return Number.isFinite(numberValue) ? numberValue / 1000 : null;
  }
  const numberValue = Number(text);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function parseBinaryQuantity(value?: string): number | null {
  const text = value?.trim();
  if (!text) return null;
  const match = text.match(/^([0-9]+(?:\.[0-9]+)?)(Ki|Mi|Gi|Ti|Pi|Ei|K|M|G|T|P|E)?$/);
  if (!match) return null;
  const baseValue = Number(match[1]);
  if (!Number.isFinite(baseValue)) return null;
  const unit = match[2] ?? "";
  const multipliers: Record<string, number> = {
    Ki: 1024,
    Mi: 1024 ** 2,
    Gi: 1024 ** 3,
    Ti: 1024 ** 4,
    Pi: 1024 ** 5,
    Ei: 1024 ** 6,
    K: 1000,
    M: 1000 ** 2,
    G: 1000 ** 3,
    T: 1000 ** 4,
    P: 1000 ** 5,
    E: 1000 ** 6,
  };
  return baseValue * (multipliers[unit] ?? 1);
}

function assertQuantityOrder(
  lower: string | undefined,
  upper: string | undefined,
  lowerLabel: string,
  upperLabel: string,
  parser: (value?: string) => number | null,
) {
  const left = parser(lower);
  const right = parser(upper);
  if (left === null || right === null) return;
  if (left > right) {
    throw new Error(`${lowerLabel} 不能大于 ${upperLabel}`);
  }
}

function renderValueChip(value?: string) {
  return value?.trim() ? <OpsFilterChip tone="neutral">{value.trim()}</OpsFilterChip> : <Typography.Text type="secondary">-</Typography.Text>;
}

function renderPairChips(left?: string, right?: string) {
  const items = compactEntries([
    ["req", left],
    ["lim", right],
  ]);
  if (items.length === 0) {
    return <Typography.Text type="secondary">-</Typography.Text>;
  }
  return (
    <Space size={4} wrap>
      {items.map(([label, value]) => (
        <OpsFilterChip key={label} tone="neutral">{label}: {value}</OpsFilterChip>
      ))}
    </Space>
  );
}

function getFirstLimit(raw: Record<string, unknown>) {
  const spec = asRecord(raw.spec);
  const limits = Array.isArray(spec.limits) ? spec.limits : [];
  return asRecord(limits[0]);
}

function getNestedQuantity(raw: Record<string, unknown>, section: string, key: "cpu" | "memory" | "storage"): string {
  return String(asRecord(getFirstLimit(raw)[section])[key] ?? "");
}

function getQuotaHard(raw: Record<string, unknown>): Record<string, string> {
  const status = asRecord(raw.status);
  const spec = asRecord(raw.spec);
  return {
    ...asRecordString(spec.hard),
    ...asRecordString(status.hard),
  };
}

function getQuotaUsed(raw: Record<string, unknown>): Record<string, string> {
  return asRecordString(asRecord(raw.status).used);
}

function formatQuotaUsage(raw: Record<string, unknown>, key: string): string {
  const hard = getQuotaHard(raw)[key];
  const used = getQuotaUsed(raw)[key];
  if (!hard) return "";
  return used ? `${used} / ${hard}` : hard;
}

function parseCustomHardText(value?: string): Array<[string, string]> {
  return (value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const separator = line.includes("=") ? "=" : ":";
      const index = line.indexOf(separator);
      if (index < 1) return null;
      const key = line.slice(0, index).trim();
      const entryValue = line.slice(index + 1).trim();
      return key && entryValue ? [key, entryValue] as [string, string] : null;
    })
    .filter((entry): entry is [string, string] => Boolean(entry));
}

function buildLimitRangeBody(values: CreateConfigPolicyFormValues): Record<string, unknown> {
  const limitType = values.limitType ?? "Container";
  const sectionCandidates: Array<[string, Array<[string, string]>]> =
    limitType === "PersistentVolumeClaim"
      ? [
          ["min", compactEntries([["storage", values.minStorage]])],
          ["max", compactEntries([["storage", values.maxStorage]])],
        ]
      : [
          ...(limitType === "Container"
            ? [
                ["defaultRequest", compactEntries([["cpu", values.defaultRequestCpu], ["memory", values.defaultRequestMemory]])],
                ["default", compactEntries([["cpu", values.defaultCpu], ["memory", values.defaultMemory]])],
              ] as Array<[string, Array<[string, string]>]>
            : []),
          ["min", compactEntries([["cpu", values.minCpu], ["memory", values.minMemory]])],
          ["max", compactEntries([["cpu", values.maxCpu], ["memory", values.maxMemory]])],
          ["maxLimitRequestRatio", compactEntries([["cpu", values.maxLimitRequestRatioCpu], ["memory", values.maxLimitRequestRatioMemory]])],
        ];
  const sections = sectionCandidates.filter(([, entries]) => entries.length > 0);

  const limit: Record<string, unknown> = { type: limitType };
  sections.forEach(([section, entries]) => {
    limit[section] = Object.fromEntries(entries);
  });

  return {
    apiVersion: "v1",
    kind: "LimitRange",
    metadata: {
      name: values.name.trim(),
      namespace: values.namespace.trim(),
    },
    spec: {
      limits: [limit],
    },
  };
}

function validateLimitRangeValues(values: CreateConfigPolicyFormValues) {
  const limitType = values.limitType ?? "Container";
  if (limitType === "PersistentVolumeClaim") {
    assertQuantityOrder(values.minStorage, values.maxStorage, "最小存储", "最大存储", parseBinaryQuantity);
    return;
  }
  assertQuantityOrder(values.minCpu, values.maxCpu, "最小 CPU", "最大 CPU", parseCpuQuantity);
  assertQuantityOrder(values.minMemory, values.maxMemory, "最小内存", "最大内存", parseBinaryQuantity);
  if (limitType === "Container") {
    assertQuantityOrder(values.defaultRequestCpu, values.defaultCpu, "默认请求 CPU", "默认限制 CPU", parseCpuQuantity);
    assertQuantityOrder(values.defaultRequestMemory, values.defaultMemory, "默认请求内存", "默认限制内存", parseBinaryQuantity);
    assertQuantityOrder(values.minCpu, values.defaultRequestCpu, "最小 CPU", "默认请求 CPU", parseCpuQuantity);
    assertQuantityOrder(values.defaultCpu, values.maxCpu, "默认限制 CPU", "最大 CPU", parseCpuQuantity);
    assertQuantityOrder(values.minMemory, values.defaultRequestMemory, "最小内存", "默认请求内存", parseBinaryQuantity);
    assertQuantityOrder(values.defaultMemory, values.maxMemory, "默认限制内存", "最大内存", parseBinaryQuantity);
  }
}

function countLimitRangeEntries(values: CreateConfigPolicyFormValues): number {
  const limitType = values.limitType ?? "Container";
  if (limitType === "PersistentVolumeClaim") {
    return compactEntries([
      ["minStorage", values.minStorage],
      ["maxStorage", values.maxStorage],
    ]).length;
  }
  return compactEntries([
    ...(limitType === "Container"
      ? [
          ["defaultCpu", values.defaultCpu],
          ["defaultMemory", values.defaultMemory],
          ["defaultRequestCpu", values.defaultRequestCpu],
          ["defaultRequestMemory", values.defaultRequestMemory],
        ] as Array<[string, string | undefined]>
      : []),
    ["minCpu", values.minCpu],
    ["minMemory", values.minMemory],
    ["maxCpu", values.maxCpu],
    ["maxMemory", values.maxMemory],
    ["maxLimitRequestRatioCpu", values.maxLimitRequestRatioCpu],
    ["maxLimitRequestRatioMemory", values.maxLimitRequestRatioMemory],
  ]).length;
}

function buildResourceQuotaBody(values: CreateConfigPolicyFormValues): Record<string, unknown> {
  const entries = [
    ...compactEntries([
      ["requests.cpu", values.requestsCpu],
      ["limits.cpu", values.limitsCpu],
      ["requests.memory", values.requestsMemory],
      ["limits.memory", values.limitsMemory],
      ["pods", values.pods],
      ["persistentvolumeclaims", values.persistentVolumeClaims],
      ["requests.storage", values.requestsStorage],
    ]),
    ...parseCustomHardText(values.customHardText),
  ];

  return {
    apiVersion: "v1",
    kind: "ResourceQuota",
    metadata: {
      name: values.name.trim(),
      namespace: values.namespace.trim(),
    },
    spec: {
      hard: Object.fromEntries(entries),
    },
  };
}

function resolveLabels(item: DynamicResourceItem): Record<string, string> | undefined {
  return item.labels && typeof item.labels === "object" && !Array.isArray(item.labels)
    ? item.labels
    : undefined;
}

export function DynamicConfigResourcePage({
  path,
  tableKey,
  titleKind,
  group = "",
  version,
  resource,
  kind,
  emptyDescription,
  resourceType,
}: DynamicConfigResourcePageProps) {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<DynamicResourceIdentity | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ResourceCreateMode>("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [form] = Form.useForm<CreateConfigPolicyFormValues>();
  const watchedLimitType = Form.useWatch("limitType", form) ?? "Container";
  const { sortBy, sortOrder, pagination, resetPage, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<DynamicResourceItem>({
      defaultPageSize: 10,
    });

  const clustersQuery = useQuery({
    queryKey: [tableKey, "clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );

  const listQuery = useQuery({
    queryKey: [
      tableKey,
      "list",
      clusterId || "all",
      namespace,
      keyword,
      pagination.pageIndex + 1,
      pagination.pageSize,
      sortBy,
      sortOrder,
      accessToken,
    ],
    queryFn: () =>
      getDynamicResources(
        {
          clusterId: clusterId || undefined,
          group,
          version,
          resource,
          namespace: namespace || undefined,
          keyword: keyword || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
          missingAsEmpty: true,
        },
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const refreshDiscoveryMutation = useMutation({
    mutationFn: () => {
      if (!clusterId) {
        throw new Error("请先选择集群后再刷新资源发现");
      }
      return refreshResourceDiscovery(clusterId, accessToken ?? undefined);
    },
    onSuccess: async () => {
      void message.success("资源发现已刷新");
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "刷新资源发现失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => deleteDynamicResource(identity, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success(`${titleKind} 已删除`);
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: CreateConfigPolicyFormValues) => {
      const body =
        resourceType === "limitrange"
          ? buildLimitRangeBody(values)
          : buildResourceQuotaBody(values);
      return createDynamicResource(
        {
          clusterId: values.clusterId.trim(),
          group,
          version,
          resource,
          namespace: values.namespace.trim(),
          name: values.name.trim(),
          body,
        },
        accessToken ?? undefined,
      );
    },
    onSuccess: async () => {
      void message.success(`${titleKind} 创建成功`);
      setCreateOpen(false);
      form.resetFields();
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "创建失败");
    },
  });

  const applyYamlMutation = useMutation({
    mutationFn: () =>
      applyResourceYaml(
        {
          clusterId: createYamlClusterId.trim(),
          namespace: createYamlNamespace.trim() || undefined,
          yaml: createYaml.trim(),
        },
        accessToken ?? undefined,
      ),
    onSuccess: async (result) => {
      void message.success(result.message || `${titleKind} YAML 已应用`);
      setCreateOpen(false);
      setCreateYaml("");
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "YAML 创建失败");
    },
  });

  const rowsRaw = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const knownNamespaces = useMemo(
    () => Array.from(new Set(rowsRaw.map((item) => item.namespace).filter(Boolean))).sort(),
    [rowsRaw],
  );
  const tableData = useMemo(
    () => rowsRaw.filter((item) => matchLabelExpressions(resolveLabels(item), mergedFilters)),
    [mergedFilters, rowsRaw],
  );
  const detailQuery = useQuery({
    queryKey: [tableKey, "details", tableData.map((item) => item.id).join("|"), accessToken],
    queryFn: async () => {
      const details = await Promise.all(
        tableData.map(async (row) => {
          try {
            const detail = await getDynamicResourceDetail(buildIdentity(row), accessToken ?? undefined);
            return [row.id, asRecord(detail.raw)] as const;
          } catch {
            return [row.id, {}] as const;
          }
        }),
      );
      return Object.fromEntries(details) as DynamicRawById;
    },
    enabled: Boolean(accessToken) && tableData.length > 0,
  });
  const rawById = detailQuery.data ?? {};
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
    resetPage();
  };

  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path,
  });

  function buildIdentity(row: DynamicResourceItem): DynamicResourceIdentity {
    return {
      clusterId: row.clusterId,
      group,
      version,
      resource,
      namespace: row.namespace,
      name: row.name,
    };
  }

  function buildDetailTarget(row: DynamicResourceItem): ResourceDetailRequest {
    const identity = buildIdentity(row);
    return {
      kind: "dynamic",
      kindLabel: kind,
      id: [
        "dynamic",
        identity.clusterId,
        identity.group ?? "",
        identity.version ?? "",
        identity.resource ?? "",
        identity.namespace ?? "",
        identity.name ?? "",
      ].join(":"),
      apiVersion: group ? `${group}/${version}` : version,
      namespace: row.namespace,
      name: row.name,
      label: row.name,
    };
  }

  const openCreate = () => {
    form.resetFields();
    const nextClusterId = clusterId || clusterOptions[0]?.value || "";
    form.setFieldsValue({
      clusterId: nextClusterId,
      namespace,
      limitType: "Container",
    });
    setCreateMode("form");
    setCreateYaml("");
    setCreateYamlClusterId(nextClusterId);
    setCreateYamlNamespace(namespace);
    setCreateOpen(true);
  };

  const submitCreate = async () => {
    if (createMode === "yaml") {
      if (!createYamlClusterId.trim()) {
        void message.warning("请选择集群");
        return;
      }
      if (!createYaml.trim()) {
        void message.warning("请输入或上传 YAML");
        return;
      }
      await applyYamlMutation.mutateAsync();
      return;
    }
    let values: CreateConfigPolicyFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    if (resourceType === "resourcequota") {
      const entries = compactEntries([
        ["requests.cpu", values.requestsCpu],
        ["limits.cpu", values.limitsCpu],
        ["requests.memory", values.requestsMemory],
        ["limits.memory", values.limitsMemory],
        ["pods", values.pods],
        ["persistentvolumeclaims", values.persistentVolumeClaims],
        ["requests.storage", values.requestsStorage],
      ]);
      if (entries.length === 0 && parseCustomHardText(values.customHardText).length === 0) {
        void message.warning("至少填写一个配额项");
        return;
      }
    }
    if (resourceType === "limitrange") {
      if (countLimitRangeEntries(values) === 0) {
        void message.warning("至少填写一个限制或默认值");
        return;
      }
      try {
        validateLimitRangeValues(values);
      } catch (error) {
        void message.warning(error instanceof Error ? error.message : "LimitRange 数值不合法");
        return;
      }
    }
    await createMutation.mutateAsync(values);
  };

  const summaryColumns: ColumnsType<DynamicResourceItem> =
    resourceType === "limitrange"
      ? [
          {
            title: "类型",
            key: "limitType",
            width: 130,
            render: (_: unknown, row) => renderValueChip(String(getFirstLimit(rawById[row.id] ?? {}).type ?? "")),
          },
          {
            title: "默认请求",
            key: "defaultRequest",
            width: 190,
            render: (_: unknown, row) =>
              renderPairChips(
                getNestedQuantity(rawById[row.id] ?? {}, "defaultRequest", "cpu"),
                getNestedQuantity(rawById[row.id] ?? {}, "defaultRequest", "memory"),
              ),
          },
          {
            title: "默认限制",
            key: "default",
            width: 190,
            render: (_: unknown, row) =>
              renderPairChips(
                getNestedQuantity(rawById[row.id] ?? {}, "default", "cpu"),
                getNestedQuantity(rawById[row.id] ?? {}, "default", "memory"),
              ),
          },
          {
            title: "最小",
            key: "min",
            width: 170,
            render: (_: unknown, row) =>
              renderPairChips(
                getNestedQuantity(rawById[row.id] ?? {}, "min", "cpu"),
                getNestedQuantity(rawById[row.id] ?? {}, "min", "memory"),
              ),
          },
          {
            title: "最大",
            key: "max",
            width: 170,
            render: (_: unknown, row) =>
              renderPairChips(
                getNestedQuantity(rawById[row.id] ?? {}, "max", "cpu"),
                getNestedQuantity(rawById[row.id] ?? {}, "max", "memory"),
              ),
          },
        ]
      : [
          {
            title: "CPU",
            key: "cpu",
            width: 190,
            render: (_: unknown, row) =>
              renderPairChips(
                formatQuotaUsage(rawById[row.id] ?? {}, "requests.cpu"),
                formatQuotaUsage(rawById[row.id] ?? {}, "limits.cpu"),
              ),
          },
          {
            title: "内存",
            key: "memory",
            width: 210,
            render: (_: unknown, row) =>
              renderPairChips(
                formatQuotaUsage(rawById[row.id] ?? {}, "requests.memory"),
                formatQuotaUsage(rawById[row.id] ?? {}, "limits.memory"),
              ),
          },
          {
            title: "Pods",
            key: "pods",
            width: 120,
            render: (_: unknown, row) => renderValueChip(formatQuotaUsage(rawById[row.id] ?? {}, "pods")),
          },
          {
            title: "PVC",
            key: "pvc",
            width: 120,
            render: (_: unknown, row) => renderValueChip(formatQuotaUsage(rawById[row.id] ?? {}, "persistentvolumeclaims")),
          },
          {
            title: "存储",
            key: "storage",
            width: 140,
            render: (_: unknown, row) => renderValueChip(formatQuotaUsage(rawById[row.id] ?? {}, "requests.storage")),
          },
        ];

  const columns: ColumnsType<DynamicResourceItem> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row) => (
        <Typography.Link onClick={() => setDetailTarget(buildDetailTarget(row))}>{name}</Typography.Link>
      ),
    },
    {
      title: "集群",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, row) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      render: (value: string) => value || "-",
    },
    ...summaryColumns,
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle={`删除 ${titleKind}`}
          deleteContent={`确认删除 ${titleKind}「${row.name}」吗？此操作不可恢复。`}
          onYaml={() => setYamlTarget(buildIdentity(row))}
          onEdit={() => setYamlTarget(buildIdentity(row))}
          onDelete={() => deleteMutation.mutate(buildIdentity(row))}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsSurface className="dynamic-config-list-surface" variant="panel" padding="sm">
        <ResourcePageHeader
          path={path}
          style={{ marginBottom: 12 }}
          titleSuffix={
            <ResourceAddButton
              title={`创建${kind}`}
              onClick={openCreate}
              aria-label={`创建${kind}`}
            />
          }
        />

        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
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
              resetPage();
            }}
          />

          {!isInitializing && !accessToken ? (
            <Alert className="dynamic-config-state-alert" type="warning" showIcon title="未登录或登录初始化中，请稍后重试。" />
          ) : null}
          {listQuery.isError ? (
            <Alert
              className="dynamic-config-state-alert"
              type="error"
              showIcon
              title={`${titleKind} 列表加载失败`}
              description={listQuery.error instanceof Error ? listQuery.error.message : "unknown"}
              action={
                clusterId ? (
                  <Typography.Link onClick={() => refreshDiscoveryMutation.mutate()}>
                    刷新资源发现
                  </Typography.Link>
                ) : undefined
              }
            />
          ) : null}

          <ResourceTable<DynamicResourceItem>
            bordered
            rowKey="id"
            columns={columns}
            onResourceNavigate={(request) => setDetailTarget(request)}
            tableKey={tableKey}
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
            globalSearch={{
              value: keywordInput,
              onChange: handleGlobalSearchChange,
              placeholder: "输入关键字，或 label 过滤（如 env=prod team=platform）",
            }}
            filters={tableFilters}
            onFiltersChange={(nextFilters) => {
              setTableFilters(nextFilters);
              resetPage();
            }}
            sort={{ sortBy, sortOrder }}
            dataSource={tableData}
            layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 } }}
            loading={listQuery.isLoading}
            onChange={(nextPagination, filters, sorter, extra) =>
              handleTableChange(nextPagination, filters, sorter, extra, listQuery.isLoading && !listQuery.data)
            }
            pagination={getPaginationConfig(listQuery.data?.total ?? 0, listQuery.isLoading && !listQuery.data)}
            emptyDescription={emptyDescription}
          />
        </Space>
      </OpsSurface>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        onNavigateRequest={(request) => setDetailTarget(request)}
        token={accessToken ?? undefined}
      />

      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        onClose={() => setYamlTarget(null)}
        identity={null}
        dynamicIdentity={yamlTarget}
        token={accessToken ?? undefined}
        onUpdated={() => void listQuery.refetch()}
      />

      <OpsModalShell
        title={`创建 ${kind}`}
        description={
          resourceType === "limitrange"
            ? "为命名空间设置容器、Pod 或 PVC 的默认请求、默认限制和边界。"
            : "为命名空间设置 CPU、内存、Pod、PVC 与存储等资源配额。"
        }
        identity={kind}
        open={createOpen}
        onCancel={() => setCreateOpen(false)}
        onOk={() => void submitCreate()}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending || applyYamlMutation.isPending}
        destroyOnHidden
        width={760}
      >
        <ResourceCreateMethodTabs
          mode={createMode}
          onModeChange={setCreateMode}
          yaml={createYaml}
          onYamlChange={setCreateYaml}
          clusterId={createYamlClusterId}
          onClusterIdChange={setCreateYamlClusterId}
          namespace={createYamlNamespace}
          onNamespaceChange={setCreateYamlNamespace}
          clusterOptions={clusterOptions}
          clusterLoading={clustersQuery.isLoading}
          clusterUnavailable={clusterUnavailable}
          kindHint={kind}
          disabled={createMutation.isPending || applyYamlMutation.isPending}
          formContent={(
            <Form className="dynamic-config-create-form" form={form} layout="vertical">
              <OpsFormSection title="作用范围" description="资源创建到指定集群和名称空间。">
                <Row gutter={12}>
                  <Col xs={24} md={12}>
                    <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
                      <Select
                        showSearch
                        optionFilterProp="label"
                        options={clusterOptions}
                        placeholder={clusterUnavailable ? "集群状态不可用" : "选择集群"}
                        disabled={clusterUnavailable || (!clustersQuery.isLoading && clusterOptions.length === 0)}
                        loading={clustersQuery.isLoading}
                        notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name="namespace"
                      label="名称空间"
                      rules={[
                        { required: true, message: "请输入名称空间" },
                        { pattern: DNS_LABEL_RULE, message: "名称空间需符合 DNS-1123 label" },
                      ]}
                    >
                      <Input placeholder="default" />
                    </Form.Item>
                  </Col>
                </Row>
                <Form.Item
                  name="name"
                  label="资源名称"
                  rules={[
                    { required: true, message: "请输入资源名称" },
                    { pattern: DNS_LABEL_RULE, message: "资源名称需符合 DNS-1123 label" },
                  ]}
                >
                  <Input placeholder={resourceType === "limitrange" ? "default-limits" : "namespace-quota"} />
                </Form.Item>
              </OpsFormSection>

              {resourceType === "limitrange" ? (
                <OpsFormSection title="限制策略" description="空字段不会写入 YAML，至少填写一个默认值或边界。">
                  <Form.Item name="limitType" label="限制对象" rules={[{ required: true, message: "请选择限制对象" }]}>
                    <Select
                      options={[
                        { label: "Container", value: "Container" },
                        { label: "Pod", value: "Pod" },
                        { label: "PersistentVolumeClaim", value: "PersistentVolumeClaim" },
                      ]}
                    />
                  </Form.Item>
                  {watchedLimitType === "PersistentVolumeClaim" ? (
                    <Row gutter={12}>
                      <Col xs={24} md={12}>
                        <Form.Item name="minStorage" label="最小存储">
                          <Input placeholder="1Gi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="maxStorage" label="最大存储">
                          <Input placeholder="100Gi" />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : (
                    <Row gutter={12}>
                      {watchedLimitType === "Container" ? (
                        <>
                          <Col xs={24} md={12}>
                            <Form.Item name="defaultRequestCpu" label="默认请求 CPU">
                              <Input placeholder="100m" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="defaultRequestMemory" label="默认请求内存">
                              <Input placeholder="128Mi" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="defaultCpu" label="默认限制 CPU">
                              <Input placeholder="500m" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={12}>
                            <Form.Item name="defaultMemory" label="默认限制内存">
                              <Input placeholder="512Mi" />
                            </Form.Item>
                          </Col>
                        </>
                      ) : null}
                      <Col xs={24} md={12}>
                        <Form.Item name="minCpu" label="最小 CPU">
                          <Input placeholder="50m" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="minMemory" label="最小内存">
                          <Input placeholder="64Mi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="maxCpu" label="最大 CPU">
                          <Input placeholder="2" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="maxMemory" label="最大内存">
                          <Input placeholder="2Gi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="maxLimitRequestRatioCpu" label="CPU 限制/请求最大比">
                          <Input placeholder="10" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item name="maxLimitRequestRatioMemory" label="内存限制/请求最大比">
                          <Input placeholder="4" />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}
                </OpsFormSection>
              ) : (
                <OpsFormSection title="配额硬限制" description="显示为 used / hard；新建时写入 spec.hard。">
                  <Row gutter={12}>
                    <Col xs={24} md={12}>
                      <Form.Item name="requestsCpu" label="CPU 请求总量">
                        <Input placeholder="2" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="limitsCpu" label="CPU 限制总量">
                        <Input placeholder="4" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="requestsMemory" label="内存请求总量">
                        <Input placeholder="4Gi" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={12}>
                      <Form.Item name="limitsMemory" label="内存限制总量">
                        <Input placeholder="8Gi" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="pods" label="Pod 数量">
                        <Input placeholder="50" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="persistentVolumeClaims" label="PVC 数量">
                        <Input placeholder="20" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name="requestsStorage" label="存储请求总量">
                        <Input placeholder="100Gi" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item name="customHardText" label="自定义配额项">
                    <Input.TextArea
                      rows={3}
                      placeholder={"services.loadbalancers=2\ncount/jobs.batch=10"}
                    />
                  </Form.Item>
                </OpsFormSection>
              )}
            </Form>
          )}
        />
      </OpsModalShell>
    </Space>
  );
}
