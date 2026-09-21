import { ForbiddenException } from '@nestjs/common';
import type { AuthorizationCapability } from '../common/authorization.service';

export const nativeReadResources: Readonly<Record<string, readonly string[]>> = {
  '/api/v1': ['pods', 'services', 'endpoints', 'configmaps', 'secrets', 'persistentvolumeclaims', 'events', 'resourcequotas', 'limitranges'],
  '/apis/apps/v1': ['deployments', 'replicasets', 'statefulsets', 'daemonsets'],
  '/apis/batch/v1': ['jobs', 'cronjobs'],
  '/apis/networking.k8s.io/v1': ['ingresses', 'networkpolicies'],
  '/apis/discovery.k8s.io/v1': ['endpointslices'],
  '/apis/autoscaling/v2': ['horizontalpodautoscalers'],
  '/apis/policy/v1': ['poddisruptionbudgets'],
};

/** Classifies only; identity, native capability and namespace UID checks remain mandatory. */
export function classifyNativeRequest(method: string, target: string) {
  const deny = (): never => { throw new ForbiddenException('Unsupported native request'); };
  if (typeof target !== 'string' || target.length > 16384 || !target.startsWith('/') || /[\s#\\]/.test(target)) return deny();
  const [pathname] = target.split('?');
  // Reject normalization ambiguities before URL parsing can erase them.
  if (pathname.includes('%') || pathname.includes('//')) return deny();
  const match = pathname.match(/^(\/api\/v1|\/apis\/[a-z0-9.-]+\/v[0-9]+(?:alpha[0-9]+|beta[0-9]+)?)\/namespaces\/([a-z0-9](?:[-a-z0-9]*[a-z0-9])?)\/([a-z]+)(?:\/([a-z0-9](?:[-a-z0-9.]*[a-z0-9])?))?(?:\/([a-z]+))?$/);
  if (!match) return deny();
  const [, api, namespace, resource, name, subresource] = match;
  if (namespace.length > 63 || (name && name.length > 253) || !nativeReadResources[api]?.includes(resource)) return deny();
  const query = new URL(target, 'https://native.invalid').searchParams;
  const watch = query.getAll('watch');
  if (watch.length > 1 || (watch.length && !['true', 'false', '1', '0'].includes(watch[0]))) return deny();
  let capability: AuthorizationCapability | undefined = resource === 'secrets' ? 'secrets' : undefined;
  let verb: 'get' | 'list' | 'watch' | 'create';
  if (subresource) {
    if (resource !== 'pods' || !name || watch.length) return deny();
    if (subresource === 'log' && method === 'GET') { capability = 'logs'; verb = 'get'; }
    else if (subresource === 'exec' && ['GET', 'POST'].includes(method)) { capability = 'exec'; verb = method === 'POST' ? 'create' : 'get'; }
    else return deny();
  } else {
    // Native writes remain gated until the workload admission boundary exists.
    if (method !== 'GET') return deny();
    verb = ['true', '1'].includes(watch[0]) ? 'watch' : name ? 'get' : 'list';
  }
  return { api, namespace, resource, name, subresource, verb, capability };
}
