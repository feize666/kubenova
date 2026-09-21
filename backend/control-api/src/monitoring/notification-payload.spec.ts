import { BadRequestException } from '@nestjs/common';
import { renderNotificationPayload } from './notification-payload';

describe('notification JSON rendering', () => {
  it('escapes alert text without changing JSON structure or recursively replacing it', () => {
    const rendered = renderNotificationPayload('{"title":"{{ title }}","nested":[{"text":"Alert: {{message}}"}],"ok":true}', {
      title: 'Pod "broken"', message: 'line1\nline2\\path {{title}}',
    });
    expect(JSON.parse(rendered)).toEqual({ title: 'Pod "broken"', nested: [{ text: 'Alert: line1\nline2\\path {{title}}' }], ok: true });
  });
  it.each(['not-json', 'null', '42', '[]', '{"message":"{{unknown}}"}', '{"{{title}}":"value"}'])('rejects invalid or ambiguous template %s', body => {
    expect(() => renderNotificationPayload(body, { title: 't', message: 'm' })).toThrow(BadRequestException);
  });
  it('preserves dangerous-looking JSON keys as data', () => {
    expect(JSON.parse(renderNotificationPayload('{"__proto__":{"text":"{{message}}"}}', { title: 't', message: 'm' }))).toEqual(JSON.parse('{"__proto__":{"text":"m"}}'));
  });
  it('rejects excessive input before rendering', () => {
    expect(() => renderNotificationPayload(' '.repeat(65537), { title: 't', message: 'm' })).toThrow(BadRequestException);
    expect(() => renderNotificationPayload('{"text":"{{message}}"}', { title: 't', message: 'm'.repeat(65537) })).toThrow(BadRequestException);
  });
  it('bounds repeated placeholder expansion and nesting', () => {
    expect(() => renderNotificationPayload(JSON.stringify({ text: '{{message}}'.repeat(100) }), { title: 't', message: 'm'.repeat(65536) })).toThrow(BadRequestException);
    expect(() => renderNotificationPayload('{"a":'.repeat(34) + '0' + '}'.repeat(34), { title: 't', message: 'm' })).toThrow(BadRequestException);
  });
});
