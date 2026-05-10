"use client";

import {
  DeleteOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlusOutlined,
  ReloadOutlined,
  RetweetOutlined,
  RollbackOutlined,
  SearchOutlined,
  StopOutlined,
} from "@ant-design/icons";
import { useMemo, useState } from "react";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Dropdown,
  Form,
  Input,
  InputNumber,
  Modal,
  Row,
  Select,
  Space,
  Switch,
  Table,
  Tag,
  Typography,
} from "antd";
import type { MenuProps } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import {
  buildResourceActionMenuItems,
  matchLabelExpressions,
  parseResourceSearchInput,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  applyWorkloadActionById,
  createWorkload,
  deleteWorkload,
  getWorkloadsByKind,
  patchWorkloadById,
  type WorkloadListItem,
} from "@/lib/api/workloads";
import {
  type ResourceDetailRequest,
  type ResourceIdentity,
} from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { NamespaceSelect } from "@/components/namespace-select";
import { extractWorkloadImage } from "@/lib/workloads/image";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";

function stateTag(state: string) {
  if (state === "active") return <Tag color="green">启用</Tag>;
  if (state === "disabled") return <Tag color="default">禁用</Tag>;
  return <Tag color="red">已删除</Tag>;
}

interface FormValues {
  name: string;
  namespace: string;
  clusterId: string;
  replicas: number;
  scheduling?: SchedulingConfig;
  probes?: ProbeConfig;
}

interface KeyValuePair {
  key?: string;
  value?: string;
}

interface TolerationForm {
  key?: string;
  operator?: "Equal" | "Exists";
  value?: string;
  effect?: "NoSchedule" | "PreferNoSchedule" | "NoExecute";
}

interface ProbeHttpConfig {
  enabled?: boolean;
  path?: string;
  port?: number;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

interface SchedulingConfig {
  nodeSelector?: KeyValuePair[];
  tolerations?: TolerationForm[];
  podAntiAffinityEnabled?: boolean;
  podAntiAffinityLabelKey?: string;
  podAntiAffinityLabelValues?: string;
  podAntiAffinityTopologyKey?: string;
}

interface ProbeConfig {
  liveness?: ProbeHttpConfig;
  readiness?: ProbeHttpConfig;
  startup?: ProbeHttpConfig;
}

type DaemonSetAction = "scale" | "restart" | "rollback" | "enable" | "disable";

function toNodeSelectorObject(pairs: KeyValuePair[]): Record<string, string> | undefined {
  const normalized = pairs.reduce<Record<string, string>>((acc, pair) => {
    const key = pair.key?.trim();
    const value = pair.value?.trim();
    if (key && value) {
      acc[key] = value;
    }
    return acc;
  }, {});
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function toTolerations(values: TolerationForm[]): Array<Record<string, string>> | undefined {
  const normalized = values
    .map((item) => ({
      key: item.key?.trim(),
      operator: item.operator ?? "Equal",
      value: item.value?.trim(),
      effect: item.effect,
    }))
    .filter((item) => item.key)
    .map((item) => {
      const output: Record<string, string> = {
        key: item.key!,
        operator: item.operator,
      };
      if (item.operator === "Equal" && item.value) {
        output.value = item.value;
      }
      if (item.effect) {
        output.effect = item.effect;
      }
      return output;
    });
  return normalized.length > 0 ? normalized : undefined;
}

function toHttpProbeConfig(config?: ProbeHttpConfig): Record<string, unknown> | undefined {
  if (!config?.enabled || !config.path?.trim() || !config.port) {
    return undefined;
  }
  return {
    httpGet: {
      path: config.path.trim(),
      port: config.port,
    },
    initialDelaySeconds: config.initialDelaySeconds ?? 5,
    periodSeconds: config.periodSeconds ?? 10,
    timeoutSeconds: config.timeoutSeconds ?? 1,
    successThreshold: config.successThreshold ?? 1,
    failureThreshold: config.failureThreshold ?? 3,
  };
}

function buildDaemonSetSpec(values: FormValues): Record<string, unknown> | undefined {
  const nodeSelector = toNodeSelectorObject(values.scheduling?.nodeSelector ?? []);
  const tolerations = toTolerations(values.scheduling?.tolerations ?? []);
  const antiAffinityLabelKey = values.scheduling?.podAntiAffinityLabelKey?.trim();
  const antiAffinityValues = (values.scheduling?.podAntiAffinityLabelValues ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
  const podAntiAffinity =
    values.scheduling?.podAntiAffinityEnabled && antiAffinityLabelKey
      ? {
          requiredDuringSchedulingIgnoredDuringExecution: [
            {
              labelSelector: {
                matchExpressions: [
                  {
                    key: antiAffinityLabelKey,
                    operator: "In",
                    values: antiAffinityValues.length > 0 ? antiAffinityValues : ["true"],
                  },
                ],
              },
              topologyKey:
                values.scheduling?.podAntiAffinityTopologyKey?.trim() ||
                "kubernetes.io/hostname",
            },
          ],
        }
      : undefined;
  const livenessProbe = toHttpProbeConfig(values.probes?.liveness);
  const readinessProbe = toHttpProbeConfig(values.probes?.readiness);
  const startupProbe = toHttpProbeConfig(values.probes?.startup);
  const hasSchedulingConfig = Boolean(nodeSelector || tolerations || podAntiAffinity);
  const hasProbeConfig = Boolean(livenessProbe || readinessProbe || startupProbe);

  if (!hasSchedulingConfig && !hasProbeConfig) {
    return undefined;
  }

  return {
    selector: {
      matchLabels: {
        app: values.name,
      },
    },
    template: {
      metadata: {
        labels: {
          app: values.name,
        },
      },
      spec: {
        ...(nodeSelector ? { nodeSelector } : {}),
        ...(tolerations ? { tolerations } : {}),
        ...(podAntiAffinity ? { affinity: { podAntiAffinity } } : {}),
        ...(hasProbeConfig
          ? {
              containers: [
                {
                  name: values.name,
                  ...(livenessProbe ? { livenessProbe } : {}),
                  ...(readinessProbe ? { readinessProbe } : {}),
                  ...(startupProbe ? { startupProbe } : {}),
                },
              ],
            }
          : {}),
      },
    },
  };
}

export default function DaemonSetsPage() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 10;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<WorkloadListItem | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<FormValues>();
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [scaleItem, setScaleItem] = useState<WorkloadListItem | null>(null);
  const [targetReplicas, setTargetReplicas] = useState(1);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const queryKey = ["workloads", "DaemonSet", { clusterId, keyword, namespace, page, pageSize }, accessToken];

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () =>
      getWorkloadsByKind(
        "DaemonSet",
        { clusterId: clusterId || undefined, keyword: keyword.trim() || undefined, namespace: namespace.trim() || undefined, page, pageSize },
        accessToken || undefined,
      ),
    enabled: !isInitializing && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "list", accessToken],
    queryFn: () => getClusters({ state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => [
      { label: "全部集群", value: "" },
      ...(clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    ],
    [clustersQuery.data],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name])),
    [clustersQuery.data],
  );

  const clusterSelectOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );

  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter(Boolean))),
    [data],
  );
  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter((item) =>
        matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters),
      ),
    [data?.items, mergedFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );
  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    setPage(1);
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const openEditModal = (item: WorkloadListItem) => {
    setEditingItem(item);
    form.setFieldsValue({
      name: item.name,
      namespace: item.namespace,
      clusterId: item.clusterId,
      replicas: item.replicas,
    });
    setModalOpen(true);
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleModalSubmit = async () => {
    let values: FormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      const spec = buildDaemonSetSpec(values);
      if (editingItem) {
        await patchWorkloadById(
          editingItem.id,
          { namespace: values.namespace, replicas: values.replicas, ...(spec ? { spec } : {}) },
          accessToken!,
        );
        void message.success("DaemonSet 更新成功");
      } else {
        await createWorkload(
          {
            clusterId: values.clusterId,
            namespace: values.namespace,
            kind: "DaemonSet",
            name: values.name,
            replicas: values.replicas,
            ...(spec ? { spec } : {}),
          },
          accessToken!,
        );
        void message.success("DaemonSet 创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      void queryClient.invalidateQueries({ queryKey });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (item: WorkloadListItem) => {
    try {
      await deleteWorkload(item.id, accessToken!);
      void message.success(`${item.name} 删除成功`);
      void refetch();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const resolveIdentity = (item: WorkloadListItem): ResourceIdentity => {
    const urlClusterId = searchParams.get("clusterId")?.trim();
    const urlNamespace = searchParams.get("namespace")?.trim();
    const urlKind = searchParams.get("kind")?.trim();
    return {
      clusterId: urlClusterId || item.clusterId || clusterId,
      namespace: urlNamespace || item.namespace || namespace,
      kind: urlKind || "DaemonSet",
      name: item.name,
    };
  };

  const actionMutation = useMutation({
    mutationFn: async ({
      item,
      action,
    }: {
      item: WorkloadListItem;
      action: DaemonSetAction;
    }) => applyWorkloadActionById(item.id, action, undefined, accessToken!),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey });
    },
  });

  const handleWorkloadAction = async (item: WorkloadListItem, action: DaemonSetAction) => {
    try {
      await actionMutation.mutateAsync({ item, action });
      const actionText =
        action === "restart"
          ? "重启"
          : action === "rollback"
            ? "回滚"
            : action === "enable"
              ? "启用"
              : "禁用";
      void message.success(`${item.name} ${actionText}操作已提交`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    }
  };

  const handleScale = async () => {
    if (!scaleItem) return;
    const selected = scaleItem;
    const target = Math.max(0, Math.trunc(targetReplicas));
    setScaleItem(null);
    try {
      await actionMutation.mutateAsync({ item: selected, action: "scale" });
      void message.success(`${selected.name} 扩缩容操作已提交，目标值 ${target}`);
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "扩缩容失败，请重试");
    }
  };

  const buildRowActions = (item: WorkloadListItem): MenuProps["items"] => {
    const active = item.state === "active";
    return buildResourceActionMenuItems([
      { key: "describe", icon: <EyeOutlined />, label: "描述" },
      { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
      { key: "scale", icon: <RetweetOutlined />, label: "扩缩容" },
      { key: "restart", icon: <ReloadOutlined />, label: "重启", disabled: !active },
      { key: "rollback", icon: <RollbackOutlined />, label: "回滚", disabled: !active },
      { key: active ? "disable" : "enable", icon: <StopOutlined />, label: active ? "禁用" : "启用" },
      { type: "divider" },
      { key: "delete", icon: <DeleteOutlined />, danger: true, label: "删除" },
    ]);
  };

  const handleRowAction = (item: WorkloadListItem, key: string) => {
    if (key === "describe") {
      setDetailTarget({ kind: "DaemonSet", id: item.id });
      return;
    }
    if (key === "yaml") {
      setYamlTarget(resolveIdentity(item));
      return;
    }
    if (key === "scale") {
      setScaleItem(item);
      setTargetReplicas(item.replicas);
      return;
    }
    if (key === "restart" || key === "rollback" || key === "disable" || key === "enable") {
      void handleWorkloadAction(item, key as Exclude<DaemonSetAction, "scale">);
      return;
    }
    if (key === "delete") {
      Modal.confirm({
        title: "删除 DaemonSet",
        content: `确认删除 ${item.name} 吗？`,
        okText: "确认",
        cancelText: "取消",
        okButtonProps: { danger: true },
        onOk: () => void handleDelete(item),
      });
    }
  };

  // DaemonSet 不需要 replicas，用节点覆盖数表示
  const columns: ColumnsType<WorkloadListItem> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: WorkloadListItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "DaemonSet", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
    },
    { title: "集群", dataIndex: "clusterId", key: "clusterId", width: TABLE_COL_WIDTH.cluster, render: (_: unknown, row: WorkloadListItem) => getClusterDisplayName(clusterMap, row.clusterId) },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    {
      title: "镜像",
      key: "image",
      width: TABLE_COL_WIDTH.image,
      ellipsis: true,
      render: (_: unknown, item: WorkloadListItem) => extractWorkloadImage(item),
    },
    { title: "期望调度", dataIndex: "replicas", key: "replicas", width: TABLE_COL_WIDTH.replicas },
    { title: "当前就绪", dataIndex: "readyReplicas", key: "readyReplicas", width: TABLE_COL_WIDTH.ready },
    {
      title: "状态",
      dataIndex: "state",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (value: string) => stateTag(value),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      align: "center",
      fixed: "right",
      render: (_: unknown, item: WorkloadListItem) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
          menu={{
            items: buildRowActions(item),
            onClick: ({ key }) => handleRowAction(item, String(key)),
          }}
        >
          {renderResourceActionTriggerButton({
            ariaLabel: "更多操作",
            baseClassName: POD_ACTION_TRIGGER_CLASS,
          })}
        </Dropdown>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/workloads/daemonsets"
          embedded
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton onClick={() => router.push("/workloads/create?kind=DaemonSet")} aria-label="新增资源" />}
        />

        <Space orientation="vertical" size={12} style={{ width: "100%" }}>
          <Row gutter={[12, 12]} align="middle">
            <Col xs={24} sm={12} md={6} lg={4}>
              <Select
                style={{ width: "100%" }}
                placeholder="全部集群"
                value={clusterId || undefined}
                onChange={(v) => { setClusterId(v ?? ""); setPage(1); }}
                allowClear
                options={clusterOptions}
                loading={clustersQuery.isLoading}
              />
            </Col>
            <Col xs={24} sm={12} md={5} lg={4}>
              <NamespaceSelect
                value={namespace}
                onChange={(v) => { setNamespace(v); setPage(1); }}
                knownNamespaces={knownNamespaces}
                clusterId={clusterId}
              />
            </Col>
            <Col xs={24} sm={16} md={7} lg={6}>
              <Input
                prefix={<SearchOutlined />}
                allowClear
                placeholder="按名称/标签搜索（示例：app-a app=web env=prod）"
                value={keywordInput}
                onChange={(e) => setKeywordInput(e.target.value)}
                onPressEnter={handleSearch}
              />
            </Col>
            <Col xs={24} sm={12} md={4} lg={3}>
              <Space>
                <Button
                  icon={<SearchOutlined />}
                  type="primary"
                  onClick={handleSearch}
                >
                  查询
                </Button>
              </Space>
            </Col>
          </Row>

          {!isInitializing && !accessToken ? (
            <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" />
          ) : null}

          {isError ? (
            <Alert
              type="error"
              showIcon
              message="守护进程集加载失败"
              description={error instanceof Error ? error.message : "请求失败"}
            />
          ) : null}

          <Table<WorkloadListItem>
            bordered
            rowKey="id"
            columns={columns}
            dataSource={tableData}
            loading={(isLoading && !data) || actionMutation.isPending}
            pagination={{
              current: page,
              pageSize,
              total: data?.total ?? 0,
              onChange: (p) => setPage(p),
              showTotal: (total) => `共 ${total} 条`,
            }}
            scroll={{ x: getTableScrollX(columns) }}
          />
        </Space>
      </Card>

      <Modal
        title={editingItem ? "编辑 DaemonSet" : "新增资源"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={handleModalCancel}
        okText={editingItem ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入 DaemonSet 名称" }]}
          >
            <Input placeholder="例如：node-exporter" disabled={Boolean(editingItem)} />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input placeholder="例如：kube-system" />
          </Form.Item>
          <Form.Item
            label="集群"
            name="clusterId"
            rules={[{ required: true, message: "请选择集群" }]}
          >
            <Select
              placeholder="请选择集群"
              options={clusterSelectOptions}
              loading={clustersQuery.isLoading}
              disabled={Boolean(editingItem)}
              showSearch
              optionFilterProp="label"
            />
          </Form.Item>
          <Form.Item label="节点数（预期）" name="replicas">
            <InputNumber min={0} style={{ width: "100%" }} placeholder="由调度器决定，可留空" />
          </Form.Item>
          {!editingItem ? (
            <>
              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                调度策略
              </Typography.Text>
              <Form.List name={["scheduling", "nodeSelector"]}>
                {(fields, { add, remove }) => (
                  <div style={{ padding: 12, border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, marginBottom: 12 }}>
                    <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                      Node Selector
                    </Typography.Text>
                    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                      {fields.map((field) => (
                        <Row key={field.key} gutter={8}>
                          <Col span={11}>
                            <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                              <Input placeholder="label key" />
                            </Form.Item>
                          </Col>
                          <Col span={11}>
                            <Form.Item name={[field.name, "value"]} style={{ marginBottom: 0 }}>
                              <Input placeholder="label value" />
                            </Form.Item>
                          </Col>
                          <Col span={2}>
                            <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                          </Col>
                        </Row>
                      ))}
                      <Button type="dashed" icon={<PlusOutlined />} onClick={() => add({ key: "", value: "" })}>
                        添加 Node Selector
                      </Button>
                    </Space>
                  </div>
                )}
              </Form.List>

              <Form.List name={["scheduling", "tolerations"]}>
                {(fields, { add, remove }) => (
                  <div style={{ padding: 12, border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, marginBottom: 12 }}>
                    <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                      Tolerations
                    </Typography.Text>
                    <Space orientation="vertical" size={8} style={{ width: "100%" }}>
                      {fields.map((field) => (
                        <Row key={field.key} gutter={8}>
                          <Col span={5}>
                            <Form.Item name={[field.name, "key"]} style={{ marginBottom: 0 }}>
                              <Input placeholder="key" />
                            </Form.Item>
                          </Col>
                          <Col span={5}>
                            <Form.Item name={[field.name, "operator"]} style={{ marginBottom: 0 }}>
                              <Select
                                placeholder="operator"
                                options={[
                                  { label: "Equal", value: "Equal" },
                                  { label: "Exists", value: "Exists" },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={6}>
                            <Form.Item name={[field.name, "value"]} style={{ marginBottom: 0 }}>
                              <Input placeholder="value (Exists 可留空)" />
                            </Form.Item>
                          </Col>
                          <Col span={6}>
                            <Form.Item name={[field.name, "effect"]} style={{ marginBottom: 0 }}>
                              <Select
                                placeholder="effect"
                                options={[
                                  { label: "NoSchedule", value: "NoSchedule" },
                                  { label: "PreferNoSchedule", value: "PreferNoSchedule" },
                                  { label: "NoExecute", value: "NoExecute" },
                                ]}
                              />
                            </Form.Item>
                          </Col>
                          <Col span={2}>
                            <Button danger icon={<DeleteOutlined />} onClick={() => remove(field.name)} />
                          </Col>
                        </Row>
                      ))}
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => add({ key: "", operator: "Equal", value: "", effect: "NoSchedule" })}
                      >
                        添加 Toleration
                      </Button>
                    </Space>
                  </div>
                )}
              </Form.List>

              <div style={{ padding: 12, border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, marginBottom: 12 }}>
                <Form.Item name={["scheduling", "podAntiAffinityEnabled"]} valuePropName="checked" style={{ marginBottom: 8 }}>
                  <Switch checkedChildren="启用 Pod 反亲和性" unCheckedChildren="关闭 Pod 反亲和性" />
                </Form.Item>
                <Form.Item noStyle shouldUpdate>
                  {() =>
                    form.getFieldValue(["scheduling", "podAntiAffinityEnabled"]) ? (
                      <Row gutter={8}>
                        <Col span={8}>
                          <Form.Item
                            label="标签 Key"
                            name={["scheduling", "podAntiAffinityLabelKey"]}
                            rules={[{ required: true, message: "请输入标签 key" }]}
                          >
                            <Input placeholder="app" />
                          </Form.Item>
                        </Col>
                        <Col span={10}>
                          <Form.Item label="标签值(逗号分隔)" name={["scheduling", "podAntiAffinityLabelValues"]}>
                            <Input placeholder="web,api" />
                          </Form.Item>
                        </Col>
                        <Col span={6}>
                          <Form.Item label="Topology Key" name={["scheduling", "podAntiAffinityTopologyKey"]}>
                            <Input placeholder="kubernetes.io/hostname" />
                          </Form.Item>
                        </Col>
                      </Row>
                    ) : null
                  }
                </Form.Item>
              </div>

              <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                健康探针（HTTP）
              </Typography.Text>
              {(["liveness", "readiness", "startup"] as const).map((probeKey) => (
                <div
                  key={probeKey}
                  style={{ padding: 12, border: "1px solid rgba(59,130,246,0.12)", borderRadius: 8, marginBottom: 12 }}
                >
                  <Row gutter={8} align="middle" style={{ marginBottom: 8 }}>
                    <Col flex="auto">
                      <Typography.Text strong>{`${probeKey} Probe`}</Typography.Text>
                    </Col>
                    <Col>
                      <Form.Item name={["probes", probeKey, "enabled"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                        <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                      </Form.Item>
                    </Col>
                  </Row>
                  <Form.Item noStyle shouldUpdate>
                    {() =>
                      form.getFieldValue(["probes", probeKey, "enabled"]) ? (
                        <Row gutter={8}>
                          <Col span={8}>
                            <Form.Item
                              label="Path"
                              name={["probes", probeKey, "path"]}
                              rules={[{ required: true, message: "请输入探针路径" }]}
                            >
                              <Input placeholder="/healthz" />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item
                              label="Port"
                              name={["probes", probeKey, "port"]}
                              rules={[{ required: true, message: "请输入端口" }]}
                            >
                              <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item label="初始延迟(s)" name={["probes", probeKey, "initialDelaySeconds"]}>
                              <InputNumber min={0} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item label="周期(s)" name={["probes", probeKey, "periodSeconds"]}>
                              <InputNumber min={1} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item label="超时(s)" name={["probes", probeKey, "timeoutSeconds"]}>
                              <InputNumber min={1} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item label="成功阈值" name={["probes", probeKey, "successThreshold"]}>
                              <InputNumber min={1} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                          <Col span={4}>
                            <Form.Item label="失败阈值" name={["probes", probeKey, "failureThreshold"]}>
                              <InputNumber min={1} style={{ width: "100%" }} />
                            </Form.Item>
                          </Col>
                        </Row>
                      ) : null
                    }
                  </Form.Item>
                </div>
              ))}
            </>
          ) : null}
        </Form>
      </Modal>

      <Modal
        title="调整副本数"
        open={Boolean(scaleItem)}
        onCancel={() => setScaleItem(null)}
        onOk={() => void handleScale()}
        okText="提交"
        cancelText="取消"
        confirmLoading={actionMutation.isPending}
      >
        <Space orientation="vertical" size={8} style={{ width: "100%" }}>
          <Typography.Text>
            资源：<Typography.Text strong>{scaleItem?.name ?? "-"}</Typography.Text>
          </Typography.Text>
          <Typography.Text>目标值：</Typography.Text>
          <InputNumber
            min={0}
            style={{ width: "100%" }}
            value={targetReplicas}
            onChange={(value) => setTargetReplicas(typeof value === "number" ? value : 0)}
          />
        </Space>
      </Modal>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
      />

      <ResourceYamlDrawer
        open={Boolean(yamlTarget)}
        onClose={() => setYamlTarget(null)}
        identity={yamlTarget}
        token={accessToken ?? undefined}
        onUpdated={() => {
          void message.success("YAML 更新成功");
          void queryClient.invalidateQueries({ queryKey });
        }}
      />
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
