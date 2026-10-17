import type { AiActionCanonicalOperation } from './ai-action-executor.service';

export type AiActionScope = 'platform' | 'cluster' | 'namespace' | 'resource';
export type AiActionRisk = 'read' | 'low' | 'medium' | 'high' | 'critical';

export interface AiActionDefinition {
  scope: AiActionScope;
  risk: AiActionRisk;
  requiresApproval: boolean;
}

/**
 * The single allowlist shared by validation and approval routing. Adding a
 * mutating operation without explicitly declaring its approval requirement is
 * intentionally a type error, so the model can never gain an unreviewed write
 * path by accident.
 */
export const AI_ACTION_REGISTRY = {
  enable: { scope: 'resource', risk: 'medium', requiresApproval: true },
  disable: { scope: 'resource', risk: 'high', requiresApproval: true },
  'batch-enable': { scope: 'resource', risk: 'high', requiresApproval: true },
  'batch-disable': { scope: 'resource', risk: 'high', requiresApproval: true },
  'query-pods-overview': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-deployments-overview': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-nodes-overview': { scope: 'cluster', risk: 'read', requiresApproval: false },
  'query-pv-pvc-bindings': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-pvcs': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-storageclasses': { scope: 'cluster', risk: 'read', requiresApproval: false },
  'query-configmaps': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-helm-releases': { scope: 'namespace', risk: 'read', requiresApproval: false },
  'query-helm-repositories': { scope: 'cluster', risk: 'read', requiresApproval: false },
  'import-helm-repository-presets': { scope: 'cluster', risk: 'high', requiresApproval: true },
  'restart-workload': { scope: 'resource', risk: 'high', requiresApproval: true },
  'vm-power-on': { scope: 'resource', risk: 'high', requiresApproval: true },
  'vm-power-off': { scope: 'resource', risk: 'critical', requiresApproval: true },
  'vm-restart': { scope: 'resource', risk: 'high', requiresApproval: true },
  'apply-resource-manifest': { scope: 'namespace', risk: 'critical', requiresApproval: true },
} as const satisfies Record<AiActionCanonicalOperation, AiActionDefinition>;

export function getAiActionDefinition(
  operation: AiActionCanonicalOperation | string | undefined,
): AiActionDefinition | undefined {
  if (!operation || !Object.prototype.hasOwnProperty.call(AI_ACTION_REGISTRY, operation)) return undefined;
  return AI_ACTION_REGISTRY[operation as AiActionCanonicalOperation];
}

export function isReadOnlyAiAction(operation: AiActionCanonicalOperation | string | undefined): boolean {
  return getAiActionDefinition(operation)?.risk === 'read';
}
