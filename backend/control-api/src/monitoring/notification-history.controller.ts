import { Controller, Get, Param, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { ClusterAccessSubject } from '../common/cluster-access.service';
import { NotificationHistoryService } from './notification-history.service';

@Controller('api/monitoring/clusters/:clusterId/deliveries')
@UseGuards(AuthGuard)
export class NotificationHistoryController {
  constructor(private readonly history: NotificationHistoryService) {}

  @Get()
  list(@Param('clusterId') clusterId: string, @Query() query: { take?: string; cursor?: string; status?: string; event?: string }, @Req() req: { user?: { user?: ClusterAccessSubject } }) {
    return this.history.list(req.user?.user, clusterId, query);
  }
}
