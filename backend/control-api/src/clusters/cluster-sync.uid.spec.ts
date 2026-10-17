jest.mock('@kubernetes/client-node', () => ({}));
import { ClusterSyncService } from './cluster-sync.service';

describe('controller UID sync', () => {
  it.each([
    ['Deployment', 'syncDeployments', 'listDeploymentForAllNamespaces'],
    ['ReplicaSet', 'syncReplicaSets', 'listReplicaSetForAllNamespaces'],
    ['StatefulSet', 'syncStatefulSets', 'listStatefulSetForAllNamespaces'],
    ['DaemonSet', 'syncDaemonSets', 'listDaemonSetForAllNamespaces'],
    ['Job', 'syncJobs', 'listJobForAllNamespaces'],
    ['CronJob', 'syncCronJobs', 'listCronJobForAllNamespaces'],
  ])(
    'persists the live %s UID on creation and resync',
    async (kind, method, list) => {
      const upsert = jest.fn().mockResolvedValue({});
      const service = new ClusterSyncService(
        {
          workloadRecord: {
            upsert,
            findMany: jest.fn().mockResolvedValue([]),
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
          },
        } as never,
        {} as never,
      );
      const row = {
        metadata: { name: 'api', namespace: 'apps', uid: 'original-uid' },
        spec: {
          template: { spec: { containers: [{ name: 'api', image: 'nginx' }] } },
          jobTemplate: {
            spec: {
              template: {
                spec: { containers: [{ name: 'api', image: 'nginx' }] },
              },
            },
          },
        },
        status: {},
      };
      const api = {
        [list]: jest.fn().mockImplementation(async () => ({ items: [row] })),
      };
      const invoke = (
        service as unknown as Record<
          string,
          (cluster: string, api: unknown, errors: string[]) => Promise<number>
        >
      )[method].bind(service);
      const errors: string[] = [];
      expect(await invoke('cluster-a', api, errors)).toBe(1);
      expect(errors).toEqual([]);
      expect(upsert.mock.calls[0][0].create.statusJson.uid).toBe(
        'original-uid',
      );
      row.metadata.uid = 'replacement-uid';
      expect(await invoke('cluster-a', api, errors)).toBe(1);
      expect(upsert.mock.calls[1][0].update.statusJson.uid).toBe(
        'replacement-uid',
      );
    },
  );
});
