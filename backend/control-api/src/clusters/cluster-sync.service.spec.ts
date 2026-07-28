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
