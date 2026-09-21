import type { KubeConfig } from '@kubernetes/client-node';
import { request, type RequestOptions } from 'node:https';
import type { IncomingMessage, OutgoingHttpHeaders } from 'node:http';
import { classifyNativeRequest } from './native-request';

/** Internal transport only. Caller must authenticate, authorize and attach a revocable lease. */
export async function forwardNativeRead(config: KubeConfig, target: string, subject: string, signal: AbortSignal): Promise<IncomingMessage> {
  const resource = classifyNativeRequest('GET', target);
  if (resource.subresource === 'exec' || !/^kubenova:native:[a-f0-9]{40}$/.test(subject)) throw new Error('Unsupported native transport');
  const cluster = config.getCurrentCluster();
  if (!cluster || cluster.skipTLSVerify) throw new Error('Native upstream requires verified TLS');
  const endpoint = new URL(cluster.server);
  if (endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) throw new Error('Invalid native upstream');
  const upstream = new URL(endpoint.origin + endpoint.pathname.replace(/\/$/, '') + target);
  const options: RequestOptions = { method: 'GET', headers: {} };
  await config.applyToHTTPSOptions(options);
  signal.throwIfAborted();
  if (Array.isArray(options.headers)) throw new Error('Invalid upstream headers');
  const headers = (options.headers ?? {}) as OutgoingHttpHeaders;
  // Impersonation always comes from the server's grant identity, never the stored user or client.
  for (const key of Object.keys(headers)) if (key.toLowerCase().startsWith('impersonate-')) delete headers[key];
  headers['Impersonate-User'] = subject;
  headers.Accept = 'application/json';
  options.headers = headers;
  options.rejectUnauthorized = true;
  options.signal = signal;
  return new Promise((resolve, reject) => {
    const upstreamRequest = request(upstream, options, response => {
      clearTimeout(timer);
      if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
        response.destroy(); reject(new Error('Native upstream redirect denied')); return;
      }
      resolve(response);
    });
    const timer = setTimeout(() => upstreamRequest.destroy(new Error('Native upstream timeout')), 10000);
    timer.unref();
    upstreamRequest.once('error', () => { clearTimeout(timer); reject(new Error('Native upstream unavailable')); });
    upstreamRequest.end();
  });
}
