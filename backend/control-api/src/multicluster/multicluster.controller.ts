import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { ClusterAccessSubject } from '../common/cluster-access.service';
import { AuthGuard } from '../common/auth.guard';
import {
  MultiClusterService,
  type MultiClusterQueryRequest,
} from './multicluster.service';

@Controller('api/multicluster')
@UseGuards(AuthGuard)
export class MultiClusterController {
  constructor(private readonly multiClusterService: MultiClusterService) {}

  @Post('query')
  query(@Body() body: MultiClusterQueryRequest, @Req() request: { user?: ClusterAccessSubject }) {
    return this.multiClusterService.query(body, request.user ?? {});
  }
}
