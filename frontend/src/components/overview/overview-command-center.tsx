import { ReloadOutlined } from "@ant-design/icons";
import Link from "next/link";
import { Space } from "antd";
import { OpsFilterChip, OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";

export function OverviewCommandCenter({ scopeLabel, clusterId, riskLevel, generatedAt, isFetching, onRefresh }: { scopeLabel: string; clusterId: string; riskLevel: "critical" | "warning" | "success" | "unknown"; generatedAt?: string; isFetching?: boolean; onRefresh?: () => void }) {
  const freshness = generatedAt ? new Date(generatedAt).toLocaleString("zh-CN") : "等待采集";
  const riskLabel = { critical: "高风险", warning: "需关注", success: "稳定", unknown: "数据不足" }[riskLevel];
  return <OpsSurface variant="panel" padding="sm">
    <ResourcePageHeader path="/" embedded className="ops-overview-header resource-workbench__header dashboard-workbench__page-header"
      title={<span className="resource-workbench__title-row"><span className="resource-workbench__title">集群概览</span></span>}
      description={`${scopeLabel} 的集群健康与资源运行态势`}
      actions={<Space size={8} wrap className="ops-overview-header__chips">
        <OpsStatusTag tone={riskLevel}>{riskLabel}</OpsStatusTag>
        <OpsFilterChip tone="neutral">{clusterId ? "单集群" : "全部集群"}</OpsFilterChip>
        <OpsIconActionButton aria-label="刷新仪表盘" title="刷新仪表盘" icon={<ReloadOutlined />} onClick={onRefresh} disabled={isFetching} />
      </Space>} />
    <div className="ops-overview-command-meta" aria-label="数据新鲜度">最近采集 {freshness} · 数据范围 {scopeLabel}<Link href={clusterId ? `/clusters/${encodeURIComponent(clusterId)}/overview` : "/clusters"} prefetch={false}>进入集群工作区</Link></div>
  </OpsSurface>;
}
