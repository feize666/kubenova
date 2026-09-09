import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import {
  ClusterAccessService,
  type ClusterAccessSubject,
} from './cluster-access.service';

type ClusterScopedRequest = {
  params?: { id?: unknown };
  user?: { user?: ClusterAccessSubject };
  clusterAccess?: Awaited<ReturnType<ClusterAccessService['assertCanAccess']>>;
};

/**
 * Applies to controllers whose cluster identifier is exposed as `:id`.
 * Routes without that parameter (for example a platform-level list) remain
 * untouched until their list query adopts ClusterAccessService explicitly.
 */
@Injectable()
export class ClusterAccessGuard implements CanActivate {
  constructor(private readonly clusterAccess: ClusterAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<ClusterScopedRequest>();
    const clusterId = request.params?.id;
    if (typeof clusterId !== 'string' || !clusterId.trim()) {
      return true;
    }

    request.clusterAccess = await this.clusterAccess.assertCanAccess(
      request.user?.user,
      clusterId,
    );
    return true;
  }
}
