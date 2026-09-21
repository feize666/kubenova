jest.mock('@kubernetes/client-node', () => ({}));

import { ForbiddenException } from '@nestjs/common';
import { MonitoringService } from './monitoring.service';
import { AuthorizationService } from '../common/authorization.service';
import { ClusterAccessService } from '../common/cluster-access.service';
import { MonitoringController } from './monitoring.controller';

const reader = { id: 'reader', role: 'read-only' };
const operator = { id: 'reader', role: 'cluster-operator' };
const now = new Date();
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: [string, any]) => {
    if (value === undefined) return true;
    if (key === 'AND') return (Array.isArray(value) ? value : [value]).every(v => matches(row, v));
    if (key === 'OR') return value.some((v: any) => matches(row, v));
    if (key === 'NOT') return !matches(row, value);
    if (key === 'cluster') return true;
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('in' in value && !value.in.some((item: any) => value.mode === 'insensitive' && typeof item === 'string' ? item.toLowerCase() === row[key]?.toLowerCase() : item === row[key])) return false;
      if ('not' in value && row[key] === value.not) return false;
      if ('gte' in value && row[key] < value.gte) return false;
      if ('lte' in value && row[key] > value.lte) return false;
      return true;
    }
    return row[key] === value;
  });
}

function fixture() {
  const grant = (id: string, role: string, capabilities: string[] = []) => ({
    id, userId: reader.id, groupId: null, clusterId: 'a', role,
    state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null,
    namespaces: [{ namespaceName: 'allowed', namespaceUid: 'uid-a' }],
    capabilities: capabilities.map(capability => ({ capability })),
  });
  const grants = [grant('read', 'viewer')];
  const alerts = [
    ['ok', 'a', 'allowed', 'Pod'], ['foreign-ns', 'a', 'private', 'Pod'],
    ['foreign-cluster', 'b', 'allowed', 'Pod'], ['cluster-wide', 'a', null, 'Node'],
    ['secret', 'a', 'allowed', 'Secret'], ['platform', null, null, null],
  ].map(([id, clusterId, namespace, resourceType]) => ({
    id, clusterId, namespace, resourceType, resourceName: id, title: id,
    message: id, severity: 'warning', source: 'prometheus', status: 'firing',
    firedAt: now, resolvedAt: null,
  }));
  const workloads: any[] = [];
  const delegate = (rows: any[]) => ({
    findMany: jest.fn(async ({ where, skip = 0, take }: any = {}) => rows.filter(row => matches(row, where)).slice(skip, take === undefined ? undefined : skip + take)),
    count: jest.fn(async ({ where }: any) => rows.filter(row => matches(row, where)).length),
  });
  const prisma = {
    groupMembership: { findMany: async () => [] },
    accessGrant: { findMany: async () => grants },
    clusterRoleBinding: { findMany: async () => [], findFirst: async () => null },
    clusterRegistry: delegate([{ id: 'a', name: 'A', status: 'healthy', deletedAt: null }, { id: 'b', name: 'B', status: 'healthy', deletedAt: null }]),
    monitoringAlert: { ...delegate(alerts), findUnique: async ({ where }: any) => alerts.find(row => row.id === where.id), update: jest.fn(async ({ where }: any) => ({ ...alerts.find(row => row.id === where.id), status: 'resolved' })) },
    namespaceRecord: delegate(['allowed', 'private'].map(name => ({ clusterId: 'a', name, state: 'active', labels: {}, updatedAt: now }))),
    workloadRecord: delegate(workloads), networkResource: delegate([]), storageResource: delegate([]),
    configResource: delegate([{ id: 'secret', clusterId: 'a', namespace: 'allowed', kind: 'Secret', name: 'secret', state: 'active', dataKeys: [], updatedAt: now }]),
  };
  const authorization = new AuthorizationService(prisma as never);
  const access = new ClusterAccessService(prisma as never, authorization);
  const identity = { resolve: jest.fn(async () => 'uid-a') };
  const clusters = { getKubeconfig: jest.fn(async () => 'config') };
  const metrics = { getClusterSnapshot: jest.fn(async () => ({ available: true, pods: [{ namespace: 'private', name: 'secret-pod' }] })) };
  const service = Reflect.construct(MonitoringService, [prisma, clusters, metrics, undefined, access, authorization, identity]) as any;
  return { service, prisma, grants, grant, identity, clusters, alerts, workloads };
}

describe('Monitoring effective namespace grants', () => {
  it('passes the authenticated identity through HTTP controller reads and fails closed when missing', async () => {
    const { service } = fixture();
    const controller = new MonitoringController(service);
    const result = await controller.getAlerts(undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, { user: { user: reader as never } });
    expect(result.total).toBe(1);
    await expect(controller.getAlerts()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getEvents()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getOverview()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.getInspection()).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.rerunInspection({})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(controller.generateFixYaml('x', {})).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => controller.listAlertRules()).toThrow(ForbiddenException);
  });

  it('filters alerts before pagination and counts, including Secret and cluster-wide records', async () => {
    const { service } = fixture();
    const result = await service.getAlerts({ pageSize: 1 }, reader);
    expect(result.total).toBe(1);
    expect(result.items.map((item: any) => item.id)).toEqual(['ok']);
  });

  it('filters events, exports and inspection with the same scope', async () => {
    const { service } = fixture();
    expect((await service.getEvents({}, reader)).items.map((item: any) => item.id)).toEqual(['ok']);
    const exported = await service.exportAlerts({}, 'json', reader);
    expect(JSON.parse(exported.data).items.map((item: any) => item.id)).toEqual(['ok']);
    const report = await service.getClusterInspection('a', undefined, {}, reader);
    expect(report.items.every((item: any) => item.namespace === 'allowed')).toBe(true);
    expect(JSON.stringify(report)).not.toContain('Secret/');
    expect(report.summary.totalResources).toBe(1);
  });

  it('denies foreign cluster, namespace and unknown identities', async () => {
    const { service } = fixture();
    await expect(service.getAlerts({ clusterId: 'b' }, reader)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getClusterInspection('a', 'private', {}, reader)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getAlerts({}, {})).rejects.toBeInstanceOf(ForbiddenException);
    await expect(service.getAlerts({}, { ...reader, role: 'typo' })).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('rechecks namespace UID and revocation, bypassing the global summary cache', async () => {
    const { service, identity, grants } = fixture();
    await service.getObservabilitySummary({});
    const scoped = await service.getObservabilitySummary({}, reader);
    expect(scoped.activeAlerts.total).toBe(1);
    identity.resolve.mockResolvedValue('recreated');
    expect((await service.getAlerts({}, reader)).total).toBe(0);
    identity.resolve.mockResolvedValue('uid-a');
    grants.splice(0);
    expect((await service.getObservabilitySummary({}, reader)).activeAlerts.total).toBe(0);
  });

  it('does not fetch whole-cluster metrics for namespace-only readers', async () => {
    const { service, clusters } = fixture();
    const result = await service.getOverview({ clusterId: 'a' }, reader);
    expect(clusters.getKubeconfig).not.toHaveBeenCalled();
    expect(result.usageDataSource).toBe('none');
    expect(result.degraded).toBe(true);
    expect(result.liveSnapshot).toBeUndefined();
    expect(result.healthScore).toBeNull();
    expect(result.cpuUsagePercent).toBeNull();
  });

  it('scopes fallback workload alerts before their limit and aggregation', async () => {
    const { service, alerts, workloads } = fixture();
    alerts.splice(0);
    for (const namespace of ['allowed', 'private']) workloads.push({ id: namespace, clusterId: 'a', namespace, kind: 'Deployment', name: namespace, state: 'active', replicas: 3, readyReplicas: 0, statusJson: {}, updatedAt: now });
    const result = await service.getAlerts({}, reader);
    expect(result.total).toBe(1);
    expect(result.items.map((item: any) => item.namespace)).toEqual(['allowed']);
    expect((await service.getOverview({}, reader)).criticalCount).toBe(1);
    expect((await service.getEvents({}, reader)).items.map((item: any) => item.id)).toEqual(['derived-allowed']);
  });

  it('permits explicitly granted Secret diagnostics but not legacy whole-cluster readers', async () => {
    const { service, grants, grant, prisma } = fixture();
    grants.push(grant('secret', 'viewer', ['secrets']));
    expect((await service.getAlerts({}, reader)).items.map((item: any) => item.id)).toEqual(['ok', 'secret']);
    const report = await service.getClusterInspection('a', 'allowed', {}, reader);
    expect(report.items.find((item: any) => item.resourceKind === 'Secret')).toBeDefined();
    grants.splice(0);
    prisma.clusterRoleBinding.findMany = async () => [{ clusterId: 'a' }] as never;
    expect((await service.getAlerts({}, reader)).items.map((item: any) => item.id)).toEqual(['ok', 'foreign-ns', 'cluster-wide']);
  });

  it('does not expose Secret alerts through case variants of the resource type', async () => {
    const { service, alerts } = fixture();
    alerts.push({ ...alerts[4], id: 'upper-secret', resourceType: 'SECRET' });
    expect((await service.getAlerts({}, reader)).items.map((item: any) => item.id)).toEqual(['ok']);
  });

  it('keeps platform administrators unrestricted', async () => {
    const { service } = fixture();
    expect((await service.getAlerts({}, { id: 'admin', role: 'platform-admin' })).total).toBe(6);
  });

  it('fails closed when the live namespace lookup fails', async () => {
    const { service, identity } = fixture();
    identity.resolve.mockRejectedValue(new Error('offline'));
    expect((await service.getAlerts({}, reader)).total).toBe(0);
    await expect(service.getClusterInspection('a', 'allowed', {}, reader)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('restricts cluster-wide panels and rule configuration', async () => {
    const { service } = fixture();
    await expect(service.getGrafanaPanelConfiguration('a', '1h', reader)).rejects.toBeInstanceOf(ForbiddenException);
    expect(() => service.listAlertRules(reader)).toThrow(ForbiddenException);
    expect(() => service.createAlertRule(operator, { name: 'rule', severity: 'warning', target: '*', condition: 'x' })).toThrow(ForbiddenException);
    expect(() => service.updateAlertRule(operator, 'x', {})).toThrow(ForbiddenException);
    expect(() => service.deleteAlertRule(operator, 'x')).toThrow(ForbiddenException);
    expect(() => service.setAlertRuleState(operator, 'x', 'disabled')).toThrow(ForbiddenException);
    expect(() => service.listAlertRules({ role: 'platform-admin' })).toThrow(ForbiddenException);
  });

  it('requires mutation permission for inspection drafts without combining Secret capabilities', async () => {
    const { service, grants, grant, workloads } = fixture();
    workloads.push({ id: 'dep', clusterId: 'a', namespace: 'allowed', kind: 'Deployment', name: 'dep', state: 'active', replicas: 3, readyReplicas: 0, statusJson: {}, updatedAt: now });
    const report = await service.getClusterInspection('a', 'allowed', {}, reader);
    const issue = report.items.find((item: any) => item.resourceKind === 'Deployment');
    await expect(service.executeInspectionAction(issue.id, 'generate-yaml', { clusterId: 'a', namespace: 'allowed' }, reader)).rejects.toBeInstanceOf(ForbiddenException);
    grants.push(grant('operator', 'operator'));
    expect((await service.executeInspectionAction(issue.id, 'generate-yaml', { clusterId: 'a', namespace: 'allowed' }, operator)).success).toBe(true);
    grants.push(grant('secret-read', 'viewer', ['secrets']));
    const secret = (await service.getClusterInspection('a', 'allowed', {}, operator)).items.find((item: any) => item.resourceKind === 'Secret');
    await expect(service.executeInspectionAction(secret.id, 'generate-yaml', { clusterId: 'a', namespace: 'allowed' }, operator)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('does not authorize namespace-object mutation with only a namespaced operator grant', async () => {
    const { service, grants, grant } = fixture();
    grants.push(grant('operator', 'operator'));
    const issue = (await service.getClusterInspection('a', 'allowed', {}, operator)).items.find((item: any) => item.resourceKind === 'Namespace');
    await expect(service.executeInspectionAction(issue.id, 'generate-yaml', { clusterId: 'a', namespace: 'allowed' }, operator)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('requires a single mutation grant with secrets capability for Secret alert resolution', async () => {
    const { service, prisma, grants, grant } = fixture();
    grants.splice(0, 1, grant('read-secret', 'viewer', ['secrets']), grant('write', 'operator'));
    await expect(service.resolveAlert('secret', operator)).rejects.toBeInstanceOf(ForbiddenException);
    expect(prisma.monitoringAlert.update).not.toHaveBeenCalled();
    expect((await service.resolveAlert('ok', operator)).status).toBe('resolved');
    grants.push(grant('write-secret', 'operator', ['secrets']));
    expect((await service.resolveAlert('secret', operator)).status).toBe('resolved');
    await expect(service.resolveAlert('ok', reader)).rejects.toBeInstanceOf(ForbiddenException);
  });
});
