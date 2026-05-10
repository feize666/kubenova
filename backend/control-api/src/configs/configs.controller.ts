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
  ConfigsService,
  type ConfigActionRequest,
  type ConfigListQuery,
  type ConfigListResult,
  type ConfigMutationResponse,
  type CreateConfigResourceRequest,
  type RevisionDiffResult,
  type UpdateConfigResourceRequest,
} from './configs.service';
import type {
  ConfigResourceRecord,
  ConfigRevisionRecord,
} from './configs.repository';
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

@Controller('api/configs')
@UseGuards(AuthGuard)
export class ConfigsController {
  constructor(
    private readonly configsService: ConfigsService,
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

  // GET /api/configs — 分页列表，支持 clusterId/namespace/kind/keyword/page/pageSize
  @Get()
  list(@Query() query: ConfigListQuery): Promise<ConfigListResult> {
    return this.configsService.list(query);
  }

  // GET /api/configs/:id — 获取单个（含 revisions）
  @Get(':id')
  getById(@Param('id') id: string): Promise<ConfigResourceRecord> {
    return this.configsService.getById(id);
  }

  // GET /api/configs/:id/revisions — 获取版本历史列表
  @Get(':id/revisions')
  getRevisions(@Param('id') id: string): Promise<{
    configId: string;
    items: ConfigRevisionRecord[];
    total: number;
    timestamp: string;
  }> {
    return this.configsService.getRevisions(id);
  }

  // GET /api/configs/:id/diff?from=1&to=2 — 对比两个版本差异
  @Get(':id/diff')
  getRevisionDiff(
    @Param('id') id: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ): Promise<RevisionDiffResult> {
    const fromRev = Number.parseInt(from, 10);
    const toRev = Number.parseInt(to, 10);
    if (Number.isNaN(fromRev) || Number.isNaN(toRev)) {
      throw new Error('from 和 to 参数必须为合法整数');
    }
    return this.configsService.getRevisionDiff(id, fromRev, toRev);
  }

  // POST /api/configs — 创建
  @Post()
  create(
    @Req() req: ActorRequest,
    @Body() body: CreateConfigResourceRequest,
  ): Promise<ConfigMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.configsService.create(body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }

  // PATCH /api/configs/:id — 更新
  @Patch(':id')
  update(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: UpdateConfigResourceRequest,
  ): Promise<ConfigMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.configsService.update(id, body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }

  // POST /api/configs/:id/rollback — 回滚到指定版本
  @Post(':id/rollback')
  rollback(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: { revision: number; note?: string },
  ): Promise<ConfigMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.configsService
      .rollback(id, body.revision, actor?.username)
      .then((result) => {
        this.triggerClusterSync(result.item.clusterId);
        return result;
      });
  }

  // POST /api/configs/:id/actions — 状态操作（enable/disable/delete）
  @Post(':id/actions')
  applyAction(
    @Req() req: ActorRequest,
    @Param('id') id: string,
    @Body() body: ConfigActionRequest,
  ): Promise<ConfigMutationResponse> {
    const actor = req.user?.user;
    assertWritePermission(actor);
    return this.configsService.applyAction(id, body, actor).then((result) => {
      this.triggerClusterSync(result.item.clusterId);
      return result;
    });
  }
}
