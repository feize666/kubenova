import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes, createHash } from 'crypto';
import type { AppConfig } from '../platform/config/env.schema';

const DEFAULT_ACCESS_EXPIRES_IN = '30m';

function parseDurationToMs(input: string): number {
  const value = input.trim();
  const matched = value.match(/^(\d+)([smhd])$/i);
  if (!matched) {
    return 30 * 60 * 1000;
  }

  const amount = Number(matched[1]);
  const unit = matched[2].toLowerCase();

  switch (unit) {
    case 's':
      return amount * 1000;
    case 'm':
      return amount * 60 * 1000;
    case 'h':
      return amount * 60 * 60 * 1000;
    case 'd':
      return amount * 24 * 60 * 60 * 1000;
    default:
      return 30 * 60 * 1000;
  }
}

@Injectable()
export class TokenService {
  constructor(private readonly configService: ConfigService<AppConfig>) {}

  createAccessToken(sessionId: string): string {
    return sessionId;
  }

  resolveSessionId(accessToken: string): string | null {
    const sessionId = accessToken.trim();
    return sessionId ? sessionId : null;
  }

  createRefreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  resolveAccessTokenExpiry(): Date {
    const expiresIn =
      this.configService.get<string>(
        'jwtExpiresIn',
        DEFAULT_ACCESS_EXPIRES_IN,
      ) ?? DEFAULT_ACCESS_EXPIRES_IN;
    const expiresMs = parseDurationToMs(expiresIn);
    return new Date(Date.now() + expiresMs);
  }
}
