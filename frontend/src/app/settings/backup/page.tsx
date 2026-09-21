"use client";

import { DatabaseOutlined, ReloadOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { Alert, Col, Row, Space, Typography } from 'antd';
import { useAuth } from '@/components/auth-context';
import { OpsFilterChip, OpsIconActionButton, OpsStatusTag, OpsSurface } from '@/components/ops';
import { ResourcePageHeader } from '@/components/resource-page-header';
import { getBackupStatus, type BackupRunStatus } from '@/lib/api/backup';

function runTag(status: BackupRunStatus) {
  if (status === 'success') return <OpsStatusTag tone="success">成功</OpsStatusTag>;
  if (status === 'failed') return <OpsStatusTag tone="danger">失败</OpsStatusTag>;
  if (status === 'running') return <OpsStatusTag tone="processing">执行中</OpsStatusTag>;
  return <OpsStatusTag tone="neutral">未知</OpsStatusTag>;
}

function valueOrUnknown(value: string | null | undefined) {
  return value || '未知';
}

export default function SettingsBackupPage() {
  const { accessToken, isInitializing } = useAuth();
  const statusQuery = useQuery({
    queryKey: ['system-backup', 'status', accessToken],
    queryFn: () => getBackupStatus(accessToken ?? undefined),
    enabled: !isInitializing && Boolean(accessToken),
    refetchInterval: 30_000,
  });
  const status = statusQuery.data;

  return (
    <main className="portal-settings">
      <OpsSurface variant="panel" padding="sm">
        <ResourcePageHeader
          title={<span><DatabaseOutlined style={{ marginRight: 8 }} />备份与恢复</span>}
          path="/settings/backup"
          embedded
          description="查看异地备份配置与最近运行状态"
          actions={(
            <OpsIconActionButton
              icon={<ReloadOutlined />}
              loading={statusQuery.isFetching}
              onClick={() => void statusQuery.refetch()}
            >
              刷新
            </OpsIconActionButton>
          )}
        />
      </OpsSurface>

      {statusQuery.isError ? (
        <Alert type="error" showIcon title="备份状态读取失败" description="请确认当前账号是平台管理员，并检查控制面服务。" />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={12}>
          <OpsSurface variant="panel" padding="sm" title="配置状态">
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <div><Typography.Text type="secondary">配置完整性</Typography.Text><div>{status ? <OpsStatusTag tone={status.configuration.ready ? 'success' : 'warning'}>{status.configuration.ready ? '已就绪' : '待配置'}</OpsStatusTag> : <OpsStatusTag tone="neutral">加载中</OpsStatusTag>}</div></div>
              <div><Typography.Text type="secondary">仓库类型</Typography.Text><div><OpsFilterChip tone="info">{status?.repository.type ?? '未知'}</OpsFilterChip></div></div>
              <div><Typography.Text type="secondary">保留策略</Typography.Text><div><OpsFilterChip tone="neutral">每日 {status?.retention.daily ?? 7} 份 · 每周 {status?.retention.weekly ?? 4} 份</OpsFilterChip></div></div>
              <div><Typography.Text type="secondary">执行计划</Typography.Text><div>{status?.schedule.configured ? `${status.schedule.expression} · ${status.schedule.timezone}` : '未配置'}</div></div>
              <div><Typography.Text type="secondary">最近一次运行</Typography.Text><div>{status ? runTag(status.lastRun.status) : <OpsStatusTag tone="neutral">加载中</OpsStatusTag>}<Typography.Text type="secondary" style={{ marginLeft: 8 }}>{valueOrUnknown(status?.lastRun.completedAt)}</Typography.Text></div></div>
            </Space>
          </OpsSurface>
        </Col>
        <Col xs={24} lg={12}>
          <OpsSurface variant="panel" padding="sm" title="恢复边界">
            <Space orientation="vertical" size={12} style={{ width: '100%' }}>
              <Alert type="info" showIcon icon={<SafetyCertificateOutlined />} title="Web 端不直接执行恢复" description="恢复必须由受控运维流程在独立目标环境中执行，避免误覆盖在线数据。" />
              <Typography.Paragraph type="secondary" style={{ margin: 0 }}>
                演练建议：选择明确的快照，恢复到空的 loopback 数据库或隔离目录，完成数据、登录和密钥校验后，再由管理员评审切换。
              </Typography.Paragraph>
              <Typography.Text type="secondary">当前状态：仅提供只读可见性，不会在浏览器中提交恢复命令。</Typography.Text>
            </Space>
          </OpsSurface>
        </Col>
      </Row>
    </main>
  );
}
