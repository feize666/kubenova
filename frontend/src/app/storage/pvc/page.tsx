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
  Table,
  Tag,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
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
import { buildTablePagination } from "@/lib/table/pagination";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

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
  if (phase === "bound") return <Tag color="green">Bound</Tag>;
  if (phase === "pending") return <Tag color="gold">Pending</Tag>;
  if (phase === "lost") return <Tag color="red">Lost</Tag>;
  if (phase === "terminating") return <Tag color="orange">Terminating</Tag>;
  if (phase === "released") return <Tag color="default">Released</Tag>;
  return <Tag color="default">{readPhase(resource) || "-"}</Tag>;
}

interface PvcFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  capacity: string;
  storageClass: string;
}

export default function PvcPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [form] = Form.useForm<PvcFormValues>();

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["storage", "PVC", { clusterId, namespace, keyword, page, pageSize }, accessToken],
    queryFn: () =>
      getStorageResources(
        { kind: "PVC", clusterId: clusterId || undefined, namespace: namespace.trim() || undefined, keyword: keyword.trim() || undefined, page, pageSize },
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
  const effectivePageSize = data?.pageSize ?? pageSize;

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

  const clusterOptions = (clustersQuery.data?.items ?? []).map((c) => ({
    label: c.name,
    value: c.id,
  }));

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

  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    setPage(1);
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };

  const handleOpenCreate = () => {
    form.resetFields();
    setModalOpen(true);
  };

  const columns: ColumnsType<StorageResource> = [
    {
      title: "声明名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
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
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, row: StorageResource) =>
        getClusterDisplayName(clusterMap, row.clusterId),
    },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    { title: "申请容量", dataIndex: "capacity", key: "capacity", width: TABLE_COL_WIDTH.capacity },
    { title: "存储类", dataIndex: "storageClass", key: "storageClass", width: TABLE_COL_WIDTH.storageClass },
    {
      title: "绑定状态",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: StorageResource) => pvcStatusTag(row),
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
                  void message.info("请在 YAML 中调整 resources.requests.storage 完成 PVC 扩容。");
                  setYamlTarget(identity);
                  return;
                }
                if (key === "bind") {
                  void message.info("请在 YAML 中配置 volumeName 完成 PVC 绑定。");
                  setYamlTarget(identity);
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
        titleSuffix={<ResourceAddButton title="新增资源" onClick={handleOpenCreate} />}
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
            setPage(1);
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            setPage(1);
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

        <Table<StorageResource>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={isLoading && !data}
          pagination={buildTablePagination({
            current: page,
            pageSize: effectivePageSize,
            total: data?.total ?? 0,
            disabled: isLoading && !data,
            onChange: (nextPage, nextPageSize) => {
              if (nextPageSize !== effectivePageSize) {
                setPageSize(nextPageSize);
                setPage(1);
                return;
              }
              setPage(nextPage);
            },
          })}
          scroll={{ x: getTableScrollX(columns) }}
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
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
