import { Body, Controller, Get, Header, Headers, HttpCode, Param, Post, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { RuntimeService } from './runtime.service';
import type { RuntimeGatewayPath } from './runtime-session.service';

@Controller(['api/runtime/internal', 'api/v1/runtime/internal'])
export class RuntimeInternalController {
  constructor(private readonly runtimeService: RuntimeService) {}

  @Post('sessions/:sessionId/watch')
  async watchSession(
    @Param('sessionId') sessionId: string,
    @Body() body: { runtimeToken?: string; path?: RuntimeGatewayPath },
    @Res() response: Response,
    @Headers('x-runtime-gateway-secret') internalSecret?: string,
  ) {
    const lease = await this.runtimeService.watchGatewaySession({ sessionId, runtimeToken: body?.runtimeToken ?? '', path: body?.path as RuntimeGatewayPath, internalSecret });
    if (response.destroyed || lease.signal.aborted) { lease.close(); response.end(); return; }
    response.status(200).set({ 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    response.write('{"active":true}\n');
    const timer = setInterval(() => { if (!response.write('{"active":true}\n')) response.destroy(); }, 10000);
    const close = () => { clearInterval(timer); lease.signal.removeEventListener('abort', close); lease.close(); response.end(); };
    lease.signal.addEventListener('abort', close, { once: true });
    response.once('close', close);
  }

  @Post('sessions/:sessionId/status')
  @HttpCode(200)
  @Header('Cache-Control', 'no-store')
  getSessionStatus(
    @Param('sessionId') sessionId: string,
    @Body() body: { runtimeToken?: string; path?: RuntimeGatewayPath },
    @Headers('x-runtime-gateway-secret') internalSecret?: string,
  ) {
    return this.runtimeService.getGatewaySessionStatus({ sessionId, runtimeToken: body?.runtimeToken ?? '', path: body?.path as RuntimeGatewayPath, internalSecret });
  }

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
