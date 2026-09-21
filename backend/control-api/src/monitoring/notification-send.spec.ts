import { ObservabilityService } from './observability.service';
const mail = require('nodemailer');

describe('real alert notification transport', () => {
  it('delivers email template content through SMTP instead of HTTP', async () => {
    const saved = { ...process.env };
    process.env.SMTP_HOST = 'smtp.example.com';
    process.env.SMTP_FROM = 'sender@example.com';
    const sendMail = jest.fn().mockResolvedValue({ accepted: ['ops@example.com'], rejected: [] });
    const smtp = jest.spyOn(mail, 'createTransport').mockReturnValue({ sendMail, close: jest.fn() });
    try {
      const service = new ObservabilityService({} as never);
      const result = await service.sendNotification({ id: 'email', channel: 'email', endpoint: 'ops@example.com', bodyTemplate: '{"subject":"{{title}}","text":"Detail: {{message}}"}' }, { title: 'Recovered', message: 'Pod ready' });
      expect(result.success).toBe(true);
      expect(sendMail.mock.calls[0][0]).toMatchObject({ subject: 'Recovered', text: 'Detail: Pod ready' });
    } finally { smtp.mockRestore(); process.env = saved; }
  });
  it('sends actual alert content with safe JSON and existing transport controls', async () => {
    const service = new ObservabilityService({} as never);
    const fetchMock = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
    try {
      const result = await (service as any).sendNotification({ id: 'delivery', channel: 'slack', endpoint: 'https://notify.invalid', bodyTemplate: '{"text":"{{title}}: {{message}}"}' }, { title: 'Pod "broken"', message: 'line1\nline2' });
      expect(result.success).toBe(true);
      const options = fetchMock.mock.calls[0][1]!;
      expect(JSON.parse(options.body as string)).toEqual({ text: 'Pod "broken": line1\nline2' });
      expect(options.redirect).toBe('manual');
      expect(options.signal).toBeDefined();
    } finally { fetchMock.mockRestore(); }
  });
});
