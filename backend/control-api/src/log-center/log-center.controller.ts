import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { ClusterAccessSubject } from '../common/cluster-access.service';
import { LogCenterService } from './log-center.service';

@Controller('api/log-center')
@UseGuards(AuthGuard)
export class LogCenterController {
  constructor(private readonly service: LogCenterService) {}

  @Get('sources')
  @Header('Cache-Control', 'no-store')
  sources(
    @Req() request: { user?: { user?: ClusterAccessSubject } },
    @Query('clusterId') clusterId: unknown,
  ) {
    return this.service.sources(request.user?.user, clusterId);
  }

  @Post('query')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  query(
    @Req() request: { user?: { user?: ClusterAccessSubject } },
    @Body() body: unknown,
  ) {
    return this.service.query(request.user?.user, body);
  }

  @Post('collection/preview')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  previewCollection(
    @Req() request: { user?: { user?: ClusterAccessSubject } },
    @Body() body: unknown,
  ) {
    return this.service.previewCollection(request.user?.user, body);
  }
}
