import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Logger,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import {
  appendAudit,
  assertWritePermission,
  type PlatformRole,
} from '../common/governance';
import { resolveRequestId } from '../common/request-id';
import {
  type ClusterBatchStateRequest,
  type ClusterProfileMutationInput,
  type ClusterMutationInput,
  ClustersService,
  type ClustersListQuery,
} from './clusters.service';
import { ClusterHealthService } from './cluster-health.service';
import { ClusterEventSyncService } from './cluster-event-sync.service';
import { ClusterSyncService } from './cluster-sync.service';

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

interface MutationReasonPayload {
  reason?: string;
}

interface ClusterListQueryWithSelectable extends ClustersListQuery {
  selectableOnly?: string | boolean;
}

interface Envelope<
  TData,
  TMeta extends Record<string, unknown> = Record<string, unknown>,
> {
  data: TData;
  meta: TMeta;
  requestId: string;
}

@Controller(['api/clusters', 'api/v1/clusters'])
@UseGuards(AuthGuard)
export class ClustersController {
  private readonly logger = new Logger(ClustersController.name);

  constructor(
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterHealthService: ClusterHealthService,
    private readonly clusterEventSyncService: ClusterEventSyncService,
  ) {}

  private buildAuditReason(requestId: string, reason?: string): string {
    return reason?.trim()
      ? `${reason.trim()} | requestId=${requestId}`
      : `requestId=${requestId}`;
  }

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

  private triggerEventHealthProbe(clusterId: string): void {
    void this.clusterHealthService
      .probeCluster(clusterId, { source: 'event', bypassBackoff: true })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `event health probe failed clusterId=${clusterId} reason=${message}`,
        );
      });
  }

  private triggerEventSync(clusterId: string): void {
    void (async () => {
      const kubeconfig = await this.clustersService.getKubeconfig(clusterId);
      if (!kubeconfig) {
        return;
      }
      await this.clusterSyncService.syncCluster(clusterId, kubeconfig);
    })().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(
        `event sync failed clusterId=${clusterId} reason=${message}`,
      );
    });
  }

  private triggerEventWatcher(clusterId: string): void {
    void this.clusterEventSyncService
      .ensureClusterWatching(clusterId)
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'unknown error';
        this.logger.warn(
          `event watcher start failed clusterId=${clusterId} reason=${message}`,
        );
      });
  }

  private parseBoolean(value: string | boolean | undefined): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value !== 'string') {
      return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  private async listAllClusters(
    query: ClusterListQueryWithSelectable,
  ): Promise<Awaited<ReturnType<ClustersService['list']>>['items']> {
    const pageSize = 500;
    const items: Awaited<ReturnType<ClustersService['list']>>['items'] = [];
    let page = 1;

    for (;;) {
      const list = await this.clustersService.list({
        keyword: query.keyword,
        provider: query.provider,
        state: query.state,
        page: String(page),
        pageSize: String(pageSize),
        environment: query.environment,
        status: query.status,
      });
      items.push(...list.items);
      if (list.items.length < pageSize) {
        break;
      }
      page += 1;
    }

    return items;
  }

  @Get()
  async list(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Query() query: ClusterListQueryWithSelectable,
  ) {
    const requestId = resolveRequestId(req, res);
    const selectableOnly = this.parseBoolean(query.selectableOnly);
    const list = selectableOnly
      ? {
          items: await this.listAllClusters(query),
          page: 1,
          pageSize: 0,
          total: 0,
          timestamp: new Date().toISOString(),
        }
      : await this.clustersService.list(query);
    let items = list.items;
    if (selectableOnly) {
      items = list.items.filter(
        (item) =>
          item.state === 'active' &&
          item.hasKubeconfig &&
          (item.status ?? '').toLowerCase() !== 'offline' &&
          (item.status ?? '').toLowerCase() !== 'checking' &&
          (item.status ?? '').toLowerCase() !== 'offline-mode',
      );
    }

    return this.ok(
      {
        ...list,
        items,
        total: selectableOnly ? items.length : list.total,
      },
      requestId,
      {
        page: list.page,
        pageSize: list.pageSize,
        total: selectableOnly ? items.length : list.total,
        timestamp: list.timestamp,
        ...(selectableOnly ? { selectableOnly: true } : {}),
      },
    );
  }

  @Get('events/stream')
  async streamEvents(@Req() req: AuthenticatedRequest, @Res() res: Response) {
    resolveRequestId(req, res);
    res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');
    res.flushHeaders?.();
    res.write(`retry: 1500\n\n`);

    const unsubscribe = this.clusterEventSyncService.subscribe((event) => {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => {
      res.write(`: ping ${Date.now()}\n\n`);
    }, 25000);

    req.on('close', () => {
      clearInterval(heartbeat);
      unsubscribe();
      res.end();
    });
  }

  @Get(':id')
  async detail(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const detail = await this.clustersService.getDetail(id);
    return this.ok(detail, requestId, { action: 'detail' });
  }

  @Post()
  async create(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: ClusterMutationInput,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const created = await this.clustersService.create(body);
    if (created.state === 'active' && created.hasKubeconfig) {
      this.triggerEventHealthProbe(created.id);
      this.triggerEventSync(created.id);
      this.triggerEventWatcher(created.id);
    }
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'create',
      resourceType: 'cluster',
      resourceId: created.id,
      result: 'success',
      reason: this.buildAuditReason(requestId),
    });

    return this.ok(created, requestId, { action: 'create' });
  }

  @Patch(':id')
  async update(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: ClusterMutationInput,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const updated = await this.clustersService.update(id, body);
    if (
      updated.state === 'active' &&
      updated.hasKubeconfig &&
      body.kubeconfig !== undefined
    ) {
      this.triggerEventHealthProbe(updated.id);
      this.triggerEventSync(updated.id);
      this.triggerEventWatcher(updated.id);
    }
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'update',
      resourceType: 'cluster',
      resourceId: updated.id,
      result: 'success',
      reason: this.buildAuditReason(requestId),
    });

    return this.ok(updated, requestId, { action: 'update' });
  }

  @Patch(':id/profile')
  async updateProfile(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body: ClusterProfileMutationInput,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const updated = await this.clustersService.updateProfile(id, body);
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'update',
      resourceType: 'cluster',
      resourceId: updated.id,
      result: 'success',
      reason: this.buildAuditReason(requestId),
    });

    return this.ok(updated, requestId, { action: 'update-profile' });
  }

  @Delete(':id')
  async remove(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const deleted = await this.clustersService.remove(id);
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'delete',
      resourceType: 'cluster',
      resourceId: deleted.id,
      result: 'success',
      reason: this.buildAuditReason(requestId),
    });

    return this.ok(deleted, requestId, { action: 'delete' });
  }

  @Post(':id/disable')
  async disable(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body?: MutationReasonPayload,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const next = await this.clustersService.disable(id);
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'disable',
      resourceType: 'cluster',
      resourceId: next.id,
      result: 'success',
      reason: this.buildAuditReason(requestId, body?.reason),
    });

    return this.ok(next, requestId, { action: 'disable' });
  }

  @Post(':id/enable')
  async enable(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
    @Body() body?: MutationReasonPayload,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const next = await this.clustersService.enable(id);
    if (next.state === 'active' && next.hasKubeconfig) {
      this.triggerEventHealthProbe(next.id);
      this.triggerEventSync(next.id);
      this.triggerEventWatcher(next.id);
    }
    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'enable',
      resourceType: 'cluster',
      resourceId: next.id,
      result: 'success',
      reason: this.buildAuditReason(requestId, body?.reason),
    });

    return this.ok(next, requestId, { action: 'enable' });
  }

  @Post('batch-state')
  async batchState(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: ClusterBatchStateRequest,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const response = await this.clustersService.applyBatchState(body);
    response.result.forEach((item) => {
      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: item.action,
        resourceType: 'cluster',
        resourceId: item.id,
        result: item.status === 'success' ? 'success' : 'failure',
        reason: this.buildAuditReason(requestId, body.reason || item.message),
      });
    });

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'batch',
      resourceType: 'cluster',
      resourceId: 'batch-state',
      result: response.status === 'failure' ? 'failure' : 'success',
      reason: this.buildAuditReason(requestId, body.reason),
    });

    return this.ok(response, requestId, {
      action: 'batch-state',
      total: response.result.length,
      succeeded: response.result.filter((item) => item.status === 'success')
        .length,
      failed: response.result.filter((item) => item.status === 'failure')
        .length,
    });
  }

  // ── 集群数据同步 ───────────────────────────────────────────────────────────

  /**
   * POST /api/clusters/:id/sync
   * 触发指定集群的 Kubernetes 数据同步（需要集群已配置 kubeconfig）
   */
  @Post(':id/sync')
  @HttpCode(200)
  async triggerSync(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const actor = req.user?.user;
    assertWritePermission(actor);

    const cluster = await this.clustersService.findById(id);
    if (!cluster) {
      throw new NotFoundException(`未找到集群: ${id}`);
    }
    if (!cluster.hasKubeconfig) {
      throw new BadRequestException('该集群未配置 kubeconfig，无法同步数据');
    }

    const kubeconfig = await this.clustersService.getKubeconfig(id);
    if (!kubeconfig) {
      throw new BadRequestException('kubeconfig 读取失败');
    }

    const result = await this.clusterSyncService.syncCluster(id, kubeconfig);

    appendAudit({
      actor: actor?.username ?? 'unknown',
      role: actor?.role ?? 'read-only',
      action: 'sync',
      resourceType: 'cluster',
      resourceId: id,
      result: result.ok ? 'success' : 'failure',
      reason: this.buildAuditReason(requestId),
    });

    return this.ok(result, requestId, { action: 'sync' });
  }

  /**
   * GET /api/clusters/:id/health
   * 检查集群连接健康状态
   * 有 kubeconfig 时尝试真实连接；否则返回 mock 数据
   */
  @Get(':id/health')
  async healthCheck(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);
    const result = await this.clusterHealthService.getLegacyHealthResult(id);
    return this.ok(result, requestId, { action: 'health' });
  }

  /**
   * GET /api/clusters/:id/sync/status
   * 返回上次同步状态和时间
   */
  @Get(':id/sync/status')
  async syncStatus(
    @Req() req: AuthenticatedRequest,
    @Res({ passthrough: true }) res: Response,
    @Param('id') id: string,
  ) {
    const requestId = resolveRequestId(req, res);

    const cluster = await this.clustersService.findById(id);
    if (!cluster) {
      throw new NotFoundException(`未找到集群: ${id}`);
    }

    const status = this.clusterSyncService.getLastSyncStatus(id);

    return this.ok(
      status ?? { ok: null, syncedAt: null, result: null },
      requestId,
      { action: 'sync-status' },
    );
  }
}
