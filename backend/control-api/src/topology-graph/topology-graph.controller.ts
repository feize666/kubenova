import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import type { TopologyActorRequest } from './topology-access';
import { AuthGuard } from '../common/auth.guard';
import { TopologyGraphService } from './topology-graph.service';

@Controller('api/topology')
@UseGuards(AuthGuard)
export class TopologyGraphController {
  constructor(private readonly topologyGraphService: TopologyGraphService) {}

  @Get('graph')
  getGraph(
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('sources') sources?: string,
    @Req() request?: TopologyActorRequest,
  ) {
    return this.topologyGraphService.getGraph({
      clusterId: clusterId?.trim() || undefined,
      namespace: namespace?.trim() || undefined,
      sources: sources
        ?.split(',')
        .map((source) => source.trim())
        .filter(Boolean),
    }, request?.user?.user ?? {});
  }

  @Get('graph/v2')
  getGraphV2(
    @Query('clusterId') clusterId?: string,
    @Query('namespace') namespace?: string,
    @Query('sources') sources?: string,
    @Req() request?: TopologyActorRequest,
  ) {
    return this.topologyGraphService.getGraphV2({
      clusterId: clusterId?.trim() || undefined,
      namespace: namespace?.trim() || undefined,
      sources: sources
        ?.split(',')
        .map((source) => source.trim())
        .filter(Boolean),
    }, request?.user?.user ?? {});
  }
}
