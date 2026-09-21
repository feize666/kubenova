import { Body, Controller, Get, Post, HttpCode, Req, Res, NotFoundException, UnauthorizedException, ServiceUnavailableException, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { OidcProviderService } from './oidc-provider.service';
import { AuthService, type ValidatedSession } from './auth.service';
import { AuthGuard } from '../common/auth.guard';
import { validatedEndpoint } from './oidc-flow.service';
const { parse } = require('cookie') as { parse: (header: string) => Record<string, string | undefined> };
const bindingCookie = 'kn_oidc_binding';
const enrollmentCookie = 'kn_oidc_enrollment_binding';
type AuthenticatedRequest = Request & { user?: ValidatedSession };

@Controller(['api/auth/oidc', 'api/v1/auth/oidc'])
export class OidcController {
  constructor(private readonly config: ConfigService, private readonly provider: OidcProviderService, private readonly auth: AuthService) {}

  @Get('status')
  status() {
    try {
      return { enabled: new URL(this.settings().redirectUri).pathname === '/login/oidc' };
    } catch {
      return { enabled: false };
    }
  }

  private settings() {
    if (this.config.get('oidcEnabled') !== true) throw new NotFoundException('OIDC unavailable');
    const issuer = this.config.get<string>('oidcIssuer');
    const clientId = this.config.get<string>('oidcClientId');
    const redirectUri = this.config.get<string>('oidcRedirectUri');
    if (!issuer || !clientId || !redirectUri) throw new NotFoundException('OIDC unavailable');
    const redirect = validatedEndpoint(redirectUri);
    if (!['/api/auth/oidc/callback', '/login/oidc'].includes(redirect.pathname) || redirect.search) throw new NotFoundException('OIDC callback configuration invalid');
    return { enabled: true, issuer, clientId, redirectUri };
  }

  @Post('enrollment/prepare')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async prepareEnrollment(@Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const settings = this.settings();
    if (request.headers.origin !== new URL(settings.redirectUri).origin || !request.user) throw new UnauthorizedException('Invalid OIDC browser origin');
    const context = await this.auth.oidcEnrollmentContext(request.user, settings.issuer, true);
    const binding = randomBytes(32).toString('base64url');
    let result: { url: string };
    try {
      result = await this.provider.startReauthentication(settings, process.env.OIDC_CLIENT_SECRET ?? '', binding, { ...context, requestedAt: Math.floor(Date.now() / 1000) });
    } catch { throw new ServiceUnavailableException('Enterprise reauthentication temporarily unavailable'); }
    response.cookie(enrollmentCookie, binding, { httpOnly: true, secure: new URL(settings.redirectUri).protocol === 'https:', sameSite: 'lax', path: '/api', maxAge: 300000 });
    return result;
  }

  @Post('enrollment/exchange')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  async exchangeEnrollment(@Body() body: { callbackUrl?: unknown }, @Req() request: AuthenticatedRequest, @Res({ passthrough: true }) response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const settings = this.settings();
    const redirect = new URL(settings.redirectUri);
    if (request.headers.origin !== redirect.origin || !request.user || typeof body?.callbackUrl !== 'string' || body.callbackUrl.length > 8192) throw new UnauthorizedException('Invalid OIDC browser exchange');
    let callback: URL;
    try { callback = new URL(body.callbackUrl); } catch { throw new UnauthorizedException('Invalid OIDC callback'); }
    const binding = parse(request.headers.cookie ?? '')[enrollmentCookie];
    response.clearCookie(enrollmentCookie, { path: '/api', httpOnly: true, secure: redirect.protocol === 'https:', sameSite: 'lax' });
    if (!binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new UnauthorizedException('OIDC browser binding missing');
    const context = await this.auth.oidcEnrollmentContext(request.user, settings.issuer);
    const identity = await this.provider.completeReauthentication(settings, process.env.OIDC_CLIENT_SECRET ?? '', callback, binding, context);
    if (identity.issuer !== settings.issuer || identity.subject !== context.subject) throw new UnauthorizedException('OIDC identity changed');
    return this.auth.finishOidcEnrollment(request.user, settings.issuer, context);
  }

  @Get('start')
  async start(@Res() response: Response) {
    response.redirect(await this.begin(response));
  }

  @Post('prepare')
  @HttpCode(200)
  async prepare(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    if (request.headers.origin !== new URL(this.settings().redirectUri).origin) throw new UnauthorizedException('Invalid OIDC browser origin');
    return { url: await this.begin(response) };
  }

  private async begin(response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const settings = this.settings();
    const binding = randomBytes(32).toString('base64url');
    let url: string;
    try {
      ({ url } = await this.provider.start(settings, process.env.OIDC_CLIENT_SECRET ?? '', binding));
    } catch {
      throw new ServiceUnavailableException('Enterprise login temporarily unavailable');
    }
    response.cookie(bindingCookie, binding, { httpOnly: true, secure: new URL(settings.redirectUri).protocol === 'https:', sameSite: 'lax', path: '/api', maxAge: 300000 });
    return url;
  }

  @Get('callback')
  async callback(@Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const settings = this.settings();
    const callback = new URL(settings.redirectUri);
    callback.search = new URL(request.originalUrl, callback.origin).search;
    return this.finish(callback, request, response);
  }

  @Post('exchange')
  @HttpCode(200)
  async exchange(@Body() body: { callbackUrl?: unknown }, @Req() request: Request, @Res({ passthrough: true }) response: Response) {
    const settings = this.settings();
    const redirect = new URL(settings.redirectUri);
    if (request.headers.origin !== redirect.origin || typeof body?.callbackUrl !== 'string' || body.callbackUrl.length > 8192) {
      throw new UnauthorizedException('Invalid OIDC browser exchange');
    }
    let callback: URL;
    try { callback = new URL(body.callbackUrl); }
    catch { throw new UnauthorizedException('Invalid OIDC callback'); }
    if (callback.origin !== redirect.origin || callback.pathname !== redirect.pathname) throw new UnauthorizedException('Invalid OIDC callback');
    return this.finish(callback, request, response);
  }

  private async finish(callback: URL, request: Request, response: Response) {
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('Referrer-Policy', 'no-referrer');
    const settings = this.settings();
    const binding = parse(request.headers.cookie ?? '')[bindingCookie];
    response.clearCookie(bindingCookie, { path: '/api', httpOnly: true, secure: new URL(settings.redirectUri).protocol === 'https:', sameSite: 'lax' });
    if (!binding || !/^[A-Za-z0-9_-]{43}$/.test(binding)) throw new UnauthorizedException('OIDC browser binding missing');
    const identity = await this.provider.complete(settings, process.env.OIDC_CLIENT_SECRET ?? '', callback, binding);
    const session = await this.auth.loginExternal(identity.issuer, identity.subject);
    if (!session) throw new UnauthorizedException('OIDC account unavailable');
    if ('mfaRequired' in session) return session;
    return { accessToken: session.token, refreshToken: session.refreshToken, expiresAt: session.expiresAt, user: session.user };
  }
}
