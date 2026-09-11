"use client";

import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  LinkOutlined,
  PlusOutlined,
  ReloadOutlined,
  SettingOutlined,
  ThunderboltOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Select, Space, Switch, Table, Tabs, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { usePathname } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { getClusterIdFromPathname } from "@/lib/cluster-workspace";
import {
  OBSERVABILITY_KINDS,
  NOTIFICATION_CHANNELS,
  createAlertTemplate,
  createNotificationTemplate,
  createObservabilityDataSource,
  deleteAlertTemplate,
  deleteNotificationTemplate,
  deleteObservabilityDataSource,
  getObservabilityCatalog,
  listAlertTemplates,
  listNotificationTemplates,
  listObservabilityDataSources,
  testObservabilityDataSource,
  testObservabilityEndpoint,
  updateAlertTemplate,
  updateNotificationTemplate,
  updateObservabilityDataSource,
  type AlertTemplate,
  type AlertTemplateInput,
  type NotificationTemplate,
  type NotificationTemplateInput,
  type ObservabilityDataSource,
  type DataSourceInput,
} from "@/lib/api/observability-config";

type EditorState =
  | { type: "source"; record?: ObservabilityDataSource }
  | { type: "alert"; record?: AlertTemplate }
  | { type: "notification"; record?: NotificationTemplate };

const kindLabels: Record<string, string> = {
  prometheus: "Prometheus",
  grafana: "Grafana",
  alertmanager: "Alertmanager",
  elasticsearch: "Elasticsearch",
  kibana: "Kibana",
};
const channelLabels: Record<string, string> = {
  feishu: "飞书",
  dingtalk: "钉钉",
  wecom: "企业微信",
  email: "邮件",
  webhook: "Webhook",
  slack: "Slack",
  pagerduty: "PagerDuty",
};

function statusTag(status: ObservabilityDataSource["status"]) {
  const map = {
    healthy: ["success", "健康"],
    degraded: ["warning", "降级"],
    unavailable: ["danger", "不可用"],
    disabled: ["neutral", "已禁用"],
    unknown: ["info", "未检测"],
  } as const;
  const [tone, label] = map[status];
  return <OpsStatusTag tone={tone}>{label}</OpsStatusTag>;
}

export function ObservabilityConfiguration() {
  const pathname = usePathname();
  const clusterId = getClusterIdFromPathname(pathname);
  const { accessToken, isInitializing, role } = useAuth();
  const canWrite = role === "admin" || role === "platform-admin";
  const [messageApi, contextHolder] = message.useMessage();
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [form] = Form.useForm();
  const queryClient = useQueryClient();
  const enabled = !isInitializing && Boolean(accessToken);
  const sourcesQuery = useQuery({
    queryKey: ["observability", "config", "sources", clusterId, accessToken],
    queryFn: () => listObservabilityDataSources(clusterId || undefined, accessToken || undefined),
    enabled,
  });
  const alertsQuery = useQuery({
    queryKey: ["observability", "config", "alerts", accessToken],
    queryFn: () => listAlertTemplates(accessToken || undefined),
    enabled,
  });
  const notificationsQuery = useQuery({
    queryKey: ["observability", "config", "notifications", accessToken],
    queryFn: () => listNotificationTemplates(accessToken || undefined),
    enabled,
  });
  const catalogQuery = useQuery({
    queryKey: ["observability", "config", "catalog", accessToken],
    queryFn: () => getObservabilityCatalog(accessToken || undefined),
    enabled,
    staleTime: 10 * 60_000,
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.type === "source") {
      form.setFieldsValue(editor.record ?? { kind: "prometheus", enabled: true });
    } else if (editor.type === "alert") {
      form.setFieldsValue(editor.record ?? { severity: "warning", duration: "5m", enabled: true });
    } else {
      form.setFieldsValue(editor.record ?? { channel: "webhook", bodyTemplate: "{\"text\": \"{{message}}\"}", enabled: true });
    }
  }, [editor, form]);

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["observability", "config", "sources"] }),
      queryClient.invalidateQueries({ queryKey: ["observability", "config", "alerts"] }),
      queryClient.invalidateQueries({ queryKey: ["observability", "config", "notifications"] }),
    ]);
  };
  const saveMutation = useMutation({
    mutationFn: async (values: Record<string, unknown>) => {
      if (!editor) throw new Error("编辑器未打开");
      if (editor.type === "source") {
        const payload = { ...values, clusterId: clusterId || undefined } as DataSourceInput;
        return editor.record ? updateObservabilityDataSource(editor.record.id, payload, accessToken || undefined) : createObservabilityDataSource(payload, accessToken || undefined);
      }
      if (editor.type === "alert") {
        return editor.record ? updateAlertTemplate(editor.record.id, values as unknown as Partial<AlertTemplateInput>, accessToken || undefined) : createAlertTemplate(values as unknown as AlertTemplateInput, accessToken || undefined);
      }
      return editor.record ? updateNotificationTemplate(editor.record.id, values as unknown as Partial<NotificationTemplateInput>, accessToken || undefined) : createNotificationTemplate(values as unknown as NotificationTemplateInput, accessToken || undefined);
    },
    onSuccess: async () => {
      await invalidate();
      setEditor(null);
      messageApi.success("配置已保存");
    },
    onError: (error) => messageApi.error(error instanceof Error ? error.message : "保存失败"),
  });

  const remove = async (type: EditorState["type"], id: string) => {
    if (!canWrite) {
      messageApi.warning("当前账号只有观测配置只读权限。");
      return;
    }
    try {
      if (type === "source") await deleteObservabilityDataSource(id, accessToken || undefined);
      if (type === "alert") await deleteAlertTemplate(id, accessToken || undefined);
      if (type === "notification") await deleteNotificationTemplate(id, accessToken || undefined);
      await invalidate();
      messageApi.success("配置已删除");
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "删除失败");
    }
  };
  const testSource = async (record: ObservabilityDataSource) => {
    setTestingId(record.id);
    try {
      const result = record.id.startsWith("env-")
        ? await testObservabilityEndpoint(record.kind, record.endpoint, accessToken || undefined)
        : await testObservabilityDataSource(record.id, accessToken || undefined);
      messageApi[result.status === "healthy" ? "success" : "warning"](`${record.name}：${result.status}${result.latencyMs === null ? "" : ` · ${result.latencyMs} ms`}`);
      await sourcesQuery.refetch();
    } catch (error) {
      messageApi.error(error instanceof Error ? error.message : "探针失败");
    } finally {
      setTestingId(null);
    }
  };

  const sourceColumns = useMemo<ColumnsType<ObservabilityDataSource>>(() => [
    { title: "名称", dataIndex: "name", key: "name", render: (value: string, record) => <Space><Typography.Text strong>{value}</Typography.Text>{record.clusterId ? <Tag color="blue">当前集群</Tag> : <Tag>全局默认</Tag>}</Space> },
    { title: "类型", dataIndex: "kind", key: "kind", render: (value: string) => kindLabels[value] ?? value },
    { title: "状态", dataIndex: "status", key: "status", width: 110, render: statusTag },
    { title: "Endpoint", dataIndex: "endpoint", key: "endpoint", ellipsis: true, render: (value: string) => <Typography.Text code copyable>{value}</Typography.Text> },
    { title: "操作", key: "actions", width: 210, render: (_, record) => <Space size={4}><OpsIconActionButton size="small" icon={<ThunderboltOutlined />} loading={testingId === record.id} onClick={() => void testSource(record)}>探针</OpsIconActionButton>{record.id.startsWith("env-") ? null : <><OpsIconActionButton size="small" disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<EditOutlined />} onClick={() => setEditor({ type: "source", record })}>编辑</OpsIconActionButton><OpsIconActionButton size="small" danger disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<DeleteOutlined />} onClick={() => void remove("source", record.id)}>删除</OpsIconActionButton></>}</Space> },
  ], [canWrite, testingId]);
  const alertColumns = useMemo<ColumnsType<AlertTemplate>>(() => [
    { title: "规则名称", dataIndex: "name", key: "name", render: (value: string, record) => <Space><Typography.Text strong>{value}</Typography.Text>{record.enabled ? <OpsStatusTag tone="success">启用</OpsStatusTag> : <OpsStatusTag tone="neutral">停用</OpsStatusTag>}</Space> },
    { title: "级别", dataIndex: "severity", key: "severity", width: 110, render: (value: string) => <Tag color={value === "critical" ? "red" : value === "warning" ? "orange" : "blue"}>{value}</Tag> },
    { title: "表达式", dataIndex: "expression", key: "expression", ellipsis: true, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: "操作", key: "actions", width: 160, render: (_, record) => <Space size={4}><OpsIconActionButton size="small" disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<EditOutlined />} onClick={() => setEditor({ type: "alert", record })}>编辑</OpsIconActionButton><OpsIconActionButton size="small" danger disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<DeleteOutlined />} onClick={() => void remove("alert", record.id)}>删除</OpsIconActionButton></Space> },
  ], [canWrite]);
  const notificationColumns = useMemo<ColumnsType<NotificationTemplate>>(() => [
    { title: "通知名称", dataIndex: "name", key: "name", render: (value: string, record) => <Space><Typography.Text strong>{value}</Typography.Text>{record.enabled ? <OpsStatusTag tone="success">启用</OpsStatusTag> : <OpsStatusTag tone="neutral">停用</OpsStatusTag>}</Space> },
    { title: "渠道", dataIndex: "channel", key: "channel", width: 120, render: (value: string) => channelLabels[value] ?? value },
    { title: "Endpoint", dataIndex: "endpoint", key: "endpoint", ellipsis: true, render: (value: string) => <Typography.Text code>{value}</Typography.Text> },
    { title: "操作", key: "actions", width: 160, render: (_, record) => <Space size={4}><OpsIconActionButton size="small" disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<EditOutlined />} onClick={() => setEditor({ type: "notification", record })}>编辑</OpsIconActionButton><OpsIconActionButton size="small" danger disabled={!canWrite} disabledReason={!canWrite ? "当前账号无写入权限" : undefined} icon={<DeleteOutlined />} onClick={() => void remove("notification", record.id)}>删除</OpsIconActionButton></Space> },
  ], [canWrite]);

  const editorTitle = editor?.type === "source" ? "数据源" : editor?.type === "alert" ? "告警规则" : "通知模板";
  return (
    <div className="resource-workbench" style={{ display: "grid", gap: 16 }}>
      {contextHolder}
      <OpsSurface variant="panel" padding="sm">
        <ResourcePageHeader
          path={pathname}
          embedded
          title={<Space><SettingOutlined style={{ color: "#1677ff" }} />观测配置</Space>}
          description={clusterId ? "配置当前集群的数据源、告警规则与通知策略" : "配置平台级可观测性数据源、告警规则与通知策略"}
          extra={<Space><OpsIconActionButton icon={<ReloadOutlined />} loading={sourcesQuery.isFetching || alertsQuery.isFetching || notificationsQuery.isFetching} onClick={() => void Promise.all([sourcesQuery.refetch(), alertsQuery.refetch(), notificationsQuery.refetch()])}>刷新</OpsIconActionButton></Space>}
        />
      </OpsSurface>
      {!enabled ? <Alert type="warning" showIcon title="请先登录后管理观测配置。" /> : null}
      {enabled && !canWrite ? <Alert type="info" showIcon title="当前账号为只读角色，可查看和探测观测状态；修改配置需要管理员权限。" /> : null}
      {catalogQuery.isError ? <Alert type="warning" showIcon title="观测目录加载失败，将使用内置选项。" /> : null}
      <OpsSurface variant="panel" padding="sm">
        <Tabs items={[
          { key: "sources", label: "数据源", children: <><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><Typography.Text type="secondary">Prometheus、Grafana、Alertmanager、Elasticsearch、Kibana 的连接配置。</Typography.Text><Button type="primary" disabled={!canWrite} icon={<PlusOutlined />} onClick={() => setEditor({ type: "source" })}>添加数据源</Button></div><Table rowKey="id" size="small" loading={sourcesQuery.isLoading} columns={sourceColumns} dataSource={sourcesQuery.data?.items ?? []} pagination={false} locale={{ emptyText: "尚未配置数据源" }} /></> },
          { key: "alerts", label: "告警规则", children: <><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><Typography.Text type="secondary">规则表达式原样保存，后续由 PrometheusRule 渲染器发布。</Typography.Text><Button type="primary" disabled={!canWrite} icon={<PlusOutlined />} onClick={() => setEditor({ type: "alert" })}>添加告警规则</Button></div><Table rowKey="id" size="small" loading={alertsQuery.isLoading} columns={alertColumns} dataSource={alertsQuery.data?.items ?? []} pagination={false} locale={{ emptyText: "尚未配置告警规则" }} /></> },
          { key: "notifications", label: "通知模板", children: <><div style={{ display: "flex", justifyContent: "space-between", marginBottom: 12 }}><Typography.Text type="secondary">通知凭据只引用 Secret，不在平台中保存明文。</Typography.Text><Button type="primary" disabled={!canWrite} icon={<PlusOutlined />} onClick={() => setEditor({ type: "notification" })}>添加通知模板</Button></div><Table rowKey="id" size="small" loading={notificationsQuery.isLoading} columns={notificationColumns} dataSource={notificationsQuery.data?.items ?? []} pagination={false} locale={{ emptyText: "尚未配置通知模板" }} /></> },
        ]} />
      </OpsSurface>
      <Modal title={`${editor?.record ? "编辑" : "添加"}${editorTitle ?? "配置"}`} open={Boolean(editor)} onCancel={() => setEditor(null)} okText="保存" cancelText="取消" confirmLoading={saveMutation.isPending} onOk={() => void form.validateFields().then((values) => saveMutation.mutate(values)).catch(() => undefined)} destroyOnHidden>
        {editor?.type === "source" ? <Form form={form} layout="vertical"><Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}><Input placeholder="production-prometheus" /></Form.Item><Form.Item name="kind" label="类型" rules={[{ required: true }]}><Select options={(catalogQuery.data?.dataSourceKinds ?? [...OBSERVABILITY_KINDS]).map((value) => ({ value, label: kindLabels[value] ?? value }))} /></Form.Item><Form.Item name="endpoint" label="Endpoint" rules={[{ required: true, type: "url", message: "请输入合法的 HTTP(S) 地址" }]}><Input prefix={<LinkOutlined />} placeholder="https://prometheus.example.com" /></Form.Item><Form.Item name="secretRef" label="Secret 引用"><Input placeholder="namespace/secret-name" /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Form> : null}
        {editor?.type === "alert" ? <Form form={form} layout="vertical"><Form.Item name="name" label="规则名称" rules={[{ required: true, message: "请输入规则名称" }]}><Input placeholder="HighPodRestartRate" /></Form.Item><Form.Item name="severity" label="级别" rules={[{ required: true }]}><Select options={[{ value: "critical", label: "严重" }, { value: "warning", label: "风险" }, { value: "info", label: "提示" }]} /></Form.Item><Form.Item name="expression" label="PromQL 表达式" rules={[{ required: true, message: "请输入 PromQL" }]}><Input.TextArea rows={4} placeholder={'sum(rate(kube_pod_container_status_restarts_total[5m])) > 1'} /></Form.Item><Form.Item name="duration" label="持续时间"><Input placeholder="5m" /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Form> : null}
        {editor?.type === "notification" ? <Form form={form} layout="vertical"><Form.Item name="name" label="通知名称" rules={[{ required: true, message: "请输入通知名称" }]}><Input placeholder="平台告警通知" /></Form.Item><Form.Item name="channel" label="渠道" rules={[{ required: true }]}><Select options={(catalogQuery.data?.notificationChannels ?? [...NOTIFICATION_CHANNELS]).map((value) => ({ value, label: channelLabels[value] ?? value }))} /></Form.Item><Form.Item name="endpoint" label="Endpoint" rules={[{ required: true, type: "url", message: "请输入合法的 HTTP(S) 地址" }]}><Input placeholder="https://open.feishu.cn/..." /></Form.Item><Form.Item name="secretRef" label="Secret 引用"><Input placeholder="namespace/secret-name" /></Form.Item><Form.Item name="bodyTemplate" label="消息模板" rules={[{ required: true, message: "请输入消息模板" }]}><Input.TextArea rows={5} /></Form.Item><Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item></Form> : null}
      </Modal>
    </div>
  );
}
