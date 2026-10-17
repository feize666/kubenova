"use client";

import { CopyOutlined, DownloadOutlined, EditOutlined, EyeInvisibleOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { useRef, useState, type RefObject } from 'react';
import { Alert, Space, Typography } from 'antd';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { getDynamicResourceDetail, getResourceYaml, type DynamicResourceIdentity, type ResourceIdentity } from '@/lib/api/resources';
import { OpsDrawerShell, OpsIconActionButton, OpsLoadingState } from '@/components/ops';
import { EditorDocument } from '@/components/resource-editor/resource-editor-page';
import { embeddedYamlContext } from '@/lib/embedded-yaml-editor';
import { useAuth } from '@/components/auth-context';
import { YamlCodeEditor } from './resource-editor/yaml-code-editor';
import { useOptionalResourceEditBoundary } from './resource-editor/resource-edit-boundary';
import { useReadAccess } from '@/lib/query/read-access-state';

interface ResourceYamlDrawerProps {
  open: boolean;
  onClose: () => void;
  token?: string;
  identity: ResourceIdentity | null;
  dynamicIdentity?: DynamicResourceIdentity | null;
  onUpdated?: () => void;
  readOnly?: boolean;
  maskSensitive?: boolean;
  embedded?: boolean;
}

// Embedded details edit in place, reusing the same dry-run/preview write path.
export function ResourceYamlDrawer(props: ResourceYamlDrawerProps) {
  const localLeaveRef=useRef<((action:()=>void)=>void)|null>(null);
  const boundary=useOptionalResourceEditBoundary();
  const leaveRequestRef=props.embedded&&boundary?boundary.ref:localLeaveRef;
  const content=<YamlPreview key={JSON.stringify([props.identity,props.dynamicIdentity])} {...props} leaveRequestRef={leaveRequestRef}/>;
  if(props.embedded)return content;
  return <OpsDrawerShell title={`YAML · ${props.identity?.name??props.dynamicIdentity?.name??'资源'}`} open={props.open} destroyOnHidden size="large" variant="resource" onClose={()=>{if(leaveRequestRef.current)leaveRequestRef.current(props.onClose);else props.onClose();}}>{content}</OpsDrawerShell>;
}

function YamlPreview({open,token,identity,dynamicIdentity,readOnly,onUpdated,leaveRequestRef}:ResourceYamlDrawerProps & {leaveRequestRef:RefObject<((action:()=>void)=>void)|null>}) {
  const {role}=useAuth();
  const client=useQueryClient();
  const [editing,setEditing]=useState(false);
  const [editingYaml,setEditingYaml]=useState('');
  const [saved,setSaved]=useState(false);
  const [visible,setVisible] = useState(false);
  const [error,setError] = useState('');
  const queryKey=['resource-yaml-preview',identity,dynamicIdentity,token];
  const query = useQuery({
    queryKey,
    queryFn:async ({signal})=>{
      const result=dynamicIdentity?await getDynamicResourceDetail(dynamicIdentity,token,{signal}):await getResourceYaml(identity!,token,{signal});
      return {yaml:result.yaml};
    },
    enabled:open&&!!token&&!!(identity||dynamicIdentity),
    gcTime:0,refetchOnWindowFocus:false,retry:false,
  });
  const permissionDenied = useReadAccess(hashKey(queryKey),query);
  const yaml = permissionDenied ? '' : query.data?.yaml ?? '';
  const editorYaml = editing ? editingYaml : yaml;
  const sensitive = /secret/i.test(identity?.kind ?? dynamicIdentity?.resource ?? '') || /^kind:\s*Secret\b/im.test(yaml);
  const hidden = sensitive&&!visible;
  const unavailable = !yaml || hidden;
  const editorIdentity=identity??(dynamicIdentity?{clusterId:dynamicIdentity.clusterId,kind:dynamicIdentity.resource,name:dynamicIdentity.name,namespace:dynamicIdentity.namespace??''}:null);
  const context=editorIdentity?embeddedYamlContext(editorYaml,editorIdentity,dynamicIdentity):null;
  const canEdit=!readOnly&&['admin','platform-admin','operator','cluster-operator'].includes(role.trim().toLowerCase());
  if(editing&&context&&token)return <Space orientation="vertical" size={12} style={{width:'100%'}}>
    {!permissionDenied&&<Space wrap>
      <OpsIconActionButton icon={<ReloadOutlined/>} aria-label="刷新 YAML" loading={query.isFetching} onClick={()=>void query.refetch({cancelRefetch:false})}>刷新 YAML</OpsIconActionButton>
    </Space>}
    {query.error&&!permissionDenied&&<Alert showIcon type="warning" title="资源刷新失败，已保留当前草稿" description={query.error.message}/>}
    <EditorDocument embedded lockContext leaveRequestRef={leaveRequestRef} clusterId={context.clusterId} token={token} initialKind={context.kind} initialVersion={context.apiVersion} initialNamespace={context.namespace} initialNamespaced={context.namespaced} resource={context.resource} initialYaml={editorYaml} initialMode="yaml" readOnly={!canEdit} readUnavailable={permissionDenied} onRetryRead={()=>void query.refetch({cancelRefetch:false})} returnTo="" resourceOptions={[]} onClose={()=>setEditing(false)} onSaved={()=>{setEditing(false);setSaved(true);void query.refetch({cancelRefetch:false});void client.invalidateQueries({queryKey:['resource-detail']});onUpdated?.();}}/>
  </Space>;
  return <Space orientation="vertical" size={16} style={{width:'100%'}}>
    <Space wrap>
      <Typography.Text type="secondary">在当前详情面板编辑，校验并预览后保存。</Typography.Text>
      {canEdit&&<OpsIconActionButton icon={<EditOutlined/>} disabled={!query.data||permissionDenied||!context||hidden} onClick={()=>{setSaved(false);setEditingYaml(yaml);setEditing(true);}}>编辑 YAML</OpsIconActionButton>}
      <OpsIconActionButton icon={<ReloadOutlined/>} aria-label="刷新 YAML" loading={query.isFetching} onClick={()=>void query.refetch({cancelRefetch:false})}>刷新 YAML</OpsIconActionButton>
      {sensitive&&<OpsIconActionButton icon={visible?<EyeInvisibleOutlined/>:<EyeOutlined/>} onClick={()=>setVisible(!visible)}>{visible?'隐藏敏感内容':'显示敏感内容'}</OpsIconActionButton>}
      <OpsIconActionButton icon={<CopyOutlined/>} disabled={unavailable} onClick={()=>void navigator.clipboard.writeText(yaml).catch(()=>setError('复制失败，请重试'))}>复制</OpsIconActionButton>
      <OpsIconActionButton icon={<DownloadOutlined/>} disabled={unavailable} onClick={()=>{
        const url=URL.createObjectURL(new Blob([yaml],{type:'application/yaml;charset=utf-8'}));
        const link=document.createElement('a');link.href=url;link.download=((identity?.name??dynamicIdentity?.name??'resource').replace(/[^a-zA-Z0-9._-]/g,'-'))+'.yaml';
        link.click();URL.revokeObjectURL(url);
      }}>下载 YAML</OpsIconActionButton>
    </Space>
    {saved&&<Alert showIcon type="success" title="YAML 已保存"/>}
    {query.isLoading&&<OpsLoadingState compact title="正在读取 YAML"/>}
    {(error||query.error)&&<Alert showIcon type={permissionDenied?'warning':'error'} title={permissionDenied?'无权读取 YAML':error||query.error?.message} description={permissionDenied?'当前资源内容已隐藏，恢复访问后可重试。':undefined}/>}
    {hidden?<Alert type="info" title="Secret 内容已隐藏，显示敏感内容后才可查看、复制或下载。"/>:<YamlCodeEditor ariaLabel="YAML 只读预览" value={yaml} readOnly embedded/>}
  </Space>;
}
