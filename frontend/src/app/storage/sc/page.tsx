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
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
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
  type CreateStorageResourcePayload,
  type StorageResource,
} from "@/lib/api/storage";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { getClusters } from "@/lib/api/clusters";
import { ResourceClusterNamespaceFilters } from "@/components/resource-cluster-namespace-filters";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { useAntdTableSortPagination } from "@/lib/table";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

interface ScFormValues {
  name: string;
  clusterId: string;
  provisioner: string;
  bindingMode: string;
  allowVolumeExpansion: "true" | "false";
}

function defaultTag(isDefault: boolean) {
  return isDefault ? <Tag color="green">默认</Tag> : <Tag>普通</Tag>;
}

export default function StorageClassPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, onClusterChange } = useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
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
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [form] = Form.useForm<ScFormValues>();

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
          hasKnownCluster(clusterMap, item.clusterId) &&
          matchLabelExpressions(item.labels, mergedFilters),
      ),
    [clusterMap, data?.items, mergedFilters],
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

  const columns: ColumnsType<StorageResource> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
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
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", isLoading && !data),
      render: (_: unknown, row) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "Provisioner",
      key: "provisioner",
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
      width: TABLE_COL_WIDTH.schedule,
      ...getSortableColumnProps("bindingMode", isLoading && !data),
      render: (v: string | undefined) => v ?? "-",
    },
    {
      title: "扩容",
      key: "allowVolumeExpansion",
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row) => {
        const allow = Boolean(
          typeof row.spec === "object" &&
            row.spec &&
            (row.spec as { allowVolumeExpansion?: boolean }).allowVolumeExpansion,
        );
        return allow ? <Tag color="blue">允许</Tag> : <Tag>不允许</Tag>;
      },
    },
    {
      title: "默认",
      key: "isDefault",
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
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row: StorageResource) => {
        const actions: ResourceMenuItem[] = [
          {
            key: "expand",
            icon: <SettingOutlined />,
            label: "扩容配置",
            onClick: () => {
              void message.info("请在 YAML 中设置 allowVolumeExpansion 以调整扩容能力。");
              setYamlTarget({
                clusterId: row.clusterId,
                namespace: "default",
                kind: "StorageClass",
                name: row.name,
              });
            },
          },
          {
            key: "bind",
            icon: <FileTextOutlined />,
            label: "绑定模式",
            onClick: () => {
              void message.info("请在 YAML 中调整 volumeBindingMode。");
              setYamlTarget({
                clusterId: row.clusterId,
                namespace: "default",
                kind: "StorageClass",
                name: row.name,
              });
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

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/storage/sc"
        titleSuffix={<ResourceAddButton title="新增资源" onClick={() => setModalOpen(true)} />}
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
          <Table<StorageResource>
            className="pod-table"
            rowKey="id"
            columns={columns}
            dataSource={tableData}
            loading={isLoading && !data}
            onChange={(nextPagination, filters, sorter, extra) =>
              handleTableChange(nextPagination, filters, sorter, extra, isLoading && !data)
            }
            pagination={getPaginationConfig(data?.total ?? 0, isLoading && !data)}
            scroll={{ x: getTableScrollX(columns) }}
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
          void refetch();
        }}
      />
    </Space>
  );
}
