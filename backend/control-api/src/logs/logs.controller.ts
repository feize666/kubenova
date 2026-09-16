import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  ForbiddenException,
  Optional,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService, type ClusterAccessSubject } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';
import {
  LogsService,
  type LogsQueryRequest,
  type LogsStreamBootstrapRequest,
} from './logs.service';

@Controller('api/logs')
@UseGuards(AuthGuard)
export class LogsController {
  constructor(
    private readonly logsService: LogsService,
    private readonly clusterAccess: ClusterAccessService,
    @Optional() private readonly authorization?: AuthorizationService,
    @Optional() private readonly namespaceIdentity?: NamespaceIdentityService,
  ) {}

  private async assertCapability(subject: ClusterAccessSubject | undefined, clusterId: string, namespace: string) {
    if (process.env.KUBENOVA_AUTHZ_ENFORCE !== 'true') return;
    if (!this.authorization || !this.namespaceIdentity) throw new ForbiddenException({ code: 'AUTHZ_UNAVAILABLE' });
    const namespaceUid = await this.namespaceIdentity.resolve(clusterId, namespace);
    const decision = await this.authorization.authorize({
      userId: subject?.id ?? '', clusterId, namespaceUid, capability: 'logs', mutation: false,
    });
    if (!decision.allowed) throw new ForbiddenException({ code: 'AUTHZ_DENIED', reason: decision.reasonCode });
  }

  @Get()
  async query(
    @Query() query: LogsQueryRequest & { cluster?: string; ns?: string },
    @Req() req: Request & { user?: { user?: ClusterAccessSubject } },
  ) {
    const clusterId = query.clusterId?.trim() || query.cluster || '';
    await this.clusterAccess.assertCanRead(req.user?.user, clusterId);
    await this.assertCapability(req.user?.user, clusterId, query.namespace?.trim() || query.ns?.trim() || '');
    return this.logsService.query(query);
  }

  @Post('stream')
  async createStreamSession(
    @Body() body: LogsStreamBootstrapRequest,
    @Req() req: Request & { user?: { user?: ClusterAccessSubject } },
  ) {
    await this.clusterAccess.assertCanRead(req.user?.user, body.clusterId);
    await this.assertCapability(req.user?.user, body.clusterId, body.namespace);
    const forwardedHost = req.headers['x-forwarded-host'];
    const forwardedProto = req.headers['x-forwarded-proto'];
    const origin = req.headers.origin;

    const requestHost = Array.isArray(forwardedHost)
      ? forwardedHost[0]
      : forwardedHost || req.headers.host;
    const requestProtocol = Array.isArray(forwardedProto)
      ? forwardedProto[0]
      : forwardedProto;
    const requestOrigin = Array.isArray(origin) ? origin[0] : origin;
    const normalizedRequestHost =
      typeof requestHost === 'string'
        ? requestHost.split(',')[0]?.trim()
        : undefined;
    const normalizedRequestProtocol =
      typeof requestProtocol === 'string'
        ? requestProtocol.split(',')[0]?.trim()
        : undefined;

    return this.logsService.createStreamSession(body, {
      userId: req.user?.user?.id,
      requestHost: normalizedRequestHost,
      requestProtocol:
        normalizedRequestProtocol === 'https' ||
        normalizedRequestProtocol === 'http'
          ? normalizedRequestProtocol
          : undefined,
      requestOrigin:
        typeof requestOrigin === 'string' ? requestOrigin : undefined,
    });
  }
}
