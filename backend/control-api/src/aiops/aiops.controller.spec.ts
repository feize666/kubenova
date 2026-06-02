jest.mock('@kubernetes/client-node', () => ({}));

import { BadRequestException } from '@nestjs/common';
import { AiopsController } from './aiops.controller';

describe('AiopsController', () => {
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

  it('forwards summary time filters', async () => {
    const { controller, service } = createController();

    await controller.getSummary(
      '1h',
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T01:00:00.000Z',
    );

    expect(service.getSummary).toHaveBeenCalledWith({
      range: '1h',
      from: new Date('2026-01-01T00:00:00.000Z'),
      to: new Date('2026-01-01T01:00:00.000Z'),
    });
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

  it('prechecks recommendation with actor context', async () => {
    const { controller, service } = createController();
    await controller.precheckRecommendation(
      { user: { user: { username: 'admin@local.dev', role: 'admin' } } },
      { recommendationId: ' rec:alert:a1 ' },
    );

    expect(service.precheckRecommendation).toHaveBeenCalledWith(
      'rec:alert:a1',
      {
        username: 'admin@local.dev',
        role: 'platform-admin',
      },
    );
  });

  it('approves recommendation with actor context', async () => {
    const { controller, service } = createController();
    await controller.approveRecommendation(
      {
        user: {
          user: { username: 'operator@local.dev', role: 'cluster-operator' },
        },
      },
      { recommendationId: 'rec:inspection:i1' },
    );

    expect(service.approveRecommendation).toHaveBeenCalledWith(
      'rec:inspection:i1',
      {
        username: 'operator@local.dev',
        role: 'cluster-operator',
      },
    );
  });

  it('rejects empty recommendation id', () => {
    const { controller } = createController();

    expect(() =>
      controller.precheckRecommendation({ user: {} }, { recommendationId: ' ' }),
    ).toThrow(BadRequestException);
  });
});
