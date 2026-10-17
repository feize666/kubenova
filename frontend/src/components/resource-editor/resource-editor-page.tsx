'use client';

import { CopyOutlined, UploadOutlined } from '@ant-design/icons';
import { Alert, Button, Form, Input, Modal, Space, Steps, Table, Tabs, Tag, Typography, message } from 'antd';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from '@/components/auth-context';
import { useOptionalClusterWorkspace } from '@/components/cluster-workspace-context';
import { ClusterSelect } from '@/components/cluster-select';
import { OpsSurface, OpsLoadingState, OpsPermissionState } from '@/components/ops';
import { getClusters } from '@/lib/api/clusters';
import { getDynamicResourceDetail, getResourceDiscoveryCatalog, getResourceYaml } from '@/lib/api/resources';
import { ApiError } from '@/lib/api/client';
import { getResourceEditorSchema, submitResourceEditor, type EditorSubmitPayload, type EditorSubmitResult } from '@/lib/api/resource-editor';
import { createResourceDraft, editorResourceType, parseResourceDocuments, resourceChanges, resourceFingerprint, safeEditorReturnTo, sanitizeResourceManifest, serializeResourceDocuments, setManifestValue, validateResourceDraft, WORKLOAD_KINDS, type ResourceManifest } from '@/lib/resource-editor';
import { WorkloadResourceForm } from './workload-resource-form';
import { NativeResourceForm, supportsNativeResourceForm } from './native-resource-form';
import { NativeMapInput } from './native-controls';
import { SchemaResourceForm, validateResourceSchema } from './schema-resource-form';
import styles from './resource-editor-page.module.css';
import { resolveWorkspaceResourceHref } from '@/lib/cluster-workspace';
import { validateWorkloadStep, workloadStepTransition } from './workload-step-validation';
import { createEditorLeaveGuard, editorInternalLink } from './editor-leave-guard';
import { createEditorDraftStore, type EditorDraft } from '@/lib/resource-editor-drafts';
import { ResourceConflictDialog, type ResourceComparison } from './resource-conflict-dialog';
import { YamlCodeEditor } from './yaml-code-editor';
import { editorReadAccess } from './editor-read-state';
import { useResourceListQuery } from '@/hooks/use-resource-list-query';
import { ResourceQueryFeedback } from '@/components/resource-query-feedback';

export default function ResourceEditorPage() {
  const params = useSearchParams();
  const workspace = useOptionalClusterWorkspace();
  const {accessToken,isInitializing,role,username} = useAuth();
  const [selectedCluster,setSelectedCluster] = useState(params.get('clusterId')??'');
  const leaveRequestRef = useRef<((action:()=>void)=>void)|null>(null);
  const fixedClusterId = workspace?.clusterId || params.get('clusterId') || '';
  const clusterId = fixedClusterId || selectedCluster;
  const kind = params.get('kind') || 'Deployment';
  const name = params.get('name') || '';
  const namespace = params.get('namespace') || 'default';
  const definition = editorResourceType(kind);
  const apiVersion = params.get('apiVersion') || definition?.apiVersion || '';
  const resource = params.get('resource') || definition?.resource;
  const apiParts = apiVersion.split('/');
  const clusters = useResourceListQuery({queryKey:['resource-editor-clusters',accessToken],queryFn:({signal})=>getClusters({pageSize:200,state:'active'},accessToken,{signal}),enabled:!!accessToken&&!fixedClusterId,retry:false});
  const catalog = useResourceListQuery({queryKey:['resource-editor-catalog',clusterId,accessToken],queryFn:()=>getResourceDiscoveryCatalog(clusterId,accessToken),enabled:!!clusterId&&!!accessToken,retry:false});
  const discoveredType = catalog.data?.items.find(item=>item.resource===resource&&(item.group?item.group+'/'+item.version:item.version)===apiVersion);
  const namespaced = discoveredType?.namespaced ?? definition?.namespaced;
  const detail = useQuery({
    queryKey:['resource-editor-original',clusterId,apiVersion,resource,kind,namespace,name,accessToken],
    queryFn:async ({signal})=>{
      if (!definition && resource && apiVersion) return getDynamicResourceDetail({clusterId,group:apiParts.length>1?apiParts[0]:undefined,version:apiParts.at(-1)!,resource,name,namespace:namespaced===false?undefined:namespace},accessToken,{signal});
      return getResourceYaml({clusterId,kind,name,namespace:namespaced===false?'':namespace},accessToken,{signal});
    },
    enabled:!!name&&!!clusterId&&!!accessToken&&(!!definition||!catalog.isPending),refetchOnWindowFocus:false,refetchOnReconnect:false,retry:false,gcTime:0,
  });
  const initialError = useMemo(()=>{try {if(detail.data?.yaml)parseResourceDocuments(detail.data.yaml);return '';}catch(err){return err instanceof Error?err.message:'服务器返回了无效资源';}},[detail.data?.yaml]);
  const readOnly = params.get('readOnly')==='true' || !['admin','platform-admin','operator','cluster-operator'].includes(role.trim().toLowerCase());
  const editorIdentity=[username,clusterId,kind,apiVersion,resource,name,namespace].join('/');
  const [readAccess,setReadAccess]=useState({scope:editorIdentity,denied:false});
  const nextReadAccess=editorReadAccess(readAccess,editorIdentity,detail.error);
  if(nextReadAccess.scope!==readAccess.scope||nextReadAccess.denied!==readAccess.denied)setReadAccess(nextReadAccess);
  const readUnavailable=nextReadAccess.denied || !catalog.data || (!fixedClusterId&&!clusters.data);
  const retryRead=()=>{void catalog.refetch({cancelRefetch:false});if(!fixedClusterId)void clusters.refetch({cancelRefetch:false});if(name)void detail.refetch({cancelRefetch:false});};
  if (isInitializing || !accessToken) return <OpsLoadingState title="加载编辑器" description="正在验证登录状态…"/>;
  if (name && detail.isPending && clusterId) return <OpsLoadingState title="读取资源" description="正在读取资源的当前版本…"/>;
  if (detail.error&&!detail.data) return <Alert type="error" showIcon title="无法加载资源" description={<Space orientation="vertical">{detail.error.message}<Button onClick={()=>void detail.refetch()}>重试</Button></Space>}/>;
  if (initialError) return <Alert type="error" showIcon title="资源数据无法解析" description={initialError}/>;
  return <div className={`${styles.page} ${styles.workspace}`}>
    <div className={styles.header}><div><Typography.Title level={3} style={{margin:0}}>资源编辑器</Typography.Title><Typography.Text type="secondary">表单与 YAML 共用草稿，提交前校验并确认变更</Typography.Text></div></div>
    {!fixedClusterId&&<OpsSurface title="目标集群"><ClusterSelect value={clusterId} onChange={next=>{if(next===clusterId)return;const change=()=>setSelectedCluster(next);if(leaveRequestRef.current)leaveRequestRef.current(change);else change();}} disabled={!!name} unavailable={!clusters.data&&!clusters.isPending} placeholder="请选择集群" showAllOption={false} allowClear={false} options={(clusters.data?.items??[]).map(item=>({label:item.name,value:item.id}))} loading={clusters.isPending}/>{clusters.error&&<Alert type="error" title={clusters.error.message}/>}</OpsSurface>}
    {detail.error&&detail.data&&!readUnavailable&&<Alert type="warning" showIcon title="资源刷新失败，已保留当前草稿" description={<Space orientation="vertical">{detail.error.message}<Button onClick={()=>void detail.refetch({cancelRefetch:false})}>重试</Button></Space>}/>}
    {clusterId && (!name||detail.data) ? (!definition&&catalog.isPending?<OpsLoadingState title="读取资源类型"/>:<EditorDocument draftUsername={username} leaveRequestRef={leaveRequestRef} key={editorIdentity} clusterId={clusterId} token={accessToken} initialKind={kind} initialVersion={apiVersion} initialNamespace={namespace} initialYaml={detail.data?.yaml} resource={resource} initialNamespaced={namespaced} initialMode={params.get('mode')==='yaml'?'yaml':'form'} readOnly={readOnly} readUnavailable={readUnavailable} readUnavailableTitle={nextReadAccess.denied?undefined:'编辑上下文暂不可用'} onRetryRead={retryRead} returnTo={safeEditorReturnTo(params.get('returnTo'))} resourceOptions={catalog.data?.items.filter(item=>['create','update','patch'].some(verb=>item.verbs.includes(verb))&&!['Node','Event','ComponentStatus','Binding'].includes(item.kind)).map(item=>({kind:item.kind,apiVersion:item.group?item.group+'/'+item.version:item.version,resource:item.resource,namespaced:item.namespaced}))??[]}/>) : <Alert type="info" title="选择一个集群后开始编辑。"/>}
  </div>;
}

export interface EditorDocumentProps {
  clusterId:string;token:string;initialKind:string;initialVersion:string;initialNamespace:string;initialYaml?:string;initialDraftYaml?:string;initialNamespaced?:boolean;resource?:string;initialMode:'form'|'yaml';readOnly:boolean;returnTo:string;
  resourceOptions:Array<{kind:string;apiVersion:string;resource:string;namespaced:boolean}>;
  embedded?:boolean;onClose?:()=>void;onSaved?:(result:EditorSubmitResult)=>void;lockContext?:boolean;draftUsername?:string;
  onDraftChange?:(manifest:ResourceManifest)=>void;validateDraft?:(manifest:ResourceManifest)=>string[];
  leaveRequestRef?:RefObject<((action:()=>void)=>void)|null>;
  readUnavailable?:boolean;
  readUnavailableTitle?:string;
  onRetryRead?:()=>void;
}

export function EditorDocument({clusterId,token,initialKind,initialVersion,initialNamespace,initialYaml,initialDraftYaml,initialNamespaced,resource,initialMode,readOnly,returnTo,resourceOptions,embedded=false,onClose,onSaved,lockContext=false,onDraftChange,validateDraft,leaveRequestRef,draftUsername,readUnavailable=false,readUnavailableTitle,onRetryRead}:EditorDocumentProps) {
  const router = useRouter();
  const [leaveModal,leaveModalContext] = Modal.useModal();
  const client = useQueryClient();
  const initial = useMemo(()=>initialYaml ? [sanitizeResourceManifest(parseResourceDocuments(initialYaml)[0],'edit')] : initialDraftYaml?parseResourceDocuments(initialDraftYaml).map(item=>sanitizeResourceManifest(item,'create')):[createResourceDraft(initialKind,initialNamespace,initialVersion,initialNamespaced)],[initialYaml,initialDraftYaml,initialKind,initialNamespace,initialVersion,initialNamespaced]);
  const [original,setOriginal] = useState<ResourceManifest|undefined>(initialYaml?initial[0]:undefined);
  const [yaml,setYaml] = useState(()=>serializeResourceDocuments(initial));
  const [baseline,setBaseline] = useState(()=>resourceFingerprint(initial));
  const [mode,setMode] = useState(initialMode);
  const [step,setStep] = useState(0);
  const [busy,setBusy] = useState(false);
  const [error,setError] = useState('');
  const [success,setSuccess] = useState('');
  const [preview,setPreview] = useState<{yaml:string;fingerprint:string;payload:EditorSubmitPayload}|null>(null);
  const [sensitiveVisible,setSensitiveVisible] = useState(false);
  const [partialBlocked,setPartialBlocked] = useState(false);
  const [partialDetails,setPartialDetails] = useState<Array<{key:string;message:string}>>([]);
  const [metadataRevision,setMetadataRevision] = useState(0);
  const [validationAttempted,setValidationAttempted] = useState(false);
  const [validationStep,setValidationStep] = useState<number|null>(null);
  const draftStore=useMemo(()=>createEditorDraftStore(()=>window.localStorage),[]);
  const draftScope=useMemo(()=>({username:draftUsername??'',clusterId,kind:initialKind,apiVersion:initialVersion,resource:resource??editorResourceType(initialKind)?.resource??'',namespace:initialNamespace,name:initialYaml?initial[0].metadata.name??'':''}),[draftUsername,clusterId,initialKind,initialVersion,resource,initialNamespace,initialYaml,initial]);
  const [pendingDraft,setPendingDraft]=useState<EditorDraft|null>(null);
  const [draftChecked,setDraftChecked]=useState(false);
  const [draftSaved,setDraftSaved]=useState(false);
  const [restoredEdit,setRestoredEdit]=useState(false);
  const [comparison,setComparison]=useState<ResourceComparison|null>(null);
  const [comparisonDenied,setComparisonDenied]=useState(false);
  const accessUnavailable=readUnavailable||comparisonDenied;
  const upload = useRef<HTMLInputElement>(null);
  const editorScope = useRef<HTMLDivElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const isEdit = !!original;
  const parsing = useMemo(()=>{try {return {documents:parseResourceDocuments(yaml),error:''};} catch(err) {return {documents:[] as ResourceManifest[],error:err instanceof Error?err.message:'YAML 无法解析'};}},[yaml]);
  const manifest = parsing.documents[0];
  const fingerprint = parsing.documents.length?resourceFingerprint(parsing.documents):yaml;
  const dirty = fingerprint!==baseline;
  const sensitive = parsing.documents.some(item=>item.kind==='Secret');
  const persistAllowed=!embedded&&!readOnly&&!partialBlocked&&!!token&&!!draftUsername&&(!initialYaml||!!original);
  const persistence=useRef({yaml,original,persistAllowed,dirty,draftChecked,pendingDraft,success});
  persistence.current={yaml,original,persistAllowed,dirty,draftChecked,pendingDraft,success};
  const flushDraft=useCallback(()=>{
    const current=persistence.current;
    if(!current.draftChecked||current.pendingDraft)return false;
    if(!current.persistAllowed){draftStore.clear(draftScope);return false;}
    if(!current.dirty||current.success)return false;
    return draftStore.save(draftScope,{yaml:current.yaml,originalYaml:current.original?serializeResourceDocuments([current.original]):undefined},current.persistAllowed);
  },[draftStore,draftScope]);
  useEffect(()=>{setPendingDraft(persistAllowed?draftStore.read(draftScope):null);setDraftChecked(true);},[draftStore,draftScope,persistAllowed]);
  useEffect(()=>{
    setDraftSaved(false);
    if(!draftChecked||pendingDraft)return;
    // Purge stale ordinary content immediately when YAML becomes invalid or sensitive.
    if(!persistAllowed||parsing.error||sensitive){draftStore.clear(draftScope);return;}
    if(!dirty||success)return;
    const timer=window.setTimeout(()=>setDraftSaved(flushDraft()),600);
    return()=>window.clearTimeout(timer);
  },[yaml,original,persistAllowed,draftChecked,pendingDraft,dirty,success,parsing.error,sensitive,draftStore,draftScope,flushDraft]);
  useEffect(()=>{const flush=()=>{flushDraft();};window.addEventListener('pagehide',flush);window.addEventListener('beforeunload',flush);return()=>{window.removeEventListener('pagehide',flush);window.removeEventListener('beforeunload',flush);flush();};},[flushDraft]);
  const expectedKind = editorResourceType(initialKind)?.kind ?? initialKind;
  const typeMismatch = parsing.documents.some(item=>item.kind!==expectedKind);
  const isWorkload = !!manifest && WORKLOAD_KINDS.has(manifest.kind);
  const native = !!manifest && supportsNativeResourceForm(manifest.kind);
  const definition = manifest && editorResourceType(manifest.kind);
  const discovered = resourceOptions.find(item=>item.kind===manifest?.kind&&item.apiVersion===manifest.apiVersion);
  const schema = useResourceListQuery({queryKey:['resource-editor-schema',clusterId,manifest?.apiVersion,manifest?.kind,manifest?.metadata.namespace,token],queryFn:({signal})=>getResourceEditorSchema({clusterId,kind:manifest.kind,apiVersion:manifest.apiVersion,namespace:manifest.metadata.namespace,resource:discovered?.resource??definition?.resource??resource},token,signal),enabled:!!manifest&&!typeMismatch&&!native&&!isWorkload,retry:false});
  const schemaIssues = schema.data?.schema ? validateResourceSchema(schema.data.schema) : [];
  const canForm = !typeMismatch && parsing.documents.length===1 && (native||isWorkload||!!schema.data?.schema&&!schemaIssues.length);
  const validation = parsing.error?[parsing.error]:[...validateResourceDraft(parsing.documents,isEdit?'edit':'create',original,expectedKind), ...(manifest?validateDraft?.(manifest)??[]:[])];
  const visibleValidation = validationAttempted ? validation : mode==='form'&&!isEdit&&manifest&&validationStep!==null ? validateWorkloadStep(manifest,validationStep) : [];
  useEffect(()=>{if(manifest)onDraftChange?.(manifest);},[manifest,onDraftChange]);
  const manager = manifest?.metadata.labels && (manifest.metadata.labels as Record<string,unknown>)['app.kubernetes.io/managed-by'];
  const managed = manager || manifest?.metadata.ownerReferences || (manifest?.metadata.annotations && Object.keys(manifest.metadata.annotations as object).some(key=>/argocd|fluxcd|helm/.test(key)));
  const changeRows = preview ? parsing.documents.flatMap((item,index)=>resourceChanges(isEdit?original:undefined,item).map((change,i)=>({...change,key:index+':'+i,document:item.kind+'/'+item.metadata.name}))) : [];

  const changeYaml = (next:string)=>{setYaml(next);setPreview(null);setError('');setSuccess('');};
  const updateManifest = (value:ResourceManifest)=>changeYaml(serializeResourceDocuments([value]));
  // Required-field markers are validation errors, not unapplied user input.
  const pendingInput = ()=>editorScope.current?.querySelector<HTMLElement>('[data-resource-editor-pending="true"]:not(.ant-form-item):not(.ant-form-item-row):not(.ant-alert)');
  const leaveState = useRef({dirty,busy,saved:!!success});
  leaveState.current = {dirty,busy,saved:!!success};
  const requestLeave = useMemo(()=>createEditorLeaveGuard(()=>({...leaveState.current,dirty:leaveState.current.dirty||!!pendingInput(),saved:leaveState.current.saved&&!pendingInput()}),(accept,cancel)=>{
    leaveModal.confirm({title:'离开资源编辑器？',content:'更改尚未提交到服务器。普通草稿会尝试在本浏览器保留 24 小时；Secret、无写入权限或存储不可用时仅留在内存，离开会丢失。',okText:'离开编辑器',cancelText:'继续编辑',autoFocusButton:'cancel',maskClosable:false,onOk:()=>{flushDraft();accept();},onCancel:cancel});
  }),[leaveModal,flushDraft]);
  const leave = useCallback(()=>requestLeave(()=>{if(embedded){onClose?.();return;}router.push(returnTo,{scroll:false});}),[requestLeave,router,returnTo,embedded,onClose]);
  useEffect(()=>{if(!leaveRequestRef)return;leaveRequestRef.current=requestLeave;return()=>{if(leaveRequestRef.current===requestLeave)leaveRequestRef.current=null;};},[leaveRequestRef,requestLeave]);
  function locateError(item:string) {
    if(mode==='yaml'||!canForm){editorScope.current?.querySelector<HTMLElement>('[data-yaml-code-editor] .cm-content')?.focus();return;}
    const targetStep = /容器|镜像|container/.test(item)?1:/metadata|名称|命名空间/.test(item)?0:step;
    setStep(targetStep);
    requestAnimationFrame(()=>{
      const section=editorScope.current?.querySelector<HTMLElement>(`[data-editor-section="${targetStep}"]`) ?? editorScope.current;
      const containerField = /^(容器|initContainers)\[(\d+)\]容器(名称|镜像)/.exec(item);
      const preciseField = containerField ? section?.querySelector<HTMLElement>(`[data-editor-field$=".${containerField[1]==='容器'?'containers':'initContainers'}.${containerField[2]}.${containerField[3]==='名称'?'name':'image'}"] input`) : null;
      const field = preciseField ?? (/metadata.name|资源名称/.test(item)?section?.querySelector<HTMLElement>('[aria-label="资源名称"]')
        : /metadata.namespace|命名空间/.test(item)?section?.querySelector<HTMLElement>('[aria-label="命名空间"], [aria-label="资源命名空间"]')
        : section?.querySelector<HTMLElement>('[aria-label="镜像"], input:not([disabled]), textarea, .ant-select-selector'));
      let parent=field?.parentElement;
      while(parent&&parent!==section){if(parent instanceof HTMLDetailsElement)parent.open=true;parent=parent.parentElement;}
      const tabId=field?.closest('[role="tabpanel"]')?.getAttribute('aria-labelledby');
      const tab=tabId?document.getElementById(tabId):null;
      const focusField=()=>{field?.scrollIntoView({block:'center',behavior:window.matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});field?.focus();};
      if(tab&&tab.getAttribute('aria-selected')!=='true'){tab.click();requestAnimationFrame(focusField);}else focusField();
    });
  }
  useEffect(()=>{
    const before = (event:BeforeUnloadEvent)=>{if((!leaveState.current.dirty||leaveState.current.saved)&&!pendingInput()&&!leaveState.current.busy)return;event.preventDefault();event.returnValue='';};
    const click = (event:MouseEvent)=>{
      if((!leaveState.current.dirty||leaveState.current.saved)&&!pendingInput()&&!leaveState.current.busy)return;
      const target=event.target instanceof Element?event.target:event.target instanceof Node?event.target.parentElement:null;
      const anchor=target?.closest('a[href]');if(!anchor)return;
      const href=editorInternalLink({href:anchor.getAttribute('href')??'',target:anchor.getAttribute('target'),download:anchor.hasAttribute('download'),button:event.button,ctrlKey:event.ctrlKey,metaKey:event.metaKey,shiftKey:event.shiftKey,altKey:event.altKey,defaultPrevented:event.defaultPrevented},window.location.href);
      if(href===null)return;
      event.preventDefault();event.stopPropagation();
      requestLeave(()=>router.push(href));
    };
    window.addEventListener('beforeunload',before);document.addEventListener('click',click,true);
    return ()=>{window.removeEventListener('beforeunload',before);document.removeEventListener('click',click,true);};
  },[dirty,success,busy,requestLeave,router]);

  async function validate() {
    if (readOnly||accessUnavailable||busy||partialBlocked) return;
    if(restoredEdit){setError('恢复的草稿基于旧服务器版本。请先对比最新版本并合并，之后重新进行服务端校验。');return;}
    setValidationAttempted(true);
    if(validation.length){requestAnimationFrame(()=>errorSummary.current?.focus({preventScroll:true}));return;}
    const pending=editorScope.current?.querySelector<HTMLElement>('[data-resource-editor-pending="true"]');
    if(pending){setError('请先修正未完成字段，或应用/放弃高级配置草稿，再进行校验。');requestAnimationFrame(()=>errorSummary.current?.focus({preventScroll:true}));return;}
    if(lockContext&&(parsing.documents.length!==1||parsing.documents.some(item=>item.kind!==initialKind||item.metadata.namespace!==initialNamespace))){setError('资源类型和命名空间由当前上下文指定，请恢复后再提交。');return;}
    const submittedYaml = yaml;
    const submittedFingerprint = fingerprint;
    const payload:EditorSubmitPayload={clusterId,namespace:manifest.metadata.namespace,operation:isEdit?'update':'create',yaml:submittedYaml,dryRun:true,...(original?{resourceVersion:original.metadata.resourceVersion,identity:{apiVersion:original.apiVersion,kind:original.kind,name:original.metadata.name!,namespace:original.metadata.namespace,resource:discovered?.resource??definition?.resource??resource}}:{})};
    setBusy(true);setError('');
    try {await submitResourceEditor(payload,token);setPreview({yaml:submittedYaml,fingerprint:submittedFingerprint,payload});}
    catch(err) {setError(err instanceof Error?err.message:'服务端校验失败');requestAnimationFrame(()=>errorSummary.current?.focus({preventScroll:true}));}
    finally {setBusy(false);}
  }
  function changeWorkloadStep(nextStep:number) {
    if (busy||!manifest) return;
    if (nextStep<=step) {setStep(nextStep);setValidationStep(null);setValidationAttempted(false);setError('');return;}
    const pending=editorScope.current?.querySelector<HTMLElement>(`[data-editor-section="${step}"] [data-resource-editor-pending="true"]`);
    setValidationAttempted(false);
    if(pending){setError('请先修正当前步骤未完成的字段，或应用/放弃配置草稿。');requestAnimationFrame(()=>{errorSummary.current?.scrollIntoView({block:'start'});errorSummary.current?.focus({preventScroll:true});});return;}
    const result=workloadStepTransition(manifest,step,nextStep);
    setStep(result.step);setValidationStep(result.errors.length?result.step:null);setError('');
    if(result.errors.length)requestAnimationFrame(()=>{errorSummary.current?.scrollIntoView({block:'start'});errorSummary.current?.focus({preventScroll:true});});
  }
  async function submit() {
    if (!preview || preview.fingerprint!==fingerprint || readOnly || accessUnavailable || busy || partialBlocked) return;
    setBusy(true);setError('');
    try {
      const result = await submitResourceEditor({...preview.payload,dryRun:false},token);
      draftStore.clear(draftScope);setDraftSaved(false);persistence.current.success='saved';
      if(isEdit){const saved={...manifest,metadata:{...manifest.metadata,resourceVersion:result.items[0]?.resourceVersion??manifest.metadata.resourceVersion}};setOriginal(saved);setYaml(serializeResourceDocuments([saved]));setBaseline(resourceFingerprint([saved]));}
      else setBaseline(fingerprint);
      setSuccess(result.message || '资源已保存');setPreview(null);
      await client.invalidateQueries({predicate:query=>!String(query.queryKey[0]).startsWith('resource-editor')});
      void message.success(isEdit?'资源更新成功':'资源创建成功');
      onSaved?.(result);
    } catch(err) {
      setPreview(null);
      const conflict = err instanceof ApiError && err.status===409;
      const partial = err instanceof ApiError && (err.code?.includes('PARTIAL') || /partial|部分成功/i.test(err.message+JSON.stringify(err.details)));
      if (partial) {
        setPartialBlocked(true);
        const details = err.details as {completed?:Array<{kind?:string;name?:string}>;failed?:{kind?:string;name?:string}}|undefined;
        setPartialDetails([...(details?.completed??[]).map((item,index)=>({key:'done'+index,message:'已创建：'+item.kind+'/'+item.name})),...(details?.failed?[{key:'failed',message:'失败：'+details.failed.kind+'/'+details.failed.name}]:[])]);
      }
      setError((err instanceof Error?err.message:'提交失败')+(conflict?'。已保留草稿，请与最新资源对比后重新编辑，不会强制覆盖。':partial?'。已阻止重复提交，请返回列表核对已成功的资源。':''));
    } finally {setBusy(false);}
  }
  async function compareLatest() {
    // Invalid YAML has no safe manifest to merge; preserve it until repaired.
    if (!original || !manifest || parsing.error) return;
    setBusy(true);
    try {
      const parts=original.apiVersion.split('/');
      const plural=resourceOptions.find(item=>item.kind===original.kind&&item.apiVersion===original.apiVersion)?.resource??editorResourceType(original.kind)?.resource??resource;
      const latest = plural?await getDynamicResourceDetail({clusterId,group:parts.length>1?parts[0]:undefined,version:parts.at(-1)!,resource:plural,name:original.metadata.name!,namespace:original.metadata.namespace},token):await getResourceYaml({clusterId,kind:original.kind,name:original.metadata.name!,namespace:original.metadata.namespace||'_cluster'},token);
      const value = sanitizeResourceManifest(parseResourceDocuments(latest.yaml)[0],'edit');
      setComparisonDenied(false);
      setComparison({original,draft:manifest,latest:value});
    } catch(err) {if(err instanceof ApiError&&(err.status===401||err.status===403)){setComparisonDenied(true);setPreview(null);setComparison(null);}setError(err instanceof Error?err.message:'获取最新版本失败');} finally {setBusy(false);}
  }

  if(accessUnavailable)return <div className={`${styles.page} ${styles.document} ${embedded?styles.embedded:''}`}>
    {leaveModalContext}
    <OpsPermissionState title={comparisonDenied?'当前资源读取权限已失效':readUnavailableTitle??'当前资源读取权限已失效'} description="资源内容和写入操作已隐藏。未提交草稿保留在当前编辑会话中，恢复访问后可继续。" action={onRetryRead||comparisonDenied?<Button disabled={busy} onClick={comparisonDenied?()=>void compareLatest():onRetryRead}>重新读取</Button>:undefined}/>
    <div className={styles.footer}><Button disabled={busy} onClick={leave}>{embedded?'取消':'返回'}</Button></div>
  </div>;
  return <div ref={editorScope} className={`${styles.page} ${styles.document} ${embedded?styles.embedded:''}`}>
    {leaveModalContext}
    {comparison&&<ResourceConflictDialog comparison={comparison} onCancel={()=>setComparison(null)} onResolve={merged=>{setRestoredEdit(false);setOriginal(comparison.latest);setBaseline(resourceFingerprint([comparison.latest]));updateManifest(merged);setComparison(null);setMetadataRevision(value=>value+1);}}/>}
    <Modal open={!!pendingDraft} title="发现本浏览器保存的草稿" closable={false} keyboard={false} maskClosable={false} okText="恢复草稿" cancelText="丢弃草稿" onCancel={()=>{draftStore.clear(draftScope);setPendingDraft(null);}} onOk={()=>{
      if(!pendingDraft||!persistAllowed)return;
      if(!draftStore.read(draftScope)){setPendingDraft(null);setError('草稿已过期或不可用，服务器资源未更改。');return;}
      if(initialYaml){
        try{
          const prior=pendingDraft.originalYaml?parseResourceDocuments(pendingDraft.originalYaml)[0]:undefined;
          if(!prior||prior.kind!==initial[0].kind||prior.apiVersion!==initial[0].apiVersion||prior.metadata.name!==initial[0].metadata.name||prior.metadata.namespace!==initial[0].metadata.namespace)throw Error('草稿原始身份不匹配');
          setOriginal(prior);setBaseline(resourceFingerprint([prior]));setRestoredEdit(true);
        }catch{draftStore.clear(draftScope);setPendingDraft(null);setError('旧草稿缺少可验证的原始版本，已丢弃；服务器资源未更改。');return;}
      }
      changeYaml(pendingDraft.yaml);setMode('yaml');setPendingDraft(null);setMetadataRevision(value=>value+1);
    }}>
      <p>保存于 {pendingDraft?new Date(pendingDraft.savedAt).toLocaleString():''}，保留 24 小时。恢复仅替换编辑器内容，不会提交到服务器。</p>
      {initialYaml&&<Alert type="warning" showIcon title="草稿基于旧服务器版本" description="恢复后必须先对比最新版本并合并，再重新执行服务端校验；不会自动覆盖最新资源。"/>}
    </Modal>
    {restoredEdit&&<Alert type="warning" showIcon title="已恢复旧版本草稿，暂不能提交" description="请先对比最新版本，解决冲突并合并后重新校验。" action={<Button disabled={busy} onClick={()=>void compareLatest()}>对比最新版本</Button>}/>}
    {draftSaved&&<Typography.Text type="secondary">普通草稿已保存在本浏览器，24 小时内可恢复；尚未提交服务器。</Typography.Text>}
    {typeMismatch&&<Alert showIcon type="error" title={`当前入口仅支持 ${expectedKind}`} description="导入或编辑的 YAML 必须保持此资源类型；伴生资源请使用专用向导。"/>}
    {readOnly&&<Alert showIcon type="info" title="当前权限仅允许查看，不能校验或提交写入。"/>}
    {Boolean(managed)&&<Alert showIcon type="warning" title="该资源可能由 Helm、Operator 或 GitOps 管理" description="直接修改可能被控制器重新同步覆盖，请确认变更来源。"/>}
    {(error||visibleValidation.length>0)&&<div ref={errorSummary} tabIndex={-1} className={styles.errorSummary}><Alert showIcon type="error" title={error||`有 ${visibleValidation.length} 项需要完善`} description={<div className={styles.errorLinks}>{error?<Button onClick={()=>{const pending=editorScope.current?.querySelector<HTMLElement>('[data-resource-editor-pending="true"]');if(pending){pending.closest('details')?.setAttribute('open','');pending.scrollIntoView({block:'center'});pending.querySelector<HTMLElement>('input,textarea')?.focus();}else locateError(error);}}>定位问题</Button>:visibleValidation.map((item,index)=><Button type="link" key={index} onClick={()=>locateError(item)}>{item}</Button>)}</div>} action={original?<Button disabled={busy||!manifest||!!parsing.error} onClick={()=>void compareLatest()}>对比最新版本</Button>:undefined}/></div>}
    {success&&!embedded&&<Alert showIcon type="success" title={success} action={<Space><Button onClick={()=>setSuccess('')}>继续编辑</Button><Button onClick={leave}>返回资源列表</Button></Space>}/>}
    {partialDetails.length>0&&<Alert type="warning" title="部分创建结果" description={<ul>{partialDetails.map(item=><li key={item.key}>{item.message}</li>)}</ul>}/>}
    {!isEdit&&isWorkload&&<Typography.Text type="secondary">需要同时配置 PVC、Service 或 Ingress？<Button disabled={busy} onClick={()=>requestLeave(()=>router.push(resolveWorkspaceResourceHref(clusterId,'/workloads/create')+'?kind='+encodeURIComponent(manifest.kind)))}>打开伴生资源向导</Button></Typography.Text>}
    <OpsSurface>
      <div className={styles.header}>
        <Space wrap><Typography.Text strong>{isEdit?'编辑':'创建'} · {expectedKind}</Typography.Text>{dirty&&<Tag color="orange">未保存</Tag>}{parsing.documents.length>1&&<Tag>{parsing.documents.length} 个资源（非事务）</Tag>}</Space>
        <Space wrap>{!lockContext&&<Button icon={<UploadOutlined/>} disabled={readOnly||busy} onClick={()=>upload.current?.click()}>导入 YAML</Button>}{isEdit&&!readOnly&&!lockContext&&<Button icon={<CopyOutlined/>} disabled={busy||!manifest} onClick={()=>{if(!window.confirm('复制为新资源将保留配置并清空身份；不会修改原资源。继续？'))return;const copy=sanitizeResourceManifest(manifest,'create');copy.metadata.name='';setOriginal(undefined);setBaseline('');updateManifest(copy);setStep(0);setMetadataRevision(value=>value+1);}}>复制为新资源</Button>}</Space>
      </div>
      <input ref={upload} type="file" accept=".yml,.yaml,.json" hidden onChange={async event=>{const file=event.target.files?.[0];event.target.value='';if(!file)return;if(pendingInput()){setError('请先修正未完成字段，或应用/放弃配置草稿，再导入 YAML。');return;}if(file.size>2_000_000){setError('文件超过 2MB');return;}const text=await file.text();if(pendingInput()){setError('请先修正未完成字段，或应用/放弃配置草稿，再导入 YAML。');return;}changeYaml(text);setMode('yaml');}}/>
      <Tabs activeKey={mode} onChange={value=>{if(pendingInput()){setError('请先修正未完成字段，或应用/放弃配置草稿，再切换编辑模式。');return;}setMode(value as 'form'|'yaml');}} items={[{key:'form',label:'表单',disabled:!canForm},{key:'yaml',label:'YAML'}]}/>
      {!native&&!isWorkload&&<ResourceQueryFeedback query={schema} label="资源 Schema"/>}
      {(mode==='yaml'||!canForm) ? <div className={styles.yaml}>
        {!canForm&&mode==='form'&&<Alert type="info" title={parsing.error||schema.error?.message||schema.data?.reason||(schema.isFetching?'正在读取资源 Schema…':parsing.documents.length>1?'多文档请使用 YAML，每个资源单独校验提交。':'没有可用结构化 Schema，请使用 YAML。')} style={{marginBottom:12}}/>}
        {sensitive&&<Space style={{marginBottom:12}}><Typography.Text type="warning">Secret 内容仅在当前页面内存中处理</Typography.Text><Button onClick={()=>setSensitiveVisible(!sensitiveVisible)}>{sensitiveVisible?'隐藏敏感 YAML':'显示敏感 YAML'}</Button></Space>}
        {sensitive&&!sensitiveVisible?<Alert type="info" title="敏感 YAML 已隐藏，点击显示后可查看或编辑。"/>:<YamlCodeEditor value={yaml} readOnly={readOnly||busy} embedded={embedded} onChange={changeYaml}/>}
      </div> : manifest ? <>
        {isWorkload?<>
          {!isEdit&&<Steps current={step} onChange={changeWorkloadStep} size="small" items={['基本信息','容器配置','高级配置'].map((title,index)=>({title,status:visibleValidation.some(item=>index===1?/容器|镜像|container/i.test(item):index===0?/metadata/.test(item):false)?'error':undefined}))}/>}
          <div className={isEdit?styles.editLayout:styles.section}>{isEdit&&<nav aria-label="编辑分区" className={styles.sectionNav}>{['基本信息','容器配置','高级配置'].map((title,index)=><Button key={title} type={step===index?'primary':'default'} onClick={()=>{setStep(index);editorScope.current?.querySelector(`[data-editor-section="${index}"]`)?.scrollIntoView({block:'start',behavior:'smooth'});}}>{title}</Button>)}</nav>}
            <div className={styles.formContent}>{[0,1,2].map(index=><section key={index} data-editor-section={index} hidden={!isEdit&&index!==step} className={styles.section}>
              {isEdit&&<Typography.Title level={4}>{['基本信息','容器配置','高级配置'][index]}</Typography.Title>}
              {index===2?<details className={styles.advanced} open={!isEdit||undefined}><summary>高级配置</summary><WorkloadResourceForm value={manifest} onChange={updateManifest} mode={isEdit?'edit':'create'} disabled={readOnly||busy} step={index} clusterId={clusterId} token={token} lockContext={lockContext}/></details>:<WorkloadResourceForm value={manifest} onChange={updateManifest} mode={isEdit?'edit':'create'} disabled={readOnly||busy} step={index} clusterId={clusterId} token={token} lockContext={lockContext}/>}</section>)}</div>
          </div></>:<>
          <Form layout="vertical"><div className={styles.context}><Form.Item label="资源名称" required><Input aria-label="资源名称" value={manifest.metadata.name??''} disabled={isEdit||readOnly||busy} onChange={event=>updateManifest(setManifestValue(manifest,['metadata','name'],event.target.value))}/></Form.Item>{(discovered?.namespaced??definition?.namespaced??true)&&<Form.Item label="命名空间" required><Input aria-label="资源命名空间" value={manifest.metadata.namespace??''} disabled={isEdit||readOnly||busy} onChange={event=>updateManifest(setManifestValue(manifest,['metadata','namespace'],event.target.value))}/></Form.Item>}<Form.Item label="API 版本"><Input value={manifest.apiVersion} disabled/></Form.Item></div>
          <Form.Item label="资源标签">
            <NativeMapInput key={'labels:'+mode+':'+metadataRevision} label="标签" value={manifest.metadata.labels} onChange={value=>updateManifest(setManifestValue(manifest,['metadata','labels'],value))} disabled={readOnly||busy}/>
          </Form.Item>
          <Form.Item label="资源注解">
            <NativeMapInput key={'annotations:'+mode+':'+metadataRevision} label="注解" value={manifest.metadata.annotations} onChange={value=>updateManifest(setManifestValue(manifest,['metadata','annotations'],value))} disabled={readOnly||busy}/>
          </Form.Item>
          </Form>
          {native?<NativeResourceForm value={manifest} onChange={updateManifest} mode={isEdit?'edit':'create'} disabled={readOnly||busy} clusterId={clusterId} token={token}/>:schema.data?.schema?<SchemaResourceForm value={manifest} onChange={updateManifest} mode={isEdit?'edit':'create'} disabled={readOnly||busy} schema={schema.data.schema}/>:null}
        </>}
      </>:null}
    </OpsSurface>
    <div className={styles.footer} role="group" aria-label="资源编辑操作"><Button disabled={busy} onClick={leave}>{embedded?'取消':'返回'}</Button>{isWorkload&&mode==='form'&&!isEdit&&<><Button disabled={step===0||busy} onClick={()=>changeWorkloadStep(step-1)}>上一步</Button>{step<2&&<Button type="primary" disabled={busy} onClick={()=>changeWorkloadStep(step+1)}>下一步</Button>}</>}{(!isWorkload||mode==='yaml'||isEdit||step===2)&&<Button type="primary" loading={busy} disabled={readOnly||!manifest||(isEdit&&!dirty)||partialBlocked} onClick={()=>void validate()}>校验并预览</Button>}</div>
    <Modal open={!!preview} title="确认资源变更" width={1000} onCancel={()=>!busy&&setPreview(null)} onOk={()=>void submit()} okText={isEdit?'确认保存':'确认创建'} confirmLoading={busy} okButtonProps={{disabled:!preview||preview.fingerprint!==fingerprint||readOnly}} cancelButtonProps={{disabled:busy}} destroyOnHidden>
      <Alert showIcon type="success" title="Kubernetes 服务端 dry-run 校验通过" description="确认后仅提交本次已校验的草稿；服务器仍会再次校验权限和并发版本。"/>
      <div className={styles.diff}><Table size="small" dataSource={changeRows} pagination={false} tableLayout="fixed" scroll={{x:900}} columns={[{title:'资源',dataIndex:'document',width:180},{title:'字段',dataIndex:'path',width:200},{title:'操作',dataIndex:'operation',width:80,render:value=>({add:'新增',remove:'删除',change:'修改'}[value as 'add'])},{title:'原值',dataIndex:'before',width:220,render:value=><pre>{value}</pre>},{title:'新值',dataIndex:'after',width:220,render:value=><pre>{value}</pre>}]}/></div>
    </Modal>
  </div>;
}
