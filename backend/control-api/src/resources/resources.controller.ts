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
  ForbiddenException,
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
  type ResourceEditorSubmitRequest,
} from './resources.service';
import { ClusterSyncService } from '../clusters/cluster-sync.service';
import { ClustersService } from '../clusters/clusters.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import { validateTlsPair } from './resource-editor-security';

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
    private readonly authorizationService: AuthorizationService,
    private readonly namespaceIdentity: NamespaceIdentityService,
  ) {}

  private async assertNamespaceGrant(req: ResourcesRequest, clusterId: string, namespace: string | undefined, kind: string): Promise<void> {
    if (!namespace?.trim()) throw new ForbiddenException('资源不在授权范围内');
    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, namespace);
    const decision = await this.authorizationService.authorize({
      userId: req.user?.user?.id ?? '', clusterId, namespaceUid,
      ...(['secret', 'secrets'].includes(kind.trim().toLowerCase()) ? { capability: 'secrets' as const } : {}),
    });
    if (!decision.allowed) throw new ForbiddenException('资源不在授权范围内');
  }

  private async assertSecretCapability(req: ResourcesRequest, clusterId: string, kind?: string, namespace?: string) {
    if (!['secret', 'secrets'].includes(kind?.trim().toLowerCase() ?? '') || process.env.KUBENOVA_AUTHZ_ENFORCE !== 'true') return;
    if (!this.namespaceIdentity) throw new ForbiddenException({ code: 'AUTHZ_UNAVAILABLE' });
    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, namespace ?? '');
    const decision = await this.authorizationService.authorize({
      userId: req.user?.user?.id ?? '', clusterId, namespaceUid, capability: 'secrets',
    });
    if (!decision.allowed) throw new ForbiddenException({ code: 'AUTHZ_DENIED', reason: decision.reasonCode });
  }

  private async assertSecretMutation(req: ResourcesRequest, clusterId: string, kind?: string, namespace?: string) {
    if (!['secret', 'secrets'].includes(kind?.trim().toLowerCase() ?? '') || process.env.KUBENOVA_AUTHZ_ENFORCE !== 'true') return;
    if (!this.namespaceIdentity) throw new ForbiddenException({ code: 'AUTHZ_UNAVAILABLE' });
    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, namespace ?? '');
    const decision = await this.authorizationService.authorize({ userId: req.user?.user?.id ?? '', clusterId, namespaceUid, capability: 'secrets', mutation: true });
    if (!decision.allowed) throw new ForbiddenException({ code: 'AUTHZ_DENIED', reason: decision.reasonCode });
  }

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

  @Get('access/context')
  async getAccessContext(
    @Req() req: ResourcesRequest,
    @Query() query: { clusterId?: string; namespace?: string; kind?: string; name?: string },
  ) {
    const clusterId = query.clusterId?.trim() ?? '';
    const namespace = query.namespace?.trim() ?? '';
    if (!clusterId || !namespace) throw new BadRequestException('clusterId 与 namespace 不能为空');
    const scope = { kind: 'Service', namespace, namespaced: true };
    await this.authorizeEditorScope(req, clusterId, scope, false);
    await this.clusterAccessService.assertCanDiscover(req.user?.user, clusterId);
    let canMutate = false;
    try {
      await this.clusterAccessService.assertCanMutate(req.user?.user, clusterId);
      await this.authorizeEditorScope(req, clusterId, scope, true);
      canMutate = true;
    } catch (error) {
      const status = (error as { getStatus?: () => number })?.getStatus?.();
      if (!(error instanceof ForbiddenException) && status !== 404) throw error;
    }
    return {
      ...(await this.resourcesService.getAccessContext({
        clusterId,
        namespace,
        kind: query.kind ?? '',
        name: query.name ?? '',
      })),
      canMutate,
    };
  }

  @Get('editor/config-keys')
  async configKeys(@Req() req: ResourcesRequest, @Query() query: { clusterId?: string; namespace?: string; kind?: string; name?: string }) {
    const clusterId = typeof query.clusterId === 'string' ? query.clusterId.trim() : '';
    const namespace = typeof query.namespace === 'string' ? query.namespace.trim() : '';
    const kind = typeof query.kind === 'string' ? query.kind : '';
    const name = typeof query.name === 'string' ? query.name.trim() : '';
    if (!clusterId || !namespace || !name || !['Secret', 'ConfigMap'].includes(kind)) throw new BadRequestException('配置资源身份无效');
    await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    await this.authorizeEditorScope(req, clusterId, { kind, namespace, namespaced: true }, false);
    return this.resourcesService.getConfigKeys(clusterId, namespace, kind, name);
  }

  @Get('editor/config-references')
  async configReferences(@Req() req: ResourcesRequest, @Query() query: { clusterId?: string; namespace?: string; kind?: string }) {
    const clusterId = typeof query.clusterId === 'string' ? query.clusterId.trim() : '';
    const namespace = typeof query.namespace === 'string' ? query.namespace.trim() : '';
    const kind = typeof query.kind === 'string' ? query.kind : '';
    if (!clusterId || !namespace || !['Secret', 'ConfigMap'].includes(kind)) throw new BadRequestException('配置资源范围无效');
    await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    await this.authorizeEditorScope(req, clusterId, { kind, namespace, namespaced: true }, false);
    return this.resourcesService.getConfigReferences(clusterId, namespace, kind);
  }

  @Post('editor/validate-tls')
  async validateTls(@Req() req: ResourcesRequest, @Body() body: { clusterId?: string; namespace?: string; certificate?: string; privateKey?: string }) {
    const clusterId = typeof body?.clusterId === 'string' ? body.clusterId.trim() : '';
    const namespace = typeof body?.namespace === 'string' ? body.namespace.trim() : '';
    if (!clusterId || !namespace) throw new BadRequestException('请选择集群和命名空间');
    await this.clusterAccessService.assertCanMutate(req.user?.user, clusterId);
    await this.authorizeEditorScope(req, clusterId, { kind: 'Secret', namespace, namespaced: true }, true);
    return validateTlsPair(body.certificate, body.privateKey);
  }

  @Get('ingressclasses')
  async ingressClasses(@Req() req: ResourcesRequest, @Query('clusterId') clusterId = '') {
    await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    return this.resourcesService.listIngressClasses(clusterId);
  }

  @Get('ingressclasses/impact')
  async ingressClassImpact(@Req() req: ResourcesRequest, @Query('clusterId') clusterId = '', @Query('name') name = '') {
    await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    return this.resourcesService.ingressClassImpact(clusterId, name);
  }

  @Post('ingressclasses/default')
  async ingressClassDefault(@Req() req: ResourcesRequest, @Body() body: { clusterId: string; name: string; expected: Record<string, string>; dryRun: boolean }) {
    await this.clusterAccessService.assertCanMutate(req.user?.user, body?.clusterId);
    const result = await this.resourcesService.setDefaultIngressClass(body.clusterId, body.name, body.expected, body.dryRun);
    if (!body.dryRun) this.triggerClusterSync(body.clusterId);
    return result;
  }

  @Post('ingressclasses/delete')
  async ingressClassDelete(@Req() req: ResourcesRequest, @Body() body: { clusterId: string; name: string; resourceVersion: string; force?: boolean }) {
    if (body?.force !== undefined && typeof body.force !== 'boolean') throw new BadRequestException('force 必须为 boolean');
    if (body?.force) await this.clusterAccessService.assertClusterAdmin(req.user?.user, body.clusterId);
    else await this.clusterAccessService.assertCanMutate(req.user?.user, body?.clusterId);
    const result = await this.resourcesService.deleteIngressClass(body.clusterId, body.name, body.resourceVersion, body.force === true);
    this.triggerClusterSync(body.clusterId);
    return result;
  }

  @Get('editor/schema')
  async getEditorSchema(@Req() req: ResourcesRequest, @Query() query: { clusterId?: string; apiVersion?: string; kind?: string; namespace?: string; resource?: string }) {
    const clusterId = typeof query.clusterId === 'string' ? query.clusterId.trim() : '';
    if (!clusterId) throw new BadRequestException('clusterId 不能为空');
    await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    const scope = await this.resourcesService.resolveEditorScope(query);
    await this.authorizeEditorScope(req, clusterId, scope, false);
    return this.resourcesService.getEditorSchema(query);
  }

  @Post('editor/submit')
  async submitEditor(@Req() req: ResourcesRequest, @Body() body?: ResourceEditorSubmitRequest) {
    const clusterId = typeof body?.clusterId === 'string' ? body.clusterId.trim() : '';
    if (!clusterId) throw new BadRequestException('clusterId 不能为空');
    await this.clusterAccessService.assertCanMutate(req.user?.user, clusterId);
    if (body?.operation !== 'create' && body?.operation !== 'update') throw new BadRequestException('operation 必须为 create 或 update');
    const result = await this.resourcesService.submitEditor({ ...body, clusterId } as ResourceEditorSubmitRequest, manifest =>
      this.authorizeEditorManifest(req, clusterId, manifest),
    );
    if (!body?.dryRun && result.total > 0) this.triggerClusterSync(clusterId);
    return result;
  }

  private async authorizeEditorManifest(req: ResourcesRequest, clusterId: string, manifest: any): Promise<void> {
    const scope = await this.resourcesService.resolveEditorScope({ clusterId, apiVersion: manifest.apiVersion, kind: manifest.kind, namespace: manifest.metadata?.namespace });
    await this.authorizeEditorScope(req, clusterId, scope, true);
  }

  private async authorizeEditorScope(req: ResourcesRequest, clusterId: string, scope: { kind: string; namespace: string; namespaced: boolean }, mutation: boolean): Promise<void> {
    if (mutation) await this.assertSecretMutation(req, clusterId, scope.kind, scope.namespace);
    else await this.assertSecretCapability(req, clusterId, scope.kind, scope.namespace);
    const accessible = await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    if (accessible === null || accessible.includes(clusterId)) return;
    if (!scope.namespaced || !scope.namespace) throw new ForbiddenException('资源不在授权范围内');
    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, scope.namespace);
    const decision = await this.authorizationService.authorize({ userId: req.user?.user?.id ?? '', clusterId, namespaceUid, mutation,
      ...(scope.kind === 'Secret' ? { capability: 'secrets' as const } : {}),
    });
    if (!decision.allowed) throw new ForbiddenException('资源不在授权范围内');
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
    const unrestricted = await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    if (unrestricted === null || unrestricted.includes(identity.clusterId)) {
      await this.clusterAccessService.assertCanRead(req.user?.user, identity.clusterId);
      await this.assertSecretCapability(req, identity.clusterId, identity.resource, identity.namespace);
    } else {
      await this.clusterAccessService.assertCanDiscover(req.user?.user, identity.clusterId);
      const scope = await this.resourcesService.resolveDynamicReadScope(identity);
      await this.assertNamespaceGrant(req, identity.clusterId, scope.namespace, scope.kind);
    }
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
    await this.assertSecretMutation(req, identity.clusterId, identity.resource, identity.namespace);
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
    await this.assertSecretMutation(req, identity.clusterId, identity.resource, identity.namespace);
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
    await this.assertSecretMutation(req, identity.clusterId, identity.resource, identity.namespace);
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
    const unrestricted = await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    if (unrestricted === null || unrestricted.includes(identity.clusterId)) {
      await this.clusterAccessService.assertCanRead(req.user?.user, identity.clusterId);
      await this.assertSecretCapability(req, identity.clusterId, identity.kind, identity.namespace);
    } else {
      if (!this.resourcesService.isNamespacedKind(identity.kind)) throw new ForbiddenException('资源不在授权范围内');
      await this.assertNamespaceGrant(req, identity.clusterId, identity.namespace, identity.kind);
    }
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
    const unrestrictedClusterIds =
      await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    const accessibleClusterIds = unrestrictedClusterIds === null ? null :
      await this.clusterAccessService.listDiscoverableClusterIds(req.user?.user);
    const scope = await this.resourcesService.resolveDetailClusterScope(
      kind,
      normalizedId,
      accessibleClusterIds,
    );
    if (unrestrictedClusterIds === null || unrestrictedClusterIds.includes(scope.clusterId)) {
      await this.clusterAccessService.assertCanRead(req.user?.user, scope.clusterId);
      await this.assertSecretCapability(req, scope.clusterId, kind, scope.namespace);
    } else {
      if (scope.scope !== 'namespace' || !scope.namespace) throw new ForbiddenException('资源不在授权范围内');
      await this.assertNamespaceGrant(req, scope.clusterId, scope.namespace, kind);
    }
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
    await this.assertSecretMutation(httpRequest, req.clusterId, req.kind, req.namespace);
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
    const result = await this.resourcesService.applyYaml(req, manifest =>
      this.assertSecretMutation(httpRequest, req.clusterId, manifest.kind, manifest.metadata?.namespace),
    );
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
