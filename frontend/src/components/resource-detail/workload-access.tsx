'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Checkbox, Modal, Select, Space, Table, Tabs, Tag, Typography, message } from 'antd';
import { useAuth } from '@/components/auth-context';
import { OpsDrawerShell } from '@/components/ops';
import { EditorDocument } from '@/components/resource-editor/resource-editor-page';
import editorStyles from '@/components/resource-editor/resource-editor-page.module.css';
import { getResourceAccessContext } from '@/lib/api/resource-access';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';
import { buildDynamicResourceDetailRequest, getResourceYaml, type ResourceDetailResponse, type ResourceDetailRequest } from '@/lib/api/resources';
import { parseResourceDocuments, resourceFingerprint, sanitizeResourceManifest, serializeResourceDocuments, type ResourceManifest } from '@/lib/resource-editor';
import { array, object, strings, template, createServiceDraft, ingressServices, relatedServices, selectorImpact, serviceAddresses, matchesSelector, stableSelector } from './access-relations';

type EditorTarget = { kind: 'Service' | 'Ingress'; yaml: string; original?: string };
const resourceTypes = [{ kind: 'Service', apiVersion: 'v1', resource: 'services', namespaced: true }, { kind: 'Ingress', apiVersion: 'networking.k8s.io/v1', resource: 'ingresses', namespaced: true }];
function readyPod(pod: ResourceManifest) { return array(object(pod.status).conditions).some(condition => condition.type === 'Ready' && condition.status === 'True'); }

export function WorkloadAccess({ detail, onNavigateRequest }: { detail: ResourceDetailResponse; onNavigateRequest?: (request: ResourceDetailRequest) => void }) {
  const { accessToken } = useAuth();
  const client = useQueryClient();
  const { clusterId, namespace = '', kind, name } = detail.overview;
  const query = useResourceListQuery({ queryKey: ['resource-access', clusterId, namespace, kind, name, accessToken], queryFn: ({ signal }) => getResourceAccessContext({ clusterId, namespace, kind, name }, accessToken!, signal), enabled: !!accessToken && !!namespace, retry: false });
  const [taskEnabled, setTaskEnabled] = useState(false);
  const [followWorkload, setFollowWorkload] = useState(false);
  const [tab, setTab] = useState('services');
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [draft, setDraft] = useState<ResourceManifest | null>(null);
  const [acceptedImpact, setAcceptedImpact] = useState('');
  const [selectOpen, setSelectOpen] = useState(false);
  const [selectedService, setSelectedService] = useState('');
  const [loadingEditor, setLoadingEditor] = useState(false);
  const data = query.data;
  const list = (kind: string) => data?.lists.find(item => item.kind === kind)?.items ?? [];
  const all = data?.lists.flatMap(item => item.items) ?? [];
  const pods = list('Pod');
  const workloads = all.filter(item => !['Service', 'Ingress', 'Endpoints', 'EndpointSlice', 'Pod'].includes(item.kind));
  const services = list('Service');
  const related = data ? relatedServices(data.workload, services, pods, all, [...list('Endpoints'), ...list('EndpointSlice')]) : [];
  const ingress = list('Ingress').filter(item => ingressServices(item).some(service => related.some(row => row.metadata.name === service)));
  const incomplete = data?.lists.filter(item => item.incomplete) ?? [];
  const task = ['job', 'cronjob'].includes(kind.toLowerCase());
  const writable = !!data?.canMutate && (!task || taskEnabled);
  const selector = strings(object(draft?.spec).selector);
  const impact = selectorImpact(selector, pods, workloads);
  const impactKey = JSON.stringify([selector, impact.pods.map(item => item.metadata.uid), impact.workloads.map(item => item.metadata.uid), incomplete.map(item => item.kind)]);
  const oldSelector = editor?.original ? strings(object(parseResourceDocuments(editor.original)[0].spec).selector) : {};
  const lostPods = editor?.kind === 'Service' ? pods.filter(pod => matchesSelector(strings(pod.metadata.labels), oldSelector) && !matchesSelector(strings(pod.metadata.labels), selector)) : [];
  const addedPods = editor?.kind === 'Service' ? impact.pods.filter(pod => !matchesSelector(strings(pod.metadata.labels), oldSelector)) : [];
  const shared = impact.workloads.filter(item => item.metadata.uid !== data?.workload.metadata.uid && !array(item.metadata.ownerReferences).some(ref => ref.uid === data?.workload.metadata.uid));

  const navigate = (item: ResourceManifest) => onNavigateRequest?.(buildDynamicResourceDetailRequest({ clusterId, namespace, name: item.metadata.name!, group: item.kind === 'Ingress' ? 'networking.k8s.io' : '', version: 'v1', resource: item.kind === 'Ingress' ? 'ingresses' : 'services' }, item.kind));
  async function copy(address: string) { try { await navigator.clipboard.writeText(address); void message.success('地址已复制'); } catch { void message.error('复制失败，请手动复制地址'); } }
  function start(target: EditorTarget) {
    setAcceptedImpact('');
    setDraft(parseResourceDocuments(target.yaml)[0]);
    setEditor(target);
    setSelectOpen(false);
  }
  function closeEditor() {
    if (editor && draft && resourceFingerprint(sanitizeResourceManifest(draft, editor.original ? 'edit' : 'create')) !== resourceFingerprint(sanitizeResourceManifest(parseResourceDocuments(editor.yaml)[0], editor.original ? 'edit' : 'create')) && !window.confirm('有尚未保存的访问资源配置，确定关闭并丢弃吗？')) return;
    setEditor(null);
  }
  function createService() {
    if (!data) return;
    const value = createServiceDraft(data.workload);
    const candidate = selectorImpact(strings(object(value.spec).selector), pods, workloads);
    const hasOther = candidate.workloads.some(item => item.metadata.uid !== data.workload.metadata.uid && !array(item.metadata.ownerReferences).some(ref => ref.uid === data.workload.metadata.uid));
    if (followWorkload && data.workload.metadata.uid && !hasOther && !incomplete.length) value.metadata.ownerReferences = [{ apiVersion: data.workload.apiVersion, kind: data.workload.kind, name: data.workload.metadata.name, uid: data.workload.metadata.uid }];
    start({ kind: 'Service', yaml: serializeResourceDocuments([value]) });
  }
  function createIngress() {
    const svc = related[0];
    if (!svc) return;
    const port = array(object(svc.spec).ports)[0];
    if (!port) return;
    start({ kind: 'Ingress', yaml: serializeResourceDocuments([{ apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: name + '-ingress', namespace }, spec: { rules: [{ http: { paths: [{ path: '/', pathType: 'Prefix', backend: { service: { name: svc.metadata.name, port: port.name ? { name: port.name } : { number: port.port } } } }] } }] } }]) });
  }
  async function editService(item: ResourceManifest, prefill = false) {
    if (!data || !accessToken) return;
    setLoadingEditor(true);
    try {
      const result = await getResourceYaml({ clusterId, namespace, kind: 'Service', name: item.metadata.name! }, accessToken);
      const current = parseResourceDocuments(result.yaml)[0];
      // The editor receives the original resourceVersion; selector replacement is a real edit.
      const next = prefill ? { ...current, spec: { ...object(current.spec), selector: stableSelector(data.workload) } } : current;
      start({ kind: 'Service', yaml: serializeResourceDocuments([next]), original: result.yaml });
    } catch (error) { void message.error(error instanceof Error ? error.message : '加载服务失败'); } finally { setLoadingEditor(false); }
  }
  function validateDraft(value: ResourceManifest) {
    const errors: string[] = [];
    if (value.kind !== editor?.kind || value.metadata.namespace !== namespace) errors.push('访问资源必须保持当前类型与命名空间');
    if (value.kind === 'Service') {
      const spec = object(value.spec), chosen = strings(spec.selector);
      const changed = !editor?.original || JSON.stringify(chosen) !== JSON.stringify(oldSelector);
      if (spec.type === 'ExternalName') errors.push('ExternalName 请在网络菜单创建，不作为工作负载访问服务');
      if (!Object.keys(chosen).length) errors.push('请选择能够匹配当前工作负载的稳定标签，不能自动生成空选择器');
      const labels = strings(object(template(data!.workload).metadata).labels);
      if (Object.keys(chosen).length && !matchesSelector(labels, chosen) && !impact.pods.some(pod => matchesSelector(strings(pod.metadata.labels), stableSelector(data!.workload)))) errors.push('选择器未关联当前工作负载，请检查标签与预计匹配范围');
      if (changed && acceptedImpact !== impactKey) errors.push('请先确认选择器匹配范围与新增、失去匹配的 Pod');
      if (editor?.original && changed && incomplete.length) errors.push('读取不完整时无法可靠评估已有服务选择器的影响，请修复读取后再编辑');
      if (array(value.metadata.ownerReferences).some(ref => ref.uid === data?.workload.metadata.uid) && (shared.length || incomplete.length)) errors.push('共享或匹配范围不完整的 Service 不允许绑定当前工作负载的删除生命周期');
    }
    if (value.kind === 'Ingress') {
      const spec = object(value.spec);
      const backends = [spec.defaultBackend, ...array(spec.rules).flatMap(rule => array(object(rule.http).paths).map(path => path.backend))].filter(Boolean);
      for (const backend of backends) {
        const reference = object(object(backend).service);
        const svc = related.find(item => item.metadata.name === reference.name);
        if (!svc) { errors.push('Ingress 后端只能选择当前工作负载已关联的 Service'); continue; }
        const port = object(reference.port);
        if (!array(object(svc.spec).ports).some(item => port.name ? item.name === port.name : item.port === port.number)) errors.push('Ingress 后端端口必须是 Service 已声明的端口');
      }
      if (array(value.metadata.ownerReferences).some(ref => ref.uid === data?.workload.metadata.uid)) errors.push('Ingress 不绑定工作负载的删除生命周期');
    }
    return errors;
  }
  const addressCell = (item: ResourceManifest) => <Space orientation="vertical" size={4}>{serviceAddresses(item).map(({ address, open, internal }) => <Space key={address} wrap><Typography.Text copyable={{ text: address }}>{address}</Typography.Text>{internal && <Tag>集群内部</Tag>}{open && <Button size="small" onClick={() => window.open(address, '_blank', 'noopener,noreferrer')}>打开地址</Button>}</Space>)}</Space>;
  const serviceColumns = [
    { title: '名称', key: 'name', render: (_: unknown, item: ResourceManifest) => <Typography.Link onClick={() => navigate(item)}>{item.metadata.name}</Typography.Link> },
    { title: '类型', key: 'type', render: (_: unknown, item: ResourceManifest) => <Tag>{object(item.spec).clusterIP === 'None' ? 'Headless' : String(object(item.spec).type || 'ClusterIP')}</Tag> },
    { title: '访问地址', key: 'address', render: (_: unknown, item: ResourceManifest) => addressCell(item) },
    { title: '后端状态', key: 'ready', render: (_: unknown, item: ResourceManifest) => {
      const backend = selectorImpact(strings(object(item.spec).selector), pods, workloads).pods;
      const ready = backend.filter(readyPod).length;
      return <Space orientation="vertical" size={4}><Tag color={ready ? 'green' : 'orange'}>{Object.keys(strings(object(item.spec).selector)).length ? `${ready}/${backend.length} Pod 就绪` : '手工端点，检查详情'}{incomplete.some(row => row.kind === 'Pod') ? '（读取不完整）' : ''}</Tag>{object(item.spec).type === 'LoadBalancer' && !array(object(object(item.status).loadBalancer).ingress).length && <Typography.Text type="secondary">外部地址等待分配</Typography.Text>}</Space>;
    } },
    { title: '操作', key: 'action', render: (_: unknown, item: ResourceManifest) => writable ? <Button size="small" loading={loadingEditor} onClick={() => void editService(item)}>编辑服务</Button> : <Typography.Text type="secondary">只读</Typography.Text> },
  ];
  const ingressColumns = [
    { title: '名称', key: 'name', render: (_: unknown, item: ResourceManifest) => <Typography.Link onClick={() => navigate(item)}>{item.metadata.name}</Typography.Link> },
    { title: 'IngressClass', key: 'class', render: (_: unknown, item: ResourceManifest) => String(object(item.spec).ingressClassName || '未指定') },
    { title: '后端服务', key: 'backend', render: (_: unknown, item: ResourceManifest) => <Space wrap>{ingressServices(item).map(name => <Typography.Link key={name} onClick={() => { const svc = related.find(row => row.metadata.name === name); if (svc) navigate(svc); }}>{name}</Typography.Link>)}</Space> },
    { title: '访问地址', key: 'hosts', render: (_: unknown, item: ResourceManifest) => <Space orientation="vertical" size={4}>{array(object(item.spec).rules).map((rule, index) => {
      const host = String(rule.host || '');
      const tls = array(object(item.spec).tls).some(row => Array.isArray(row.hosts) && row.hosts.includes(host));
      return array(object(rule.http).paths).map((path, i) => { const address = `${tls ? 'https' : 'http'}://${host}${path.path || '/'}`; return host ? <Space key={index + ':' + i} wrap><Typography.Text>{address}</Typography.Text><Button size="small" onClick={() => void copy(address)}>复制</Button>{!host.includes('*') && <Button size="small" onClick={() => window.open(address, '_blank', 'noopener,noreferrer')}>打开</Button>}</Space> : <Typography.Text key={index + ':' + i} type="secondary">未配置域名 · {String(path.path || '/')}</Typography.Text>; });
    })}<Typography.Text type="secondary">路由配置不代表后端已就绪</Typography.Text></Space> },
  ];

  if (!accessToken || !namespace || !clusterId) return <Alert type="warning" showIcon title="缺少登录或资源上下文，无法读取访问关系"/>;
  if (query.isPending) return <Alert type="info" showIcon title="正在读取访问资源及真实关联关系…"/>;
  if (query.error && !data) return <ResourceQueryFeedback label="访问资源" query={query}/>;
  if (!data) return null;
  return <Space orientation="vertical" size={16} style={{ width: '100%' }}>
    <ResourceQueryFeedback label="访问资源" query={query}/>
    {incomplete.length > 0 && <Alert showIcon type="warning" title="部分资源未完整读取，不能视为没有关联" description={incomplete.map(item => `${item.kind}：${item.error || `最多读取 ${data.limit} 条，当前清单未完成`}`).join('；')}/>}
    {task && <Alert showIcon type="warning" title="任务结束后可能没有可用后端" description={<Checkbox checked={taskEnabled} onChange={event => setTaskEnabled(event.target.checked)}>主动启用此任务的访问资源创建</Checkbox>}/>}
    <Space wrap><Button onClick={() => void query.refetch()} loading={query.isFetching}>刷新访问关系</Button>{!data.canMutate && <Tag>当前授权只读</Tag>}{writable && <><Button type={tab === 'services' ? 'primary' : 'default'} onClick={createService}>新建 Service</Button><Button onClick={() => setSelectOpen(true)}>选择已有 Service</Button><Button type={tab === 'ingress' ? 'primary' : 'default'} disabled={!related.some(service => array(object(service.spec).ports).length)} onClick={createIngress}>新建 Ingress</Button></>}</Space>
    {writable && <Checkbox checked={followWorkload} disabled={!!incomplete.length || !data.workload.metadata.uid} onChange={event => setFollowWorkload(event.target.checked)}>新建 Service 随当前工作负载删除（共享服务不绑定）</Checkbox>}
    {kind.toLowerCase() === 'statefulset' && <Alert type="info" title={`StatefulSet 的 serviceName 为 ${String(object(data.workload.spec).serviceName || '未配置')}；创建服务不会修改此字段。`}/>}
    <Tabs activeKey={tab} onChange={setTab} items={[{ key: 'services', label: `服务（${related.length}）`, children: <Table rowKey={row => String(row.metadata.uid || row.metadata.name)} size="small" columns={serviceColumns} dataSource={related} scroll={{ x: 800 }} pagination={{ pageSize: 10 }} locale={{ emptyText: incomplete.length ? '已读取范围内未发现关联服务' : '暂无关联服务' }}/> }, { key: 'ingress', label: `路由规则（${ingress.length}）`, children: <Table rowKey={row => String(row.metadata.uid || row.metadata.name)} size="small" columns={ingressColumns} dataSource={ingress} scroll={{ x: 750 }} pagination={{ pageSize: 10 }} locale={{ emptyText: incomplete.length ? '已读取范围内未发现关联路由' : '暂无关联路由规则' }}/> }]}/>
    <Modal open={selectOpen} title="选择已有 Service" onCancel={() => setSelectOpen(false)} footer={null}>
      <Space orientation="vertical" style={{ width: '100%' }} size={16}><Typography.Text>关联由真实 selector 或端点引用决定；选择不会增加虚假的绑定。</Typography.Text><Select style={{ width: '100%' }} showSearch optionFilterProp="label" value={selectedService || undefined} placeholder="选择当前命名空间中的服务" options={services.map(item => ({ label: `${item.metadata.name} · ${related.includes(item) ? '已关联' : '未匹配'}`, value: item.metadata.name! }))} onChange={setSelectedService}/>{selectedService && <><Typography.Text code>{JSON.stringify(object(services.find(item => item.metadata.name === selectedService)?.spec).selector || {})}</Typography.Text>{related.some(item => item.metadata.name === selectedService) ? <Alert type="success" title="此服务已关联，无需修改"/> : <Alert type="warning" title="此服务尚未匹配当前工作负载" description="编辑选择器会改变后端，请先核对新增与失去匹配的 Pod，再预览差异并确认。"/>}<Button loading={loadingEditor} onClick={() => { const svc = services.find(item => item.metadata.name === selectedService); if (svc) related.includes(svc) ? (setSelectOpen(false), navigate(svc)) : void editService(svc, true); }}>{related.some(item => item.metadata.name === selectedService) ? '查看已关联服务' : '编辑选择器并检查影响'}</Button></>}</Space>
    </Modal>
    <OpsDrawerShell title={editor?.original ? '编辑访问服务' : `创建 ${editor?.kind || '访问资源'}`} open={!!editor} onClose={closeEditor} size="large" widthPx={1000} destroyOnHidden>
      {editor && <div className={editorStyles.embeddedWorkspace}>
        {editor.kind === 'Service' && <Alert showIcon type={shared.length || !impact.pods.length || incomplete.length ? 'warning' : 'info'} title={`预计匹配 ${impact.pods.length} 个 Pod、${impact.workloads.length} 个工作负载`} description={<Space orientation="vertical" style={{ width: '100%' }}><Typography.Text>工作负载：{impact.workloads.map(item => `${item.kind}/${item.metadata.name}`).join('、') || '当前无匹配'}；Pod：{impact.pods.map(item => item.metadata.name).join('、') || '当前无后端'}</Typography.Text>{editor.original && <Typography.Text>新增：{addedPods.map(item => item.metadata.name).join('、') || '无'}；失去匹配：{lostPods.map(item => item.metadata.name).join('、') || '无'}</Typography.Text>}{shared.length > 0 && <Typography.Text type="warning">选择器也匹配其他工作负载，请确认共享访问范围。</Typography.Text>}{!impact.pods.length && <Typography.Text type="warning">可以创建，但当前没有匹配后端，不能认为服务已经可用。</Typography.Text>}{incomplete.length > 0 && <Typography.Text type="warning">匹配范围未完整读取；已有服务选择器修改被阻止。</Typography.Text>}<Checkbox checked={acceptedImpact === impactKey} onChange={event => setAcceptedImpact(event.target.checked ? impactKey : '')}>我已核对当前匹配范围和影响</Checkbox></Space>}/>}
        {editor.kind === 'Ingress' && <Alert type="info" title="选择已关联的 Service 与服务端口" description={related.map(item => `${item.metadata.name}：${array(object(item.spec).ports).map(port => `${port.name || port.port}/${port.protocol || 'TCP'}`).join('、')}`).join('；')}/>}
        <EditorDocument key={editor.original || editor.yaml} embedded lockContext clusterId={clusterId} token={accessToken!} initialKind={editor.kind} initialVersion={editor.kind === 'Ingress' ? 'networking.k8s.io/v1' : 'v1'} initialNamespace={namespace} initialYaml={editor.original} initialDraftYaml={editor.yaml} initialMode="form" readOnly={!writable} returnTo="/clusters" resourceOptions={resourceTypes} onDraftChange={setDraft} validateDraft={validateDraft} onClose={() => setEditor(null)} onSaved={() => { setEditor(null); void client.invalidateQueries({ queryKey: ['resource-access', clusterId, namespace] }); }}/>
      </div>}
    </OpsDrawerShell>
  </Space>;
}
