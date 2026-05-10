import { Injectable, Logger } from '@nestjs/common';
import * as k8s from '@kubernetes/client-node';
import {
  appendAudit,
  assertWritePermission,
  type AuditAction,
  type PlatformRole,
} from '../common/governance';
import { ApiError } from '../common/errors/api-error';
import { ErrorCode } from '../common/errors/error-codes';
import { HelmService } from '../helm/helm.service';
import { PrismaService } from '../platform/database/prisma.service';
import { UnconfiguredVmActionProvider } from './vm-unconfigured.provider';
import type { VmPowerOperation } from './vm-provider';

export type AiActionCanonicalOperation =
  | 'enable'
  | 'disable'
  | 'batch-enable'
  | 'batch-disable'
  | 'query-pods-overview'
  | 'query-deployments-overview'
  | 'query-nodes-overview'
  | 'query-pv-pvc-bindings'
  | 'query-pvcs'
  | 'query-storageclasses'
  | 'query-configmaps'
  | 'query-helm-releases'
  | 'query-helm-repositories'
  | 'import-helm-repository-presets'
  | 'restart-workload'
  | 'vm-power-on'
  | 'vm-power-off'
  | 'vm-restart';

export type AiActionOperationAlias =
  | 'query-configmaps-overview'
  | 'query-pvc-overview'
  | 'query-storageclass-overview'
  | 'vm-power-restart';

export type AiActionOperation =
  | AiActionCanonicalOperation
  | AiActionOperationAlias;
type AiActionNormalizedOperation = AiActionCanonicalOperation;

export interface AiActionTarget {
  clusterId?: string;
  namespace?: string;
  kind?: string;
  name?: string;
  resourceType?: string;
  resourceId?: string;
  provider?: string;
  vmId?: string;
  reason?: string;
}

export interface AiActionQueryOptions {
  namespace?: string;
  limit?: number;
  includeDeleted?: boolean;
  keyword?: string;
  presetNames?: string[];
  sync?: boolean;
}

export interface AiActionExecuteInput {
  operation: AiActionOperation;
  target?: AiActionTarget;
  targets?: AiActionTarget[];
  reason?: string;
  options?: AiActionQueryOptions;
  sessionId?: string;
}

export interface AiActionActor {
  userId?: string;
  username?: string;
  role?: PlatformRole;
}

export interface AiActionExecutionResultItem {
  resourceType: string;
  resourceId: string;
  action: string;
  status: 'success' | 'rejected';
  details?: Record<string, unknown>;
}

export interface AiActionExecutionError {
  code: ErrorCode;
  message: string;
}

export interface AiActionExecutionResult {
  status: 'success' | 'failure';
  requestId: string;
  operation: AiActionNormalizedOperation;
  result?: AiActionExecutionResultItem[];
  rollbackSuggestion?: string;
  error?: AiActionExecutionError;
  writeback?: {
    persisted: boolean;
    sessionId?: string;
    messageId?: string;
    error?: string;
  };
}

interface ClusterContext {
  id: string;
  kubeconfig: string;
}

interface HelmReleaseRecord {
  name: string;
  namespace: string;
  status: string;
  revision: number;
  source: 'secret' | 'configmap';
  updatedAt?: string;
}

const K8S_NAME_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/;

@Injectable()
export class AiActionExecutorService {
  private readonly logger = new Logger(AiActionExecutorService.name);
  private readonly vmProvider = new UnconfiguredVmActionProvider();

  constructor(
    private readonly prisma: PrismaService,
    private readonly helmService: HelmService,
  ) {}

  async execute(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
  ): Promise<AiActionExecutionResult> {
    const requestId = this.createRequestId();
    let normalizedAction:
      | (AiActionExecuteInput & { operation: AiActionNormalizedOperation })
      | undefined;

    try {
      this.validateAction(action);
      normalizedAction = this.normalizeExecuteInput(action);
      let response: AiActionExecutionResult;

      switch (normalizedAction.operation) {
        case 'query-pods-overview':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryPodsOverview(actor, normalizedAction, requestId),
            ],
          };
          break;
        case 'query-deployments-overview':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryDeploymentsOverview(
                actor,
                normalizedAction,
                requestId,
              ),
            ],
          };
          break;
        case 'query-nodes-overview':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryNodesOverview(actor, normalizedAction, requestId),
            ],
          };
          break;
        case 'query-pv-pvc-bindings':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryPvPvcBindings(actor, normalizedAction, requestId),
            ],
          };
          break;
        case 'query-pvcs':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [await this.queryPvcs(actor, normalizedAction, requestId)],
          };
          break;
        case 'query-storageclasses':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryStorageClasses(
                actor,
                normalizedAction,
                requestId,
              ),
            ],
          };
          break;
        case 'query-configmaps':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryConfigMaps(actor, normalizedAction, requestId),
            ],
          };
          break;
        case 'query-helm-releases':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryHelmReleases(actor, normalizedAction, requestId),
            ],
          };
          break;
        case 'query-helm-repositories':
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.queryHelmRepositories(
                actor,
                normalizedAction,
                requestId,
              ),
            ],
          };
          break;
        case 'import-helm-repository-presets':
          assertWritePermission(actor);
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.importHelmRepositoryPresets(
                actor,
                normalizedAction,
                requestId,
              ),
            ],
            rollbackSuggestion: '建议回滚操作: 删除新导入的模板仓库记录。',
          };
          break;
        case 'restart-workload':
          assertWritePermission(actor);
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.restartWorkload(actor, normalizedAction, requestId),
            ],
            rollbackSuggestion:
              '建议回滚操作: 重新发布上一版本镜像或回滚 Deployment/StatefulSet revision。',
          };
          break;
        case 'vm-power-on':
        case 'vm-power-off':
        case 'vm-restart':
          assertWritePermission(actor);
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: [
              await this.executeVmPowerAction(
                actor,
                normalizedAction,
                requestId,
              ),
            ],
            rollbackSuggestion: '建议回滚操作: 反向执行 VM 电源动作。',
          };
          break;
        case 'enable':
        case 'disable':
        case 'batch-enable':
        case 'batch-disable':
          assertWritePermission(actor);
          response = {
            status: 'success',
            requestId,
            operation: normalizedAction.operation,
            result: this.executeLegacyGovernanceAction(
              actor,
              normalizedAction,
              requestId,
            ),
            rollbackSuggestion: this.buildRollbackSuggestion(normalizedAction),
          };
          break;
        default:
          throw new ApiError({
            code: ErrorCode.VALIDATION_ERROR,
            message: 'operation is invalid',
          });
      }

      const writeback = await this.persistExecutionWriteback(
        actor,
        normalizedAction,
        response,
      );
      return writeback ? { ...response, writeback } : response;
    } catch (error) {
      const executionError = this.toExecutionError(error);
      const operation =
        normalizedAction?.operation ??
        this.normalizeActionOperationAlias(action?.operation) ??
        'query-pods-overview';
      const fallbackAction = normalizedAction
        ? normalizedAction
        : action
          ? { ...action, operation }
          : undefined;
      if (fallbackAction) {
        this.auditFailure(actor, fallbackAction, requestId, executionError);
      }
      const failedResponse: AiActionExecutionResult = {
        status: 'failure',
        requestId,
        operation,
        rollbackSuggestion: fallbackAction
          ? this.buildRollbackSuggestion(fallbackAction)
          : undefined,
        error: executionError,
      };
      const writeback = fallbackAction
        ? await this.persistExecutionWriteback(
            actor,
            fallbackAction,
            failedResponse,
          )
        : undefined;
      return writeback ? { ...failedResponse, writeback } : failedResponse;
    }
  }

  preview(action: AiActionExecuteInput): {
    status: 'ok' | 'invalid';
    operation?: AiActionNormalizedOperation;
    targets?: AiActionTarget[];
    rollbackSuggestion?: string;
    error?: AiActionExecutionError;
  } {
    try {
      this.validateAction(action);
      const normalizedAction = this.normalizeExecuteInput(action);
      const targets = this.normalizeTargets(normalizedAction);
      return {
        status: 'ok',
        operation: normalizedAction.operation,
        targets,
        rollbackSuggestion: this.buildRollbackSuggestion(normalizedAction),
      };
    } catch (error) {
      return {
        status: 'invalid',
        error: this.toExecutionError(error),
      };
    }
  }

  private executeLegacyGovernanceAction(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): AiActionExecutionResultItem[] {
    const normalizedOperation =
      this.normalizeActionOperationAlias(action.operation) ?? 'disable';
    const normalizedAction = this.toGovernanceAction(normalizedOperation);
    const targets = this.normalizeTargets(action);

    return targets.map((target) => {
      const resourceType = target.resourceType ?? 'unknown';
      const resourceId = target.resourceId ?? 'unknown';

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: normalizedAction,
        resourceType,
        resourceId,
        result: 'success',
        requestId,
        reason: target.reason ?? action.reason,
      });

      return {
        resourceType,
        resourceId,
        action: this.toItemAction(normalizedOperation),
        status: 'success',
      };
    });
  }

  private async queryPodsOverview(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);

    const baseWhere = {
      clusterId,
      kind: 'Pod',
      ...(namespace ? { namespace } : {}),
      ...(action.options?.includeDeleted ? {} : { state: { not: 'deleted' } }),
    };

    const [total, active, disabled, deleted, items] = await Promise.all([
      this.prisma.workloadRecord.count({ where: baseWhere }),
      this.prisma.workloadRecord.count({
        where: { ...baseWhere, state: 'active' },
      }),
      this.prisma.workloadRecord.count({
        where: { ...baseWhere, state: 'disabled' },
      }),
      this.prisma.workloadRecord.count({
        where: { ...baseWhere, state: 'deleted' },
      }),
      this.prisma.workloadRecord.findMany({
        where: baseWhere,
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
        select: {
          namespace: true,
          name: true,
          state: true,
          statusJson: true,
          updatedAt: true,
        },
      }),
    ]);

    const sample = items.map((item) => ({
      namespace: item.namespace,
      name: item.name,
      state: item.state,
      phase: this.readJsonString(item.statusJson, ['phase']),
      updatedAt: item.updatedAt.toISOString(),
    }));

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `pods-overview:${clusterId}${namespace ? `:${namespace}` : ''}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-pods-overview',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace: namespace ?? 'all',
        total,
        active,
        disabled,
        deleted,
        sample,
      },
    };
  }

  private async queryDeploymentsOverview(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);

    const baseWhere = {
      clusterId,
      kind: 'Deployment',
      ...(namespace ? { namespace } : {}),
      ...(action.options?.includeDeleted ? {} : { state: { not: 'deleted' } }),
    };

    const [total, items] = await Promise.all([
      this.prisma.workloadRecord.count({ where: baseWhere }),
      this.prisma.workloadRecord.findMany({
        where: baseWhere,
        orderBy: [{ updatedAt: 'desc' }],
        take: limit,
        select: {
          namespace: true,
          name: true,
          state: true,
          replicas: true,
          readyReplicas: true,
          updatedAt: true,
        },
      }),
    ]);

    const healthy = items.filter((item) => {
      const replicas = Math.max(item.replicas ?? 0, 0);
      const readyReplicas = Math.max(item.readyReplicas ?? 0, 0);
      return replicas > 0 && readyReplicas >= replicas;
    }).length;

    const degraded = items.length - healthy;

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `deployments-overview:${clusterId}${namespace ? `:${namespace}` : ''}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-deployments-overview',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace: namespace ?? 'all',
        total,
        healthy,
        degraded,
        sample: items.map((item) => ({
          namespace: item.namespace,
          name: item.name,
          state: item.state,
          replicas: item.replicas ?? 0,
          readyReplicas: item.readyReplicas ?? 0,
          updatedAt: item.updatedAt.toISOString(),
        })),
      },
    };
  }

  private async queryNodesOverview(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const cluster = await this.requireClusterContext(clusterId);

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const resp = await coreApi.listNode();

    const nodes = resp.items.map((node) => {
      const name = node.metadata?.name ?? 'unknown';
      const conditions = node.status?.conditions ?? [];
      const ready = conditions.find((item) => item.type === 'Ready')?.status;
      return {
        name,
        ready: ready === 'True',
        kubeletVersion: node.status?.nodeInfo?.kubeletVersion ?? 'unknown',
      };
    });

    const readyCount = nodes.filter((item) => item.ready).length;

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `nodes-overview:${clusterId}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-nodes-overview',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        total: nodes.length,
        ready: readyCount,
        notReady: Math.max(nodes.length - readyCount, 0),
        sample: nodes,
      },
    };
  }

  private async queryPvcs(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);
    const cluster = await this.requireClusterContext(clusterId);

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const resp = namespace
      ? await coreApi.listNamespacedPersistentVolumeClaim({ namespace })
      : await coreApi.listPersistentVolumeClaimForAllNamespaces();

    const sample = resp.items.slice(0, limit).map((pvc) => ({
      namespace: pvc.metadata?.namespace ?? 'unknown',
      name: pvc.metadata?.name ?? 'unknown',
      phase: pvc.status?.phase ?? 'unknown',
      volumeName: pvc.spec?.volumeName ?? '',
      storageClassName: pvc.spec?.storageClassName ?? '',
      accessModes: pvc.spec?.accessModes ?? [],
      capacity: pvc.status?.capacity?.storage ?? '',
      requested: pvc.spec?.resources?.requests?.storage ?? '',
    }));

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `pvcs:${clusterId}${namespace ? `:${namespace}` : ''}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-pvcs',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace: namespace ?? 'all',
        total: resp.items.length,
        sample,
      },
    };
  }

  private async queryStorageClasses(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const limit = this.resolveLimit(action.options?.limit);
    const cluster = await this.requireClusterContext(clusterId);

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const storageApi = kc.makeApiClient(k8s.StorageV1Api);
    const resp = await storageApi.listStorageClass();

    const sample = resp.items.slice(0, limit).map((sc) => {
      const annotations = sc.metadata?.annotations ?? {};
      const isDefault =
        annotations['storageclass.kubernetes.io/is-default-class'] === 'true' ||
        annotations['storageclass.beta.kubernetes.io/is-default-class'] ===
          'true';
      return {
        name: sc.metadata?.name ?? 'unknown',
        provisioner: sc.provisioner ?? 'unknown',
        volumeBindingMode: sc.volumeBindingMode ?? '',
        allowVolumeExpansion: sc.allowVolumeExpansion ?? false,
        reclaimPolicy: sc.reclaimPolicy ?? '',
        isDefault,
      };
    });

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `storageclasses:${clusterId}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-storageclasses',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        total: resp.items.length,
        sample,
      },
    };
  }

  private async queryConfigMaps(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);
    const cluster = await this.requireClusterContext(clusterId);

    if (!namespace) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'namespace is required for query-configmaps',
      });
    }

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);
    const resp = await coreApi.listNamespacedConfigMap({ namespace });

    const sample = resp.items.slice(0, limit).map((cm) => ({
      namespace: cm.metadata?.namespace ?? 'unknown',
      name: cm.metadata?.name ?? 'unknown',
      dataKeys: Object.keys(cm.data ?? {}).length,
    }));

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `configmaps:${clusterId}:${namespace}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-configmaps',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace,
        total: resp.items.length,
        sample,
      },
    };
  }

  private async queryPvPvcBindings(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);
    const cluster = await this.requireClusterContext(clusterId);

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const coreApi = kc.makeApiClient(k8s.CoreV1Api);

    const [pvResp, pvcResp] = await Promise.all([
      coreApi.listPersistentVolume(),
      namespace
        ? coreApi.listNamespacedPersistentVolumeClaim({ namespace })
        : coreApi.listPersistentVolumeClaimForAllNamespaces(),
    ]);

    const pvByClaim = new Map<string, k8s.V1PersistentVolume>();
    for (const pv of pvResp.items) {
      const claimNs = pv.spec?.claimRef?.namespace;
      const claimName = pv.spec?.claimRef?.name;
      if (claimNs && claimName) {
        pvByClaim.set(`${claimNs}/${claimName}`, pv);
      }
    }

    const pvByName = new Map<string, k8s.V1PersistentVolume>();
    for (const pv of pvResp.items) {
      const name = pv.metadata?.name;
      if (name) {
        pvByName.set(name, pv);
      }
    }

    const sample = pvcResp.items.slice(0, limit).map((pvc) => {
      const ns = pvc.metadata?.namespace ?? 'unknown';
      const name = pvc.metadata?.name ?? 'unknown';
      const pv =
        (pvc.spec?.volumeName
          ? pvByName.get(pvc.spec.volumeName)
          : undefined) ?? pvByClaim.get(`${ns}/${name}`);
      return {
        pvcNamespace: ns,
        pvcName: name,
        pvcPhase: pvc.status?.phase ?? 'unknown',
        pvName: pv?.metadata?.name ?? pvc.spec?.volumeName ?? '',
        pvPhase: pv?.status?.phase ?? '',
        storageClassName:
          pvc.spec?.storageClassName ?? pv?.spec?.storageClassName ?? '',
        capacity:
          pv?.spec?.capacity?.storage ?? pvc.status?.capacity?.storage ?? '',
        accessModes:
          pvc.spec?.accessModes ?? pv?.spec?.accessModes ?? ([] as string[]),
      };
    });

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'ai-action',
      resourceId: `pv-pvc-bindings:${clusterId}${namespace ? `:${namespace}` : ''}`,
      result: 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'k8s-pv-pvc-bindings',
      resourceId: clusterId,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace: namespace ?? 'all',
        pvTotal: pvResp.items.length,
        pvcTotal: pvcResp.items.length,
        sample,
      },
    };
  }

  private async queryHelmReleases(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.optionalNamespace(action.options, target);
    const limit = this.resolveLimit(action.options?.limit);
    const keyword = this.optionalKeyword(action.options?.keyword);

    try {
      let releases: Array<{
        name: string;
        namespace: string;
        status: string;
        revision: number;
        source: 'helm-cli' | 'secret' | 'configmap';
        updatedAt?: string;
        chart?: string;
      }> = [];
      let cliQueryError: string | undefined;

      try {
        const cliPayload = (await this.helmService.listReleases({
          clusterId,
          ...(namespace ? { namespace } : {}),
          ...(keyword ? { keyword } : {}),
          page: '1',
          pageSize: String(limit),
        })) as unknown;
        const cliItems = Array.isArray(this.toObject(cliPayload).items)
          ? (this.toObject(cliPayload).items as unknown[])
          : [];
        releases = cliItems
          .map((item) => this.toObject(item))
          .map((item) => ({
            name: String(item.name ?? ''),
            namespace: String(item.namespace ?? ''),
            status: String(item.status ?? ''),
            revision: this.parsePositiveInt(String(item.revision ?? '')) ?? 0,
            source: 'helm-cli' as const,
            updatedAt: String(item.updated ?? ''),
            chart: String(item.chart ?? ''),
          }))
          .filter((item) => Boolean(item.name && item.namespace));
      } catch (error) {
        cliQueryError = this.toExecutionError(error).message;
      }

      if (releases.length === 0) {
        const cluster = await this.requireClusterContext(clusterId);
        const kc = new k8s.KubeConfig();
        kc.loadFromString(cluster.kubeconfig);
        const coreApi = kc.makeApiClient(k8s.CoreV1Api);

        const labelSelector = 'owner=helm';
        const [secretResp, configMapResp] = await Promise.all([
          namespace
            ? coreApi.listNamespacedSecret({ namespace, labelSelector })
            : coreApi.listSecretForAllNamespaces({ labelSelector }),
          namespace
            ? coreApi.listNamespacedConfigMap({ namespace, labelSelector })
            : coreApi.listConfigMapForAllNamespaces({ labelSelector }),
        ]);

        releases = this.mergeHelmReleaseRecords([
          ...this.extractHelmReleasesFromSecrets(secretResp.items),
          ...this.extractHelmReleasesFromConfigMaps(configMapResp.items),
        ])
          .map((item) => ({
            name: item.name,
            namespace: item.namespace,
            status: item.status,
            revision: item.revision,
            source: item.source,
            updatedAt: item.updatedAt,
            chart: '',
          }))
          .filter((item) => {
            if (!keyword) {
              return true;
            }
            return (
              item.name.toLowerCase().includes(keyword) ||
              item.namespace.toLowerCase().includes(keyword)
            );
          });
      }

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: 'query',
        resourceType: 'ai-action',
        resourceId: `helm-releases:${clusterId}${namespace ? `:${namespace}` : ''}`,
        result: 'success',
        requestId,
        reason: action.reason,
      });

      return {
        resourceType: 'helm-releases',
        resourceId: clusterId,
        action: action.operation,
        status: 'success',
        details: {
          clusterId,
          namespace: namespace ?? 'all',
          total: releases.length,
          sample: releases.slice(0, limit).map((release) => ({
            name: release.name,
            namespace: release.namespace,
            status: release.status,
            revision: release.revision,
            source: release.source,
            updatedAt: release.updatedAt,
            chart: release.chart ?? '',
          })),
          ...(cliQueryError ? { cliQueryError } : {}),
        },
      };
    } catch (error) {
      const executionError = this.toExecutionError(error);
      this.logger.warn(
        `query-helm-releases failed for cluster=${clusterId}: ${executionError.message}`,
      );

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: 'query',
        resourceType: 'ai-action',
        resourceId: `helm-releases:${clusterId}${namespace ? `:${namespace}` : ''}`,
        result: 'failure',
        requestId,
        reason: `${action.reason ?? ''}${action.reason ? ' | ' : ''}${executionError.message}`,
      });

      return {
        resourceType: 'helm-releases',
        resourceId: clusterId,
        action: action.operation,
        status: 'rejected',
        details: {
          requestId,
          clusterId,
          namespace: namespace ?? 'all',
          code: executionError.code,
          message: executionError.message,
        },
      };
    }
  }

  private async queryHelmRepositories(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const limit = this.resolveLimit(action.options?.limit);
    const keyword = this.optionalKeyword(action.options?.keyword);

    try {
      const repositoryPayload = (await this.helmService.listRepositories({
        clusterId,
      })) as unknown;
      const repositoryRows = Array.isArray(
        this.toObject(repositoryPayload).items,
      )
        ? (this.toObject(repositoryPayload).items as unknown[])
        : [];

      const repositories = repositoryRows
        .map((row) => this.toObject(row))
        .filter((row) => {
          if (!keyword) {
            return true;
          }
          const name = String(row.name ?? '').toLowerCase();
          const url = String(row.url ?? '').toLowerCase();
          const message = String(row.message ?? '').toLowerCase();
          return (
            name.includes(keyword) ||
            url.includes(keyword) ||
            message.includes(keyword)
          );
        });

      let chartsTotal = 0;
      let chartQueryError: string | undefined;
      let charts: Array<Record<string, unknown>> = [];
      if (repositoryRows.length > 0) {
        try {
          const chartsPayload = (await this.helmService.listCharts({
            clusterId,
            keyword,
          })) as unknown;
          const chartRows = Array.isArray(this.toObject(chartsPayload).items)
            ? (this.toObject(chartsPayload).items as unknown[])
            : [];
          chartsTotal = chartRows.length;
          charts = chartRows
            .slice(0, limit)
            .map((row) => this.toObject(row))
            .map((row) => {
              const versions = Array.isArray(row.versions)
                ? (row.versions as unknown[])
                    .map((item) => this.toObject(item))
                    .filter((item) =>
                      Boolean(String(item.version ?? '').trim()),
                    )
                : [];
              return {
                repository: String(row.repository ?? ''),
                name: String(row.name ?? ''),
                fullName: String(row.fullName ?? ''),
                versions: versions.slice(0, 5).map((item) => ({
                  version: String(item.version ?? ''),
                  appVersion: String(item.appVersion ?? ''),
                })),
              };
            });
        } catch (error) {
          chartQueryError = this.toExecutionError(error).message;
        }
      }

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: 'query',
        resourceType: 'ai-action',
        resourceId: `helm-repositories:${clusterId}`,
        result: 'success',
        requestId,
        reason: action.reason,
      });

      return {
        resourceType: 'helm-repositories',
        resourceId: clusterId,
        action: action.operation,
        status: 'success',
        details: {
          clusterId,
          keyword: keyword ?? '',
          repositoriesTotal: repositories.length,
          repositories: repositories.slice(0, limit).map((row) => ({
            name: String(row.name ?? ''),
            url: String(row.url ?? ''),
            authType: String(row.authType ?? 'none'),
            syncStatus: String(row.syncStatus ?? 'unknown'),
            message: String(row.message ?? ''),
            lastSyncAt: String(row.lastSyncAt ?? ''),
          })),
          chartsTotal,
          charts,
          ...(chartQueryError ? { chartQueryError } : {}),
        },
      };
    } catch (error) {
      const executionError = this.toExecutionError(error);
      this.logger.warn(
        `query-helm-repositories failed for cluster=${clusterId}: ${executionError.message}`,
      );

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: 'query',
        resourceType: 'ai-action',
        resourceId: `helm-repositories:${clusterId}`,
        result: 'failure',
        requestId,
        reason: `${action.reason ?? ''}${action.reason ? ' | ' : ''}${executionError.message}`,
      });

      return {
        resourceType: 'helm-repositories',
        resourceId: clusterId,
        action: action.operation,
        status: 'rejected',
        details: {
          requestId,
          clusterId,
          code: executionError.code,
          message: executionError.message,
        },
      };
    }
  }

  private async importHelmRepositoryPresets(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const presetNames = this.optionalPresetNames(action.options?.presetNames);
    const sync = action.options?.sync !== false;

    const payload = await this.helmService.importRepositoryPresets({
      clusterId,
      ...(presetNames.length > 0 ? { names: presetNames } : {}),
      sync,
    });
    const body = this.toObject(payload);
    const imported = Array.isArray(body.imported)
      ? (body.imported as unknown[]).map((item) => this.toObject(item))
      : [];
    const created = imported.filter((item) => item.action === 'created').length;
    const existing = imported.filter(
      (item) => item.action === 'existing',
    ).length;
    const failed = imported.filter(
      (item) => item.syncStatus === 'failed',
    ).length;

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'update',
      resourceType: 'helm-repository',
      resourceId: `presets:${clusterId}`,
      result: failed > 0 ? 'failure' : 'success',
      requestId,
      reason: action.reason,
    });

    return {
      resourceType: 'helm-repository-presets',
      resourceId: clusterId,
      action: action.operation,
      status: failed > 0 ? 'rejected' : 'success',
      details: {
        clusterId,
        sync,
        requestedPresetNames: presetNames,
        created,
        existing,
        failed,
        imported: imported.map((item) => ({
          name: String(item.name ?? ''),
          url: String(item.url ?? ''),
          action: String(item.action ?? ''),
          syncStatus: String(item.syncStatus ?? ''),
          message: String(item.message ?? ''),
        })),
      },
    };
  }

  private extractHelmReleasesFromSecrets(
    items: k8s.V1Secret[],
  ): HelmReleaseRecord[] {
    return items
      .map((item) => this.toHelmReleaseRecord(item, 'secret'))
      .filter((item): item is HelmReleaseRecord => Boolean(item));
  }

  private extractHelmReleasesFromConfigMaps(
    items: k8s.V1ConfigMap[],
  ): HelmReleaseRecord[] {
    return items
      .map((item) => this.toHelmReleaseRecord(item, 'configmap'))
      .filter((item): item is HelmReleaseRecord => Boolean(item));
  }

  private toHelmReleaseRecord(
    resource: { metadata?: k8s.V1ObjectMeta },
    source: 'secret' | 'configmap',
  ): HelmReleaseRecord | undefined {
    const metadata = resource.metadata;
    const labels = metadata?.labels ?? {};
    const releaseLabel = labels.name?.trim();
    const parsedFromResourceName = this.parseHelmStorageResourceName(
      metadata?.name,
    );
    const releaseName = releaseLabel || parsedFromResourceName?.name;
    const namespace = metadata?.namespace?.trim();
    const status = labels.status?.trim() || 'unknown';
    const revisionLabel = this.parsePositiveInt(labels.version);
    const revision = revisionLabel ?? parsedFromResourceName?.revision;

    if (!releaseName || !namespace || revision === undefined) {
      return undefined;
    }

    return {
      name: releaseName,
      namespace,
      status,
      revision,
      source,
      updatedAt: this.toIsoDate(metadata?.creationTimestamp),
    };
  }

  private parseHelmStorageResourceName(
    name: string | undefined,
  ): { name: string; revision: number } | undefined {
    const normalized = name?.trim();
    if (!normalized) {
      return undefined;
    }
    const match = normalized.match(/^sh\.helm\.release\.v1\.(.+)\.v(\d+)$/);
    if (!match) {
      return undefined;
    }
    const releaseName = match[1]?.trim();
    const revision = Number.parseInt(match[2] ?? '', 10);
    if (!releaseName || !Number.isInteger(revision) || revision < 1) {
      return undefined;
    }
    return {
      name: releaseName,
      revision,
    };
  }

  private parsePositiveInt(value: string | undefined): number | undefined {
    const normalized = value?.trim();
    if (!normalized) {
      return undefined;
    }
    const parsed = Number.parseInt(normalized, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      return undefined;
    }
    return parsed;
  }

  private toIsoDate(value: string | Date | undefined): string | undefined {
    if (!value) {
      return undefined;
    }
    if (value instanceof Date) {
      return value.toISOString();
    }
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      return undefined;
    }
    return parsed.toISOString();
  }

  private mergeHelmReleaseRecords(
    records: HelmReleaseRecord[],
  ): HelmReleaseRecord[] {
    const merged = new Map<string, HelmReleaseRecord>();

    for (const record of records) {
      const key = `${record.namespace}/${record.name}`;
      const current = merged.get(key);
      if (!current) {
        merged.set(key, record);
        continue;
      }

      if (record.revision > current.revision) {
        merged.set(key, record);
        continue;
      }

      if (
        record.revision === current.revision &&
        record.source === 'secret' &&
        current.source === 'configmap'
      ) {
        merged.set(key, record);
      }
    }

    return Array.from(merged.values()).sort((a, b) => {
      const ns = a.namespace.localeCompare(b.namespace);
      if (ns !== 0) {
        return ns;
      }
      return a.name.localeCompare(b.name);
    });
  }

  private async restartWorkload(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const clusterId = this.requireClusterId(target, 'target.clusterId');
    const namespace = this.requireNamespace(
      target.namespace,
      'target.namespace',
    );
    const kind = this.requireRestartKind(target.kind, 'target.kind');
    const name = this.requireResourceName(target.name, 'target.name');
    const cluster = await this.requireClusterContext(clusterId);

    const restartedAt = new Date().toISOString();

    const kc = new k8s.KubeConfig();
    kc.loadFromString(cluster.kubeconfig);
    const objectApi = k8s.KubernetesObjectApi.makeApiClient(kc);

    await objectApi.patch(
      {
        apiVersion: 'apps/v1',
        kind,
        metadata: {
          namespace,
          name,
        },
        spec: {
          template: {
            metadata: {
              annotations: {
                'kubectl.kubernetes.io/restartedAt': restartedAt,
                'aiops.heihuzi.ai/restartRequestId': requestId,
              },
            },
          },
        },
      },
      undefined,
      undefined,
      undefined,
      undefined,
      k8s.PatchStrategy.MergePatch,
    );

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'restart',
      resourceType: kind,
      resourceId: `${clusterId}/${namespace}/${name}`,
      result: 'success',
      requestId,
      reason: action.reason ?? target.reason,
    });

    return {
      resourceType: kind,
      resourceId: `${clusterId}/${namespace}/${name}`,
      action: action.operation,
      status: 'success',
      details: {
        clusterId,
        namespace,
        kind,
        name,
        restartedAt,
      },
    };
  }

  private async executeVmPowerAction(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
  ): Promise<AiActionExecutionResultItem> {
    const target = this.requireTarget(action);
    const provider = this.requireSimpleField(
      target.provider,
      'target.provider',
      1,
      64,
    );
    const vmId = this.requireSimpleField(target.vmId, 'target.vmId', 1, 128);

    const normalizedOperation =
      this.normalizeActionOperationAlias(action.operation) ?? 'vm-restart';
    const operation = this.toVmOperation(normalizedOperation);
    const vmResult = await this.vmProvider.executePowerAction({
      provider,
      vmId,
      operation,
      requestId,
      actor: actor?.username ?? 'unknown',
      reason: action.reason ?? target.reason,
    });

    const mappedAction = this.toVmAuditAction(operation);
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: mappedAction,
      resourceType: 'vm',
      resourceId: `${provider}/${vmId}`,
      result: vmResult.accepted ? 'success' : 'failure',
      requestId,
      reason: action.reason ?? target.reason,
    });

    return {
      resourceType: 'vm',
      resourceId: `${provider}/${vmId}`,
      action: action.operation,
      status: vmResult.accepted ? 'success' : 'rejected',
      details: {
        provider,
        vmId,
        accepted: vmResult.accepted,
        message: vmResult.message,
      },
    };
  }

  private createRequestId(): string {
    return `ai_exec_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  }

  private normalizeActionOperationAlias(
    operation: AiActionOperation | undefined,
  ): AiActionNormalizedOperation | undefined {
    if (!operation) {
      return undefined;
    }
    if (operation === 'query-configmaps-overview') {
      return 'query-configmaps';
    }
    if (operation === 'query-pvc-overview') {
      return 'query-pvcs';
    }
    if (operation === 'query-storageclass-overview') {
      return 'query-storageclasses';
    }
    if (operation === 'vm-power-restart') {
      return 'vm-restart';
    }
    return operation as AiActionNormalizedOperation;
  }

  private normalizeExecuteInput(
    action: AiActionExecuteInput,
  ): AiActionExecuteInput & { operation: AiActionNormalizedOperation } {
    const operation = this.normalizeActionOperationAlias(action.operation);
    if (!operation) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'operation is invalid',
      });
    }
    return operation === action.operation
      ? (action as AiActionExecuteInput & {
          operation: AiActionNormalizedOperation;
        })
      : {
          ...action,
          operation,
        };
  }

  private validateAction(
    action: AiActionExecuteInput | undefined,
  ): asserts action is AiActionExecuteInput {
    if (!action) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'action is required',
      });
    }

    const operation = this.normalizeActionOperationAlias(action.operation);
    const supported: AiActionNormalizedOperation[] = [
      'enable',
      'disable',
      'batch-enable',
      'batch-disable',
      'query-pods-overview',
      'query-deployments-overview',
      'query-nodes-overview',
      'query-pv-pvc-bindings',
      'query-pvcs',
      'query-storageclasses',
      'query-configmaps',
      'query-helm-releases',
      'query-helm-repositories',
      'import-helm-repository-presets',
      'restart-workload',
      'vm-power-on',
      'vm-power-off',
      'vm-restart',
    ];

    if (!operation || !supported.includes(operation)) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'operation is invalid',
      });
    }

    if (operation === 'enable' || operation === 'disable') {
      if (!action.target) {
        throw new ApiError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'target is required',
        });
      }
      this.validateTarget(action.target, 'target', true);
      return;
    }

    if (operation === 'batch-enable' || operation === 'batch-disable') {
      if (!Array.isArray(action.targets) || action.targets.length === 0) {
        throw new ApiError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'targets is required for batch operation',
        });
      }
      action.targets.forEach((target, index) =>
        this.validateTarget(target, `targets[${index}]`, true),
      );
      return;
    }

    if (!action.target) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'target is required',
      });
    }

    this.validateTarget(action.target, 'target', false);
  }

  private validateTarget(
    target: AiActionTarget,
    path: string,
    requireResourceIdentity: boolean,
  ): void {
    if (!target || typeof target !== 'object') {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} is required`,
      });
    }

    if (requireResourceIdentity) {
      if (!target.resourceType?.trim()) {
        throw new ApiError({
          code: ErrorCode.VALIDATION_ERROR,
          message: `${path}.resourceType is required`,
        });
      }
      if (!target.resourceId?.trim()) {
        throw new ApiError({
          code: ErrorCode.VALIDATION_ERROR,
          message: `${path}.resourceId is required`,
        });
      }
    }
  }

  private normalizeTargets(action: AiActionExecuteInput): AiActionTarget[] {
    if (action.operation === 'enable' || action.operation === 'disable') {
      return [action.target as AiActionTarget];
    }
    if (
      action.operation === 'batch-enable' ||
      action.operation === 'batch-disable'
    ) {
      return action.targets as AiActionTarget[];
    }
    return [action.target as AiActionTarget];
  }

  private toGovernanceAction(
    operation: AiActionNormalizedOperation,
  ): AuditAction {
    return operation === 'enable' || operation === 'batch-enable'
      ? 'enable'
      : 'disable';
  }

  private toItemAction(
    operation: AiActionNormalizedOperation,
  ): 'enable' | 'disable' {
    return operation === 'enable' || operation === 'batch-enable'
      ? 'enable'
      : 'disable';
  }

  private toVmOperation(
    operation: AiActionNormalizedOperation,
  ): VmPowerOperation {
    if (operation === 'vm-power-on') {
      return 'power-on';
    }
    if (operation === 'vm-power-off') {
      return 'power-off';
    }
    return 'restart';
  }

  private toVmAuditAction(operation: VmPowerOperation): AuditAction {
    if (operation === 'power-on') {
      return 'enable';
    }
    if (operation === 'power-off') {
      return 'disable';
    }
    return 'restart';
  }

  private buildRollbackSuggestion(action: AiActionExecuteInput): string {
    const operation =
      this.normalizeActionOperationAlias(action.operation) ?? action.operation;
    switch (operation) {
      case 'enable':
        return '建议回滚操作: disable 同一资源。';
      case 'disable':
        return '建议回滚操作: enable 同一资源。';
      case 'batch-enable':
        return '建议回滚操作: 对同一批资源执行 batch-disable。';
      case 'batch-disable':
        return '建议回滚操作: 对同一批资源执行 batch-enable。';
      case 'restart-workload':
        return '建议回滚操作: 回滚到前一版本 revision。';
      case 'vm-power-on':
        return '建议回滚操作: 执行 vm-power-off。';
      case 'vm-power-off':
        return '建议回滚操作: 执行 vm-power-on。';
      case 'vm-restart':
        return '建议回滚操作: 依据运行状态执行 vm-power-on/vm-power-off。';
      case 'import-helm-repository-presets':
        return '建议回滚操作: 删除新导入的模板仓库记录。';
      default:
        return '建议回滚操作: 根据审计记录执行反向动作。';
    }
  }

  private toExecutionError(error: unknown): AiActionExecutionError {
    if (error instanceof ApiError) {
      return { code: error.code, message: error.message };
    }

    if (typeof error === 'object' && error !== null && 'message' in error) {
      const rawMessage = (error as { message?: unknown }).message;
      const message =
        typeof rawMessage === 'string' ? rawMessage : 'action execution failed';
      if (message.includes('无写权限')) {
        return { code: ErrorCode.FORBIDDEN, message };
      }
      if (message.includes('不存在')) {
        return { code: ErrorCode.NOT_FOUND, message };
      }
      return { code: ErrorCode.INTERNAL_ERROR, message };
    }

    return {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'action execution failed',
    };
  }

  private requireTarget(action: AiActionExecuteInput): AiActionTarget {
    if (!action.target) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'target is required',
      });
    }
    return action.target;
  }

  private requireClusterId(target: AiActionTarget, path: string): string {
    return this.requireSimpleField(target.clusterId, path, 1, 64);
  }

  private requireNamespace(value: string | undefined, path: string): string {
    const namespace = this.requireSimpleField(value, path, 1, 63);
    if (!K8S_NAME_RE.test(namespace)) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} is invalid`,
      });
    }
    return namespace;
  }

  private requireResourceName(value: string | undefined, path: string): string {
    const name = this.requireSimpleField(value, path, 1, 253);
    if (!K8S_NAME_RE.test(name)) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} is invalid`,
      });
    }
    return name;
  }

  private requireRestartKind(
    value: string | undefined,
    path: string,
  ): 'Deployment' | 'StatefulSet' {
    const kind = this.requireSimpleField(value, path, 1, 32);
    if (kind !== 'Deployment' && kind !== 'StatefulSet') {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} must be Deployment or StatefulSet`,
      });
    }
    return kind;
  }

  private requireSimpleField(
    value: string | undefined,
    path: string,
    min: number,
    max: number,
  ): string {
    const normalized = value?.trim();
    if (!normalized) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} is required`,
      });
    }
    if (normalized.length < min || normalized.length > max) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: `${path} length must be ${min}-${max}`,
      });
    }
    return normalized;
  }

  private optionalNamespace(
    options: AiActionQueryOptions | undefined,
    target: AiActionTarget,
  ): string | undefined {
    const raw = options?.namespace?.trim() || target.namespace?.trim();
    if (!raw) {
      return undefined;
    }
    if (!K8S_NAME_RE.test(raw)) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'namespace is invalid',
      });
    }
    return raw;
  }

  private optionalKeyword(value: string | undefined): string | undefined {
    const normalized = value?.trim().toLowerCase();
    if (!normalized) {
      return undefined;
    }
    if (normalized.length > 80) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'options.keyword length must be <= 80',
      });
    }
    return normalized;
  }

  private optionalPresetNames(value: string[] | undefined): string[] {
    if (!value) {
      return [];
    }
    if (!Array.isArray(value)) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'options.presetNames must be an array of strings',
      });
    }
    const normalized = value
      .map((item) => item?.trim())
      .filter((item): item is string => Boolean(item));
    if (normalized.length > 20) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'options.presetNames length must be <= 20',
      });
    }
    for (const name of normalized) {
      if (name.length > 64) {
        throw new ApiError({
          code: ErrorCode.VALIDATION_ERROR,
          message: 'options.presetNames item length must be <= 64',
        });
      }
    }
    return normalized;
  }

  private resolveLimit(limit: number | undefined): number {
    if (limit === undefined) {
      return 20;
    }
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
      throw new ApiError({
        code: ErrorCode.VALIDATION_ERROR,
        message: 'options.limit must be an integer between 1 and 200',
      });
    }
    return limit;
  }

  private async requireClusterContext(
    clusterId: string,
  ): Promise<ClusterContext> {
    const cluster = await this.prisma.clusterRegistry.findUnique({
      where: { id: clusterId },
      select: {
        id: true,
        status: true,
        deletedAt: true,
        metadata: true,
      },
    });

    if (!cluster || cluster.deletedAt || cluster.status === 'deleted') {
      throw new ApiError({
        code: ErrorCode.NOT_FOUND,
        message: `cluster not found: ${clusterId}`,
      });
    }

    const metadata = this.toObject(cluster.metadata);
    const kubeconfig = metadata.kubeconfig;
    if (typeof kubeconfig !== 'string' || !kubeconfig.trim()) {
      throw new ApiError({
        code: ErrorCode.PRECONDITION_FAILED,
        message: `cluster kubeconfig is not configured: ${clusterId}`,
      });
    }

    return {
      id: cluster.id,
      kubeconfig,
    };
  }

  private toObject(value: unknown): Record<string, unknown> {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return {};
    }
    return value as Record<string, unknown>;
  }

  private readJsonString(
    value: unknown,
    path: readonly string[],
  ): string | undefined {
    let current: unknown = value;
    for (const segment of path) {
      if (!current || typeof current !== 'object' || Array.isArray(current)) {
        return undefined;
      }
      current = (current as Record<string, unknown>)[segment];
    }
    if (typeof current !== 'string') {
      return undefined;
    }
    const normalized = current.trim();
    return normalized || undefined;
  }

  private async persistExecutionWriteback(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    result: AiActionExecutionResult,
  ): Promise<
    | {
        persisted: boolean;
        sessionId?: string;
        messageId?: string;
        error?: string;
      }
    | undefined
  > {
    const sessionId = action.sessionId?.trim();
    if (!sessionId) {
      return undefined;
    }

    try {
      const session = await this.prisma.aiConversationSession.findUnique({
        where: { id: sessionId },
        select: { id: true, ownerUserId: true, deletedAt: true },
      });
      if (!session || session.deletedAt) {
        return { persisted: false, sessionId, error: 'session not found' };
      }

      const actorUserId =
        actor?.userId ?? (await this.resolveActorUserId(actor?.username));
      if (actorUserId && actorUserId !== session.ownerUserId) {
        return {
          persisted: false,
          sessionId,
          error: 'session ownership mismatch',
        };
      }

      const createdAt = new Date();
      const created = await this.prisma.aiConversationMessage.create({
        data: {
          sessionId: session.id,
          role: 'assistant',
          content: this.formatExecutionWritebackMessage(action, result),
          structuredJson: {
            summary:
              result.status === 'success'
                ? `动作执行成功：${result.operation}`
                : `动作执行失败：${result.operation}`,
            severity: result.status === 'success' ? 'info' : 'high',
            impactedResources: (result.result ?? []).map(
              (item) => `${item.resourceType}/${item.resourceId}`,
            ),
            recommendations:
              result.status === 'success'
                ? ['可继续在当前会话发起下一步运维动作。']
                : ['请检查目标参数并根据回滚建议评估后重试。'],
            actions: [result.operation],
          },
          createdAt,
        },
        select: { id: true },
      });

      await this.prisma.aiConversationSession.update({
        where: { id: session.id },
        data: { updatedAt: createdAt },
      });

      return { persisted: true, sessionId: session.id, messageId: created.id };
    } catch (error) {
      return {
        persisted: false,
        sessionId,
        error: error instanceof Error ? error.message : 'writeback failed',
      };
    }
  }

  private async resolveActorUserId(
    username: string | undefined,
  ): Promise<string | undefined> {
    const normalized = username?.trim();
    if (!normalized) {
      return undefined;
    }

    const user = await this.prisma.user.findFirst({
      where: {
        OR: [{ email: normalized }, { name: normalized }],
      },
      select: { id: true },
    });
    return user?.id;
  }

  private formatExecutionWritebackMessage(
    action: AiActionExecuteInput,
    result: AiActionExecutionResult,
  ): string {
    const lines: string[] = [];
    lines.push(
      result.status === 'success' ? '✅ 动作执行完成' : '❌ 动作执行失败',
    );
    lines.push(`操作: ${result.operation}`);
    lines.push(`请求ID: ${result.requestId}`);

    const target = action.target;
    if (target?.clusterId) {
      lines.push(`集群: ${target.clusterId}`);
    }
    if (target?.namespace) {
      lines.push(`名称空间: ${target.namespace}`);
    }
    if (target?.kind && target?.name) {
      lines.push(`目标资源: ${target.kind}/${target.name}`);
    }
    if (target?.provider) {
      lines.push(`VM Provider: ${target.provider}`);
    }
    if (target?.vmId) {
      lines.push(`VM ID: ${target.vmId}`);
    }

    if (result.error?.message) {
      lines.push(`错误: ${result.error.message}`);
    }

    if (result.result && result.result.length > 0) {
      lines.push('');
      lines.push('```json');
      lines.push(JSON.stringify(result.result, null, 2));
      lines.push('```');
    }

    if (result.rollbackSuggestion) {
      lines.push(`回滚建议: ${result.rollbackSuggestion}`);
    }

    return lines.join('\n');
  }

  private auditFailure(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    requestId: string,
    error: AiActionExecutionError,
  ): void {
    try {
      const target = action.target;
      const resourceType =
        target?.kind ||
        target?.resourceType ||
        this.deriveResourceType(action.operation);
      const resourceId =
        target?.resourceId ||
        target?.name ||
        target?.clusterId ||
        target?.vmId ||
        'unknown';

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: this.deriveAuditAction(action.operation),
        resourceType,
        resourceId,
        result: 'failure',
        requestId,
        reason: `${action.reason ?? ''}${action.reason ? ' | ' : ''}${error.message}`,
      });
    } catch (auditError) {
      this.logger.warn(
        `auditFailure failed: ${
          auditError instanceof Error ? auditError.message : String(auditError)
        }`,
      );
    }
  }

  private deriveAuditAction(operation: AiActionOperation): AuditAction {
    const normalized = this.normalizeActionOperationAlias(operation);
    if (!normalized) {
      return 'query';
    }
    if (normalized.startsWith('query-')) {
      return 'query';
    }
    if (normalized === 'restart-workload' || normalized === 'vm-restart') {
      return 'restart';
    }
    if (normalized === 'vm-power-on') {
      return 'enable';
    }
    if (normalized === 'vm-power-off') {
      return 'disable';
    }
    if (
      normalized === 'enable' ||
      normalized === 'disable' ||
      normalized === 'batch-enable' ||
      normalized === 'batch-disable'
    ) {
      return this.toGovernanceAction(normalized);
    }
    if (normalized === 'import-helm-repository-presets') {
      return 'update';
    }
    return 'query';
  }

  private deriveResourceType(operation: AiActionOperation): string {
    const normalized = this.normalizeActionOperationAlias(operation);
    if (!normalized) {
      return 'unknown';
    }
    if (normalized.startsWith('query-')) {
      return 'ai-query';
    }
    if (normalized.startsWith('vm-')) {
      return 'vm';
    }
    return 'unknown';
  }
}
