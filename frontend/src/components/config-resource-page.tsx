"use client";

import { useMemo, useState } from "react";
import dayjs from "dayjs";
import { Alert } from "antd";
import type { TableProps } from "antd";
import { useQuery } from "@tanstack/react-query";
import { ModulePage, type ModuleRecord } from "@/components/module-page";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { getConfigs, type ConfigKind, type ConfigResourceItem } from "@/lib/api/configs";
import { adaptRequestError } from "@/lib/api/helpers";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import { queryKeys } from "@/lib/query";
import { buildTablePagination } from "@/lib/table/pagination";

type ConfigResourcePageProps = {
  kind: ConfigKind;
  title: string;
  description: string;
  keyCountTitle: string;
};

function mapStateToStatus(state: ConfigResourceItem["state"]): string {
  if (state === "active") {
    return "正常";
  }
  if (state === "disabled") {
    return "已禁用";
  }
  return "已删除";
}

function mapConfigToRecord(item: ConfigResourceItem): ModuleRecord {
  return {
    key: `${item.clusterId}/${item.namespace}/${item.name}`,
    name: item.name,
    namespace: item.namespace,
    clusterId: item.clusterId,
    keyCount: item.dataCount,
    version: item.version,
    updatedAt: dayjs(item.updatedAt).format("YYYY-MM-DD HH:mm:ss"),
    status: mapStateToStatus(item.state),
  };
}

export function ConfigResourcePage({ kind, title, description, keyCountTitle }: ConfigResourcePageProps) {
  const { accessToken, isAuthenticated, isInitializing } = useAuth();
  const [keyword, setKeyword] = useState("");
  const [namespace, setNamespace] = useState("全部名称空间");
  const [onlyHealthy, setOnlyHealthy] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(6);

  const queryParams = useMemo(
    () => ({
      page,
      pageSize,
      keyword: keyword.trim() || undefined,
      namespace: namespace === "全部名称空间" ? undefined : namespace,
    }),
    [keyword, namespace, page, pageSize],
  );

  const query = useQuery({
    queryKey: queryKeys.configs.list(kind, queryParams),
    queryFn: () => getConfigs(kind, queryParams, accessToken),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clustersQuery = useQuery({
    queryKey: ["clusters", "config-resource-page", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const dataSource = useMemo(() => (query.data?.items ?? []).map(mapConfigToRecord), [query.data?.items]);
  const clusterMap = useMemo(
    () => Object.fromEntries((clustersQuery.data?.items ?? []).map((item) => [item.id, item.name])),
    [clustersQuery.data?.items],
  );
  const namespaceOptions = useMemo(
    () => Array.from(new Set((query.data?.items ?? []).map((item) => item.namespace))).sort(),
    [query.data?.items],
  );
  const errorMessage = query.error ? adaptRequestError(query.error).message : undefined;

  const columns = useMemo<TableProps<ModuleRecord>["columns"]>(
    () => [
      { title: "名称", dataIndex: "name", key: "name" },
      {
        title: "集群",
        key: "clusterId",
        render: (_: unknown, row: ModuleRecord) => getClusterDisplayName(clusterMap, String(row.clusterId)),
      },
      { title: "名称空间", dataIndex: "namespace", key: "namespace" },
      { title: keyCountTitle, dataIndex: "keyCount", key: "keyCount" },
      { title: "版本", dataIndex: "version", key: "version" },
      { title: "更新时间", dataIndex: "updatedAt", key: "updatedAt" },
      { title: "状态", dataIndex: "status", key: "status" },
    ],
    [clusterMap, keyCountTitle],
  );

  if (!isInitializing && !isAuthenticated) {
    return <Alert type="warning" showIcon message="请先登录后查看配置资源。" />;
  }

  return (
    <ModulePage
      title={title}
      description={description}
      columns={columns}
      dataSource={dataSource}
      namespaceOptions={namespaceOptions}
      loading={query.isLoading}
      hasInitialData={Boolean(query.data)}
      error={errorMessage}
      filterState={{
        keyword,
        namespace,
        onlyHealthy,
        onKeywordChange: (value) => {
          setKeyword(value);
          setPage(1);
        },
        onNamespaceChange: (value) => {
          setNamespace(value);
          setPage(1);
        },
        onOnlyHealthyChange: setOnlyHealthy,
      }}
      tableProps={{
        pagination: buildTablePagination({
          current: page,
          pageSize,
          total: query.data?.total ?? 0,
          onChange: (nextPage, nextPageSize) => {
            setPage(nextPage);
            setPageSize(nextPageSize);
          },
        }),
      }}
    />
  );
}
