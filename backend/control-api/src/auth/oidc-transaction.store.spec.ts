import { ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { OidcTransactionStore } from './oidc-transaction.store';

describe('OIDC login transactions', () => {
  function setup() {
    const values = new Map<string, string>();
    const redis = {
      set: jest.fn(async (key: string, value: string) => {
        if (values.has(key)) return null;
        values.set(key, value);
        return 'OK';
      }),
      getdel: jest.fn(async (key: string) => {
        const value = values.get(key) ?? null;
        values.delete(key);
        return value;
      }),
    };
    return { store: new OidcTransactionStore(redis as never), redis };
  }
  const transaction = { nonce: 'nonce', codeVerifier: 'verifier', issuer: 'https://sso.example.test', clientId: 'console', redirectUri: 'https://console.example.test/callback' };
  it('binds the transaction to a browser and consumes it once', async () => {
    const { store } = setup();
    const state = await store.save(transaction, 'browser-secret');
    await expect(store.consume(state, 'another-browser')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(store.consume(state, 'browser-secret')).resolves.toEqual(transaction);
    await expect(store.consume(state, 'browser-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('expires stored transactions after five minutes without storing the browser secret', async () => {
    const { store, redis } = setup();
    await store.save(transaction, 'browser-secret');
    const [key, value, ...options] = redis.set.mock.calls[0] as unknown as unknown[];
    expect(String(key) + String(value)).not.toContain('browser-secret');
    expect(options).toEqual(['EX', 300, 'NX']);
  });
  it('rejects missing browser binding and invalid state', async () => {
    const { store, redis } = setup();
    await expect(store.save(transaction, '')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(store.consume('../bad', 'browser-secret')).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.getdel).not.toHaveBeenCalled();
  });
  it('fails closed without leaking storage error details', async () => {
    const { store, redis } = setup();
    redis.set.mockRejectedValue(new Error('redis://private-credential@internal'));
    const failure = await store.save(transaction, 'browser-secret').catch(error => error);
    expect(failure).toBeInstanceOf(ServiceUnavailableException);
    expect(failure.message).not.toContain('private-credential');
    redis.getdel.mockRejectedValue(new Error('private-storage-error'));
    await expect(store.consume('a'.repeat(43), 'browser-secret')).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
  it.each(['not-json', 'null', '{}', '{"nonce":123}'])('rejects corrupted stored transaction %#', async value => {
    const { store, redis } = setup();
    redis.getdel.mockResolvedValue(value);
    await expect(store.consume('a'.repeat(43), 'browser-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });
  it('rejects an expired or unknown transaction', async () => {
    const { store } = setup();
    await expect(store.consume('a'.repeat(43), 'browser-secret')).rejects.toBeInstanceOf(UnauthorizedException);
  });
});
