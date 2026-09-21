import { Body, Controller, HttpCode, Post, Req, Res, UnauthorizedException, UseGuards, UsePipes, ValidationPipe } from '@nestjs/common';
import type { Request, Response } from 'express';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'node:crypto';
import { OidcProviderService } from './oidc-provider.service';
import { validatedEndpoint } from './oidc-flow.service';
import { AuthGuard } from '../common/auth.guard';
import { AuthService, type ValidatedSession } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { MfaResetConfirmDto, MfaResetPrepareDto, MfaResetTargetDto, MfaResetOidcExchangeDto } from './dto/mfa-reset.dto';

const { parse } = require('cookie') as { parse: (value: string) => Record<string, string | undefined> };
const resetCookie = 'kn_oidc_reset_binding';

type ResetRequest = Request & { user?: ValidatedSession };

@Controller(['api/auth/mfa/reset', 'api/v1/auth/mfa/reset'])
@UseGuards(AuthGuard)
@UsePipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }))
export class MfaResetController {
  constructor(private readonly auth: AuthService, private readonly limiter: LoginAttemptLimiter,
    private readonly config: ConfigService, private readonly provider: OidcProviderService) {}

  private oidcSettings(origin: string | undefined) {
    const issuer = this.config.get<string>('oidcIssuer');
    const clientId = this.config.get<string>('oidcClientId');
    const redirectUri = this.config.get<string>('oidcRedirectUri');
    if (this.config.get('oidcEnabled') !== true || !issuer || !clientId || !redirectUri) throw new UnauthorizedException('OIDC reset unavailable');
    const redirect = validatedEndpoint(redirectUri);
    if (redirect.pathname !== '/login/oidc' || redirect.search || redirect.origin !== origin) throw new UnauthorizedException('Invalid OIDC reset origin');
    return { enabled: true, issuer, clientId, redirectUri };
  }

  @Post('oidc/prepare')
  @HttpCode(200)
  async prepareOidc(@Body() body: MfaResetTargetDto, @Req() request: ResetRequest, @Res({ passthrough: true }) response: Response) {
    const actor = await this.authorizeRequest(request, response);
    const settings = this.oidcSettings(request.headers.origin);
    const context = await this.auth.oidcMfaResetContext(actor, body.targetUserId, settings.issuer, true);
    const binding = randomBytes(32).toString('base64url');
    const result = await this.provider.startReauthentication(settings, process.env.OIDC_CLIENT_SECRET ?? '', binding,
      { ...context, requestedAt: Math.floor(Date.now() / 1000) });
    response.cookie(resetCookie, binding, { httpOnly: true, secure: new URL(settings.redirectUri).protocol === 'https:', sameSite: 'lax', path: '/api', maxAge: 300000 });
    return result;
  }

  @Post('oidc/exchange')
  @HttpCode(200)
  async exchangeOidc(@Body() body: MfaResetOidcExchangeDto, @Req() request: ResetRequest, @Res({ passthrough: true }) response: Response) {
    const actor = await this.authorizeRequest(request, response);
    const settings = this.oidcSettings(request.headers.origin);
    const redirect = new URL(settings.redirectUri);
    const binding = parse(request.headers.cookie ?? '')[resetCookie];
    response.clearCookie(resetCookie, { path: '/api', httpOnly: true, secure: redirect.protocol === 'https:', sameSite: 'lax' });
    if (!binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new UnauthorizedException('Missing reset browser binding');
    let callback: URL;
    try { callback = new URL(body.callbackUrl); } catch { throw new UnauthorizedException('Invalid reset callback'); }
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname || callback.hash || callback.username || callback.password) throw new UnauthorizedException('Invalid reset callback');
    return this.auth.finishOidcMfaReset(actor, body.targetUserId, settings, process.env.OIDC_CLIENT_SECRET ?? '', callback, binding,
      body.code !== undefined && body.method !== undefined ? { code: body.code, method: body.method } : undefined);
  }

  private async authorizeRequest(request: ResetRequest, response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000').split(',').map(value => value.trim()).filter(Boolean);
    if (!request.user || typeof request.headers.origin !== 'string' || !origins.includes(request.headers.origin)) {
      throw new UnauthorizedException('Invalid reset request origin');
    }
    await this.limiter.consumeIp(request.socket.remoteAddress ?? 'unknown');
    return request.user;
  }

  @Post('prepare')
  @HttpCode(200)
  async prepare(@Body() body: MfaResetPrepareDto, @Req() request: ResetRequest, @Res({ passthrough: true }) response: Response) {
    const actor = await this.authorizeRequest(request, response);
    return this.auth.prepareMfaReset(actor, body.targetUserId, body.password,
      body.code !== undefined && body.method !== undefined ? { code: body.code, method: body.method } : undefined);
  }

  @Post('confirm')
  @HttpCode(200)
  async confirm(@Body() body: MfaResetConfirmDto, @Req() request: ResetRequest, @Res({ passthrough: true }) response: Response) {
    const actor = await this.authorizeRequest(request, response);
    return this.auth.confirmMfaReset(actor, body.targetUserId, body.token);
  }
}
