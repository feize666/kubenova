import { request } from 'node:http';
import { isAbsolute } from 'node:path';

export function executorConfigured(): boolean {
  const token = process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN?.trim() ?? '';
  return token.length >= 32 && !/replace-with|change-me|placeholder/i.test(token) &&
    Boolean(process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET || process.env.KUBENOVA_UPDATE_EXECUTOR_URL);
}

// Host socket is preferred. Legacy HTTP is limited to loopback, never public TCP.
export async function executorRequest(path: string, body?: unknown): Promise<Response> {
  if (!executorConfigured()) throw new Error('未配置宿主机升级执行器');
  const socketPath = process.env.KUBENOVA_UPDATE_EXECUTOR_SOCKET;
  const url = socketPath ? undefined : new URL(process.env.KUBENOVA_UPDATE_EXECUTOR_URL!);
  if (socketPath && !isAbsolute(socketPath)) throw new Error('执行器 socket 必须使用绝对路径');
  if (url && (url.protocol !== 'http:' || !['127.0.0.1', '[::1]', 'localhost'].includes(url.hostname) || url.username || url.password || url.pathname !== '/'))
    throw new Error('执行器 HTTP 地址仅允许本机回环地址');
  return new Promise((resolve, reject) => {
    const req = request({
      ...(socketPath ? { socketPath } : { hostname: url!.hostname.replace(/^\[|\]$/g, ''), port: url!.port || 80 }),
      path, method: body === undefined ? 'GET' : 'POST',
      headers: { accept: 'application/json', 'content-type': 'application/json', authorization: 'Bearer ' + process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN!.trim() },
    }, res => {
      const chunks: Buffer[] = []; let size = 0;
      res.on('data', (chunk: Buffer) => {
        size += chunk.length;
        if (size > 256 * 1024) req.destroy(new Error('执行器响应过大'));
        else chunks.push(chunk);
      });
      res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks).toString('utf8'), { status: res.statusCode ?? 502 })));
    });
    const timer = setTimeout(() => req.destroy(new Error('执行器响应超时')), 10_000);
    req.once('close', () => clearTimeout(timer));
    req.once('error', reject);
    req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}
