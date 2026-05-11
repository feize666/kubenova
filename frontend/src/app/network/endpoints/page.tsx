"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  Card,
  Form,
  Input,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  Modal,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourceYamlDrawer } from "@/components/resource-yaml-drawer";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildTablePagination } from "@/lib/table/pagination";
import {
  createNetworkResource,
  deleteNetworkResource,
  getNetworkResources,
  type CreateNetworkResourcePayload,
  type NetworkResource,
} from "@/lib/api/network";
import type { ResourceDetailRequest, ResourceIdentity } from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type EndpointAddress = {
  ip?: string;
  hostname?: string;
  nodeName?: string;
  targetRef?: {
    kind?: string;
    name?: string;
  };
};

type EndpointPort = {
  name?: string;
  port?: number;
  protocol?: string;
};

type EndpointSubset = {
  addresses?: EndpointAddress[];
  notReadyAddresses?: EndpointAddress[];
  ports?: EndpointPort[];
};

type EndpointsResource = Omit<NetworkResource, "kind" | "spec"> & {
  kind: NetworkResource["kind"] | "Endpoints";
  spec?: {
    subsets?: EndpointSubset[];
  };
};

type EndpointsCreatePayload = Omit<CreateNetworkResourcePayload, "kind"> & {
  kind: "Endpoints";
};

interface EndpointsFormValues {
  name: string;
  namespace: string;
  clusterId: string;
  addresses: string;
  notReadyAddresses?: string;
  ports: string;
}

function splitCsv(input?: string) {
  return (input ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePorts(input?: string): EndpointPort[] {
  return splitCsv(input).reduce<EndpointPort[]>((result, item) => {
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

function getSubsets(resource: EndpointsResource): EndpointSubset[] {
  return Array.isArray(resource.spec?.subsets) ? resource.spec.subsets : [];
}

function countAddresses(resource: EndpointsResource, key: "addresses" | "notReadyAddresses") {
  return getSubsets(resource).reduce((sum, subset) => {
    const list = subset[key];
    return sum + (Array.isArray(list) ? list.length : 0);
  }, 0);
}

function listAddressPreview(resource: EndpointsResource) {
  const values = getSubsets(resource)
    .flatMap((subset) => [...(subset.addresses ?? []), ...(subset.notReadyAddresses ?? [])])
    .map((item) => item.ip || item.hostname)
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(values));
}

function listPortPreview(resource: EndpointsResource) {
  const values = getSubsets(resource).flatMap((subset) => subset.ports ?? []);
  const formatted = values
    .map((item) => {
      if (!item.port) return null;
      const prefix = item.name ? `${item.name}:` : "";
      const protocol = item.protocol ? `/${item.protocol}` : "";
      return `${prefix}${item.port}${protocol}`;
    })
    .filter((item): item is string => Boolean(item));
  return Array.from(new Set(formatted));
}

export default function EndpointsPage() {
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const now = useNowTicker();
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keyword, setKeyword] = useState("");
  const [keywordInput, setKeywordInput] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);
  const [yamlTarget, setYamlTarget] = useState<ResourceIdentity | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form] = Form.useForm<EndpointsFormValues>();
  const [pageSize, setPageSize] = useState(10);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["network", "Endpoints", { clusterId, namespace, keyword, page, pageSize }, accessToken],
    queryFn: () =>
      getNetworkResources(
        {
          kind: "Endpoints",
          clusterId: clusterId || undefined,
          namespace: namespace.trim() || undefined,
          keyword: keyword.trim() || undefined,
          page,
          pageSize,
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
  const effectivePageSize = data?.pageSize ?? pageSize;

  const createMutation = useMutation({
    mutationFn: (payload: EndpointsCreatePayload) =>
      createNetworkResource(payload as unknown as CreateNetworkResourcePayload, accessToken || undefined),
    onSuccess: async () => {
      void message.success("Endpoints 创建成功");
      setModalOpen(false);
      form.resetFields();
      await queryClient.invalidateQueries({
        queryKey: ["network", "Endpoints", { clusterId, namespace, keyword, page, pageSize }, accessToken],
        exact: true,
      });
    },
    onError: (err) => {
      void message.error(err instanceof Error ? err.message : "创建失败，请重试");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteNetworkResource(id, accessToken || undefined),
    onSuccess: async () => {
      void message.success("Endpoints 删除成功");
      await queryClient.invalidateQueries({
        queryKey: ["network", "Endpoints", { clusterId, namespace, keyword, page, pageSize }, accessToken],
        exact: true,
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
      ((data?.items ?? []) as EndpointsResource[]).filter(
        (item) =>
          hasKnownCluster(clusterMap, item.clusterId) &&
          matchLabelExpressions(item.labels as Record<string, string> | null | undefined, mergedFilters),
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

  const handleModalSubmit = async () => {
    let values: EndpointsFormValues;
    try {
      values = await form.validateFields();
    } catch {
      return;
    }

    const readyAddresses = splitCsv(values.addresses);
    const notReadyAddresses = splitCsv(values.notReadyAddresses);
    const ports = parsePorts(values.ports);

    createMutation.mutate({
      clusterId: values.clusterId,
      namespace: values.namespace,
      kind: "Endpoints",
      name: values.name,
      spec: {
        subsets: [
          {
            ...(readyAddresses.length > 0
              ? { addresses: readyAddresses.map((ip) => ({ ip })) }
              : {}),
            ...(notReadyAddresses.length > 0
              ? { notReadyAddresses: notReadyAddresses.map((ip) => ({ ip })) }
              : {}),
            ...(ports.length > 0 ? { ports } : {}),
          },
        ],
      },
    });
  };

  const columns: ColumnsType<EndpointsResource> = [
    {
      title: "端点名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: EndpointsResource) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "Endpoints", id: row.id })}>
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
      render: (_: unknown, row: EndpointsResource) => getClusterDisplayName(clusterMap, row.clusterId),
    },
    { title: "名称空间", dataIndex: "namespace", key: "namespace", width: TABLE_COL_WIDTH.namespace },
    {
      title: "关联 Service",
      key: "service",
      width: TABLE_COL_WIDTH.release,
      render: (_: unknown, row: EndpointsResource) => (
        <Link href={`/network/services?namespace=${encodeURIComponent(row.namespace)}&keyword=${encodeURIComponent(row.name)}`}>
          <Typography.Link>{row.name}</Typography.Link>
        </Link>
      ),
    },
    {
      title: "端点状态",
      key: "endpoints",
      width: TABLE_COL_WIDTH.status,
      render: (_: unknown, row: EndpointsResource) => {
        const ready = countAddresses(row, "addresses");
        const notReady = countAddresses(row, "notReadyAddresses");
        return (
          <Space size={4} wrap>
            <Tag color="green">就绪 {ready}</Tag>
            <Tag color={notReady > 0 ? "orange" : "default"}>未就绪 {notReady}</Tag>
          </Space>
        );
      },
    },
    {
      title: "端口",
      key: "ports",
      width: TABLE_COL_WIDTH.ports,
      render: (_: unknown, row: EndpointsResource) => {
        const ports = listPortPreview(row);
        return ports.length > 0 ? ports.slice(0, 3).join(", ") : "-";
      },
    },
    {
      title: "地址预览",
      key: "addresses",
      width: TABLE_COL_WIDTH.address,
      render: (_: unknown, row: EndpointsResource) => {
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
      render: (value: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      align: "left",
      fixed: "right",
      render: (_: unknown, row: EndpointsResource) => (
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 Endpoints"
          deleteContent={`确认删除 Endpoints「${row.name}」吗？此操作不可恢复。`}
          onYaml={() =>
            setYamlTarget({
              clusterId: row.clusterId,
              namespace: row.namespace,
              kind: "Endpoints",
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
          path="/network/endpoints"
          embedded
          description="查看 Service 后端地址集合、端口与实际连通目标。"
          style={{ marginBottom: 12 }}
          titleSuffix={<ResourceAddButton title="新增资源" onClick={() => { form.resetFields(); form.setFieldsValue({ ports: "http:80/TCP" }); setModalOpen(true); }} />}
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
            setPage(1);
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            setPage(1);
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="按名称/标签搜索（示例：ep-a app=web env=prod）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再操作。" style={{ marginBottom: 16 }} />
        ) : null}

        {isError ? (
          <Alert
            type="error"
            showIcon
            message="Endpoints 加载失败"
            description={error instanceof Error ? error.message : "请求失败"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<EndpointsResource>
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
        title="添加 Endpoints"
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
          <Form.Item label="端点名称" name="name" rules={[{ required: true, message: "请输入 Endpoints 名称" }]}>
            <Input placeholder="例如：my-service" />
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
          <Form.Item label="就绪地址" name="addresses" rules={[{ required: true, message: "请输入至少一个地址" }]}>
            <Input placeholder="例如：10.42.0.15,10.42.0.16" />
          </Form.Item>
          <Form.Item label="未就绪地址" name="notReadyAddresses">
            <Input placeholder="例如：10.42.0.18" />
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
