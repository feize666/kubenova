import {
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../common/auth.guard';
import { resolveRequestId } from '../common/request-id';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { AuthService, type ValidatedSession } from './auth.service';

type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: ValidatedSession;
  requestId?: string;
};

@Controller(['api/auth', 'api/v1/auth'])
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = resolveRequestId(req, res);
    const session = await this.authService.login(body.username, body.password);
    if (!session) {
      throw new UnauthorizedException({
        code: 'AUTH_LOGIN_FAILED',
        message: '账号或密码错误',
        requestId,
      });
    }

    return {
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: session.user,
      requestId,
    };
  }

  @Post('refresh')
  @HttpCode(200)
  async refresh(
    @Body() body: RefreshDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = resolveRequestId(req, res);
    const session = await this.authService.refresh(body.refreshToken);
    if (!session) {
      throw new UnauthorizedException({
        code: 'AUTH_REFRESH_FAILED',
        message: '刷新令牌无效',
        requestId,
      });
    }

    return {
      accessToken: session.token,
      refreshToken: session.refreshToken,
      expiresAt: session.expiresAt,
      user: session.user,
      requestId,
    };
  }

  @Post('logout')
  @UseGuards(AuthGuard)
  @HttpCode(200)
  async logout(
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = resolveRequestId(req, res);
    const sessionUser = req.user;
    if (!sessionUser) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REQUIRED',
        message: '未提供有效登录会话',
        requestId,
      });
    }

    await this.authService.logout(sessionUser.token);
    return { message: '已退出登录', requestId };
  }

  @Get('me')
  @UseGuards(AuthGuard)
  me(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const requestId = resolveRequestId(req, res);
    const sessionUser = req.user;
    if (!sessionUser) {
      throw new UnauthorizedException({
        code: 'AUTH_SESSION_REQUIRED',
        message: '未提供有效登录会话',
        requestId,
      });
    }

    return {
      user: sessionUser.user,
      expiresAt: sessionUser.expiresAt,
      requestId,
    };
  }
}
