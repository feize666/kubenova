export type KubernetesComponent = 'controlApi' | 'runtimeGateway' | 'frontend';

export interface KubernetesDeploymentLike {
  metadata?: {
    name?: string;
    generation?: number;
    resourceVersion?: string;
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    managedFields?: Array<{ manager?: string }>;
  };
  spec?: {
    replicas?: number;
    template?: { spec?: { containers?: Array<{ name?: string; image?: string }> } };
  };
  status?: {
    observedGeneration?: number;
    replicas?: number;
    updatedReplicas?: number;
    availableReplicas?: number;
  };
}

const components: Array<{ key: KubernetesComponent; deployment: string; container: string; image: RegExp }> = [
  { key: 'controlApi', deployment: 'control-api', container: 'control-api', image: /^ghcr\.io\/feize666\/kubenova-control-api@sha256:[a-f0-9]{64}$/ },
  { key: 'runtimeGateway', deployment: 'runtime-gateway', container: 'runtime-gateway', image: /^ghcr\.io\/feize666\/kubenova-runtime-gateway@sha256:[a-f0-9]{64}$/ },
  { key: 'frontend', deployment: 'frontend', container: 'frontend', image: /^ghcr\.io\/feize666\/kubenova-frontend@sha256:[a-f0-9]{64}$/ },
];

const gitOpsMarkers = [
  /^argocd\./i,
  /^meta\.helm\.sh\//i,
  /^kustomize\.toolkit\.fluxcd\.io\//i,
  /^helm\.toolkit\.fluxcd\.io\//i,
  /^source\.toolkit\.fluxcd\.io\//i,
];
const gitOpsManagers = /(argocd|flux|kustomize-controller|helm-controller|^helm$)/i;

export function isGitOpsManagedDeployment(deployment: KubernetesDeploymentLike): boolean {
  const metadata = deployment.metadata ?? {};
  const marker = Object.keys({ ...metadata.labels, ...metadata.annotations }).some((key) => gitOpsMarkers.some((pattern) => pattern.test(key)))
    || Object.entries({ ...metadata.labels, ...metadata.annotations }).some(([key, value]) =>
      key === 'app.kubernetes.io/managed-by' && /^(argocd|flux|helm)$/i.test(value),
    );
  return marker || (metadata.managedFields ?? []).some((entry) => gitOpsManagers.test(entry.manager ?? ''));
}

function deploymentImage(deployment: KubernetesDeploymentLike, component: typeof components[number]): string {
  const image = deployment.spec?.template?.spec?.containers?.find((container) => container.name === component.container)?.image;
  if (!image) throw new Error(`Kubernetes deployment ${component.deployment} is missing container ${component.container}`);
  return image;
}

function assertDeploymentReady(deployment: KubernetesDeploymentLike, component: typeof components[number]): void {
  if (isGitOpsManagedDeployment(deployment)) throw new Error(`Kubernetes deployment ${component.deployment} is GitOps-managed; direct updates are blocked`);
  const desired = deployment.spec?.replicas ?? 1;
  const status = deployment.status;
  if (desired < 1 || !status || (deployment.metadata?.generation ?? 0) > (status.observedGeneration ?? 0)
    || (status.updatedReplicas ?? 0) < desired || (status.availableReplicas ?? 0) < desired) {
    throw new Error(`Kubernetes deployment ${component.deployment} is not ready`);
  }
  deploymentImage(deployment, component);
}

export async function applyKubernetesImageUpdate({
  readDeployment,
  patchImage,
  waitForReady,
  targetImages,
  onProgress,
}: {
  readDeployment: (name: string) => Promise<KubernetesDeploymentLike>;
  patchImage: (deployment: string, container: string, image: string, expectedCurrentImage: string) => Promise<void>;
  waitForReady: (deployment: string, targetImage: string, onWaiting?: () => Promise<void>) => Promise<void>;
  targetImages: Record<KubernetesComponent, string>;
  onProgress?: (phase: 'updating' | 'health-check', percent: number, message: string) => Promise<void>;
}): Promise<{ previousImages: Record<KubernetesComponent, string> }> {
  const previousImages = {} as Record<KubernetesComponent, string>;

  for (const component of components) {
    const image = targetImages[component.key];
    if (!component.image.test(image)) throw new Error(`target ${component.key} image must use a trusted immutable digest`);
    const deployment = await readDeployment(component.deployment);
    assertDeploymentReady(deployment, component);
    previousImages[component.key] = deploymentImage(deployment, component);
  }

  const changed: Array<{ component: typeof components[number]; previous: string; target: string }> = [];
  try {
    for (const [index, component] of components.entries()) {
      const targetImage = targetImages[component.key];
      const previous = previousImages[component.key];
      if (targetImage === previous) continue;
      changed.push({ component, previous, target: targetImage });
      await onProgress?.('updating', 10 + index * 25, `正在更新 ${component.deployment}`);
      await patchImage(component.deployment, component.container, targetImage, previous);
      await onProgress?.('health-check', 15 + index * 25, `正在等待 ${component.deployment} 就绪`);
      let lastHeartbeat = Date.now();
      await waitForReady(component.deployment, targetImage, async () => {
        if (Date.now() - lastHeartbeat >= 10_000) {
          lastHeartbeat = Date.now();
          await onProgress?.('health-check', 20 + index * 25, `正在等待 ${component.deployment} 滚动完成`);
        }
      });
    }
  } catch (error) {
    let rollbackFailed = false;
    for (const entry of changed.reverse()) {
      try {
        await onProgress?.('updating', 75, `正在恢复 ${entry.component.deployment}`);
        await patchImage(entry.component.deployment, entry.component.container, entry.previous, entry.target);
        let lastHeartbeat = Date.now();
        await waitForReady(entry.component.deployment, entry.previous, async () => {
          if (Date.now() - lastHeartbeat >= 10_000) {
            lastHeartbeat = Date.now();
            await onProgress?.('health-check', 80, `正在等待 ${entry.component.deployment} 回到原版本`);
          }
        });
      } catch { rollbackFailed = true; }
    }
    if (rollbackFailed) throw new Error('Kubernetes update failed and automatic rollback was incomplete; inspect all three Deployments immediately');
    throw new Error(`Kubernetes update failed; restored previous images: ${error instanceof Error ? error.message : 'rollout failed'}`);
  }

  return { previousImages };
}

export class KubernetesUpdateAdapter {
  constructor(
    private readonly appsApi: {
      readNamespacedDeployment(input: { name: string; namespace: string }): Promise<KubernetesDeploymentLike>;
      patchNamespacedDeployment(input: { name: string; namespace: string; body: Array<Record<string, unknown>> }): Promise<unknown>;
    },
    private readonly namespace: string,
    private readonly waitIntervalMs = 2_000,
    private readonly rolloutTimeoutMs = 10 * 60_000,
  ) {
    if (!namespace) throw new Error('Kubernetes update namespace is not configured');
  }

  async apply(
    targetImages: Record<KubernetesComponent, string>,
    onProgress?: (phase: 'updating' | 'health-check', percent: number, message: string) => Promise<void>,
  ): Promise<{ previousImages: Record<KubernetesComponent, string> }> {
    return applyKubernetesImageUpdate({
      readDeployment: async (name) => this.appsApi.readNamespacedDeployment({ name, namespace: this.namespace }),
      patchImage: async (name, container, image, expectedCurrentImage) => {
        const deployment = await this.appsApi.readNamespacedDeployment({ name, namespace: this.namespace });
        if (isGitOpsManagedDeployment(deployment)) throw new Error(`Kubernetes deployment ${name} became GitOps-managed during update`);
        const containers = deployment.spec?.template?.spec?.containers ?? [];
        const index = containers.findIndex((item) => item.name === container);
        if (index < 0) throw new Error(`Kubernetes deployment ${name} is missing container ${container}`);
        const currentImage = containers[index].image;
        if (currentImage === image) return;
        if (!deployment.metadata?.resourceVersion || currentImage !== expectedCurrentImage)
          throw new Error(`Kubernetes deployment ${name} changed outside this update; refusing to overwrite it`);
        await this.appsApi.patchNamespacedDeployment({
          name,
          namespace: this.namespace,
          body: [
            { op: 'test', path: '/metadata/resourceVersion', value: deployment.metadata.resourceVersion },
            { op: 'test', path: `/spec/template/spec/containers/${index}/name`, value: container },
            { op: 'replace', path: `/spec/template/spec/containers/${index}/image`, value: image },
          ],
        });
      },
      waitForReady: async (name, image, onWaiting) => this.waitForDeployment(name, image, onWaiting),
      targetImages,
      onProgress,
    });
  }

  private async waitForDeployment(name: string, image: string, onWaiting?: () => Promise<void>): Promise<void> {
    const deadline = Date.now() + this.rolloutTimeoutMs;
    while (Date.now() < deadline) {
      const deployment = await this.appsApi.readNamespacedDeployment({ name, namespace: this.namespace });
      const component = components.find((item) => item.deployment === name);
      if (!component) throw new Error(`Unexpected Kubernetes deployment ${name}`);
      const current = deploymentImage(deployment, component);
      if (current !== image) throw new Error(`Kubernetes deployment ${name} was changed by another controller during rollout`);
      const desired = deployment.spec?.replicas ?? 1;
      const status = deployment.status;
      if ((status?.observedGeneration ?? 0) >= (deployment.metadata?.generation ?? 0)
        && (status?.updatedReplicas ?? 0) >= desired && (status?.availableReplicas ?? 0) >= desired) return;
      if (deployment.status && (deployment.status as Record<string, unknown>).conditions instanceof Array
        && ((deployment.status as Record<string, any>).conditions as Array<Record<string, unknown>>).some((condition) => condition.reason === 'ProgressDeadlineExceeded'))
        throw new Error(`Kubernetes deployment ${name} exceeded its rollout deadline`);
      await onWaiting?.();
      await new Promise((resolve) => setTimeout(resolve, this.waitIntervalMs));
    }
    throw new Error(`Kubernetes deployment ${name} rollout timed out`);
  }
}

export async function createInClusterKubernetesUpdateAdapter(): Promise<KubernetesUpdateAdapter> {
  const namespace = process.env.POD_NAMESPACE?.trim();
  if (!namespace) throw new Error('Kubernetes pod namespace is not available');
  const k8s = await import('@kubernetes/client-node');
  const config = new k8s.KubeConfig();
  config.loadFromCluster();
  const appsApi = config.makeApiClient(k8s.AppsV1Api as never) as unknown as ConstructorParameters<typeof KubernetesUpdateAdapter>[0];
  return new KubernetesUpdateAdapter(appsApi, namespace);
}
