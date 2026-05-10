import { Controller, Get, Headers, Param, Query } from '@nestjs/common';
import { RuntimeService } from './runtime.service';
import type { RuntimeGatewayPath } from './runtime-session.service';

@Controller(['api/runtime/internal', 'api/v1/runtime/internal'])
export class RuntimeInternalController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Get('sessions/:sessionId/bootstrap')
  getSessionBootstrap(
    @Param('sessionId') sessionId: string,
    @Query('runtimeToken') runtimeToken: string,
    @Query('path') path: RuntimeGatewayPath,
    @Headers('x-runtime-gateway-secret') internalSecret?: string,
  ) {
    return this.runtimeService.getGatewaySessionBootstrap({
      sessionId,
      runtimeToken,
      path,
      internalSecret,
    });
  }
}
