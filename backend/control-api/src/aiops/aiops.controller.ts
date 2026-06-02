import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { PlatformRole } from '../common/governance';
import type { MonitoringRange } from '../monitoring/monitoring.service';
import { AiopsService } from './aiops.service';

const VALID_RANGES: readonly MonitoringRange[] = [
  '15m',
  '1h',
  '6h',
  '24h',
  '7d',
];

@Controller('api/aiops')
@UseGuards(AuthGuard)
export class AiopsController {
  constructor(private readonly aiopsService: AiopsService) {}

  @Get('summary')
  getSummary(
    @Query('range') range?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const fromDate = from ? this.parseDate(from, 'from') : undefined;
    const toDate = to ? this.parseDate(to, 'to') : undefined;
    this.assertDateRange(fromDate, toDate);
    return this.aiopsService.getSummary({
      range: this.parseRange(range),
      from: fromDate,
      to: toDate,
    });
  }

  @Post('recommendations/precheck')
  precheckRecommendation(
    @Req()
    req: {
      user?: { user?: { username?: string; role?: string } };
    },
    @Body() body: { recommendationId?: string },
  ) {
    const recommendationId = this.requireRecommendationId(body);
    return this.aiopsService.precheckRecommendation(
      recommendationId,
      this.extractActor(req),
    );
  }

  @Post('recommendations/approve')
  approveRecommendation(
    @Req()
    req: {
      user?: { user?: { username?: string; role?: string } };
    },
    @Body() body: { recommendationId?: string },
  ) {
    const recommendationId = this.requireRecommendationId(body);
    return this.aiopsService.approveRecommendation(
      recommendationId,
      this.extractActor(req),
    );
  }

  private parseRange(range?: string): MonitoringRange {
    const normalized = range ?? '24h';
    if (VALID_RANGES.includes(normalized as MonitoringRange)) {
      return normalized as MonitoringRange;
    }
    throw new BadRequestException('Invalid range. Supported values: 15m, 1h, 6h, 24h, 7d');
  }

  private parseDate(raw: string, field: 'from' | 'to'): Date {
    const parsed = new Date(raw);
    if (Number.isNaN(parsed.getTime())) {
      throw new BadRequestException(`无效的 ${field} 时间格式`);
    }
    return parsed;
  }

  private assertDateRange(from?: Date, to?: Date): void {
    if (from && to && from > to) {
      throw new BadRequestException('`from` 不能晚于 `to`');
    }
  }

  private requireRecommendationId(body: { recommendationId?: string }): string {
    const recommendationId = body.recommendationId?.trim();
    if (!recommendationId) {
      throw new BadRequestException('recommendationId required');
    }
    return recommendationId;
  }

  private extractActor(req: {
    user?: { user?: { username?: string; role?: string } };
  }): { username?: string; role?: PlatformRole } {
    const role = String(req.user?.user?.role ?? '')
      .trim()
      .toLowerCase();
    return {
      username: req.user?.user?.username,
      role:
        role === 'platform-admin' || role === 'admin'
          ? 'platform-admin'
          : role === 'cluster-operator'
            ? 'cluster-operator'
            : 'read-only',
    };
  }
}
