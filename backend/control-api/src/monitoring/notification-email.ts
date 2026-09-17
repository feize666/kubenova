import { validateNotificationEndpoint } from './notification-endpoint';

const nodemailer = require('nodemailer') as {
  createTransport(options: Record<string, unknown>): {
    sendMail(message: Record<string, unknown>): Promise<{ accepted: string[]; rejected: string[] }>;
    close(): void;
  };
};

export async function sendNotificationEmail(
  recipient: string,
  values: { title: string; message: string },
): Promise<void> {
  let transport: ReturnType<typeof nodemailer.createTransport> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const to = validateNotificationEndpoint('email', recipient);
    const from = validateNotificationEndpoint('email', process.env.SMTP_FROM ?? '');
    const host = process.env.SMTP_HOST ?? '';
    const portText = process.env.SMTP_PORT ?? '465';
    const port = Number(portText);
    const secure = process.env.SMTP_SECURE ?? 'true';
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASSWORD;
    if (!host || host.length > 253 || /[\s\x00-\x1f\x7f/]/.test(host)
      || !/^\d+$/.test(portText) || port < 1 || port > 65535
      || !['true', 'false'].includes(secure) || Boolean(user) !== Boolean(pass)
      || typeof values?.title !== 'string' || values.title.length > 256 || /[\r\n]/.test(values.title)
      || typeof values?.message !== 'string' || Buffer.byteLength(values.message, 'utf8') > 65536) {
      throw new Error('Invalid email configuration or input');
    }
    transport = nodemailer.createTransport({
      host, port, secure: secure === 'true', requireTLS: true,
      ...(user && pass ? { auth: { user, pass } } : {}),
      tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
      connectionTimeout: 5000, greetingTimeout: 5000, socketTimeout: 5000,
      disableFileAccess: true, disableUrlAccess: true,
    });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Email timeout')), 5000);
    });
    const result = await Promise.race([
      transport.sendMail({
        from, to, envelope: { from, to: [to] }, subject: values.title, text: values.message,
        disableFileAccess: true, disableUrlAccess: true,
      }),
      timeout,
    ]);
    if (!result.accepted?.includes(to) || result.rejected?.length) {
      throw new Error('Email recipient not accepted');
    }
  } catch {
    throw new Error('Email notification delivery failed');
  } finally {
    if (timer) clearTimeout(timer);
    try { transport?.close(); } catch { /* Transport errors must not expose SMTP credentials. */ }
  }
}
