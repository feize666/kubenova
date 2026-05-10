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
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import {
  StorageService,
  type StorageActionRequest,
  type StorageListQuery,
  type StorageListResult,
  type StorageMutationResponse,
  type CreateStorageResourceRequest,
  type UpdateStorageResourceRequest,
} from './storage.service';
import type { StorageResourceRecord } from './storage.repository';

interface ActorRequest {
  user?: {
    user?: {
      username?: string;
      role?: PlatformRole;
    };
  };
}

@Controller('api/storage')
@UseGuards(AuthGuard)
export class StorageController {
  constructor(
    private readonly storageService: StorageService,
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

  // GET /api/storage — 分页列表，支持 clusterId/namespace/kind/keyword/page/pageSize
  @Get()
  list(@Query() query: StorageListQuery): Promise<StorageListResult> {
    return this.storageService.list(query);
  }

  // GET /api/storage/:id — 获取单个
  @Get(':id')
  getById(@Param('id') id: string): Promise<StorageResourceRecord> {
    return this.storageService.getById(id);
  }

  // POST /api/storage — 创建
  @Post()
  async create(
    @Req() req: ActorRequest,
    @Body() body: CreateStorageResourceRequest,
  ): Promise<StorageMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    const result = await this.storageService.create(body, actor);
    this.triggerClusterSync(result.item.clusterId);
    return result;
  }

  // PATCH /api/storage/:id — 更新
  @Patch(':id')
  async update(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: UpdateStorageResourceRequest,
  ): Promise<StorageMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    const result = await this.storageService.update(id, body, actor);
    this.triggerClusterSync(result.item.clusterId);
    return result;
  }

  // POST /api/storage/:id/actions — 状态操作（enable/disable/delete）
  @Post(':id/actions')
  async applyAction(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: StorageActionRequest,
  ): Promise<StorageMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    const result = await this.storageService.applyAction(id, body, actor);
    this.triggerClusterSync(result.item.clusterId);
    return result;
  }
}
