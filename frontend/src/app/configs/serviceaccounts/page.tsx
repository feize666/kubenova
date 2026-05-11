"use client";

import { CopyOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Button,
  Card,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Table,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName, hasKnownCluster } from "@/lib/cluster-display-name";
import { ResourceAddButton } from "@/components/resource-add-button";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
  buildResourceActionMenuItems,
  openResourceActionConfirm,
  renderResourceActionTriggerButton,
} from "@/components/resource-action-bar";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { getClusters } from "@/lib/api/clusters";
import { getNamespaces } from "@/lib/api/namespaces";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth, getTableScrollX } from "@/lib/table-column-widths";
import { buildTablePagination } from "@/lib/table/pagination";
import type { ResourceDetailRequest } from "@/lib/api/resources";
import { Dropdown } from "antd";
import {
  deleteDynamicResource,
  getDynamicResourceDetail,
  getDynamicResources,
  refreshResourceDiscovery,
  updateDynamicResourceYaml,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
} from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";

type ServiceAccountRecord = DynamicResourceItem;

type CreateSaFormValues = {
  name: string;
  namespace: string;
};

type SecretTokenRow = {
  key: string;
  secretName: string;
  tokenMasked: string;
  tokenRaw: string | undefined;
  createdAt: string | undefined;
};

function buildServiceAccountYaml(name: string, namespace: string): string {
  return [
    "apiVersion: v1",
    "kind: ServiceAccount",
    "metadata:",
    `  name: ${name}`,
    `  namespace: ${namespace}`,
    "",
  ].join("\n");
}

function decodeBase64(value: string): string {
  try {
    return atob(value);
  } catch {
    return "";
  }
}

function maskToken(value?: string): string {
  if (!value) return "-";
  if (value.length <= 14) return `${value.slice(0, 4)}...${value.slice(-2)}`;
  return `${value.slice(0, 6)}...${value.slice(-4)}`;
}

export default function ServiceAccountsPage() {
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const lastDiscoveryRefreshAtRef = useRef<Record<string, number>>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter();
  const [keywordInput, setKeywordInput] = useState("");
  const [keyword, setKeyword] = useState("");
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlValue, setYamlValue] = useState("");
  const [yamlTarget, setYamlTarget] = useState<DynamicResourceIdentity | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm] = Form.useForm<CreateSaFormValues>();

  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenRows, setTokenRows] = useState<SecretTokenRow[]>([]);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenTitle, setTokenTitle] = useState("");
  const [detailTarget, setDetailTarget] = useState<ResourceDetailRequest | null>(null);

  const clustersQuery = useQuery({
    queryKey: ["serviceaccounts", "clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );

  const namespacesQuery = useQuery({
    queryKey: ["serviceaccounts", "namespaces", clusterId || "all", accessToken],
    queryFn: () => getNamespaces({ clusterId: clusterId || undefined }, accessToken ?? undefined),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });

  const listQuery = useQuery({
    queryKey: [
      "serviceaccounts",
      "list",
      clusterId || "all",
      namespace,
      keyword,
      page,
      pageSize,
      accessToken,
    ],
    queryFn: () =>
      getDynamicResources(
        {
          clusterId: clusterId || undefined,
          group: "",
          version: "v1",
          resource: "serviceaccounts",
          namespace: namespace || undefined,
          keyword: keyword || undefined,
          page,
          pageSize,
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
      setYamlTarget(identity);
      setYamlValue(detail.yaml);
      setYamlOpen(true);
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "读取 YAML 失败");
    },
  });

  const applyYamlMutation = useMutation({
    mutationFn: (payload: DynamicResourceIdentity & { yaml: string }) =>
      updateDynamicResourceYaml({ ...payload, yaml: payload.yaml }, accessToken ?? undefined),
    onSuccess: async () => {
      void message.success("YAML 已应用");
      setYamlOpen(false);
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "应用 YAML 失败");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (identity: DynamicResourceIdentity) => deleteDynamicResource(identity, accessToken ?? undefined),
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "删除失败");
    },
  });

  const createMutation = useMutation({
    mutationFn: async (values: CreateSaFormValues) => {
      const name = values.name.trim();
      const ns = values.namespace.trim();
      const yaml = buildServiceAccountYaml(name, ns);
      return updateDynamicResourceYaml(
        {
          clusterId,
          group: "",
          version: "v1",
          resource: "serviceaccounts",
          namespace: ns,
          name,
          yaml,
        },
        accessToken ?? undefined,
      );
    },
    onSuccess: async () => {
      void message.success("ServiceAccount 创建成功");
      setCreateOpen(false);
      createForm.resetFields();
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "创建失败");
    },
  });

  const rowsRaw = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
  const effectivePageSize = listQuery.data?.pageSize ?? pageSize;

  const knownNamespaces = useMemo(
    () => Array.from(new Set(rowsRaw.map((item) => item.namespace).filter(Boolean))).sort(),
    [rowsRaw],
  );

  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((c) => [c.id, c.name])),
    [clustersQuery.data?.items],
  );

  const resolveItemLabels = (item: ServiceAccountRecord): Record<string, string> | null | undefined => {
    const raw = item as ServiceAccountRecord & { labels?: unknown };
    if (!raw.labels || typeof raw.labels !== "object" || Array.isArray(raw.labels)) {
      return undefined;
    }
    return raw.labels as Record<string, string>;
  };

  const tableData = useMemo(
    () =>
      rowsRaw.filter(
        (item) => hasKnownCluster(clusterMap, item.clusterId) && matchLabelExpressions(resolveItemLabels(item), mergedFilters),
      ),
    [clusterMap, rowsRaw, mergedFilters],
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

  const loadServiceAccountSecrets = async (row: ServiceAccountRecord) => {
    setTokenLoading(true);
    setTokenModalOpen(true);
    setTokenTitle(`${row.namespace}/${row.name}`);
    setTokenRows([]);
    try {
      const secretList = await getDynamicResources(
        {
          clusterId: row.clusterId,
          group: "",
          version: "v1",
          resource: "secrets",
          namespace: row.namespace,
          keyword: row.name,
          page: 1,
          pageSize: 200,
        },
        accessToken ?? undefined,
      );

      const details = await Promise.all(
        (secretList.items ?? []).map(async (secret) => {
          const detail = await getDynamicResourceDetail(
            {
              clusterId: row.clusterId,
              group: "",
              version: "v1",
              resource: "secrets",
              namespace: row.namespace,
              name: secret.name,
            },
            accessToken ?? undefined,
          );
          return detail.raw as Record<string, unknown>;
        }),
      );

      const normalized = details
        .map((raw) => {
          const metadata =
            raw.metadata && typeof raw.metadata === "object" ? (raw.metadata as Record<string, unknown>) : {};
          const annotations =
            metadata.annotations && typeof metadata.annotations === "object"
              ? (metadata.annotations as Record<string, unknown>)
              : {};
          const secretType = typeof raw.type === "string" ? raw.type : "";
          const saNameAnno =
            typeof annotations["kubernetes.io/service-account.name"] === "string"
              ? (annotations["kubernetes.io/service-account.name"] as string)
              : "";
          const secretName = typeof metadata.name === "string" ? metadata.name : "";
          const tokenBase64 =
            raw.data && typeof raw.data === "object" && typeof (raw.data as Record<string, unknown>).token === "string"
              ? ((raw.data as Record<string, unknown>).token as string)
              : "";
          const tokenRaw = tokenBase64 ? decodeBase64(tokenBase64) : "";
          const createdAt = typeof metadata.creationTimestamp === "string" ? metadata.creationTimestamp : undefined;
          const matched =
            secretType === "kubernetes.io/service-account-token" && (saNameAnno === row.name || secretName.includes(row.name));
          if (!matched) {
            return null;
          }
          return {
            key: secretName,
            secretName,
            tokenMasked: maskToken(tokenRaw),
            tokenRaw: tokenRaw || undefined,
            createdAt,
          } satisfies SecretTokenRow;
        })
        .filter((item): item is SecretTokenRow => Boolean(item));

      setTokenRows(normalized);
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "读取关联 Secret/Token 失败");
    } finally {
      setTokenLoading(false);
    }
  };

  const handleOpenYamlForRow = (row: ServiceAccountRecord) => {
    if (!row.id) {
      return;
    }
    openYamlMutation.mutate({
      clusterId: row.clusterId,
      group: "",
      version: "v1",
      resource: "serviceaccounts",
      namespace: row.namespace,
      name: row.name,
    });
  };

  const handleOpenSecretTokenForRow = (row: ServiceAccountRecord) => {
    if (!row.id) {
      return;
    }
    void loadServiceAccountSecrets(row);
  };

  const handleDeleteRow = async (row: ServiceAccountRecord) => {
    if (!accessToken || !row.id) {
      return;
    }
    try {
      await deleteMutation.mutateAsync({
        clusterId: row.clusterId,
        group: "",
        version: "v1",
        resource: "serviceaccounts",
        namespace: row.namespace,
        name: row.name,
      });
      void message.success("ServiceAccount 删除成功");
      await listQuery.refetch();
    } catch (error) {
      void message.error(error instanceof Error ? error.message : "删除失败，请重试");
    }
  };

  const columns: ColumnsType<ServiceAccountRecord> = [
    {
      title: "名称",
      dataIndex: "name",
      key: "name",
      width: nameWidth,
      ellipsis: true,
      render: (name: string, row: ServiceAccountRecord) =>
        row.id ? (
          <Typography.Link onClick={() => setDetailTarget({ kind: "serviceaccount", id: row.id })}>
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
      render: (_: unknown, record: ServiceAccountRecord) => getClusterDisplayName(clusterMap, record.clusterId),
    },
    {
      title: "名称空间",
      dataIndex: "namespace",
      key: "namespace",
      width: TABLE_COL_WIDTH.namespace,
      render: (value: string) => value || "-",
    },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: TABLE_COL_WIDTH.updateTime,
      render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
    },
    {
      title: "操作",
      key: "actions",
      width: TABLE_COL_WIDTH.actionCompact,
      fixed: "right",
      render: (_: unknown, row: ServiceAccountRecord) => (
        <Dropdown
          trigger={["click"]}
          placement="bottomRight"
          menu={{
            items: buildResourceActionMenuItems([
              {
                key: "secret-token",
                label: "Secret/Token",
                onClick: () => handleOpenSecretTokenForRow(row),
              },
              {
                key: "yaml",
                label: "YAML",
                onClick: () => handleOpenYamlForRow(row),
              },
              {
                key: "delete",
                label: "删除",
                danger: true,
                onClick: () => {
                  openResourceActionConfirm(
                    {
                      title: "删除 ServiceAccount",
                      description: `确认删除 ServiceAccount「${row.name}」吗？此操作不可恢复。`,
                      okText: "确认删除",
                      cancelText: "取消",
                      okDanger: true,
                    },
                    () => void handleDeleteRow(row),
                  );
                },
              },
            ]),
          }}
        >
          {renderResourceActionTriggerButton({ ariaLabel: "更多操作" })}
        </Dropdown>
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/configs/serviceaccounts"
        titleSuffix={
          <ResourceAddButton
            title="新增资源"
            disabled={!clusterId}
            onClick={() => {
              if (!clusterId) {
                void message.error("请先选择集群后再新增资源");
                return;
              }
              setCreateOpen(true);
            }}
          />
        }
      />

      <Card>
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
            setPage(1);
          }}
          onNamespaceChange={(value) => {
            onNamespaceChange(value);
            setPage(1);
          }}
          onKeywordInputChange={setKeywordInput}
          onSearch={handleSearch}
          keywordPlaceholder="输入关键字，或 label 过滤（如 env=prod team=platform）"
        />

        {!isInitializing && !accessToken ? (
          <Alert type="warning" showIcon message="未登录或登录初始化中，请稍后重试。" style={{ marginBottom: 16 }} />
        ) : null}

        {listQuery.isError ? (
          <Alert
            type="error"
            showIcon
            message="ServiceAccount 列表加载失败"
            description={listQuery.error instanceof Error ? listQuery.error.message : "unknown"}
            style={{ marginBottom: 16 }}
          />
        ) : null}

        <Table<ServiceAccountRecord>
          className="pod-table"
          bordered
          rowKey="id"
          columns={columns}
          dataSource={tableData}
          loading={listQuery.isLoading}
          onRow={(record) => ({
            onClick: () => {
              if (record.id) {
                setDetailTarget({ kind: "serviceaccount", id: record.id });
              }
            },
          })}
          pagination={buildTablePagination({
            current: listQuery.data?.page ?? page,
            pageSize: effectivePageSize,
            total: listQuery.data?.total ?? 0,
            disabled: listQuery.isLoading && !listQuery.data,
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
        title="YAML"
        open={yamlOpen}
        onCancel={() => setYamlOpen(false)}
        onOk={() => {
          if (!yamlTarget) return;
          applyYamlMutation.mutate({ ...yamlTarget, yaml: yamlValue });
        }}
        okText="应用"
        cancelText="取消"
        width={860}
        confirmLoading={applyYamlMutation.isPending}
      >
        <Input.TextArea
          value={yamlValue}
          onChange={(event) => setYamlValue(event.target.value)}
          autoSize={{ minRows: 18, maxRows: 28 }}
          spellCheck={false}
          style={{ fontFamily: "monospace" }}
        />
      </Modal>

      <Modal
        title="新建 ServiceAccount"
        open={createOpen}
        onCancel={() => {
          createForm.resetFields();
          setCreateOpen(false);
        }}
        onOk={() => {
          void createForm.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending}
      >
        <Form form={createForm} layout="vertical" requiredMark>
          <Form.Item
            name="name"
            label="名称"
            rules={[
              { required: true, message: "请输入名称" },
              { pattern: /^[a-z0-9]([-a-z0-9]*[a-z0-9])?$/, message: "名称需符合 DNS-1123 label" },
            ]}
          >
            <Input placeholder="例如：ci-runner" />
          </Form.Item>
          <Form.Item
            name="namespace"
            label="名称空间"
            rules={[{ required: true, message: "请选择或输入名称空间" }]}
          >
            <Select
              showSearch
              allowClear
              placeholder="选择名称空间"
              options={(namespacesQuery.data?.items ?? []).map((item) => ({
                label: item.namespace,
                value: item.namespace,
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`关联 Secret/Token · ${tokenTitle}`}
        open={tokenModalOpen}
        onCancel={() => setTokenModalOpen(false)}
        footer={null}
        width={900}
      >
        <Table<SecretTokenRow>
          rowKey="key"
          dataSource={tokenRows}
          loading={tokenLoading}
          pagination={false}
          locale={{ emptyText: "未发现可用的 ServiceAccount Token Secret（可能集群使用投影令牌）" }}
          columns={[
            { title: "Secret", dataIndex: "secretName", key: "secretName" },
            {
              title: "Token（脱敏）",
              dataIndex: "tokenMasked",
              key: "tokenMasked",
              render: (value: string) => <Typography.Text code>{value}</Typography.Text>,
            },
            {
              title: "创建时间",
              dataIndex: "createdAt",
              key: "createdAt",
              render: (value?: string) => <ResourceTimeCell value={value} now={now} mode="relative" />,
            },
            {
              title: "操作",
              key: "actions",
              width: 120,
              render: (_, record) => (
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  disabled={!record.tokenRaw}
                  onClick={async () => {
                    if (!record.tokenRaw) return;
                    try {
                      await navigator.clipboard.writeText(record.tokenRaw);
                      void message.success("Token 已复制");
                    } catch {
                      void message.error("复制失败");
                    }
                  }}
                >
                  复制
                </Button>
              ),
            },
          ]}
        />
      </Modal>
      <ResourceDetailDrawer
        open={Boolean(detailTarget)}
        onClose={() => setDetailTarget(null)}
        request={detailTarget}
        token={accessToken ?? undefined}
        onNavigateRequest={(request) => {
          setDetailTarget(request);
        }}
      />
    </Space>
  );
}
