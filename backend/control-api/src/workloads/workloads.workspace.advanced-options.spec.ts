jest.mock('@kubernetes/client-node', () => ({
  dumpYaml: (value: unknown) => JSON.stringify(value, null, 2),
}));

import type { Prisma } from '@prisma/client';
import { BadRequestException } from '@nestjs/common';
import { WorkloadsService } from './workloads.service';
import type { WorkloadsRepository } from './workloads.repository';
import type { StorageService } from '../storage/storage.service';
import type { NetworkService } from '../network/network.service';
import type { ClustersService } from '../clusters/clusters.service';
import type { ClusterHealthService } from '../clusters/cluster-health.service';
import type { K8sClientService } from '../clusters/k8s-client.service';
import type { LiveMetricsService } from '../metrics/live-metrics.service';
import type { PrismaService } from '../platform/database/prisma.service';

describe('WorkloadsService advanced options validate/render/submit', () => {
  function build() {
    const repository = {
      findByKey: jest.fn().mockResolvedValue(null),
      list: jest.fn(),
      create: jest.fn(),
      findById: jest.fn(),
      update: jest.fn(),
      setState: jest.fn(),
    } as unknown as WorkloadsRepository;

    const storageService = {
      create: jest.fn(),
    } as unknown as StorageService;
    const networkService = {
      create: jest.fn(),
    } as unknown as NetworkService;
    const clustersService = {
      getKubeconfig: jest.fn(),
    } as unknown as ClustersService;
    const clusterHealthService = {
      assertClusterOnlineForRead: jest.fn(),
      listReadableClusterIdsForResourceRead: jest.fn(),
    } as unknown as ClusterHealthService;
    const k8sClientService = {
      createClient: jest.fn(),
    } as unknown as K8sClientService;
    const liveMetricsService = {
      getClusterSnapshot: jest.fn(),
    } as unknown as LiveMetricsService;
    const prisma = {
      clusterRegistry: {
        findFirst: jest.fn().mockResolvedValue({ id: 'c-1' }),
      },
      storageResource: {
        findFirst: jest.fn().mockResolvedValue(null),
      },
    } as unknown as PrismaService;

    const service = new WorkloadsService(
      repository,
      storageService,
      networkService,
      clustersService,
      { watchClusterResources: jest.fn() } as never,
      clusterHealthService,
      { emitClusterRefresh: jest.fn() } as never,
      k8sClientService,
      liveMetricsService,
      prisma,
    );

    return { service, repository };
  }

  const validAdvancedInput = {
    clusterId: 'c-1',
    namespace: 'default',
    kind: 'Deployment',
    name: 'demo-app',
    image: 'manual.registry.local/team/demo:v1.2.3',
    replicas: 2,
    scheduling: {
      nodeSelector: 'disktype=ssd\nzone=cn-sh',
      tolerations:
        '[{"key":"dedicated","operator":"Equal","value":"gpu","effect":"NoSchedule"}]',
      affinity:
        '{"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"disktype","operator":"In","values":["ssd"]}]}]}}}',
    },
    probes: {
      liveness: {
        enabled: true,
        type: 'httpGet' as const,
        path: '/healthz',
        port: 8080,
        initialDelaySeconds: 5,
        periodSeconds: 10,
      },
      readiness: {
        enabled: true,
        type: 'tcpSocket' as const,
        port: 8080,
        timeoutSeconds: 2,
      },
      startup: {
        enabled: true,
        type: 'exec' as const,
        command: 'sh -c test -f /tmp/ready',
        failureThreshold: 30,
        periodSeconds: 10,
      },
    },
  };

  it('keeps scheduling/probes spec consistent across validate -> render-yaml -> submit', async () => {
    const { service } = build();
    const createSpy = jest.spyOn(service, 'create').mockResolvedValue({
      id: 'w-1',
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo-app',
      state: 'active',
      replicas: 2,
      readyReplicas: null,
      spec: {} as Prisma.JsonValue,
      statusJson: null,
      labels: null,
      annotations: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    });

    const validation = await service.validateWorkspace(validAdvancedInput);
    expect(validation.valid).toBe(true);
    expect(validation.errors).toEqual([]);

    const rendered = await service.renderWorkspaceYaml(validAdvancedInput);
    const workloadManifest = rendered.manifests.find(
      (item) => item.source === 'workload',
    );
    expect(workloadManifest).toBeDefined();
    const renderedSpec = JSON.parse(workloadManifest!.yaml).spec;
    const podSpec = renderedSpec.template.spec;

    expect(podSpec.nodeSelector).toEqual({
      disktype: 'ssd',
      zone: 'cn-sh',
    });
    expect(podSpec.tolerations).toEqual([
      {
        key: 'dedicated',
        operator: 'Equal',
        value: 'gpu',
        effect: 'NoSchedule',
      },
    ]);
    expect(podSpec.affinity).toEqual(
      JSON.parse(validAdvancedInput.scheduling.affinity),
    );
    expect(podSpec.containers[0].livenessProbe).toEqual(
      expect.objectContaining({
        httpGet: { path: '/healthz', port: 8080, scheme: 'HTTP' },
      }),
    );
    expect(podSpec.containers[0].readinessProbe).toEqual(
      expect.objectContaining({
        tcpSocket: { port: 8080 },
      }),
    );
    expect(podSpec.containers[0].startupProbe).toEqual(
      expect.objectContaining({
        exec: { command: ['sh', '-c', 'test', '-f', '/tmp/ready'] },
      }),
    );

    await service.submitWorkspace(validAdvancedInput);

    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        clusterId: 'c-1',
        namespace: 'default',
        kind: 'Deployment',
        name: 'demo-app',
        replicas: 2,
        spec: renderedSpec,
      }),
    );
  });

  it('reports probe handler-required and numeric-range validation failures with advanced step field paths', async () => {
    const { service } = build();

    const validation = await service.validateWorkspace({
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo-app',
      image: 'nginx:latest',
      probes: {
        liveness: {
          enabled: true,
          type: 'httpGet',
          path: '',
          port: 0,
          initialDelaySeconds: -1,
          periodSeconds: 0,
        },
        readiness: {
          enabled: true,
          type: 'exec',
          command: '   ',
          timeoutSeconds: 0,
        },
        startup: {
          enabled: true,
          type: 'tcpSocket',
          port: 70000,
          successThreshold: 0,
          failureThreshold: -1,
        },
      },
    });

    expect(validation.valid).toBe(false);
    expect(validation.errors).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.liveness.path',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.liveness.port',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.readiness.command',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.startup.port',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.liveness.initialDelaySeconds',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.liveness.periodSeconds',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.readiness.timeoutSeconds',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.startup.successThreshold',
        }),
        expect.objectContaining({
          step: 'advanced',
          field: 'probes.startup.failureThreshold',
        }),
      ]),
    );
  });

  it('submit rejects invalid probes with VALIDATION_ERROR envelope', async () => {
    const { service } = build();
    const request = {
      clusterId: 'c-1',
      namespace: 'default',
      kind: 'Deployment',
      name: 'demo-app',
      image: 'nginx:latest',
      probes: {
        liveness: {
          enabled: true,
          type: 'httpGet' as const,
          path: '',
          port: 8080,
        },
      },
    };

    try {
      await service.submitWorkspace(request);
      throw new Error('expected bad request');
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      expect((error as BadRequestException).getResponse()).toEqual(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          message: '工作区校验失败',
          details: expect.objectContaining({
            valid: false,
            errors: expect.arrayContaining([
              expect.objectContaining({
                step: 'advanced',
                field: 'probes.liveness.path',
              }),
            ]),
          }),
        }),
      );
    }
  });
});
