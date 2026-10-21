import { decryptUpdateSettings, encryptUpdateSettings } from './update-settings.crypto';

describe('update settings encryption', () => {
  const key = 'a'.repeat(64);

  it('rejects missing or malformed independent encryption keys', () => {
    expect(() => encryptUpdateSettings({ value: 1 }, '')).toThrow(/KUBENOVA_UPDATE_ENCRYPTION_KEY/);
    expect(() => encryptUpdateSettings({ value: 1 }, 'short')).toThrow(/64 hexadecimal/);
  });

  it('encrypts JSON settings and restores them only with the same key', () => {
    const value = { registry: { password: 'private-value' } };
    const encrypted = encryptUpdateSettings(value, key);

    expect(encrypted).not.toContain('private-value');
    expect(decryptUpdateSettings(encrypted, key)).toEqual(value);
    expect(() => decryptUpdateSettings(encrypted, 'b'.repeat(64))).toThrow();
  });

  it('rejects malformed and tampered ciphertext', () => {
    expect(() => decryptUpdateSettings('not-an-envelope', key)).toThrow(/ciphertext/);
    const encrypted = encryptUpdateSettings({ value: 1 }, key);
    expect(() => decryptUpdateSettings(encrypted.slice(0, -2) + 'xx', key)).toThrow();
  });
});
