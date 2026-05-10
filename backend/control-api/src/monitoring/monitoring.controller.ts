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
  Res,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import type { PlatformRole } from '../common/governance';
import { MonitoringService } from './monitoring.service';
import type {
  AlertsQuery,
  CreateAlertRuleRequest,
  ExecuteInspectionActionRequest,
  InspectionTimeFilter,
  MonitoringAlertRulesResponse,
  MonitoringEventsResponse,
  MonitoringOverviewResponse,
  MonitoringRange,
  InspectionExportFormat,
  UpdateAlertRuleRequest,
} from './monitoring.service';

const VALID_RANGES: readonly MonitoringRange[] = [
  '15m',
  '1h',
  '6h',
  '24h',
  '7d',
];

interface RequestActor {
  user?: {
    username?: string;
    role?: PlatformRole;
  };
}

@Controller('api/monitoring')
@UseGuards(AuthGuard)
export class MonitoringController {
  constructor(private readonly monitoringService: MonitoringService) {}

  @Get('overview')
  async getOverview(
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<MonitoringOverviewResponse> {
    return this.monitoringService.getOverview(
      this.parseTimeFilter(range, from, to, '24h'),
    );
  }

  @Get('events')
  async getEvents(
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<MonitoringEventsResponse> {
    return this.monitoringService.getEvents(
      this.parseTimeFilter(range, from, to, '1h'),
    );
  }

  @Get('alerts')
  async getAlerts(
    @Query('severity') severity?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const query: AlertsQuery = {
      severity,
      status,
      page: page ? parseInt(page, 10) : undefined,
      pageSize: pageSize ? parseInt(pageSize, 10) : undefined,
      ...this.parseTimeFilter(range, from, to, '24h'),
    };
    return this.monitoringService.getAlerts(query);
  }

  @Get('inspection')
  async getInspection(
    @Query('clusterId') clusterId?: string,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    return this.monitoringService.getClusterInspection(
      clusterId && clusterId.trim() ? clusterId.trim() : undefined,
      this.parseTimeFilter(range, from, to, '24h'),
    );
  }

  @Get('inspection/export')
  async exportInspectionReport(
    @Res() response: Response,
    @Query('clusterId') clusterId: string | undefined,
    @Query('format') format: string | undefined,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const exportFormat = this.parseExportFormat(format);
    const result = await this.monitoringService.exportClusterInspectionReport(
      clusterId && clusterId.trim() ? clusterId.trim() : undefined,
      exportFormat,
      this.parseTimeFilter(range, from, to, '24h'),
    );
    response.setHeader('Content-Type', result.contentType);
    const encodedFilename = encodeURIComponent(result.filename);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodedFilename}`,
    );
    response.send(result.data);
  }

  @Post('inspection/rerun')
  async rerunInspection(
    @Body()
    body: {
      clusterId?: string;
      range?: string;
      from?: string;
      to?: string;
    },
  ) {
    return this.monitoringService.rerunClusterInspection(
      body.clusterId && body.clusterId.trim()
        ? body.clusterId.trim()
        : undefined,
      this.parseTimeFilter(body.range, body.from, body.to, '24h'),
    );
  }

  @Get('alerts/export')
  async exportAlerts(
    @Res() response: Response,
    @Query('severity') severity: string | undefined,
    @Query('status') status: string | undefined,
    @Query('format') format: string | undefined,
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ): Promise<void> {
    const exportFormat = this.parseExportFormat(format);
    const timeFilter = this.parseTimeFilter(range, from, to, '24h');
    const result = await this.monitoringService.exportAlerts(
      {
        severity,
        status,
        ...timeFilter,
      },
      exportFormat,
    );
    response.setHeader('Content-Type', result.contentType);
    const encodedFilename = encodeURIComponent(result.filename);
    response.setHeader(
      'Content-Disposition',
      `attachment; filename="${result.filename}"; filename*=UTF-8''${encodedFilename}`,
    );
    response.send(result.data);
  }

  @Post('inspection/:issueId/actions/generate-yaml')
  async generateFixYaml(
    @Param('issueId') issueId: string,
    @Body() body: ExecuteInspectionActionRequest,
  ) {
    return this.monitoringService.executeInspectionAction(
      issueId,
      'generate-yaml',
      body ?? {},
    );
  }

  @Post('inspection/:issueId/actions/create-hpa-draft')
  async createHpaDraft(
    @Param('issueId') issueId: string,
    @Body() body: ExecuteInspectionActionRequest,
  ) {
    return this.monitoringService.executeInspectionAction(
      issueId,
      'create-hpa-draft',
      body ?? {},
    );
  }

  @Patch('alerts/:id')
  async resolveAlert(@Param('id') id: string) {
    return this.monitoringService.resolveAlert(id);
  }

  @Get('alert-rules')
  listAlertRules(): MonitoringAlertRulesResponse {
    return this.monitoringService.listAlertRules();
  }

  @Post('alert-rules')
  createAlertRule(
    @Req() req: { user?: RequestActor },
    @Body() body: CreateAlertRuleRequest,
  ) {
    return this.monitoringService.createAlertRule(req.user?.user, body);
  }

  @Patch('alert-rules/:id')
  updateAlertRule(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: UpdateAlertRuleRequest,
  ) {
    return this.monitoringService.updateAlertRule(req.user?.user, id, body);
  }

  @Delete('alert-rules/:id')
  deleteAlertRule(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.monitoringService.deleteAlertRule(req.user?.user, id);
  }

  @Post('alert-rules/:id/disable')
  disableAlertRule(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.monitoringService.setAlertRuleState(
      req.user?.user,
      id,
      'disabled',
    );
  }

  @Post('alert-rules/:id/enable')
  enableAlertRule(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
  ) {
    return this.monitoringService.setAlertRuleState(
      req.user?.user,
      id,
      'active',
    );
  }

  private parseRange(
    range: string | undefined,
    fallback: MonitoringRange,
  ): MonitoringRange {
    const normalizedRange = range ?? fallback;
    if (VALID_RANGES.includes(normalizedRange as MonitoringRange)) {
      return normalizedRange as MonitoringRange;
    }

    throw new BadRequestException(
      'Invalid range. Supported values: 15m, 1h, 6h, 24h, 7d',
    );
  }

  private parseTimeFilter(
    range?: string,
    from?: string,
    to?: string,
    fallbackRange: MonitoringRange = '24h',
  ): InspectionTimeFilter {
    if (from || to) {
      const fromDate = from ? this.parseDateTime(from, 'from') : undefined;
      const toDate = to ? this.parseDateTime(to, 'to') : undefined;
      if (fromDate && toDate && fromDate > toDate) {
        throw new BadRequestException('`from` 不能晚于 `to`');
      }
      return {
        range: range ? this.parseRange(range, fallbackRange) : undefined,
        from: fromDate,
        to: toDate,
      };
    }
    return {
      range: this.parseRange(range, fallbackRange),
    };
  }

  private parseDateTime(raw: string, field: 'from' | 'to'): Date {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`无效的 ${field} 时间格式`);
    }
    return parsed;
  }

  private parseExportFormat(
    format: string | undefined,
  ): InspectionExportFormat {
    const normalized = format?.toLowerCase() ?? 'json';
    if (
      normalized === 'json' ||
      normalized === 'csv' ||
      normalized === 'xlsx'
    ) {
      return normalized;
    }
    throw new BadRequestException(
      'Invalid format. Supported values: json, csv, xlsx',
    );
  }
}
