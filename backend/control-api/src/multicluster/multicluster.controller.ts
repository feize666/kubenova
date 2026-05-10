import { Body, Controller, Post, UseGuards } from '@nestjs/common';
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
  query(@Body() body: MultiClusterQueryRequest) {
    return this.multiClusterService.query(body);
  }
}
