'use client';
import { Tag } from 'antd';

const STATE_CONFIG: Record<string, { color: string; label: string }> = {
  // 治理状态
  active:      { color: 'success', label: '已启用' },
  disabled:    { color: 'default', label: '已禁用' },
  deleted:     { color: 'error',   label: '已删除' },
  unknown:     { color: 'warning', label: '未知' },
  // 运行状态
  running:     { color: 'processing', label: '运行中' },
  pending:     { color: 'warning',    label: '等待中' },
  failed:      { color: 'error',      label: '失败' },
  succeeded:   { color: 'success',    label: '成功' },
  // 告警状态
  firing:      { color: 'error',   label: '告警中' },
  resolved:    { color: 'success', label: '已恢复' },
  silenced:    { color: 'default', label: '已静默' },
  // 集群健康状态（兼容原有英文值）
  Healthy:     { color: 'success', label: '健康' },
  Warning:     { color: 'warning', label: '告警' },
  Critical:    { color: 'error',   label: '严重' },
  Maintenance: { color: 'default', label: '维护中' },
};

interface StatusTagProps {
  state: string;
  className?: string;
}

export function StatusTag({ state, className }: StatusTagProps) {
  const config = STATE_CONFIG[state] ?? { color: 'default', label: state };
  return (
    <Tag color={config.color} className={className}>
      {config.label}
    </Tag>
  );
}
