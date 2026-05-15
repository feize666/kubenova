"use client";

import { DownloadOutlined, SearchOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
  Table,
  Tabs,
  Typography,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import type { MenuProps } from "antd";
import { useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ResourceDetailDrawer } from "@/components/resource-detail";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import {
  buildResourceActionMenuItems,
  type ResourceActionItem,
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  openResourceActionConfirm,
  parseResourceSearchInput,
  renderPodLikeResourceActionStyles,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { NamespaceSelect } from "@/components/namespace-select";
import { ClusterSelect } from "@/components/cluster-select";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import {
  executeHelmAction,
  getHelmCharts,
  getHelmReleaseHistory,
  getHelmReleaseManifest,
  getHelmReleases,
  getHelmReleaseValues,
  getHelmRepositories,
  type HelmAction,
  type HelmActionPayload,
  type HelmChartItem,
  type HelmReleaseHistoryItem,
  type HelmReleaseItem,
} from "@/lib/api/helm";
import type { ResourceDetailRequest } from "@/lib/api/resources";

interface InstallFormValues {
  clusterId: string;
  namespace: string;
  releaseName: string;
  repositoryName?: string;
  chartName: string;
  version?: string;
  values?: string;
}

interface RollbackFormValues {
  revision: number;
}

function sanitizeFilenameSegment(value: string, fallback: string) {
  const normalized = value.trim().replace(/[\\/:*?"<>|\s]+/g, "-");
  return normalized || fallback;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function HelmPage() {
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();

  const [clusterId, setClusterId] = useState("");
  const [namespace, setNamespace] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<HelmReleaseItem>({
    defaultPageSize: 10,
  });
  const [selectedRowId, setSelectedRowId] = useState<string | null>(null);
  const [installOpen, setInstallOpen] = useState(false);
  const [rollbackOpen, setRollbackOpen] = useState(false);
  const [chartSearchMode, setChartSearchMode] = useState<"repo" | "hub" | "auto">("auto");
  const [installChartKeywordInput, setInstallChartKeywordInput] = useState("");
  const [installChartKeyword, setInstallChartKeyword] = useState("");
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [installForm] = Form.useForm<InstallFormValues>();
  const [rollbackForm] = Form.useForm<RollbackFormValues>();

  const installClusterId = Form.useWatch("clusterId", installForm);
  const installRepositoryName = Form.useWatch("repositoryName", installForm);
  const installChartName = Form.useWatch("chartName", installForm);

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all-for-helm", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const helmClusterOptions = useMemo(
    () =>
      (clustersQuery.data?.items ?? []).map((c) => ({
        label: c.name,
        value: c.id,
      })),
    [clustersQuery.data?.items],
  );

  const selectedClusterId = useMemo(() => {
    return clusterId;
  }, [clusterId]);

  const selectedCluster = useMemo(
    () => (clustersQuery.data?.items ?? []).find((item) => item.id === selectedClusterId),
    [clustersQuery.data?.items, selectedClusterId],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const selectedClusterReady = selectedCluster?.hasKubeconfig !== false;

  const releasesQuery = useQuery({
    queryKey: [
      "helm",
      "releases",
      {
        clusterId: selectedClusterId,
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
      getHelmReleases(
        {
          clusterId: selectedClusterId || undefined,
          namespace: namespace.trim() || undefined,
          keyword: keyword.trim() || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken ?? undefined,
    ),
    enabled: !isInitializing && Boolean(accessToken) && selectedClusterReady,
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const repositoriesQuery = useQuery({
    queryKey: ["helm", "repositories", installClusterId || selectedClusterId, accessToken],
    queryFn: () =>
      getHelmRepositories(
        { clusterId: installClusterId || selectedClusterId, page: 1, pageSize: 200 },
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken) && Boolean(installClusterId || selectedClusterId),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const chartsQuery = useQuery({
    queryKey: [
      "helm",
      "charts",
      installClusterId || selectedClusterId,
      installRepositoryName,
      installChartKeyword,
      chartSearchMode,
      accessToken,
    ],
    queryFn: () =>
      getHelmCharts(
        {
          clusterId: installClusterId || selectedClusterId,
          repository: chartSearchMode === "repo" ? installRepositoryName : undefined,
          keyword: installChartKeyword.trim() || undefined,
          searchMode: chartSearchMode,
        },
        accessToken ?? undefined,
      ),
    enabled:
      Boolean(accessToken) &&
      Boolean(installClusterId || selectedClusterId) &&
      (chartSearchMode !== "repo" || Boolean(installRepositoryName)),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const rows = useMemo(
    () => releasesQuery.data?.items ?? [],
    [releasesQuery.data?.items],
  );
  const releaseNameWidth = useMemo(
    () => getAdaptiveNameWidth(rows.map((row) => row.name), { max: 320 }),
    [rows],
  );

  const selectedRelease = useMemo(
    () => rows.find((row) => row.id === selectedRowId) ?? null,
    [rows, selectedRowId],
  );
  const activeDetailRelease = useMemo(() => {
    if (detailTarget?.kind !== "HelmRelease" || !detailTarget.id) {
      return null;
    }
    const parts = detailTarget.id.split("/").map((item) => item.trim()).filter(Boolean);
    if (parts.length < 3) {
      return null;
    }
    const [clusterId, namespace, ...rest] = parts;
    const name = rest.join("/");
    if (!clusterId || !namespace || !name) {
      return null;
    }
    return { clusterId, namespace, name };
  }, [detailTarget]);

  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set(rows.map((i) => i.namespace).filter((ns): ns is string => Boolean(ns))),
      ),
    [rows],
  );

  const selectedInstallChart = useMemo<HelmChartItem | null>(() => {
    return chartsQuery.data?.items?.find((item) => item.name === installChartName) ?? null;
  }, [chartsQuery.data?.items, installChartName]);
  const selectedInstallRepository = useMemo(
    () =>
      (repositoriesQuery.data?.items ?? []).find((item) => item.name === installRepositoryName) ?? null,
    [repositoriesQuery.data?.items, installRepositoryName],
  );

  const valuesQuery = useQuery({
    queryKey: ["helm", "values", activeDetailRelease?.clusterId, activeDetailRelease?.namespace, activeDetailRelease?.name, accessToken],
    queryFn: () =>
      getHelmReleaseValues(activeDetailRelease!, accessToken ?? undefined),
    enabled: Boolean(activeDetailRelease) && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const manifestQuery = useQuery({
    queryKey: ["helm", "manifest", activeDetailRelease?.clusterId, activeDetailRelease?.namespace, activeDetailRelease?.name, accessToken],
    queryFn: () =>
      getHelmReleaseManifest(activeDetailRelease!, accessToken ?? undefined),
    enabled: Boolean(activeDetailRelease) && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const historyQuery = useQuery({
    queryKey: ["helm", "history", activeDetailRelease?.clusterId, activeDetailRelease?.namespace, activeDetailRelease?.name, accessToken],
    queryFn: () =>
      getHelmReleaseHistory(activeDetailRelease!, accessToken ?? undefined),
    enabled: Boolean(activeDetailRelease) && Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const actionMutation = useMutation({
    mutationFn: ({ action, payload }: { action: HelmAction; payload: HelmActionPayload }) =>
      executeHelmAction(action, payload, accessToken ?? undefined),
    onSuccess: async (result, input) => {
      void message.success(result?.message || `${input.action} 操作已提交`);
      await queryClient.invalidateQueries({ queryKey: ["helm", "releases"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "repositories"] });
      await queryClient.invalidateQueries({ queryKey: ["helm", "charts"] });
      if (selectedRelease && detailTarget?.id === selectedRelease.id) {
        await queryClient.invalidateQueries({
          queryKey: ["resource-detail", "HelmRelease", selectedRelease.id],
        });
        await queryClient.invalidateQueries({
          queryKey: ["helm", "values", selectedRelease.clusterId, selectedRelease.namespace, selectedRelease.name],
        });
        await queryClient.invalidateQueries({
          queryKey: ["helm", "manifest", selectedRelease.clusterId, selectedRelease.namespace, selectedRelease.name],
        });
        await queryClient.invalidateQueries({
          queryKey: ["helm", "history", selectedRelease.clusterId, selectedRelease.namespace, selectedRelease.name],
        });
      }
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "Helm 操作失败，请重试");
    },
  });

  const installClusterOptions = useMemo(
    () =>
      (clustersQuery.data?.items ?? []).map((c) => ({
        label: c.hasKubeconfig === false ? `${c.name}（未接入实时数据）` : c.name,
        value: c.id,
      })),
    [clustersQuery.data?.items],
  );

  const repositoryOptions = useMemo(
    () =>
      (repositoriesQuery.data?.items ?? []).map((item) => ({
        label: `${item.name}（${item.syncStatus}）`,
        value: item.name,
      })),
    [repositoriesQuery.data?.items],
  );

  const chartOptions = useMemo(
    () =>
      (chartsQuery.data?.items ?? []).map((item) => ({
        label: `${item.name}${item.source ? `（来源：${item.source === "repo" ? "仓库" : "Hub"}）` : ""}`,
        value: item.name,
      })),
    [chartsQuery.data?.items],
  );

  const versionOptions = useMemo(
    () =>
      (selectedInstallChart?.versions ?? [])
        .map((item) => item.version)
        .filter((item): item is string => Boolean(item))
        .map((version) => ({ label: version, value: version })),
    [selectedInstallChart],
  );

  const handleSearch = () => {
    const parsed = parseResourceSearchInput(keywordInput);
    resetPage();
    setKeyword(parsed.keyword);
    setDetailTarget(null);
  };

  const handleChartSearch = () => {
    setInstallChartKeyword(installChartKeywordInput.trim());
    installForm.setFieldsValue({ chartName: undefined, version: undefined });
  };

  const handleInstallSubmit = async () => {
    let values: InstallFormValues;
    try {
      values = await installForm.validateFields();
    } catch {
      return;
    }
    await actionMutation.mutateAsync({
      action: "install",
      payload: {
        clusterId: values.clusterId,
        namespace: values.namespace,
        releaseName: values.releaseName,
        repositoryName: values.repositoryName?.trim() || undefined,
        chartName: values.chartName,
        chart:
          !values.repositoryName?.trim() && selectedInstallChart?.fullName
            ? selectedInstallChart.fullName
            : undefined,
        version: values.version?.trim() || undefined,
        values: values.values?.trim() || undefined,
      },
    });
    setInstallOpen(false);
    setChartSearchMode("auto");
    setInstallChartKeyword("");
    setInstallChartKeywordInput("");
    installForm.resetFields();
  };

  const handleUpgrade = async (row: HelmReleaseItem) => {
    const chartRef = row.chart;
    if (!chartRef) {
      void message.warning("未获取到 Chart 信息，无法执行升级");
      return;
    }
    await actionMutation.mutateAsync({
      action: "upgrade",
      payload: {
        clusterId: row.clusterId,
        namespace: row.namespace,
        releaseName: row.name,
        chart: chartRef,
      },
    });
  };

  const handleRollbackSubmit = async () => {
    if (!selectedRelease) return;
    let values: RollbackFormValues;
    try {
      values = await rollbackForm.validateFields();
    } catch {
      return;
    }
    await actionMutation.mutateAsync({
      action: "rollback",
      payload: {
        clusterId: selectedRelease.clusterId,
        namespace: selectedRelease.namespace,
        releaseName: selectedRelease.name,
        revision: values.revision,
      },
    });
    setRollbackOpen(false);
    rollbackForm.resetFields();
  };

  const handleUninstall = async (row: HelmReleaseItem) => {
    await actionMutation.mutateAsync({
      action: "uninstall",
      payload: {
        clusterId: row.clusterId,
        namespace: row.namespace,
        releaseName: row.name,
      },
    });
    if (detailTarget?.id === row.id) {
      setDetailTarget(null);
    }
    if (selectedRowId === row.id) {
      setSelectedRowId(null);
    }
  };

  const buildRowActions = (row: HelmReleaseItem) => {
    const canOperate = selectedClusterReady && Boolean(row.clusterId);
    return buildResourceActionMenuItems([
      {
        key: "upgrade",
        label: "升级",
        disabled: !canOperate,
        onClick: () => void handleUpgrade(row),
        confirm: {
          title: "升级 Helm Release",
          description: `确认升级 Release「${row.name}」吗？`,
          okText: "确认升级",
          cancelText: "取消",
        },
      },
      {
        key: "rollback",
        label: "回滚",
        disabled: !canOperate,
        onClick: () => {
          setSelectedRowId(row.id);
          rollbackForm.resetFields();
          setRollbackOpen(true);
        },
      },
      {
        key: "uninstall",
        label: "卸载",
        danger: true,
        disabled: !canOperate,
        onClick: () => void handleUninstall(row),
        confirm: {
          title: "卸载 Helm Release",
          description: `确认卸载 Release「${row.name}」吗？此操作不可恢复。`,
          okText: "确认卸载",
          cancelText: "取消",
          okDanger: true,
        },
      },
    ]);
  };

  const columns: ColumnsType<HelmReleaseItem> = [
    {
      title: "Release",
      dataIndex: "name",
      key: "name",
      width: releaseNameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name"),
      render: (name: string, row: HelmReleaseItem) => (
        <Typography.Link
          onClick={() => setDetailTarget({ kind: "HelmRelease", id: row.id })}
        >
          {name}
        </Typography.Link>
      ),
    },
    {
      title: "集群",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId"),
      render: (_: unknown, row: HelmReleaseItem) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace"),
    },
    { title: "Chart", dataIndex: "chart", key: "chart", width: TABLE_COL_WIDTH.chart },
    { title: "修订版本", dataIndex: "revision", key: "revision", width: TABLE_COL_WIDTH.revision },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.time,
      ...getSortableColumnProps("updatedAt"),
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      align: "center",
      render: (_: unknown, row: HelmReleaseItem) => {
        const actions = buildRowActions(row);
        return (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          classNames={{ root: POD_ACTION_MENU_CLASS }}
            menu={{
              items: actions,
              onClick: ({ key }: Parameters<NonNullable<MenuProps["onClick"]>>[0]) => {
                const action = actions.find((item) => item && "key" in item && item.key === key) as
                  | ResourceActionItem
                  | undefined;
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

  const historyColumns: ColumnsType<HelmReleaseHistoryItem> = [
    { title: "修订版本", dataIndex: "revision", key: "revision", width: 100 },
    { title: "Chart", dataIndex: "chart", key: "chart", width: 180 },
    { title: "AppVersion", dataIndex: "appVersion", key: "appVersion", width: 120 },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 180,
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    { title: "描述", dataIndex: "description", key: "description" },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/workloads/helm"
        embedded
        style={{ marginBottom: 12 }}
        description="安装、升级、回滚与卸载 Helm Release。"
        titleSuffix={<ResourceAddButton onClick={() => setInstallOpen(true)} aria-label="安装 Helm Release" />}
      />

      <Card>
        <Row gutter={[12, 12]} align="middle" style={{ marginBottom: 12 }}>
          <Col xs={24} sm={12} md={6} lg={4}>
            <ClusterSelect
              value={selectedClusterId}
              onChange={(v) => {
                setClusterId(v);
                resetPage();
                setSelectedRowId(null);
                setDetailTarget(null);
              }}
              options={helmClusterOptions}
              loading={clustersQuery.isLoading}
            />
          </Col>
          <Col xs={24} sm={12} md={5} lg={4}>
            <NamespaceSelect
              value={namespace}
              onChange={(v) => {
                setNamespace(v);
                resetPage();
                setSelectedRowId(null);
                setDetailTarget(null);
              }}
              knownNamespaces={knownNamespaces}
              clusterId={selectedClusterId}
            />
          </Col>
          <Col xs={24} sm={16} md={7} lg={6}>
            <Input
              prefix={<SearchOutlined />}
              allowClear
              placeholder="按 Release / Chart 搜索"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col xs={24} sm={12} md={4} lg={3}>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch}>
                查询
              </Button>
            </Space>
          </Col>
        </Row>

        {!isInitializing && !accessToken ? (
          <Alert
            type="warning"
            showIcon
            title="未检测到登录状态，请先登录后再操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {releasesQuery.isError ? (
          <Alert
            type="error"
            showIcon
            title="Helm Release 列表加载失败"
            description={releasesQuery.error instanceof Error ? releasesQuery.error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        {!releasesQuery.isError && selectedCluster && selectedCluster.hasKubeconfig === false ? (
          <Alert
            type="warning"
            showIcon
            title="当前集群暂不可读取 Helm 数据。"
            description="请先确认该集群已完成接入后再执行 Helm 查询与操作。"
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<HelmReleaseItem>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={rows}
          onRow={(record) => ({
            onClick: () => setSelectedRowId(record.id),
          })}
          loading={releasesQuery.isLoading}
          onChange={(paginationInfo, filters, sorter, extra) => {
            if (extra.action === "paginate") {
              setDetailTarget(null);
            }
            handleTableChange(paginationInfo, filters, sorter, extra, releasesQuery.isLoading);
          }}
          pagination={getPaginationConfig(releasesQuery.data?.total ?? 0, releasesQuery.isLoading)}
          scroll={{ x: getTableScrollX(columns) }}
        />
      </Card>

      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
      >
        {activeDetailRelease ? (
          <Tabs
            items={[
              {
                key: "values",
                label: "Values",
                children: (
                  <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    <Button
                      icon={<DownloadOutlined />}
                      disabled={!valuesQuery.data?.values?.trim()}
                      onClick={() => {
                        if (!activeDetailRelease || !valuesQuery.data?.values?.trim()) {
                          return;
                        }
                        const release = sanitizeFilenameSegment(activeDetailRelease.name, "release");
                        downloadTextFile(valuesQuery.data.values, `${release}-values.yaml`);
                      }}
                    >
                      下载 Values
                    </Button>
                    <Input.TextArea
                      readOnly
                      autoSize={{ minRows: 14, maxRows: 24 }}
                      value={valuesQuery.data?.values ?? ""}
                      placeholder={valuesQuery.isLoading ? "加载中..." : "暂无 Values"}
                    />
                  </Space>
                ),
              },
              {
                key: "manifest",
                label: "Manifest",
                children: (
                  <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    <Button
                      icon={<DownloadOutlined />}
                      disabled={!manifestQuery.data?.manifest?.trim()}
                      onClick={() => {
                        if (!activeDetailRelease || !manifestQuery.data?.manifest?.trim()) {
                          return;
                        }
                        const release = sanitizeFilenameSegment(activeDetailRelease.name, "release");
                        downloadTextFile(manifestQuery.data.manifest, `${release}-manifest.yaml`);
                      }}
                    >
                      下载 Manifest
                    </Button>
                    <Input.TextArea
                      readOnly
                      autoSize={{ minRows: 14, maxRows: 24 }}
                      value={manifestQuery.data?.manifest ?? ""}
                      placeholder={manifestQuery.isLoading ? "加载中..." : "暂无 Manifest"}
                    />
                  </Space>
                ),
              },
              {
                key: "history",
                label: "历史",
                children: (
                  <Table<HelmReleaseHistoryItem>
                    rowKey={(item) => `${item.revision}-${item.updatedAt}`}
                    size="small"
                    bordered
                    columns={historyColumns}
                    dataSource={historyQuery.data?.items ?? []}
                    loading={historyQuery.isLoading}
                    pagination={false}
                    scroll={{ x: 900 }}
                  />
                ),
              },
            ]}
          />
        ) : null}
      </ResourceDetailDrawer>

      <Modal
        title="安装 Helm Release"
        open={installOpen}
        onCancel={() => {
          setInstallOpen(false);
          setChartSearchMode("auto");
          setInstallChartKeyword("");
          setInstallChartKeywordInput("");
          installForm.resetFields();
        }}
        onOk={() => void handleInstallSubmit()}
        okText="确认安装"
        cancelText="取消"
        confirmLoading={actionMutation.isPending}
        destroyOnHidden
      >
        <Form form={installForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
            <Select
              options={installClusterOptions}
              onChange={() => {
                installForm.setFieldsValue({ repositoryName: undefined, chartName: undefined, version: undefined });
              }}
            />
          </Form.Item>
          <Form.Item name="namespace" label="名称空间" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input placeholder="default" />
          </Form.Item>
          <Form.Item name="releaseName" label="Release 名称" rules={[{ required: true, message: "请输入 Release 名称" }]}>
            <Input placeholder="my-release" />
          </Form.Item>
          <Form.Item label="Chart 搜索模式">
            <Select
              value={chartSearchMode}
              options={[
                { label: "自动（优先仓库，空结果回退 Hub）", value: "auto" },
                { label: "仅仓库", value: "repo" },
                { label: "仅 Hub", value: "hub" },
              ]}
              onChange={(mode: "repo" | "hub" | "auto") => {
                setChartSearchMode(mode);
                setInstallChartKeyword("");
                setInstallChartKeywordInput("");
                installForm.setFieldsValue({
                  repositoryName: mode === "hub" ? undefined : installForm.getFieldValue("repositoryName"),
                  chartName: undefined,
                  version: undefined,
                });
              }}
            />
          </Form.Item>
          <Form.Item
            name="repositoryName"
            label="仓库"
            rules={chartSearchMode === "repo" ? [{ required: true, message: "请选择仓库" }] : []}
          >
            <Select
              showSearch
              placeholder={chartSearchMode === "hub" ? "Hub 模式下可不选仓库" : "请选择 Helm 仓库"}
              options={repositoryOptions}
              loading={repositoriesQuery.isLoading}
              allowClear={chartSearchMode === "hub"}
              onChange={() => {
                setInstallChartKeyword("");
                setInstallChartKeywordInput("");
                installForm.setFieldsValue({ chartName: undefined, version: undefined });
              }}
            />
          </Form.Item>
          <Form.Item label="Chart 关键词">
            <Space.Compact style={{ width: "100%" }}>
              <Input
                allowClear
                placeholder="例如 nginx / redis / kafka"
                value={installChartKeywordInput}
                onChange={(e) => setInstallChartKeywordInput(e.target.value)}
                onPressEnter={handleChartSearch}
              />
              <Button icon={<SearchOutlined />} onClick={handleChartSearch}>
                搜索
              </Button>
            </Space.Compact>
          </Form.Item>
          <Form.Item name="chartName" label="Chart" rules={[{ required: true, message: "请选择 Chart" }]}>
            <Select
              showSearch
              placeholder="请选择 Chart"
              options={chartOptions}
              loading={chartsQuery.isLoading}
              onChange={() => {
                installForm.setFieldsValue({ version: undefined });
              }}
            />
          </Form.Item>
          <Form.Item name="version" label="Chart 版本">
            <Select allowClear placeholder="默认使用最新版本" options={versionOptions} />
          </Form.Item>
          <Form.Item name="values" label="Values (JSON)">
            <Input.TextArea rows={6} placeholder='可选，示例：{"replicaCount":2}' />
          </Form.Item>
        </Form>

        {repositoriesQuery.isError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            title="仓库列表加载失败"
            description={repositoriesQuery.error instanceof Error ? repositoriesQuery.error.message : "请求失败"}
          />
        ) : null}
        {!repositoriesQuery.isError &&
        chartSearchMode === "repo" &&
        selectedInstallRepository &&
        selectedInstallRepository.syncStatus !== "validated" &&
        selectedInstallRepository.syncStatus !== "synced" ? (
          <Alert
            type="warning"
            showIcon
            style={{ marginTop: 8 }}
            message={`仓库「${selectedInstallRepository.name}」当前状态为 ${selectedInstallRepository.syncStatus}`}
            description={selectedInstallRepository.message || "建议先到 Helm 仓库页执行同步后再搜索 Chart。"}
          />
        ) : null}
        {!chartsQuery.isError &&
        !chartsQuery.isLoading &&
        !chartsQuery.isLoading &&
        (chartsQuery.data?.items?.length ?? 0) === 0 ? (
          <Alert
            type="info"
            showIcon
            style={{ marginTop: 8 }}
            title="未检索到可用 Chart"
            description={
              installChartKeyword
                ? `当前模式 ${chartSearchMode} 下，关键词「${installChartKeyword}」无结果，请更换关键词或搜索模式。`
                : "请输入 Chart 关键词并点击搜索，或切换搜索模式重试。"
            }
          />
        ) : null}
        {chartsQuery.isError ? (
          <Alert
            type="error"
            showIcon
            style={{ marginTop: 8 }}
            title="Chart 列表加载失败"
            description={chartsQuery.error instanceof Error ? chartsQuery.error.message : "请求失败"}
          />
        ) : null}
      </Modal>

      <Modal
        title={selectedRelease ? `回滚 · ${selectedRelease.name}` : "回滚"}
        open={rollbackOpen}
        onCancel={() => {
          setRollbackOpen(false);
          rollbackForm.resetFields();
        }}
        onOk={() => void handleRollbackSubmit()}
        okText="确认回滚"
        cancelText="取消"
        confirmLoading={actionMutation.isPending}
        destroyOnHidden
      >
        <Form form={rollbackForm} layout="vertical" style={{ marginTop: 12 }}>
          <Form.Item
            name="revision"
            label="目标 Revision"
            rules={[
              { required: true, message: "请输入 Revision" },
              {
                validator: async (_, value) => {
                  if (typeof value !== "number" || value <= 0) {
                    throw new Error("Revision 必须大于 0");
                  }
                },
              },
            ]}
          >
            <InputNumber style={{ width: "100%" }} min={1} precision={0} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
