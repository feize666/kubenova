import { validate } from 'class-validator';
import { MfaResetPrepareDto, MfaResetConfirmDto, MfaResetOidcExchangeDto } from './mfa-reset.dto';

describe('MFA reset request bounds', () => {
  const check = (values: object) => validate(Object.assign(new MfaResetPrepareDto(), values), { whitelist: true, forbidNonWhitelisted: true });
  const valid = { targetUserId: 'target', password: 'password' };
  it('accepts primary-only and paired factor requests', async () => {
    expect(await check(valid)).toEqual([]);
    expect(await check({ ...valid, code: '123456', method: 'totp' })).toEqual([]);
    expect(await check({ ...valid, code: 'recovery-code', method: 'recovery' })).toEqual([]);
  });
  it.each([
    { targetUserId: '' }, { targetUserId: ' target' }, { targetUserId: 'target ' },
    { targetUserId: 'x'.repeat(257) }, { password: null }, { password: 'x'.repeat(1025) },
    { code: '123456' }, { method: 'totp' }, { code: null, method: null },
    { code: 'x'.repeat(129), method: 'recovery' }, { code: '123456', method: 'other' },
    { actorUserId: 'forged' }, { targetAuthzVersion: 1 },
  ])('rejects malformed or client-supplied authority %j', async value => {
    expect((await check({ ...valid, ...value })).length).toBeGreaterThan(0);
  });
  it('bounds confirmation tokens and callback inputs', async () => {
    const confirm = Object.assign(new MfaResetConfirmDto(), { targetUserId: 'target', token: 'a'.repeat(43) });
    expect(await validate(confirm)).toEqual([]);
    confirm.token = 'short';
    expect((await validate(confirm)).length).toBeGreaterThan(0);
    const exchange = Object.assign(new MfaResetOidcExchangeDto(), { targetUserId: 'target', callbackUrl: 'x'.repeat(8193) });
    expect((await validate(exchange)).length).toBeGreaterThan(0);
  });
});
