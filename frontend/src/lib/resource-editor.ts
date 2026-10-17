import { dump, JSON_SCHEMA, loadAll } from 'js-yaml';

export interface ResourceManifest {
  apiVersion: string;
  kind: string;
  metadata: { name?: string; namespace?: string; resourceVersion?: string; [key: string]: unknown };
  [key: string]: unknown;
}
export interface ResourceFormProps {
  value: ResourceManifest;
  onChange: (value: ResourceManifest) => void;
  mode: 'create' | 'edit';
  disabled?: boolean;
  step?: number;
  clusterId?: string;
  token?: string;
}
export const WORKLOAD_KINDS = new Set(['Deployment','StatefulSet','DaemonSet','ReplicaSet','Pod','Job','CronJob']);
const definitions: Array<[string,string,string,string,boolean?]> = [
  ['Deployment','apps/v1','deployments','workloads/deployments'],
  ['StatefulSet','apps/v1','statefulsets','workloads/statefulsets'],
  ['DaemonSet','apps/v1','daemonsets','workloads/daemonsets'],
  ['ReplicaSet','apps/v1','replicasets','workloads/replicasets'],
  ['Pod','v1','pods','workloads/pods'],['Job','batch/v1','jobs','workloads/jobs'],['CronJob','batch/v1','cronjobs','workloads/cronjobs'],
  ['Service','v1','services','network/services'],['Ingress','networking.k8s.io/v1','ingresses','network/ingress'],
  ['IngressClass','networking.k8s.io/v1','ingressclasses','network/ingressclasses',false],
  ['Endpoints','v1','endpoints','network/endpoints'],['EndpointSlice','discovery.k8s.io/v1','endpointslices','network/endpointslices'],
  ['NetworkPolicy','networking.k8s.io/v1','networkpolicies','network/networkpolicy'],
  ['PersistentVolume','v1','persistentvolumes','storage/pv',false],['PersistentVolumeClaim','v1','persistentvolumeclaims','storage/pvc'],
  ['StorageClass','storage.k8s.io/v1','storageclasses','storage/sc',false],
  ['ConfigMap','v1','configmaps','configs/configmaps'],['Secret','v1','secrets','configs/secrets'],['ServiceAccount','v1','serviceaccounts','configs/serviceaccounts'],
  ['Namespace','v1','namespaces','namespaces',false],['ResourceQuota','v1','resourcequotas','configs/resourcequotas'],['LimitRange','v1','limitranges','configs/limitranges'],
  ['Role','rbac.authorization.k8s.io/v1','roles','users/rbac'],['RoleBinding','rbac.authorization.k8s.io/v1','rolebindings','users/rbac'],
  ['ClusterRole','rbac.authorization.k8s.io/v1','clusterroles','users/rbac',false],['ClusterRoleBinding','rbac.authorization.k8s.io/v1','clusterrolebindings','users/rbac',false],
  ['HorizontalPodAutoscaler','autoscaling/v2','horizontalpodautoscalers','workloads/autoscaling/hpa'],
  ['VerticalPodAutoscaler','autoscaling.k8s.io/v1','verticalpodautoscalers','workloads/autoscaling/vpa'],
  ['Gateway','gateway.networking.k8s.io/v1','gateways','network/gateway-api'],['GatewayClass','gateway.networking.k8s.io/v1','gatewayclasses','network/gateway-api',false],
  ['HTTPRoute','gateway.networking.k8s.io/v1','httproutes','network/gateway-api'],
];
export const RESOURCE_EDITOR_TYPES = definitions.map(([kind,apiVersion,resource,path,namespaced=true])=>({kind,apiVersion,resource,path,namespaced}));
export function editorResourceType(kind: string) {
  const aliases: Record<string,string> = {pv:'PersistentVolume',pvc:'PersistentVolumeClaim',sc:'StorageClass',hpa:'HorizontalPodAutoscaler',vpa:'VerticalPodAutoscaler'};
  const normalized = (aliases[kind.toLowerCase()] ?? kind).toLowerCase();
  return RESOURCE_EDITOR_TYPES.find(item=>item.kind.toLowerCase()===normalized || item.resource.toLowerCase()===normalized);
}
export function resourceTypeForPath(path: string) {
  const clean = path.replace(/^\/clusters\/[^/]+\//,'/').replace(/^\//,'');
  return RESOURCE_EDITOR_TYPES.find(item=>item.path===clean);
}
export function getManifestValue(value: unknown, path: readonly (string|number)[]): unknown {
  return path.reduce<unknown>((current,key)=>current && typeof current==='object' ? (current as Record<string|number,unknown>)[key] : undefined, value);
}
export function setManifestValue(value: ResourceManifest, path: readonly (string|number)[], next: unknown): ResourceManifest {
  if (!path.length) throw new Error('修改路径不能为空');
  if (path.some(key=>['__proto__','prototype','constructor'].includes(String(key)))) throw new Error('不安全的字段路径');
  function update(current: unknown, index: number): unknown {
    const key = path[index];
    const copy: Record<string|number,unknown> | unknown[] = Array.isArray(current) ? [...current] : {...(current && typeof current==='object' ? current : {})};
    if (index===path.length-1) {
      if (next===undefined) {
        if (Array.isArray(copy) && typeof key==='number') copy.splice(key,1);
        else delete (copy as Record<string|number,unknown>)[key];
      } else (copy as Record<string|number,unknown>)[key] = next;
    } else {
      const child = getManifestValue(current,[key]) ?? (typeof path[index+1]==='number' ? [] : {});
      (copy as Record<string|number,unknown>)[key] = update(child,index+1);
    }
    return copy;
  }
  return update(value,0) as ResourceManifest;
}
function assertSerializable(value: unknown, ancestors = new Set<unknown>(), depth=0) {
  if (!value || typeof value!=='object') return;
  if (depth>60 || ancestors.has(value)) throw new Error('YAML 包含循环引用或过深嵌套');
  ancestors.add(value);
  for (const [key,child] of Object.entries(value)) {
    if (['__proto__','constructor','prototype'].includes(key)) throw new Error('YAML 包含不安全的字段');
    assertSerializable(child,ancestors,depth+1);
  }
  ancestors.delete(value);
}
export function parseResourceDocuments(yaml: string): ResourceManifest[] {
  if (yaml.length>2_000_000) throw new Error('YAML 超过 2MB，请拆分资源后提交');
  const documents = loadAll(yaml,undefined,{schema:JSON_SCHEMA}).filter(value=>value!==null && value!==undefined);
  if (!documents.length) throw new Error('请输入资源 YAML');
  return documents.map((value,index)=>{
    assertSerializable(value);
    if (!value || typeof value!=='object' || Array.isArray(value)) throw new Error('第 '+(index+1)+' 个文档不是资源对象');
    const resource = value as ResourceManifest;
    if (typeof resource.apiVersion!=='string' || typeof resource.kind!=='string' || !resource.metadata || typeof resource.metadata!=='object' || Array.isArray(resource.metadata)) throw new Error('第 '+(index+1)+' 个文档缺少 apiVersion、kind 或 metadata');
    return resource;
  });
}
export function serializeResourceDocuments(documents: ResourceManifest[]): string {
  return documents.map(value=>dump(value,{noRefs:true,lineWidth:-1,sortKeys:false,noCompatMode:true})).join('---\n');
}
export function sanitizeResourceManifest(resource: ResourceManifest, mode:'create'|'edit'): ResourceManifest {
  const copy = structuredClone(resource);
  delete copy.status;
  for (const key of ['managedFields','creationTimestamp','deletionTimestamp','deletionGracePeriodSeconds','generation','selfLink']) delete copy.metadata[key];
  if (mode==='create') {
    delete copy.metadata.uid;
    delete copy.metadata.resourceVersion;
  }
  return copy;
}
export function resourceFingerprint(value: unknown): string {
  function stable(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(stable);
    if (input && typeof input==='object') return Object.fromEntries(Object.entries(input).filter(([,child])=>child!==undefined).sort(([a],[b])=>a.localeCompare(b)).map(([key,child])=>[key,stable(child)]));
    return input;
  }
  return JSON.stringify(stable(value));
}
export function validateResourceDraft(documents: ResourceManifest[], mode:'create'|'edit', original?: ResourceManifest, expectedKind?: string): string[] {
  const errors: string[] = [];
  if (mode==='edit' && (documents.length!==1 || !original)) errors.push('编辑必须有且仅有一个已加载的资源');
  const seen = new Set<string>();
  for (const [index,resource] of documents.entries()) {
    const label = '文档 '+(index+1)+'：';
    if (expectedKind && resource.kind !== expectedKind) errors.push(label+'当前入口仅支持 '+expectedKind+'，不能提交 '+resource.kind+'；伴生资源请使用专用向导');
    if (typeof resource.metadata.name!=='string' || !resource.metadata.name.trim()) errors.push(label+'metadata.name 必须是非空文本');
    if (resource.metadata.namespace!==undefined && typeof resource.metadata.namespace!=='string') errors.push(label+'metadata.namespace 必须是文本');
    if (resource.metadata.resourceVersion!==undefined && typeof resource.metadata.resourceVersion!=='string') errors.push(label+'metadata.resourceVersion 必须是文本');
    if (!resource.apiVersion.trim() || !resource.kind.trim()) errors.push(label+'apiVersion 和 kind 不能为空');
    const key = [resource.apiVersion,resource.kind,resource.metadata.namespace??'',resource.metadata.name].join('/');
    if (seen.has(key)) errors.push(label+'同一个资源不能重复提交');
    seen.add(key);
    if (mode==='edit' && original) {
      for (const path of [['apiVersion'],['kind'],['metadata','name'],['metadata','namespace'],['metadata','resourceVersion']]) {
        if ((getManifestValue(resource,path)??'')!==(getManifestValue(original,path)??'')) errors.push(label+path.join('.')+' 编辑时不可改变');
      }
      if (!original.metadata.resourceVersion) errors.push(label+'缺少 resourceVersion，请重新加载资源');
    }
    if (resource.kind==='Secret') {
      for (const block of ['data','stringData']) for (const value of Object.values((resource[block] as Record<string,unknown>)??{})) {
        if (typeof value==='string' && /^(\*{4,}|\[REDACTED\]|<redacted>)$/i.test(value)) errors.push(label+'请勿提交 Secret 脱敏占位符');
      }
    }
    if (WORKLOAD_KINDS.has(resource.kind)) {
      const path = resource.kind==='Pod' ? ['spec','containers'] : resource.kind==='CronJob' ? ['spec','jobTemplate','spec','template','spec','containers'] : ['spec','template','spec','containers'];
      const containers = getManifestValue(resource,path);
      if (!Array.isArray(containers) || !containers.length) errors.push(label+'至少需要一个容器');
      else for (const container of containers) if (!container?.name || !container?.image) errors.push(label+'容器名称和镜像不能为空');
    }
  }
  return errors;
}
export interface ResourceChange { path: string; operation:'add'|'remove'|'change'; before: string; after: string }
/** Apply only the user's changes to the latest object; never overwrite concurrent edits. */
export function rebaseResourceDraft(original:ResourceManifest,draft:ResourceManifest,latest:ResourceManifest,choices:Record<string,'draft'|'server'>={}) {
  let merged=structuredClone(latest);
  const conflicts:string[]=[];
  const conflictFields:Array<{key:string;path:string}>=[];
  function visit(before:unknown,after:unknown,path:string[]) {
    if (path.join('.')==='metadata.resourceVersion' || resourceFingerprint(before)===resourceFingerprint(after)) return;
    const objectBefore=before&&typeof before==='object'&&!Array.isArray(before);
    const objectAfter=after&&typeof after==='object'&&!Array.isArray(after);
    if (objectBefore&&objectAfter) {
      for(const key of new Set([...Object.keys(before as object),...Object.keys(after as object)])) visit(getManifestValue(before,[key]),getManifestValue(after,[key]),[...path,key]);
      return;
    }
    const live=getManifestValue(latest,path);
    if (resourceFingerprint(live)!==resourceFingerprint(before) && resourceFingerprint(live)!==resourceFingerprint(after)) {
      const key=JSON.stringify(path);
      conflictFields.push({key,path:path.join('.')});
      if(choices[key]==='draft')merged=setManifestValue(merged,path,after);
      else if(choices[key]!=='server')conflicts.push(path.join('.'));
    }
    else merged=setManifestValue(merged,path,after);
  }
  visit(original,draft,[]);
  return {draft:merged,conflicts,conflictFields};
}
export function resourceChanges(before: unknown, after: unknown): ResourceChange[] {
  const changes: ResourceChange[] = [];
  const secret = getManifestValue(after,['kind'])==='Secret' || getManifestValue(before,['kind'])==='Secret';
  function walk(a: unknown,b: unknown,path:string[]) {
    if (resourceFingerprint(a)===resourceFingerprint(b)) return;
    const objectA = a && typeof a==='object' && !Array.isArray(a);
    const objectB = b && typeof b==='object' && !Array.isArray(b);
    if ((objectA || a===undefined) && (objectB || b===undefined) && (objectA||objectB)) {
      for (const key of new Set([...Object.keys((a as object)??{}),...Object.keys((b as object)??{})])) walk(getManifestValue(a,[key]),getManifestValue(b,[key]),[...path,key]);
      return;
    }
    const sensitive = (secret && ['data','stringData'].includes(path[0])) || path.some(key=>/password|token|private.?key|client.?secret|credential/i.test(key)) || ((Array.isArray(a)||Array.isArray(b)) && /password|token|secret|credential/i.test(JSON.stringify([a,b])));
    const format = (value:unknown)=>value===undefined ? '—' : sensitive ? '••••••（敏感值）' : typeof value==='string' ? value : JSON.stringify(value);
    changes.push({path:path.join('.'),operation:a===undefined?'add':b===undefined?'remove':'change',before:format(a),after:format(b)});
  }
  walk(before,after,[]);
  return changes;
}
export function safeEditorReturnTo(value?: string|null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || /[\\\r\n]/.test(value)) return '/clusters';
  return value;
}
export function buildResourceEditorHref(input: {clusterId?:string;kind?:string;name?:string;namespace?:string;mode?:'form'|'yaml';returnTo?:string;apiVersion?:string;resource?:string;readOnly?:boolean}) {
  const query = new URLSearchParams();
  for (const [key,value] of Object.entries(input)) if (value!==undefined && value!=='') query.set(key,String(value));
  const base = input.clusterId ? '/clusters/'+encodeURIComponent(input.clusterId)+'/resources/editor' : '/resources/editor';
  return base+'?'+query.toString();
}
export function createResourceDraft(kind: string, namespace='default', apiVersion?:string, namespaced?:boolean): ResourceManifest {
  const definition = editorResourceType(kind);
  const actualKind = definition?.kind ?? kind;
  const manifest: ResourceManifest = {apiVersion:apiVersion || definition?.apiVersion || 'v1',kind:actualKind,metadata:{name:'',...((namespaced ?? definition?.namespaced)===false?{}:{namespace})}};
  if (WORKLOAD_KINDS.has(actualKind)) {
    const podSpec = {containers:[{name:'main',image:''}],restartPolicy:['Job','CronJob'].includes(actualKind)?'Never':'Always'};
    if (actualKind==='Pod') manifest.spec=podSpec;
    else if (actualKind==='CronJob') manifest.spec={schedule:'0 * * * *',jobTemplate:{spec:{template:{spec:podSpec}}}};
    else manifest.spec={...(['Deployment','StatefulSet','ReplicaSet'].includes(actualKind)?{replicas:1}:{}),template:{metadata:{labels:{app:'app'}},spec:podSpec},...(!['Job'].includes(actualKind)?{selector:{matchLabels:{app:'app'}}}:{})};
  } else if (actualKind==='ConfigMap') manifest.data={};
  else if (actualKind==='Secret') {manifest.type='Opaque';manifest.stringData={};}
  else if (!['Namespace','ServiceAccount','Role','RoleBinding','ClusterRole','ClusterRoleBinding','StorageClass','Endpoints','EndpointSlice','LimitRange'].includes(actualKind)) manifest.spec={};
  return manifest;
}
