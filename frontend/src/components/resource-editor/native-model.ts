import { JSON_SCHEMA, load } from 'js-yaml';
import { getManifestValue, setManifestValue } from '@/lib/resource-editor';
import type { ResourceManifest } from '@/lib/resource-editor';

export type FieldPath = (string | number)[];
export type NativeField = {
  label: string; path: FieldPath;
  type?: 'text' | 'number' | 'boolean' | 'select' | 'tags' | 'map' | 'list' | 'group' | 'yaml' | 'int-or-string' | 'service-port';
  options?: string[]; fields?: NativeField[]; initial?: unknown;
  required?: boolean; immutable?: boolean; sensitive?: boolean;
  minimum?: number; maximum?: number; note?: string; yamlType?: 'object' | 'array';
  when?: (value: ResourceManifest, parent: unknown) => boolean;
};
const text = (label: string, path: string, extra: Partial<NativeField> = {}): NativeField => ({ label, path: path.split('.'), ...extra });
const select = (label: string, path: string, options: string[], extra: Partial<NativeField> = {}) => text(label, path, { type: 'select', options, ...extra });
const list = (label: string, path: string, fields: NativeField[], initial: unknown): NativeField => text(label, path, { type: 'list', fields, initial });
const map = (label: string, path: string, extra: Partial<NativeField> = {}) => text(label, path, { type: 'map', ...extra });
const yaml = (label: string, path: string, yamlType: 'object' | 'array', extra: Partial<NativeField> = {}) => text(label, path, { type: 'yaml', yamlType, note: '高级结构保留原值；编辑后点击应用 YAML。', ...extra });
const tags = (label: string, path: string, options?: string[], extra: Partial<NativeField> = {}) => text(label, path, { type: 'tags', options, ...extra });
const bool = (label: string, path: string, extra: Partial<NativeField> = {}) => text(label, path, { type: 'boolean', ...extra });
const port = (label: string, path: string, extra: Partial<NativeField> = {}) => text(label, path, { type: 'number', minimum: 1, maximum: 65535, ...extra });
const protocols = ['TCP', 'UDP', 'SCTP'];
const accessModes = ['ReadWriteOnce', 'ReadOnlyMany', 'ReadWriteMany', 'ReadWriteOncePod'];
const servicePorts = [text('端口名称', 'name'), port('服务端口', 'port', { required: true }), text('目标端口（数字或名称）', 'targetPort', { type: 'int-or-string' }), select('协议', 'protocol', protocols), port('NodePort', 'nodePort', { when: value => ['NodePort', 'LoadBalancer'].includes(String(getManifestValue(value, ['spec', 'type']))) }), text('应用协议', 'appProtocol')];
const endpointPorts = [text('端口名称', 'name'), port('端口', 'port'), select('协议', 'protocol', protocols), text('应用协议', 'appProtocol')];
const addresses = [text('IP 地址', 'ip', { required: true }), text('主机名', 'hostname'), text('节点名称', 'nodeName')];
const backend = [text('后端服务名称', 'backend.service.name', { required: true }), text('后端服务端口', 'backend.service.port', { type: 'service-port', required: true })];
const rules = [tags('API 组（核心组选择 core）', 'apiGroups', ['core', 'apps', 'batch', 'networking.k8s.io', 'rbac.authorization.k8s.io', '*']), tags('资源', 'resources'), tags('动作', 'verbs', ['get', 'list', 'watch', 'create', 'update', 'patch', 'delete', 'deletecollection', '*'], { required: true }), tags('资源名称（可选）', 'resourceNames'), tags('非资源 URL', 'nonResourceURLs')];
const subjectFields = [select('主体类型', 'kind', ['ServiceAccount', 'User', 'Group'], { required: true }), text('主体名称', 'name', { required: true }), text('主体命名空间', 'namespace', { when: (_value, parent) => getManifestValue(parent, ['kind']) === 'ServiceAccount' }), text('API 组', 'apiGroup', { when: (_value, parent) => getManifestValue(parent, ['kind']) !== 'ServiceAccount' })];
const roleRef = text('角色引用', 'roleRef', { type: 'group', immutable: true, fields: [select('角色类型', 'kind', ['Role', 'ClusterRole'], { required: true }), text('角色名称', 'name', { required: true }), text('API 组', 'apiGroup', { required: true })] });
const policyPorts = list('端口规则', 'ports', [select('协议', 'protocol', protocols), text('端口（数字或名称）', 'port', { type: 'int-or-string' }), port('结束端口', 'endPort')], { protocol: 'TCP' });
const policyRules = (direction: 'from' | 'to') => [policyPorts, yaml(direction === 'from' ? '来源选择器 / IP 段' : '目标选择器 / IP 段', direction, 'array', { note: '复杂 peer 使用 YAML 列表：podSelector、namespaceSelector 或 ipBlock。未设置表示不限来源/目标。' })];
const refs = [text('Secret 名称', 'name', { required: true })];

const fields: Record<string, NativeField[]> = {
  Service: [
    select('Service 类型', 'spec.type', ['ClusterIP', 'NodePort', 'LoadBalancer', 'ExternalName'], { note: '切换为 ExternalName 会移除选择器、集群 IP 与流量策略；端口及其扩展属性保留，nodePort 被移除。' }),
    text('外部 DNS 名称', 'spec.externalName', { required: true, when: value => getManifestValue(value, ['spec', 'type']) === 'ExternalName' }),
    map('Pod 选择器', 'spec.selector', { when: value => getManifestValue(value, ['spec', 'type']) !== 'ExternalName' }),
    list('Service 端口', 'spec.ports', servicePorts, { port: 80, targetPort: 80, protocol: 'TCP' }),
    text('Cluster IP（None 表示无头服务）', 'spec.clusterIP', { immutable: true, when: value => getManifestValue(value, ['spec', 'type']) !== 'ExternalName' }),
    select('会话亲和性', 'spec.sessionAffinity', ['None', 'ClientIP'], { when: value => getManifestValue(value, ['spec', 'type']) !== 'ExternalName' }),
    text('会话保持超时（秒）', 'spec.sessionAffinityConfig.clientIP.timeoutSeconds', { type: 'number', minimum: 1, maximum: 86400, when: value => getManifestValue(value, ['spec', 'sessionAffinity']) === 'ClientIP' }),
    bool('发布未就绪地址', 'spec.publishNotReadyAddresses', { when: value => getManifestValue(value, ['spec', 'type']) !== 'ExternalName' }),
    select('外部流量策略', 'spec.externalTrafficPolicy', ['Cluster', 'Local'], { when: value => ['NodePort', 'LoadBalancer'].includes(String(getManifestValue(value, ['spec', 'type']))) }),
  ],
  Ingress: [
    text('IngressClass', 'spec.ingressClassName'),
    list('域名路由', 'spec.rules', [text('域名（可空，匹配所有）', 'host'), list('HTTP 路径', 'http.paths', [text('路径', 'path', { required: true }), select('路径类型', 'pathType', ['Prefix', 'Exact', 'ImplementationSpecific'], { required: true }), ...backend], { path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { number: 80 } } } })], { host: '', http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: '', port: { number: 80 } } } }] } }),
    list('TLS 证书', 'spec.tls', [tags('TLS 域名', 'hosts'), text('证书 Secret', 'secretName')], { hosts: [], secretName: '' }),
    text('默认后端', 'spec.defaultBackend', { type: 'group', fields: [text('服务名称', 'service.name'), text('服务端口', 'service.port', { type: 'service-port' })] }),
  ],
  IngressClass: [
    text('控制器', 'spec.controller', { required: true, immutable: true, note: '创建 IngressClass 不会安装对应的控制器。' }),
    text('参数引用', 'spec.parameters', { type: 'group', fields: [text('API 组（核心组留空）', 'apiGroup'), text('资源类型', 'kind', { required: true }), text('资源名称', 'name', { required: true }), select('作用域', 'scope', ['Cluster', 'Namespace'], { note: '未设置作用域时 Kubernetes 默认为 Cluster。' }), text('命名空间', 'namespace', { required: true, when: (_value, parent) => getManifestValue(parent, ['scope']) === 'Namespace' })] }),
  ],
  Endpoints: [list('地址子集', 'subsets', [list('就绪地址', 'addresses', addresses, { ip: '' }), list('未就绪地址', 'notReadyAddresses', addresses, { ip: '' }), list('端口', 'ports', endpointPorts, { port: 80, protocol: 'TCP' })], { addresses: [{ ip: '' }], ports: [{ port: 80, protocol: 'TCP' }] })],
  EndpointSlice: [
    select('地址类型', 'addressType', ['IPv4', 'IPv6', 'FQDN'], { required: true, immutable: true }),
    list('端点', 'endpoints', [tags('地址', 'addresses', undefined, { required: true }), text('主机名', 'hostname'), text('节点名称', 'nodeName'), text('可用区', 'zone'), bool('就绪', 'conditions.ready'), bool('提供服务', 'conditions.serving'), bool('终止中', 'conditions.terminating')], { addresses: [], conditions: { ready: true } }),
    list('端口', 'ports', endpointPorts, { port: 80, protocol: 'TCP' }),
  ],
  NetworkPolicy: [map('Pod 选择器标签', 'spec.podSelector.matchLabels', { note: '空选择器匹配命名空间所有 Pod。' }), yaml('Pod 选择器表达式', 'spec.podSelector.matchExpressions', 'array'), tags('策略方向', 'spec.policyTypes', ['Ingress', 'Egress']), list('入站规则', 'spec.ingress', policyRules('from'), {}), list('出站规则', 'spec.egress', policyRules('to'), {})],
  PersistentVolume: [
    text('容量', 'spec.capacity.storage', { required: true }), tags('访问模式', 'spec.accessModes', accessModes, { required: true }),
    text('存储类', 'spec.storageClassName'), select('卷模式', 'spec.volumeMode', ['Filesystem', 'Block'], { immutable: true }),
    select('回收策略', 'spec.persistentVolumeReclaimPolicy', ['Retain', 'Delete', 'Recycle']), tags('挂载选项', 'spec.mountOptions'),
    text('CSI 源', 'spec.csi', { type: 'group', immutable: true, when: value => getManifestValue(value, ['spec', 'csi']) !== undefined, fields: [text('CSI Driver', 'driver', { required: true }), text('Volume Handle', 'volumeHandle', { required: true }), text('文件系统类型', 'fsType'), bool('只读', 'readOnly'), map('卷属性', 'volumeAttributes'), yaml('节点发布 Secret 引用', 'nodePublishSecretRef', 'object')] }),
    text('NFS 源', 'spec.nfs', { type: 'group', immutable: true, when: value => getManifestValue(value, ['spec', 'nfs']) !== undefined, fields: [text('NFS 服务地址', 'server', { required: true }), text('NFS 路径', 'path', { required: true }), bool('只读', 'readOnly')] }),
    text('hostPath 源', 'spec.hostPath', { type: 'group', immutable: true, when: value => getManifestValue(value, ['spec', 'hostPath']) !== undefined, fields: [text('主机路径', 'path', { required: true }), select('路径类型', 'type', ['', 'DirectoryOrCreate', 'Directory', 'FileOrCreate', 'File', 'Socket', 'CharDevice', 'BlockDevice'])] }),
    text('local 源', 'spec.local', { type: 'group', immutable: true, when: value => getManifestValue(value, ['spec', 'local']) !== undefined, fields: [text('本地路径', 'path', { required: true }), text('文件系统类型', 'fsType')] }),
    yaml('节点亲和性（local 卷必填）', 'spec.nodeAffinity', 'object', { immutable: true }),
  ],
  PersistentVolumeClaim: [text('申请容量', 'spec.resources.requests.storage', { required: true, note: '编辑时仅支持集群允许的扩容，不支持缩容。' }), text('存储类（空字符串禁用动态供应）', 'spec.storageClassName', { immutable: true }), tags('访问模式', 'spec.accessModes', accessModes, { required: true, immutable: true }), select('卷模式', 'spec.volumeMode', ['Filesystem', 'Block'], { immutable: true }), text('绑定 PV', 'spec.volumeName', { immutable: true }), map('卷选择器标签', 'spec.selector.matchLabels', { immutable: true }), yaml('数据源引用', 'spec.dataSource', 'object', { immutable: true })],
  StorageClass: [text('Provisioner', 'provisioner', { required: true, immutable: true }), map('供应参数', 'parameters', { immutable: true }), select('回收策略', 'reclaimPolicy', ['Delete', 'Retain'], { immutable: true }), select('绑定模式', 'volumeBindingMode', ['Immediate', 'WaitForFirstConsumer'], { immutable: true }), bool('允许扩容', 'allowVolumeExpansion'), tags('挂载选项', 'mountOptions'), yaml('允许的拓扑', 'allowedTopologies', 'array')],
  ConfigMap: [map('文本配置', 'data', { note: '保留空值与多行文本。' }), map('二进制配置（base64）', 'binaryData'), bool('不可变（启用后不能撤销）', 'immutable')],
  Secret: [text('Secret 类型', 'type', { immutable: true }), map('原始数据（base64）', 'data', { sensitive: true, note: '默认隐藏。未编辑的 base64 原样保留，不自动解码或重新编码。' }), map('明文输入（stringData，仅写入）', 'stringData', { sensitive: true, note: '仅写入：同名键覆盖 data；API 读取不会返回 stringData。不会保存到本地存储或日志。' }), bool('不可变（启用后不能撤销）', 'immutable')],
  ServiceAccount: [list('镜像拉取 Secret', 'imagePullSecrets', refs, { name: '' }), list('Secret 引用', 'secrets', [text('名称', 'name', { required: true }), text('命名空间', 'namespace'), text('UID', 'uid')], { name: '' }), bool('自动挂载令牌', 'automountServiceAccountToken')],
  Role: [list('权限规则', 'rules', rules.filter(field => field.path[0] !== 'nonResourceURLs'), { apiGroups: [''], resources: [], verbs: ['get'] })],
  ClusterRole: [list('权限规则', 'rules', rules, { apiGroups: [''], resources: [], verbs: ['get'] }), yaml('聚合规则', 'aggregationRule', 'object')],
  RoleBinding: [roleRef, list('绑定主体', 'subjects', subjectFields, { kind: 'ServiceAccount', name: '', namespace: 'default' })],
  ClusterRoleBinding: [{ ...roleRef, fields: roleRef.fields?.map(field => field.path[0] === 'kind' ? { ...field, options: ['ClusterRole'] } : field) }, list('绑定主体', 'subjects', subjectFields, { kind: 'ServiceAccount', name: '', namespace: 'default' })],
  Namespace: [],
  HorizontalPodAutoscaler: [
    text('目标资源', 'spec.scaleTargetRef', { type: 'group', fields: [text('API 版本', 'apiVersion', { required: true }), text('资源类型', 'kind', { required: true }), text('目标资源名称', 'name', { required: true })] }),
    text('最小副本数', 'spec.minReplicas', { type: 'number', minimum: 0 }), text('最大副本数', 'spec.maxReplicas', { type: 'number', minimum: 1, required: true }),
    text('目标 CPU 利用率（autoscaling/v1）', 'spec.targetCPUUtilizationPercentage', { type: 'number', minimum: 1, when: value => value.apiVersion === 'autoscaling/v1' }),
    { ...list('扩缩容指标', 'spec.metrics', [
      select('指标类型', 'type', ['Resource', 'ContainerResource', 'Pods', 'Object', 'External'], { required: true }),
      select('资源', 'resource.name', ['cpu', 'memory'], { when: (_v, row) => getManifestValue(row, ['type']) === 'Resource', required: true }),
      select('目标类型', 'resource.target.type', ['Utilization', 'AverageValue'], { when: (_v, row) => getManifestValue(row, ['type']) === 'Resource', required: true }),
      text('目标利用率（%）', 'resource.target.averageUtilization', { type: 'number', minimum: 1, when: (_v, row) => getManifestValue(row, ['type']) === 'Resource' && getManifestValue(row, ['resource', 'target', 'type']) === 'Utilization', required: true }),
      text('目标平均值（如 100m / 256Mi）', 'resource.target.averageValue', { when: (_v, row) => getManifestValue(row, ['type']) === 'Resource' && getManifestValue(row, ['resource', 'target', 'type']) === 'AverageValue', required: true }),
      ...['containerResource', 'pods', 'object', 'external'].map(key => yaml('高级指标配置：' + key, key, 'object', { when: (_v, row) => String(getManifestValue(row, ['type'])).toLowerCase() === key.toLowerCase() })),
    ], { type: 'Resource', resource: { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80 } } }), when: value => value.apiVersion !== 'autoscaling/v1' },
    yaml('扩缩容行为', 'spec.behavior', 'object', { when: value => value.apiVersion !== 'autoscaling/v1' }),
  ],
  ResourceQuota: [map('配额上限', 'spec.hard', { note: '例如 requests.cpu=4、requests.memory=8Gi、pods=20。' }), tags('作用域', 'spec.scopes', ['Terminating', 'NotTerminating', 'BestEffort', 'NotBestEffort', 'PriorityClass', 'CrossNamespacePodAffinity']), yaml('作用域选择器', 'spec.scopeSelector', 'object')],
  LimitRange: [list('资源限制', 'spec.limits', [select('限制类型', 'type', ['Container', 'Pod', 'PersistentVolumeClaim'], { required: true }), map('最小值', 'min'), map('最大值', 'max'), map('默认限制', 'default', { when: (_v, row) => getManifestValue(row, ['type']) === 'Container' }), map('默认请求', 'defaultRequest', { when: (_v, row) => getManifestValue(row, ['type']) === 'Container' }), map('最大限制/请求比率', 'maxLimitRequestRatio')], { type: 'Container' })],
};

export function nativeKind(kind: string): string {
  return ({ PV: 'PersistentVolume', PVC: 'PersistentVolumeClaim', SC: 'StorageClass', HPA: 'HorizontalPodAutoscaler' } as Record<string, string>)[kind] ?? kind;
}
export function supportsNativeResourceForm(kind: string): boolean { return Object.hasOwn(fields, nativeKind(kind)); }
export function nativeFields(kind: string): NativeField[] { return fields[nativeKind(kind)] ?? []; }
export function parseIntOrString(raw: string): string | number { return /^-?(0|[1-9]\d*)$/.test(raw) && Number.isSafeInteger(Number(raw)) ? Number(raw) : raw; }
export function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value); }

export function assertSafeValue(value: unknown, ancestors = new Set<unknown>(), depth = 0): void {
  if (value === null || typeof value !== 'object') return;
  if (depth > 40 || ancestors.has(value)) throw new Error('结构循环或嵌套过深，请使用 YAML 编辑器检查');
  ancestors.add(value);
  for (const [key, child] of Object.entries(value)) {
    if (['__proto__', 'prototype', 'constructor'].includes(key)) throw new Error('不安全的字段名称');
    assertSafeValue(child, ancestors, depth + 1);
  }
  ancestors.delete(value);
}
export type MapRow = { id: string; key: string; value: string };
export function commitMapRows(rows: MapRow[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const row of rows) {
    if (!row.key) throw new Error('键名不能为空；输入完成后再应用');
    if (['__proto__', 'prototype', 'constructor'].includes(row.key)) throw new Error('不安全的键名');
    if (Object.hasOwn(result, row.key)) throw new Error('键名重复，现有值不会被覆盖');
    result[row.key] = row.value;
  }
  return result;
}
export function parseAdvancedValue(raw: string, type: 'object' | 'array'): unknown {
  if (!raw.trim()) return undefined;
  if (raw.length > 200_000) throw new Error('高级字段超过 200KB，请使用 YAML 编辑器');
  const value = load(raw, { schema: JSON_SCHEMA });
  assertSafeValue(value);
  if (type === 'object' ? !isRecord(value) : !Array.isArray(value)) throw new Error(type === 'object' ? '必须是 YAML 对象' : '必须是 YAML 列表');
  return value;
}

const pvSources = ['csi', 'nfs', 'hostPath', 'local'];
export const volumeSources = pvSources;
export function isNativeFieldLocked(value: ResourceManifest, path: FieldPath, mode: 'create' | 'edit'): boolean {
  if (['apiVersion', 'kind', 'status'].includes(String(path[0])) || (path[0] === 'metadata' && ['name', 'namespace', 'resourceVersion'].includes(String(path[1])))) return true;
  if (mode !== 'edit') return false;
  const kind = nativeKind(value.kind);
  if (['Secret', 'ConfigMap'].includes(kind) && value.immutable === true && ['data', 'stringData', 'binaryData', 'immutable'].includes(String(path[0]))) return true;
  if (kind === 'PersistentVolumeClaim' && path[0] === 'spec' && !(path.slice(0, 4).join('.') === 'spec.resources.requests.storage')) return true;
  const walk = (items: NativeField[], prefix: FieldPath = []): boolean => items.some(field => {
    const full = [...prefix, ...field.path];
    if (!full.every((key, i) => path[i] === key)) return false;
    if (field.immutable) return true;
    return field.fields ? walk(field.fields, field.type === 'list' ? [...full, path[full.length]] : full) : false;
  });
  return walk(nativeFields(kind));
}

export function updateNativeField(value: ResourceManifest, path: FieldPath, next: unknown, mode: 'create' | 'edit', disabled = false): ResourceManifest {
  if (disabled || isNativeFieldLocked(value, path, mode)) return value;
  assertSafeValue(next);
  if (nativeKind(value.kind) === 'Secret' && ['data', 'stringData'].includes(String(path[0]))) {
    const values = isRecord(next) ? Object.values(next) : [next];
    if (values.some(item => typeof item === 'string' && /^(?:\*{4,}|[•●]{4,}.*|\[REDACTED\]|<redacted>)$/i.test(item))) throw new Error('不能写入 Secret 脱敏占位符');
  }
  let result = setManifestValue(value, path, next);
  const key = path.join('.');
  if (nativeKind(value.kind) === 'IngressClass' && key === 'spec.parameters.scope' && next !== 'Namespace') result = setManifestValue(result, ['spec', 'parameters', 'namespace'], undefined);
  if (nativeKind(value.kind) === 'Service' && key === 'spec.sessionAffinity' && next !== 'ClientIP') result = setManifestValue(result, ['spec', 'sessionAffinityConfig'], undefined);
  if (nativeKind(value.kind) === 'Service' && key === 'spec.type') {
    if (next === 'ExternalName') {
      for (const name of ['selector', 'clusterIP', 'clusterIPs', 'ipFamilies', 'ipFamilyPolicy', 'externalTrafficPolicy', 'internalTrafficPolicy', 'healthCheckNodePort', 'sessionAffinity', 'sessionAffinityConfig', 'allocateLoadBalancerNodePorts', 'loadBalancerClass', 'loadBalancerIP', 'loadBalancerSourceRanges', 'externalIPs']) result = setManifestValue(result, ['spec', name], undefined);
    } else result = setManifestValue(result, ['spec', 'externalName'], undefined);
    if (next !== 'NodePort' && next !== 'LoadBalancer') {
      const ports = getManifestValue(result, ['spec', 'ports']);
      if (Array.isArray(ports)) result = setManifestValue(result, ['spec', 'ports'], ports.map(item => { const port = { ...item }; delete port.nodePort; return port; }));
      result = setManifestValue(result, ['spec', 'externalTrafficPolicy'], undefined);
      result = setManifestValue(result, ['spec', 'healthCheckNodePort'], undefined);
    }
  }
  if (['RoleBinding', 'ClusterRoleBinding'].includes(nativeKind(value.kind)) && path[0] === 'subjects' && path[2] === 'kind') {
    result = setManifestValue(result, ['subjects', path[1], 'apiGroup'], next === 'ServiceAccount' ? undefined : 'rbac.authorization.k8s.io');
    if (next !== 'ServiceAccount') result = setManifestValue(result, ['subjects', path[1], 'namespace'], undefined);
  }
  if (nativeKind(value.kind) === 'HorizontalPodAutoscaler' && path[1] === 'metrics') {
    if (path.length === 4 && path[3] === 'type') {
      const chosen = String(next).slice(0, 1).toLowerCase() + String(next).slice(1);
      for (const type of ['resource', 'containerResource', 'pods', 'object', 'external']) if (type !== chosen) result = setManifestValue(result, path.slice(0, 3).concat(type), undefined);
      if (next === 'Resource' && getManifestValue(result, path.slice(0, 3).concat('resource')) === undefined) result = setManifestValue(result, path.slice(0, 3).concat('resource'), { name: 'cpu', target: { type: 'Utilization', averageUtilization: 80 } });
    }
    if (path.at(-1) === 'type' && path.at(-2) === 'target') {
      for (const target of ['averageUtilization', 'averageValue', 'value']) if (target !== ({ Utilization: 'averageUtilization', AverageValue: 'averageValue', Value: 'value' } as Record<string, string>)[String(next)]) result = setManifestValue(result, path.slice(0, -1).concat(target), undefined);
    }
  }
  return result;
}

export function setVolumeSource(value: ResourceManifest, source: string, mode: 'create' | 'edit', disabled = false): ResourceManifest {
  if (disabled || mode === 'edit' || !pvSources.includes(source)) return value;
  let result = value;
  // Clear every known PV source, including legacy sources that this editor does not expose.
  const allSources = [...pvSources, 'awsElasticBlockStore', 'azureDisk', 'azureFile', 'cephfs', 'cinder', 'fc', 'flexVolume', 'flocker', 'gcePersistentDisk', 'glusterfs', 'iscsi', 'photonPersistentDisk', 'portworxVolume', 'quobyte', 'rbd', 'scaleIO', 'storageos', 'vsphereVolume'];
  for (const type of allSources) if (type !== source) result = setManifestValue(result, ['spec', type], undefined);
  const defaults: Record<string, unknown> = { csi: { driver: '', volumeHandle: '' }, nfs: { server: '', path: '' }, hostPath: { path: '', type: 'DirectoryOrCreate' }, local: { path: '' } };
  if (getManifestValue(result, ['spec', source]) === undefined) result = setManifestValue(result, ['spec', source], defaults[source]);
  return result;
}
