import { apiRequest } from './client';
import type { ResourceManifest } from '@/lib/resource-editor';

export interface AccessResourceList {
  kind: string;
  items: ResourceManifest[];
  incomplete: boolean;
  error?: string;
}
export interface ResourceAccessContext {
  workload: ResourceManifest;
  lists: AccessResourceList[];
  limit: number;
  canMutate: boolean;
}
export async function getResourceAccessContext(query: { clusterId: string; namespace: string; kind: string; name: string }, token: string, signal?: AbortSignal) {
  const deadline = AbortSignal.timeout(35_000);
  try {
    return await apiRequest<ResourceAccessContext>('/api/resources/access/context', { query, token, signal: signal ? AbortSignal.any([signal, deadline]) : deadline });
  } catch (error) {
    if (deadline.aborted && !signal?.aborted) throw new Error('访问资源读取超时，请检查集群连接后重试');
    throw error;
  }
}
