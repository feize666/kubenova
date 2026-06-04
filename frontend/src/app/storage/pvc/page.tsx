"use client";

import {
  DeleteOutlined,
  ExpandOutlined,
  FileTextOutlined,
  LinkOutlined,
} from "@ant-design/icons";
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
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceTable } from "@/components/resource-table";
import { OpsStatusTag } from "@/components/ops";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import {
  buildResourceActionMenuItems,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import {
  bindPersistentVolumeClaim,
  createStorageResource,
  deleteStorageResource,
  getStorageResources,
  resizePersistentVolumeClaim,
  type CreateStorageResourcePayload,
  type StorageResource,
} from "@/lib/api/storage";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { ResourceClusterNamespaceFilters } from "@/components/resource-cluster-namespace-filters";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
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

function pvcStatusTag(resource: StorageResource) {
  const phase = normalizePhase(readPhase(resource));
  if (phase === "bound") return <OpsStatusTag tone="success">Bound</OpsStatusTag>;
  if (phase === "pending") return <OpsStatusTag tone="warning">Pending</OpsStatusTag>;
  if (phase === "lost") return <OpsStatusTag tone="danger">Lost</OpsStatusTag>;
  if (phase === "terminating") return <OpsStatusTag tone="warning">Terminating</OpsStatusTag>;
  if (phase === "released") return <OpsStatusTag tone="neutral">Released</OpsStatusTag>;
  return <OpsStatusTag tone="neutral">{readPhase(resource) || "-"}</OpsStatusTag>;
}

function getTextFilter(filters: HeadlampTableFilters, key: string) {
  const value = filters[key];
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textMatches(value: unknown, filterValue: string) {
  return !filterValue || String(value ?? "").toLowerCase().includes(filterValue);
}

function readSpecString(resource: StorageResource, key: string) {
  if (!resource.spec || typeof resource.spec !== "object" || Array.isArray(resource.spec)) {
    return "";
  }
  const value = resource.spec[key];
  return typeof value === "string" ? value : "";
}

interface PvcFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  capacity: string;
  storageClass: string;
}

interface PvcResizeFormValues {
  capacity: string;
}

interface PvcBindFormValues {
  volumeName: string;
}

export default function PvcPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
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
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [resizeTarget, setResizeTarget] = useState<StorageResource | null>(null);
  const [bindTarget, setBindTarget] = useState<StorageResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<PvcFormValues>();
  const [resizeForm] = Form.useForm<PvcResizeFormValues>();
  const [bindForm] = Form.useForm<PvcBindFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "storage",
      "PVC",
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
      getStorageResources(
        {
          kind: "PVC",
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
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
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name])),
    [clustersQuery.data],
  );

  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((i) => i.namespace).filter((ns): ns is string => Boolean(ns)))),
    [data],
  );

  const createMutation = useMutation({
    mutationFn: (payload: CreateStorageResourcePayload) =>
      createStorageResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("PVC 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "PVC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const resizeMutation = useMutation({
    mutationFn: (values: PvcResizeFormValues) => {
      if (!resizeTarget) {
        throw new Error("未选择 PVC");
      }
      return resizePersistentVolumeClaim(
        {
          clusterId: resizeTarget.clusterId,
          namespace: resizeTarget.namespace || "default",
          name: resizeTarget.name,
          capacity: values.capacity,
        },
        accessToken || undefined,
      );
    },
    onSuccess: async () => {
      void message.success("PVC 扩容更新成功");
      setResizeTarget(null);
      resizeForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "PVC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "扩容更新失败，请重试");
    },
  });

  const bindMutation = useMutation({
    mutationFn: (values: PvcBindFormValues) => {
      if (!bindTarget) {
        throw new Error("未选择 PVC");
      }
      return bindPersistentVolumeClaim(
        {
          clusterId: bindTarget.clusterId,
          namespace: bindTarget.namespace || "default",
          name: bindTarget.name,
          volumeName: values.volumeName,
        },
        accessToken || undefined,
      );
    },
    onSuccess: async () => {
      void message.success("PVC 绑定更新成功");
      setBindTarget(null);
      bindForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "PVC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "绑定更新失败，请重试");
    },
  });

  const handleModalSubmit = async () => {
    let values: PvcFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "PVC",
      name: values.name,
      capacity: values.capacity,
      storageClass: values.storageClass,
    });
  };

  const handleOpenResize = (row: StorageResource) => {
    setResizeTarget(row);
    resizeForm.setFieldsValue({ capacity: row.capacity ?? "" });
  };

  const handleResizeSubmit = async () => {
    let values: PvcResizeFormValues;
    try {
      values = await resizeForm.validateFields();
    } catch {
      return;
    }
    resizeMutation.mutate(values);
  };

  const handleOpenBind = (row: StorageResource) => {
    setBindTarget(row);
    bindForm.setFieldsValue({ volumeName: readSpecString(row, "volumeName") });
  };

  const handleBindSubmit = async () => {
    let values: PvcBindFormValues;
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

  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          matchLabelExpressions(item.labels, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(item.namespace, getTextFilter(tableFilters, "namespace")) &&
          textMatches(item.capacity, getTextFilter(tableFilters, "capacity")) &&
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
    namespace,
    keyword,
    path: "/storage/pvc",
  });

  const handleOpenCreate = () => {
    form.resetFields();
    setModalOpen(true);
  };

  const columns: HeadlampResourceTableColumn<StorageResource>[] = [
    {
      title: "声明名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: StorageResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "PersistentVolumeClaim", id: row.id })}>
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
      render: (_: unknown, row: StorageResource) =>
        getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      filter: { type: "text", placeholder: "名称空间" },
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", isLoading && !data),
    },
    {
      title: "申请容量",
      dataIndex: "capacity",
      key: "capacity",
      filter: { type: "text", placeholder: "容量" },
      width: TABLE_COL_WIDTH.capacity,
      ...getSortableColumnProps("capacity", isLoading && !data),
    },
    {
      title: "存储类",
      dataIndex: "storageClass",
      key: "storageClass",
      filter: { type: "text", placeholder: "存储类" },
      width: TABLE_COL_WIDTH.storageClass,
      ...getSortableColumnProps("storageClass", isLoading && !data),
    },
    {
      title: "绑定状态",
      key: "state",
      filter: { type: "text", placeholder: "状态" },
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: StorageResource) => pvcStatusTag(row),
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
      width: 110,
      fixed: "right",
      render: (_: unknown, row: StorageResource) => {
        const items: MenuProps["items"] = buildResourceActionMenuItems([
          { key: "expand", icon: <ExpandOutlined />, label: "扩容" },
          { key: "bind", icon: <LinkOutlined />, label: "绑定" },
          { key: "yaml", icon: <FileTextOutlined />, label: "YAML" },
          { type: "divider" },
          { key: "delete", icon: <DeleteOutlined />, label: "删除", danger: true },
        ]);
        const identity = {
          clusterId: row.clusterId,
          namespace: row.namespace || "default",
          kind: "PersistentVolumeClaim",
          name: row.name,
        };
        return (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            classNames={{ root: POD_ACTION_MENU_CLASS }}
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === "expand") {
                  handleOpenResize(row);
                  return;
                }
                if (key === "bind") {
                  handleOpenBind(row);
                  return;
                }
                if (key === "yaml") {
                  setYamlTarget(identity);
                  return;
                }
                Modal.confirm({
                  title: "删除 PVC",
                  content: `确认删除 PVC「${row.name}」吗？此操作不可恢复。`,
                  okText: "确认删除",
                  cancelText: "取消",
                  okButtonProps: { danger: true },
                  onOk: async () => {
                    await deleteStorageResource(row.id, accessToken || undefined);
                    void message.success("PVC 删除成功");
                    await queryClient.invalidateQueries({ queryKey: ["storage", "PVC"] });
                  },
                });
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
        path="/storage/pvc"
        titleSuffix={<ResourceAddButton title="创建PVC" onClick={handleOpenCreate} />}
      />

      <Card>
        <ResourceClusterNamespaceFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterFilterOptions}
          clusterLoading={clustersQuery.isLoading}
          knownNamespaces={knownNamespaces}
          namespaceDisabled={namespaceDisabled}
          namespacePlaceholder={namespacePlaceholder}
          onClusterChange={(value) => {
            onClusterChange(value);
            resetPage();
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            resetPage();
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：pvc-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 16 }} />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="持久卷声明加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <ResourceTable<StorageResource>
          rowKey="id"
          columns={columns}
          tableKey="storage.pvc"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "按名称/标签搜索（示例：pvc-a app=web env=prod）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{ sortBy, sortOrder }}
          dataSource={tableData}
          layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 }, actionWidth: 110 }}
          loading={isLoading && !data}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
          }
          pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
        />
      </Card>

      <Modal
        title="添加 PVC"
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
            label="声明名称"
            name="name"
            rules={[{ required: true, message: "请输入 PVC 名称" }]}
          >
            <Input placeholder="例如：my-pvc" />
          </Form.Item>
          <Form.Item
            label="名称空间"
            name="namespace"
            rules={[{ required: true, message: "请输入名称空间" }]}
          >
            <Input placeholder="例如：default" />
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
            label="申请容量"
            name="capacity"
            rules={[{ required: true, message: "请输入申请容量" }]}
          >
            <Input placeholder="例如：10Gi" />
          </Form.Item>
          <Form.Item
            label="存储类"
            name="storageClass"
            rules={[{ required: true, message: "请输入存储类" }]}
          >
            <Input placeholder="例如：standard" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`扩容 PVC · ${resizeTarget?.name ?? ""}`}
        open={Boolean(resizeTarget)}
        onOk={() => void handleResizeSubmit()}
        onCancel={() => {
          setResizeTarget(null);
          resizeForm.resetFields();
        }}
        okText="提交"
        cancelText="取消"
        confirmLoading={resizeMutation.isPending}
        destroyOnHidden
      >
        <Form form={resizeForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item
            label="目标容量"
            name="capacity"
            rules={[{ required: true, message: "请输入目标容量" }]}
          >
            <Input placeholder="例如：20Gi" />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`绑定 PVC · ${bindTarget?.name ?? ""}`}
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
            label="PV 名称"
            name="volumeName"
            rules={[{ required: true, message: "请输入 PV 名称" }]}
          >
            <Input placeholder="例如：my-pv-001" />
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
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
