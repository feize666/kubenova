"use client";

import { DeleteOutlined, FileTextOutlined, LinkOutlined, ArrowsAltOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Dropdown,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Tag,
  Typography,
  message,
} from "antd";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceTable } from "@/components/resource-table";
import {
  buildResourceActionMenuItems,
  matchLabelExpressions,
  parseResourceSearchInput,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  openResourceActionConfirm,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
  type ResourceMenuItem,
} from "@/components/resource-action-bar";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import {
  bindPersistentVolume,
  createStorageResource,
  deleteStorageResource,
  getStorageResources,
  type CreateStorageResourcePayload,
  type StorageResource,
} from "@/lib/api/storage";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { ResourceClusterNamespaceFilters } from "@/components/resource-cluster-namespace-filters";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { useAntdTableSortPagination, type HeadlampResourceTableColumn, type HeadlampTableFilters } from "@/lib/table";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

function normalizePhase(value?: string) {
  return value?.trim().toLowerCase() ?? "";
}

function readPhase(resource: StorageResource) {
  const status = resource.statusJson;
  if (status && typeof status === "object" && !Array.isArray(status)) {
    const phase = (status as Record<string, unknown>).phase;
    if (typeof phase === "string" && phase.trim()) {
      return phase.trim();
    }
  }
  if (resource.bindingMode) {
    return resource.bindingMode.trim();
  }
  return "";
}

function pvStatusTag(resource: StorageResource) {
  const phase = normalizePhase(readPhase(resource));
  if (phase === "bound") return <Tag color="green">Bound</Tag>;
  if (phase === "available") return <Tag color="blue">Available</Tag>;
  if (phase === "released") return <Tag color="gold">Released</Tag>;
  if (phase === "failed") return <Tag color="red">Failed</Tag>;
  if (phase === "pending") return <Tag color="orange">Pending</Tag>;
  if (phase === "terminating") return <Tag color="default">Terminating</Tag>;
  return <Tag color="default">{readPhase(resource) || "-"}</Tag>;
}

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function readClaimRef(resource: StorageResource) {
  const claimRef =
    resource.spec &&
    typeof resource.spec === "object" &&
    !Array.isArray(resource.spec) &&
    typeof resource.spec.claimRef === "object" &&
    resource.spec.claimRef &&
    !Array.isArray(resource.spec.claimRef)
      ? (resource.spec.claimRef as Record<string, unknown>)
      : null;

  return {
    namespace: typeof claimRef?.namespace === "string" ? claimRef.namespace : "default",
    name: typeof claimRef?.name === "string" ? claimRef.name : "",
  };
}

interface PvFormValues {
  name: string;
  clusterId: string;
  capacity: string;
  accessModes: string[];
  storageClass: string;
}

interface PvBindFormValues {
  claimNamespace: string;
  claimName: string;
}

const ACCESS_MODE_OPTIONS = [
  { label: "ReadWriteOnce (RWO)", value: "ReadWriteOnce" },
  { label: "ReadOnlyMany (ROX)", value: "ReadOnlyMany" },
  { label: "ReadWriteMany (RWX)", value: "ReadWriteMany" },
];

export default function PvPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, onClusterChange } = useClusterNamespaceFilter(initialClusterId);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<StorageResource>({
    defaultPageSize: 10,
  });

  const [modalOpen, setModalOpen] = useState(false);
  const [bindTarget, setBindTarget] = useState<StorageResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [form] = Form.useForm<PvFormValues>();
  const [bindForm] = Form.useForm<PvBindFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "storage",
      "PV",
      {
        clusterId,
        keyword,
        page: pagination.pageIndex + 1,
        pageSize: pagination.pageSize,
        sortBy,
        sortOrder,
      },
      accessToken,
    ],
    queryFn: () =>
      getStorageResources(
        {
          kind: "PV",
          clusterId: clusterId || undefined,
          keyword: keyword.trim() || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken || undefined,
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
    mutationFn: (payload: CreateStorageResourcePayload) =>
      createStorageResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("PV 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "PV"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStorageResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("PV 删除成功");
      await queryClient.invalidateQueries({ queryKey: ["storage", "PV"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const bindMutation = useMutation({
    mutationFn: (values: PvBindFormValues) => {
      if (!bindTarget) {
        throw new Error("未选择 PV");
      }
      return bindPersistentVolume(
        {
          clusterId: bindTarget.clusterId,
          namespace: bindTarget.namespace || "default",
          name: bindTarget.name,
          claimNamespace: values.claimNamespace,
          claimName: values.claimName,
        },
        accessToken || undefined,
      );
    },
    onSuccess: async () => {
      void message.success("PV 绑定更新成功");
      setBindTarget(null);
      bindForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "PV"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "绑定更新失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: PvFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      kind: "PV",
      name: values.name,
      capacity: values.capacity,
      accessModes: values.accessModes,
      storageClass: values.storageClass,
    });
  };

  const handleOpenBind = (row: StorageResource) => {
    const claimRef = readClaimRef(row);
    setBindTarget(row);
    bindForm.setFieldsValue({
      claimNamespace: claimRef.namespace,
      claimName: claimRef.name,
    });
  };

  const handleBindSubmit = async () => {
    let values: PvBindFormValues;
    try {
      values = await bindForm.validateFields();
    } catch {
      return;
    }
    bindMutation.mutate(values);
  };

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));

  const clusterMap = Object.fromEntries(
    (clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]),
  );

  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          hasKnownCluster(clusterMap, item.clusterId) &&
          matchLabelExpressions(item.labels, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.capacity, getTextFilter(tableFilters, "capacity")) &&
          textMatches(item.accessModes?.join(", "), getTextFilter(tableFilters, "accessModes")) &&
          textMatches(item.storageClass, getTextFilter(tableFilters, "storageClass")) &&
          textMatches(readPhase(item), getTextFilter(tableFilters, "state")),
      ),
    [clusterMap, data?.items, mergedFilters, tableFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({
    clusterId,
    namespace: "",
    keyword,
    path: "/storage/pv",
  });

  const columns: HeadlampResourceTableColumn<StorageResource>[] = [
    {
      title: "卷名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: StorageResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "PersistentVolume", id: row.id })}>
            {name}
          </Typography.Link>
        ) : (
          name
        ),
    },
    {
      title: "集群",
      key: "clusterId",
      filter: { type: "text", placeholder: "集群" },
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, record: StorageResource) =>
        getClusterDisplayName(clusterMap, record.clusterId),
    },
    {
      title: "容量",
      dataIndex: "capacity",
      key: "capacity",
      filter: { type: "text", placeholder: "容量" },
      width: TABLE_COL_WIDTH.capacity,
      ...getSortableColumnProps("capacity", isLoading && !data),
      render: (v: string | undefined) => v ?? "-",
    },
    {
      title: "访问模式",
      dataIndex: "accessModes",
      key: "accessModes",
      filter: { type: "text", placeholder: "访问模式" },
      width: TABLE_COL_WIDTH.type,
      render: (value: string[] | undefined) =>
        value && value.length > 0
          ? value.map((m) => (
              <Tag key={m} color="blue">
                {m}
              </Tag>
            ))
          : "-",
    },
    {
      title: "存储类",
      dataIndex: "storageClass",
      key: "storageClass",
      filter: { type: "text", placeholder: "存储类" },
      width: TABLE_COL_WIDTH.storageClass,
      ...getSortableColumnProps("storageClass", isLoading && !data),
      render: (v: string | undefined) => v ?? "-",
    },
    {
      title: "状态",
      key: "state",
      filter: { type: "text", placeholder: "状态" },
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: StorageResource) => pvStatusTag(row),
    },
    {
      title: "创建时间",
      dataIndex: "createdAt",
      key: "createdAt",
      width: TABLE_COL_WIDTH.time,
      ...getSortableColumnProps("createdAt", isLoading && !data),
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      required: true,
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row: StorageResource) => {
        const items: ResourceMenuItem[] = [
          { key: "expand", icon: <ArrowsAltOutlined />, label: "扩容" },
          { key: "bind", icon: <LinkOutlined />, label: "绑定" },
          { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
          { type: "divider" },
          { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
        ];
        const menuItems = buildResourceActionMenuItems(items);
        return (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            classNames={{ root: POD_ACTION_MENU_CLASS }}
            menu={{
              items: menuItems,
              onClick: ({ key }) => {
                if (key === "expand") {
                  void message.info("请在 YAML 中调整容量字段完成 PV 扩容。");
                  setYamlTarget({
                    clusterId: row.clusterId,
                    namespace: row.namespace || "default",
                    kind: "PersistentVolume",
                    name: row.name,
                  });
                  return;
                }
                if (key === "bind") {
                  handleOpenBind(row);
                  return;
                }
                if (key === "yaml") {
                  setYamlTarget({
                    clusterId: row.clusterId,
                    namespace: row.namespace || "default",
                    kind: "PersistentVolume",
                    name: row.name,
                  });
                  return;
                }
                openResourceActionConfirm(
                  {
                    title: "删除 PV",
                    description: `确认删除 PV「${row.name}」吗？此操作不可恢复。`,
                    okText: "确认删除",
                    cancelText: "取消",
                    okDanger: true,
                  },
                  () => deleteMutation.mutate(row.id),
                );
              },
            }}
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

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/storage/pv"
        titleSuffix={<ResourceAddButton title="创建PV" onClick={() => { form.resetFields(); setModalOpen(true); }} />}
      />

      <Card>
        <ResourceClusterNamespaceFilters
          clusterId={clusterId}
          keywordInput={keywordInput}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          namespaceVisible={false}
          onClusterChange={(value) => {
            onClusterChange(value);
            resetPage();
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：pv-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert
            type="warning"
            showIcon
            message="未检测到登录状态，请先登录后再操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="持久卷加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <ResourceTable<StorageResource>
          rowKey="id"
          columns={columns}
          tableKey="storage.pv"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按名称/标签搜索（示例：pv-a app=web env=prod）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{ sortBy, sortOrder }}
          dataSource={tableData}
          layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 } }}
          loading={isLoading && !data}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
          }
          pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
        />
      </Card>

      <Modal
        title="添加 PV"
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="卷名称"
            name="name"
            rules={[{ required: true, message: "请输入 PV 名称" }]}
          >
            <Input placeholder="例如：my-pv-001" />
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
              showSearch
              filterOption={(input, option) =>
                (option?.label ?? "").toLowerCase().includes(input.toLowerCase())
              }
            />
          </Form.Item>
          <Form.Item
            label="容量"
            name="capacity"
            rules={[{ required: true, message: "请输入容量，例如 10Gi" }]}
          >
            <Input placeholder="例如：10Gi" />
          </Form.Item>
          <Form.Item
            label="访问模式"
            name="accessModes"
            rules={[{ required: true, message: "请至少选择一种访问模式" }]}
          >
            <Select
              mode="multiple"
              placeholder="请选择访问模式"
              options={ACCESS_MODE_OPTIONS}
            />
          </Form.Item>
          <Form.Item
            label="存储类（StorageClass）"
            name="storageClass"
          >
            <Input placeholder="例如：standard" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`绑定 PV · ${bindTarget?.name ?? ""}`}
        open={Boolean(bindTarget)}
        onOk={() => void handleBindSubmit()}
        onCancel={() => {
          setBindTarget(null);
          bindForm.resetFields();
        }}
        okText="提交"
        cancelText="取消"
        confirmLoading={bindMutation.isPending}
        destroyOnHidden
      >
        <Form form={bindForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="PVC 名称空间"
            name="claimNamespace"
            rules={[{ required: true, message: "请输入 PVC 名称空间" }]}
          >
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item
            label="PVC 名称"
            name="claimName"
            rules={[{ required: true, message: "请输入 PVC 名称" }]}
          >
            <Input placeholder="例如：my-pvc" />
          </Form.Item>
        </Form>
      </Modal>
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
      {renderPodLikeResourceActionStyles({ triggerClassName: POD_ACTION_TRIGGER_CLASS, menuClassName: POD_ACTION_MENU_CLASS })}
    </Space>
  );
}
