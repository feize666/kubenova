import { createServer } from 'node:http';
import { once } from 'node:events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { executorConfigured, executorRequest } from './executor-request';

describe('private update executor transport', () => {
  const saved = { ...process.env };
  afterEach(() => { process.env = { ...saved }; });
  it('refuses missing credentials and non-local endpoints', async () => {
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN;
    expect(executorConfigured()).toBe(false);
    await expect(executorRequest('/status')).rejects.toThrow();
    process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN = 'a'.repeat(64);
    delete process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
    process.env.KUBENOVA_UPDATE_EXECUTOR_URL = 'http://example.com';
    await expect(executorRequest('/status')).rejects.toThrow('回环');
  });
  it('uses authenticated Unix socket requests and does not follow redirects', async () => {
    // Socket paths must fit macOS sockaddr_un; files stay inside project tmp.
    const parent = path.resolve(__dirname, '../../../..', 'tmp');
    await fs.mkdir(parent, { recursive: true });
    const dir = await fs.mkdtemp(path.join(parent, 'api-up-'));
    const socket = path.join(dir, 's');
    const server = createServer((req, res) => {
      expect(req.headers.authorization).toBe('Bearer ' + 'a'.repeat(64));
      res.writeHead(302, { location: 'http://example.com/private' }); res.end('{}');
    });
    server.listen(socket); await once(server, 'listening');
    try {
      process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET = socket;
      process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN = 'a'.repeat(64);
      const response = await executorRequest('/status');
      expect(response.status).toBe(302);
    } finally {
      await new Promise<void>(resolve => server.close(() => resolve()));
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
