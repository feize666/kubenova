import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  type DynamicResourceIdentity,
  type DynamicResourceQuery,
  ResourcesService,
  type ResourceIdentity,
  type ResourceYamlUpdateRequest,
} from './resources.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';

@Controller('api/resources')
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(
    private readonly resourcesService: ResourcesService,
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

  @Post('discovery/refresh')
  refreshDiscovery(
    @Body()
    body?: {
      clusterId?: string;
    },
  ) {
    const clusterId = body?.clusterId?.trim();
    if (!clusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    return this.resourcesService.refreshDiscoveryCatalog(clusterId);
  }

  @Get('discovery/catalog')
  getDiscoveryCatalog(
    @Query('clusterId') clusterId?: string,
    @Query('refresh') refresh?: string,
  ) {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    const refreshFlag =
      refresh === 'true' || refresh === '1' || refresh === 'yes';
    return this.resourcesService.getDiscoveryCatalog(normalizedClusterId, {
      refresh: refreshFlag,
    });
  }

  @Get('dynamic')
  listDynamic(@Query() query: DynamicResourceQuery) {
    return this.resourcesService.listDynamicResources(query);
  }

  @Get('dynamic/detail')
  getDynamicDetail(
    @Query('clusterId') clusterId?: string,
    @Query('group') group?: string,
    @Query('version') version?: string,
    @Query('resource') resource?: string,
    @Query('namespace') namespace?: string,
    @Query('name') name?: string,
  ) {
    const identity: DynamicResourceIdentity = {
      clusterId: clusterId?.trim() ?? '',
      group: group?.trim() ?? '',
      version: version?.trim() ?? '',
      resource: resource?.trim() ?? '',
      namespace: namespace?.trim() ?? '',
      name: name?.trim() ?? '',
    };
    return this.resourcesService.getDynamicResourceDetail(identity);
  }

  @Put('dynamic/yaml')
  async updateDynamicYaml(
    @Body()
    body?: {
      clusterId?: string;
      group?: string;
      version?: string;
      resource?: string;
      namespace?: string;
      name?: string;
      yaml?: string;
      dryRun?: boolean;
    },
  ) {
    const identity = {
      clusterId: body?.clusterId?.trim() ?? '',
      group: body?.group?.trim() ?? '',
      version: body?.version?.trim() ?? '',
      resource: body?.resource?.trim() ?? '',
      namespace: body?.namespace?.trim() ?? '',
      name: body?.name?.trim() ?? '',
      yaml: body?.yaml,
      dryRun: Boolean(body?.dryRun),
    };
    const result = await this.resourcesService.updateDynamicYaml(identity);
    if (!identity.dryRun) {
      this.triggerClusterSync(result.clusterId);
    }
    return result;
  }

  @Post('dynamic/delete')
  async deleteDynamic(
    @Body()
    body?: {
      clusterId?: string;
      group?: string;
      version?: string;
      resource?: string;
      namespace?: string;
      name?: string;
    },
  ) {
    const identity: DynamicResourceIdentity = {
      clusterId: body?.clusterId?.trim() ?? '',
      group: body?.group?.trim() ?? '',
      version: body?.version?.trim() ?? '',
      resource: body?.resource?.trim() ?? '',
      namespace: body?.namespace?.trim() ?? '',
      name: body?.name?.trim() ?? '',
    };
    const result = await this.resourcesService.deleteDynamicResource(identity);
    this.triggerClusterSync(result.clusterId);
    return result;
  }

  @Post('dynamic/create')
  async createDynamic(
    @Body()
    body?: {
      clusterId?: string;
      group?: string;
      version?: string;
      resource?: string;
      namespace?: string;
      name?: string;
      body?: Record<string, unknown>;
    },
  ) {
    const identity: DynamicResourceIdentity = {
      clusterId: body?.clusterId?.trim() ?? '',
      group: body?.group?.trim() ?? '',
      version: body?.version?.trim() ?? '',
      resource: body?.resource?.trim() ?? '',
      namespace: body?.namespace?.trim() ?? '',
      name: body?.name?.trim() ?? '',
    };
    const result = await this.resourcesService.createDynamicResource({
      ...identity,
      body: body?.body ?? {},
    });
    this.triggerClusterSync(result.clusterId);
    return result;
  }

  @Get('yaml')
  getYaml(
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('kind') kind?: string,
    @Query('name') name?: string,
  ) {
    const identity = this.parseIdentity({ clusterId, namespace, kind, name });
    return this.resourcesService.getYaml(identity);
  }

  @Get(':kind/:id/detail')
  getDetail(@Param('kind') kind: string, @Param('id') id: string) {
    if (!id?.trim()) {
      throw new BadRequestException('id 不能为空');
    }
    return this.resourcesService.getDetail(kind, id.trim());
  }

  @Put('yaml')
  async updateYaml(
    @Body()
    body?: {
      clusterId?: string;
      namespace?: string;
      kind?: string;
      name?: string;
      yaml?: string;
      dryRun?: boolean;
    },
  ) {
    const identity = this.parseIdentity(body);
    const yaml = body?.yaml?.trim();
    if (!yaml) {
      throw new BadRequestException('yaml 不能为空');
    }
    const req: ResourceYamlUpdateRequest = {
      ...identity,
      yaml,
      dryRun: Boolean(body?.dryRun),
    };
    const result = await this.resourcesService.updateYaml(req);
    if (!req.dryRun) {
      this.triggerClusterSync(result.clusterId);
    }
    return result;
  }

  @Post('scale')
  async scale(
    @Body()
    body?: {
      clusterId?: string;
      namespace?: string;
      kind?: string;
      name?: string;
      replicas?: number;
    },
  ) {
    const identity = this.parseIdentity(body);
    const replicas = Number(body?.replicas);
    if (!Number.isInteger(replicas) || replicas < 0) {
      throw new BadRequestException('replicas 必须为大于等于 0 的整数');
    }
    const result = await this.resourcesService.scaleResource(
      identity,
      replicas,
    );
    this.triggerClusterSync(result.clusterId);
    return result;
  }

  @Post('image')
  async updateImage(
    @Body()
    body?: {
      clusterId?: string;
      namespace?: string;
      kind?: string;
      name?: string;
      image?: string;
      container?: string;
    },
  ) {
    const identity = this.parseIdentity(body);
    const image = body?.image?.trim();
    if (!image) {
      throw new BadRequestException('image 不能为空');
    }
    const container = body?.container?.trim() || undefined;
    const result = await this.resourcesService.updateImage(
      identity,
      image,
      container,
    );
    this.triggerClusterSync(result.clusterId);
    return result;
  }

  private parseIdentity(input?: {
    clusterId?: string;
    namespace?: string;
    kind?: string;
    name?: string;
  }): ResourceIdentity {
    const clusterId = input?.clusterId?.trim();
    const kind = input?.kind?.trim();
    const name = input?.name?.trim();
    if (!clusterId || !kind || !name) {
      throw new BadRequestException('clusterId/kind/name 为必填字段');
    }
    return {
      clusterId,
      namespace: input?.namespace?.trim() || '',
      kind,
      name,
    };
  }
}
