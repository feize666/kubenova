"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Form, Input, InputNumber, Modal, Row, Segmented, Select, Space, Table, Tag, Typography, message } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { getClusters } from "@/lib/api/clusters";
import { getNamespaces } from "@/lib/api/namespaces";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import {
  createDynamicResource,
  deleteDynamicResource,
  getDynamicResourceDetail,
  getDynamicResources,
  refreshResourceDiscovery,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
} from "@/lib/api/resources";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type GatewayKindKey = "gatewayclass" | "gateway" | "httproute";

const GATEWAY_KIND_OPTIONS: Array<{ label: string; value: GatewayKindKey }> = [
  { label: "GatewayClass", value: "gatewayclass" },
  { label: "Gateway", value: "gateway" },
  { label: "HTTPRoute", value: "httproute" },
];

const GATEWAY_KIND_META: Record<
  GatewayKindKey,
  { title: string; resource: string; version: string; namespaced: boolean; description: string }
> = {
  gatewayclass: {
    title: "GatewayClass",
    resource: "gatewayclasses",
    version: "v1",
    namespaced: false,
    description: "管理 GatewayClass 实现类",
  },
  gateway: {
    title: "Gateway",
    resource: "gateways",
    version: "v1",
    namespaced: true,
    description: "管理 Gateway 监听与入口",
  },
  httproute: {
    title: "HTTPRoute",
    resource: "httproutes",
    version: "v1",
    namespaced: true,
    description: "管理 HTTP 路由规则",
  },
};

type GatewayRow = DynamicResourceItem;

interface GatewayFormValues {
  name: string;
  namespace: string;
  gatewayClassName: string;
  controllerName?: string;
  parametersGroup?: string;
  parametersKind?: string;
  parametersName?: string;
  addressType?: string;
  addresses?: string;
  listenerName?: string;
  listenerPort?: number;
  listenerProtocol?: string;
  listenerHostname?: string;
  allowedRoutesFrom?: "All" | "Same" | "Selector" | "None";
  allowedRoutesNamespaces?: string;
}

interface HttpRouteFormValues {
  name: string;
  namespace: string;
  parentGatewayName: string;
  hostnames?: string;
  matchPath?: string;
  pathType?: string;
  backendServiceName?: string;
  backendServicePort?: number;
  backendWeight?: number;
  headerName?: string;
  headerValue?: string;
}

export default function GatewayApiPage() {
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const lastDiscoveryRefreshAtRef = useRef<Record<string, number>>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [kind, setKind] = useState<GatewayKindKey>("gatewayclass");
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [yamlOpen, setYamlOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<GatewayFormValues & HttpRouteFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<GatewayRow>({
    defaultPageSize: 10,
  });

  const kindMeta = GATEWAY_KIND_META[kind];
  const canCreate = Boolean(clusterId);

  const clustersQuery = useQuery({
    queryKey: ["gateway-api", "clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const namespacesQuery = useQuery({
    queryKey: ["gateway-api", "namespaces", clusterId || "all", accessToken],
    queryFn: () => getNamespaces({ clusterId: clusterId || undefined, page: 1, pageSize: 500 }, accessToken ?? undefined),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });

  const listQuery = useQuery({
    queryKey: [
      "gateway-api",
      kind,
      clusterId || "all",
      namespace,
      keyword,
      pagination.pageIndex + 1,
      pagination.pageSize,
      sortBy,
      sortOrder,
      accessToken,
    ],
    queryFn: () =>
      // TODO: backend must accept omitted clusterId for the all-clusters default view.
      getDynamicResources(
        {
          clusterId: clusterId || undefined,
          group: "gateway.networking.k8s.io",
          version: kindMeta.version,
          resource: kindMeta.resource,
          namespace: namespace || undefined,
          keyword: keyword || undefined,
          page: pagination.pageIndex + 1,
          pageSize: pagination.pageSize,
          sortBy: sortBy || undefined,
          sortOrder: sortOrder || undefined,
        },
        accessToken ?? undefined,
      ),
    enabled: Boolean(accessToken),
    ...RESOURCE_LIST_REFRESH_OPTIONS,
  });

  const refreshDiscoveryMutation = useMutation({
    mutationFn: () => {
      if (!clusterId) {
        throw new Error("请先选择集群后再刷新资源发现");
      }
      return refreshResourceDiscovery(clusterId, accessToken ?? undefined);
    },
    onSuccess: async () => {
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "刷新资源发现失败");
    },
  });

  useEffect(() => {
    if (!accessToken || !clusterId || refreshDiscoveryMutation.isPending) {
      return;
    }

    const now = Date.now();
    const lastTriggeredAt = lastDiscoveryRefreshAtRef.current[clusterId] ?? 0;
    if (now - lastTriggeredAt < 5 * 60 * 1000) {
      return;
    }

    lastDiscoveryRefreshAtRef.current[clusterId] = now;
    refreshDiscoveryMutation.mutate();
  }, [accessToken, clusterId, refreshDiscoveryMutation]);

  const openYamlMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => getDynamicResourceDetail(identity, accessToken ?? undefined),
    onSuccess: (detail, identity) => {
      setYamlTarget({
        clusterId: identity.clusterId,
        namespace: identity.namespace ?? "",
        kind: identity.resource,
        name: identity.name,
      });
      setYamlOpen(true);
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "读取 YAML 失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => deleteDynamicResource(identity, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success("资源已删除");
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const createMutation = useMutation({
    mutationFn: (payload: {
      clusterId: string;
      group: string;
      version: string;
      resource: string;
      namespace: string;
      name: string;
      body: Record<string, unknown>;
    }) => createDynamicResource(payload, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success(`${kindMeta.title} 创建成功`);
      setCreateOpen(false);
      createForm.resetFields();
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "创建失败，请重试");
    },
  });

  const rows = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const knownNamespaces = useMemo(
    () =>
      Array.from(
        new Set([
          ...(namespacesQuery.data?.items ?? []).map((item) => item.namespace),
          ...rows.map((item) => item.namespace),
        ].filter(Boolean)),
      ).sort(),
    [namespacesQuery.data?.items, rows],
  );
  const tableData = useMemo(
    () =>
      rows.filter(
        (item) =>
          (mergedFilters.length === 0
            ? true
            : mergedFilters.every((filter) =>
                Object.entries(item.labels ?? {}).some(([key, value]) =>
                  `${key}=${value}`.toLowerCase().includes(filter.toLowerCase()),
                ),
              )),
      ),
    [rows, mergedFilters],
  );
  const nameWidth = useMemo(
    () => getAdaptiveNameWidth(tableData.map((item) => item.name), { max: 320 }),
    [tableData],
  );

  const handleSearch = () => {
    const parsed = keywordInput
      .split(/\s+/)
      .map((item) => item.trim())
      .filter(Boolean);
    resetPage();
    setMergedFilters(parsed);
    setKeyword(parsed.filter((item) => !item.includes("=")).join(" "));
  };

  const handleCreateSubmit = async () => {
    let values: GatewayFormValues & HttpRouteFormValues;
    try {
      values = await createForm.validateFields();
    } catch {
      return;
    }

    if (kind === "gateway") {
      const addressValue = values.addresses?.trim();
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "gateways",
        namespace: values.namespace,
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "Gateway",
          metadata: { name: values.name, namespace: values.namespace },
          spec: {
            gatewayClassName: values.gatewayClassName,
            ...(values.addressType && addressValue
              ? { addresses: [{ type: values.addressType, value: addressValue }] }
              : {}),
            listeners: [
              {
                name: values.listenerName || "http",
                port: values.listenerPort || 80,
                protocol: values.listenerProtocol || "HTTP",
                ...(values.listenerHostname?.trim()
                  ? { hostname: values.listenerHostname.trim() }
                  : {}),
                ...(values.allowedRoutesNamespaces
                  ? {
                      allowedRoutes: {
                        namespaces: {
                          from: values.allowedRoutesFrom || "Selector",
                          ...(values.allowedRoutesFrom === "Selector"
                            ? {
                                selector: {
                                  matchExpressions: [
                                    {
                                      key: "kubernetes.io/metadata.name",
                                      operator: "In",
                                      values: values.allowedRoutesNamespaces.split(/\s+/).filter(Boolean),
                                    },
                                  ],
                                },
                              }
                            : {}),
                        },
                      },
                    }
                  : {}),
              },
            ],
          },
        },
      });
      return;
    }

    if (kind === "gatewayclass") {
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "gatewayclasses",
        namespace: "",
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "GatewayClass",
          metadata: { name: values.name },
          spec: {
            controllerName: values.controllerName || values.gatewayClassName,
            ...(values.parametersGroup && values.parametersKind && values.parametersName
              ? {
                  parametersRef: {
                    group: values.parametersGroup,
                    kind: values.parametersKind,
                    name: values.parametersName,
                  },
                }
              : {}),
          },
        },
      });
      return;
    }

    if (kind === "httproute") {
      const hostnames = values.hostnames ? values.hostnames.split(/\s+/).filter(Boolean) : [];
      createMutation.mutate({
        clusterId,
        group: "gateway.networking.k8s.io",
        version: "v1",
        resource: "httproutes",
        namespace: values.namespace,
        name: values.name,
        body: {
          apiVersion: "gateway.networking.k8s.io/v1",
          kind: "HTTPRoute",
          metadata: { name: values.name, namespace: values.namespace },
          spec: {
            parentRefs: [{ name: values.parentGatewayName }],
            ...(hostnames.length > 0 ? { hostnames } : {}),
            rules: [
              {
                matches: values.matchPath
                  ? [{ path: { type: values.pathType || "PathPrefix", value: values.matchPath } }]
                  : [{ path: { type: "PathPrefix", value: "/" } }],
                backendRefs: [
                  {
                    name: values.backendServiceName || "kubernetes",
                    port: values.backendServicePort || 80,
                    ...(values.backendWeight !== undefined ? { weight: values.backendWeight } : {}),
                  },
                ],
                ...(values.headerName && values.headerValue
                  ? {
                      filters: [
                        {
                          type: "RequestHeaderModifier",
                          requestHeaderModifier: {
                            add: [{ name: values.headerName, value: values.headerValue }],
                          },
                        },
                      ],
                    }
                  : {}),
              },
            ],
          },
        },
      });
    }
  };

  const columns: ColumnsType<GatewayRow> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", listQuery.isLoading),
      render: (value: string, row) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind, id: row.id })}>
            {value}
          </Typography.Link>
        ) : (
          value
        ),
    },
    {
      title: "集群",
      key: "clusterId",
      width: TABLE_COL_WIDTH.cluster,
      ...getSortableColumnProps("clusterId", listQuery.isLoading),
      render: (_: unknown, row) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", listQuery.isLoading),
      render: (value: string) => value || "-",
    },
    {
      title: "标签",
      key: "labels",
      render: (_: unknown, row) => {
        const entries = Object.entries(row.labels ?? {}).slice(0, 3);
        return entries.length > 0 ? (
          <Space wrap size={[4, 4]}>
            {entries.map(([key, value]) => (
              <Tag key={`${row.id}-${key}`}>{`${key}=${value}`}</Tag>
            ))}
          </Space>
        ) : (
          "-"
        );
      },
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      ...getSortableColumnProps("updatedAt", listQuery.isLoading),
      render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle={`删除 ${kindMeta.title}`}
          deleteContent={`确认删除 ${kindMeta.title}「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            openYamlMutation.mutate({
              clusterId: row.clusterId,
              namespace: row.namespace,
              group: "gateway.networking.k8s.io",
              version: kindMeta.version,
              resource: kindMeta.resource,
              name: row.name,
            })
          }
          onDelete={() =>
            deleteMutation.mutate({
              clusterId: row.clusterId,
              namespace: row.namespace,
              group: "gateway.networking.k8s.io",
              version: kindMeta.version,
              resource: kindMeta.resource,
              name: row.name,
            })
          }
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/network/gateway-api"
        titleZh="Gateway API"
        titleEn="Gateway API"
        description="管理 GatewayClass、Gateway 与 HTTPRoute 资源。"
        titleSuffix={
          <Button
            type="primary"
            disabled={!canCreate}
            onClick={() => {
              if (!clusterId) {
                void message.error("请先选择集群后再新增资源");
                return;
              }
              createForm.resetFields();
              setCreateOpen(true);
            }}
          >
            新增资源
          </Button>
        }
      />

      <Card>
        <Row gutter={[12, 12]} style={{ marginBottom: 14 }}>
          <Col span={24}>
            <Segmented
              value={kind}
              options={GATEWAY_KIND_OPTIONS}
              block
              style={{ width: "100%" }}
              onChange={(value) => {
                setKind(value as GatewayKindKey);
                resetPage();
                setKeyword("");
                setKeywordInput("");
              }}
            />
          </Col>
        </Row>
        <NetworkResourcePageFilters
          clusterId={clusterId}
          namespace={namespace}
          keywordInput={keywordInput}
          clusterOptions={clusterOptions}
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
          keywordPlaceholder="按名称/标签搜索"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未登录或登录初始化中，请稍后重试。" style={{ marginBottom: 16 }} />
        ) : null}

        {listQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message={`${kindMeta.title} 列表加载失败`}
            description={listQuery.error instanceof Error ? listQuery.error.message : "unknown"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<GatewayRow>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={listQuery.isLoading}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, listQuery.isLoading)
          }
          pagination={getPaginationConfig(listQuery.data?.total ?? 0, listQuery.isLoading)}
          scroll={{ x: getTableScrollX(columns) }}
          onRow={(record) => ({
            onClick: () => {
              if (record.id) {
                setDetailTarget({ kind, id: record.id });
              }
            },
          })}
        />
      </Card>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => setDetailTarget(request)}
      />

      <ResourceYamlDrawer
        open={yamlOpen}
        onClose={() => setYamlOpen(false)}
        token={accessToken ?? undefined}
        identity={yamlTarget}
        onUpdated={() => void listQuery.refetch()}
      />

      <Modal
        title={`新增 ${kindMeta.title}`}
        open={createOpen}
        onOk={() => void handleCreateSubmit()}
        onCancel={() => setCreateOpen(false)}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
        destroyOnHidden
      >
        <Form form={createForm} layout="vertical" style={{ marginTop: 16 }}>
          <Form.Item label="名称" name="name" rules={[{ required: true, message: "请输入名称" }]}>
            <Input />
          </Form.Item>
          {kind !== "gatewayclass" ? (
            <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
              <Input placeholder="default" />
            </Form.Item>
          ) : null}
          {kind === "gatewayclass" ? (
            <>
              <Form.Item label="控制器名称" name="controllerName" rules={[{ required: true, message: "请输入控制器名称" }]}>
                <Input placeholder="例如：example.com/gateway-controller" />
              </Form.Item>
              <Form.Item label="参数引用 Group" name="parametersGroup">
                <Input placeholder="例如：gateway.networking.k8s.io" />
              </Form.Item>
              <Form.Item label="参数引用 Kind" name="parametersKind">
                <Input placeholder="例如：ConfigMap" />
              </Form.Item>
              <Form.Item label="参数引用名称" name="parametersName">
                <Input placeholder="例如：gateway-params" />
              </Form.Item>
            </>
          ) : null}
          {kind === "gateway" ? (
            <>
              <Form.Item label="GatewayClass 名称" name="gatewayClassName" rules={[{ required: true, message: "请输入 GatewayClass 名称" }]}>
                <Input placeholder="例如：istio" />
              </Form.Item>
              <Form.Item label="地址类型" name="addressType">
                <Input placeholder="例如：IPAddress" />
              </Form.Item>
              <Form.Item label="地址值" name="addresses">
                <Input placeholder="例如：10.0.0.10" />
              </Form.Item>
              <Form.Item label="监听器名称" name="listenerName">
                <Input placeholder="例如：http" />
              </Form.Item>
              <Form.Item label="监听器端口" name="listenerPort">
                <InputNumber style={{ width: "100%" }} min={1} max={65535} />
              </Form.Item>
              <Form.Item label="监听器协议" name="listenerProtocol">
                <Input placeholder="HTTP / HTTPS" />
              </Form.Item>
              <Form.Item label="监听器 Hostname" name="listenerHostname">
                <Input placeholder="例如：gateway.example.com" />
              </Form.Item>
              <Form.Item label="允许路由方式" name="allowedRoutesFrom" initialValue="Selector">
                <Select
                  options={[
                    { label: "All", value: "All" },
                    { label: "Same", value: "Same" },
                    { label: "Selector", value: "Selector" },
                    { label: "None", value: "None" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="允许路由名称空间" name="allowedRoutesNamespaces">
                <Input placeholder="空格分隔，例如：default prod" />
              </Form.Item>
            </>
          ) : null}
          {kind === "httproute" ? (
            <>
              <Form.Item label="父 Gateway 名称" name="parentGatewayName" rules={[{ required: true, message: "请输入父 Gateway 名称" }]}>
                <Input placeholder="例如：istio" />
              </Form.Item>
              <Form.Item label="Hostnames（空格分隔）" name="hostnames">
                <Input placeholder="example.com api.example.com" />
              </Form.Item>
              <Form.Item label="匹配路径" name="matchPath">
                <Input placeholder="/" />
              </Form.Item>
              <Form.Item label="路径类型" name="pathType">
                <Select
                  options={[
                    { label: "PathPrefix", value: "PathPrefix" },
                    { label: "Exact", value: "Exact" },
                    { label: "RegularExpression", value: "RegularExpression" },
                  ]}
                />
              </Form.Item>
              <Form.Item label="后端 Service 名称" name="backendServiceName">
                <Input placeholder="例如：web-svc" />
              </Form.Item>
              <Form.Item label="后端 Service 端口" name="backendServicePort">
                <InputNumber style={{ width: "100%" }} min={1} max={65535} />
              </Form.Item>
              <Form.Item label="后端权重" name="backendWeight">
                <InputNumber style={{ width: "100%" }} min={0} max={1000} />
              </Form.Item>
              <Form.Item label="请求头名称" name="headerName">
                <Input placeholder="例如：X-Env" />
              </Form.Item>
              <Form.Item label="请求头值" name="headerValue">
                <Input placeholder="例如：prod" />
              </Form.Item>
            </>
          ) : null}
        </Form>
      </Modal>
    </Space>
  );
}
