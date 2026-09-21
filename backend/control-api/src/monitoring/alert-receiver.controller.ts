import { Controller, Delete, Get, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import type { ClusterAccessSubject } from '../common/cluster-access.service';
import { AlertReceiverService } from './alert-receiver.service';
import { ReceiverStatusService } from './receiver-status.service';

@Controller('api/monitoring/clusters/:clusterId/receiver')
@UseGuards(AuthGuard)
export class AlertReceiverController {
  constructor(private readonly receivers: AlertReceiverService, private readonly status: ReceiverStatusService) {}

  @Get()
  get(@Param('clusterId') clusterId: string, @Req() req: { user?: { user?: ClusterAccessSubject } }, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.status.get(req.user?.user, clusterId);
  }

  @Post('rotate')
  rotate(@Param('clusterId') clusterId: string, @Req() req: { user?: { user?: ClusterAccessSubject } }, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    return this.receivers.rotate(req.user?.user, clusterId);
  }

  @Delete()
  disable(@Param('clusterId') clusterId: string, @Req() req: { user?: { user?: ClusterAccessSubject } }) {
    return this.receivers.disable(req.user?.user, clusterId);
  }
}
