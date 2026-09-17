import nodemailer from 'nodemailer';
import { Socket } from 'node:net';
import { sendNotificationEmail } from './notification-email';

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));

describe('sendNotificationEmail', () => {
  const originalEnv = { ...process.env };
  const sendMail = jest.fn();
  const close = jest.fn();
  const expectSocketDestroyed = () => {
    const socket = (nodemailer.createTransport as jest.Mock).mock.calls[0][0].socket;
    expect(socket).toBeInstanceOf(Socket);
    expect(socket.destroyed).toBe(true);
  };
  beforeEach(() => {
    process.env = { ...originalEnv };
    for (const key of Object.keys(process.env)) if (key.startsWith('SMTP_')) delete process.env[key];
    Object.assign(process.env, { SMTP_HOST: 'smtp.example.com', SMTP_FROM: 'alerts@example.com' });
    jest.clearAllMocks();
    sendMail.mockResolvedValue({ accepted: ['ops@example.com'], rejected: [] });
    (nodemailer.createTransport as jest.Mock).mockReturnValue({ sendMail, close });
  });
  afterEach(() => { process.env = originalEnv; jest.useRealTimers(); });

  it('sends bounded plain text over verified TLS with an explicit envelope and closes', async () => {
    await sendNotificationEmail('ops@example.com', { title: 'Alert', message: '<not html>' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({
      host: 'smtp.example.com', port: 465, secure: true, requireTLS: true,
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
      disableFileAccess: true, disableUrlAccess: true,
    }));
    expect(sendMail).toHaveBeenCalledWith({ from: 'alerts@example.com', to: 'ops@example.com',
      envelope: { from: 'alerts@example.com', to: ['ops@example.com'] },
      subject: 'Alert', text: '<not html>', disableFileAccess: true, disableUrlAccess: true });
    expect(close).toHaveBeenCalledTimes(1);
    expectSocketDestroyed();
  });
  it('requires STARTTLS when implicit TLS is explicitly false', async () => {
    Object.assign(process.env, { SMTP_SECURE: 'false', SMTP_PORT: '587', SMTP_USER: 'account', SMTP_PASSWORD: 'secret' });
    await sendNotificationEmail('ops@example.com', { title: 'Alert', message: 'text' });
    expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true, port: 587, auth: { user: 'account', pass: 'secret' } }));
  });
  it.each([{ SMTP_SECURE: 'no' }, { SMTP_PORT: '0' }, { SMTP_PORT: '65536' }, { SMTP_PORT: '1.5' }, { SMTP_HOST: '' }, { SMTP_FROM: 'Name <a@example.com>' }, { SMTP_USER: 'alone' }, { SMTP_PASSWORD: 'alone' }])('rejects invalid settings %j without a connection', async (settings) => {
    Object.assign(process.env, settings);
    await expect(sendNotificationEmail('ops@example.com', { title: 'Alert', message: 'text' })).rejects.toThrow();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
  it.each([
    ['a@example.com,b@example.com', 'Alert', 'text'],
    ['ops@example.com', 'Alert\r\nBcc: secret', 'text'],
    ['ops@example.com', 'a'.repeat(257), 'text'],
    ['ops@example.com', 'Alert', 'a'.repeat(65537)],
  ])('rejects unsafe input before transport', async (recipient, title, message) => {
    await expect(sendNotificationEmail(recipient, { title, message })).rejects.toThrow();
    expect(nodemailer.createTransport).not.toHaveBeenCalled();
  });
  it.each([{ accepted: [], rejected: [] }, { accepted: ['other@example.com'], rejected: [] }, { accepted: ['ops@example.com'], rejected: ['ops@example.com'] }])('does not report success for unaccepted delivery %j', async (result) => {
    sendMail.mockResolvedValue(result);
    await expect(sendNotificationEmail('ops@example.com', { title: 'Alert', message: 'text' })).rejects.toThrow();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('sanitizes transport errors and closes', async () => {
    sendMail.mockRejectedValue(new Error('password=secret'));
    await expect(sendNotificationEmail('ops@example.com', { title: 'Alert', message: 'text' })).rejects.toThrow('Email notification delivery failed');
    expect(close).toHaveBeenCalledTimes(1);
    expectSocketDestroyed();
  });
  it('bounds total delivery time and closes a stalled transport', async () => {
    jest.useFakeTimers();
    sendMail.mockReturnValue(new Promise(() => {}));
    const result = expect(sendNotificationEmail('ops@example.com', { title: 'Alert', message: 'text' })).rejects.toThrow('Email notification delivery failed');
    await jest.advanceTimersByTimeAsync(5000);
    await result;
    expect(close).toHaveBeenCalledTimes(1);
    expectSocketDestroyed();
    expect(jest.getTimerCount()).toBe(0);
  });
});
