import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import request from 'supertest';
import { MfaResetController } from './mfa-reset.controller';
import { AuthService } from './auth.service';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { OidcProviderService } from './oidc-provider.service';

describe('reset HTTP guard and validation pipeline', () => {
  let app: INestApplication;
  const actor = { token: 'test-only', user: { id: 'fixture-owner' } };
  const auth = { validate: jest.fn(async (token: string) => token === 'test-only' ? actor : null),
    prepareMfaReset: jest.fn(async () => ({ token: 'a'.repeat(43), expiresIn: 300 })),
    confirmMfaReset: jest.fn(async () => ({ userId: 'fixture-target', mfaEnabled: false })) };
  const limiter = { consumeIp: jest.fn() };
  const oldOrigin = process.env.CORS_ORIGINS;
  beforeAll(async () => {
    process.env.CORS_ORIGINS = 'http://127.0.0.1:3000';
    const module = await Test.createTestingModule({ controllers: [MfaResetController], providers: [
      { provide: AuthService, useValue: auth }, { provide: LoginAttemptLimiter, useValue: limiter },
      { provide: ConfigService, useValue: new ConfigService() }, { provide: OidcProviderService, useValue: {} },
    ] }).compile();
    app = module.createNestApplication();
    await app.init();
  });
  beforeEach(() => jest.clearAllMocks());
  afterAll(async () => {
    await app?.close();
    if (oldOrigin === undefined) delete process.env.CORS_ORIGINS; else process.env.CORS_ORIGINS = oldOrigin;
  });
  const post = (path = 'prepare') => request(app.getHttpServer()).post(`/api/auth/mfa/reset/${path}`);
  it('rejects missing and invalid sessions via the actual guard', async () => {
    await post().send({}).expect(401);
    await post().set('Authorization', 'Bearer invalid').send({}).expect(401);
    expect(auth.prepareMfaReset).not.toHaveBeenCalled();
  });
  it.each([
    { targetUserId: 'fixture-target', password: 'test', actorUserId: 'forged' },
    { targetUserId: 'fixture-target', password: 'test', code: '123456' },
    { targetUserId: 'fixture-target', password: null },
    { targetUserId: ' fixture-target', password: 'test' },
  ])('rejects malformed JSON before service invocation %j', async body => {
    await post().set('Authorization', 'Bearer test-only').set('Origin', 'http://127.0.0.1:3000').send(body).expect(400);
    expect(auth.prepareMfaReset).not.toHaveBeenCalled();
  });
  it('rejects a foreign origin without preparing a proof', async () => {
    await post().set('Authorization', 'Bearer test-only').set('Origin', 'https://foreign.invalid')
      .send({ targetUserId: 'fixture-target', password: 'test' }).expect(401);
    expect(auth.prepareMfaReset).not.toHaveBeenCalled();
  });
  it('prepares and confirms with no-store headers through HTTP', async () => {
    const result = await post().set('Authorization', 'Bearer test-only').set('Origin', 'http://127.0.0.1:3000')
      .send({ targetUserId: 'fixture-target', password: 'test' }).expect(200).expect('Cache-Control', 'no-store');
    await post('confirm').set('Authorization', 'Bearer test-only').set('Origin', 'http://127.0.0.1:3000')
      .send({ targetUserId: 'fixture-target', token: result.body.token }).expect(200).expect('Cache-Control', 'no-store');
    expect(auth.confirmMfaReset).toHaveBeenCalledWith(actor, 'fixture-target', 'a'.repeat(43));
  });
});
