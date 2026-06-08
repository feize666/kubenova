import {
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { AuthGuard } from '../common/auth.guard';
import {
  LogsService,
  type LogsQueryRequest,
  type LogsStreamBootstrapRequest,
} from './logs.service';

@Controller('api/logs')
@UseGuards(AuthGuard)
export class LogsController {
  constructor(private readonly logsService: LogsService) {}

  @Get()
  async query(@Query() query: LogsQueryRequest) {
    return this.logsService.query(query);
  }

  @Post('stream')
  async createStreamSession(
    @Body() body: LogsStreamBootstrapRequest,
    @Req() req: Request,
  ) {
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
