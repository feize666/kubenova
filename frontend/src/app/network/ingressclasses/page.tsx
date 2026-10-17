'use client';
import { useResourceDetailState } from "@/hooks/use-resource-detail-state";
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';

import { Alert, Button, Modal, Space, Table, Tag, Typography, message } from 'antd';
import { useSearchParams } from 'next/navigation';
import { useState } from 'react';
import { useAuth } from '@/components/auth-context';
import { useOptionalClusterWorkspace } from '@/components/cluster-workspace-context';
import { ClusterSelect } from '@/components/cluster-select';
import { ResourcePageHeader } from '@/components/resource-page-header';
import { ResourceAddButton } from '@/components/resource-add-button';
import { ResourceTable } from '@/components/resource-table';
import { ResourceActionDropdown } from '@/components/resource-action-bar';
import { ResourceDetailDrawer } from '@/components/resource-detail/resource-detail-drawer';
import { ResourceYamlDrawer } from '@/components/resource-yaml-drawer';
import { OpsSurface } from '@/components/ops';
import { useResourceEditorNavigation } from '@/hooks/use-resource-editor-navigation';
import { getClusters } from '@/lib/api/clusters';
import { buildDynamicResourceDetailRequest, type ResourceDetailRequest } from '@/lib/api/resources';
import { getIngressClasses, getIngressClassImpact, removeIngressClass, setDefaultIngressClass, type IngressClassItem } from '@/lib/api/ingressclasses';

export default function IngressClassesPage() {
  const workspace = useOptionalClusterWorkspace();
  const params = useSearchParams();
  const { accessToken, role } = useAuth();
  const [selectedCluster, setSelectedCluster] = useState(params.get('clusterId') ?? '');
  const clusterId = workspace?.clusterId || selectedCluster;
  const [keyword, setKeyword] = useState('');
  const [detail, setDetail, detailUrlSession] = useResourceDetailState();
  const [yamlName, setYamlName] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState('');
  const openEditor = useResourceEditorNavigation();
  const canWrite = ['admin', 'platform-admin', 'operator', 'cluster-operator'].includes(role.toLowerCase());
  const clusters = useResourceListQuery({ queryKey: ['ingressclass-clusters', accessToken], queryFn: ({ signal }) => getClusters({ pageSize: 200 }, accessToken, { signal }), enabled: !!accessToken && !workspace });
  const list = useResourceListQuery({ queryKey: ['ingressclasses', clusterId, accessToken], queryFn: ({ signal }) => getIngressClasses(clusterId, accessToken, signal), enabled: !!clusterId && !!accessToken, retry: false });
  const identity = (name: string) => ({ clusterId, group: 'networking.k8s.io', version: 'v1', resource: 'ingressclasses', name });
  const fail = (error: unknown) => setActionError(error instanceof Error ? error.message : '操作失败，请刷新核对实际状态');
  async function perform(row: IngressClassItem, action: 'default' | 'delete') {
    setBusy(true); setActionError('');
    try {
      const impact = await getIngressClassImpact(clusterId, row.name, accessToken);
      const expected = Object.fromEntries([impact.target, ...impact.defaults].map(item => [item.name, item.resourceVersion]));
      if (action === 'default') await setDefaultIngressClass({ clusterId, name: row.name, expected, dryRun: true }, accessToken);
      Modal.confirm({
        title: action === 'default' ? `将 ${row.name} 设为默认类？` : `删除 ${row.name}？`,
        width: 620, autoFocusButton: 'cancel',
        content: <Space orientation="vertical" style={{ width: '100%' }}>
          {action === 'default' ? <Typography.Paragraph>将取消 {impact.defaults.filter(item => item.name !== row.name).map(item => item.name).join('、') || '无其他默认类'} 的默认标记。已有 Ingress 不迁移。</Typography.Paragraph> : <Typography.Paragraph>删除不会安装、卸载或迁移控制器。引用此类的路由可能受影响。</Typography.Paragraph>}
          {impact.references.length > 0 && <><Alert type="warning" title={`${impact.references.length} 个 Ingress 引用此类`}/><Table size="small" rowKey={item => item.namespace+'/'+item.name} dataSource={impact.references} columns={[{ title: '命名空间', dataIndex: 'namespace' }, { title: 'Ingress', dataIndex: 'name' }]} pagination={{ pageSize: 5 }}/></>}
        </Space>,
        okText: action === 'default' ? '确认设为默认' : impact.references.length ? '强制删除' : '确认删除',
        okButtonProps: { danger: action === 'delete', disabled: action === 'delete' && impact.references.length > 0 && !['admin', 'platform-admin'].includes(role.toLowerCase()) },
        cancelText: '取消',
        onOk: async () => {
          try {
            if (action === 'default') await setDefaultIngressClass({ clusterId, name: row.name, expected, dryRun: false }, accessToken);
            else await removeIngressClass({ clusterId, name: row.name, resourceVersion: impact.target.resourceVersion, force: impact.references.length > 0 }, accessToken);
            message.success(action === 'default' ? '默认类已更新' : 'IngressClass 已删除');
            await list.refetch();
          } catch (error) { fail(error); await list.refetch(); throw error; }
        },
      });
    } catch (error) { fail(error); } finally { setBusy(false); }
  }
  const rows = (list.data?.items ?? []).filter(item => `${item.name} ${item.controller}`.toLowerCase().includes(keyword.toLowerCase()));
  return <Space orientation="vertical" size={16} style={{ width: '100%' }}>
    <ResourcePageHeader path="/network/ingressclasses"/>
    {actionError && <Alert type="error" title="操作未完成" description={actionError} closable onClose={() => setActionError('')}/>}
    <ResourceQueryFeedback label="IngressClass" query={list}/>
    {list.data && list.data.items.filter(item => item.isDefault).length > 1 && <Alert type="warning" title="存在多个默认 IngressClass，请明确选择或重新设置默认类"/>}
    <OpsSurface><ResourceTable<IngressClassItem> onResourceNavigate={setDetail} queryState={list}
      toolbarPrimary={<><ResourceAddButton compact={false} label="创建" disabled={!canWrite || !clusterId} editorKind="IngressClass" title="创建 IngressClass"/><ResourceAddButton compact={false} label="YAML 创建" editorMode="yaml" disabled={!canWrite || !clusterId} editorKind="IngressClass" title="使用 YAML 创建 IngressClass"/></>}
      toolbarExtra={<>{!workspace && <ClusterSelect value={clusterId} onChange={setSelectedCluster} showAllOption={false} allowClear={false} options={(clusters.data?.items ?? []).map(item => ({ label: item.name, value: item.id }))}/>}<Button onClick={() => void list.refetch()} disabled={!clusterId || busy} loading={list.isFetching}>刷新</Button></>}
      globalSearch={{ value: keyword, onChange: setKeyword, placeholder: '搜索名称或控制器' }}
      tableKey="network-ingressclasses" rowKey="name" loading={list.isLoading} dataSource={rows} pagination={{ defaultPageSize: 25, pageSizeOptions: [10, 25, 50, 100], showSizeChanger: true }} locale={{ emptyText: clusterId ? '当前没有匹配的 IngressClass' : '请先选择集群' }} columns={[
      { key: 'name', title: '名称', dataIndex: 'name', width: 240, render: (_, row) => <Button type="link" onClick={() => setDetail(buildDynamicResourceDetailRequest(identity(row.name), 'IngressClass'))}>{row.name}</Button> },
      { key: 'controller', title: '控制器', dataIndex: 'controller', width: 300 },
      { key: 'isDefault', title: '默认类', dataIndex: 'isDefault', width: 100, render: value => value ? <Tag color="blue">默认</Tag> : '—' },
      { key: 'parameters', title: '参数引用', dataIndex: 'parameters', width: 240, render: value => value ? `${value.kind} / ${value.namespace ? value.namespace+'/' : ''}${value.name}` : '—' },
      { key: 'createdAt', title: '创建时间', dataIndex: 'createdAt', width: 190, render: value => value ? new Date(value).toLocaleString() : '—' },
      { title: '操作', key: 'actions', width: 100, align: 'center', render: (_, row) => <ResourceActionDropdown actions={[
        { key: 'edit', label: '编辑', disabled: !canWrite || busy, onClick: () => openEditor({ ...identity(row.name), kind: 'IngressClass', apiVersion: 'networking.k8s.io/v1' }) },
        { key: 'yaml', label: 'YAML', onClick: () => setYamlName(row.name) },
        { key: 'default', label: '设为默认', disabled: !canWrite || busy || row.isDefault, onClick: () => void perform(row, 'default') },
        { key: 'delete', label: '删除', danger: true, disabled: !canWrite || busy, onClick: () => void perform(row, 'delete') },
      ]}/> },
    ]}/></OpsSurface>
    <ResourceDetailDrawer key={detailUrlSession} open={!!detail} request={detail} token={accessToken} onNavigateRequest={setDetail} onClose={() => setDetail(null)}/>
    <ResourceYamlDrawer open={yamlName !== null} onClose={() => setYamlName(null)} identity={null} dynamicIdentity={yamlName ? identity(yamlName) : null} token={accessToken} readOnly={!canWrite} onUpdated={() => { void list.refetch(); }}/>
  </Space>;
}
