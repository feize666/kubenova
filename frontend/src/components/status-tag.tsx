'use client';
import { OpsStatusTag, type OpsStatusTone } from "@/components/ops";

const STATE_CONFIG: Record<string, { tone: OpsStatusTone; label: string }> = {
  // 治理状态
  active:      { tone: 'success', label: '已启用' },
  disabled:    { tone: 'neutral', label: '已禁用' },
  deleted:     { tone: 'danger',  label: '已删除' },
  unknown:     { tone: 'unknown', label: '未知' },
  // 运行状态
  running:     { tone: 'success',    label: '运行中' },
  pending:     { tone: 'warning',    label: '等待中' },
  failed:      { tone: 'danger',     label: '失败' },
  succeeded:   { tone: 'success',    label: '成功' },
  // 告警状态
  firing:      { tone: 'danger',  label: '告警中' },
  resolved:    { tone: 'success', label: '已恢复' },
  silenced:    { tone: 'neutral', label: '已静默' },
  // 集群健康状态（兼容原有英文值）
  Healthy:     { tone: 'success', label: '健康' },
  Warning:     { tone: 'warning', label: '告警' },
  Critical:    { tone: 'danger',  label: '严重' },
  Maintenance: { tone: 'neutral', label: '维护中' },
};

interface StatusTagProps {
  state: string;
  className?: string;
}

export function StatusTag({ state, className }: StatusTagProps) {
  const config = STATE_CONFIG[state];
  return <OpsStatusTag state={state} tone={config?.tone} className={className}>{config?.label ?? state}</OpsStatusTag>;
}
