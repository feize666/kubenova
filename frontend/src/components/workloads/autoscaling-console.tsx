"use client";

import { DeleteOutlined, EyeOutlined, FileTextOutlined, MinusCircleOutlined, UploadOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Col,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Statistic,
  Tabs,
  Typography,
  Upload,
} from "antd";
import type { UploadProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ResourceFilterToolbar, ResourceFilterToolbarItem } from "@/components/resource-filter-toolbar";
import { ResourceFacetFilterButton } from "@/components/resource-facet-filter-button";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { useAuth } from "@/components/auth-context";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import {
  createAutoscalingPolicy,
  deleteAutoscalingPolicy,
  getAutoscalingEvents,
  listAutoscalingPolicies,
  updateAutoscalingPolicy,
  type AutoscalingEventItem,
  type AutoscalingPolicyItem,
  type AutoscalingType,
  type HpaPolicyConfig,
  type VpaPolicyConfig,
} from "@/lib/api/autoscaling";
import { applyResourceYaml } from "@/lib/api/resources";
import { ApiError } from "@/lib/api/client";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import type { HpaMetricSpec, HpaMetricTargetType } from "@/lib/contracts";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { useAntdTableSortPagination } from "@/lib/table";
import { getTableScrollX } from "@/lib/table-column-widths";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";
import {
  buildResourceActionMenuItems,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  parseResourceSearchInput,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
  type ResourceMenuItem,
} from "@/components/resource-action-bar";
import { OpsFilterChip } from "@/components/ops/ops-filter-chip";
import { openOpsConfirm } from "@/components/ops/ops-confirm-modal";
import { OpsFormSection, OpsModalShell } from "@/components/ops/ops-modal-shell";
import { OpsSurface } from "@/components/ops/ops-surface";
import { OpsStatusTag } from "@/components/ops/ops-status";

type AutoscalingConsoleProps = {
  defaultType?: AutoscalingType;
};

type PolicyFormValues = {
  type: AutoscalingType;
  clusterId: string;
  namespace: string;
  kind: string;
  name: string;
  hpaMinReplicas?: number;
  hpaMaxReplicas?: number;
  hpaTargetCpu?: number;
  hpaTargetMemory?: number;
  hpaMetrics?: HpaMetricFormItem[];
  hpaBehavior?: HpaBehaviorFormItem;
  hpaBehaviorJson?: string;
  vpaUpdateMode?: "Off" | "Initial" | "Auto";
  vpaMinCpu?: string;
  vpaMaxCpu?: string;
  vpaMinMemory?: string;
  vpaMaxMemory?: string;
  vpaControlledResources?: string[];
};

type HpaMetricFormItem = {
  sourceType: HpaMetricSpec["sourceType"];
  name?: string;
  targetType?: HpaMetricTargetType;
  targetValue?: string;
  selector?: string;
};

type HpaBehaviorPolicyFormItem = {
  type?: "Pods" | "Percent";
  value?: number;
  periodSeconds?: number;
};

type HpaBehaviorRuleFormItem = {
  stabilizationWindowSeconds?: number;
  selectPolicy?: "Max" | "Min" | "Disabled";
  policies?: HpaBehaviorPolicyFormItem[];
};

type HpaBehaviorFormItem = {
  scaleUp?: HpaBehaviorRuleFormItem;
  scaleDown?: HpaBehaviorRuleFormItem;
};

const kindOptions = [
  { label: "Deployment", value: "Deployment" },
  { label: "StatefulSet", value: "StatefulSet" },
  { label: "DaemonSet", value: "DaemonSet" },
  { label: "ReplicaSet", value: "ReplicaSet" },
  { label: "Job", value: "Job" },
  { label: "CronJob", value: "CronJob" },
  { label: "Pod", value: "Pod" },
];

function isHpaConfig(config: HpaPolicyConfig | VpaPolicyConfig): config is HpaPolicyConfig {
  return "minReplicas" in config;
}

function formatConfig(item: AutoscalingPolicyItem): string {
  if (isHpaConfig(item.config)) {
    const cpu = item.config.targetCpuUtilizationPercentage ? ` CPU:${item.config.targetCpuUtilizationPercentage}%` : "";
    const mem = item.config.targetMemoryUtilizationPercentage ? ` MEM:${item.config.targetMemoryUtilizationPercentage}%` : "";
    const metricCount = item.config.metrics?.length ?? 0;
    const behaviorRules = `${item.config.behavior?.scaleUp?.policies?.length ?? 0}/${item.config.behavior?.scaleDown?.policies?.length ?? 0}`;
    return `min=${item.config.minReplicas}, max=${item.config.maxReplicas}${cpu}${mem} · metrics=${metricCount} · behavior(up/down)=${behaviorRules}`;
  }
  const resources = item.config.controlledResources?.join(",") || "cpu,memory";
  return `mode=${item.config.updateMode}, resources=${resources}`;
}

function getAutoscalingResourceName(item: AutoscalingPolicyItem): string {
  return (item.resourceName || item.workloadName || "").trim();
}

function parseJsonValue<T>(value: string | undefined, field: string): T | undefined {
  const text = value?.trim();
  if (!text) return undefined;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`${field} JSON 格式不合法`);
  }
}

function formatSelectorText(selector?: Record<string, string>): string | undefined {
  if (!selector || Object.keys(selector).length === 0) return undefined;
  return Object.entries(selector)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
}

function parseSelectorText(value: string | undefined): Record<string, string> | undefined {
  const text = value?.trim();
  if (!text) return undefined;

  const pairs = text
    .split(/\n|,/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (pairs.length === 0) return undefined;

  const selector: Record<string, string> = {};
  for (const pair of pairs) {
    const index = pair.indexOf("=");
    if (index <= 0 || index === pair.length - 1) {
      throw new Error("selector 格式不合法，请使用 key=value（支持逗号或换行分隔）");
    }
    const key = pair.slice(0, index).trim();
    const val = pair.slice(index + 1).trim();
    if (!key || !val) {
      throw new Error("selector 格式不合法，请使用 key=value（支持逗号或换行分隔）");
    }
    selector[key] = val;
  }

  return Object.keys(selector).length > 0 ? selector : undefined;
}

function metricToFormItem(metric: HpaMetricSpec): HpaMetricFormItem {
  if (metric.sourceType === "Resource") {
    return {
      sourceType: "Resource",
      name: metric.name,
      targetType: metric.targetType,
      targetValue: metric.targetValue,
    };
  }

  return {
    sourceType: metric.sourceType,
    name: metric.metricName,
    targetType: metric.targetType,
    targetValue: metric.targetValue,
    selector: formatSelectorText(metric.selector),
  };
}

function buildHpaMetrics(metrics: HpaMetricFormItem[] | undefined): HpaPolicyConfig["metrics"] {
  if (!metrics || metrics.length === 0) return undefined;
  const normalized: HpaMetricSpec[] = [];
  metrics.forEach((item, index) => {
    const targetType = item.targetType;
    const targetValue = item.targetValue?.trim();
    if (!targetType || !targetValue) {
      throw new Error(`第 ${index + 1} 条指标缺少 targetType 或 targetValue`);
    }
    if (item.sourceType === "Resource") {
      const name = item.name?.trim();
      if (!name) {
        throw new Error(`第 ${index + 1} 条 Resource 指标缺少资源名称`);
      }
      normalized.push({
        sourceType: "Resource",
        name,
        targetType,
        targetValue,
      });
      return;
    }
    const metricName = item.name?.trim();
    if (!metricName) {
      throw new Error(`第 ${index + 1} 条指标缺少 metricName`);
    }
    if (targetType === "Utilization") {
      throw new Error(`第 ${index + 1} 条指标来源为 ${item.sourceType} 时不支持 Utilization`);
    }
    const selector = parseSelectorText(item.selector);
    if (item.sourceType === "Pods") {
      normalized.push({
        sourceType: "Pods",
        metricName,
        targetType,
        targetValue,
        selector,
      });
      return;
    }
    normalized.push({
      sourceType: "External",
      metricName,
      targetType,
      targetValue,
      selector,
    });
  });
  return normalized.length > 0 ? normalized : undefined;
}

function behaviorToFormValue(behavior: HpaPolicyConfig["behavior"] | undefined): HpaBehaviorFormItem | undefined {
  if (!behavior) return undefined;
  const toRule = (rule: NonNullable<HpaPolicyConfig["behavior"]>["scaleUp"]): HpaBehaviorRuleFormItem => ({
    stabilizationWindowSeconds: rule?.stabilizationWindowSeconds,
    selectPolicy: rule?.selectPolicy,
    policies: rule?.policies?.map((item) => ({
      type: item.type,
      value: item.value,
      periodSeconds: item.periodSeconds,
    })),
  });
  return {
    scaleUp: toRule(behavior.scaleUp),
    scaleDown: toRule(behavior.scaleDown),
  };
}

function buildHpaBehavior(value: HpaBehaviorFormItem | undefined): HpaPolicyConfig["behavior"] {
  if (!value) return undefined;
  const parseRule = (rule: HpaBehaviorRuleFormItem | undefined, path: "scaleUp" | "scaleDown") => {
    if (!rule) return undefined;
    const policies = (rule.policies ?? []).map((item, index) => {
      if (!item.type) {
        throw new Error(`behavior.${path}.policies[${index}].type 不能为空`);
      }
      if (!item.value || item.value <= 0) {
        throw new Error(`behavior.${path}.policies[${index}].value 必须大于 0`);
      }
      if (!item.periodSeconds || item.periodSeconds <= 0) {
        throw new Error(`behavior.${path}.policies[${index}].periodSeconds 必须大于 0`);
      }
      return {
        type: item.type,
        value: item.value,
        periodSeconds: item.periodSeconds,
      };
    });
    const built = {
      ...(rule.stabilizationWindowSeconds !== undefined
        ? { stabilizationWindowSeconds: rule.stabilizationWindowSeconds }
        : {}),
      ...(rule.selectPolicy ? { selectPolicy: rule.selectPolicy } : {}),
      ...(policies.length > 0 ? { policies } : {}),
    };
    return Object.keys(built).length > 0 ? built : undefined;
  };
  const scaleUp = parseRule(value.scaleUp, "scaleUp");
  const scaleDown = parseRule(value.scaleDown, "scaleDown");
  if (!scaleUp && !scaleDown) return undefined;
  return {
    ...(scaleUp ? { scaleUp } : {}),
    ...(scaleDown ? { scaleDown } : {}),
  };
}

export function AutoscalingConsole({ defaultType }: AutoscalingConsoleProps) {
  const { message } = App.useApp();
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const queryEnabled = !isInitializing && Boolean(accessToken);
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [kind, setKind] = useState("");
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [typeFilter, setTypeFilter] = useState<AutoscalingType | "">(defaultType ?? "");
  const { sortBy, sortOrder, pagination, resetPage, getSortableColumnProps, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<AutoscalingPolicyItem>({
      defaultPageSize: 10,
      allowedSortBy: ["workloadName", "namespace", "clusterId", "updatedAt"],
    });
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<AutoscalingPolicyItem | null>(null);
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState<{ kind: string; id: string } | null>(null);
  const [yamlTarget, setYamlTarget] = useState<AutoscalingPolicyItem | null>(null);
  const [createMode, setCreateMode] = useState<"form" | "yaml">("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [yamlSubmitting, setYamlSubmitting] = useState(false);
  const pageDescription =
    defaultType === "HPA"
      ? "聚焦管理 HPA 资源与事件。"
      : defaultType === "VPA"
        ? "聚焦管理 VPA 资源与事件。"
        : "统一管理 HPA/VPA 资源与事件。";
  const effectiveTypeFilter = defaultType ?? typeFilter;
  const policiesQueryKey = [
    "autoscaling",
    {
      clusterId,
      namespace,
      kind,
      keyword,
      type: effectiveTypeFilter,
      page: pagination.pageIndex + 1,
      pageSize: pagination.pageSize,
      sortBy,
      sortOrder,
    },
    accessToken,
  ] as const;

  const [form] = Form.useForm<PolicyFormValues>();
  const formType =
    (Form.useWatch("type", form) as AutoscalingType | undefined) ??
    editing?.type ??
    defaultType ??
    "HPA";

  const clustersQuery = useQuery({
    queryKey: ["clusters", "autoscaling", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true }, accessToken),
    enabled: queryEnabled,
  });

  const policiesQuery = useQuery({
    queryKey: policiesQueryKey,
    queryFn: () =>
      listAutoscalingPolicies({
        clusterId: clusterId || undefined,
        namespace: namespace.trim() || undefined,
        kind: kind || undefined,
        keyword: keyword.trim() || undefined,
        type: effectiveTypeFilter || undefined,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy: sortBy || undefined,
        sortOrder: sortOrder || undefined,
      }, accessToken),
    enabled: queryEnabled,
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });
  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);
  const yamlUploadProps: UploadProps = {
    accept: ".yaml,.yml,text/yaml,text/x-yaml,application/x-yaml",
    maxCount: 1,
    showUploadList: false,
    beforeUpload: async (file) => {
      try {
        setCreateYaml(await file.text());
        message.success(`已读取 ${file.name}`);
      } catch {
        message.error("YAML 文件读取失败");
      }
      return false;
    },
  };
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const visiblePolicies = useMemo(
    () => policiesQuery.data?.items ?? [],
    [policiesQuery.data?.items],
  );
  const selectedItem = useMemo(
    () => visiblePolicies.find((item) => item.id === selectedRowId) ?? null,
    [selectedRowId, visiblePolicies],
  );
  const policiesEmptyText =
    clusterId || namespace.trim() || kind || keyword.trim() || effectiveTypeFilter
      ? "当前筛选条件下暂无策略"
      : "全部集群下暂无策略";
  const eventsEmptyText = selectedItem
    ? "最近 24 小时暂无事件"
    : "选择一条策略后查看最近 24 小时事件";

  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set((policiesQuery.data?.items ?? []).map((item) => item.namespace).filter(Boolean)),
      ),
    [policiesQuery.data],
  );

  useSyncResourceFilterUrlState({ clusterId, namespace, keyword });

  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setKeyword(parsed.keyword);
  };

  const eventsQuery = useQuery({
    queryKey: [
      "autoscaling-events",
      selectedItem?.clusterId,
      selectedItem?.namespace,
      selectedItem ? getAutoscalingResourceName(selectedItem) : undefined,
      accessToken,
    ],
    queryFn: () =>
      getAutoscalingEvents(
        {
          clusterId: selectedItem!.clusterId,
          namespace: selectedItem!.namespace,
          kind: selectedItem!.workloadKind,
          name: getAutoscalingResourceName(selectedItem!),
          hours: 24,
        },
        accessToken,
      ),
    enabled: queryEnabled && Boolean(selectedItem),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const openCreatePolicyModal = () => {
    setEditing(null);
    setSelectedRowId(null);
    setModalOpen(true);
    form.resetFields();
    const defaultClusterId = clusterId || clusterOptions[0]?.value || "";
    const defaultNamespace = namespace || "default";
    setCreateMode("form");
    setCreateYaml("");
    setCreateYamlClusterId(defaultClusterId);
    setCreateYamlNamespace(defaultNamespace);
    form.setFieldsValue({
      type: defaultType ?? "HPA",
      clusterId: defaultClusterId,
      namespace: defaultNamespace,
      kind: "Deployment",
      hpaMinReplicas: 1,
      hpaMaxReplicas: 3,
      hpaMetrics: [],
      hpaBehavior: {
        scaleUp: { policies: [] },
        scaleDown: { policies: [] },
      },
      vpaUpdateMode: "Auto",
    });
  };

  const openEditPolicyModal = (row: AutoscalingPolicyItem) => {
    setEditing(row);
    setModalOpen(true);
    if (row.type === "HPA" && isHpaConfig(row.config)) {
      form.setFieldsValue({
        type: row.type,
        clusterId: row.clusterId,
        namespace: row.namespace,
        kind: row.workloadKind,
        name: getAutoscalingResourceName(row),
        hpaMinReplicas: row.config.minReplicas,
        hpaMaxReplicas: row.config.maxReplicas,
        hpaTargetCpu: row.config.targetCpuUtilizationPercentage,
        hpaTargetMemory: row.config.targetMemoryUtilizationPercentage,
        hpaMetrics: row.config.metrics?.map(metricToFormItem) ?? [],
        hpaBehavior: behaviorToFormValue(row.config.behavior),
        hpaBehaviorJson: row.config.behavior ? JSON.stringify(row.config.behavior, null, 2) : undefined,
      });
      return;
    }
    if (row.type === "VPA" && !isHpaConfig(row.config)) {
      form.setFieldsValue({
        type: row.type,
        clusterId: row.clusterId,
        namespace: row.namespace,
        kind: row.workloadKind,
        name: getAutoscalingResourceName(row),
        vpaUpdateMode: row.config.updateMode,
        vpaMinCpu: row.config.minAllowedCpu,
        vpaMaxCpu: row.config.maxAllowedCpu,
        vpaMinMemory: row.config.minAllowedMemory,
        vpaMaxMemory: row.config.maxAllowedMemory,
        vpaControlledResources: row.config.controlledResources,
      });
    }
  };

  const createMutation = useMutation({
    mutationFn: (values: PolicyFormValues) => {
      if (values.type === "HPA") {
        const metrics = buildHpaMetrics(values.hpaMetrics);
        const behaviorJson = parseJsonValue<HpaPolicyConfig["behavior"]>(values.hpaBehaviorJson, "behavior");
        const behavior = behaviorJson ?? buildHpaBehavior(values.hpaBehavior);
        return createAutoscalingPolicy(
          {
            type: "HPA",
            clusterId: values.clusterId,
            namespace: values.namespace,
            kind: values.kind,
            name: values.name,
            hpa: {
              minReplicas: values.hpaMinReplicas ?? 1,
              maxReplicas: values.hpaMaxReplicas ?? 3,
              targetCpuUtilizationPercentage: values.hpaTargetCpu,
              targetMemoryUtilizationPercentage: values.hpaTargetMemory,
              metrics,
              behavior,
            },
          },
          accessToken,
        );
      }
      return createAutoscalingPolicy(
        {
          type: "VPA",
          clusterId: values.clusterId,
          namespace: values.namespace,
          kind: values.kind,
          name: values.name,
          vpa: {
            updateMode: values.vpaUpdateMode ?? "Auto",
            minAllowedCpu: values.vpaMinCpu,
            maxAllowedCpu: values.vpaMaxCpu,
            minAllowedMemory: values.vpaMinMemory,
            maxAllowedMemory: values.vpaMaxMemory,
            controlledResources: values.vpaControlledResources,
          },
        },
        accessToken,
      );
    },
    onSuccess: async (created) => {
      message.success("策略创建成功");
      setModalOpen(false);
      form.resetFields();
      setSelectedRowId(created.id);
      queryClient.setQueryData(
        policiesQueryKey,
        (current: { items?: AutoscalingPolicyItem[]; total?: number } | undefined) => {
          if (!current?.items) {
            return {
              items: [created],
              total: 1,
            };
          }
          const nextItems = [created, ...current.items.filter((item) => item.id !== created.id)];
          return {
            ...current,
            items: nextItems,
            total: typeof current.total === "number" ? current.total + 1 : nextItems.length,
          };
        },
      );
      await queryClient.invalidateQueries({ queryKey: policiesQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["inspection", "autoscaling-hints"] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 409) {
        message.error("策略已存在，请直接编辑现有策略");
        return;
      }
      message.error(error instanceof Error ? error.message : "创建失败");
    },
  });

  const updateMutation = useMutation({
    mutationFn: (values: PolicyFormValues) => {
      if (!editing) throw new Error("缺少编辑对象");
      if (editing.type === "HPA") {
        const metrics = buildHpaMetrics(values.hpaMetrics);
        const behaviorJson = parseJsonValue<HpaPolicyConfig["behavior"]>(values.hpaBehaviorJson, "behavior");
        const behavior = behaviorJson ?? buildHpaBehavior(values.hpaBehavior);
        return updateAutoscalingPolicy(
          "HPA",
          {
            clusterId: editing.clusterId,
            namespace: editing.namespace,
            kind: editing.workloadKind,
            name: getAutoscalingResourceName(editing),
          },
          {
            hpa: {
              minReplicas: values.hpaMinReplicas,
              maxReplicas: values.hpaMaxReplicas,
              targetCpuUtilizationPercentage: values.hpaTargetCpu,
              targetMemoryUtilizationPercentage: values.hpaTargetMemory,
              metrics,
              behavior,
            },
          },
          accessToken,
        );
      }
      return updateAutoscalingPolicy(
        "VPA",
        {
          clusterId: editing.clusterId,
          namespace: editing.namespace,
          kind: editing.workloadKind,
          name: getAutoscalingResourceName(editing),
        },
        {
          vpa: {
            updateMode: values.vpaUpdateMode,
            minAllowedCpu: values.vpaMinCpu,
            maxAllowedCpu: values.vpaMaxCpu,
            minAllowedMemory: values.vpaMinMemory,
            maxAllowedMemory: values.vpaMaxMemory,
            controlledResources: values.vpaControlledResources,
          },
        },
        accessToken,
      );
    },
    onSuccess: async () => {
      message.success("策略更新成功");
      setModalOpen(false);
      setEditing(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: policiesQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["inspection", "autoscaling-hints"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "更新失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (item: AutoscalingPolicyItem) =>
      deleteAutoscalingPolicy(
        item.type,
          {
            clusterId: item.clusterId,
            namespace: item.namespace,
            kind: item.workloadKind,
            name: getAutoscalingResourceName(item),
          },
        accessToken,
      ),
    onSuccess: async (_, item) => {
      message.success(`${item.type} 策略删除成功`);
      if (selectedRowId === item.id) {
        setSelectedRowId(null);
        setYamlTarget(null);
      }
      await queryClient.invalidateQueries({ queryKey: policiesQueryKey });
      await queryClient.invalidateQueries({ queryKey: ["inspection", "autoscaling-hints"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const handleOpenYamlForPolicy = (row: AutoscalingPolicyItem) => {
    setYamlTarget(row);
  };

  const openPolicyDetail = (row: AutoscalingPolicyItem) => {
    setDetailRequest({
      kind: row.type === "HPA" ? "HorizontalPodAutoscaler" : "VerticalPodAutoscaler",
      id: `${row.clusterId}/${row.namespace}/${getAutoscalingResourceName(row)}`,
    });
  };

  const columns: ColumnsType<AutoscalingPolicyItem> = [
    {
      title: "策略类型",
      dataIndex: "type",
      key: "type",
      width: 110,
      render: (value: AutoscalingType) => (
        <OpsFilterChip tone={value === "HPA" ? "info" : "neutral"}>{value}</OpsFilterChip>
      ),
    },
    {
      title: "工作负载",
      key: "workload",
      width: 220,
      render: (_, row) => (
        <Space orientation="vertical" size={0}>
          <Typography.Link code onClick={() => openPolicyDetail(row)}>
            {getAutoscalingResourceName(row)}
          </Typography.Link>
        </Space>
      ),
      ...getSortableColumnProps("workloadName", policiesQuery.isLoading && !policiesQuery.data),
    },
    {
      title: "集群",
      dataIndex: "clusterId",
      key: "clusterId",
      width: 160,
      align: "center",
      ellipsis: true,
      render: (value: string) => getClusterDisplayName(clusterMap, value),
      ...getSortableColumnProps("clusterId", policiesQuery.isLoading && !policiesQuery.data),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: 160,
      align: "center",
      ...getSortableColumnProps("namespace", policiesQuery.isLoading && !policiesQuery.data),
    },
    {
      title: "配置",
      key: "config",
      ellipsis: true,
      render: (_, row) => formatConfig(row),
    },
    {
      title: "副本",
      key: "replica",
      width: 120,
      render: (_, row) => {
        if (row.replicas === null) return "-";
        return `${row.readyReplicas ?? 0}/${row.replicas}`;
      },
    },
    {
      title: "状态",
      key: "state",
      width: 120,
      render: (_, row) => (
        <OpsStatusTag tone={row.state === "enabled" ? "success" : "neutral"}>
          {row.state === "enabled" ? "启用" : "停用"}
        </OpsStatusTag>
      ),
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 190,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
      ...getSortableColumnProps("updatedAt", policiesQuery.isLoading && !policiesQuery.data),
    },
    {
      title: "操作",
      key: "actions",
      width: 130,
      fixed: "right",
      render: (_, row) => {
        const actions: ResourceMenuItem[] = [
          { key: "detail", icon: <EyeOutlined />, label: "详情" },
          { key: "edit", label: "编辑" },
          { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
          { type: "divider" },
          { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
        ];
        const items = buildResourceActionMenuItems(actions);
        return (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === "detail") {
                  openPolicyDetail(row);
                  return;
                }
                if (key === "edit") {
                  openEditPolicyModal(row);
                  return;
                }
                if (key === "yaml") {
                  handleOpenYamlForPolicy(row);
                  return;
                }
                if (key === "delete") {
                  openOpsConfirm({
                    title: `删除 ${row.type} 策略`,
                    description: `确认删除 ${getAutoscalingResourceName(row)} 的 ${row.type} 策略？`,
                    impact: "删除后该伸缩策略不再调节目标工作负载。",
                    okText: "删除",
                    danger: true,
                    cancelText: "取消",
                    onOk: async () => {
                      await deleteMutation.mutateAsync(row);
                    },
                  });
                  return;
                }
              },
            }}
            classNames={{ root: POD_ACTION_MENU_CLASS }}
          >
            {renderResourceActionTriggerButton({
              ariaLabel: "更多操作",
              baseClassName: POD_ACTION_TRIGGER_CLASS,
            })}
          </Dropdown>
        );
      },
    },
  ];

  const eventColumns: ColumnsType<AutoscalingEventItem> = [
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      width: 190,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: "类型",
      dataIndex: "type",
      key: "type",
      width: 100,
      render: (value: string) => (
        <OpsStatusTag tone={value === "Warning" ? "danger" : "neutral"}>{value || "-"}</OpsStatusTag>
      ),
    },
    { title: "原因", dataIndex: "reason", key: "reason", width: 180 },
    { title: "消息", dataIndex: "message", key: "message" },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path={defaultType === "VPA" ? "/workloads/autoscaling/vpa" : "/workloads/autoscaling/hpa"}
        titleSuffix={<ResourceAddButton onClick={openCreatePolicyModal} aria-label="创建伸缩策略" />}
        description={pageDescription}
      />

      <OpsSurface variant="toolbar" padding="sm">
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
                resetPage();
              }}
            />
          </ResourceFilterToolbarItem>
          <ResourceFilterToolbarItem width="sm">
            <ResourceFacetFilterButton
              label="类型"
              value={kind}
              allLabel="全部类型"
              options={[{ label: "全部类型", value: "" }, ...kindOptions]}
              onChange={(value) => {
                setKind(value);
                resetPage();
              }}
            />
          </ResourceFilterToolbarItem>
          {!defaultType ? (
            <ResourceFilterToolbarItem width="sm">
              <ResourceFacetFilterButton
                label="策略"
                value={typeFilter}
                allLabel="全部策略"
                options={[
                  { label: "全部策略", value: "" },
                  { label: "HPA", value: "HPA" },
                  { label: "VPA", value: "VPA" },
                ]}
                onChange={(value) => {
                  setTypeFilter(value as AutoscalingType | "");
                  resetPage();
                }}
              />
            </ResourceFilterToolbarItem>
          ) : null}
        </ResourceFilterToolbar>
        
      </OpsSurface>

      <Row gutter={[12, 12]}>
        <Col xs={12} md={6}>
          <OpsSurface variant="raised" padding="sm">
            <Statistic title="策略总数" value={policiesQuery.data?.overview.totalPolicies ?? 0} />
          </OpsSurface>
        </Col>
        <Col xs={12} md={6}>
          <OpsSurface variant="raised" padding="sm">
            <Statistic title="HPA / VPA" value={`${policiesQuery.data?.overview.hpaPolicies ?? 0} / ${policiesQuery.data?.overview.vpaPolicies ?? 0}`} />
          </OpsSurface>
        </Col>
        <Col xs={12} md={6}>
          <OpsSurface variant="raised" padding="sm">
            <Statistic
              title="未覆盖资源"
              value={policiesQuery.data?.overview.uncoveredWorkloads ?? 0}
              styles={{
                content: {
                  color:
                    (policiesQuery.data?.overview.uncoveredWorkloads ?? 0) > 0
                      ? "#fa8c16"
                      : undefined,
                },
              }}
            />
          </OpsSurface>
        </Col>
        <Col xs={12} md={6}>
          <OpsSurface variant="raised" padding="sm">
            <Statistic title="资源总数" value={policiesQuery.data?.overview.coveredWorkloads ?? 0} />
          </OpsSurface>
        </Col>
      </Row>

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<AutoscalingPolicyItem>
          tableKey="workloads.autoscaling.policies"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按资源名称搜索",
          }}
          sort={{ sortBy, sortOrder }}
          rowKey="id"
          columns={columns}
          onResourceNavigate={(request) => setDetailRequest(request)}
          dataSource={visiblePolicies}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, queryEnabled && !policiesQuery.data && policiesQuery.isLoading)
          }
          onRow={(record) => ({
            onClick: () => setSelectedRowId(record.id),
          })}
          loading={queryEnabled && !policiesQuery.data && policiesQuery.isLoading}
          pagination={getPaginationConfig(
            policiesQuery.data?.total ?? policiesQuery.data?.items?.length ?? 0,
            queryEnabled && !policiesQuery.data && policiesQuery.isLoading,
          )}
          locale={{ emptyText: policiesEmptyText }}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </OpsSurface>

      <OpsSurface variant="panel" padding="sm" title="选中资源摘要">
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          {selectedItem ? (
            <>
              <Typography.Text>
                资源：<Typography.Text strong>{getAutoscalingResourceName(selectedItem)}</Typography.Text>
              </Typography.Text>
              <Typography.Text type="secondary">
                集群：{getClusterDisplayName(clusterMap, selectedItem.clusterId)} · 名称空间：{selectedItem.namespace}
              </Typography.Text>
              <Typography.Text type="secondary">
                类型：{selectedItem.type} · 状态：{selectedItem.state === "enabled" ? "启用" : "停用"}
              </Typography.Text>
            </>
          ) : (
            <Typography.Text type="secondary">选择一条策略后显示资源摘要与最近 24 小时事件。</Typography.Text>
          )}
        </Space>
      </OpsSurface>

      <OpsSurface variant="panel" padding="sm">
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Title level={5} style={{ margin: 0 }}>
            策略事件（最近 24 小时）
          </Typography.Title>
          <Typography.Text type="secondary">
            {selectedItem
              ? `${getAutoscalingResourceName(selectedItem)} · ${getClusterDisplayName(clusterMap, selectedItem.clusterId)}/${selectedItem.namespace}`
              : ""}
          </Typography.Text>
          <ResourceTable<AutoscalingEventItem>
            rowKey={(item) => `${item.timestamp}-${item.reason}`}
            tableKey="workloads.autoscaling.events"
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
            columns={eventColumns}
            onResourceNavigate={(request) => setDetailRequest(request)}
            dataSource={selectedItem ? eventsQuery.data?.items ?? [] : []}
            loading={queryEnabled && Boolean(selectedItem) && !eventsQuery.data && eventsQuery.isLoading}
            pagination={false}
            locale={{ emptyText: eventsEmptyText }}
            scroll={{ x: 1000 }}
          />
        </Space>
      </OpsSurface>

      <OpsModalShell
        title={editing ? `编辑 ${editing.type} 策略` : `新建 ${defaultType ?? "HPA/VPA"} 策略`}
        description="配置 HPA/VPA 目标、阈值、行为策略和资源限制。"
        identity={editing ? getAutoscalingResourceName(editing) : (defaultType ?? "Autoscaling")}
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          setEditing(null);
          setCreateYaml("");
          form.resetFields();
        }}
        onOk={async () => {
          if (!editing && createMode === "yaml") {
            if (!createYamlClusterId.trim()) {
              message.warning("请选择集群");
              return;
            }
            if (!createYaml.trim()) {
              message.warning("请输入或上传 YAML");
              return;
            }
            setYamlSubmitting(true);
            try {
              await applyResourceYaml(
                {
                  clusterId: createYamlClusterId.trim(),
                  namespace: createYamlNamespace.trim() || undefined,
                  yaml: createYaml.trim(),
                },
                accessToken ?? undefined,
              );
              message.success("HPA/VPA YAML 已提交");
              setModalOpen(false);
              setCreateYaml("");
              await queryClient.invalidateQueries({ queryKey: ["autoscaling"] });
              await queryClient.invalidateQueries({ queryKey: ["inspection", "autoscaling-hints"] });
            } catch (error) {
              message.error(error instanceof Error ? error.message : "YAML 提交失败");
            } finally {
              setYamlSubmitting(false);
            }
            return;
          }
          const values = await form.validateFields();
          if (editing) {
            updateMutation.mutate(values);
          } else {
            createMutation.mutate(values);
          }
        }}
        confirmLoading={createMutation.isPending || updateMutation.isPending || yamlSubmitting}
        width={760}
      >
        {!editing ? (
          <Tabs
            activeKey={createMode}
            onChange={(key) => setCreateMode(key === "yaml" ? "yaml" : "form")}
            items={[
              { key: "form", label: "表单", children: null },
              { key: "yaml", label: "YAML / 上传", children: null },
            ]}
          />
        ) : null}
        {!editing && createMode === "yaml" ? (
          <Space direction="vertical" size={12} style={{ width: "100%" }}>
            <Alert
              type="info"
              showIcon
              message="支持创建 HorizontalPodAutoscaler / VerticalPodAutoscaler 原生资源"
              description="按 Kubernetes 原生 apiVersion、kind、metadata.name 识别资源；表单未覆盖的 metrics、behavior、resourcePolicy 等字段请写入 YAML。"
            />
            <Form layout="vertical">
              <Form.Item label="集群" required>
                <Select
                  value={createYamlClusterId}
                  onChange={setCreateYamlClusterId}
                  options={clusterOptions}
                  loading={clustersQuery.isLoading}
                  placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
                  disabled={clusterUnavailable}
                  notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                  showSearch
                  optionFilterProp="label"
                />
              </Form.Item>
              <Form.Item label="默认名称空间">
                <Input
                  value={createYamlNamespace}
                  onChange={(event) => setCreateYamlNamespace(event.target.value)}
                  placeholder="YAML 未写 namespace 时使用"
                />
              </Form.Item>
              <Form.Item
                label={(
                  <Space size={8}>
                    <span>YAML</span>
                    <Upload {...yamlUploadProps} disabled={yamlSubmitting}>
                      <Button size="small" icon={<UploadOutlined />} disabled={yamlSubmitting}>
                        上传
                      </Button>
                    </Upload>
                  </Space>
                )}
                required
              >
                <Input.TextArea
                  value={createYaml}
                  onChange={(event) => setCreateYaml(event.target.value)}
                  autoSize={{ minRows: 14, maxRows: 24 }}
                  placeholder="apiVersion: autoscaling/v2&#10;kind: HorizontalPodAutoscaler&#10;metadata:&#10;  name: web-hpa&#10;  namespace: default"
                  style={{ fontFamily: "\"JetBrains Mono\", \"IBM Plex Mono\", SFMono-Regular, monospace", fontSize: 12 }}
                  disabled={yamlSubmitting}
                />
              </Form.Item>
            </Form>
            <Typography.Text type="secondary">
              上传仅读取本地文件内容，不会自动提交；点击创建后才应用。
            </Typography.Text>
          </Space>
        ) : (
        <Form form={form} layout="vertical" initialValues={{ type: defaultType ?? "HPA", kind: "Deployment" }}>
          <Row gutter={12}>
            <Col span={8}>
              <Form.Item name="type" label="策略类型" rules={[{ required: true, message: "请选择类型" }]}>
                <Select
                  options={[
                    ...(defaultType ? [{ label: defaultType, value: defaultType }] : []),
                    ...(!defaultType
                      ? [
                          { label: "HPA", value: "HPA" },
                          { label: "VPA", value: "VPA" },
                        ]
                      : []),
                  ]}
                  disabled={Boolean(editing) || Boolean(defaultType)}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
                <Select
                  options={clusterOptions}
                  loading={clustersQuery.isLoading}
                  placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
                  disabled={Boolean(editing) || clusterUnavailable || (!clustersQuery.isLoading && clusterOptions.length === 0)}
                  notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                />
              </Form.Item>
            </Col>
            <Col span={8}>
              <Form.Item name="namespace" label="Namespace" rules={[{ required: true, message: "请输入 namespace" }]}>
                <Input disabled={Boolean(editing)} />
              </Form.Item>
            </Col>
          </Row>

          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="kind" label="工作负载类型" rules={[{ required: true, message: "请选择类型" }]}>
                <Select options={kindOptions} disabled={Boolean(editing)} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="name" label={editing ? "策略资源名称" : "工作负载名称"} rules={[{ required: true, message: "请输入名称" }]}>
                <Input disabled={Boolean(editing)} />
              </Form.Item>
            </Col>
          </Row>

          {formType === "HPA" ? (
            <>
                    <Row gutter={12}>
                      <Col span={8}>
                        <Form.Item
                          name="hpaMinReplicas"
                          label="最小副本"
                          rules={[{ required: true, message: "请输入最小副本" }]}
                        >
                          <InputNumber min={1} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item
                          name="hpaMaxReplicas"
                          label="最大副本"
                          dependencies={["hpaMinReplicas"]}
                          rules={[
                            { required: true, message: "请输入最大副本" },
                            ({ getFieldValue }) => ({
                              validator(_, value: number | undefined) {
                                const min = getFieldValue("hpaMinReplicas") as number | undefined;
                                if (value === undefined || min === undefined || value >= min) {
                                  return Promise.resolve();
                                }
                                return Promise.reject(new Error("最大副本必须大于或等于最小副本"));
                              },
                            }),
                          ]}
                        >
                          <InputNumber min={1} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="hpaTargetCpu" label="CPU目标利用率(%)">
                          <InputNumber min={1} max={100} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col span={8}>
                        <Form.Item name="hpaTargetMemory" label="内存目标利用率(%)">
                          <InputNumber min={1} max={100} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                    </Row>

                    <OpsFormSection
                      title="高级指标 (metrics)"
                      description="可选添加 Resource / Pods / External 指标；未填写时沿用 CPU / 内存目标。"
                    >
                      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        <Button
                          type="dashed"
                          onClick={() => {
                            const metrics = form.getFieldValue("hpaMetrics") as HpaMetricFormItem[] | undefined;
                            form.setFieldValue("hpaMetrics", [
                              ...(metrics ?? []),
                              {
                                sourceType: "Resource",
                                name: "cpu",
                                targetType: "Utilization",
                                targetValue: "70",
                              } satisfies HpaMetricFormItem,
                            ]);
                          }}
                        >
                          添加指标
                        </Button>
                        <Form.List name="hpaMetrics">
                          {(fields, { remove }) => (
                            <Space orientation="vertical" style={{ width: "100%" }} size={12}>
                              {fields.length === 0 ? (
                                <Typography.Text type="secondary">
                                  未配置高级指标。可选添加 Resource/Pods/External 指标。
                                </Typography.Text>
                              ) : null}
                              {fields.map((field) => {
                                const sourceType = form.getFieldValue([
                                  "hpaMetrics",
                                  field.name,
                                  "sourceType",
                                ]) as HpaMetricSpec["sourceType"] | undefined;

                                const targetTypeOptions =
                                  sourceType === "Resource"
                                    ? [
                                        { label: "Utilization", value: "Utilization" },
                                        { label: "AverageValue", value: "AverageValue" },
                                        { label: "Value", value: "Value" },
                                      ]
                                    : [
                                        { label: "AverageValue", value: "AverageValue" },
                                        { label: "Value", value: "Value" },
                                      ];

                                return (
                                  <OpsSurface
                                    key={field.key}
                                    variant="flat"
                                    padding="sm"
                                    title={`指标 #${field.name + 1}`}
                                    actions={
                                      <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>
                                        删除
                                      </Button>
                                    }
                                  >
                                    <Row gutter={12}>
                                      <Col span={6}>
                                        <Form.Item
                                          name={[field.name, "sourceType"]}
                                          label="指标来源"
                                          rules={[{ required: true, message: "请选择来源" }]}
                                        >
                                          <Select
                                            options={[
                                              { label: "Resource", value: "Resource" },
                                              { label: "Pods", value: "Pods" },
                                              { label: "External", value: "External" },
                                            ]}
                                          />
                                        </Form.Item>
                                      </Col>
                                      <Col span={6}>
                                        <Form.Item
                                          name={[field.name, "name"]}
                                          label={sourceType === "Resource" ? "资源名称" : "指标名称"}
                                          rules={[{ required: true, message: "请输入名称" }]}
                                        >
                                          <Input placeholder={sourceType === "Resource" ? "cpu / memory" : "qps"} />
                                        </Form.Item>
                                      </Col>
                                      <Col span={6}>
                                        <Form.Item
                                          name={[field.name, "targetType"]}
                                          label="目标类型"
                                          rules={[{ required: true, message: "请选择目标类型" }]}
                                        >
                                          <Select options={targetTypeOptions} />
                                        </Form.Item>
                                      </Col>
                                      <Col span={6}>
                                        <Form.Item
                                          name={[field.name, "targetValue"]}
                                          label="目标值"
                                          rules={[{ required: true, message: "请输入目标值" }]}
                                        >
                                          <Input placeholder="70 / 500m / 10" />
                                        </Form.Item>
                                      </Col>
                                      {sourceType === "Pods" || sourceType === "External" ? (
                                        <Col span={24}>
                                          <Form.Item
                                            name={[field.name, "selector"]}
                                            label="Selector (可选)"
                                            tooltip="格式：key=value，支持逗号或换行分隔多个条件"
                                            rules={[
                                              {
                                                validator(_, value: string | undefined) {
                                                  try {
                                                    parseSelectorText(value);
                                                    return Promise.resolve();
                                                  } catch (error) {
                                                    return Promise.reject(
                                                      error instanceof Error ? error : new Error("selector 格式不合法"),
                                                    );
                                                  }
                                                },
                                              },
                                            ]}
                                          >
                                            <Input.TextArea rows={2} placeholder={"app=api\nenv=prod"} />
                                          </Form.Item>
                                        </Col>
                                      ) : null}
                                    </Row>
                                  </OpsSurface>
                                );
                              })}
                            </Space>
                          )}
                        </Form.List>
                      </Space>
                    </OpsFormSection>

                    <OpsFormSection
                      title="扩缩容策略 (behavior)"
                      description="分别配置 Scale Up / Scale Down 的稳定窗口、选择策略和 policy 条目。"
                    >
                      <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                        {(["scaleUp", "scaleDown"] as const).map((ruleKey) => (
                          <OpsSurface
                            key={ruleKey}
                            variant="flat"
                            padding="sm"
                            title={ruleKey === "scaleUp" ? "Scale Up" : "Scale Down"}
                          >
                            <Row gutter={12}>
                            <Col span={12}>
                              <Form.Item name={["hpaBehavior", ruleKey, "stabilizationWindowSeconds"]} label="稳定窗口(秒)">
                                <InputNumber min={1} style={{ width: "100%" }} />
                              </Form.Item>
                            </Col>
                            <Col span={12}>
                              <Form.Item name={["hpaBehavior", ruleKey, "selectPolicy"]} label="策略选择">
                                <Select
                                  allowClear
                                  options={[
                                    { label: "Max", value: "Max" },
                                    { label: "Min", value: "Min" },
                                    { label: "Disabled", value: "Disabled" },
                                  ]}
                                />
                              </Form.Item>
                            </Col>
                          </Row>

                          <Form.List name={["hpaBehavior", ruleKey, "policies"]}>
                            {(fields, { add, remove }) => (
                              <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                                <Button
                                  type="dashed"
                                  onClick={() => {
                                    add({ type: "Percent", value: 100, periodSeconds: 60 } satisfies HpaBehaviorPolicyFormItem);
                                  }}
                                >
                                  添加策略
                                </Button>
                                {fields.length === 0 ? (
                                  <Typography.Text type="secondary">未配置 policy 条目</Typography.Text>
                                ) : null}
                                {fields.map((field) => (
                                  <Row gutter={12} key={field.key}>
                                    <Col span={7}>
                                      <Form.Item
                                        name={[field.name, "type"]}
                                        label="类型"
                                        rules={[{ required: true, message: "请选择类型" }]}
                                      >
                                        <Select
                                          options={[
                                            { label: "Percent", value: "Percent" },
                                            { label: "Pods", value: "Pods" },
                                          ]}
                                        />
                                      </Form.Item>
                                    </Col>
                                    <Col span={7}>
                                      <Form.Item
                                        name={[field.name, "value"]}
                                        label="值"
                                        rules={[{ required: true, message: "请输入值" }]}
                                      >
                                        <InputNumber min={1} style={{ width: "100%" }} />
                                      </Form.Item>
                                    </Col>
                                    <Col span={7}>
                                      <Form.Item
                                        name={[field.name, "periodSeconds"]}
                                        label="周期(秒)"
                                        rules={[{ required: true, message: "请输入周期" }]}
                                      >
                                        <InputNumber min={1} style={{ width: "100%" }} />
                                      </Form.Item>
                                    </Col>
                                    <Col span={3} style={{ display: "flex", alignItems: "end" }}>
                                      <Button type="text" danger icon={<MinusCircleOutlined />} onClick={() => remove(field.name)}>
                                        删除
                                      </Button>
                                    </Col>
                                  </Row>
                                ))}
                              </Space>
                            )}
                          </Form.List>
                        </OpsSurface>
                      ))}
                      </Space>
                    </OpsFormSection>

                    <Row gutter={12}>
                      <Col span={24}>
                        <Form.Item
                          name="hpaBehaviorJson"
                          label="高级覆盖 (behavior JSON，可选)"
                          tooltip="填写后将覆盖上方结构化 behavior 配置"
                        >
                          <Input.TextArea rows={4} placeholder='{"scaleUp":{"selectPolicy":"Max","policies":[{"type":"Percent","value":100,"periodSeconds":60}]}}' />
                        </Form.Item>
                      </Col>
                    </Row>
            </>
          ) : (
            <>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item name="vpaUpdateMode" label="更新模式" rules={[{ required: true, message: "请选择模式" }]}>
                        <Select
                          options={[
                            { label: "Auto", value: "Auto" },
                            { label: "Initial", value: "Initial" },
                            { label: "Off", value: "Off" },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="vpaMinCpu" label="最小CPU (如 200m)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="vpaMaxCpu" label="最大CPU (如 2)">
                        <Input />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Row gutter={12}>
                    <Col span={8}>
                      <Form.Item name="vpaMinMemory" label="最小内存 (如 256Mi)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="vpaMaxMemory" label="最大内存 (如 2Gi)">
                        <Input />
                      </Form.Item>
                    </Col>
                    <Col span={8}>
                      <Form.Item name="vpaControlledResources" label="受控资源">
                        <Select mode="tags" options={[{ value: "cpu" }, { value: "memory" }]} />
                      </Form.Item>
                    </Col>
                  </Row>
            </>
          )}
        </Form>
        )}
      </OpsModalShell>

      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        token={accessToken ?? undefined}
        identity={
          yamlTarget
            ? {
                clusterId: yamlTarget.clusterId,
                namespace: yamlTarget.namespace,
                kind: yamlTarget.type === "HPA" ? "HorizontalPodAutoscaler" : "VerticalPodAutoscaler",
                name: getAutoscalingResourceName(yamlTarget),
              }
            : null
        }
        onClose={() => setYamlTarget(null)}
        onUpdated={async () => {
          await queryClient.invalidateQueries({ queryKey: ["autoscaling"] });
        }}
      />
      <ResourceDetailDrawer
        open={Boolean(detailRequest)}
        onClose={() => setDetailRequest(null)}
        token={accessToken ?? undefined}
        request={detailRequest}
        onNavigateRequest={(request) => setDetailRequest(request)}
      />
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
