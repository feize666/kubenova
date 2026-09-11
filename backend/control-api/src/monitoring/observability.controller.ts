import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';
import type { PlatformRole } from '../common/governance';
import {
  OBSERVABILITY_KINDS,
  NOTIFICATION_CHANNELS,
  ObservabilityService,
  type AlertTemplateInput,
  type DataSourceInput,
  type NotificationTemplateInput,
} from './observability.service';

interface ActorRequest {
  user?: { user?: ClusterAccessSubject & { username?: string; role?: PlatformRole } };
}

@Controller('api/observability')
@UseGuards(AuthGuard)
export class ObservabilityController {
  constructor(
    private readonly observabilityService: ObservabilityService,
    private readonly clusterAccessService: ClusterAccessService,
  ) {}

  @Get('data-sources')
  async listDataSources(@Req() req: ActorRequest, @Query('clusterId') clusterId?: string) {
    if (clusterId?.trim()) await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
    else this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.listDataSources(clusterId);
  }

  @Post('data-sources')
  async createDataSource(@Req() req: ActorRequest, @Body() body: DataSourceInput) {
    await this.assertClusterMutation(req, body.clusterId);
    return this.observabilityService.createDataSource(req.user?.user, body);
  }

  @Patch('data-sources/:id')
  async updateDataSource(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<DataSourceInput>) {
    const scope = await this.observabilityService.getDataSourceScope(id);
    if (!scope) throw new BadRequestException('可观测性数据源不存在');
    await this.assertClusterMutation(req, body.clusterId === undefined ? scope.clusterId : body.clusterId);
    return this.observabilityService.updateDataSource(req.user?.user, id, body);
  }

  @Delete('data-sources/:id')
  async deleteDataSource(@Req() req: ActorRequest, @Param('id') id: string) {
    const scope = await this.observabilityService.getDataSourceScope(id);
    if (!scope) throw new BadRequestException('可观测性数据源不存在');
    await this.assertClusterMutation(req, scope.clusterId);
    return this.observabilityService.deleteDataSource(req.user?.user, id);
  }

  @Post('data-sources/:id/test')
  async testDataSource(@Req() req: ActorRequest, @Param('id') id: string) {
    const scope = await this.observabilityService.getDataSourceScope(id);
    if (!scope) throw new BadRequestException('可观测性数据源不存在');
    await this.assertClusterRead(req, scope.clusterId);
    return this.observabilityService.testDataSource(id);
  }

  @Post('data-sources/test')
  testEndpoint(@Req() req: ActorRequest, @Body() body: { kind: string; endpoint: string }) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    if (!(OBSERVABILITY_KINDS as readonly string[]).includes(body?.kind)) {
      throw new BadRequestException('kind 不受支持');
    }
    return this.observabilityService.testEndpoint(body.kind as never, body.endpoint);
  }

  @Get('alert-templates')
  listAlertTemplates() {
    return this.observabilityService.listAlertTemplates();
  }

  @Post('alert-templates')
  createAlertTemplate(@Req() req: ActorRequest, @Body() body: AlertTemplateInput) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.createAlertTemplate(req.user?.user, body);
  }

  @Patch('alert-templates/:id')
  updateAlertTemplate(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<AlertTemplateInput>) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.updateAlertTemplate(req.user?.user, id, body);
  }

  @Delete('alert-templates/:id')
  deleteAlertTemplate(@Req() req: ActorRequest, @Param('id') id: string) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.deleteAlertTemplate(req.user?.user, id);
  }

  @Get('notification-templates')
  listNotificationTemplates() {
    return this.observabilityService.listNotificationTemplates();
  }

  @Post('notification-templates')
  createNotificationTemplate(@Req() req: ActorRequest, @Body() body: NotificationTemplateInput) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.createNotificationTemplate(req.user?.user, body);
  }

  @Patch('notification-templates/:id')
  updateNotificationTemplate(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<NotificationTemplateInput>) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.updateNotificationTemplate(req.user?.user, id, body);
  }

  @Delete('notification-templates/:id')
  deleteNotificationTemplate(@Req() req: ActorRequest, @Param('id') id: string) {
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
    return this.observabilityService.deleteNotificationTemplate(req.user?.user, id);
  }

  @Get('catalog')
  catalog() {
    return {
      dataSourceKinds: OBSERVABILITY_KINDS,
      notificationChannels: NOTIFICATION_CHANNELS,
      defaults: {
        prometheus: process.env.OBSERVABILITY_PROMETHEUS_URL ?? null,
        grafana: process.env.OBSERVABILITY_GRAFANA_URL ?? null,
        alertmanager: process.env.OBSERVABILITY_ALERTMANAGER_URL ?? null,
        elasticsearch: process.env.OBSERVABILITY_ELASTICSEARCH_URL ?? null,
        kibana: process.env.OBSERVABILITY_KIBANA_URL ?? null,
      },
    };
  }

  private async assertClusterRead(req: ActorRequest, clusterId: string | null | undefined): Promise<void> {
    if (clusterId) {
      await this.clusterAccessService.assertCanRead(req.user?.user, clusterId);
      return;
    }
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
  }

  private async assertClusterMutation(req: ActorRequest, clusterId: string | null | undefined): Promise<void> {
    if (clusterId) {
      await this.clusterAccessService.assertCanMutate(req.user?.user, clusterId);
      return;
    }
    this.clusterAccessService.assertPlatformAdmin(req.user?.user);
  }
}
