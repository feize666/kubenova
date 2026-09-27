"use client";

import { ArrowUpOutlined, CloudDownloadOutlined, LinkOutlined, ReloadOutlined, SafetyCertificateOutlined } from "@ant-design/icons";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Col, Row, Space, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { usePathname } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { BusinessDetailDrawer, type BusinessDetailSection } from "@/components/business-detail-drawer";
import { OpsFilterChip, OpsIconActionButton, OpsStatusTag, OpsSurface } from "@/components/ops";
import { ResourcePageHeader } from "@/components/resource-page-header";
import { ResourceTable } from "@/components/resource-table";
import type { HeadlampResourceTableColumn, HeadlampTableFilters } from "@/components/resource-table";
import { createTablePreferencesClient } from "@/lib/api/table-preferences";
import {
  getSystemUpdateHistory,
  getSystemUpdateStatus,
  checkSystemUpdate,
  triggerPostReleaseAudit,
  type SystemUpdateHistoryItem,
} from "@/lib/api/system-update";

function statusTag(status: string) {
  if (status === "installed") return <OpsStatusTag tone="success">已安装</OpsStatusTag>;
  if (status === "installed-not-active") return <OpsStatusTag tone="warning">已安装未激活</OpsStatusTag>;
  if (status === "installing" || status === "restarting" || status === "rollbacking") {
    return <OpsStatusTag tone="processing">进行中</OpsStatusTag>;
  }
  if (status === "failed") return <OpsStatusTag tone="danger">失败</OpsStatusTag>;
  return <OpsStatusTag tone="neutral">空闲</OpsStatusTag>;
}

export default function SystemUpdatePage() {
  const pathname = usePathname();
  const { message } = App.useApp();
  const { accessToken, isInitializing } = useAuth();
  const queryClient = useQueryClient();
  const [tableFilters, setTableFilters] = useState<HeadlampTableFilters>({});
  const [detailRecord, setDetailRecord] = useState<SystemUpdateHistoryItem | null>(null);

  const statusQuery = useQuery({
    queryKey: ["system-update", "status", accessToken],
    queryFn: () => getSystemUpdateStatus(accessToken ?? undefined),
    enabled: !isInitializing && Boolean(accessToken),
    refetchInterval: 5000,
  });

  const historyQuery = useQuery({
    queryKey: ["system-update", "history", accessToken],
    queryFn: () => getSystemUpdateHistory(accessToken ?? undefined),
    enabled: !isInitializing && Boolean(accessToken),
    refetchInterval: 5000,
  });

  const checkMutation = useMutation({
    mutationFn: () => checkSystemUpdate(accessToken ?? undefined),
    onSuccess: (data) => {
      queryClient.setQueryData(["system-update", "status", accessToken], data);
      if (!data.updateCheckError) message.success(data.updateAvailable ? "发现可用更新" : "版本检测完成");
    },
    onError: (error) => message.error(error instanceof Error ? error.message : "检查更新失败"),
  });

  const auditMutation = useMutation({
    mutationFn: () =>
      triggerPostReleaseAudit(
        {
          confirm: true,
          releaseVersion: statusQuery.data?.runningVersion,
        },
        accessToken ?? undefined,
      ),
    onSuccess: async () => {
      message.success("发布后审计已触发（异步执行）");
      await queryClient.invalidateQueries({ queryKey: ["system-update"] });
    },
    onError: (error) => {
      message.error(error instanceof Error ? error.message : "触发审计失败");
    },
  });

  const columns: Array<HeadlampResourceTableColumn<SystemUpdateHistoryItem>> = [
    {
      title: "时间",
      dataIndex: "timestamp",
      key: "timestamp",
      required: true,
      width: 180,
      render: (v: string) => new Date(v).toLocaleString(),
    },
    {
      title: "操作",
      dataIndex: "operationType",
      key: "operationType",
      width: 170,
      filter: { type: "text", placeholder: "以操作过滤" },
      render: (v: string, record) => (
        <Typography.Link onClick={() => setDetailRecord(record)}>
          <OpsFilterChip tone="neutral">{v}</OpsFilterChip>
        </Typography.Link>
      ),
    },
    {
      title: "目标版本",
      dataIndex: "targetVersion",
      key: "targetVersion",
      width: 160,
      filter: { type: "text", placeholder: "以版本过滤" },
      render: (v?: string) => v || "-",
    },
    {
      title: "结果",
      dataIndex: "result",
      key: "result",
      width: 100,
      filter: {
        type: "select",
        placeholder: "以结果过滤",
        options: [
          { label: "成功", value: "success" },
          { label: "失败", value: "failed" },
        ],
      },
      render: (v: string) => <OpsStatusTag tone={v === "success" ? "success" : "danger"}>{v}</OpsStatusTag>,
    },
    {
      title: "耗时(ms)",
      dataIndex: "durationMs",
      key: "durationMs",
      width: 120,
      render: (v?: number) => (typeof v === "number" ? v : "-"),
    },
    {
      title: "消息",
      dataIndex: "message",
      key: "message",
      filter: { type: "text", placeholder: "以消息过滤" },
    },
  ];

  const status = statusQuery.data;
  const updateRoute = pathname === "/settings/update" ? "/settings/update" : "/system/update";
  const historyRows = useMemo(() => {
    const operationFilter = typeof tableFilters.operationType === "string" ? tableFilters.operationType.toLowerCase() : "";
    const targetVersionFilter = typeof tableFilters.targetVersion === "string" ? tableFilters.targetVersion.toLowerCase() : "";
    const resultFilter = typeof tableFilters.result === "string" ? tableFilters.result : "";
    const messageFilter = typeof tableFilters.message === "string" ? tableFilters.message.toLowerCase() : "";
    return (historyQuery.data?.items ?? []).filter((item) => {
      const matchOperation = operationFilter ? item.operationType.toLowerCase().includes(operationFilter) : true;
      const matchVersion = targetVersionFilter ? (item.targetVersion ?? "").toLowerCase().includes(targetVersionFilter) : true;
      const matchResult = resultFilter ? item.result === resultFilter : true;
      const matchMessage = messageFilter ? item.message.toLowerCase().includes(messageFilter) : true;
      return matchOperation && matchVersion && matchResult && matchMessage;
    });
  }, [
    historyQuery.data?.items,
    tableFilters.message,
    tableFilters.operationType,
    tableFilters.result,
    tableFilters.targetVersion,
  ]);

  return (
    <Space className="resource-workbench system-update-workbench" orientation="vertical" size={16} style={{ width: "100%" }}>
      <OpsSurface variant="panel" padding="sm">
        <ResourcePageHeader
          path={updateRoute}
          embedded
          className="resource-workbench__header"
          title={
            <span className="resource-workbench__title-row">
              <span className="resource-workbench__title">System Update</span>
              <OpsFilterChip tone="info" className="resource-workbench__kind-chip" style={{ margin: 0 }}>
                更新管理
              </OpsFilterChip>
            </span>
          }
          description="系统设置 / 更新管理"
          actions={(
            <>
              <OpsFilterChip tone="neutral">运行 {status?.runningVersion ?? "-"}</OpsFilterChip>
              <OpsIconActionButton icon={<ReloadOutlined />} loading={checkMutation.isPending} onClick={() => checkMutation.mutate()}>
                检查更新
              </OpsIconActionButton>
            </>
          )}
        />
      </OpsSurface>

      {statusQuery.isError ? <Alert type="error" showIcon title="无法读取更新状态" description={statusQuery.error.message} /> : null}
      {status?.updateCheckError ? <Alert type="warning" showIcon title="检查更新失败" description={status.updateCheckError} /> : null}
      <Alert className="system-resource-state-alert" showIcon type="info" title="发布检测与部署执行分离"
        description={status?.manualUpdateReason ?? "只检测包含完整产物和校验文件的正式 Release；实际升级通过部署脚本执行。"} />
      {status?.updateAvailable ? (
        <Alert className="system-update-available-alert" type="info" showIcon icon={<ArrowUpOutlined />}
          title={`发现新版本 ${status.latestVersion}`}
          description="发布包与 SHA256 校验文件已就绪。升级前请备份数据库和配置，并核对发布说明中的兼容性要求。" />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} md={12}>
          <OpsSurface variant="panel" padding="sm" title="版本状态">
            <Space orientation="vertical" size={16} style={{ width: "100%" }}>
              <div><Typography.Text type="secondary">当前构建版本</Typography.Text><div><OpsFilterChip tone="info">{status?.runningVersion ?? "—"}</OpsFilterChip></div></div>
              <div><Typography.Text type="secondary">部署类型</Typography.Text><div>{status ? (status.buildType === "release" ? "正式发布产物" : "源码部署") : "—"}</div></div>
              <div><Typography.Text type="secondary">最近检测到的正式版本</Typography.Text><div><OpsFilterChip tone="neutral">{status?.latestReleaseUrl ? status.latestVersion : "尚未获取"}</OpsFilterChip></div></div>
              <div><Typography.Text type="secondary">检测时间</Typography.Text><div>{status?.lastUpdateCheckAt ? new Date(status.lastUpdateCheckAt).toLocaleString("zh-CN") : "检测中…"}</div></div>
              <div><Typography.Text type="secondary">发布时间</Typography.Text><div>{status?.latestReleasePublishedAt ? new Date(status.latestReleasePublishedAt).toLocaleString("zh-CN") : "—"}</div></div>
              <Typography.Text type="secondary">每 5 分钟自动检查；网络失败会明确提示，不会被误报为“已是最新版本”。源码构建版本不代表已安装的生产版本。</Typography.Text>
            </Space>
          </OpsSurface>
        </Col>
        <Col xs={24} md={12}>
          <OpsSurface variant="panel" padding="sm" title="下载与升级">
            <Space orientation="vertical" size={12} style={{ width: "100%" }}>
              {status?.latestReleaseUrl ? <Typography.Link href={status.latestReleaseUrl} target="_blank" rel="noopener noreferrer">查看发布说明 <LinkOutlined /></Typography.Link> : null}
              {status?.releaseReady && status.downloadUrl && status.checksumUrl ? <>
                <Typography.Link href={status.downloadUrl}><CloudDownloadOutlined /> 下载 Ubuntu 24.04 x64 发布包</Typography.Link>
                <Typography.Link href={status.checksumUrl}>下载 SHA256 校验文件</Typography.Link>
                <Typography.Text type="secondary">将两个文件放在同一目录后验证完整性：</Typography.Text>
                <Typography.Paragraph code copyable>sha256sum -c kubenova-ubuntu.tar.gz.sha256</Typography.Paragraph>
                <Typography.Text type="secondary">Docker Compose：先在部署主机备份数据库，并更新部署脚本与配置模板；再用同一版本更新三个服务。首次拉取私有 GHCR 包需登录或由仓库管理员将包设为公开。</Typography.Text>
                <Typography.Paragraph code copyable>{`bash scripts/compose-release.sh up --tag ${status.latestVersion}`}</Typography.Paragraph>
                <Typography.Text type="secondary">二进制部署：校验后解压到独立版本目录，按升级文档完成迁移、切换与健康检查。不要覆盖正在运行的目录。</Typography.Text>
              </> : <Typography.Text type="secondary">正式发布完成后提供下载和升级指引。仅推送 tag 不会被当作可安装更新。</Typography.Text>}
              <Typography.Text type="warning">网页不执行宿主机安装、重启或回滚。数据库迁移不会因切换旧镜像自动撤销，回滚前必须核对兼容性。</Typography.Text>
              {status?.postReleaseAudit.enabled ? <OpsIconActionButton icon={<SafetyCertificateOutlined />} loading={auditMutation.isPending} onClick={() => auditMutation.mutate()}>手动触发发布后审计</OpsIconActionButton> : null}
            </Space>
          </OpsSurface>
        </Col>
      </Row>

      <OpsSurface variant="panel" padding="sm" title="更新历史">
        <div className="resource-workbench__table-zone">
          <ResourceTable<SystemUpdateHistoryItem>
            rowKey={(row, idx) => `${row.timestamp}-${row.operationType}-${idx}`}
            tableKey="business.system.updateHistory"
            columns={columns as ColumnsType<SystemUpdateHistoryItem>}
            dataSource={historyRows}
            preferencesClient={createTablePreferencesClient(accessToken || undefined)}
            filters={tableFilters}
            onFiltersChange={setTableFilters}
            loading={statusQuery.isLoading || historyQuery.isLoading}
            pagination={false}
            scroll={{ x: 1100 }}
          />
        </div>
      </OpsSurface>
      <BusinessDetailDrawer
        open={Boolean(detailRecord)}
        title={detailRecord ? `更新历史 · ${detailRecord.operationType}` : "更新历史"}
        subtitle={detailRecord?.targetVersion}
        onClose={() => setDetailRecord(null)}
        sections={buildSystemUpdateDetailSections(detailRecord)}
      />
    </Space>
  );
}

function buildSystemUpdateDetailSections(record: SystemUpdateHistoryItem | null): BusinessDetailSection[] {
  if (!record) {
    return [];
  }
  return [
    {
      key: "operation",
      title: "操作信息",
      items: [
        { key: "operationType", label: "操作", value: record.operationType },
        { key: "targetVersion", label: "目标版本", value: record.targetVersion || "-" },
        { key: "result", label: "结果", value: statusTag(record.result === "success" ? "installed" : "failed") },
        { key: "timestamp", label: "时间", value: new Date(record.timestamp).toLocaleString("zh-CN") },
      ],
    },
    {
      key: "detail",
      title: "执行详情",
      items: [
        { key: "durationMs", label: "耗时(ms)", value: typeof record.durationMs === "number" ? record.durationMs : "-" },
        { key: "message", label: "消息", value: record.message || "-" },
      ],
    },
  ];
}
