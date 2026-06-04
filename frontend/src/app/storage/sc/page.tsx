"use client";

import {
  DeleteOutlined,
  FileTextOutlined,
  SettingOutlined,
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
import { useSearchParams } from "next/navigation";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceTable } from "@/components/resource-table";
import { OpsFilterChip, OpsStatusTag } from "@/components/ops";
import {
  buildResourceActionMenuItems,
  matchLabelExpressions,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  openResourceActionConfirm,
  parseResourceSearchInput,
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
  createStorageResource,
  deleteStorageResource,
  getStorageResources,
  updateStorageClassMutableFields,
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

interface ScFormValues {
  name: string;
  clusterId: string;
  provisioner: string;
  bindingMode: string;
  allowVolumeExpansion: "true" | "false";
}

interface ScEditFormValues {
  name: string;
  provisioner: string;
  bindingMode: string;
  reclaimPolicy: string;
  allowVolumeExpansion: "true" | "false";
}

function defaultTag(isDefault: boolean) {
  return isDefault ? <OpsStatusTag tone="success">默认</OpsStatusTag> : <OpsFilterChip tone="neutral">普通</OpsFilterChip>;
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

function readAllowVolumeExpansion(resource: StorageResource) {
  return Boolean(
    resource.spec &&
      typeof resource.spec === "object" &&
      !Array.isArray(resource.spec) &&
      (resource.spec as { allowVolumeExpansion?: boolean }).allowVolumeExpansion,
  );
}

export default function StorageClassPage() {
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
  const [editTarget, setEditTarget] = useState<StorageResource | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [form] = Form.useForm<ScFormValues>();
  const [editForm] = Form.useForm<ScEditFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "storage",
      "SC",
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
          kind: "SC",
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
  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({ label: c.name, value: c.id }));
  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name]));

  const tableData = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) =>
          matchLabelExpressions(item.labels, mergedFilters) &&
          textMatches(item.name, getTextFilter(tableFilters, "name")) &&
          textMatches(getClusterDisplayName(clusterMap, item.clusterId), getTextFilter(tableFilters, "clusterId")) &&
          textMatches(
            typeof item.spec === "object" && item.spec && typeof (item.spec as { provisioner?: unknown }).provisioner === "string"
              ? (item.spec as { provisioner: string }).provisioner
              : "-",
            getTextFilter(tableFilters, "provisioner"),
          ) &&
          textMatches(item.bindingMode, getTextFilter(tableFilters, "bindingMode")) &&
          textMatches(
            typeof item.spec === "object" &&
              item.spec &&
              (item.spec as { allowVolumeExpansion?: boolean }).allowVolumeExpansion
              ? "允许"
              : "不允许",
            getTextFilter(tableFilters, "allowVolumeExpansion"),
          ) &&
          textMatches(
            typeof item.statusJson === "object" &&
              item.statusJson &&
              (item.statusJson as { isDefault?: boolean }).isDefault
              ? "默认"
              : "普通",
            getTextFilter(tableFilters, "isDefault"),
          ),
      ),
    [clusterMap, data?.items, mergedFilters, tableFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const createMutation = useMutation({
    mutationFn: (payload: CreateStorageResourcePayload) =>
      createStorageResource(payload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("StorageClass 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "SC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteStorageResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("StorageClass 删除成功");
      await queryClient.invalidateQueries({ queryKey: ["storage", "SC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const editMutation = useMutation({
    mutationFn: (values: ScEditFormValues) => {
      if (!editTarget) {
        throw new Error("未选择 StorageClass");
      }
      return updateStorageClassMutableFields(
        {
          clusterId: editTarget.clusterId,
          namespace: "default",
          name: editTarget.name,
          allowVolumeExpansion: values.allowVolumeExpansion === "true",
        },
        accessToken || undefined,
      );
    },
    onSuccess: async () => {
      void message.success("StorageClass 更新成功");
      setEditTarget(null);
      editForm.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["storage", "SC"] });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "更新失败，请重试");
    },
  });

  const handleOpenEdit = (row: StorageResource) => {
    setEditTarget(row);
    editForm.setFieldsValue({
      name: row.name,
      provisioner: readSpecString(row, "provisioner"),
      bindingMode: row.bindingMode ?? readSpecString(row, "volumeBindingMode"),
      reclaimPolicy: readSpecString(row, "reclaimPolicy"),
      allowVolumeExpansion: readAllowVolumeExpansion(row) ? "true" : "false",
    });
  };

  const handleEditSubmit = async () => {
    let values: ScEditFormValues;
    try {
      values = await editForm.validateFields();
    } catch {
      return;
    }
    editMutation.mutate(values);
  };

  const columns: HeadlampResourceTableColumn<StorageResource>[] = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      required: true,
      filter: { type: "text", placeholder: "名称" },
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: StorageResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "StorageClass", id: row.id })}>
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
      render: (_: unknown, row) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "Provisioner",
      key: "provisioner",
      filter: { type: "text", placeholder: "Provisioner" },
      width: TABLE_COL_WIDTH.image,
      ...getSortableColumnProps("provisioner", isLoading && !data),
      render: (_: unknown, row) =>
        typeof row.spec === "object" && row.spec && typeof (row.spec as { provisioner?: unknown }).provisioner === "string"
          ? (row.spec as { provisioner: string }).provisioner
          : "-",
    },
    {
      title: "绑定模式",
      dataIndex: "bindingMode",
      key: "bindingMode",
      filter: { type: "text", placeholder: "绑定模式" },
      width: TABLE_COL_WIDTH.schedule,
      ...getSortableColumnProps("bindingMode", isLoading && !data),
      render: (v: string | undefined) => v ?? "-",
    },
    {
      title: "扩容",
      key: "allowVolumeExpansion",
      filter: { type: "text", placeholder: "扩容" },
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row) => {
        const allow = Boolean(
          typeof row.spec === "object" &&
            row.spec &&
            (row.spec as { allowVolumeExpansion?: boolean }).allowVolumeExpansion,
        );
        return allow ? <OpsStatusTag tone="info">允许</OpsStatusTag> : <OpsFilterChip tone="neutral">不允许</OpsFilterChip>;
      },
    },
    {
      title: "默认",
      key: "isDefault",
      filter: { type: "text", placeholder: "默认" },
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row) => {
        const isDefault = Boolean(
          typeof row.statusJson === "object" &&
            row.statusJson &&
            (row.statusJson as { isDefault?: boolean }).isDefault,
        );
        return defaultTag(isDefault);
      },
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
        const actions: ResourceMenuItem[] = [
          {
            key: "edit",
            icon: <SettingOutlined />,
            label: "编辑",
            onClick: () => {
              handleOpenEdit(row);
            },
          },
          {
            key: "yaml",
            icon: <FileTextOutlined />,
            label: "YAML",
            onClick: () => {
              setYamlTarget({
                clusterId: row.clusterId,
                namespace: "default",
                kind: "StorageClass",
                name: row.name,
              });
            },
          },
          { type: "divider" },
          {
            key: "delete",
            icon: <DeleteOutlined />,
            label: "删除",
            danger: true,
            confirm: {
              title: "删除 StorageClass",
              description: `确认删除 StorageClass「${row.name}」吗？`,
              okText: "确认删除",
              cancelText: "取消",
              okDanger: true,
            },
            onClick: () => deleteMutation.mutate(row.id),
          },
        ];
        const items = buildResourceActionMenuItems(actions);
        return (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
            menu={{
              items,
              onClick: ({ key }) => {
                const action = actions.find((item) => item.key === key);
                if (!action || action.disabled) {
                  return;
                }
                if (action.confirm) {
                  if (!action.onClick) {
                    return;
                  }
                  openResourceActionConfirm(action.confirm, action.onClick);
                  return;
                }
                action.onClick?.();
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

  const handleCreate = async () => {
    let values: ScFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }
    createMutation.mutate({
      clusterId: values.clusterId,
      kind: "SC",
      name: values.name,
      bindingMode: values.bindingMode,
      storageClass: values.name,
      spec: {
        provisioner: values.provisioner,
        allowVolumeExpansion: values.allowVolumeExpansion === "true",
      },
    });
  };

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
    path: "/storage/sc",
  });

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/storage/sc"
        titleSuffix={<ResourceAddButton title="创建StorageClass" onClick={() => setModalOpen(true)} />}
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
          keywordPlaceholder="按名称/标签搜索（示例：sc-fast tier=prod）"
        />
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再查看 StorageClass 信息。" />
      ) : null}
      {isError ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={error instanceof Error ? error.message : "获取 StorageClass 数据时发生错误"}
        />
      ) : null}

      <Card>
          <ResourceTable<StorageResource>
            rowKey="id"
            columns={columns}
            tableKey="storage.sc"
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
            globalSearch={{
              value: keywordInput,
              onChange: handleGlobalSearchChange,
              placeholder: "按名称/标签搜索（示例：sc-a app=web env=prod）",
            }}
            filters={tableFilters}
            onFiltersChange={(nextFilters) => {
              setTableFilters(nextFilters);
              resetPage();
            }}
            sort={{ sortBy, sortOrder }}
            dataSource={tableData}
            bordered={false}
            layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 } }}
            loading={isLoading && !data}
            onChange={(nextPagination, filters, sorter, extra) =>
              handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
            }
            pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
          />
      </Card>

      {renderPodLikeResourceActionStyles({ triggerClassName: POD_ACTION_TRIGGER_CLASS, menuClassName: POD_ACTION_MENU_CLASS })}

      <Modal
        title="添加 StorageClass"
        open={modalOpen}
        onCancel={() => {
          setModalOpen(false);
          form.resetFields();
        }}
        onOk={() => void handleCreate()}
        confirmLoading={createMutation.isPending}
        okText="创建"
        cancelText="取消"
      >
        <Form form={form} layout="vertical">
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入 SC 名称" }]}>
            <Input placeholder="例如：fast-ssd" />
          </Form.Item>
          <Form.Item label="集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <Select options={clusterOptions} placeholder="请选择集群" />
          </Form.Item>
          <Form.Item label="Provisioner" name="provisioner" rules={[{ required: true, message: "请输入 provisioner" }]}>
            <Input placeholder="例如：kubernetes.io/no-provisioner" />
          </Form.Item>
          <Form.Item label="绑定模式" name="bindingMode" initialValue="WaitForFirstConsumer">
            <Select
              options={[
                { label: "WaitForFirstConsumer", value: "WaitForFirstConsumer" },
                { label: "Immediate", value: "Immediate" },
              ]}
            />
          </Form.Item>
          <Form.Item label="允许扩容" name="allowVolumeExpansion" initialValue="false">
            <Select
              options={[
                { label: "否", value: "false" },
                { label: "是", value: "true" },
              ]}
            />
          </Form.Item>
        </Form>
      </Modal>
      <Modal
        title={`编辑 StorageClass · ${editTarget?.name ?? ""}`}
        open={Boolean(editTarget)}
        onCancel={() => {
          setEditTarget(null);
          editForm.resetFields();
        }}
        onOk={() => void handleEditSubmit()}
        confirmLoading={editMutation.isPending}
        okText="提交"
        cancelText="取消"
        destroyOnHidden
      >
        <Form form={editForm} layout="vertical">
          <Form.Item label="名称" name="name">
            <Input disabled />
          </Form.Item>
          <Form.Item label="Provisioner" name="provisioner">
            <Input disabled />
          </Form.Item>
          <Form.Item label="绑定模式" name="bindingMode">
            <Input disabled />
          </Form.Item>
          <Form.Item label="回收策略" name="reclaimPolicy">
            <Input disabled />
          </Form.Item>
          <Form.Item label="允许扩容" name="allowVolumeExpansion" rules={[{ required: true, message: "请选择扩容能力" }]}>
            <Select
              options={[
                { label: "否", value: "false" },
                { label: "是", value: "true" },
              ]}
            />
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
    </Space>
  );
}
