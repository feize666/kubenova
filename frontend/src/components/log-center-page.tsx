"use client";

import { SearchOutlined, SettingOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import { Input, Select, Table, Typography } from "antd";
import Link from "next/link";
import { useState } from "react";
import { useAuth } from "@/components/auth-context";
import { useOptionalClusterWorkspace } from "@/components/cluster-workspace-context";
import { NamespaceSelect } from "@/components/namespace-select";
import { OpsIconActionButton, OpsPageHeader, OpsState } from "@/components/ops";
import { useClusterNamespaceFilter } from "@/hooks/use-cluster-namespace-filter";
import { ApiError } from "@/lib/api/client";
import { canQueryLogCenter, eligibleLogSources, logQueryWindow, queryLogCenter, type LogCenterQuery, type LogCenterRow, type LogTimeRange } from "@/lib/api/log-center";
import { listObservabilityDataSources } from "@/lib/api/observability-config";
import { buildClusterResourceHref } from "@/lib/cluster-workspace";
import styles from "./log-center-page.module.css";

function LogQueryResults({ input, range, token }: { input: Omit<LogCenterQuery, "from" | "to">; range: LogTimeRange; token: string }) {
  const [requestedAt, setRequestedAt] = useState<Date | null>(null);
  const query = useQuery({
    queryKey: ["log-center-query", token, input, range, requestedAt?.toISOString()],
    queryFn: ({ signal }) => queryLogCenter({ ...input, ...logQueryWindow(range, requestedAt!) }, token, signal),
    enabled: requestedAt !== null,
    retry: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    gcTime: 0,
  });
  const rows = query.data?.rows ?? [];
  const denied = query.error instanceof ApiError && query.error.status === 403;
  return <>
    <div className={styles.resultHeader}>
      <OpsIconActionButton type="primary" opsTone="primary" icon={<SearchOutlined />} loading={query.isFetching} onClick={() => setRequestedAt(new Date())}>查询</OpsIconActionButton>
      {query.isSuccess ? <Typography.Text type="secondary">{rows.length} 条{rows.length >= (input.limit ?? 100) ? " · 已达本次条数上限" : ""}</Typography.Text> : null}
      {requestedAt ? <Typography.Text type="secondary">截至 {requestedAt.toLocaleString()}</Typography.Text> : null}
    </div>
    {!requestedAt ? <OpsState kind="empty" title="尚未查询" />
      : query.isFetching ? <OpsState kind="loading" title="正在查询日志" />
      : query.isError ? <OpsState kind={denied ? "permission" : "error"} title={denied ? "当前账号无日志查询权限" : "日志查询失败"} description={denied ? "日志中心当前仅向平台管理员开放。" : "数据源可能不可用或配置不完整，请检查数据源后重试。"} />
      : !rows.length ? <OpsState kind="filtered-empty" title="未找到匹配日志" />
      : <Table<LogCenterRow>
        size="small"
        rowKey={(_row, index) => String(index)}
        dataSource={rows}
        pagination={false}
        tableLayout="fixed"
        scroll={{ x: 1000, y: 520 }}
        columns={[
          { title: "时间", dataIndex: "timestamp", width: 205, ellipsis: true },
          { title: "命名空间", dataIndex: "namespace", width: 130, ellipsis: true },
          { title: "Pod", dataIndex: "pod", width: 170, ellipsis: true },
          { title: "容器", dataIndex: "container", width: 130, ellipsis: true },
          { title: "消息", dataIndex: "message", ellipsis: true },
        ]}
        expandable={{
          expandedRowRender: (row) => <div className={styles.raw}><Typography.Paragraph copyable={{ text: row.message }} className={styles.message}>{row.message}</Typography.Paragraph></div>,
          columnTitle: <span className={styles.expandLabel}>原文</span>,
          columnWidth: 55,
        }}
      />}
  </>;
}

function ClusterLogCenter({ clusterId, token }: { clusterId: string; token: string }) {
  const { namespace, onNamespaceChange } = useClusterNamespaceFilter(clusterId);
  const [selectedSource, setSelectedSource] = useState<string>();
  const [keyword, setKeyword] = useState("");
  const [range, setRange] = useState<LogTimeRange>("15m");
  const [limit, setLimit] = useState(100);
  const sourcesQuery = useQuery({
    queryKey: ["log-center-sources", clusterId, token],
    queryFn: () => listObservabilityDataSources(clusterId, token),
    retry: false,
  });
  const sources = eligibleLogSources(sourcesQuery.data?.items ?? [], clusterId);
  const sourceId = sources.some((source) => source.id === selectedSource) ? selectedSource! : sources[0]?.id;
  const configuration = <Link href={buildClusterResourceHref(clusterId, "observability/configuration")}><SettingOutlined /> 数据源配置</Link>;
  const input = { clusterId, dataSourceId: sourceId ?? "", namespace: namespace || undefined, keyword: keyword || undefined, limit };

  return <div className={styles.page}>
    <OpsPageHeader title="日志中心" surface={false} actions={configuration} />
    {sourcesQuery.isPending ? <OpsState kind="loading" title="正在加载日志数据源" />
      : sourcesQuery.isError ? <OpsState kind={sourcesQuery.error instanceof ApiError && sourcesQuery.error.status === 403 ? "permission" : "error"} title="无法读取日志数据源" action={<OpsIconActionButton onClick={() => void sourcesQuery.refetch()}>重试</OpsIconActionButton>} />
      : !sources.length ? <OpsState kind="disabled" title="当前集群未配置可用日志数据源" description="需要已启用且绑定当前集群的 Elasticsearch 数据源。" action={configuration} />
      : <>
        <div className={styles.filters}>
          <Select aria-label="日志数据源" value={sourceId} onChange={setSelectedSource} options={sources.map((source) => ({ value: source.id, label: source.name }))} />
          <NamespaceSelect value={namespace} onChange={onNamespaceChange} clusterId={clusterId} />
          <Select<LogTimeRange> aria-label="时间范围" value={range} onChange={setRange} options={[{ value: "15m", label: "最近 15 分钟" }, { value: "1h", label: "最近 1 小时" }, { value: "6h", label: "最近 6 小时" }, { value: "24h", label: "最近 24 小时" }]} />
          <Select aria-label="结果条数上限" value={limit} onChange={setLimit} options={[50, 100, 200].map((value) => ({ value, label: `最多 ${value} 条` }))} />
          <Input className={styles.search} aria-label="搜索日志文本" placeholder="搜索日志文本" prefix={<SearchOutlined />} maxLength={512} allowClear value={keyword} onChange={(event) => setKeyword(event.target.value)} />
        </div>
        {/* Remount each query session on scope/filter changes; consumed signals cancel old requests. */}
        <LogQueryResults key={JSON.stringify([input, range])} input={input} range={range} token={token} />
      </>}
  </div>;
}

export default function LogCenterPage() {
  const workspace = useOptionalClusterWorkspace();
  const { accessToken, role, isInitializing } = useAuth();
  if (isInitializing) return <OpsState kind="loading" title="正在验证访问权限" />;
  if (!accessToken || !canQueryLogCenter(role)) return <div className={styles.page}><OpsPageHeader title="日志中心" surface={false} /><OpsState kind="permission" title="日志中心当前仅向平台管理员开放" /></div>;
  if (!workspace?.clusterId) return <OpsState kind="disabled" title="请从集群工作区打开日志中心" />;
  return <ClusterLogCenter key={`${workspace.clusterId}:${accessToken}`} clusterId={workspace.clusterId} token={accessToken} />;
}
