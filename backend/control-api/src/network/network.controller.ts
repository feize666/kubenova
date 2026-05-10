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
import {
  NetworkService,
  type NetworkActionRequest,
  type NetworkListQuery,
  type NetworkListResult,
  type NetworkMutationResponse,
  type CreateNetworkResourceRequest,
  type UpdateNetworkResourceRequest,
} from './network.service';
import type { NetworkResourceRecord } from './network.repository';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';

interface ActorRequest {
  user?: {
    user?: {
      username?: string;
      role?: PlatformRole;
    };
  };
}

@Controller('api/network')
@UseGuards(AuthGuard)
export class NetworkController {
  constructor(
    private readonly networkService: NetworkService,
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

  // GET /api/network — 分页列表，支持 clusterId/namespace/kind/keyword/page/pageSize
  @Get()
  list(@Query() query: NetworkListQuery): Promise<NetworkListResult> {
    return this.networkService.list(query);
  }

  // GET /api/network/:id — 获取单个
  @Get(':id')
  getById(@Param('id') id: string): Promise<NetworkResourceRecord> {
    return this.networkService.getById(id);
  }

  // POST /api/network — 创建
  @Post()
  create(
    @Req() req: ActorRequest,
    @Body() body: CreateNetworkResourceRequest,
  ): Promise<NetworkMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.networkService.create(body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }

  // PATCH /api/network/:id — 更新
  @Patch(':id')
  update(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: UpdateNetworkResourceRequest,
  ): Promise<NetworkMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.networkService.update(id, body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }

  // POST /api/network/:id/actions — 状态操作（enable/disable/delete）
  @Post(':id/actions')
  applyAction(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: NetworkActionRequest,
  ): Promise<NetworkMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.networkService.applyAction(id, body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }
}
