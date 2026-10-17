jest.mock('@kubernetes/client-node', () => ({}));

import type * as k8s from '@kubernetes/client-node';
import type { PrismaService } from '../platform/database/prisma.service';
import type { K8sClientService } from './k8s-client.service';
import { ClusterSyncService } from './cluster-sync.service';

interface SerializedOwnerReference {
  apiVersion: string | null;
  kind: string | null;
  name: string | null;
  uid: string | null;
  controller: boolean;
  blockOwnerDeletion: boolean;
}

interface ReplicaSetUpsertInput {
  create: { statusJson: { ownerReferences: SerializedOwnerReference[] } };
  update: { statusJson: { ownerReferences: SerializedOwnerReference[] } };
}

type JobUpsertInput = ReplicaSetUpsertInput;

describe('ClusterSyncService', () => {
  it('does not let a failed sync block retries or merge different clusters', async () => {
    const service = new ClusterSyncService({} as PrismaService, {} as K8sClientService);
    const releases = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
    const run = jest.spyOn(service as any, 'runClusterSync').mockImplementation((...args: unknown[]) => new Promise((resolve, reject) => releases.set(String(args[0]), { resolve, reject })));
    const first = service.syncCluster('a', 'fixture');
    const same = service.syncCluster('a', 'fixture');
    const other = service.syncCluster('b', 'fixture');
    expect(run).toHaveBeenCalledTimes(2);
    const failures = Promise.allSettled([first, same]);
    releases.get('a')!.reject(new Error('fixture failure'));
    expect((await failures).map(result => result.status)).toEqual(['rejected', 'rejected']);
    const retry = service.syncCluster('a', 'fixture');
    expect(run).toHaveBeenCalledTimes(3);
    releases.get('a')!.resolve({ ok: true });
    releases.get('b')!.resolve({ ok: true });
    await Promise.all([retry, other]);
  });
  it('shares an in-flight full sync for the same cluster and releases it afterward', async () => {
    const service = new ClusterSyncService({} as PrismaService, {} as K8sClientService);
    let release!: (result: unknown) => void;
    const run = jest.spyOn(service as any, 'runClusterSync').mockImplementation(() => new Promise(resolve => { release = resolve; }));
    const first = service.syncCluster('c', 'fixture');
    const second = service.syncCluster('c', 'fixture');
    expect(run).toHaveBeenCalledTimes(1);
    release({ ok: true });
    await expect(first).resolves.toEqual({ ok: true });
    await expect(second).resolves.toEqual({ ok: true });
    const third = service.syncCluster('c', 'fixture');
    expect(run).toHaveBeenCalledTimes(2);
    release({ ok: true });
    await third;
  });
  it('persists ReplicaSet owner references for topology owner chains', async () => {
    let capturedCreateOwnerReferences: SerializedOwnerReference[] | null = null;
    let capturedUpdateOwnerReferences: SerializedOwnerReference[] | null = null;
    const workloadRecord = {
      upsert: jest.fn((input: ReplicaSetUpsertInput): Promise<void> => {
        capturedCreateOwnerReferences = input.create.statusJson.ownerReferences;
        capturedUpdateOwnerReferences = input.update.statusJson.ownerReferences;
        return Promise.resolve();
      }),
      findMany: jest.fn().mockResolvedValue([]),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    };
    const prisma = { workloadRecord } as unknown as PrismaService;
    const service = new ClusterSyncService(
      prisma,
      {} as K8sClientService,
    ) as unknown as {
      syncReplicaSets(
        clusterId: string,
        appsApi: k8s.AppsV1Api,
        errors: string[],
      ): Promise<number>;
    };
    const appsApi = {
      listReplicaSetForAllNamespaces: jest.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              namespace: 'app',
              name: 'api-7f5d9',
              labels: { app: 'api' },
              ownerReferences: [
                {
                  apiVersion: 'apps/v1',
                  kind: 'Deployment',
                  name: 'api',
                  uid: 'deployment-uid',
                  controller: true,
                  blockOwnerDeletion: true,
                },
              ],
            },
            spec: {
              replicas: 2,
              template: {
                spec: { containers: [{ name: 'api', image: 'api:v1' }] },
              },
            },
            status: { replicas: 2, readyReplicas: 2 },
          },
        ],
      }),
    } as unknown as k8s.AppsV1Api;

    const errors: string[] = [];
    await expect(service.syncReplicaSets('c-1', appsApi, errors)).resolves.toBe(
      1,
    );

    expect(errors).toEqual([]);
    const expectedOwnerReferences: SerializedOwnerReference[] = [
      {
        apiVersion: 'apps/v1',
        kind: 'Deployment',
        name: 'api',
        uid: 'deployment-uid',
        controller: true,
        blockOwnerDeletion: true,
      },
    ];
    expect(capturedCreateOwnerReferences).toEqual(expectedOwnerReferences);
    expect(capturedUpdateOwnerReferences).toEqual(expectedOwnerReferences);
  });

  it('persists Job owner references for CronJob topology chains', async () => {
    let capturedCreateOwnerReferences: SerializedOwnerReference[] | null = null;
    let capturedUpdateOwnerReferences: SerializedOwnerReference[] | null = null;
    const prisma = {
      workloadRecord: {
        upsert: jest.fn((input: JobUpsertInput): Promise<void> => {
          capturedCreateOwnerReferences =
            input.create.statusJson.ownerReferences;
          capturedUpdateOwnerReferences =
            input.update.statusJson.ownerReferences;
          return Promise.resolve();
        }),
        findMany: jest.fn().mockResolvedValue([]),
        updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
    } as unknown as PrismaService;
    const service = new ClusterSyncService(
      prisma,
      {} as K8sClientService,
    ) as unknown as {
      syncJobs(
        clusterId: string,
        batchApi: k8s.BatchV1Api,
        errors: string[],
      ): Promise<number>;
    };
    const batchApi = {
      listJobForAllNamespaces: jest.fn().mockResolvedValue({
        items: [
          {
            metadata: {
              namespace: 'ops',
              name: 'backup-123',
              ownerReferences: [
                {
                  apiVersion: 'batch/v1',
                  kind: 'CronJob',
                  name: 'backup',
                  uid: 'cronjob-uid',
                  controller: true,
                  blockOwnerDeletion: true,
                },
              ],
            },
            spec: { completions: 1 },
            status: { succeeded: 1 },
          },
        ],
      }),
    } as unknown as k8s.BatchV1Api;

    await expect(service.syncJobs('c-1', batchApi, [])).resolves.toBe(1);
    const expected = [
      {
        apiVersion: 'batch/v1',
        kind: 'CronJob',
        name: 'backup',
        uid: 'cronjob-uid',
        controller: true,
        blockOwnerDeletion: true,
      },
    ];
    expect(capturedCreateOwnerReferences).toEqual(expected);
    expect(capturedUpdateOwnerReferences).toEqual(expected);
  });
});
