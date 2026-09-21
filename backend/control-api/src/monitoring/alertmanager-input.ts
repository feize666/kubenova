import { BadRequestException } from '@nestjs/common';

export interface AlertmanagerEvent {
  fingerprint: string;
  status: 'firing' | 'resolved';
  startsAt: Date;
  endsAt: Date | null;
  namespace: string | null;
  severity: 'critical' | 'warning' | 'info';
  title: string;
  message: string;
  labels: Record<string, string>;
  annotations: Record<string, string>;
}

const invalid = () => new BadRequestException('告警请求格式无效或超出大小限制');
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid();
  return value as Record<string, unknown>;
}
function strings(value: unknown): Record<string, string> {
  const entries = Object.entries(object(value ?? {}));
  if (entries.length > 64 || entries.some(([key, item]) => !key || key.length > 256 || typeof item !== 'string' || Buffer.byteLength(item) > 8192)) throw invalid();
  return Object.fromEntries(entries) as Record<string, string>;
}
function timestamp(value: unknown): Date {
  if (typeof value !== 'string' || value.length > 64) throw invalid();
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (!match) throw invalid();
  const [, year, month, day, hour, minute, second, zone] = match;
  const calendar = new Date(Date.UTC(+year, +month - 1, +day));
  if (+year < 1970 || calendar.getUTCFullYear() !== +year || calendar.getUTCMonth() !== +month - 1 || calendar.getUTCDate() !== +day || +hour > 23 || +minute > 59 || +second > 59 || (zone !== 'Z' && (+zone.slice(1, 3) > 23 || +zone.slice(4) > 59))) throw invalid();
  const result = new Date(value);
  if (!Number.isFinite(result.getTime())) throw invalid();
  return result;
}

// Cluster ownership comes from the authenticated receiver, never payload labels.
export function parseAlertmanagerInput(input: unknown): AlertmanagerEvent[] {
  let size: number;
  try { size = Buffer.byteLength(JSON.stringify(input)); } catch { throw invalid(); }
  if (size > 1048576) throw invalid();
  const { alerts } = object(input);
  if (!Array.isArray(alerts) || alerts.length < 1 || alerts.length > 100) throw invalid();
  return alerts.map(raw => {
    const value = object(raw);
    if (typeof value.fingerprint !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(value.fingerprint)) throw invalid();
    if (value.status !== 'firing' && value.status !== 'resolved') throw invalid();
    const startsAt = timestamp(value.startsAt);
    const endsAt = value.status === 'resolved' ? timestamp(value.endsAt) : null;
    if (endsAt && endsAt < startsAt) throw invalid();
    const labels = strings(value.labels);
    const annotations = strings(value.annotations);
    return {
      fingerprint: value.fingerprint, status: value.status, startsAt, endsAt,
      namespace: labels.namespace || null,
      severity: labels.severity === 'critical' || labels.severity === 'info' ? labels.severity : 'warning',
      title: annotations.summary || labels.alertname || value.fingerprint,
      message: annotations.description || annotations.summary || labels.alertname || value.fingerprint,
      labels, annotations,
    };
  });
}
