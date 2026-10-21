import {
  applyKubernetesImageUpdate,
  isGitOpsManagedDeployment,
  KubernetesUpdateAdapter,
  type KubernetesDeploymentLike,
} from './kubernetes-update.adapter';

const digest = (value: string) => `ghcr.io/feize666/kubenova-${value}@sha256:${({ 'control-api': 'a', 'runtime-gateway': 'b', frontend: 'c' })[value as 'control-api' | 'runtime-gateway' | 'frontend'].repeat(64)}`;
function deployment(name: string, image: string, labels: Record<string, string> = {}): KubernetesDeploymentLike {
  return {
    metadata: { name, generation: 3, resourceVersion: '3', labels, managedFields: [{ manager: 'kubectl-client-side-apply' }] },
    spec: { replicas: 1, template: { spec: { containers: [{ name, image }] } } },
    status: { observedGeneration: 3, replicas: 1, updatedReplicas: 1, availableReplicas: 1 },
  };
}

describe('Kubernetes update adapter', () => {
  it('recognizes common GitOps ownership and blocks direct mutation', async () => {
    const managed = deployment('control-api', digest('control-api'), { 'argocd.argoproj.io/instance': 'platform' });
    expect(isGitOpsManagedDeployment(managed)).toBe(true);
    const patch = jest.fn();
    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => name === 'control-api' ? managed : deployment(name, digest(name)),
      patchImage: patch,
      waitForReady: async () => undefined,
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
    })).rejects.toThrow(/GitOps/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('blocks Helm-owned Deployments identified by release metadata or field manager', async () => {
    const helmOwned = deployment('control-api', digest('control-api'));
    helmOwned.metadata!.annotations = { 'meta.helm.sh/release-name': 'kubenova' };
    expect(isGitOpsManagedDeployment(helmOwned)).toBe(true);

    const helmManaged = deployment('control-api', digest('control-api'));
    helmManaged.metadata!.managedFields = [{ manager: 'helm' }];
    expect(isGitOpsManagedDeployment(helmManaged)).toBe(true);

    const patch = jest.fn();
    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => name === 'control-api' ? helmOwned : deployment(name, digest(name)),
      patchImage: patch,
      waitForReady: async () => undefined,
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
    })).rejects.toThrow(/GitOps-managed/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('rejects incomplete, mutable, or unhealthy deployment inputs before changing any image', async () => {
    const patch = jest.fn();
    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => deployment(name, digest(name)),
      patchImage: patch,
      waitForReady: async () => undefined,
      targetImages: { controlApi: digest('control-api'), runtimeGateway: 'ghcr.io/feize666/kubenova-runtime-gateway:latest', frontend: digest('frontend') },
    })).rejects.toThrow(/immutable/);
    expect(patch).not.toHaveBeenCalled();

    const unhealthy = deployment('runtime-gateway', digest('runtime-gateway'));
    unhealthy.status!.availableReplicas = 0;
    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => name === 'runtime-gateway' ? unhealthy : deployment(name, digest(name)),
      patchImage: patch,
      waitForReady: async () => undefined,
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
    })).rejects.toThrow(/ready/);
    expect(patch).not.toHaveBeenCalled();
  });

  it('rolls out control-api, runtime-gateway, then frontend and patches only the named image', async () => {
    const calls: string[] = [];
    const result = await applyKubernetesImageUpdate({
      readDeployment: async (name) => deployment(name, `old-${name}`),
      patchImage: async (name, container, image) => { calls.push(`patch:${name}:${container}:${image}`); },
      waitForReady: async (name) => { calls.push(`ready:${name}`); },
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
    });
    expect(calls.map((call) => call.split(':')[1])).toEqual([
      'control-api', 'control-api', 'runtime-gateway', 'runtime-gateway', 'frontend', 'frontend',
    ]);
    expect(result.previousImages).toEqual({ controlApi: 'old-control-api', runtimeGateway: 'old-runtime-gateway', frontend: 'old-frontend' });
  });

  it('restores already changed deployments in reverse order when a rollout fails', async () => {
    const calls: string[] = [];
    const progress: string[] = [];
    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => deployment(name, `old-${name}`),
      patchImage: async (name, _container, image) => { calls.push(`${name}:${image}`); },
      waitForReady: async (name, target) => { if (name === 'runtime-gateway' && target.startsWith('ghcr.io/')) throw new Error('rollout timeout'); },
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
      onProgress: async (phase, percent) => { progress.push(`${phase}:${percent}`); },
    })).rejects.toThrow(/restored previous images/);
    expect(calls).toEqual([
      `control-api:${digest('control-api')}`,
      `runtime-gateway:${digest('runtime-gateway')}`,
      'runtime-gateway:old-runtime-gateway',
      'control-api:old-control-api',
    ]);
    expect(progress).toContain('updating:75');
  });

  it('restores an image when the API applies a patch but the client loses its response', async () => {
    const images = new Map([
      ['control-api', 'old-control-api'],
      ['runtime-gateway', 'old-runtime-gateway'],
      ['frontend', 'old-frontend'],
    ]);
    const calls: string[] = [];
    let loseFirstResponse = true;

    await expect(applyKubernetesImageUpdate({
      readDeployment: async (name) => deployment(name, images.get(name)!),
      patchImage: async (name, _container, image) => {
        calls.push(`${name}:${image}`);
        images.set(name, image);
        if (name === 'control-api' && image === digest('control-api') && loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('connection lost after patch');
        }
      },
      waitForReady: async () => undefined,
      targetImages: { controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') },
    })).rejects.toThrow(/restored previous images/);

    expect(images.get('control-api')).toBe('old-control-api');
    expect(calls).toEqual([`control-api:${digest('control-api')}`, 'control-api:old-control-api']);
  });

  it('uses namespaced JSON patches and waits for updated replicas before continuing', async () => {
    const rows = new Map([
      ['control-api', deployment('control-api', 'old-control-api')],
      ['runtime-gateway', deployment('runtime-gateway', 'old-runtime-gateway')],
      ['frontend', deployment('frontend', 'old-frontend')],
    ]);
    const patches: Array<{ name: string; namespace: string; body: Array<Record<string, unknown>> }> = [];
    const appsApi = {
      readNamespacedDeployment: async ({ name }: { name: string }) => structuredClone(rows.get(name)!),
      patchNamespacedDeployment: async ({ name, namespace, body }: { name: string; namespace: string; body: Array<Record<string, unknown>> }) => {
        patches.push({ name, namespace, body });
        const row = rows.get(name)!;
        row.spec!.template!.spec!.containers![0].image = String(body.find((operation) => operation.op === 'replace')!.value);
        row.metadata!.generation = (row.metadata!.generation ?? 0) + 1;
        row.metadata!.resourceVersion = String(Number(row.metadata!.resourceVersion) + 1);
        row.status!.observedGeneration = row.metadata!.generation;
      },
    };
    const adapter = new KubernetesUpdateAdapter(appsApi, 'kubenova', 0, 50);
    await adapter.apply({ controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') });
    expect(patches.map(({ name, namespace }) => [name, namespace])).toEqual([
      ['control-api', 'kubenova'], ['runtime-gateway', 'kubenova'], ['frontend', 'kubenova'],
    ]);
    expect(patches[0].body).toEqual([
      { op: 'test', path: '/metadata/resourceVersion', value: '3' },
      { op: 'test', path: '/spec/template/spec/containers/0/name', value: 'control-api' },
      { op: 'replace', path: '/spec/template/spec/containers/0/image', value: digest('control-api') },
    ]);
  });

  it('reconciles an applied Kubernetes patch whose API response was lost', async () => {
    const rows = new Map([
      ['control-api', deployment('control-api', 'old-control-api')],
      ['runtime-gateway', deployment('runtime-gateway', 'old-runtime-gateway')],
      ['frontend', deployment('frontend', 'old-frontend')],
    ]);
    let loseFirstResponse = true;
    const appsApi = {
      readNamespacedDeployment: async ({ name }: { name: string }) => structuredClone(rows.get(name)!),
      patchNamespacedDeployment: async ({ name, body }: { name: string; body: Array<Record<string, unknown>> }) => {
        const row = rows.get(name)!;
        row.spec!.template!.spec!.containers![0].image = String(body.find((operation) => operation.op === 'replace')!.value);
        row.metadata!.generation = (row.metadata!.generation ?? 0) + 1;
        row.metadata!.resourceVersion = String(Number(row.metadata!.resourceVersion) + 1);
        row.status!.observedGeneration = row.metadata!.generation;
        if (name === 'control-api' && loseFirstResponse) {
          loseFirstResponse = false;
          throw new Error('connection lost after Kubernetes applied the patch');
        }
      },
    };
    const adapter = new KubernetesUpdateAdapter(appsApi, 'kubenova', 0, 50);

    await expect(adapter.apply({ controlApi: digest('control-api'), runtimeGateway: digest('runtime-gateway'), frontend: digest('frontend') }))
      .rejects.toThrow(/restored previous images/);

    expect(rows.get('control-api')?.spec?.template?.spec?.containers?.[0].image).toBe('old-control-api');
  });
});
