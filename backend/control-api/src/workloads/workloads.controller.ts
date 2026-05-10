import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { assertWritePermission, type PlatformRole } from '../common/governance';
import { resolveRequestId } from '../common/request-id';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import {
  WorkloadsService,
  type WorkloadActionPayload,
  type WorkloadCreateDto,
  type WorkloadUpdateDto,
  type WorkloadWorkspaceRequest,
  type WorkloadWorkspaceRenderYamlResponse,
  type WorkloadWorkspaceValidateResponse,
  type WorkloadWorkspaceSubmitResponse,
  type WorkloadsListQuery,
} from './workloads.service';

interface ActorRequest {
  user?: {
    user?: {
      username?: string;
      role?: PlatformRole;
    };
  };
}

@Controller(['api/workloads', 'api/v1/workloads'])
@UseGuards(AuthGuard)
export class WorkloadsController {
  constructor(
    private readonly workloadsService: WorkloadsService,
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
  ) {}

  private triggerClusterSync(clusterId?: string): void {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      return;
    }
    void (async () => {
      const kubeconfig =
        await this.clustersService.getKubeconfig(normalizedClusterId);
      if (!kubeconfig) {
        return;
      }
      await this.clusterSyncService.syncCluster(
        normalizedClusterId,
        kubeconfig,
      );
    })().catch(() => {
      // 异步补偿刷新失败不影响主流程
    });
  }

  @Post('workspace/validate')
  validateWorkspace(
    @Req() req: { requestId?: string },
    @Body() body: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceValidateResponse> {
    void resolveRequestId(req);
    return this.workloadsService.validateWorkspace(body);
  }

  @Post('workspace/submit')
  async submitWorkspace(
    @Req() req: ActorRequest & { requestId?: string },
    @Body() body: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceSubmitResponse> {
    void resolveRequestId(req);
    const actor = req.user?.user;
    assertWritePermission(actor);
    const result = await this.workloadsService.submitWorkspace(body, actor);
    this.triggerClusterSync(result.workload.clusterId);
    return result;
  }

  @Post('workspace/render-yaml')
  renderWorkspaceYaml(
    @Req() req: { requestId?: string },
    @Body() body: WorkloadWorkspaceRequest,
  ): Promise<WorkloadWorkspaceRenderYamlResponse> {
    void resolveRequestId(req);
    return this.workloadsService.renderWorkspaceYaml(body);
  }

  /**
   * GET /workloads
   * 列表查询，支持 clusterId/namespace/kind/keyword/state/page/pageSize
   */
  @Get()
  list(@Req() req: { requestId?: string }, @Query() query: WorkloadsListQuery) {
    void resolveRequestId(req);
    return this.workloadsService.list(query);
  }

  /**
   * GET /workloads/:idOrKind
   * 兼容旧前端：按 kind 路由查询；其他值按 id 查询
   */
  @Get(':idOrKind')
  getByIdOrLegacyKind(
    @Req() req: { requestId?: string },
    @Param('idOrKind') idOrKind: string,
    @Query() query: Omit<WorkloadsListQuery, 'kind'>,
  ) {
    void resolveRequestId(req);
    if (this.workloadsService.isLegacyKind(idOrKind)) {
      return this.workloadsService.listByLegacyKind(idOrKind, query);
    }
    return this.workloadsService.getById(idOrKind);
  }

  /**
   * POST /workloads
   * 创建工作负载记录
   */
  @Post()
  async create(
    @Req() req: { requestId?: string },
    @Body() dto: WorkloadCreateDto,
  ) {
    void resolveRequestId(req);
    const result = await this.workloadsService.create(dto);
    this.triggerClusterSync(result.clusterId);
    return result;
  }

  /**
   * POST /workloads/:id/actions
   * 对工作负载执行动作（enable/disable/delete/restart/scale/rollback）
   */
  @Post(':id/actions')
  applyAction(
    @Req() req: { requestId?: string },
    @Param('id') id: string,
    @Body() body: { action: string; payload?: WorkloadActionPayload },
  ) {
    void resolveRequestId(req);
    return this.workloadsService
      .applyAction(id, body.action, body.payload)
      .then((result) => {
        this.triggerClusterSync(result.record.clusterId);
        return result;
      });
  }

  /**
   * POST /workloads/:kind/:name/actions
   * 兼容旧前端：按 kind/name 执行动作
   */
  @Post(':kind/:name/actions')
  applyActionByKindAndName(
    @Req() req: { requestId?: string },
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Body()
    body: {
      action: string;
      clusterId?: string;
      namespace?: string;
      payload?: WorkloadActionPayload;
      replicas?: number;
    },
  ) {
    void resolveRequestId(req);
    const payload =
      body.payload ??
      (body.replicas !== undefined ? { replicas: body.replicas } : undefined);
    return this.workloadsService
      .applyActionByKindAndName(kind, name, body.action, {
        clusterId: body.clusterId,
        namespace: body.namespace,
        payload,
      })
      .then((result) => {
        this.triggerClusterSync(result.record.clusterId);
        return result;
      });
  }

  @Post(':kind/:name/disable')
  async disableByKindAndName(
    @Req() req: { requestId?: string },
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Body() body: { clusterId?: string; namespace?: string },
  ) {
    void resolveRequestId(req);
    const result = await this.workloadsService.applyActionByKindAndName(
      kind,
      name,
      'disable',
      body,
    );
    this.triggerClusterSync(result.record.clusterId);
    return result;
  }

  @Post(':kind/:name/enable')
  async enableByKindAndName(
    @Req() req: { requestId?: string },
    @Param('kind') kind: string,
    @Param('name') name: string,
    @Body() body: { clusterId?: string; namespace?: string },
  ) {
    void resolveRequestId(req);
    const result = await this.workloadsService.applyActionByKindAndName(
      kind,
      name,
      'enable',
      body,
    );
    this.triggerClusterSync(result.record.clusterId);
    return result;
  }

  /**
   * PATCH /workloads/:id
   * 更新工作负载记录
   */
  @Patch(':id')
  async update(
    @Req() req: { requestId?: string },
    @Param('id') id: string,
    @Body() dto: WorkloadUpdateDto,
  ) {
    void resolveRequestId(req);
    const result = await this.workloadsService.update(id, dto);
    this.triggerClusterSync(result.clusterId);
    return result;
  }
}
