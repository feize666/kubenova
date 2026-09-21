import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { TopologyActorRequest } from '../topology-graph/topology-access';
import { AuthGuard } from '../common/auth.guard';
import { TopologySummaryService } from './topology-summary.service';

@Controller('api/topology/summary')
@UseGuards(AuthGuard)
export class TopologySummaryController {
  constructor(
    private readonly topologySummaryService: TopologySummaryService,
  ) {}

  @Get('namespaces')
  listNamespaceSummaries(@Query('clusterId') clusterId?: string, @Req() request?: TopologyActorRequest) {
    return this.topologySummaryService.listNamespaceSummaries({
      clusterId: clusterId?.trim() || undefined,
    }, request?.user?.user ?? {});
  }
}
