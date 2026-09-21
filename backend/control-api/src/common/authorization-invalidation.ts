import { Client } from 'pg';

/** One dedicated LISTEN connection. A disconnected instance never accepts new streams. */
export class AuthorizationInvalidation {
  private ready = false;
  private readonly streams = new Map<AbortController, string>();

  get available() { return this.ready; }

  private constructor(private readonly client: Client, private readonly schema: string) {
    client.on('error', () => this.invalidateAll());
    client.on('end', () => this.invalidateAll());
    client.on('notification', message => {
      if (message.channel !== 'kubenova_authorization') return;
      try {
        const event: unknown = JSON.parse(message.payload ?? '');
        if (!event || typeof event !== 'object' || !('schema' in event) || !('userId' in event)) throw Error();
        const value = event as { schema: unknown; userId: unknown };
        if (typeof value.schema !== 'string' || (value.userId !== null && typeof value.userId !== 'string')) throw Error();
        if (value.schema !== this.schema) return;
        for (const [controller, userId] of this.streams) {
          if (value.userId === null || value.userId === userId) controller.abort();
        }
      } catch { this.invalidateAll(); }
    });
  }

  static async connect(connectionString: string, schema = 'public') {
    const client = new Client({ connectionString, connectionTimeoutMillis: 5000, keepAlive: true });
    const listener = new AuthorizationInvalidation(client, schema);
    try {
      await client.connect();
      await client.query('LISTEN kubenova_authorization');
      listener.ready = true;
      return listener;
    } catch {
      await client.end().catch(() => {});
      throw new Error('Authorization notification channel unavailable');
    }
  }

  /** Register BEFORE the final live authorization check; dispose on every request exit. */
  register(userId: string, expiresAt: Date) {
    const delay = expiresAt.getTime() - Date.now();
    if (!this.ready || !userId || !Number.isFinite(delay) || delay <= 0) throw new Error('Authorization stream unavailable');
    const controller = new AbortController();
    this.streams.set(controller, userId);
    // Fail early instead of overflowing Node's timer range for a malformed long lease.
    const timer = setTimeout(() => controller.abort(), Math.min(delay, 2147483647));
    timer.unref();
    controller.signal.addEventListener('abort', () => { clearTimeout(timer); this.streams.delete(controller); }, { once: true });
    return { signal: controller.signal, close: () => controller.abort() };
  }

  private invalidateAll() {
    this.ready = false;
    for (const controller of this.streams.keys()) controller.abort();
  }

  async close() {
    this.invalidateAll();
    await this.client.end();
  }
}
