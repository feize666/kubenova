import {
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { appendAudit, type PlatformRole } from '../common/governance';
import { resolveRequestId } from '../common/request-id';
import {
  ClusterHealthService,
  type ClusterHealthListQuery,
} from './cluster-health.service';

interface AuthenticatedUser {
  username?: string;
  role?: PlatformRole;
}

interface AuthenticatedRequest extends Request {
  requestId?: string;
  user?: {
    user?: AuthenticatedUser;
  };
}

interface Envelope<
  TData,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  data: TData;
  meta: TMeta;
  requestId: string;
}

@Controller(['api/cluster-health', 'api/v1/cluster-health'])
@UseGuards(AuthGuard)
export class ClusterHealthController {
  constructor(private readonly clusterHealthService: ClusterHealthService) {}

  private ok<
    TData,
    TMeta extends Record<string, unknown> = Record<string, unknown>,
  >(
    data: TData,
    requestId: string,
    meta: TMeta = {} as TMeta,
  ): Envelope<TData, TMeta> {
    return {
      data,
      meta,
      requestId,
    };
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Query() query: ClusterHealthListQuery,
  ) {
    const requestId = resolveRequestId(req, res);
    const list = await this.clusterHealthService.listClusterHealth(query);
    return this.ok(list, requestId, {
      action: 'list',
      page: list.page,
      pageSize: list.pageSize,
      total: list.total,
      timestamp: list.timestamp,
    });
  }

  @Get(':id')
  async detail(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const detail = await this.clusterHealthService.getClusterHealthDetail(id);
    return this.ok(detail, requestId, { action: 'detail' });
  }

  @Post(':id/probe')
  async manualProbe(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const snapshot = await this.clusterHealthService.probeCluster(id, {
      source: 'manual',
      bypassBackoff: true,
    });
    const actor = req.user?.user;
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'query',
      resourceType: 'cluster-health',
      resourceId: id,
      result: snapshot.ok ? 'success' : 'failure',
      reason: `source=manual status=${snapshot.status} requestId=${requestId}`,
      requestId,
    });
    return this.ok(snapshot, requestId, { action: 'probe' });
  }
}
