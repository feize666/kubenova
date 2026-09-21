import { ValidationPipe } from '@nestjs/common';
import { MfaVerifyDto } from './mfa-verify.dto';

describe('MFA request validation', () => {
  const pipe = new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true });
  const valid = { challengeToken: 'a'.repeat(43), code: '123456', method: 'totp' };
  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: MfaVerifyDto });
  it.each([
    null, {}, { ...valid, challengeToken: 'short' }, { ...valid, challengeToken: '/'.repeat(43) },
    { ...valid, code: '' }, { ...valid, code: 'x'.repeat(129) }, { ...valid, code: 123456 },
    { ...valid, method: 'password' }, { ...valid, userId: 'admin' },
  ])('rejects malformed or extra fields: %p', async body => {
    await expect(validate(body)).rejects.toMatchObject({ status: 400 });
  });
  it.each(['totp', 'recovery'])('accepts the supported %s method', async method => {
    await expect(validate({ ...valid, method })).resolves.toMatchObject({ ...valid, method });
  });
});
