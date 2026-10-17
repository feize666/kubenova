jest.mock('@kubernetes/client-node', () => ({}));

import { ResourcesService } from './resources.service';

describe('ResourcesService stored workload owner chains', () => {
  const now = new Date('2026-10-12T00:00:00.000Z');
  const container = { name: 'app', image: 'nginx:stable' };

  function owner(kind: string, name: string, uid: string) {
    return {
      apiVersion: kind === 'Job' || kind === 'CronJob' ? 'batch/v1' : 'apps/v1',
      kind,
      name,
      uid,
      controller: true,
      blockOwnerDeletion: true,
    };
  }

  // Mirror cluster-sync statusJson: controller records currently omit their UID.
  function record(kind: string, name: string, ownerReferences: unknown[] = []) {
    const creationTimestamp = now.toISOString();
    const statusJson: Record<string, unknown> =
      kind === 'Pod'
        ? {
            phase: 'Running',
            uid: `${name}-uid`,
            podIP: '10.0.0.2',
            nodeName: 'worker-1',
            restartCount: 0,
            containerNames: ['app'],
            containerImages: ['nginx:stable'],
            image: 'nginx:stable',
            imageResolution: {},
            ownerReferences,
            conditions: [],
            creationTimestamp,
          }
        : kind === 'CronJob'
          ? { lastScheduleTime: null, active: [], creationTimestamp }
          : kind === 'Job'
            ? {
                active: 1,
                succeeded: 0,
                failed: 0,
                ownerReferences,
                creationTimestamp,
              }
            : {
                replicas: 1,
                readyReplicas: 1,
                availableReplicas: 1,
                image: 'nginx:stable',
                images: ['nginx:stable'],
                imageResolution: {},
                ...(kind === 'ReplicaSet'
                  ? { fullyLabeledReplicas: 1, ownerReferences }
                  : {}),
                creationTimestamp,
              };
    return {
      id: `${kind}-${name}`,
      clusterId: 'cluster-a',
      namespace: 'apps',
      kind,
      name,
      state: 'active',
      labels: {},
      annotations: {},
      spec:
        kind === 'Pod'
          ? { containers: [container] }
          : kind === 'CronJob'
            ? {
                schedule: '0 * * * *',
                jobTemplate: {
                  spec: { template: { spec: { containers: [container] } } },
                },
              }
            : { template: { spec: { containers: [container] } } },
      statusJson,
      replicas: kind === 'CronJob' ? null : 1,
      readyReplicas: kind === 'CronJob' ? null : 1,
      createdAt: now,
      updatedAt: now,
    };
  }

  function harness(rows: ReturnType<typeof record>[]) {
    const emptyBoundary = () => ({ findMany: jest.fn().mockResolvedValue([]) });
    const service = new ResourcesService(
      {
        getKubeconfig: jest.fn().mockResolvedValue('mock-kubeconfig'),
      } as never,
      {
        assertClusterOnlineForRead: jest.fn().mockResolvedValue(undefined),
      } as never,
      {
        getCoreApi: jest.fn().mockReturnValue({
          listNamespacedEvent: jest.fn().mockResolvedValue({ items: [] }),
        }),
      } as never,
      {
        workloadRecord: {
          findUnique: jest.fn(
            async ({ where }: { where: { id: string } }) =>
              rows.find((row) => row.id === where.id) ?? null,
          ),
          findMany: jest.fn(
            async ({
              where,
            }: {
              where: {
                clusterId: string;
                namespace?: string;
                state: { not: string };
              };
            }) =>
              rows.filter(
                (row) =>
                  row.clusterId === where.clusterId &&
                  (!where.namespace || row.namespace === where.namespace) &&
                  row.state !== where.state.not,
              ),
          ),
        },
        networkResource: emptyBoundary(),
        storageResource: emptyBoundary(),
        configResource: emptyBoundary(),
      } as never,
    );
    return service;
  }

  async function ownedPods(rows: ReturnType<typeof record>[], base = rows[0]) {
    const detail = await harness(rows).getDetail(base.kind, base.id);
    return detail.associations
      .filter((item) => item.associationType === 'owned-pod')
      .map((item) => item.name)
      .sort();
  }

  async function podOwners(rows: ReturnType<typeof record>[], pod = rows[0]) {
    const detail = await harness(rows).getDetail('Pod', pod.id);
    return detail.associations.filter(
      (item) => item.associationType === 'owner',
    );
  }

  it('retains the Pod owner association when the stored target UID matches', async () => {
    const pod = record('Pod', 'nightly-pod', [
      owner('Job', 'nightly', 'job-uid'),
    ]);
    const job = record('Job', 'nightly');
    job.statusJson.uid = 'job-uid';
    expect(await podOwners([pod, job])).toEqual([
      {
        id: 'Job-nightly',
        kind: 'Job',
        name: 'nightly',
        namespace: 'apps',
        associationType: 'owner',
      },
    ]);
  });

  it('does not expose a Pod owner association to a same-named target with a different known UID', async () => {
    const pod = record('Pod', 'nightly-pod', [
      owner('Job', 'nightly', 'retired-job-uid'),
    ]);
    const job = record('Job', 'nightly');
    job.statusJson.uid = 'current-job-uid';
    expect(await podOwners([pod, job])).toEqual([]);
    const detail = await harness([pod, job]).getDetail('Pod', pod.id);
    expect(detail.metadata.ownerReferences).toEqual([
      {
        kind: 'Job',
        name: 'nightly',
        uid: 'retired-job-uid',
        controller: true,
      },
    ]);
  });

  it('retains the Pod owner association for a legacy stored target without a UID', async () => {
    const pod = record('Pod', 'nightly-pod', [
      owner('Job', 'nightly', 'job-uid'),
    ]);
    const job = record('Job', 'nightly');
    expect(await podOwners([pod, job])).toEqual([
      {
        id: 'Job-nightly',
        kind: 'Job',
        name: 'nightly',
        namespace: 'apps',
        associationType: 'owner',
      },
    ]);
  });

  it('does not use a different namespace target for a Pod owner association', async () => {
    const pod = record('Pod', 'nightly-pod', [
      owner('Job', 'nightly', 'job-uid'),
    ]);
    const job = { ...record('Job', 'nightly'), namespace: 'private' };
    job.statusJson.uid = 'job-uid';
    expect(await podOwners([pod, job])).toEqual([]);
  });

  it('does not use a different cluster target for a Pod owner association', async () => {
    const pod = record('Pod', 'nightly-pod', [
      owner('Job', 'nightly', 'job-uid'),
    ]);
    const job = { ...record('Job', 'nightly'), clusterId: 'cluster-b' };
    job.statusJson.uid = 'job-uid';
    expect(await podOwners([pod, job])).toEqual([]);
  });

  it('discovers CronJob -> Job -> Pod without labels or stored controller UIDs', async () => {
    const cron = record('CronJob', 'nightly');
    const job = record('Job', 'nightly-123', [
      owner('CronJob', 'nightly', 'cron-uid'),
    ]);
    const pod = record('Pod', 'nightly-123-pod', [
      owner('Job', 'nightly-123', 'job-uid'),
    ]);
    expect(await ownedPods([cron, job, pod])).toEqual(['nightly-123-pod']);
  });

  it('discovers Deployment -> ReplicaSet -> Pod without a label selector', async () => {
    const deployment = record('Deployment', 'api');
    const replicaSet = record('ReplicaSet', 'api-rs', [
      owner('Deployment', 'api', 'deployment-uid'),
    ]);
    const pod = record('Pod', 'api-rs-pod', [
      owner('ReplicaSet', 'api-rs', 'rs-uid'),
    ]);
    expect(await ownedPods([deployment, replicaSet, pod])).toEqual([
      'api-rs-pod',
    ]);
  });

  it('excludes same-named chains outside the target namespace or cluster', async () => {
    const cron = record('CronJob', 'nightly');
    const job = record('Job', 'nightly-123', [
      owner('CronJob', 'nightly', 'cron-uid'),
    ]);
    const pod = record('Pod', 'local', [
      owner('Job', 'nightly-123', 'job-uid'),
    ]);
    const foreignNamespace = {
      ...record('Pod', 'foreign-namespace', [
        owner('Job', 'nightly-123', 'job-uid'),
      ]),
      namespace: 'private',
    };
    const foreignCluster = {
      ...record('Pod', 'foreign-cluster', [
        owner('Job', 'nightly-123', 'job-uid'),
      ]),
      clusterId: 'cluster-b',
    };
    expect(
      await ownedPods([cron, job, pod, foreignNamespace, foreignCluster]),
    ).toEqual(['local']);
  });

  it('does not infer chains from prefixes, labels, or an absent intermediate owner', async () => {
    const cron = record('CronJob', 'nightly');
    const prefixOnly = {
      ...record('Pod', 'nightly-123-pod'),
      labels: { app: 'nightly' },
    };
    const missingJob = record('Pod', 'dangling', [
      owner('Job', 'nightly-123', 'job-uid'),
    ]);
    expect(await ownedPods([cron, prefixOnly, missingJob])).toEqual([]);
  });

  it('terminates disconnected cyclic owner chains without claiming their Pods', async () => {
    const cron = record('CronJob', 'nightly');
    const first = record('Job', 'cycle-a', [
      owner('Job', 'cycle-b', 'cycle-b-uid'),
    ]);
    const second = record('Job', 'cycle-b', [
      owner('Job', 'cycle-a', 'cycle-a-uid'),
    ]);
    const pod = record('Pod', 'cyclic-pod', [
      owner('Job', 'cycle-a', 'cycle-a-uid'),
    ]);
    expect(await ownedPods([cron, first, second, pod])).toEqual([]);
  });

  it('checks UID on a chain node whose own UID is actually persisted', async () => {
    const deployment = record('Deployment', 'api');
    const replicaSet = record('ReplicaSet', 'api-rs', [
      owner('Deployment', 'api', 'deployment-uid'),
    ]);
    const parentPod = record('Pod', 'parent', [
      owner('ReplicaSet', 'api-rs', 'rs-uid'),
    ]);
    // Pod UID is stored by cluster-sync; Pod ownership is legal even though uncommon.
    const valid = record('Pod', 'valid-child', [
      owner('Pod', 'parent', 'parent-uid'),
    ]);
    const stale = record('Pod', 'stale-child', [
      owner('Pod', 'parent', 'retired-parent-uid'),
    ]);
    expect(
      await ownedPods([deployment, replicaSet, parentPod, valid, stale]),
    ).toEqual(['parent', 'valid-child']);
  });

  // These enriched controller fixtures depend on this batch's sync UID repair.
  it('rejects stale UID at either edge of Deployment -> ReplicaSet -> Pod', async () => {
    const deployment = record('Deployment', 'api');
    deployment.statusJson.uid = 'deployment-uid';
    const replicaSet = record('ReplicaSet', 'api-rs', [
      owner('Deployment', 'api', 'deployment-uid'),
    ]);
    replicaSet.statusJson.uid = 'rs-uid';
    const staleReplicaSet = record('ReplicaSet', 'api-stale-rs', [
      owner('Deployment', 'api', 'retired-deployment-uid'),
    ]);
    staleReplicaSet.statusJson.uid = 'stale-rs-uid';
    const valid = record('Pod', 'valid', [
      owner('ReplicaSet', 'api-rs', 'rs-uid'),
    ]);
    const stalePod = record('Pod', 'stale-pod', [
      owner('ReplicaSet', 'api-rs', 'retired-rs-uid'),
    ]);
    const staleAncestor = record('Pod', 'stale-ancestor', [
      owner('ReplicaSet', 'api-stale-rs', 'stale-rs-uid'),
    ]);
    expect(
      await ownedPods([
        deployment,
        replicaSet,
        staleReplicaSet,
        valid,
        stalePod,
        staleAncestor,
      ]),
    ).toEqual(['valid']);
  });

  it('does not let matching selector labels override an explicit owner UID mismatch', async () => {
    const job = record('Job', 'nightly-123');
    job.statusJson.uid = 'current-job-uid';
    const base = {
      ...job,
      spec: { ...job.spec, selector: { matchLabels: { app: 'nightly' } } },
    };
    const pod = {
      ...record('Pod', 'stale', [
        owner('Job', 'nightly-123', 'retired-job-uid'),
      ]),
      labels: { app: 'nightly' },
    };
    expect(await ownedPods([base, pod])).toEqual([]);
  });
});
