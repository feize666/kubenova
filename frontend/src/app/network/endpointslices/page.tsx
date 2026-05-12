"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Card,
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
import Link from "next/link";
import { useMemo, useState } from "react";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type EndpointSlicePort = {
  name?: string;
  port?: number;
  protocol?: string;
  appProtocol?: string;
};

type EndpointSliceEndpoint = {
  addresses?: string[];
  hostname?: string;
  nodeName?: string;
  conditions?: {
    ready?: boolean;
    serving?: boolean;
    terminating?: boolean;
  };
  targetRef?: {
    kind?: string;
    name?: string;
  };
};

type EndpointSliceResource = Omit<NetworkResource, "kind" | "spec" | "labels"> & {
  kind: NetworkResource["kind"] | "EndpointSlice";
  labels?: Record<string, string>;
  spec?: {
    addressType?: string;
    ports?: EndpointSlicePort[];
    endpoints?: EndpointSliceEndpoint[];
  };
};

type EndpointSliceCreatePayload = Omit<CreateNetworkResourcePayload, "kind"> & {
  kind: "EndpointSlice";
  labels?: Record<string, string>;
};

interface EndpointSliceFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  serviceName?: string;
  addressType: "IPv4" | "IPv6" | "FQDN";
  addresses: string;
  ports: string;
}

function splitCsv(input?: string) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePorts(input?: string): EndpointSlicePort[] {
  return splitCsv(input).reduce<EndpointSlicePort[]>((result, item) => {
    const [portPart, protocolPart] = item.split("/").map((segment) => segment.trim());
    const protocol = protocolPart || "TCP";
    const [namePart, rawPort] = portPart.includes(":")
      ? portPart.split(":").map((segment) => segment.trim())
      : ["", portPart];
    const port = Number.parseInt(rawPort, 10);
    if (!Number.isInteger(port) || port <= 0) return result;
    result.push({
      ...(namePart ? { name: namePart } : {}),
      port,
      protocol,
    });
    return result;
  }, []);
}

function getEndpoints(resource: EndpointSliceResource) {
  return Array.isArray(resource.spec?.endpoints) ? resource.spec.endpoints : [];
}

function getPorts(resource: EndpointSliceResource) {
  return Array.isArray(resource.spec?.ports) ? resource.spec.ports : [];
}

function summarizeReadiness(resource: EndpointSliceResource) {
  const endpoints = getEndpoints(resource);
  const total = endpoints.length;
  const ready = endpoints.filter((endpoint) => endpoint.conditions?.ready !== false).length;
  const terminating = endpoints.filter((endpoint) => endpoint.conditions?.terminating === true).length;
  return { total, ready, terminating };
}

function listAddressPreview(resource: EndpointSliceResource) {
  const values = getEndpoints(resource)
    .flatMap((endpoint) => endpoint.addresses ?? [])
    .filter(Boolean);
  return Array.from(new Set(values));
}

function listPortPreview(resource: EndpointSliceResource) {
  const values = getPorts(resource)
    .map((port) => {
      if (!port.port) return null;
      const prefix = port.name ? `${port.name}:` : "";
      const protocol = port.protocol ? `/${port.protocol}` : "";
      return `${prefix}${port.port}${protocol}`;
    })
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(values));
}

function resolveServiceName(resource: EndpointSliceResource) {
  return resource.labels?.["kubernetes.io/service-name"] ?? resource.labels?.["service-name"] ?? "-";
}

export default function EndpointSlicesPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<EndpointSliceFormValues>();
  const {
    sortBy,
    sortOrder,
    pagination,
    resetPage,
    getSortableColumnProps,
    getPaginationConfig,
    handleTableChange,
  } = useAntdTableSortPagination<EndpointSliceResource>({
    defaultPageSize: 10,
  });

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: [
      "network",
      "EndpointSlice",
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
      getNetworkResources(
        {
          kind: "EndpointSlice",
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
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterFilterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((cluster) => ({
      label: cluster.name,
      value: cluster.id,
    })),
    [clustersQuery.data],
  );

  const clusterOptions = (clustersQuery.data?.items ?? []).map((cluster) => ({
    label: cluster.name,
    value: cluster.id,
  }));

  const clusterMap = Object.fromEntries((clustersQuery.data?.items ?? []).map((cluster) => [cluster.id, cluster.name]));

  const createMutation = useMutation({
    mutationFn: (payload: EndpointSliceCreatePayload) =>
      createNetworkResource(payload as unknown as CreateNetworkResourcePayload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("EndpointSlice 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["network", "EndpointSlice"],
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("EndpointSlice 删除成功");
      await queryClient.invalidateQueries({
        queryKey: ["network", "EndpointSlice"],
      });
      await refetch();
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "删除失败，请重试");
    },
  });

  const knownNamespaces = useMemo(
    () => Array.from(new Set((data?.items ?? []).map((item) => item.namespace).filter(Boolean))),
    [data?.items],
  );

  const tableData = useMemo(
    () =>
      ((data?.items ?? []) as EndpointSliceResource[]).filter(
        (item) =>
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters),
      ),
    [data?.items, mergedFilters],
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

  const handleModalSubmit = async () => {
    let values: EndpointSliceFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const addresses = splitCsv(values.addresses);
    const ports = parsePorts(values.ports);

    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "EndpointSlice",
      name: values.name,
      ...(values.serviceName
        ? {
            labels: {
              "kubernetes.io/service-name": values.serviceName,
            },
          }
        : {}),
      spec: {
        addressType: values.addressType,
        ...(ports.length > 0 ? { ports } : {}),
        endpoints: [
          {
            addresses,
            conditions: { ready: true },
          },
        ],
      },
    });
  };

  const columns: ColumnsType<EndpointSliceResource> = [
    {
      title: "切片名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      ...getSortableColumnProps("name", isLoading && !data),
      render: (name: string, row: EndpointSliceResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "EndpointSlice", id: row.id })}>
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
      render: (_: unknown, row: EndpointSliceResource) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      ...getSortableColumnProps("namespace", isLoading && !data),
    },
    {
      title: "关联 Service",
      key: "serviceName",
      width: TABLE_COL_WIDTH.release,
      render: (_: unknown, row: EndpointSliceResource) => {
        const serviceName = resolveServiceName(row);
        if (serviceName === "-") return "-";
        return (
          <Link href={`/network/services?namespace=${encodeURIComponent(row.namespace)}&keyword=${encodeURIComponent(serviceName)}`}>
            <Typography.Link>{serviceName}</Typography.Link>
          </Link>
        );
      },
    },
    {
      title: "地址类型",
      key: "addressType",
      width: TABLE_COL_WIDTH.type,
      render: (_: unknown, row: EndpointSliceResource) => row.spec?.addressType ?? "-",
    },
    {
      title: "端点状态",
      key: "readiness",
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: EndpointSliceResource) => {
        const readiness = summarizeReadiness(row);
        return (
          <Space size={4} wrap>
            <Tag color="green">就绪 {readiness.ready}/{readiness.total}</Tag>
            <Tag color={readiness.terminating > 0 ? "orange" : "default"}>终止中 {readiness.terminating}</Tag>
          </Space>
        );
      },
    },
    {
      title: "端口",
      key: "ports",
      width: TABLE_COL_WIDTH.ports,
      render: (_: unknown, row: EndpointSliceResource) => {
        const ports = listPortPreview(row);
        return ports.length > 0 ? ports.slice(0, 3).join(", ") : "-";
      },
    },
    {
      title: "地址预览",
      key: "addresses",
      width: TABLE_COL_WIDTH.address,
      render: (_: unknown, row: EndpointSliceResource) => {
        const addresses = listAddressPreview(row);
        if (addresses.length === 0) return "-";
        const preview = addresses.slice(0, 3).join(", ");
        return addresses.length > 3 ? `${preview} ...` : preview;
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
      align: "center",
      fixed: "right",
      render: (_: unknown, row: EndpointSliceResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 EndpointSlice"
          deleteContent={`确认删除 EndpointSlice「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "EndpointSlice",
              name: row.name,
            })
          }
          onDelete={() => deleteMutation.mutate(row.id)}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      <Card className="cyber-panel">
        <ResourcePageHeader
          path="/network/endpointslices"
          embedded
          description="查看 Kubernetes EndpointSlice 分片、地址状态与端口分布。"
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton title="新增资源" onClick={() => { form.resetFields(); form.setFieldsValue({ addressType: "IPv4", ports: "http:80/TCP" }); setModalOpen(true); }} />}
        />
        <NetworkResourcePageFilters
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
          keywordPlaceholder="按名称/标签搜索（示例：eps-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 16 }} />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="EndpointSlice 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<EndpointSliceResource>
          className="pod-table"
          bordered
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

      <Modal
        title="添加 EndpointSlice"
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
          <Form.Item label="切片名称" name="name" rules={[{ required: true, message: "请输入 EndpointSlice 名称" }]}>
            <Input placeholder="例如：my-service-abcde" />
          </Form.Item>
          <Form.Item label="名称空间" name="namespace" rules={[{ required: true, message: "请输入名称空间" }]}>
            <Input placeholder="例如：default" />
          </Form.Item>
          <Form.Item label="所属集群" name="clusterId" rules={[{ required: true, message: "请选择集群" }]}>
            <Select
              placeholder="请选择集群"
              options={clusterOptions}
              loading={clustersQuery.isLoading}
              showSearch
              filterOption={(input, option) => (option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
            />
          </Form.Item>
          <Form.Item label="关联 Service" name="serviceName">
            <Input placeholder="例如：my-service" />
          </Form.Item>
          <Form.Item label="地址类型" name="addressType" rules={[{ required: true, message: "请选择地址类型" }]}>
            <Select
              options={[
                { label: "IPv4", value: "IPv4" },
                { label: "IPv6", value: "IPv6" },
                { label: "FQDN", value: "FQDN" },
              ]}
            />
          </Form.Item>
          <Form.Item label="端点地址" name="addresses" rules={[{ required: true, message: "请输入至少一个地址" }]}>
            <Input placeholder="例如：10.42.0.15,10.42.0.16" />
          </Form.Item>
          <Form.Item label="端口定义" name="ports" rules={[{ required: true, message: "请输入端口定义" }]}>
            <Input placeholder="例如：http:80/TCP,metrics:9090/TCP" />
          </Form.Item>
        </Form>
      </Modal>

      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => setDetailTarget(request)}
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
