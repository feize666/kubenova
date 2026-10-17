import { apiRequest } from './client';

export interface EditorSubmitPayload {
  clusterId: string;
  namespace?: string;
  operation: 'create'|'update';
  yaml: string;
  dryRun: boolean;
  identity?: { apiVersion: string; kind: string; name: string; namespace?: string; resource?: string };
  resourceVersion?: string;
}
export interface EditorSubmitResult {
  dryRun: boolean;
  items: Array<{apiVersion:string;kind:string;name:string;namespace:string;resourceVersion?:string;message:string}>;
  total: number;
  message: string;
}
export function submitResourceEditor(body: EditorSubmitPayload, token: string) {
  return apiRequest<EditorSubmitResult>('/api/resources/editor/submit',{method:'POST',body,token});
}
export function getResourceEditorSchema(query: {clusterId:string;apiVersion:string;kind:string;namespace?:string;resource?:string}, token:string, signal?:AbortSignal) {
  return apiRequest<{schema:Record<string,unknown>|null;source:'crd'|'openapi'|'unavailable';reason?:string}>('/api/resources/editor/schema',{query,token,signal});
}
