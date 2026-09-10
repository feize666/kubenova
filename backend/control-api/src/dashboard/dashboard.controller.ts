import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  ClusterAccessService,
  type ClusterAccessSubject,
} from '../common/cluster-access.service';
import { DashboardService } from './dashboard.service';

interface DashboardRequest {
  user?: { user?: ClusterAccessSubject };
}

@Controller('api/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly clusterAccessService: ClusterAccessService,
  ) {}

  @Get('stats')
  async getStats(
    @Req() req: DashboardRequest,
    @Query('clusterId') clusterId?: string,
  ) {
    const normalizedClusterId = clusterId?.trim();
    if (normalizedClusterId) {
      const access = await this.clusterAccessService.assertCanRead(
        req.user?.user,
        normalizedClusterId,
      );
      return this.dashboardService.getStats({ clusterId: access.clusterId });
    }

    const accessibleClusterIds =
      await this.clusterAccessService.listAccessibleClusterIds(req.user?.user);
    return this.dashboardService.getStats({ accessibleClusterIds });
  }
}
