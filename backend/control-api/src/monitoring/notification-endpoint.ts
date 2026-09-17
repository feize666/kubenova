import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';

const mailbox = z.string().max(254).email();

export function validateNotificationEndpoint(channel: string, value: string): string {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    throw new BadRequestException('通知地址必须是文本且不得包含换行符');
  }
  const text = value.trim();
  if (channel === 'email') {
    if (!mailbox.safeParse(text).success) {
      throw new BadRequestException('邮箱通知地址必须是单个有效邮箱，不支持显示名称或多个收件人');
    }
    return text;
  }
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    throw new BadRequestException('通知地址必须是合法 URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new BadRequestException('通知地址仅支持 HTTP/HTTPS');
  }
  if (parsed.username || parsed.password) {
    throw new BadRequestException('通知地址不得包含用户名或密码');
  }
  return text.replace(/\/$/, '');
}
