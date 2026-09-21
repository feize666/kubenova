import {
  Controller,
  ForbiddenException,
  Get,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  ClusterAccessService,
  type ClusterAccessSubject,
} from '../common/cluster-access.service';
import {
  DashboardService,
  type DashboardStatsOptions,
} from './dashboard.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';

interface DashboardRequest {
  user?: { user?: ClusterAccessSubject };
}

@Controller('api/dashboard')
@UseGuards(AuthGuard)
export class DashboardController {
  constructor(
    private readonly dashboardService: DashboardService,
    private readonly clusterAccessService: ClusterAccessService,
    private readonly authorization: AuthorizationService,
    private readonly namespaceIdentity: NamespaceIdentityService,
  ) {}

  @Get('stats')
  async getStats(
    @Req() req: DashboardRequest,
    @Query('clusterId') clusterId?: string,
  ) {
    const normalizedClusterId = clusterId?.trim();
    const actor = req.user?.user;
    if (!actor?.id?.trim()) throw new UnauthorizedException();
    if (!this.clusterAccessService.isKnownPlatformRole(actor))
      throw new ForbiddenException();
    const accessibleClusterIds =
      await this.clusterAccessService.listAccessibleClusterIds(actor);
    if (
      normalizedClusterId &&
      (accessibleClusterIds === null ||
        accessibleClusterIds.includes(normalizedClusterId))
    ) {
      const access = await this.clusterAccessService.assertCanRead(
        req.user?.user,
        normalizedClusterId,
      );
      return this.dashboardService.getStats({ clusterId: access.clusterId });
    }

    if (accessibleClusterIds === null)
      return this.dashboardService.getStats({ accessibleClusterIds });

    const grants = await this.authorization.listEffectiveGrants(
      actor.id,
      new Date(),
      normalizedClusterId,
    );
    const namespaceScopes: NonNullable<
      DashboardStatsOptions['namespaceScopes']
    > = [];
    const seen = new Set<string>();
    for (const grant of grants) {
      if (
        accessibleClusterIds.includes(grant.clusterId) ||
        (normalizedClusterId && grant.clusterId !== normalizedClusterId)
      )
        continue;
      for (const scope of grant.namespaces) {
        const namespace = scope.namespaceName?.trim();
        if (!namespace || !scope.namespaceUid?.trim()) continue;
        const key = JSON.stringify([
          grant.clusterId,
          namespace,
          scope.namespaceUid,
        ]);
        if (seen.has(key)) continue;
        seen.add(key);
        try {
          if (
            (await this.namespaceIdentity.resolve(
              grant.clusterId,
              namespace,
            )) !== scope.namespaceUid
          )
            continue;
          namespaceScopes.push({
            clusterId: grant.clusterId,
            namespace,
            namespaceUid: scope.namespaceUid,
          });
        } catch {
          // Unreachable or recreated namespaces cannot inherit an old grant.
        }
      }
    }
    if (normalizedClusterId && !namespaceScopes.length)
      throw new ForbiddenException();
    return this.dashboardService.getStats({
      ...(normalizedClusterId ? { clusterId: normalizedClusterId } : {}),
      accessibleClusterIds: normalizedClusterId ? [] : accessibleClusterIds,
      ...(namespaceScopes.length ? { namespaceScopes } : {}),
    });
  }
}
