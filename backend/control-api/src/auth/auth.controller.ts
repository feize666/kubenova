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
import { MfaVerifyDto } from './dto/mfa-verify.dto';
import { MfaEnrollmentStartDto, MfaEnrollmentConfirmDto } from './dto/mfa-enrollment.dto';
import { AuthService, type ValidatedSession } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';

type AuthRequest = {
  headers: Record<string, string | string[] | undefined>;
  user?: ValidatedSession;
  requestId?: string;
  socket?: { remoteAddress?: string };
};

@Controller(['api/auth', 'api/v1/auth'])
export class AuthController {
  constructor(private readonly authService: AuthService, private readonly loginLimiter: LoginAttemptLimiter) {}

  @Get('mfa/status')
  @UseGuards(AuthGuard)
  mfaStatus(@Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) throw new UnauthorizedException();
    return this.authService.mfaStatus(req.user);
  }

  @Post('mfa/enrollment')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  beginEnrollment(@Body() body: MfaEnrollmentStartDto, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) throw new UnauthorizedException();
    return this.authService.beginMfaEnrollment(req.user, body.password);
  }

  @Post('mfa/enrollment/confirm')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  confirmEnrollment(@Body() body: MfaEnrollmentConfirmDto, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Cache-Control', 'no-store');
    if (!req.user) throw new UnauthorizedException();
    return this.authService.confirmMfaEnrollment(req.user, body.token, body.code);
  }

  @Post('mfa/verify')
  @HttpCode(200)
  async completeMfa(@Body() body: MfaVerifyDto, @Req() req: AuthRequest, @Res({ passthrough: true }) res: Response) {
    const requestId = resolveRequestId(req, res);
    res.setHeader('Cache-Control', 'no-store');
    await this.loginLimiter.consumeIp(req.socket?.remoteAddress ?? 'unknown');
    const session = await this.authService.completeMfa(body.challengeToken, body.code, body.method);
    if (!session) throw new UnauthorizedException({ code: 'AUTH_MFA_FAILED', message: '二次验证失败，请重新登录', requestId });
    return { accessToken: session.token, refreshToken: session.refreshToken, expiresAt: session.expiresAt, user: session.user, requestId };
  }

  @Post('login')
  @HttpCode(200)
  async login(
    @Body() body: LoginDto,
    @Req() req: AuthRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    const requestId = resolveRequestId(req, res);
    res.setHeader('Cache-Control', 'no-store');
    await this.loginLimiter.consumeIp(req.socket?.remoteAddress ?? 'unknown');
    const session = await this.authService.login(body.username, body.password);
    if (!session) {
      throw new UnauthorizedException({
        code: 'AUTH_LOGIN_FAILED',
        message: '账号或密码错误',
        requestId,
      });
    }

    if ('mfaRequired' in session) {
      return { ...session, requestId };
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
    res.setHeader('Cache-Control', 'no-store');
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
    res.setHeader('Cache-Control', 'no-store');
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
