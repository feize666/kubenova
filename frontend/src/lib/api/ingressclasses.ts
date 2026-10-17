import { apiRequest } from './client';

export interface IngressClassItem {
  name: string;
  controller: string;
  parameters?: { apiGroup?: string; kind: string; name: string; scope?: string; namespace?: string };
  isDefault: boolean;
  resourceVersion: string;
  createdAt?: string;
}
export interface IngressClassImpact {
  target: { name: string; resourceVersion: string };
  defaults: Array<{ name: string; resourceVersion: string }>;
  references: Array<{ name: string; namespace: string }>;
}
export function getIngressClasses(clusterId: string, token?: string, signal?: AbortSignal) {
  return apiRequest<{ items: IngressClassItem[] }>('/api/resources/ingressclasses', { query: { clusterId }, token, signal });
}
export function getIngressClassImpact(clusterId: string, name: string, token?: string) {
  return apiRequest<IngressClassImpact>('/api/resources/ingressclasses/impact', { query: { clusterId, name }, token });
}
export function setDefaultIngressClass(body: { clusterId: string; name: string; expected: Record<string, string>; dryRun: boolean }, token?: string) {
  return apiRequest<{ completed: string[] }>('/api/resources/ingressclasses/default', { method: 'POST', body, token });
}
export function removeIngressClass(body: { clusterId: string; name: string; resourceVersion: string; force: boolean }, token?: string) {
  return apiRequest('/api/resources/ingressclasses/delete', { method: 'POST', body, token });
}
