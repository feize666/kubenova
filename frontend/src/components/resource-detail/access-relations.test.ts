import assert from 'node:assert/strict';
import test from 'node:test';
import { stableSelector, matchesSelector, belongsToWorkload, relatedServices, selectorImpact, ingressServices, createServiceDraft, serviceAddresses } from './access-relations';
import type { ResourceManifest } from '../../lib/resource-editor';
const resource = (kind: string, name: string, extra = {}): ResourceManifest => ({ apiVersion: 'v1', kind, metadata: { name, namespace: 'demo', uid: name }, ...extra });
const workload = resource('Deployment', 'app', { spec: { selector: { matchLabels: { app: 'api', 'pod-template-hash': 'old' } }, template: { metadata: { labels: { app: 'api', 'pod-template-hash': 'old' } }, spec: { containers: [{ ports: [{ containerPort: 8080, name: 'http' }] }] } } } });
test('selectors come from Pod templates, drop rollout labels, preserve named ports', () => {
  assert.deepEqual(stableSelector(workload), { app: 'api' });
  assert.deepEqual((createServiceDraft(workload).spec as { ports: unknown[] }).ports, [{ name: 'http', protocol: 'TCP', port: 8080, targetPort: 'http' }]);
  assert.equal(matchesSelector({ app: 'api' }, {}), false);
  assert.equal(matchesSelector({ app: 'api' }, { matchExpressions: [{ key: 'app', operator: 'In', values: ['api'] }] }), true);
});
test('no-selector Services require real targetRef; ExternalName and other namespaces do not fake links', () => {
  const pod = resource('Pod', 'pod', { metadata: { name: 'pod', namespace: 'demo', uid: 'pod', labels: { app: 'api', 'pod-template-hash': 'old' } } });
  const svc = resource('Service', 'manual', { spec: {} });
  assert.deepEqual(relatedServices(workload, [svc], [pod], [workload], []), []);
  const ep = resource('Endpoints', 'manual', { subsets: [{ addresses: [{ targetRef: { kind: 'Pod', uid: 'pod', name: 'pod' } }] }] });
  assert.deepEqual(relatedServices(workload, [svc], [pod], [workload], [ep]), [svc]);
  assert.deepEqual(relatedServices(workload, [{ ...svc, spec: { type: 'ExternalName' } }], [pod], [workload], [ep]), []);
});
test('impact exposes shared selectors and Ingress parses real backend names', () => {
  const second = { ...workload, metadata: { ...workload.metadata, name: 'other', uid: 'other' } };
  assert.equal(selectorImpact({ app: 'api' }, [], [workload, second]).workloads.length, 2);
  assert.deepEqual(ingressServices(resource('Ingress', 'route', { spec: { defaultBackend: { service: { name: 'svc' } }, rules: [{ http: { paths: [{ backend: { service: { name: 'svc2' } } }] } }] } })), ['svc', 'svc2']);
  assert.equal(serviceAddresses(resource('Service', 'svc', { spec: { ports: [{ name: 'http', port: 80 }] } }))[0].open, false);
});

const cronJob = resource('CronJob', 'nightly', { apiVersion: 'batch/v1', spec: { jobTemplate: { spec: { template: { spec: { containers: [] } } } } } });
const cronJobRef = { apiVersion: 'batch/v1', kind: 'CronJob', name: 'nightly', uid: 'nightly', controller: true };
const job = resource('Job', 'nightly-run', { apiVersion: 'batch/v1', metadata: { name: 'nightly-run', namespace: 'demo', uid: 'job-uid', ownerReferences: [cronJobRef] } });
const jobRef = { apiVersion: 'batch/v1', kind: 'Job', name: 'nightly-run', uid: 'job-uid', controller: true };
const jobPod = resource('Pod', 'nightly-pod', { metadata: { name: 'nightly-pod', namespace: 'demo', uid: 'pod-uid', ownerReferences: [jobRef] } });
const manualService = resource('Service', 'nightly-manual', { spec: {} });
const manualEndpoints = resource('Endpoints', 'nightly-manual', { subsets: [{ addresses: [{ targetRef: { kind: 'Pod', name: 'nightly-pod', namespace: 'demo', uid: 'pod-uid' } }] }] });

test('CronJob membership follows a same-namespace Pod to Job to CronJob owner chain without selectors', () => {
  assert.equal(belongsToWorkload(jobPod, cronJob, [job, cronJob]), true);
  assert.deepEqual(relatedServices(cronJob, [manualService], [jobPod], [job, cronJob], [manualEndpoints]), [manualService]);
});

const invalidOwnerChains = [
  {
    name: 'an intermediate owner in another namespace',
    pod: jobPod,
    owners: [{ ...job, metadata: { ...job.metadata, namespace: 'other' } }, cronJob],
  },
  {
    name: 'an intermediate owner with a mismatched kind despite the same UID',
    pod: { ...jobPod, metadata: { ...jobPod.metadata, ownerReferences: [{ ...jobRef, kind: 'ReplicaSet' }] } },
    owners: [job, cronJob],
  },
  {
    name: 'an intermediate owner with a mismatched name despite the same UID',
    pod: { ...jobPod, metadata: { ...jobPod.metadata, ownerReferences: [{ ...jobRef, name: 'different-run' }] } },
    owners: [job, cronJob],
  },
  {
    name: 'a target owner reference with a mismatched kind despite the same UID',
    pod: jobPod,
    owners: [{ ...job, metadata: { ...job.metadata, ownerReferences: [{ ...cronJobRef, kind: 'Deployment' }] } }, cronJob],
  },
  {
    name: 'a target owner reference with a mismatched name despite the same UID',
    pod: jobPod,
    owners: [{ ...job, metadata: { ...job.metadata, ownerReferences: [{ ...cronJobRef, name: 'different-schedule' }] } }, cronJob],
  },
];

for (const { name, pod, owners } of invalidOwnerChains) {
  test(`CronJob membership rejects ${name}`, () => {
    assert.equal(belongsToWorkload(pod, cronJob, owners), false);
  });
  test(`manual Service does not link a CronJob through ${name}`, () => {
    assert.deepEqual(relatedServices(cronJob, [manualService], [pod], owners, [manualEndpoints]), []);
  });
}

test('CronJob owner traversal terminates when Jobs form a cycle without reaching the CronJob', () => {
  const first = { ...job, metadata: { ...job.metadata, ownerReferences: [{ apiVersion: 'batch/v1', kind: 'Job', name: 'second-run', uid: 'second-uid', controller: true }] } };
  const second = resource('Job', 'second-run', { apiVersion: 'batch/v1', metadata: { name: 'second-run', namespace: 'demo', uid: 'second-uid', ownerReferences: [jobRef] } });
  assert.equal(belongsToWorkload(jobPod, cronJob, [first, second, cronJob]), false);
  assert.deepEqual(relatedServices(cronJob, [manualService], [jobPod], [first, second, cronJob], [manualEndpoints]), []);
});
