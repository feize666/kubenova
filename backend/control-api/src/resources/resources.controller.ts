import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  ClusterAccessService,
  type ClusterAccessSubject,
} from '../common/cluster-access.service';
import {
  type DynamicResourceIdentity,
  type DynamicResourceQuery,
  ResourcesService,
  type ResourceIdentity,
  type ResourceYamlApplyRequest,
  type ResourceYamlUpdateRequest,
} from './resources.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';

interface ResourcesRequest {
  user?: {
    user?: ClusterAccessSubject;
  };
}

@Controller('api/resources')
@UseGuards(AuthGuard)
export class ResourcesController {
  constructor(
    private readonly resourcesService: ResourcesService,
    private readonly clustersService: ClustersService,
    private readonly clusterSyncService: ClusterSyncService,
    private readonly clusterAccessService: ClusterAccessService,
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

  private parseBoolean(value: string | boolean | undefined): boolean {
    if (typeof value === 'boolean') {
      return value;
    }
    if (typeof value !== 'string') {
      return false;
    }
    return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
  }

  @Post('discovery/refresh')
  async refreshDiscovery(
    @Req() req: ResourcesRequest,
    @Body()
    body?: {
      clusterId?: string;
    },
  ) {
    const clusterId = body?.clusterId?.trim();
    if (!clusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    await this.clusterAccessService.assertCanMutate(req.user?.user, clusterId);
    return this.resourcesService.refreshDiscoveryCatalog(clusterId);
  }

  @Get('discovery/catalog')
  async getDiscoveryCatalog(
    @Req() req: ResourcesRequest,
    @Query('clusterId') clusterId?: string,
    @Query('refresh') refresh?: string,
  ) {
    const normalizedClusterId = clusterId?.trim();
    if (!normalizedClusterId) {
      throw new BadRequestException('clusterId 不能为空');
    }
    const refreshFlag = this.parseBoolean(refresh);
    if (refreshFlag) {
      await this.clusterAccessService.assertCanMutate(
        req.user?.user,
        normalizedClusterId,
      );
    } else {
      await this.clusterAccessService.assertCanRead(
        req.user?.user,
        normalizedClusterId,
      );
    }
    return this.resourcesService.getDiscoveryCatalog(normalizedClusterId, {
      refresh: refreshFlag,
    });
  }

  @Get('dynamic')
  async listDynamic(
    @Req() req: ResourcesRequest,
    @Query() query: DynamicResourceQuery,
  ) {
    const clusterId = query.clusterId?.trim();
    if (clusterId) {
      await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
      return this.resourcesService.listDynamicResources(query);
    }
    const accessibleClusterIds =
      await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    return this.resourcesService.listDynamicResources(query, {
      accessibleClusterIds,
    });
  }

  @Get('dynamic/detail')
  async getDynamicDetail(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanRead(
      req.user?.user,
      identity.clusterId,
    );
    return this.resourcesService.getDynamicResourceDetail(identity);
  }

  @Put('dynamic/yaml')
  async updateDynamicYaml(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      req.user?.user,
      identity.clusterId,
    );
    const result = await this.resourcesService.updateDynamicYaml(identity);
    if (!identity.dryRun) {
      this.triggerClusterSync(identity.clusterId);
    }
    return result;
  }

  @Post('dynamic/delete')
  async deleteDynamic(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      req.user?.user,
      identity.clusterId,
    );
    const result = await this.resourcesService.deleteDynamicResource(identity);
    this.triggerClusterSync(identity.clusterId);
    return result;
  }

  @Post('dynamic/create')
  async createDynamic(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      req.user?.user,
      identity.clusterId,
    );
    const result = await this.resourcesService.createDynamicResource({
      ...identity,
      body: body?.body ?? {},
    });
    this.triggerClusterSync(identity.clusterId);
    return result;
  }

  @Get('yaml')
  async getYaml(
    @Req() req: ResourcesRequest,
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('kind') kind?: string,
    @Query('name') name?: string,
  ) {
    const identity = this.parseIdentity({ clusterId, namespace, kind, name });
    await this.clusterAccessService.assertCanRead(
      req.user?.user,
      identity.clusterId,
    );
    return this.resourcesService.getYaml(identity);
  }

  @Get(':kind/:id/detail')
  async getDetail(
    @Req() req: ResourcesRequest,
    @Param('kind') kind: string,
    @Param('id') id: string,
  ) {
    if (!id?.trim()) {
      throw new BadRequestException('id 不能为空');
    }
    const normalizedId = id.trim();
    const accessibleClusterIds =
      await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    const scope = await this.resourcesService.resolveDetailClusterScope(
      kind,
      normalizedId,
      accessibleClusterIds,
    );
    await this.clusterAccessService.assertCanRead(
      req.user?.user,
      scope.clusterId,
    );
    return this.resourcesService.getDetail(kind, normalizedId);
  }

  @Put('yaml')
  async updateYaml(
    @Req() httpRequest: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      httpRequest.user?.user,
      req.clusterId,
    );
    const result = await this.resourcesService.updateYaml(req);
    if (!req.dryRun) {
      this.triggerClusterSync(req.clusterId);
    }
    return result;
  }

  @Post('yaml/apply')
  async applyYaml(
    @Req() httpRequest: ResourcesRequest,
    @Body()
    body?: {
      clusterId?: string;
      namespace?: string;
      yaml?: string;
      dryRun?: boolean;
    },
  ) {
    const req: ResourceYamlApplyRequest = {
      clusterId: body?.clusterId?.trim() ?? '',
      namespace: body?.namespace?.trim() || undefined,
      yaml: body?.yaml?.trim() ?? '',
      dryRun: Boolean(body?.dryRun),
    };
    await this.clusterAccessService.assertCanMutate(
      httpRequest.user?.user,
      req.clusterId,
    );
    const result = await this.resourcesService.applyYaml(req);
    if (!req.dryRun) {
      this.triggerClusterSync(req.clusterId);
    }
    return result;
  }

  @Post('scale')
  async scale(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      req.user?.user,
      identity.clusterId,
    );
    const result = await this.resourcesService.scaleResource(
      identity,
      replicas,
    );
    this.triggerClusterSync(identity.clusterId);
    return result;
  }

  @Post('image')
  async updateImage(
    @Req() req: ResourcesRequest,
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
    await this.clusterAccessService.assertCanMutate(
      req.user?.user,
      identity.clusterId,
    );
    const result = await this.resourcesService.updateImage(
      identity,
      image,
      container,
    );
    this.triggerClusterSync(identity.clusterId);
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
