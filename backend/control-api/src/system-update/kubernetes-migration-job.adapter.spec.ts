import { KubernetesMigrationJobAdapter } from './kubernetes-migration-job.adapter';

const deployment = {
  metadata: { name: 'control-api' },
  spec: { template: { spec: {
    containers: [{ name: 'control-api', image: 'ghcr.io/feize666/kubenova-control-api:current', workingDir: '/app', env: [{ name: 'DATABASE_URL', value: 'postgresql://live/live' }, { name: 'NODE_ENV', value: 'production' }] }],
    volumes: [{ name: 'runtime-config', emptyDir: {} }],
    imagePullSecrets: [{ name: 'registry' }],
  } } },
};

function createClients() {
  const jobs = new Map<string, any>();
  const secrets = new Map<string, any>();
  const createdJobs: any[] = [];
  const createdSecrets: any[] = [];
  return {
    jobs,
    secrets,
    createdJobs,
    createdSecrets,
    apps: { readNamespacedDeployment: jest.fn(async () => structuredClone(deployment)) },
    batch: {
      createNamespacedJob: jest.fn(async ({ body }) => { jobs.set(body.metadata.name, structuredClone(body)); createdJobs.push(structuredClone(body)); return body; }),
      readNamespacedJob: jest.fn(async ({ name }) => {
        const job = jobs.get(name);
        if (!job) throw { statusCode: 404 };
        return { ...job, status: { succeeded: 1 } };
      }),
      deleteNamespacedJob: jest.fn(async ({ name }) => { jobs.delete(name); }),
    },
    core: {
      createNamespacedSecret: jest.fn(async ({ body }) => { secrets.set(body.metadata.name, structuredClone(body)); createdSecrets.push(structuredClone(body)); return body; }),
      deleteNamespacedSecret: jest.fn(async ({ name }) => { secrets.delete(name); }),
    },
  };
}

describe('Kubernetes migration Job adapter', () => {
  it('runs target migrations with a digest-pinned image and a short-lived secret, then cleans both resources', async () => {
    const clients = createClients();
    const adapter = new KubernetesMigrationJobAdapter(clients.apps as never, clients.batch as never, clients.core as never, 'kubenova', 0, 1000);

    await adapter.runTargetMigrations('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64), 'postgresql://test:secret@postgres/db');

    const job = clients.createdJobs[0];
    const secret = clients.createdSecrets[0];
    expect(job.spec.template.spec.automountServiceAccountToken).toBe(false);
    expect(job.spec.template.spec.serviceAccountName).toBeUndefined();
    expect(job.spec.template.spec.imagePullSecrets).toEqual([{ name: 'registry' }]);
    expect(job.spec.template.spec.volumes).toEqual(deployment.spec.template.spec.volumes);
    expect(job.spec.template.spec.containers[0]).toMatchObject({
      name: 'migration-test',
      image: 'ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64),
      command: ['node_modules/.bin/prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      env: expect.arrayContaining([expect.objectContaining({ name: 'DATABASE_URL', valueFrom: { secretKeyRef: { name: secret.metadata.name, key: 'DATABASE_URL' } } })]),
    });
    expect(secret.stringData.DATABASE_URL).toBe('postgresql://test:secret@postgres/db');
    expect(clients.jobs.size).toBe(0);
    expect(clients.secrets.size).toBe(0);
  });

  it('checks compatibility by starting the current control-api image and probing readiness', async () => {
    const clients = createClients();
    const adapter = new KubernetesMigrationJobAdapter(clients.apps as never, clients.batch as never, clients.core as never, 'kubenova', 0, 1000);

    await adapter.checkPreviousVersionCompatibility('postgresql://test/db');

    const job = clients.createdJobs[0];
    expect(job.spec.template.spec.containers[0].image).toBe(deployment.spec.template.spec.containers[0].image);
    expect(job.spec.template.spec.containers[0].command).toEqual(['node', '-e', expect.stringContaining('/api/health/ready')]);
    expect(clients.jobs.size).toBe(0);
    expect(clients.secrets.size).toBe(0);
  });

  it('removes the temporary Secret even if Job creation fails and fails if cleanup fails', async () => {
    const clients = createClients();
    clients.batch.createNamespacedJob.mockRejectedValueOnce(new Error('job create denied'));
    const adapter = new KubernetesMigrationJobAdapter(clients.apps as never, clients.batch as never, clients.core as never, 'kubenova', 0, 1000);

    await expect(adapter.runTargetMigrations('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64), 'postgresql://test/db'))
      .rejects.toThrow(/job create denied/);
    expect(clients.secrets.size).toBe(0);

    clients.core.deleteNamespacedSecret.mockRejectedValueOnce(new Error('secret cleanup denied'));
    await expect(adapter.runTargetMigrations('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64), 'postgresql://test/db'))
      .rejects.toThrow(/cleanup/i);
  });

  it('attempts cleanup after an ambiguous Secret creation failure', async () => {
    const clients = createClients();
    clients.core.createNamespacedSecret.mockImplementationOnce(async ({ body }) => {
      clients.secrets.set(body.metadata.name, structuredClone(body));
      throw new Error('secret create timed out after server-side commit');
    });
    const adapter = new KubernetesMigrationJobAdapter(clients.apps as never, clients.batch as never, clients.core as never, 'kubenova', 0, 1000);

    await expect(adapter.runTargetMigrations('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64), 'postgresql://test/db'))
      .rejects.toThrow(/secret create timed out/);
    expect(clients.core.deleteNamespacedSecret).toHaveBeenCalledTimes(1);
    expect(clients.secrets.size).toBe(0);
  });

  it('attempts cleanup after an ambiguous Job creation failure', async () => {
    const clients = createClients();
    clients.batch.createNamespacedJob.mockImplementationOnce(async ({ body }) => {
      clients.jobs.set(body.metadata.name, structuredClone(body));
      throw new Error('job create timed out after server-side commit');
    });
    const adapter = new KubernetesMigrationJobAdapter(clients.apps as never, clients.batch as never, clients.core as never, 'kubenova', 0, 1000);

    await expect(adapter.runTargetMigrations('ghcr.io/feize666/kubenova-control-api@sha256:' + 'a'.repeat(64), 'postgresql://test/db'))
      .rejects.toThrow(/job create timed out/);
    expect(clients.batch.deleteNamespacedJob).toHaveBeenCalledTimes(1);
    expect(clients.jobs.size).toBe(0);
    expect(clients.secrets.size).toBe(0);
  });
});
