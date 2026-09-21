import { BadRequestException } from '@nestjs/common';
import { parseAlertmanagerInput } from './alertmanager-input';

const event = { fingerprint: 'abc123', status: 'firing', startsAt: '2026-09-18T00:00:00Z', endsAt: '0001-01-01T00:00:00Z', labels: { alertname: 'PodDown', namespace: 'ops', cluster: 'untrusted', severity: 'critical' }, annotations: { summary: 'Pod failed', description: 'Details' } };

describe('Alertmanager input boundary', () => {
  it('uses individual event status and does not accept cluster identity from labels', () => {
    const [result] = parseAlertmanagerInput({ status: 'resolved', alerts: [event] });
    expect(result).toEqual({ fingerprint: 'abc123', status: 'firing', startsAt: new Date('2026-09-18T00:00:00Z'), endsAt: null, namespace: 'ops', severity: 'critical', title: 'Pod failed', message: 'Details', labels: event.labels, annotations: event.annotations });
    expect(result).not.toHaveProperty('clusterId');
  });
  it('accepts recovery and preserves its occurrence start', () => {
    const [result] = parseAlertmanagerInput({ alerts: [{ ...event, status: 'resolved', endsAt: '2026-09-18T01:00:00Z' }] });
    expect(result.endsAt?.toISOString()).toBe('2026-09-18T01:00:00.000Z');
    expect(result.startsAt.toISOString()).toBe('2026-09-18T00:00:00.000Z');
  });
  it.each([null, {}, { alerts: [] }, { alerts: Array(101).fill(event) }, { alerts: [event, { ...event, status: 'unknown' }] }])('rejects malformed whole batch', input => {
    expect(() => parseAlertmanagerInput(input)).toThrow(BadRequestException);
  });
  it.each([{ fingerprint: '' }, { startsAt: '2026-02-30T00:00:00Z' }, { startsAt: 'today' }, { labels: { severity: 2 } }, { annotations: { summary: 'x'.repeat(8193) } }, { status: 'resolved', endsAt: '2026-09-17T00:00:00Z' }, { status: 'resolved', endsAt: '0001-01-01T00:00:00Z' }])('rejects malformed event fields %j', patch => {
    expect(() => parseAlertmanagerInput({ alerts: [{ ...event, ...patch }] })).toThrow(BadRequestException);
  });
});
