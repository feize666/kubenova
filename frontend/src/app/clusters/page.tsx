"use client";

import {
  CheckCircleOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DisconnectOutlined,
  EditOutlined,
  ExclamationCircleOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlayCircleOutlined,
  ReloadOutlined,
  SearchOutlined,
} from "@ant-design/icons";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Col,
  Dropdown,
  Empty,
  Form,
  Input,
  Modal,
  Progress,
  Row,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message,
} from "antd";
import type { MenuProps } from "antd";
import type { TableProps } from "antd";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { ClusterDetailDrawer } from "@/components/cluster-detail-drawer";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { ResourceAddButton } from "@/components/resource-add-button";
import {
  POD_ACTION_MENU_CLASS,
  POD_ACTION_TRIGGER_CLASS,
  renderPodLikeResourceActionStyles,
} from "@/components/resource-action-bar";
import {
  createCluster,
  deleteCluster,
  disableCluster,
  enableCluster,
  getClusters,
  updateCluster,
} from "@/lib/api/clusters";
import type { ClusterPayload } from "@/lib/api/clusters";
import {
  getClusterHealthList,
  type ClusterHealthListItem,
  type RuntimeStatus,
} from "@/lib/api/cluster-health";
import type { Cluster } from "@/lib/api/types";
import { queryKeys } from "@/lib/query/keys";
import { buildTablePagination } from "@/lib/table/pagination";

export type ClusterTableRecord = Cluster & { key: string };

/**
 * 主流运行状态模型（单状态）：
 * - running: 已接入且探测通过
 * - offline: 已接入但探测失败
 * - checking: 正在探测或等待首个健康快照
 * - disabled: 生命周期停用
 * - offline-mode: 未接入 kubeconfig 的离线模式
 */
function resolveRuntimeStatus(
  row: ClusterTableRecord,
  health: ClusterHealthListItem | undefined,
): { kind: RuntimeStatus; label: string; color: string; icon: React.ReactNode; reason?: string } {
  if (health) {
    if (health.runtimeStatus === "running") {
      return {
        kind: "running",
        label: "运行中",
        color: "green",
        icon: <CheckCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "offline") {
      return {
        kind: "offline",
        label: "离线",
        color: "red",
        icon: <ExclamationCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "disabled") {
      return {
        kind: "disabled",
        label: "已停用",
        color: "default",
        icon: <PauseCircleOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    if (health.runtimeStatus === "offline-mode") {
      return {
        kind: "offline-mode",
        label: "离线模式",
        color: "processing",
        icon: <DisconnectOutlined />,
        reason: health.reason ?? undefined,
      };
    }
    return {
      kind: "checking",
      label: "探测中",
      color: "processing",
      icon: <ReloadOutlined spin />,
      reason: health.reason ?? "等待最新探测结果",
    };
  }

  if (row.state === "disabled") {
    return {
      kind: "disabled",
      label: "已停用",
      color: "default",
      icon: <PauseCircleOutlined />,
    };
  }

  if (!row.hasKubeconfig) {
    return {
      kind: "offline-mode",
      label: "离线模式",
      color: "processing",
      icon: <DisconnectOutlined />,
    };
  }

  return {
    kind: "checking",
    label: "探测中",
    color: "processing",
    icon: <ReloadOutlined spin />,
    reason: "等待首次健康快照",
  };
}

/** CPU/内存 进度条 */
function UsageBar({ value, color }: { value: number; color: string }) {
  return (
    <Tooltip title={`${value}%`}>
      <Progress
        percent={value}
        size="small"
        showInfo={false}
        strokeColor={color}
        style={{ width: 80, margin: 0 }}
      />
    </Tooltip>
  );
}

export default function ClustersPage() {
  const queryClient = useQueryClient();
  const { accessToken, isInitializing } = useAuth();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [environment, setEnvironment] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [detailOpen, setDetailOpen] = useState(false);
  const [selectedCluster, setSelectedCluster] = useState<ClusterTableRecord | null>(null);

  // Modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCluster, setEditingCluster] = useState<ClusterTableRecord | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [form] = Form.useForm<ClusterPayload>();

  // Per-row action loading states
  const [togglingId, setTogglingId] = useState<string>("");
  const [healthResults, setHealthResults] = useState<Record<string, ClusterHealthListItem>>({});

  const queryKey = queryKeys.clusters.list({
    keyword: keyword.trim(),
    environment: environment || undefined,
    page,
    pageSize,
    token: accessToken,
  });

  const query = useQuery({
    queryKey,
    queryFn: () =>
      getClusters(
        {
          keyword: keyword.trim(),
          environment: environment || undefined,
          page,
          pageSize,
        },
        accessToken,
      ),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const tableData = useMemo<ClusterTableRecord[]>(() => {
    // 已删除的集群完全不显示，直接从列表过滤掉
    return (query.data?.items ?? [])
      .filter((item) => item.state !== "deleted")
      .map((item) => ({ ...item, key: item.id }));
  }, [query.data]);

  const visibleTableData = useMemo<ClusterTableRecord[]>(() => {
    return tableData;
  }, [tableData]);

  const handleSearch = () => {
    setPage(1);
    setKeyword(keywordInput);
  };

  const refetchList = async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.clusters.all });
    await query.refetch();
    await refreshHealthSummaries(tableData);
  };

  const refreshHealthSummaries = useCallback(
    async (rows: ClusterTableRecord[]) => {
      if (!accessToken || rows.length === 0) {
        return;
      }
      const candidates = rows.filter((row) => row.state === "active" && row.hasKubeconfig);
      if (candidates.length === 0) {
        return;
      }

      const toCheckingSummary = (row: ClusterTableRecord, reason: string): ClusterHealthListItem => ({
        clusterId: row.id,
        clusterName: row.name,
        lifecycleState: row.state === "disabled" ? "disabled" : "active",
        runtimeStatus: "checking",
        ok: null,
        latencyMs: null,
        checkedAt: null,
        reason,
        source: null,
        isStale: true,
      });

      try {
        const response = await getClusterHealthList(
          {
            keyword: keyword.trim() || undefined,
            environment: environment || undefined,
            lifecycleState: undefined,
            runtimeStatus: undefined,
            page,
            pageSize,
          },
          accessToken,
        );

        const summaryById = new Map(response.items.map((item) => [item.clusterId, item]));
        setHealthResults((prev) => {
          const next = { ...prev };
          candidates.forEach((row) => {
            next[row.id] =
              summaryById.get(row.id) ??
              toCheckingSummary(row, "等待最新健康快照");
          });
          return next;
        });
      } catch (err) {
        const messageText = err instanceof Error ? err.message : "健康状态同步失败";
        setHealthResults((prev) => {
          const next = { ...prev };
          candidates.forEach((row) => {
            next[row.id] = toCheckingSummary(row, messageText);
          });
          return next;
        });
      }

    },
    [accessToken, environment, keyword, page, pageSize],
  );

  useEffect(() => {
    void refreshHealthSummaries(tableData);
  }, [tableData, refreshHealthSummaries]);

  useEffect(() => {
    if (!accessToken) {
      return;
    }
    const timer = window.setInterval(() => {
      void refreshHealthSummaries(tableData);
    }, 15000);
    return () => window.clearInterval(timer);
  }, [accessToken, tableData, refreshHealthSummaries]);

  const openAddModal = () => {
    setEditingCluster(null);
    form.resetFields();
    setModalOpen(true);
  };

  const openEditModal = (row: ClusterTableRecord) => {
    setEditingCluster(row);
    form.setFieldsValue({
      name: row.name,
      environment: row.environment,
      provider: row.provider,
      kubernetesVersion: row.kubernetesVersion,
      status: row.status,
      // 编辑时不回填 kubeconfig 原文（敏感字段）
      kubeconfig: undefined,
    });
    setModalOpen(true);
  };

  const handleModalCancel = () => {
    setModalOpen(false);
    form.resetFields();
  };

  const handleModalSubmit = async () => {
    let values: ClusterPayload;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    setSubmitting(true);
    try {
      if (editingCluster) {
        await updateCluster(editingCluster.id, values, accessToken);
        void message.success("集群更新成功");
      } else {
        await createCluster(values, accessToken);
        void message.success("集群创建成功");
      }
      setModalOpen(false);
      form.resetFields();
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (row: ClusterTableRecord) => {
    try {
      await deleteCluster(row.id, accessToken);
      void message.success("集群删除成功");
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    }
  };

  const handleToggleState = async (row: ClusterTableRecord) => {
    const isDisabled = row.state === "disabled";
    setTogglingId(row.id);
    try {
      if (isDisabled) {
        await enableCluster(row.id, accessToken);
        void message.success(`集群「${row.name}」已启用`);
      } else {
        await disableCluster(row.id, accessToken);
        void message.success(`集群「${row.name}」已停用`);
      }
      await refetchList();
    } catch (err) {
      void message.error(err instanceof Error ? err.message : "操作失败，请重试");
    } finally {
      setTogglingId("");
    }
  };

  const columns: TableProps<ClusterTableRecord>["columns"] = [
    {
      title: "集群名称",
      dataIndex: "name",
      key: "name",
      width: getAdaptiveNameWidth((query.data?.items ?? []).map((item) => item.name)),
      ellipsis: true,
      render: (name: string, row) => (
        <Space orientation="vertical" size={2}>
          <Typography.Link
            strong
            onClick={() => {
              setSelectedCluster(row);
              setDetailOpen(true);
            }}
          >
            {name}
          </Typography.Link>
          {row.hasKubeconfig && (
            <Tooltip title="查看 API Server 地址">
              <Typography.Text
                type="secondary"
                style={{ fontSize: 11, fontFamily: "monospace" }}
                copyable
              >
                {`https://${name}`}
              </Typography.Text>
            </Tooltip>
          )}
        </Space>
      ),
    },
    { title: "环境", dataIndex: "environment", key: "environment", width: 120 },
    { title: "供应商", dataIndex: "provider", key: "provider", width: 150 },
    { title: "K8s 版本", dataIndex: "kubernetesVersion", key: "kubernetesVersion", width: 120 },
    {
      title: "资源使用率",
      key: "usage",
      width: 220,
      render: (_: unknown, row: ClusterTableRecord) => (
        <Space orientation="vertical" size={2}>
          <Space size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 11, width: 30 }}>CPU</Typography.Text>
            <UsageBar value={row.cpuUsage} color={row.cpuUsage > 80 ? "#ff4d4f" : row.cpuUsage > 60 ? "#faad14" : "#52c41a"} />
            <Typography.Text style={{ fontSize: 11 }}>{row.cpuUsage}%</Typography.Text>
          </Space>
          <Space size={4}>
            <Typography.Text type="secondary" style={{ fontSize: 11, width: 30 }}>内存</Typography.Text>
            <UsageBar value={row.memoryUsage} color={row.memoryUsage > 80 ? "#ff4d4f" : row.memoryUsage > 60 ? "#faad14" : "#1677ff"} />
            <Typography.Text style={{ fontSize: 11 }}>{row.memoryUsage}%</Typography.Text>
          </Space>
        </Space>
      ),
    },
    {
      title: "运行状态",
      key: "state",
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: ClusterTableRecord) => {
        const runtimeStatus = resolveRuntimeStatus(
          row,
          healthResults[row.id],
        );
        return (
          <Tooltip title={runtimeStatus.reason ?? `状态：${runtimeStatus.label}`}>
            <Tag color={runtimeStatus.color} icon={runtimeStatus.icon}>
              {runtimeStatus.label}
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "接入状态",
      key: "hasKubeconfig",
      width: 120,
      render: (_: unknown, row: ClusterTableRecord) => {
        return row.hasKubeconfig ? (
          <Tooltip title="已配置 kubeconfig，工作负载数据将从集群实时同步">
            <Tag color="green" icon={<CloudServerOutlined />}>
              已接入
            </Tag>
          </Tooltip>
        ) : (
          <Tooltip title="未配置 kubeconfig，资源为手动录入模式">
            <Tag color="default" icon={<DisconnectOutlined />}>
              离线模式
            </Tag>
          </Tooltip>
        );
      },
    },
    {
      title: "操作",
      key: "actions",
      width: 92,
      align: "center",
      render: (_, row) => {
        const isDisabled = row.state === "disabled";
        const isDeleted = row.state === "deleted";
        const items: MenuProps["items"] = [
          !isDeleted
            ? {
                key: isDisabled ? "enable" : "disable",
                icon: isDisabled ? <PlayCircleOutlined /> : <PauseCircleOutlined />,
                danger: !isDisabled,
                label: isDisabled ? "启用" : "停用",
              }
            : null,
          {
            key: "edit",
            icon: <EditOutlined />,
            label: "编辑",
          },
          {
            type: "divider",
          },
          {
            key: "delete",
            icon: <DeleteOutlined />,
            danger: true,
            label: "删除",
          },
        ].filter(Boolean) as MenuProps["items"];

        return (
          <Dropdown
            trigger={["click"]}
            placement="bottomRight"
            menu={{
              items,
              onClick: ({ key }) => {
                if (key === "edit") {
                  openEditModal(row);
                  return;
                }
                if (key === "delete") {
                  Modal.confirm({
                    title: "删除集群",
                    content: `确认删除集群「${row.name}」吗？此操作不可恢复。`,
                    okText: "确认删除",
                    cancelText: "取消",
                    okButtonProps: { danger: true },
                    onOk: () => void handleDelete(row),
                  });
                  return;
                }
                if (key === "enable" || key === "disable") {
                  Modal.confirm({
                    title: key === "enable" ? "启用集群" : "停用集群",
                    content:
                      key === "enable"
                        ? `确认启用集群「${row.name}」？`
                        : `确认停用集群「${row.name}」？停用后集群不可操作但可恢复。`,
                    okText: key === "enable" ? "确认启用" : "确认停用",
                    cancelText: "取消",
                    okButtonProps: { danger: key === "disable" },
                    onOk: () => void handleToggleState(row),
                  });
                }
              },
            }}
            classNames={{ root: POD_ACTION_MENU_CLASS }}
          >
            <Button
              size="small"
              className={POD_ACTION_TRIGGER_CLASS}
              icon={<MoreOutlined />}
              aria-label="操作"
              loading={togglingId === row.id}
            />
          </Dropdown>
        );
      },
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Row align="middle" gutter={8}>
              <Col>
                <Typography.Title level={4} style={{ marginBottom: 4 }}>
                  集群管理
                </Typography.Title>
              </Col>
              <Col style={{ paddingBottom: 4 }}>
                <ResourceAddButton onClick={openAddModal} aria-label="新增集群" />
              </Col>
            </Row>
            <Typography.Text type="secondary">
              查看集群版本、资源使用率和运行状态。系统自动健康探测与资源同步，支持禁用/启用。
            </Typography.Text>
          </Col>
        </Row>
      </Card>

      <Card>
        <Row gutter={[12, 12]} align="middle">
          <Col xs={24} md={10} lg={8}>
            <Input
              allowClear
              placeholder="请输入关键字（名称/ID/供应商）"
              value={keywordInput}
              onChange={(e) => setKeywordInput(e.target.value)}
              onPressEnter={handleSearch}
            />
          </Col>
          <Col xs={24} sm={12} md={6} lg={5}>
            <Select
              className="resource-filter-select"
              style={{ width: "100%" }}
              value={environment}
              onChange={(value) => { setPage(1); setEnvironment(value); }}
              options={[
                { label: "全部环境", value: "" },
                { label: "公有云", value: "公有云" },
                { label: "私有云", value: "私有云" },
                { label: "本地", value: "本地" },
              ]}
            />
          </Col>
          <Col xs={24} md={8} lg={6}>
            <Space>
              <Button icon={<SearchOutlined />} type="primary" onClick={handleSearch}>
                查询
              </Button>
            </Space>
          </Col>
        </Row>
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再查看集群信息。" />
      ) : null}

      {query.isError ? (
        <Alert
          type="error"
          showIcon
          message="加载失败"
          description={query.error instanceof Error ? query.error.message : "获取集群数据时发生错误"}
        />
      ) : null}

      <Card>
        <Table<ClusterTableRecord>
          rowKey="key"
          columns={columns}
          dataSource={visibleTableData}
          loading={{ spinning: query.isLoading, description: "集群数据加载中..." }}
          scroll={{ x: getTableScrollX(columns) }}
          pagination={buildTablePagination({
            current: query.data?.page ?? page,
            pageSize: query.data?.pageSize ?? pageSize,
            total: query.data?.total ?? visibleTableData.length,
            onChange: (nextPage, nextPageSize) => {
              setPage(nextPage);
              if (nextPageSize !== pageSize) {
                setPageSize(nextPageSize);
                setPage(1);
              }
            },
          })}
          locale={{
            emptyText:
              query.isLoading ? "正在加载..." : <Empty description="暂无符合条件的集群数据" />,
          }}
        />
      </Card>

      <ClusterDetailDrawer
        open={detailOpen}
        onClose={() => setDetailOpen(false)}
        token={accessToken ?? undefined}
        cluster={selectedCluster}
        onRefreshRequest={() => void refetchList()}
      />

      <Modal
        title={editingCluster ? "编辑集群" : "添加集群"}
        open={modalOpen}
        onOk={() => void handleModalSubmit()}
        onCancel={handleModalCancel}
        okText={editingCluster ? "保存" : "创建"}
        cancelText="取消"
        confirmLoading={submitting}
        destroyOnHidden
        width={600}
      >
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 16, marginTop: 8 }}
          message="填写 KubeConfig 后平台将使用它连接真实集群，获取实时资源数据。不填写时集群以离线模式管理。"
        />
        <Form form={form} layout="vertical">
          <Form.Item
            label="集群名称"
            name="name"
            rules={[{ required: true, message: "请输入集群名称" }]}
          >
            <Input placeholder="例如：prod-cluster-01" />
          </Form.Item>
          <Form.Item
            label="环境"
            name="environment"
            rules={[{ required: true, message: "请选择环境" }]}
          >
            <Select
              placeholder="请选择环境"
              options={[
                { label: "公有云", value: "公有云" },
                { label: "私有云", value: "私有云" },
                { label: "本地", value: "本地" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="供应商"
            name="provider"
            rules={[{ required: true, message: "请输入供应商" }]}
          >
            <Input placeholder="例如：AWS / 阿里云 / 自建" />
          </Form.Item>
          <Form.Item
            label="K8s 版本"
            name="kubernetesVersion"
            rules={[{ required: true, message: "请输入 K8s 版本" }]}
          >
            <Input placeholder="例如：v1.28.4" />
          </Form.Item>
          <Form.Item label="状态" name="status">
            <Select
              placeholder="请选择状态（可选）"
              allowClear
              options={[
                { label: "正常", value: "正常" },
                { label: "告警", value: "告警" },
                { label: "维护", value: "维护" },
              ]}
            />
          </Form.Item>
          <Form.Item
            label="KubeConfig（YAML 格式）"
            name="kubeconfig"
            extra={
              editingCluster
                ? "如不修改 kubeconfig，留空即可；重新粘贴将覆盖原有配置。"
                : "粘贴 kubectl config view --raw 的输出内容，用于接入真实集群。"
            }
          >
            <Input.TextArea
              rows={6}
              placeholder={`粘贴 kubectl config view --raw 的输出内容，用于接入真实集群。\n\n示例：\napiVersion: v1\nclusters:\n- cluster:\n    server: https://...\n  name: my-cluster\n...`}
              style={{ fontFamily: "monospace", fontSize: 12 }}
            />
          </Form.Item>
        </Form>
      </Modal>
      {renderPodLikeResourceActionStyles({
        triggerClassName: POD_ACTION_TRIGGER_CLASS,
        menuClassName: POD_ACTION_MENU_CLASS,
      })}
    </Space>
  );
}
