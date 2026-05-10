import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { RuntimeService } from './runtime.service';
import type {
  CreateRuntimeSessionRequest,
  RuntimeSessionBootstrapResponse,
} from './runtime.service';

type RuntimeRequestUser = {
  user?: {
    id?: string;
    username?: string;
  };
};

@Controller(['api/runtime', 'api/v1/runtime'])
@UseGuards(AuthGuard)
export class RuntimeController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Post('sessions')
  async createSession(
    @Body() body: CreateRuntimeSessionRequest,
    @Req() req: Request & { user?: RuntimeRequestUser },
  ): Promise<RuntimeSessionBootstrapResponse> {
    const fallbackUserId = req.user?.user?.id;
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
        userId: body.userId ?? fallbackUserId,
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
}
