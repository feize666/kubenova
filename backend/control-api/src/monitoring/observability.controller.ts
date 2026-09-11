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
  user?: { user?: { username?: string; role?: PlatformRole } };
}

@Controller('api/observability')
@UseGuards(AuthGuard)
export class ObservabilityController {
  constructor(private readonly observabilityService: ObservabilityService) {}

  @Get('data-sources')
  listDataSources(@Query('clusterId') clusterId?: string) {
    return this.observabilityService.listDataSources(clusterId);
  }

  @Post('data-sources')
  createDataSource(@Req() req: ActorRequest, @Body() body: DataSourceInput) {
    return this.observabilityService.createDataSource(req.user?.user, body);
  }

  @Patch('data-sources/:id')
  updateDataSource(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<DataSourceInput>) {
    return this.observabilityService.updateDataSource(req.user?.user, id, body);
  }

  @Delete('data-sources/:id')
  deleteDataSource(@Req() req: ActorRequest, @Param('id') id: string) {
    return this.observabilityService.deleteDataSource(req.user?.user, id);
  }

  @Post('data-sources/:id/test')
  testDataSource(@Param('id') id: string) {
    return this.observabilityService.testDataSource(id);
  }

  @Post('data-sources/test')
  testEndpoint(@Body() body: { kind: string; endpoint: string }) {
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
    return this.observabilityService.createAlertTemplate(req.user?.user, body);
  }

  @Patch('alert-templates/:id')
  updateAlertTemplate(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<AlertTemplateInput>) {
    return this.observabilityService.updateAlertTemplate(req.user?.user, id, body);
  }

  @Delete('alert-templates/:id')
  deleteAlertTemplate(@Req() req: ActorRequest, @Param('id') id: string) {
    return this.observabilityService.deleteAlertTemplate(req.user?.user, id);
  }

  @Get('notification-templates')
  listNotificationTemplates() {
    return this.observabilityService.listNotificationTemplates();
  }

  @Post('notification-templates')
  createNotificationTemplate(@Req() req: ActorRequest, @Body() body: NotificationTemplateInput) {
    return this.observabilityService.createNotificationTemplate(req.user?.user, body);
  }

  @Patch('notification-templates/:id')
  updateNotificationTemplate(@Req() req: ActorRequest, @Param('id') id: string, @Body() body: Partial<NotificationTemplateInput>) {
    return this.observabilityService.updateNotificationTemplate(req.user?.user, id, body);
  }

  @Delete('notification-templates/:id')
  deleteNotificationTemplate(@Req() req: ActorRequest, @Param('id') id: string) {
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
}
