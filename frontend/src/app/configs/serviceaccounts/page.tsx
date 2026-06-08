"use client";

import { CopyOutlined, DownloadOutlined } from "@ant-design/icons";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Alert,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import type { ColumnsType } from "antd/es/table";
import { useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { useAuth } from "@/components/auth-context";
import { OpsIconActionButton, OpsModalShell, OpsSurface } from "@/components/ops";
import { ResourceTable } from "@/components/resource-table";
import { NetworkResourcePageFilters } from "@/components/network-resource-page-filters";
import type { ResourceDetailDrawerProps } from "@/components/resource-detail";
import { ResourceDetailDrawer } from "@/components/resource-detail/resource-detail-drawer";
import { ResourceTimeCell, useNowTicker } from "@/components/resource-time";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { ResourceAddButton } from "@/components/resource-add-button";
import { ResourceCreateMethodTabs, type ResourceCreateMode } from "@/components/resource-create-method-tabs";
import {
  matchLabelExpressions,
  parseResourceSearchInput,
} from "@/components/resource-action-bar";
import { ResourceRowActions } from "@/components/resource-row-actions";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { getClusters } from "@/lib/api/clusters";
import { getNamespaces } from "@/lib/api/namespaces";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import { RESOURCE_LIST_REFRESH_OPTIONS } from "@/lib/resource-list-refresh";
import { TABLE_COL_WIDTH, getAdaptiveNameWidth } from "@/lib/table-column-widths";
import { useAntdTableSortPagination } from "@/lib/table";
import type { HeadlampTableFilters } from "@/lib/table";
import {
  applyResourceYaml,
  deleteDynamicResource,
  getDynamicResourceDetail,
  getDynamicResources,
  refreshResourceDiscovery,
  updateDynamicResourceYaml,
  type DynamicResourceIdentity,
  type DynamicResourceItem,
} from "@/lib/api/resources";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { readResourceFilterFromSearchParams, useSyncResourceFilterUrlState } from "@/hooks/use-resource-filter-url-state";

type ServiceAccountRecord = DynamicResourceItem;
type DetailTarget = NonNullable<ResourceDetailDrawerProps["request"]>;

type CreateSaFormValues = {
  clusterId: string;
  name: string;
  namespace: string;
  automountServiceAccountToken?: boolean;
  imagePullSecretsText?: string;
  secretsText?: string;
  labelsText?: string;
  annotationsText?: string;
};

type SecretTokenRow = {
  key: string;
  clusterId: string;
  namespace: string;
  id: string;
  kind: "dynamic";
  secretName: string;
  tokenMasked: string;
  tokenRaw: string | undefined;
  createdAt: string | undefined;
};

function parseNameLines(value?: string): Array<{ name: string }> {
  return (value ?? "")
    .split(/\r?\n|,/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((name) => ({ name }));
}

function parseMetadataText(value?: string): Record<string, string> {
  return Object.fromEntries(
    (value ?? "")
      .split(/\r?\n|,/)
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return index > 0 ? [item.slice(0, index).trim(), item.slice(index + 1).trim()] as const : null;
      })
      .filter((entry): entry is readonly [string, string] => Boolean(entry?.[0] && entry?.[1])),
  );
}

function buildServiceAccountYaml(values: CreateSaFormValues): string {
  const labels = parseMetadataText(values.labelsText);
  const annotations = parseMetadataText(values.annotationsText);
  const imagePullSecrets = parseNameLines(values.imagePullSecretsText);
  const secrets = parseNameLines(values.secretsText);
  const manifest: Record<string, unknown> = {
    apiVersion: "v1",
    kind: "ServiceAccount",
    metadata: {
      name: values.name.trim(),
      namespace: values.namespace.trim(),
      ...(Object.keys(labels).length > 0 ? { labels } : {}),
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    },
    ...(typeof values.automountServiceAccountToken === "boolean"
      ? { automountServiceAccountToken: values.automountServiceAccountToken }
      : {}),
    ...(imagePullSecrets.length > 0 ? { imagePullSecrets } : {}),
    ...(secrets.length > 0 ? { secrets } : {}),
  };
  return [
    `apiVersion: ${manifest.apiVersion}`,
    `kind: ${manifest.kind}`,
    "metadata:",
    `  name: ${(manifest.metadata as Record<string, unknown>).name}`,
    `  namespace: ${(manifest.metadata as Record<string, unknown>).namespace}`,
    ...Object.entries(labels).flatMap(([key, value], index) => [
      index === 0 ? "  labels:" : "",
      `    ${key}: ${value}`,
    ]).filter(Boolean),
    ...Object.entries(annotations).flatMap(([key, value], index) => [
      index === 0 ? "  annotations:" : "",
      `    ${key}: ${value}`,
    ]).filter(Boolean),
    ...(typeof values.automountServiceAccountToken === "boolean"
      ? [`automountServiceAccountToken: ${values.automountServiceAccountToken}`]
      : []),
    ...(imagePullSecrets.length > 0
      ? ["imagePullSecrets:", ...imagePullSecrets.map((item) => `  - name: ${item.name}`)]
      : []),
    ...(secrets.length > 0
      ? ["secrets:", ...secrets.map((item) => `  - name: ${item.name}`)]
      : []),
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

function sanitizeFilenameSegment(value: string, fallback: string): string {
  const normalized = value.trim().replace(/[\\/:*?"<>|\s]+/g, "-");
  return normalized || fallback;
}

function downloadTextFile(content: string, filename: string) {
  const blob = new Blob([content], { type: "application/x-yaml;charset=utf-8" });
  const url = window.URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.URL.revokeObjectURL(url);
}

export default function ServiceAccountsPage() {
  const searchParams = useSearchParams();
  const { clusterId: initialClusterId, namespace: initialNamespace, keyword: initialKeyword } =
    readResourceFilterFromSearchParams(searchParams);
  const { accessToken, isInitializing } = useAuth();
  const now = useNowTicker();
  const lastDiscoveryRefreshAtRef = useRef<Record<string, number>>({});
  const { clusterId, namespace, namespaceDisabled, namespacePlaceholder, onClusterChange, onNamespaceChange } =
    useClusterNamespaceFilter(initialClusterId, initialNamespace);
  const [keywordInput, setKeywordInput] = useState(initialKeyword);
  const [keyword, setKeyword] = useState(initialKeyword);
  const [mergedFilters, setMergedFilters] = useState<string[]>([]);
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const { sortBy, sortOrder, pagination, resetPage, getPaginationConfig, handleTableChange } =
    useAntdTableSortPagination<ServiceAccountRecord>({
      defaultPageSize: 10,
    });

  const [yamlOpen, setYamlOpen] = useState(false);
  const [yamlValue, setYamlValue] = useState("");
  const [yamlTarget, setYamlTarget] = useState<DynamicResourceIdentity | null>(null);

  const [createOpen, setCreateOpen] = useState(false);
  const [createMode, setCreateMode] = useState<ResourceCreateMode>("form");
  const [createYaml, setCreateYaml] = useState("");
  const [createYamlClusterId, setCreateYamlClusterId] = useState("");
  const [createYamlNamespace, setCreateYamlNamespace] = useState("");
  const [createForm] = Form.useForm<CreateSaFormValues>();
  const createClusterId = Form.useWatch("clusterId", createForm);

  const [tokenModalOpen, setTokenModalOpen] = useState(false);
  const [tokenRows, setTokenRows] = useState<SecretTokenRow[]>([]);
  const [tokenLoading, setTokenLoading] = useState(false);
  const [tokenTitle, setTokenTitle] = useState("");
  const [detailTarget, setDetailTarget] = useState<DetailTarget | null>(null);

  const clustersQuery = useQuery({
    queryKey: ["serviceaccounts", "clusters", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });
  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );
  const clusterUnavailable = Boolean(clustersQuery.data?.selectableUnavailable);

  const createNamespacesQuery = useQuery({
    queryKey: ["serviceaccounts", "create-namespaces", createClusterId || "all", accessToken],
    queryFn: () =>
      getNamespaces({ clusterId: createClusterId || undefined, page: 1, pageSize: 500 }, accessToken ?? undefined),
    enabled: Boolean(accessToken) && Boolean(createClusterId),
  });

  const listQuery = useQuery({
    queryKey: [
      "serviceaccounts",
      "list",
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
      getDynamicResources(
        {
          clusterId: clusterId || undefined,
          group: "",
          version: "v1",
          resource: "serviceaccounts",
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
      const targetClusterId = values.clusterId.trim();
      const name = values.name.trim();
      const ns = values.namespace.trim();
      const yaml = buildServiceAccountYaml(values);
      return updateDynamicResourceYaml(
        {
          clusterId: targetClusterId,
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

  const applyCreateYamlMutation = useMutation({
    mutationFn: () =>
      applyResourceYaml(
        {
          clusterId: createYamlClusterId.trim(),
          namespace: createYamlNamespace.trim() || undefined,
          yaml: createYaml.trim(),
        },
        accessToken ?? undefined,
      ),
    onSuccess: async (result) => {
      void message.success(result.message || "YAML 已应用");
      setCreateOpen(false);
      setCreateYaml("");
      await listQuery.refetch();
    },
    onError: (error) => {
      void message.error(error instanceof Error ? error.message : "YAML 创建失败");
    },
  });

  const rowsRaw = useMemo(() => listQuery.data?.items ?? [], [listQuery.data?.items]);
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
        (item) => matchLabelExpressions(resolveItemLabels(item), mergedFilters),
      ),
    [rowsRaw, mergedFilters],
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
  const handleGlobalSearchChange = (value: string) => {
    const parsed = parseResourceSearchInput(value);
    setKeywordInput(value);
    resetPage();
    setMergedFilters(parsed.labelExpressions);
    setKeyword(parsed.keyword);
  };
  useSyncResourceFilterUrlState({
    clusterId,
    namespace,
    keyword,
    path: "/configs/serviceaccounts",
  });

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
            clusterId: row.clusterId,
            namespace: row.namespace,
            id: `dynamic:${row.clusterId}::v1:secrets:${row.namespace}:${secretName}`,
            kind: "dynamic",
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

  const handleDownloadYaml = () => {
    if (!yamlTarget || !yamlValue.trim()) {
      return;
    }
    const namespace = yamlTarget.namespace ? sanitizeFilenameSegment(yamlTarget.namespace, "default") : "cluster";
    const resource = sanitizeFilenameSegment(yamlTarget.resource, "serviceaccount");
    const name = sanitizeFilenameSegment(yamlTarget.name, "item");
    downloadTextFile(yamlValue, `${namespace}-${resource}-${name}.yaml`);
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
          <Typography.Link
            onClick={() =>
              setDetailTarget({
                kind: "ServiceAccount",
                id: row.id,
                kindLabel: "ServiceAccount",
                apiVersion: row.apiVersion,
                namespace: row.namespace,
                name: row.name,
                label: row.name,
                snapshot: { labels: row.labels },
              })
            }
          >
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
        <ResourceRowActions
          deleteLabel="删除"
          deleteTitle="删除 ServiceAccount"
          deleteContent={`确认删除 ServiceAccount「${row.name}」吗？此操作不可恢复。`}
          onYaml={() => handleOpenYamlForRow(row)}
          onEdit={() => handleOpenYamlForRow(row)}
          onDelete={() => void handleDeleteRow(row)}
          extraActions={[
            {
              key: "secret-token",
              label: "Secret/Token",
              onClick: () => handleOpenSecretTokenForRow(row),
            },
          ]}
        />
      ),
    },
  ];

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <ResourcePageHeader
        path="/configs/serviceaccounts"
        titleSuffix={
          <ResourceAddButton
            title="创建ServiceAccount"
            onClick={() => {
              createForm.resetFields();
              const nextClusterId = clusterId || clusterOptions[0]?.value || "";
              const nextNamespace = namespace || "default";
              createForm.setFieldsValue({
                clusterId: nextClusterId,
                namespace: nextNamespace,
                automountServiceAccountToken: true,
              });
              setCreateMode("form");
              setCreateYaml("");
              setCreateYamlClusterId(nextClusterId);
              setCreateYamlNamespace(nextNamespace);
              setCreateOpen(true);
            }}
          />
        }
      />

      <OpsSurface variant="panel" padding="sm">
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

        <ResourceTable<ServiceAccountRecord>
          rowKey="id"
          columns={columns}
          onResourceNavigate={(request) => setDetailTarget(request)}
          tableKey="configs.serviceaccounts"
          preferencesClient={createTablePreferencesClient(accessToken || undefined)}
          globalSearch={{
            value: keywordInput,
            onChange: handleGlobalSearchChange,
            placeholder: "输入关键字，或 label 过滤（如 env=prod team=platform）",
          }}
          filters={tableFilters}
          onFiltersChange={(nextFilters) => {
            setTableFilters(nextFilters);
            resetPage();
          }}
          sort={{ sortBy, sortOrder }}
          dataSource={tableData}
          layoutOptions={{ nameValues: tableData.map((item) => item.name), nameWidthOptions: { max: 320 } }}
          loading={listQuery.isLoading}
          onChange={(nextPagination, filters, sorter, extra) =>
            handleTableChange(nextPagination, filters, sorter, extra, listQuery.isLoading && !listQuery.data)
          }
          onRow={(record) => ({
            onClick: () => {
              if (record.id) {
                setDetailTarget({
                  kind: "ServiceAccount",
                  id: record.id,
                  kindLabel: "ServiceAccount",
                  apiVersion: record.apiVersion,
                  namespace: record.namespace,
                  name: record.name,
                  label: record.name,
                  snapshot: { labels: record.labels },
                });
              }
            },
          })}
          pagination={getPaginationConfig(listQuery.data?.total ?? 0, listQuery.isLoading && !listQuery.data)}
        />
      </OpsSurface>

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
        footer={(_, { OkBtn, CancelBtn }) => (
          <Space>
            <OpsIconActionButton
              icon={<DownloadOutlined />}
              disabled={!yamlTarget || !yamlValue.trim()}
              disabledReason={!yamlTarget || !yamlValue.trim() ? "没有可下载的 YAML" : undefined}
              onClick={handleDownloadYaml}
            >
              下载 YAML
            </OpsIconActionButton>
            <CancelBtn />
            <OkBtn />
          </Space>
        )}
      >
        <Input.TextArea
          value={yamlValue}
          onChange={(event) => setYamlValue(event.target.value)}
          autoSize={{ minRows: 18, maxRows: 28 }}
          spellCheck={false}
          style={{ fontFamily: "monospace" }}
        />
      </Modal>

      <OpsModalShell
        title="新建 ServiceAccount"
        description="创建命名空间内的 ServiceAccount，用于工作负载或自动化流程身份。"
        identity="ServiceAccount"
        open={createOpen}
        onCancel={() => {
          createForm.resetFields();
          setCreateYaml("");
          setCreateOpen(false);
        }}
        onOk={() => {
          if (createMode === "yaml") {
            if (!createYamlClusterId.trim()) {
              void message.warning("请选择集群");
              return;
            }
            if (!createYaml.trim()) {
              void message.warning("请输入或上传 YAML");
              return;
            }
            applyCreateYamlMutation.mutate();
            return;
          }
          void createForm.validateFields().then((values) => createMutation.mutate(values));
        }}
        okText="创建"
        cancelText="取消"
        confirmLoading={createMutation.isPending || applyCreateYamlMutation.isPending}
        width={720}
      >
        <ResourceCreateMethodTabs
          mode={createMode}
          onModeChange={setCreateMode}
          yaml={createYaml}
          onYamlChange={setCreateYaml}
          clusterId={createYamlClusterId}
          onClusterIdChange={setCreateYamlClusterId}
          namespace={createYamlNamespace}
          onNamespaceChange={setCreateYamlNamespace}
          clusterOptions={clusterOptions}
          clusterLoading={clustersQuery.isLoading}
          clusterUnavailable={clusterUnavailable}
          kindHint="ServiceAccount"
          disabled={createMutation.isPending || applyCreateYamlMutation.isPending}
          formContent={(
            <Form form={createForm} layout="vertical" requiredMark>
              <Form.Item
                name="clusterId"
                label="集群"
                rules={[{ required: true, message: "请选择集群" }]}
              >
                <Select
                  showSearch
                  placeholder={clusterUnavailable ? "集群状态不可用" : "请选择集群"}
                  options={clusterOptions}
                  loading={clustersQuery.isLoading}
                  disabled={clusterUnavailable || (!clustersQuery.isLoading && clusterOptions.length === 0)}
                  notFoundContent={clusterUnavailable ? "集群状态不可用" : undefined}
                  filterOption={(input, option) => String(option?.label ?? "").toLowerCase().includes(input.toLowerCase())}
                  onChange={() => {
                    createForm.setFieldValue("namespace", undefined);
                  }}
                />
              </Form.Item>
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
                  placeholder={createClusterId ? "选择名称空间" : "请先选择集群"}
                  disabled={!createClusterId}
                  loading={createNamespacesQuery.isLoading}
                  options={(createNamespacesQuery.data?.items ?? []).map((item) => ({
                    label: item.namespace,
                    value: item.namespace,
                  }))}
                />
              </Form.Item>
              <Form.Item name="automountServiceAccountToken" label="自动挂载 Token">
                <Select
                  options={[
                    { label: "true", value: true },
                    { label: "false", value: false },
                  ]}
                />
              </Form.Item>
              <Form.Item name="imagePullSecretsText" label="ImagePullSecrets">
                <Input.TextArea rows={2} placeholder={"registry-secret\nharbor-secret"} />
              </Form.Item>
              <Form.Item name="secretsText" label="Secrets">
                <Input.TextArea rows={2} placeholder={"manual-token-secret"} />
              </Form.Item>
              <Form.Item name="labelsText" label="标签">
                <Input.TextArea rows={2} placeholder={"app=ci\nteam=platform"} />
              </Form.Item>
              <Form.Item name="annotationsText" label="注解">
                <Input.TextArea rows={2} placeholder={"iam.gke.io/gcp-service-account=ci@example.iam.gserviceaccount.com"} />
              </Form.Item>
            </Form>
          )}
        />
      </OpsModalShell>

      <Modal
        title={`关联 Secret/Token · ${tokenTitle}`}
        open={tokenModalOpen}
        onCancel={() => setTokenModalOpen(false)}
        footer={null}
        width={900}
      >
        <ResourceTable<SecretTokenRow>
          tableKey="configs.serviceaccounts.tokens"
          rowKey="key"
          dataSource={tokenRows}
          loading={tokenLoading}
          pagination={false}
          locale={{ emptyText: "未发现可用的 ServiceAccount Token Secret" }}
          onResourceNavigate={(request) => setDetailTarget(request)}
          columns={[
            { title: "Secret", dataIndex: "secretName", key: "name" },
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
                <OpsIconActionButton
                  size="small"
                  icon={<CopyOutlined />}
                  disabled={!record.tokenRaw}
                  disabledReason={!record.tokenRaw ? "Token 原文不可用" : undefined}
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
                </OpsIconActionButton>
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
