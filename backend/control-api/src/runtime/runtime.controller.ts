import { Body, Controller, Post, Req, UseGuards, ForbiddenException, Optional } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { RuntimeService } from './runtime.service';
import type {
  CreateRuntimeSessionRequest,
  RuntimeSessionBootstrapResponse,
} from './runtime.service';

type RuntimeRequestUser = {
  user?: {
    id?: string;
    username?: string;
    role?: string;
  };
};

@Controller(['api/runtime', 'api/v1/runtime'])
@UseGuards(AuthGuard)
export class RuntimeController {
  constructor(
    private readonly runtimeService: RuntimeService,
    private readonly clusterAccess: ClusterAccessService,
    @Optional() private readonly authorization?: AuthorizationService,
  ) {}

  @Post('sessions')
  async createSession(
    @Body() body: CreateRuntimeSessionRequest,
    @Req() req: Request & { user?: RuntimeRequestUser },
  ): Promise<RuntimeSessionBootstrapResponse> {
    const fallbackUserId = req.user?.user?.id;
    if (body.type === 'logs') {
      await this.clusterAccess.assertCanRead(req.user?.user, body.clusterId);
      await this.assertCapability(req.user?.user, body.clusterId, 'logs');
    } else {
      await this.clusterAccess.assertCanMutate(req.user?.user, body.clusterId);
      await this.assertCapability(req.user?.user, body.clusterId, 'exec', true);
    }
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

    return this.runtimeService.createSession(
      {
        ...body,
        userId: fallbackUserId,
      },
      {
        requestHost: normalizedRequestHost,
        requestProtocol:
          normalizedRequestProtocol === 'https' ||
          normalizedRequestProtocol === 'http'
            ? normalizedRequestProtocol
            : undefined,
        requestOrigin:
          typeof requestOrigin === 'string' ? requestOrigin : undefined,
      },
    );
  }

  private async assertCapability(subject: RuntimeRequestUser['user'] | undefined, clusterId: string, capability: 'logs' | 'exec', mutation = false) {
    if (!this.authorization || process.env.KUBENOVA_AUTHZ_ENFORCE !== 'true') return;
    const decision = await this.authorization.authorize({ userId: subject?.id ?? '', clusterId, capability, mutation });
    if (!decision.allowed) throw new ForbiddenException({ code: 'AUTHZ_DENIED', reason: decision.reasonCode });
  }
}
