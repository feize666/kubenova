import type { ResourceManifest } from '@/lib/resource-editor';

export const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const array = (value: unknown): Record<string, unknown>[] => Array.isArray(value) ? value.map(object) : [];
export const strings = (value: unknown): Record<string, string> => Object.fromEntries(Object.entries(object(value)).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
const volatile = /(^|\/)(pod-template-hash|controller-uid|job-name|revision|version)$|controller-revision-hash/;
export function template(workload: ResourceManifest) {
  const spec = object(workload.spec);
  return workload.kind === 'Pod' ? workload : workload.kind === 'CronJob' ? object(object(object(spec.jobTemplate).spec).template) : object(spec.template);
}
export function stableSelector(workload: ResourceManifest): Record<string, string> {
  const selector = object(object(workload.spec).selector);
  const labels = workload.kind === 'Pod' || workload.kind === 'CronJob' ? strings(object(template(workload).metadata).labels) : strings(selector.matchLabels);
  return Object.fromEntries(Object.entries(labels).filter(([key]) => !volatile.test(key)));
}
export function matchesSelector(labels: Record<string, string>, selector: unknown): boolean {
  const raw = object(selector);
  const labelsMap = strings(raw.matchLabels ?? raw);
  const expressions = array(raw.matchExpressions);
  if (!Object.keys(labelsMap).length && !expressions.length) return false;
  return Object.entries(labelsMap).every(([key, value]) => labels[key] === value) && expressions.every(({ key, operator, values }) => {
    const name = String(key), choices = Array.isArray(values) ? values : [];
    return operator === 'In' ? name in labels && choices.includes(labels[name]) : operator === 'NotIn' ? !choices.includes(labels[name]) : operator === 'Exists' ? name in labels : operator === 'DoesNotExist' ? !(name in labels) : false;
  });
}
export function belongsToWorkload(pod: ResourceManifest, workload: ResourceManifest, resources: ResourceManifest[]): boolean {
  if (workload.metadata.namespace !== pod.metadata.namespace) return false;
  if (workload.kind === 'Pod') return workload.metadata.uid ? workload.metadata.uid === pod.metadata.uid : workload.metadata.name === pod.metadata.name;
  const target = String(workload.metadata.uid ?? '');
  const visited = new Set<string>();
  const matchesOwner = (ref: Record<string, unknown>, resource: ResourceManifest, namespace: unknown): boolean =>
    resource.metadata.namespace === namespace && ref.kind === resource.kind &&
    ref.name === resource.metadata.name && ref.uid === resource.metadata.uid;
  const followsOwner = (item: ResourceManifest): boolean => array(item.metadata.ownerReferences).some(ref => {
    const uid = String(ref.uid ?? '');
    if (uid && uid === target && matchesOwner(ref, workload, item.metadata.namespace)) return true;
    if (!uid || visited.has(uid)) return false;
    visited.add(uid);
    const owner = resources.find(resource => matchesOwner(ref, resource, item.metadata.namespace));
    return !!owner && followsOwner(owner);
  });
  if (target && followsOwner(pod)) return true;
  // Selectors are the Kubernetes membership rule; CronJob membership needs owners.
  return workload.kind !== 'CronJob' && matchesSelector(strings(pod.metadata.labels), object(workload.spec).selector);
}
export function relatedServices(workload: ResourceManifest, services: ResourceManifest[], pods: ResourceManifest[], resources: ResourceManifest[], endpoints: ResourceManifest[]) {
  const ownedPods = pods.filter(pod => belongsToWorkload(pod, workload, resources));
  const templateLabels = strings(object(template(workload).metadata).labels);
  return services.filter(service => {
    if (service.metadata.namespace !== workload.metadata.namespace || object(service.spec).type === 'ExternalName') return false;
    const selector = strings(object(service.spec).selector);
    if (Object.keys(selector).length) return matchesSelector(templateLabels, selector) || ownedPods.some(pod => matchesSelector(strings(pod.metadata.labels), selector));
    return endpoints.filter(ep => ep.metadata.namespace === service.metadata.namespace && (ep.kind === 'Endpoints' ? ep.metadata.name === service.metadata.name : strings(ep.metadata.labels)['kubernetes.io/service-name'] === service.metadata.name)).some(ep => {
      const refs = ep.kind === 'Endpoints' ? array(ep.subsets).flatMap(subset => [...array(subset.addresses), ...array(subset.notReadyAddresses)]) : array(ep.endpoints);
      return refs.some(row => { const ref = object(row.targetRef); return ref.kind === 'Pod' && ownedPods.some(pod => ref.uid ? ref.uid === pod.metadata.uid : ref.name === pod.metadata.name && (!ref.namespace || ref.namespace === pod.metadata.namespace)); });
    });
  });
}
export function ingressServices(ingress: ResourceManifest): string[] {
  const spec = object(ingress.spec);
  return [...new Set([object(object(spec.defaultBackend).service).name, ...array(spec.rules).flatMap(rule => array(object(rule.http).paths).map(path => object(object(path.backend).service).name))].filter((name): name is string => typeof name === 'string'))];
}
export function selectorImpact(selector: Record<string, string>, pods: ResourceManifest[], workloads: ResourceManifest[]) {
  const matchedPods = pods.filter(pod => matchesSelector(strings(pod.metadata.labels), selector));
  const matchedWorkloads = workloads.filter(workload => workload.kind !== 'Pod' && (matchesSelector(strings(object(template(workload).metadata).labels), selector) || matchedPods.some(pod => belongsToWorkload(pod, workload, workloads))));
  return { pods: matchedPods, workloads: matchedWorkloads };
}
export function createServiceDraft(workload: ResourceManifest): ResourceManifest {
  const containers = array(object(template(workload).spec).containers);
  const ports = containers.flatMap(container => array(container.ports)).filter(port => Number.isInteger(port.containerPort)).map((port, index) => ({ name: String(port.name || 'port-' + (index + 1)), protocol: port.protocol || 'TCP', port: port.containerPort, targetPort: port.name || port.containerPort }));
  return { apiVersion: 'v1', kind: 'Service', metadata: { name: String(workload.metadata.name) + '-svc', namespace: workload.metadata.namespace }, spec: { type: 'ClusterIP', selector: stableSelector(workload), ports: ports.length ? ports : [{ name: 'http', port: 80, targetPort: 80, protocol: 'TCP' }] } };
}
export function serviceAddresses(service: ResourceManifest) {
  const spec = object(service.spec), status = object(service.status), name = service.metadata.name, ns = service.metadata.namespace;
  const hosts = spec.type === 'ExternalName' ? [String(spec.externalName || '')] : [String(name) + '.' + String(ns) + '.svc', ...array(object(status.loadBalancer).ingress).map(item => String(item.hostname || item.ip || ''))];
  return hosts.filter(Boolean).flatMap(host => array(spec.ports).map(port => {
    const http = port.protocol !== 'UDP' && /^(https?|https?-\w+)$/.test(String(port.name || ''));
    const protocol = String(port.name).startsWith('https') ? 'https' : 'http';
    const address = http ? `${protocol}://${host}:${port.port}` : `${host}:${port.port}/${port.protocol || 'TCP'}`;
    return { address, open: http && !host.endsWith('.svc'), internal: host.endsWith('.svc') };
  }));
}
