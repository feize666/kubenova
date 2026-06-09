"use client";

import {
  MinusCircleOutlined,
  PlusOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Col,
  Form,
  Input,
  Row,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ConfigCountCell, ConfigVersionCell } from "@/components/configs/config-table-cells";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampTableFilters, HeadlampResourceTableColumn } from "@/components/resource-table";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { OpsModalShell, OpsSurface } from "@/components/ops";
import { ResourceCreateMethodTabs, type ResourceCreateMode } from "@/components/resource-create-method-tabs";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import {
  createConfig,
  deleteConfig,
  getConfigs,
  updateConfig,
  type ConfigResourceItem,
} from "@/lib/api/configs";
import { applyResourceYaml, getDynamicResourceDetail, type ResourceDetailRequest, type ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { ResourceScopeFilterButton } from "@/components/resource-scope-filter-button";
import { ResourceAddButton } from "@/components/resource-add-button";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

interface KVPair {
  key: string;
  value: string;
}

interface ConfigMapFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  entries: KVPair[];
  labelEntries: KVPair[];
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.values(value as Record<string, unknown>).every((item) => typeof item === "string")
  );
}

function toEntries(value: Record<string, string> | undefined): KVPair[] {
  const entries = Object.entries(value ?? {}).map(([key, entryValue]) => ({ key, value: entryValue }));
  return entries.length ? entries : [{ key: "", value: "" }];
}

function toRecord(entries: KVPair[] | undefined): Record<string, string> {
  const result: Record<string, string> = {};
  for (const entry of entries ?? []) {
    const key = entry.key?.trim();
    if (key) {
      result[key] = entry.value ?? "";
    }
  }
  return result;
}

function readConfigMapDetail(raw: unknown): { data: Record<string, string>; labels: Record<string, string> } {
  if (!raw || typeof raw !== "object") {
    return { data: {}, labels: {} };
  }
  const obj = raw as Record<string, unknown>;
  const metadata = obj.metadata && typeof obj.metadata === "object" ? (obj.metadata as Record<string, unknown>) : {};
  return {
    data: isStringRecord(obj.data) ? obj.data : {},
    labels: isStringRecord(metadata.labels) ? metadata.labels : {},
  };
}

export default function ConfigMapsPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onScopeChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [globalSearchInput, setGlobalSearchInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const { sortBy, sortOrder, pagination, resetPage, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<ConfigResourceItem>({
      defaultPageSize: 10,
    });

  const [modalOpen, setModalOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ResourceCreateMode>("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [editingTarget, setEditingTarget] = useState<ConfigResourceItem | null>(null);
  const [editLoading, setEditLoading] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<ConfigMapFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "configs",
      "configmaps",
      {
        clusterId,
        namespace,
        keyword,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      },
      accessToken,
    ],
    queryFn: () =>
      getConfigs(
        "configmaps",
        {
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
          keyword: keyword.trim() || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken!,
      ),
    enabled: !isInitializing && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterFilterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id })),
    [clustersQuery.data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: Parameters<typeof createConfig>[0]) =>
      createConfig(payload, accessToken!),
    onSuccess: async () => {
      void message.success("ConfigMap 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
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
        accessToken!,
      ),
    onSuccess: async (result) => {
      void message.success(result.message || "YAML 已应用");
      setModalOpen(false);
      setCreateYaml("");
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "YAML 创建失败");
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: Parameters<typeof updateConfig>[1] }) =>
      updateConfig(id, payload, accessToken!),
    onSuccess: async () => {
      void message.success("ConfigMap 更新成功");
      setModalOpen(false);
      setEditingTarget(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    if (!editingTarget && createMode === "yaml") {
      if (!createYamlClusterId.trim()) {
        void message.warning("请选择集群");
        return;
      }
      if (!createYaml.trim()) {
        void message.warning("请输入或上传 YAML");
        return;
      }
      applyYamlMutation.mutate();
      return;
    }
    let values: ConfigMapFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    const configData = toRecord(values.entries);
    const labels = toRecord(values.labelEntries);
    if (editingTarget) {
      updateMutation.mutate({
        id: editingTarget.id,
        payload: {
          namespace: values.namespace,
          data: configData,
          dataKeys: Object.keys(configData),
          labels,
        },
      });
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "ConfigMap",
      name: values.name,
      data: configData,
      dataKeys: Object.keys(configData),
      labels,
    });
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);

  const clusterMap = Object.fromEntries(
    (clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]),
  );
  // Extract known namespaces from loaded data
  const knownNamespaces = useMemo(
    () =>
      Array.from(new Set((data?.items ?? []).map((item) => item.namespace).filter(Boolean))).sort(),
    [data?.items],
  );

  // Client-side label filtering — ConfigResourceItem may not carry labels, so result may be empty
  const resolveItemLabels = (item: ConfigResourceItem): Record<string, string> | null | undefined => {
    const raw = item as ConfigResourceItem & { labels?: unknown };
    if (!raw.labels || typeof raw.labels !== "object" || Array.isArray(raw.labels)) {
      return undefined;
    }
    return raw.labels as Record<string, string>;
  };

  const tableData = useMemo(() => {
    const readFilter = (key: string) =>
      typeof tableFilters[key] === "string" ? tableFilters[key].trim().toLowerCase() : "";
    const nameFilter = readFilter("name");
    const clusterFilter = readFilter("clusterId");
    const namespaceFilter = readFilter("namespace");
    const versionFilter = readFilter("version");

    return (data?.items ?? []).filter((item) => {
      if (!matchLabelExpressions(resolveItemLabels(item), mergedFilters)) return false;
      if (nameFilter && !item.name.toLowerCase().includes(nameFilter)) return false;
      const clusterLabel = getClusterDisplayName(clusterMap, item.clusterId).toLowerCase();
      if (clusterFilter && !`${item.clusterId} ${clusterLabel}`.includes(clusterFilter)) return false;
      if (namespaceFilter && !item.namespace.toLowerCase().includes(namespaceFilter)) return false;
      if (versionFilter && !`v${item.version ?? ""}`.toLowerCase().includes(versionFilter)) return false;
      return true;
    });
  }, [clusterMap, data?.items, mergedFilters, tableFilters]);
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleGlobalSearchChange = (value: string) => {
    setGlobalSearchInput(value);
    const parsed = parseResourceSearchInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/configs/configmaps",
  });

  const handleOpenCreate = () => {
    setEditingTarget(null);
    const nextClusterId = clusterId || clusterOptions[0]?.value || "";
    const nextNamespace = namespace || "default";
    form.resetFields();
    form.setFieldsValue({
      clusterId: nextClusterId,
      namespace: nextNamespace,
      entries: [{ key: "", value: "" }],
      labelEntries: [{ key: "", value: "" }],
    });
    setCreateMode("form");
    setCreateYaml("");
    setCreateYamlClusterId(nextClusterId);
    setCreateYamlNamespace(nextNamespace);
    setModalOpen(true);
  };

  const handleOpenEdit = async (row: ConfigResourceItem) => {
    if (!accessToken) {
      return;
    }
    setEditingTarget(row);
    setModalOpen(true);
    setEditLoading(true);
    form.setFieldsValue({
      name: row.name,
      namespace: row.namespace,
      clusterId: row.clusterId,
      entries: [{ key: "", value: "" }],
      labelEntries: toEntries(row.labels),
    });
    try {
      const detail = await getDynamicResourceDetail(
        {
          clusterId: row.clusterId,
          group: "",
          version: "v1",
          resource: "configmaps",
          namespace: row.namespace,
          name: row.name,
        },
        accessToken,
      );
      const parsed = readConfigMapDetail(detail.raw);
      form.setFieldsValue({
        name: row.name,
        namespace: row.namespace,
        clusterId: row.clusterId,
        entries: toEntries(parsed.data),
        labelEntries: toEntries(parsed.labels),
      });
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "读取 ConfigMap 详情失败");
    } finally {
      setEditLoading(false);
    }
  };

  const handleOpenYaml = (row: ConfigResourceItem) => {
    setYamlTarget({
      clusterId: row.clusterId,
      namespace: row.namespace,
      kind: "ConfigMap",
      name: row.name,
    });
  };

  const handleDelete = async (row: ConfigResourceItem) => {
    if (!accessToken) {
      return;
    }
    try {
      await deleteConfig(row.id, accessToken);
      void message.success("ConfigMap 删除成功");
      await queryClient.invalidateQueries({ queryKey: ["configs", "configmaps"] });
      await refetch();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const columns: Array<HeadlampResourceTableColumn<ConfigResourceItem>> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "以名称过滤" },
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: ConfigResourceItem) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "ConfigMap", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
    },
    {
      title: "集群",
      key: "clusterId",
      filter: { type: "text", placeholder: "以集群过滤" },
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, record: ConfigResourceItem) => getClusterDisplayName(clusterMap, record.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      filter: { type: "text", placeholder: "以名称空间过滤" },
      width: TABLE_COL_WIDTH.namespace,
    },
    {
      title: "键数量",
      dataIndex: "dataCount",
      key: "dataCount",
      width: TABLE_COL_WIDTH.type,
      render: (v: number) => <ConfigCountCell value={v} label="keys" />,
    },
    {
      title: "版本",
      dataIndex: "version",
      key: "version",
      filter: { type: "text", placeholder: "以版本过滤" },
      width: TABLE_COL_WIDTH.version,
      render: (v?: number) => <ConfigVersionCell value={v} />,
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      align: "left",
      render: (_: unknown, row: ConfigResourceItem) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 ConfigMap"
          deleteContent={`确认删除 ConfigMap「${row.name}」吗？此操作不可恢复。`}
          onYaml={() => handleOpenYaml(row)}
          onEdit={() => void handleOpenEdit(row)}
          onDelete={() => void handleDelete(row)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/configs/configmaps"
        titleSuffix={<ResourceAddButton title="创建ConfigMap" onClick={handleOpenCreate} />}
      />

      <OpsSurface variant="toolbar" padding="sm">
        <ResourceScopeFilterButton
          clusterId={clusterId}
          namespace={namespace}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          namespaceDisabled={namespaceDisabled}
          namespacePlaceholder={namespacePlaceholder}
          onApply={({ clusterId: nextClusterId, namespace: nextNamespace }) => {
            onScopeChange(nextClusterId, nextNamespace);
            resetPage();
          }}
        />
      </OpsSurface>

      {!isInitializing && !accessToken ? (
        <Alert
          className="config-resource-state-alert"
          type="warning"
          showIcon
          title="未检测到登录状态，请先登录后再操作。"
        />
      ) : null}

      {isError ? (
        <Alert
          className="config-resource-state-alert"
          type="error"
          showIcon
          title="ConfigMap 加载失败"
          description={error instanceof Error ? error.message : "请求失败"}
        />
      ) : null}

      <OpsSurface variant="panel" padding="sm">
        <ResourceTable<ConfigResourceItem>
          tableKey="configs.configmaps"
          rowKey="id"
          columns={columns as ColumnsType<ConfigResourceItem>}
          onResourceNavigate={(request) => setDetailTarget(request)}
          dataSource={tableData}
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: globalSearchInput,
            onChange: handleGlobalSearchChange,
            placeholder: "搜索名称或标签，如 cm-a app=web",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{
            sortBy,
            sortOrder,
          }}
          layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 } }}
          loading={isLoading && !data}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
          }
          pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
        />
      </OpsSurface>

      <OpsModalShell
        title={editingTarget ? "编辑 ConfigMap" : "添加 ConfigMap"}
        description="配置 ConfigMap 的作用域、标签和键值对数据。"
        identity={editingTarget?.name ?? "ConfigMap"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          setEditingTarget(null);
          setCreateYaml("");
          form.resetFields();
        }}
        okText={editingTarget ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={createMutation.isPending || updateMutation.isPending || editLoading || applyYamlMutation.isPending}
        destroyOnHidden
        width={720}
      >
        {editingTarget ? (
          <Form className="config-resource-form" form={form} layout="vertical">
            <Form.Item
              label="名称"
              name="name"
              rules={[{ required: true, message: "请输入 ConfigMap 名称" }]}
            >
              <Input disabled placeholder="例如：app-config" />
            </Form.Item>
            <Form.Item
              label="名称空间"
              name="namespace"
              rules={[{ required: true, message: "请输入名称空间" }]}
            >
              <Input disabled placeholder="例如：default" />
            </Form.Item>
            <Form.Item
              label="所属集群"
              name="clusterId"
              rules={[{ required: true, message: "请选择集群" }]}
            >
              <Select
                placeholder="请选择集群"
                options={clusterOptions}
                loading={clustersQuery.isLoading}
                disabled
              />
            </Form.Item>
            <Form.Item label="标签">
              <Form.List name="labelEntries" initialValue={[{ key: "", value: "" }]}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                        <Col flex="1">
                          <Form.Item {...restField} name={[name, "key"]} style={{ marginBottom: 0 }}>
                            <Input placeholder="标签键（Key）" />
                          </Form.Item>
                        </Col>
                        <Col flex="1">
                          <Form.Item {...restField} name={[name, "value"]} style={{ marginBottom: 0 }}>
                            <Input placeholder="标签值（Value）" />
                          </Form.Item>
                        </Col>
                        <Col>
                          <Button
                            type="text"
                            danger
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(name)}
                            disabled={fields.length === 1}
                          />
                        </Col>
                      </Row>
                    ))}
                    <Button
                      type="dashed"
                      onClick={() => add({ key: "", value: "" })}
                      icon={<PlusOutlined />}
                      style={{ width: "100%" }}
                    >
                      添加标签
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
            <Form.Item label="键值对数据">
              <Form.List name="entries" initialValue={[{ key: "", value: "" }]}>
                {(fields, { add, remove }) => (
                  <>
                    {fields.map(({ key, name, ...restField }) => (
                      <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                        <Col flex="1">
                          <Form.Item
                            {...restField}
                            name={[name, "key"]}
                            style={{ marginBottom: 0 }}
                            rules={[{ required: true, message: "请输入键名" }]}
                          >
                            <Input placeholder="键（Key）" />
                          </Form.Item>
                        </Col>
                        <Col flex="1">
                          <Form.Item
                            {...restField}
                            name={[name, "value"]}
                            style={{ marginBottom: 0 }}
                          >
                            <Input placeholder="值（Value）" />
                          </Form.Item>
                        </Col>
                        <Col>
                          <Button
                            type="text"
                            danger
                            icon={<MinusCircleOutlined />}
                            onClick={() => remove(name)}
                            disabled={fields.length === 1}
                          />
                        </Col>
                      </Row>
                    ))}
                    <Button
                      type="dashed"
                      onClick={() => add({ key: "", value: "" })}
                      icon={<PlusOutlined />}
                      style={{ width: "100%" }}
                    >
                      添加键值对
                    </Button>
                  </>
                )}
              </Form.List>
            </Form.Item>
          </Form>
        ) : (
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
            kindHint="ConfigMap"
            disabled={createMutation.isPending || applyYamlMutation.isPending}
            formContent={(
              <Form className="config-resource-form" form={form} layout="vertical">
          <Form.Item
            label="名称"
            name="name"
            rules={[{ required: true, message: "请输入 ConfigMap 名称" }]}
          >
            <Input disabled={Boolean(editingTarget)} placeholder="例如：app-config" />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input disabled={Boolean(editingTarget)} placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            label="所属集群"
            name="clusterId"
            rules={[{ required: true, message: "请选择集群" }]}
          >
            <Select
              placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
              options={clusterOptions}
              loading={clustersQuery.isLoading}
              disabled={clusterUnavailable || (!clustersQuery.isLoading && clusterOptions.length === 0)}
              notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item label="标签">
            <Form.List name="labelEntries" initialValue={[{ key: "", value: "" }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                      <Col flex="1">
                        <Form.Item {...restField} name={[name, "key"]} style={{ marginBottom: 0 }}>
                          <Input placeholder="标签键（Key）" />
                        </Form.Item>
                      </Col>
                      <Col flex="1">
                        <Form.Item {...restField} name={[name, "value"]} style={{ marginBottom: 0 }}>
                          <Input placeholder="标签值（Value）" />
                        </Form.Item>
                      </Col>
                      <Col>
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                          disabled={fields.length === 1}
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ key: "", value: "" })}
                    icon={<PlusOutlined />}
                    style={{ width: "100%" }}
                  >
                    添加标签
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
          <Form.Item label="键值对数据">
            <Form.List name="entries" initialValue={[{ key: "", value: "" }]}>
              {(fields, { add, remove }) => (
                <>
                  {fields.map(({ key, name, ...restField }) => (
                    <Row key={key} gutter={8} style={{ marginBottom: 8 }}>
                      <Col flex="1">
                        <Form.Item
                          {...restField}
                          name={[name, "key"]}
                          style={{ marginBottom: 0 }}
                          rules={[{ required: true, message: "请输入键名" }]}
                        >
                          <Input placeholder="键（Key）" />
                        </Form.Item>
                      </Col>
                      <Col flex="1">
                        <Form.Item
                          {...restField}
                          name={[name, "value"]}
                          style={{ marginBottom: 0 }}
                        >
                          <Input placeholder="值（Value）" />
                        </Form.Item>
                      </Col>
                      <Col>
                        <Button
                          type="text"
                          danger
                          icon={<MinusCircleOutlined />}
                          onClick={() => remove(name)}
                          disabled={fields.length === 1}
                        />
                      </Col>
                    </Row>
                  ))}
                  <Button
                    type="dashed"
                    onClick={() => add({ key: "", value: "" })}
                    icon={<PlusOutlined />}
                    style={{ width: "100%" }}
                  >
                    添加键值对
                  </Button>
                </>
              )}
            </Form.List>
          </Form.Item>
              </Form>
            )}
          />
        )}
      </OpsModalShell>
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
        identity={yamlTarget}
        token={accessToken ?? undefined}
        onUpdated={() => {
          void message.success("YAML 更新成功");
          void refetch();
        }}
      />
    </Space>
  );
}
