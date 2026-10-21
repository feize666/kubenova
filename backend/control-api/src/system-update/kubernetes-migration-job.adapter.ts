import { randomUUID } from 'node:crypto';

type ApiError = { statusCode?: number; response?: { statusCode?: number; body?: { code?: number } } };
type DeploymentPodTemplate = {
  spec?: {
    containers?: Array<Record<string, any>>;
    volumes?: Array<Record<string, any>>;
    imagePullSecrets?: Array<Record<string, any>>;
    [key: string]: unknown;
  };
};

const trustedControlApiImage = /^ghcr\.io\/feize666\/kubenova-control-api@sha256:[a-f0-9]{64}$/i;

export class KubernetesMigrationJobAdapter {
  constructor(
    private readonly appsApi: {
      readNamespacedDeployment(input: { name: string; namespace: string }): Promise<{ spec?: { template?: DeploymentPodTemplate } }>;
    },
    private readonly batchApi: {
      createNamespacedJob(input: { namespace: string; body: Record<string, any> }): Promise<unknown>;
      readNamespacedJob(input: { name: string; namespace: string }): Promise<{ status?: { succeeded?: number; failed?: number; conditions?: Array<{ type?: string; status?: string; reason?: string }> } }>;
      deleteNamespacedJob(input: { name: string; namespace: string; propagationPolicy: 'Foreground'; gracePeriodSeconds: number }): Promise<unknown>;
    },
    private readonly coreApi: {
      createNamespacedSecret(input: { namespace: string; body: Record<string, any> }): Promise<unknown>;
      deleteNamespacedSecret(input: { name: string; namespace: string }): Promise<unknown>;
    },
    private readonly namespace: string,
    private readonly pollIntervalMs = 2_000,
    private readonly jobTimeoutMs = 10 * 60_000,
  ) {
    if (!/^[a-z0-9](?:[-a-z0-9]*[a-z0-9])?$/.test(namespace)) throw new Error('Kubernetes migration job namespace is invalid');
  }

  async runTargetMigrations(targetImage: string, databaseUrl: string): Promise<void> {
    if (!trustedControlApiImage.test(targetImage)) throw new Error('Kubernetes migration image must be a trusted immutable control-api digest');
    const deployment = await this.appsApi.readNamespacedDeployment({ name: 'control-api', namespace: this.namespace });
    const sourceSpec = deployment.spec?.template?.spec;
    const sourceContainer = sourceSpec?.containers?.find((container) => container.name === 'control-api');
    if (!sourceSpec || !sourceContainer) throw new Error('Current control-api Deployment template is unavailable for migration testing');
    await this.runJob({
      image: targetImage,
      command: ['node_modules/.bin/prisma', 'migrate', 'deploy', '--schema', 'prisma/schema.prisma'],
      databaseUrl,
      purpose: 'target-migrations',
      sourceSpec,
      sourceContainer,
    });
  }

  async checkPreviousVersionCompatibility(databaseUrl: string): Promise<void> {
    const deployment = await this.appsApi.readNamespacedDeployment({ name: 'control-api', namespace: this.namespace });
    const template = deployment.spec?.template;
    const sourceSpec = template?.spec;
    const sourceContainer = sourceSpec?.containers?.find((container) => container.name === 'control-api');
    const previousImage = sourceContainer?.image;
    if (!sourceSpec || !sourceContainer || typeof previousImage !== 'string' || !previousImage)
      throw new Error('Current control-api Deployment template is unavailable for compatibility testing');
    await this.runJob({
      image: previousImage,
      command: ['node', '-e', compatibilityProbeScript],
      databaseUrl,
      purpose: 'previous-compatibility',
      sourceSpec,
      sourceContainer,
    });
  }

  private async runJob({
    image,
    command,
    databaseUrl,
    purpose,
    sourceSpec,
    sourceContainer,
  }: {
    image: string;
    command: string[];
    databaseUrl: string;
    purpose: 'target-migrations' | 'previous-compatibility';
    sourceSpec?: NonNullable<DeploymentPodTemplate['spec']>;
    sourceContainer?: Record<string, any>;
  }): Promise<void> {
    if (!databaseUrl.trim() || databaseUrl.length > 4096) throw new Error('Temporary PostgreSQL connection is invalid');
    const suffix = randomUUID().replaceAll('-', '').slice(0, 20);
    const secretName = `kubenova-preflight-${suffix}`;
    const jobName = `kubenova-preflight-${purpose}-${suffix}`;
    let operationError: unknown;
    try {
      await this.coreApi.createNamespacedSecret({
        namespace: this.namespace,
        body: {
          apiVersion: 'v1',
          kind: 'Secret',
          metadata: { name: secretName, labels: { 'app.kubernetes.io/managed-by': 'kubenova-update-controller', 'kubenova.io/preflight': purpose } },
          type: 'Opaque',
          stringData: { DATABASE_URL: databaseUrl },
        },
      });
      const base = sourceContainer ? structuredClone(sourceContainer) : { name: 'migration-test', workingDir: '/app', env: [] };
      base.name = 'migration-test';
      base.image = image;
      base.command = command;
      delete base.args;
      base.env = Array.isArray(base.env) ? base.env.filter((entry: Record<string, unknown>) => entry.name !== 'DATABASE_URL') : [];
      base.env.push({
        name: 'DATABASE_URL',
        valueFrom: { secretKeyRef: { name: secretName, key: 'DATABASE_URL' } },
      });
      base.resources = base.resources ?? { requests: { cpu: '50m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } };
      delete base.livenessProbe;
      delete base.readinessProbe;
      delete base.startupProbe;
      delete base.lifecycle;
      base.securityContext = { ...base.securityContext, allowPrivilegeEscalation: false, readOnlyRootFilesystem: false, capabilities: { drop: ['ALL'] } };

      const { serviceAccountName: _serviceAccountName, automountServiceAccountToken: _automount, ...inheritedSpec } = sourceSpec ?? {};
      const job = {
        apiVersion: 'batch/v1',
        kind: 'Job',
        metadata: { name: jobName, labels: { 'app.kubernetes.io/managed-by': 'kubenova-update-controller', 'kubenova.io/preflight': purpose } },
        spec: {
          backoffLimit: 0,
          activeDeadlineSeconds: Math.ceil(this.jobTimeoutMs / 1000),
          template: {
            metadata: { labels: { 'kubenova.io/preflight-job': suffix } },
            spec: {
              ...inheritedSpec,
              serviceAccountName: undefined,
              automountServiceAccountToken: false,
              restartPolicy: 'Never',
              containers: [base],
            },
          },
        },
      };
      await this.batchApi.createNamespacedJob({ namespace: this.namespace, body: job });
      await this.waitForJob(jobName);
    } catch (error) {
      operationError = error;
      throw error;
    } finally {
      const cleanupErrors: unknown[] = [];
      try {
        await this.batchApi.deleteNamespacedJob({ name: jobName, namespace: this.namespace, propagationPolicy: 'Foreground', gracePeriodSeconds: 0 });
      } catch (error) { if (!isNotFound(error)) cleanupErrors.push(error); }
      try { await this.waitForJobDeletion(jobName); }
      catch (error) { cleanupErrors.push(error); }
      try { await this.coreApi.deleteNamespacedSecret({ name: secretName, namespace: this.namespace }); }
      catch (error) { if (!isNotFound(error)) cleanupErrors.push(error); }
      if (cleanupErrors.length) {
        const detail = cleanupErrors.map((error) => error instanceof Error ? error.message : 'unknown cleanup error').join('; ');
        throw new Error(`Kubernetes migration test resource cleanup failed; preflight blocked (${detail})`, { cause: operationError });
      }
    }
  }

  private async waitForJob(name: string): Promise<void> {
    const deadline = Date.now() + this.jobTimeoutMs;
    while (Date.now() < deadline) {
      const job = await this.batchApi.readNamespacedJob({ name, namespace: this.namespace });
      if ((job.status?.succeeded ?? 0) > 0) return;
      if ((job.status?.failed ?? 0) > 0 || job.status?.conditions?.some((condition) => condition.type === 'Failed' && condition.status === 'True'))
        throw new Error(`Kubernetes migration test Job ${name} failed`);
      await new Promise((resolve) => setTimeout(resolve, this.pollIntervalMs));
    }
    throw new Error(`Kubernetes migration test Job ${name} timed out`);
  }

  private async waitForJobDeletion(name: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      try { await this.batchApi.readNamespacedJob({ name, namespace: this.namespace }); }
      catch (error) { if (isNotFound(error)) return; throw error; }
      await new Promise((resolve) => setTimeout(resolve, Math.min(this.pollIntervalMs, 1000)));
    }
    throw new Error(`Kubernetes migration test Job ${name} deletion timed out`);
  }
}

export async function createInClusterKubernetesMigrationJobAdapter(): Promise<KubernetesMigrationJobAdapter> {
  const namespace = process.env.POD_NAMESPACE?.trim();
  if (!namespace) throw new Error('Kubernetes pod namespace is not available');
  const k8s = await import('@kubernetes/client-node');
  const config = new k8s.KubeConfig();
  config.loadFromCluster();
  const apps = config.makeApiClient(k8s.AppsV1Api as never) as unknown as ConstructorParameters<typeof KubernetesMigrationJobAdapter>[0];
  const batch = config.makeApiClient(k8s.BatchV1Api as never) as unknown as ConstructorParameters<typeof KubernetesMigrationJobAdapter>[1];
  const core = config.makeApiClient(k8s.CoreV1Api as never) as unknown as ConstructorParameters<typeof KubernetesMigrationJobAdapter>[2];
  return new KubernetesMigrationJobAdapter(apps, batch, core, namespace);
}

function isNotFound(error: unknown): boolean {
  const value = error as ApiError;
  return value.statusCode === 404 || value.response?.statusCode === 404 || value.response?.body?.code === 404;
}

const compatibilityProbeScript = `
const { spawn } = require('node:child_process');
const child = spawn(process.execPath, ['dist/src/main.js'], { stdio: 'ignore' });
let exited = null;
child.once('exit', (code, signal) => { exited = { code, signal }; });
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
try {
  const deadline = Date.now() + 90000;
  let ready = false;
  while (Date.now() < deadline) {
    if (exited) throw new Error('previous control-api exited before readiness');
    try { const response = await fetch('http://127.0.0.1:4000/api/health/ready'); if (response.ok) { ready = true; break; } } catch {}
    await delay(1000);
  }
  if (!ready) throw new Error('previous control-api did not become ready on the migrated database');
} finally {
  child.kill('SIGTERM');
  await Promise.race([new Promise(resolve => child.once('exit', resolve)), delay(10000)]);
  if (child.exitCode === null) child.kill('SIGKILL');
}
`;
