import {
  Body,
  Controller,
  HttpCode,
  Post,
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

  @Post('query')
  @HttpCode(200)
  query(
    @Req() request: { user?: { user?: ClusterAccessSubject } },
    @Body() body: unknown,
  ) {
    return this.service.query(request.user?.user, body);
  }
}
