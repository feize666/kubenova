"use client";

import {
  CheckCircleOutlined,
  DeleteOutlined,
  EditOutlined,
  ExperimentOutlined,
  PlusOutlined,
  RobotOutlined,
} from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space, Switch, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useCallback, useMemo, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsFilterChip, OpsIconActionButton, OpsMetricTile, OpsStatusTag, OpsSurface } from "@/components/ops";
import {
  createAiProvider,
  deleteAiProvider,
  listAiProviderCatalog,
  listAiProviders,
  testAiProvider,
  updateAiProvider,
  type AiProvider,
  type AiProviderInput,
} from "@/lib/api/ai-assistant";

type ProviderFormValues = AiProviderInput & { maxTokens?: number; timeoutMs?: number };

function maskKey(provider: AiProvider) {
  if (!provider.apiKeyConfigured) return "未配置";
  return provider.apiKeyLast4 ? `已配置 ····${provider.apiKeyLast4}` : "已配置";
}

export function AiProviderSettings() {
  const { accessToken } = useAuth();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const [form] = Form.useForm<ProviderFormValues>();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);

  const catalogQuery = useQuery({
    queryKey: ["ai", "provider-catalog", accessToken],
    queryFn: () => listAiProviderCatalog(accessToken || undefined),
    enabled: Boolean(accessToken),
    staleTime: 10 * 60_000,
  });
  const providersQuery = useQuery({
    queryKey: ["ai", "providers", accessToken],
    queryFn: () => listAiProviders(accessToken || undefined),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  });
  const providers = useMemo(() => providersQuery.data ?? [], [providersQuery.data]);
  const catalog = useMemo(() => catalogQuery.data ?? [], [catalogQuery.data]);

  const refreshProviders = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ["ai", "providers", accessToken] });
  }, [accessToken, queryClient]);

  const saveMutation = useMutation({
    mutationFn: async (values: ProviderFormValues) => {
      const payload: AiProviderInput = {
        name: values.name.trim(),
        vendor: values.vendor,
        baseUrl: values.baseUrl.trim(),
        modelName: values.modelName.trim(),
        enabled: values.enabled,
        isDefault: values.isDefault,
        config: {
          maxTokens: values.maxTokens ?? 2048,
          timeoutMs: values.timeoutMs ?? 30000,
        },
      };
      if (values.apiKey?.trim()) payload.apiKey = values.apiKey.trim();
      return editing
        ? updateAiProvider(editing.id, payload, accessToken || undefined)
        : createAiProvider(payload, accessToken || undefined);
    },
    onSuccess: () => {
      message.success(editing ? "AI Provider 已更新" : "AI Provider 已添加");
      setDrawerOpen(false);
      setEditing(null);
      form.resetFields();
      refreshProviders();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "保存 AI Provider 失败"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteAiProvider(id, accessToken || undefined),
    onSuccess: () => {
      message.success("AI Provider 已删除");
      refreshProviders();
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "删除 AI Provider 失败"),
  });

  const openCreate = useCallback(() => {
    setEditing(null);
    form.resetFields();
    const first = catalog[0];
    form.setFieldsValue({
      name: first ? `${first.label} 主模型` : "默认 AI 模型",
      vendor: first?.id ?? "openai",
      baseUrl: first?.defaultBaseUrl ?? "https://api.openai.com/v1",
      modelName: "gpt-4o-mini",
      enabled: true,
      isDefault: providers.length === 0,
      maxTokens: 2048,
      timeoutMs: 30000,
    });
    setDrawerOpen(true);
  }, [catalog, form, providers.length]);

  const openEdit = useCallback((provider: AiProvider) => {
    setEditing(provider);
    form.setFieldsValue({
      name: provider.name,
      vendor: provider.vendor,
      baseUrl: provider.baseUrl,
      modelName: provider.modelName,
      apiKey: "",
      enabled: provider.enabled,
      isDefault: provider.isDefault,
      maxTokens: typeof provider.config?.maxTokens === "number" ? provider.config.maxTokens : 2048,
      timeoutMs: typeof provider.config?.timeoutMs === "number" ? provider.config.timeoutMs : 30000,
    });
    setDrawerOpen(true);
  }, [form]);

  const runTest = useCallback(async (provider: AiProvider) => {
    setTestingId(provider.id);
    try {
      const result = await testAiProvider(provider.id, accessToken || undefined);
      if (result.ok) message.success(`${provider.name} 连接成功（${result.latencyMs}ms）`);
      else message.error(`${provider.name} 连接失败：${result.message}`);
    } catch (error) {
      message.error(error instanceof Error ? error.message : "连接测试失败");
    } finally {
      setTestingId(null);
    }
  }, [accessToken, message]);

  const columns = useMemo<ColumnsType<AiProvider>>(() => [
    {
      title: "Provider",
      key: "name",
      render: (_, provider) => (
        <Space size={10}>
          <span className="ai-provider-settings__provider-icon"><RobotOutlined /></span>
          <span>
            <Typography.Text strong>{provider.name}</Typography.Text>
            <br />
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>{provider.vendor} · {provider.modelName}</Typography.Text>
          </span>
        </Space>
      ),
    },
    { title: "Base URL", dataIndex: "baseUrl", key: "baseUrl", ellipsis: true },
    { title: "API Key", key: "apiKey", width: 150, render: (_, provider) => <OpsStatusTag tone={provider.apiKeyConfigured ? "success" : "warning"}>{maskKey(provider)}</OpsStatusTag> },
    { title: "状态", key: "status", width: 130, render: (_, provider) => <Space size={4}>{provider.isDefault ? <OpsFilterChip tone="info">默认</OpsFilterChip> : null}<OpsStatusTag tone={provider.enabled ? "success" : "neutral"}>{provider.enabled ? "启用" : "停用"}</OpsStatusTag></Space> },
    {
      title: "操作",
      key: "actions",
      width: 210,
      render: (_, provider) => (
        <Space size={4}>
          <OpsIconActionButton size="small" icon={<ExperimentOutlined />} loading={testingId === provider.id} onClick={() => void runTest(provider)}>测试</OpsIconActionButton>
          <OpsIconActionButton size="small" icon={<EditOutlined />} onClick={() => openEdit(provider)}>编辑</OpsIconActionButton>
          <OpsIconActionButton size="small" danger icon={<DeleteOutlined />} onClick={() => modal.confirm({ title: "删除 AI Provider？", content: `删除后使用该 Provider 的 Agent 将无法调用。`, okText: "删除", cancelText: "取消", okButtonProps: { danger: true }, onOk: () => deleteMutation.mutateAsync(provider.id) })}>删除</OpsIconActionButton>
        </Space>
      ),
    },
  ], [deleteMutation, modal, openEdit, runTest, testingId]);

  return (
    <Space direction="vertical" size={16} style={{ width: "100%" }}>
      <Alert
        type="info"
        showIcon
        icon={<CheckCircleOutlined />}
        message="AI 配置集中管理"
        description="Key 仅以加密密文保存，页面只展示末四位。可配置 OpenAI、Claude、Gemini、通义千问、火山引擎、DeepSeek 及 OpenAI 兼容服务。"
      />
      <div className="ai-provider-settings__metrics">
        <OpsMetricTile label="Provider 总数" value={providers.length} tone="info" />
        <OpsMetricTile label="已启用" value={providers.filter((item) => item.enabled).length} tone="success" />
        <OpsMetricTile label="默认 Provider" value={providers.find((item) => item.isDefault)?.name ?? "未设置"} tone="neutral" />
      </div>
      <OpsSurface variant="panel" padding="sm" title="模型与密钥">
        <div className="ai-provider-settings__toolbar">
          <Typography.Text type="secondary">对话、集群分析和故障诊断统一使用默认 Provider。</Typography.Text>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>添加 Provider</Button>
        </div>
        <Table<AiProvider> rowKey="id" columns={columns} dataSource={providers} loading={providersQuery.isLoading} pagination={false} locale={{ emptyText: "尚未配置 AI Provider，请先添加一个模型服务" }} />
      </OpsSurface>
      <Drawer
        title={editing ? "编辑 AI Provider" : "添加 AI Provider"}
        open={drawerOpen}
        width={460}
        destroyOnClose
        onClose={() => { setDrawerOpen(false); setEditing(null); form.resetFields(); }}
        extra={<OpsStatusTag tone="info">密钥加密存储</OpsStatusTag>}
        footer={<Space style={{ width: "100%", justifyContent: "flex-end" }}><Button onClick={() => setDrawerOpen(false)}>取消</Button><Button type="primary" loading={saveMutation.isPending} onClick={() => void form.submit()}>保存配置</Button></Space>}
      >
        <Form<ProviderFormValues> form={form} layout="vertical" onFinish={(values) => saveMutation.mutate(values)}>
          <Form.Item name="name" label="配置名称" rules={[{ required: true, message: "请输入配置名称" }]}><Input placeholder="生产环境 AI" /></Form.Item>
          <Form.Item name="vendor" label="AI 厂商" rules={[{ required: true, message: "请选择厂商" }]}>
            <Select showSearch optionFilterProp="label" options={catalog.map((item) => ({ value: item.id, label: item.label, baseUrl: item.defaultBaseUrl }))} onChange={(value) => { const item = catalog.find((entry) => entry.id === value); if (item && !editing) form.setFieldValue("baseUrl", item.defaultBaseUrl); }} />
          </Form.Item>
          <Form.Item name="baseUrl" label="Base URL" rules={[{ required: true, message: "请输入 Base URL" }, { type: "url", message: "请输入合法的 HTTP(S) 地址" }]}><Input placeholder="https://api.openai.com/v1" /></Form.Item>
          <Form.Item name="modelName" label="模型名称" rules={[{ required: true, message: "请输入模型名称" }]}><Input placeholder="gpt-4o-mini" /></Form.Item>
          <Form.Item name="apiKey" label="API Key" extra={editing ? "留空表示保留当前 Key" : "Key 将加密保存，不会回显"}><Input.Password autoComplete="new-password" placeholder={editing && editing.apiKeyConfigured ? `当前 Key ····${editing.apiKeyLast4}` : "输入 API Key"} /></Form.Item>
          <Space size={24}>
            <Form.Item name="enabled" label="启用" valuePropName="checked"><Switch /></Form.Item>
            <Form.Item name="isDefault" label="设为默认" valuePropName="checked"><Switch /></Form.Item>
          </Space>
          <Form.Item name="maxTokens" label="最大 Tokens"><InputNumber min={128} max={131072} step={256} style={{ width: "100%" }} /></Form.Item>
          <Form.Item name="timeoutMs" label="请求超时（毫秒）"><InputNumber min={3000} max={180000} step={1000} style={{ width: "100%" }} /></Form.Item>
        </Form>
      </Drawer>
    </Space>
  );
}
