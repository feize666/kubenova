import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type Redis from 'ioredis';

export interface OidcTransaction {
  reauthentication?: OidcReauthentication;
  nonce: string;
  codeVerifier: string;
  issuer: string;
  clientId: string;
  redirectUri: string;
}

export type OidcReauthentication = {
  userId: string; sessionId: string; authzVersion: number; subject: string; requestedAt: number;
  // Existing enrollment callers may omit purpose; newly stored flows always set it.
  purpose?: 'enrollment' | 'mfa-reset';
  targetUserId?: string; targetAuthzVersion?: number; targetMfaVersion?: number;
};

export class OidcTransactionStore {
  constructor(private readonly redis: Pick<Redis, 'set' | 'getdel'> & Partial<Pick<Redis, 'disconnect'>>) {}

  onModuleDestroy(): void { this.redis.disconnect?.(); }

  private key(state: string, browserBinding: string): string {
    if (!/^[A-Za-z0-9_-]{43}$/.test(state) || !browserBinding) {
      throw new UnauthorizedException('Invalid OIDC login transaction');
    }
    const bindingHash = createHash('sha256').update(browserBinding).digest('hex');
    return `kubenova:oidc:transaction:${state}:${bindingHash}`;
  }

  async save(transaction: OidcTransaction, browserBinding: string): Promise<string> {
    const state = randomBytes(32).toString('base64url');
    const key = this.key(state, browserBinding);
    try {
      const result = await this.redis.set(key, JSON.stringify(transaction), 'EX', 300, 'NX');
      if (result !== 'OK') throw new Error('Transaction collision');
    } catch {
      throw new ServiceUnavailableException('OIDC login transaction storage unavailable');
    }
    return state;
  }

  async consume(state: string, browserBinding: string): Promise<OidcTransaction> {
    const key = this.key(state, browserBinding);
    let value: string | null;
    try {
      // Atomic removal prevents two concurrent callbacks from redeeming one login.
      value = await this.redis.getdel(key);
    } catch {
      throw new ServiceUnavailableException('OIDC login transaction storage unavailable');
    }
    if (!value) throw new UnauthorizedException('OIDC login transaction expired or already used');
    try {
      const transaction = JSON.parse(value) as OidcTransaction;
      if (!transaction || (['nonce', 'codeVerifier', 'issuer', 'clientId', 'redirectUri'] as const).some(field =>
        typeof transaction[field] !== 'string' || !transaction[field])) throw new Error('Invalid transaction');
      return transaction;
    } catch {
      throw new UnauthorizedException('Invalid OIDC login transaction');
    }
  }
}
