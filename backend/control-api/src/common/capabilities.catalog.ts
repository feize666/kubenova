export const CONTRACT_VERSION = '1';

export interface CapabilityDescriptor {
  key: string;
  route: string;
  enabled: boolean;
  minContractVersion: string;
}

export type CapabilityBaselineStatus = 'implemented' | 'planned';
export type CapabilityAlignmentStatus = 'aligned' | 'partial' | 'gap';

export interface CapabilityBaselineMatrixEntry {
  category: string;
  capabilityKey: string;
  capabilityName: string;
  status: CapabilityBaselineStatus;
  rancherAlignment: CapabilityAlignmentStatus;
  kubesphereAlignment: CapabilityAlignmentStatus;
  trackedTask?: string;
  updatedAt: string;
}

export interface CapabilityBaselineIntegrityIssue {
  capabilityKey: string;
  field: 'trackedTask';
  message: string;
}

export interface CapabilityBaselineSummary {
  total: number;
  implemented: number;
  planned: number;
  categories: Record<string, number>;
  rancherAligned: number;
  kubesphereAligned: number;
  integrityIssueCount: number;
  lastUpdatedAt: string | null;
}

export const CAPABILITIES: CapabilityDescriptor[] = [
  {
    key: 'dashboard:view',
    route: '/dashboard',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'clusters:manage',
    route: '/clusters',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'network:services:manage',
    route: '/network/services',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'network:ingress:manage',
    route: '/network/ingress',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'network:networkpolicy:manage',
    route: '/network/networkpolicy',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'network:gateway-api:manage',
    route: '/network/gateway-api',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'network:topology:view',
    route: '/network/topology',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:deployments:manage',
    route: '/workloads/deployments',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:statefulsets:manage',
    route: '/workloads/statefulsets',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:daemonsets:manage',
    route: '/workloads/daemonsets',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:replicasets:manage',
    route: '/workloads/replicasets',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:jobs:manage',
    route: '/workloads/jobs',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:cronjobs:manage',
    route: '/workloads/cronjobs',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:autoscaling:manage',
    route: '/workloads/autoscaling',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:autoscaling:hpa:manage',
    route: '/workloads/autoscaling/hpa',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'workloads:autoscaling:vpa:manage',
    route: '/workloads/autoscaling/vpa',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'storage:pv:manage',
    route: '/storage/pv',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'storage:pvc:manage',
    route: '/storage/pvc',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'configs:manage',
    route: '/configs',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'configs:configmaps:manage',
    route: '/configs/configmaps',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'configs:secrets:manage',
    route: '/configs/secrets',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'users:manage',
    route: '/users',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'rbac:manage',
    route: '/users/rbac',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'security:manage',
    route: '/security',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'logs:view',
    route: '/logs',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'monitoring:view',
    route: '/monitoring',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'terminal:connect',
    route: '/terminal',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'ai-assistant:use',
    route: '/ai-assistant',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'apps:helm:manage',
    route: '/workloads/helm',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
  {
    key: 'apps:helm:repositories:manage',
    route: '/workloads/helm/repositories',
    enabled: true,
    minContractVersion: CONTRACT_VERSION,
  },
];

export const CAPABILITY_BASELINE_MATRIX: CapabilityBaselineMatrixEntry[] = [
  {
    category: 'Workloads',
    capabilityKey: 'workloads.autoscaling.advanced-strategy-editor',
    capabilityName: 'HPA advanced strategy editor',
    status: 'implemented',
    rancherAlignment: 'partial',
    kubesphereAlignment: 'aligned',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Workloads',
    capabilityKey: 'workloads.autoscaling.24h-event-timeline',
    capabilityName: 'HPA 24-hour event timeline',
    status: 'implemented',
    rancherAlignment: 'partial',
    kubesphereAlignment: 'aligned',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Architecture',
    capabilityKey: 'runtime.single-binary.delivery',
    capabilityName: 'Single-binary runtime delivery path',
    status: 'implemented',
    rancherAlignment: 'gap',
    kubesphereAlignment: 'gap',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Architecture',
    capabilityKey: 'runtime.release-swap-upgrade',
    capabilityName: 'Release swap upgrade workflow',
    status: 'planned',
    rancherAlignment: 'partial',
    kubesphereAlignment: 'partial',
    trackedTask: '15.3',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Architecture',
    capabilityKey: 'runtime.binary-rollback',
    capabilityName: 'Binary rollback workflow',
    status: 'planned',
    rancherAlignment: 'partial',
    kubesphereAlignment: 'partial',
    trackedTask: '15.5',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Multi-Cluster',
    capabilityKey: 'multicluster.hybrid-profile-metadata',
    capabilityName: 'Hybrid cloud cluster profile metadata',
    status: 'implemented',
    rancherAlignment: 'aligned',
    kubesphereAlignment: 'partial',
    updatedAt: '2026-04-18T00:00:00Z',
  },
  {
    category: 'Planning',
    capabilityKey: 'planning.capability-baseline-matrix-api',
    capabilityName: 'Capability baseline matrix API',
    status: 'implemented',
    rancherAlignment: 'aligned',
    kubesphereAlignment: 'aligned',
    trackedTask: '11.1',
    updatedAt: '2026-04-18T00:00:00Z',
  },
];

export function validateCapabilityBaselineMatrix(
  matrix: CapabilityBaselineMatrixEntry[],
): CapabilityBaselineIntegrityIssue[] {
  const integrityIssues: CapabilityBaselineIntegrityIssue[] = [];
  for (const entry of matrix) {
    if (entry.status === 'planned' && !entry.trackedTask?.trim()) {
      integrityIssues.push({
        capabilityKey: entry.capabilityKey,
        field: 'trackedTask',
        message: 'trackedTask is required when status=planned',
      });
    }
  }
  return integrityIssues;
}

export function summarizeCapabilityBaselineMatrix(
  matrix: CapabilityBaselineMatrixEntry[],
  integrityIssues: CapabilityBaselineIntegrityIssue[],
): CapabilityBaselineSummary {
  const summary: CapabilityBaselineSummary = {
    total: matrix.length,
    implemented: 0,
    planned: 0,
    categories: {},
    rancherAligned: 0,
    kubesphereAligned: 0,
    integrityIssueCount: integrityIssues.length,
    lastUpdatedAt: null,
  };

  for (const entry of matrix) {
    if (entry.status === 'implemented') {
      summary.implemented += 1;
    } else {
      summary.planned += 1;
    }

    summary.categories[entry.category] =
      (summary.categories[entry.category] ?? 0) + 1;

    if (entry.rancherAlignment === 'aligned') {
      summary.rancherAligned += 1;
    }
    if (entry.kubesphereAlignment === 'aligned') {
      summary.kubesphereAligned += 1;
    }

    if (!summary.lastUpdatedAt || entry.updatedAt > summary.lastUpdatedAt) {
      summary.lastUpdatedAt = entry.updatedAt;
    }
  }

  return summary;
}
