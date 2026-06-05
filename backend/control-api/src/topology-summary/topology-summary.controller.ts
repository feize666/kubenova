import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { TopologySummaryService } from './topology-summary.service';

@Controller('api/topology/summary')
@UseGuards(AuthGuard)
export class TopologySummaryController {
  constructor(
    private readonly topologySummaryService: TopologySummaryService,
  ) {}

  @Get('namespaces')
  listNamespaceSummaries(@Query('clusterId') clusterId?: string) {
    return this.topologySummaryService.listNamespaceSummaries({
      clusterId: clusterId?.trim() || undefined,
    });
  }
}
