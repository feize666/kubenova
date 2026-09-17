import { BadRequestException } from '@nestjs/common';
import { validateNotificationEndpoint } from './notification-endpoint';

describe('validateNotificationEndpoint', () => {
  it('accepts one trimmed bare mailbox without changing its case', () => {
    expect(validateNotificationEndpoint('email', '  Ops+alerts@Example.com  ')).toBe('Ops+alerts@Example.com');
  });

  it.each([
    '', 'not-an-email', 'Ops <ops@example.com>',
    'ops@example.com,other@example.com', 'ops@example.com;other@example.com',
    'mailto:ops@example.com', '\nops@example.com', 'ops@example.com\r',
    'ops@example.com\r\nBcc: other@example.com',
    `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(62)}`,
  ])('rejects invalid or unsafe mailbox %j', (value) => {
    expect(() => validateNotificationEndpoint('email', value)).toThrow(BadRequestException);
  });

  it.each(['webhook', 'feishu', 'dingtalk', 'wecom', 'slack', 'pagerduty'])('preserves HTTP normalization for %s', (channel) => {
    expect(validateNotificationEndpoint(channel, ' https://example.com/hook/ ')).toBe('https://example.com/hook');
    expect(validateNotificationEndpoint(channel, 'http://localhost:8080/')).toBe('http://localhost:8080');
  });

  it.each(['', 'ops@example.com', 'smtp://example.com', 'https://user:password@example.com/hook', 'https://user@example.com/hook'])('rejects invalid webhook or URL credentials %j', (value) => {
    expect(() => validateNotificationEndpoint('webhook', value)).toThrow(BadRequestException);
  });
});
