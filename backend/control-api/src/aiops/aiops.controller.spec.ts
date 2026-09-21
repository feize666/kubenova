jest.mock('@kubernetes/client-node', () => ({}));

import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { AiopsController } from './aiops.controller';

describe('AiopsController', () => {
  it('rejects unauthenticated and unknown subjects on the summary route', () => {
    const { controller } = createController();
    expect(() => controller.getSummary()).toThrow(ForbiddenException);
    expect(() => controller.getSummary('24h', undefined, undefined, undefined,
      { user: { user: { id: 'unknown', role: 'unrecognized' } } },
    )).toThrow(ForbiddenException);
  });
  function createController() {
    const aiopsService = {
      getSummary: jest.fn().mockResolvedValue({
        range: '24h',
        timestamp: new Date().toISOString(),
        anomalyOverview: {
          total: 0,
          critical: 0,
          warning: 0,
          source: 'monitoring-alert',
          degraded: false,
        },
        incidentQueue: [],
        correlationGroups: [],
        topImpactedServices: [],
        rootCauseCandidates: [],
        recommendations: [],
        auditState: {
          readOnly: true,
          approvalRequiredForMutations: true,
          auditTrailReady: true,
        },
        degraded: false,
      }),
      precheckRecommendation: jest.fn().mockResolvedValue({
        recommendationId: 'rec:alert:a1',
        incidentId: 'alert:a1',
        status: 'passed',
        checks: [],
        approvalRequired: true,
        rollbackHint: 'rollback',
        timestamp: new Date().toISOString(),
      }),
      approveRecommendation: jest.fn().mockResolvedValue({
        recommendationId: 'rec:alert:a1',
        incidentId: 'alert:a1',
        approved: true,
        executionStatus: 'not-executed',
        audit: {},
        message: 'ok',
        rollbackHint: 'rollback',
        timestamp: new Date().toISOString(),
      }),
    };
    return {
      controller: new AiopsController(aiopsService as never),
      service: aiopsService,
    };
  }

  it('forwards summary cluster and time filters', async () => {
    const { controller, service } = createController();

    await controller.getSummary(
      '1h',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
      ' cluster-a ',
      { user: { user: { id: 'reader', role: 'read-only' } } },
    );

    expect(service.getSummary).toHaveBeenCalledWith({
      clusterId: 'cluster-a',
      range: '1h',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T01:00:00.000Z'),
    }, { id: 'reader', role: 'read-only', username: undefined });
  });

  it('rejects unsupported range', () => {
    const { controller } = createController();

    expect(() => controller.getSummary('2h')).toThrow(BadRequestException);
  });

  it('rejects inverted time range', () => {
    const { controller } = createController();

    expect(() =>
      controller.getSummary(
        '1h',
        '2026-01-01T02:00:00.000Z',
        '2026-01-01T01:00:00.000Z',
      ),
    ).toThrow(BadRequestException);
  });

  it('prechecks recommendation with actor context', () => {
    const { controller, service } = createController();
    controller.precheckRecommendation(
      { user: { user: { id: 'admin', username: 'admin@local.dev', role: 'admin' } } },
      { recommendationId: ' rec:alert:a1 ' },
    );

    expect(service.precheckRecommendation).toHaveBeenCalledWith(
      'rec:alert:a1',
      {
        id: 'admin',
        username: 'admin@local.dev',
        role: 'platform-admin',
      },
    );
  });

  it('approves recommendation with actor context', () => {
    const { controller, service } = createController();
    controller.approveRecommendation(
      {
        user: {
          user: { id: 'operator', username: 'operator@local.dev', role: 'cluster-operator' },
        },
      },
      { recommendationId: 'rec:inspection:i1' },
    );

    expect(service.approveRecommendation).toHaveBeenCalledWith(
      'rec:inspection:i1',
      {
        id: 'operator',
        username: 'operator@local.dev',
        role: 'cluster-operator',
      },
    );
  });

  it('rejects empty recommendation id', () => {
    const { controller } = createController();

    expect(() =>
      controller.precheckRecommendation(
        { user: {} },
        { recommendationId: ' ' },
      ),
    ).toThrow(BadRequestException);
  });
});
