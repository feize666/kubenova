import { All, Controller, ForbiddenException, HttpException, Logger, Param, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { Request, Response } from 'express';
import { pipeline } from 'node:stream/promises';
import { NativeGatewayService } from './native-gateway.service';
import { isNativeDiscoveryTarget } from './native-discovery';

@Controller('api/native')
export class NativeGatewayController {
  private readonly logger=new Logger(NativeGatewayController.name);
  constructor(private readonly gateway:NativeGatewayService) {}

  @All('clusters/:clusterId/{*target}')
  async forward(@Param('clusterId') clusterId:string,@Req() request:Request,@Res() response:Response) {
    const cancel=new AbortController();
    const disconnect=()=>cancel.abort();response.once('close',disconnect);
    response.setHeader('Cache-Control','no-store');
    try {
      const match=request.headers.authorization?.match(/^Bearer ([^\s]+)$/);
      if(!match || match[1].length>16384) throw new UnauthorizedException();
      if(request.method!=='GET') throw new ForbiddenException();
      const target=request.originalUrl.match(/^\/api\/native\/clusters\/[^/?]+(\/.*)$/)?.[1];
      if(!target) throw new ForbiddenException();
      if(isNativeDiscoveryTarget(target)) {
        response.json(await this.gateway.discover({clusterId,token:match[1],target,signal:cancel.signal}));return;
      }
      const upstream=await this.gateway.open({clusterId,token:match[1],target,signal:cancel.signal});
      response.status(upstream.statusCode??502);
      response.setHeader('Content-Type',upstream.headers['content-type']?.startsWith('text/plain')?'text/plain; charset=utf-8':'application/json');
      await pipeline(upstream,response,{signal:cancel.signal});
    } catch(error) {
      if(response.destroyed) return;
      if(response.headersSent) {response.destroy();return;}
      const code=error instanceof HttpException?error.getStatus():503;
      if(code===503) this.logger.warn(`Native request failed (${error instanceof Error ? error.constructor.name : 'unknown'})`);
      const reason=code===401?'Unauthorized':code===403?'Forbidden':code===404?'NotFound':'ServiceUnavailable';
      response.status(code).json({apiVersion:'v1',kind:'Status',status:'Failure',reason,message:'Native request unavailable',code});
    } finally {response.removeListener('close',disconnect);cancel.abort();}
  }
}
