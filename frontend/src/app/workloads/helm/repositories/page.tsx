"use client";

import { DeleteOutlined, FileTextOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Dropdown, Form, Input, Modal, Row, Select, Space, Switch, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import {
  buildResourceActionMenuItems,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  openResourceActionConfirm,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourceAddButton } from "@/components/resource-add-button";
import { useAuth } from "@/components/auth-context";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ClusterSelect } from "@/components/cluster-select";
import { getClusters } from "@/lib/api/clusters";
import { ApiError } from "@/lib/api/client";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import {
  createHelmRepository,
  deleteHelmRepository,
  getHelmRepositoryPresets,
  getHelmRepositories,
  importHelmRepositoryPresets,
  syncHelmRepository,
  updateHelmRepository,
  type HelmRepositoryItem,
  type HelmRepositoryPresetItem,
} from "@/lib/api/helm";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import type { ResourceDetailRequest } from "@/lib/api/resources";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildTablePagination } from "@/lib/table/pagination";

interface RepositoryFormValues {
  clusterId: string;
  name: string;
  url: string;
}

interface QuickUrlFormValues {
  clusterId: string;
  url: string;
  name?: string;
}

function syncStatusTag(status: HelmRepositoryItem["syncStatus"]) {
  if (status === "saved") return <Tag color="default">已保存</Tag>;
  if (status === "validated") return <Tag color="cyan">已验证</Tag>;
  if (status === "syncing") return <Tag color="gold">待同步</Tag>;
  if (status === "synced") return <Tag color="green">已同步</Tag>;
  if (status === "failed") return <Tag color="red">失败</Tag>;
  return <Tag>{status}</Tag>;
}

export default function HelmRepositoriesPage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();

  const [clusterId, setClusterId] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [presetOpen, setPresetOpen] = useState(false);
  const [presetNames, setPresetNames] = useState<string[]>([]);
  const [importWithSync, setImportWithSync] = useState(true);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [mode, setMode] = useState<"create" | "edit">("create");
  const [editingRepository, setEditingRepository] = useState<HelmRepositoryItem | null>(null);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [quickUrlOpen, setQuickUrlOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [quickUrlError, setQuickUrlError] = useState<string | null>(null);
  const [form] = Form.useForm<RepositoryFormValues>();
  const [quickUrlForm] = Form.useForm<QuickUrlFormValues>();

  const formatMutationError = (error: unknown, fallback: string) => {
    if (error instanceof ApiError) {
      const details = (error.details ?? {}) as { reason?: string; suggestion?: string };
      const reason = typeof details.reason === "string" && details.reason.trim().length > 0 ? details.reason.trim() : "";
      const suggestion =
        typeof details.suggestion === "string" && details.suggestion.trim().length > 0
          ? details.suggestion.trim()
          : "";
      return [error.message, reason ? `原因：${reason}` : "", suggestion ? `建议：${suggestion}` : ""]
        .filter(Boolean)
        .join("；");
    }
    if (error instanceof Error) {
      return error.message;
    }
    return fallback;
  };

  const buildRepositoryNameFromUrl = (url: string) => {
    try {
      const parsed = new URL(url.trim());
      const host = parsed.hostname.replace(/[^a-zA-Z0-9-]/g, "-");
      const firstPath = parsed.pathname
        .split("/")
        .map((part) => part.trim())
        .filter(Boolean)[0];
      const pathPart = firstPath ? firstPath.replace(/[^a-zA-Z0-9-]/g, "-") : "repo";
      return `${host}-${pathPart}`.toLowerCase().slice(0, 48);
    } catch {
      return `repo-${Date.now().toString().slice(-6)}`;
    }
  };

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all-for-helm-repositories", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const mutation = useMutation({
    mutationFn: async (values: RepositoryFormValues) => {
      if (mode === "create") {
        return createHelmRepository(
          {
            clusterId: values.clusterId,
            name: values.name,
            url: values.url,
          },
          accessToken ?? undefined,
        );
      }
      if (!editingRepository) {
        throw new Error("请选择要编辑的仓库");
      }
      return updateHelmRepository(
        editingRepository.name,
        {
          clusterId: values.clusterId,
          url: values.url,
        },
        accessToken ?? undefined,
      );
    },
    onSuccess: async () => {
      setFormError(null);
      void message.success(mode === "create" ? "仓库创建成功" : "仓库更新成功");
      setFormOpen(false);
      setEditingRepository(null);
      form.resetFields();
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
    },
    onError: (error) => {
      const text = formatMutationError(error, "仓库操作失败");
      setFormError(text);
      void message.error(text);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (repository: HelmRepositoryItem) => {
      return deleteHelmRepository(repository.name, repository.clusterId, accessToken ?? undefined);
    },
    onSuccess: async (_data, repository) => {
      void message.success("仓库删除成功");
      setDetailTarget((current) =>
        current && `${repository.clusterId}/${repository.name}` === current.id ? null : current,
      );
      if (
        editingRepository &&
        `${editingRepository.clusterId}/${editingRepository.name}` === `${repository.clusterId}/${repository.name}`
      ) {
        setEditingRepository(null);
      }
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "删除仓库失败");
    },
  });

  const syncMutation = useMutation({
    mutationFn: async (repository: HelmRepositoryItem) => {
      return syncHelmRepository(repository.name, repository.clusterId, accessToken ?? undefined);
    },
    onSuccess: async () => {
      void message.success("仓库同步已提交");
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "仓库同步失败");
    },
  });

  const importPresetsMutation = useMutation({
    mutationFn: async () =>
      importHelmRepositoryPresets(
        {
          clusterId,
          names: presetNames.length > 0 ? presetNames : undefined,
          sync: importWithSync,
        },
        accessToken ?? undefined,
      ),
    onSuccess: async (result) => {
      const failed = result.imported.filter((item) => item.syncStatus === "failed");
      const created = result.imported.filter((item) => item.action === "created").length;
      const existing = result.imported.filter((item) => item.action === "existing").length;
      const summary = `模板导入完成：新增 ${created}，已存在 ${existing}`;
      if (failed.length > 0) {
        void message.warning(`${summary}，同步失败 ${failed.length}（${failed.map((i) => i.name).join("、")}）`);
      } else {
        void message.success(summary);
      }
      setPresetOpen(false);
      setPresetNames([]);
      setImportWithSync(true);
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "模板仓库导入失败");
    },
  });

  const quickUrlMutation = useMutation({
    mutationFn: async (values: QuickUrlFormValues) => {
      const derivedName = values.name?.trim() || buildRepositoryNameFromUrl(values.url);
      return createHelmRepository(
        {
          clusterId: values.clusterId,
          name: derivedName,
          url: values.url.trim(),
        },
        accessToken ?? undefined,
      ).then((result) => ({
        result,
        name: derivedName,
        clusterId: values.clusterId,
      }));
    },
    onSuccess: async ({ clusterId }) => {
      setQuickUrlError(null);
      void message.success("仓库 URL 已新增并触发验证");
      setQuickUrlOpen(false);
      quickUrlForm.resetFields();
      setClusterId(clusterId);
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
    },
    onError: (error) => {
      const text = formatMutationError(error, "URL 新增仓库失败");
      setQuickUrlError(text);
      void message.error(text);
    },
  });

  const repositoryClusterOptions = useMemo(
    () =>
      (clustersQuery.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.id,
      })),
    [clustersQuery.data?.items],
  );
  const repositoriesQuery = useQuery({
    queryKey: ["helm", "repositories", clusterId, page, pageSize, accessToken],
    queryFn: () =>
      getHelmRepositories(
        { clusterId: clusterId || undefined, page, pageSize },
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });
  const presetsQuery = useQuery({
    queryKey: ["helm", "repository-presets", accessToken],
    queryFn: () => getHelmRepositoryPresets(accessToken ?? undefined),
    enabled: Boolean(accessToken),
    staleTime: 5 * 60 * 1000,
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );

  const rows = useMemo(
    () =>
      (repositoriesQuery.data?.items ?? []).filter((row) => {
        if (!hasKnownCluster(clusterMap, row.clusterId)) {
          return false;
        }
        const cluster = clustersQuery.data?.items?.find((item) => item.id === row.clusterId);
        return cluster?.hasKubeconfig !== false;
      }),
    [clusterMap, clustersQuery.data?.items, repositoriesQuery.data?.items],
  );
  const presetOptions = useMemo(
    () =>
      (presetsQuery.data?.items ?? []).map((item: HelmRepositoryPresetItem) => ({
        label: `${item.name} (${item.url})`,
        value: item.name,
      })),
    [presetsQuery.data?.items],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(rows.map((row) => row.name), { max: 320 }),
    [rows],
  );

  const openRepositoryEditor = (repository: HelmRepositoryItem) => {
    setFormError(null);
    setMode("edit");
    setEditingRepository(repository);
    form.setFieldsValue({
      clusterId: repository.clusterId,
      name: repository.name,
      url: repository.url,
    });
    setFormOpen(true);
  };

  const handleRowAction = (repository: HelmRepositoryItem, key: string) => {
    if (key === "edit") {
      openRepositoryEditor(repository);
      return;
    }

    if (key === "sync") {
      openResourceActionConfirm(
        {
          title: "同步 Helm 仓库",
          description: `确认同步仓库「${repository.name}」吗？`,
          okText: "确认同步",
          cancelText: "取消",
        },
        () => void syncMutation.mutateAsync(repository),
      );
      return;
    }

    if (key === "delete") {
      openResourceActionConfirm(
        {
          title: "删除 Helm 仓库",
          description: `确认删除仓库「${repository.name}」吗？`,
          okText: "确认删除",
          cancelText: "取消",
          okDanger: true,
        },
        () => void deleteMutation.mutateAsync(repository),
      );
    }
  };

  const buildRowActions = (): MenuProps["items"] =>
    buildResourceActionMenuItems([
      { key: "edit", label: "YAML", icon: <FileTextOutlined /> },
      { key: "sync", label: "同步" },
      { key: "delete", label: "删除", icon: <DeleteOutlined />, danger: true },
    ]);

  const columns: ColumnsType<HelmRepositoryItem> = [
    {
      title: "仓库名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: HelmRepositoryItem) => (
        <Typography.Link
          onClick={() =>
            setDetailTarget({
              kind: "HelmRepository",
              id: `${row.clusterId}/${row.name}`,
            })
          }
        >
          {name}
        </Typography.Link>
      ),
    },
    {
      title: "集群",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      render: (_: unknown, row: HelmRepositoryItem) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      render: () => "-",
    },
    { title: "仓库地址", dataIndex: "url", key: "url", width: TABLE_COL_WIDTH.url },
    {
      title: "同步状态",
      dataIndex: "syncStatus",
      key: "syncStatus",
      width: TABLE_COL_WIDTH.status,
      render: (value: HelmRepositoryItem["syncStatus"]) => syncStatusTag(value),
    },
    {
      title: "最后同步",
      dataIndex: "lastSyncAt",
      key: "lastSyncAt",
      width: TABLE_COL_WIDTH.time,
      render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    { title: "状态消息", dataIndex: "message", key: "message" },
    {
      title: "操作",
      key: "actions",
      width: 72,
      fixed: "right",
      align: "center",
      render: (_: unknown, repository: HelmRepositoryItem) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
          menu={{
            items: buildRowActions(),
            onClick: ({ key }) => handleRowAction(repository, String(key)),
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
      <ResourcePageHeader
        path="/workloads/helm/repositories"
        embedded
        style={{ marginBottom: 12 }}
        description="管理 Helm 仓库、同步状态与模板导入。"
        titleSuffix={
          <ResourceAddButton
            onClick={() => {
              setFormError(null);
              setMode("create");
              form.setFieldsValue({
                clusterId: clusterId || undefined,
                name: "",
                url: "",
              });
              setFormOpen(true);
            }}
            aria-label="新增仓库"
          />
        }
      />

      <Card>
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={6} lg={4}>
            <ClusterSelect
              value={clusterId}
              onChange={(v) => setClusterId(v)}
              options={repositoryClusterOptions}
            />
          </Col>
        </Row>

        {!isInitializing && !accessToken ? (
          <Alert
            type="warning"
            showIcon
            message="未检测到登录状态，请先登录后再操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {repositoriesQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="Helm 仓库列表加载失败"
            description={repositoriesQuery.error instanceof Error ? repositoriesQuery.error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<HelmRepositoryItem>
          bordered
          rowKey={(row) => `${row.clusterId}/${row.name}`}
          columns={columns}
          dataSource={rows}
          loading={repositoriesQuery.isLoading && rows.length === 0}
          pagination={buildTablePagination({
            current: repositoriesQuery.data?.page ?? page,
            pageSize: repositoriesQuery.data?.pageSize ?? pageSize,
            total: repositoriesQuery.data?.total ?? 0,
            disabled: repositoriesQuery.isLoading && rows.length === 0,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
              }
            },
          })}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
      />

      <Modal
        title={mode === "create" ? "新增 Helm 仓库" : "编辑 Helm 仓库"}
        open={formOpen}
        onCancel={() => {
          setFormOpen(false);
          setFormError(null);
          setEditingRepository(null);
          form.resetFields();
        }}
        onOk={async () => {
          let values: RepositoryFormValues;
          try {
            values = await form.validateFields();
          } catch {
            return;
          }
          await mutation.mutateAsync(values);
        }}
        okText={mode === "create" ? "确认新增" : "确认更新"}
        cancelText="取消"
        confirmLoading={mutation.isPending}
        destroyOnHidden
      >
        <Form form={form} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
            <Select disabled={mode === "edit"} options={repositoryClusterOptions} />
          </Form.Item>
          <Form.Item name="name" label="仓库名称" rules={[{ required: true, message: "请输入仓库名称" }]}>
            <Input disabled={mode === "edit"} placeholder="bitnami" />
          </Form.Item>
          <Form.Item name="url" label="仓库地址" rules={[{ required: true, message: "请输入仓库地址" }]}>
            <Input placeholder="https://charts.bitnami.com/bitnami" />
          </Form.Item>
        </Form>
        {formError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message="仓库提交失败"
            description={formError}
            action={
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setFormError(null);
                  void mutation.mutateAsync(form.getFieldsValue(true) as RepositoryFormValues);
                }}
              >
                重试
              </Button>
            }
          />
        ) : null}
      </Modal>

      <Modal
        title="通过 URL 快速新增仓库"
        open={quickUrlOpen}
        onCancel={() => {
          if (quickUrlMutation.isPending) return;
          setQuickUrlOpen(false);
          setQuickUrlError(null);
          quickUrlForm.resetFields();
        }}
        onOk={async () => {
          let values: QuickUrlFormValues;
          try {
            values = await quickUrlForm.validateFields();
          } catch {
            return;
          }
          await quickUrlMutation.mutateAsync(values);
        }}
        okText="新增并验证"
        cancelText="取消"
        confirmLoading={quickUrlMutation.isPending}
        destroyOnHidden
      >
        <Form form={quickUrlForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
            <Select options={repositoryClusterOptions} />
          </Form.Item>
          <Form.Item
            name="url"
            label="仓库 URL"
            rules={[{ required: true, message: "请输入仓库 URL" }]}
          >
            <Input placeholder="https://charts.bitnami.com/bitnami" />
          </Form.Item>
          <Form.Item
            name="name"
            label="仓库名称（可选）"
            tooltip="留空时将根据 URL 自动生成名称。"
          >
            <Input placeholder="例如 bitnami" />
          </Form.Item>
        </Form>
        {quickUrlError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            message="URL 新增失败"
            description={quickUrlError}
            action={
              <Button
                size="small"
                type="link"
                onClick={() => {
                  setQuickUrlError(null);
                  void quickUrlMutation.mutateAsync(quickUrlForm.getFieldsValue(true) as QuickUrlFormValues);
                }}
              >
                重试
              </Button>
            }
          />
        ) : null}
      </Modal>

      <Modal
        title="导入模板 Helm 仓库"
        open={presetOpen}
        onCancel={() => {
          if (importPresetsMutation.isPending) return;
          setPresetOpen(false);
        }}
        onOk={() => {
          void importPresetsMutation.mutateAsync();
        }}
        okText={importWithSync ? "导入并同步" : "仅导入"}
        cancelText="取消"
        confirmLoading={importPresetsMutation.isPending}
        destroyOnHidden
      >
        <Space orientation="vertical" size={12} style={{ width: "100%", marginTop: 12 }}>
          <Typography.Text type="secondary">
            不选名称时默认导入全部模板仓库。
          </Typography.Text>
          <Select
            mode="multiple"
            allowClear
            placeholder="选择要导入的模板仓库（默认全部）"
            value={presetNames}
            onChange={(values) => setPresetNames(values)}
            options={presetOptions}
            loading={presetsQuery.isLoading && presetOptions.length === 0}
            style={{ width: "100%" }}
          />
          <Space>
            <Switch checked={importWithSync} onChange={setImportWithSync} />
            <Typography.Text>导入后立即同步仓库索引</Typography.Text>
          </Space>
          {presetsQuery.isError ? (
            <Alert
              type="error"
              showIcon
              message="模板仓库列表加载失败"
              description={presetsQuery.error instanceof Error ? presetsQuery.error.message : "请求失败"}
            />
          ) : null}
        </Space>
      </Modal>
      {renderPodLikeResourceActionStyles({ triggerClassName: POD_ACTION_TRIGGER_CLASS, menuClassName: POD_ACTION_MENU_CLASS })}
    </Space>
  );
}
