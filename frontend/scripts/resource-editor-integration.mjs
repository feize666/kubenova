import assert from 'node:assert/strict';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { dump, load } from 'js-yaml';
import { build } from 'esbuild';

// Runs the built Next application with isolated API fixtures. Never submits to a cluster.
const origin = process.env.RESOURCE_EDITOR_QA_URL || 'http://127.0.0.1:3000';
const clusterId = 'editor-qa-cluster';
const workloads = ['Deployment', 'StatefulSet', 'DaemonSet', 'ReplicaSet', 'Pod', 'Job', 'CronJob'];
const kinds = [...workloads, 'Service', 'ConfigMap', 'Secret', 'Namespace', 'Ingress',
  'IngressClass', 'Endpoints', 'EndpointSlice', 'NetworkPolicy', 'PersistentVolume', 'PersistentVolumeClaim',
  'StorageClass', 'ServiceAccount', 'ResourceQuota', 'LimitRange', 'Role', 'ClusterRole', 'RoleBinding', 'ClusterRoleBinding', 'HorizontalPodAutoscaler',
  'VerticalPodAutoscaler', 'Gateway', 'GatewayClass', 'HTTPRoute', 'Widget'];
const requestedKinds = process.env.RESOURCE_EDITOR_QA_KINDS?.split(',').map(kind=>kind.trim()).filter(Boolean);
if (requestedKinds) {
  assert.ok(requestedKinds.length,'RESOURCE_EDITOR_QA_KINDS must name at least one kind');
  for (const kind of requestedKinds) assert.ok(kinds.includes(kind),`Unknown resource kind: ${kind}`);
}
const selectedKinds = requestedKinds ? kinds.filter(kind=>requestedKinds.includes(kind)) : kinds;
const viewports = [{width:1440,height:900},{width:1024,height:768},{width:390,height:844}];
const clusterScoped = new Set(['Namespace','IngressClass','PersistentVolume','StorageClass','ClusterRole','ClusterRoleBinding','GatewayClass']);
const versions = Object.fromEntries(kinds.map(kind => [kind,
  ['Deployment','StatefulSet','DaemonSet','ReplicaSet'].includes(kind) ? 'apps/v1' :
  ['Job','CronJob'].includes(kind) ? 'batch/v1' :
  ['Ingress','IngressClass','NetworkPolicy'].includes(kind) ? 'networking.k8s.io/v1' :
  ['Role','ClusterRole','RoleBinding','ClusterRoleBinding'].includes(kind) ? 'rbac.authorization.k8s.io/v1' :
  ['Gateway','GatewayClass','HTTPRoute'].includes(kind) ? 'gateway.networking.k8s.io/v1' :
  ({EndpointSlice:'discovery.k8s.io/v1',StorageClass:'storage.k8s.io/v1',HorizontalPodAutoscaler:'autoscaling/v2',VerticalPodAutoscaler:'autoscaling.k8s.io/v1',Widget:'qa.example.test/v1'})[kind] || 'v1']));
const string = title => ({type:'string',title});
const object = (properties, required=[]) => ({type:'object',properties,required});
const array = (title, items) => ({type:'array',title,items,minItems:1});
const schemas = {
  VerticalPodAutoscaler: object({spec:object({targetRef:object({apiVersion:string('目标 API 版本'),kind:string('目标类型'),name:string('目标名称')},['apiVersion','kind','name']),updatePolicy:object({updateMode:{type:'string',title:'更新模式',enum:['Off','Initial','Recreate','Auto']}})},['targetRef'])},['spec']),
  Gateway: object({spec:object({gatewayClassName:string('网关类名称'),listeners:array('监听器',object({name:string('监听器名称'),protocol:{type:'string',title:'监听协议',enum:['HTTP','HTTPS']},port:{type:'integer',title:'监听端口',minimum:1,maximum:65535}},['name','protocol','port']))},['gatewayClassName','listeners'])},['spec']),
  GatewayClass: object({spec:object({controllerName:string('网关控制器')},['controllerName'])},['spec']),
  HTTPRoute: object({spec:object({parentRefs:array('父网关',object({name:string('父网关名称')},['name'])),hostnames:array('主机名',string('路由主机名')),rules:array('路由规则',object({backendRefs:array('后端引用',object({name:string('后端名称'),port:{type:'integer',title:'后端端口',minimum:1,maximum:65535}},['name','port']))},['backendRefs']))},['parentRefs','hostnames','rules'])},['spec']),
  Widget: object({spec:object({message:string('消息'),replicas:{type:'integer',title:'副本数量',minimum:1,maximum:10},enabled:{type:'boolean',title:'启用'},mode:{type:'string',title:'运行模式',enum:['Active','Passive']},targets:array('目标',object({name:string('目标名称')},['name']))},['message','replicas','enabled','mode','targets'])},['spec']),
};
const catalog = {group:'qa.example.test',version:'v1',resource:'widgets',kind:'Widget',namespaced:true,verbs:['get','list','create','update','patch'],source:'crd'};
const created = new Map();
const browser = await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL || 'chrome'});
const failures = [];
const editorProbe = await build({stdin:{contents:'import {EditorView} from "@codemirror/view";const view=()=>EditorView.findFromDOM(document.querySelector(".cm-content"));window.qaReadYaml=()=>view().state.sliceDoc();window.qaWriteYaml=yaml=>view().dispatch({changes:{from:0,to:view().state.doc.length,insert:yaml}});',resolveDir:process.cwd()},bundle:true,write:false,format:'iife',logLevel:'silent'});

async function choose(page, name, option) {
  await page.getByRole('combobox',{name,exact:true}).click();
  await page.locator('.ant-select-dropdown:visible .ant-select-item-option-content').getByText(option,{exact:true}).click();
}

async function tag(page, name, value) {
  const input=page.getByRole('combobox',{name,exact:true});
  await input.fill(value);
  await input.press('Enter');
  await input.press('Escape');
}

async function mapValue(page, label, key, value) {
  const section=page.locator('.ant-form-item').filter({has:page.getByText(label==='标签'?'资源标签':label,{exact:true})}).last();
  await section.getByRole('button',{name:'新增键值',exact:true}).click();
  await page.getByRole('textbox',{name:`${label} 键名`,exact:true}).fill(key);
  await page.getByRole('textbox',{name:`${label} ${key} 值`,exact:true}).fill(value);
}

async function assertLayout(page, label, selector) {
  const layout = await page.evaluate(selector=>{
    const width=innerWidth;
    const surfaces=[...document.querySelectorAll(selector)].filter(element=>element.getClientRects().length).map(element=>{
      const rect=element.getBoundingClientRect();
      return {tag:element.className,left:rect.left,right:rect.right,width:rect.width};
    });
    return {width,documentWidth:document.documentElement.scrollWidth,surfaces};
  },selector);
  assert.ok(layout.documentWidth<=layout.width,`${label}: document overflow ${JSON.stringify(layout)}`);
  assert.ok(layout.surfaces.length,`${label}: layout surface missing`);
  for (const surface of layout.surfaces) {
    assert.ok(surface.width>0,`${label}: zero-width surface ${JSON.stringify(surface)}`);
    assert.ok(surface.left>=-1 && surface.right<=layout.width+1,`${label}: surface overflow ${JSON.stringify(surface)}`);
  }
}

async function setTheme(page, theme) {
  const current=await page.locator('html').getAttribute('data-theme');
  if(current!==theme) {
    const viewport=page.viewportSize();
    const rail=page.locator('.console-utility-sidebar');
    const wasCollapsed=await rail.getAttribute('aria-hidden')==='true';
    if(wasCollapsed) await page.getByRole('button',{name:'显示侧边栏',exact:true}).click();
    await rail.getByRole('button',{name:`切换到${theme==='light'?'浅色':'深色'}主题`,exact:true}).click();
    await page.waitForFunction(theme=>document.documentElement.getAttribute('data-theme')===theme,theme);
    if(wasCollapsed) {
      await rail.getByRole('button',{name:'收起侧边栏',exact:true}).click();
      await page.getByRole('button',{name:'显示侧边栏',exact:true}).waitFor();
    }
    assert.deepEqual(page.viewportSize(),viewport,'theme switching must not replace the mobile viewport');
  }
  await page.waitForFunction(theme=>document.documentElement.getAttribute('data-theme')===theme && localStorage.getItem('kubenova-theme-mode')===theme,theme);
  assert.equal(await page.locator('.shell-theme-toggle').getAttribute('data-mode'),theme);
}

try {
  for (const mode of ['create','edit']) for (const kind of selectedKinds) {
    const context = await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block',
      ...(process.env.RESOURCE_EDITOR_QA_REDUCED_MOTION==='reduce'?{reducedMotion:'reduce'}:{})});
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [];
    const posts = [];
    const unexpected = [];
    page.on('pageerror',error=>errors.push(error.message));
    await page.addInitScript(()=>{
      localStorage.setItem('aiops_auth_access','editor-qa-fixture');
      localStorage.setItem('aiops_auth_user','Editor QA');
      localStorage.setItem('aiops_auth_role','admin');
      localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova.console.utility-sidebar.collapsed','1');
      localStorage.setItem('kubenova-theme-mode','dark');
    });
    await context.routeWebSocket('**/*',socket=>socket.close());
    await context.route('**/api/**',async route=>{
      try {
      const request=route.request(), url=new URL(request.url()), path=url.pathname;
      const fulfill=data=>route.fulfill({json:{data}});
      if (request.method()==='POST' && path==='/api/resources/editor/submit') {
        const body=request.postDataJSON();
        posts.push(body);
        if (body.dryRun !== true) {
          unexpected.push('Non-dry-run submit blocked');
          return route.fulfill({status:400,json:{message:'QA blocks resource writes'}});
        }
        const manifest=load(body.yaml);
        return fulfill({dryRun:true,items:[{apiVersion:manifest.apiVersion,kind:manifest.kind,name:manifest.metadata.name,namespace:manifest.metadata.namespace || '',message:'QA fixture only'}],total:1,message:'QA preview only'});
      }
      if (request.method()!=='GET') {
        unexpected.push(`${request.method()} ${path}`);
        return route.fulfill({status:400,json:{message:'QA blocks resource writes'}});
      }
      if(path==='/api/capabilities') return fulfill([]);
      if(path==='/api/v1/auth/me') return fulfill({user:{username:'Editor QA',displayName:'Editor QA',role:'admin'},expiresAt:'2030-01-01T00:00:00Z'});
      if(path==='/api/cluster-health') return fulfill({items:[],total:0});
      if(path==='/api/v1/clusters/events/stream') return route.fulfill({contentType:'text/event-stream',body:': QA fixture\n\n'});
      if(path==='/api/system/update/status') return fulfill({updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'});
      if(path===`/api/clusters/${clusterId}`) return fulfill({id:clusterId,name:'Editor QA Cluster',runtimeStatus:'running',connectionStatus:'connected'});
      if(path==='/api/clusters') return fulfill({items:[{id:clusterId,name:'Editor QA Cluster'}],total:1});
      if(path==='/api/ai-assistant/sessions') return fulfill([]);
      if(path==='/api/resources/discovery/catalog') return fulfill({clusterId,items:[catalog],total:1,stale:false,timestamp:new Date().toISOString()});
      if(path==='/api/resources/editor/schema') {
        assert.equal(url.searchParams.get('kind'),kind);
        assert.equal(url.searchParams.get('apiVersion'),versions[kind]);
        assert.equal(url.searchParams.get('namespace'),clusterScoped.has(kind)?null:'prod');
        if(kind==='Widget') assert.equal(url.searchParams.get('resource'),'widgets');
        return fulfill({schema:schemas[kind] || null,source:schemas[kind]?'crd':'unavailable'});
      }
      if(path==='/api/resources/yaml' || path==='/api/resources/dynamic/detail') {
        const original=structuredClone(created.get(kind));
        assert.ok(original,`${kind}: create fixture required before edit`);
        original.metadata.resourceVersion='42';
        if(kind==='Secret') {
          original.data={'qa-value':Buffer.from(original.stringData['qa-value']).toString('base64')};
          delete original.stringData;
        }
        assert.equal(url.searchParams.get('namespace'),clusterScoped.has(kind)?'':'prod');
        if(kind==='Widget') {
          assert.equal(url.searchParams.get('group'),'qa.example.test');
          assert.equal(url.searchParams.get('version'),'v1');
          assert.equal(url.searchParams.get('resource'),'widgets');
        } else assert.equal(url.searchParams.get('kind'),kind);
        return fulfill({clusterId,kind,name:original.metadata.name,yaml:dump(original),resourceVersion:'42'});
      }
      if(path==='/api/resources/ingressclasses') return fulfill({items:[{name:'nginx',controller:'k8s.io/ingress-nginx',isDefault:true}],total:1});
      if(path==='/api/network') return fulfill({items:[{id:'prod/web',name:'web',namespace:'prod',kind:'Service',spec:{ports:[{name:'http',port:80,protocol:'TCP'}]}}],total:1});
      if(path==='/api/resources/editor/config-references') return fulfill({items:[]});
      unexpected.push(`GET ${path}`);
      return route.fulfill({status:500,json:{message:`Unconfigured fixture: ${path}`}});
      } catch(error) {
        unexpected.push(`Fixture assertion: ${error.stack}`);
        return route.fulfill({status:500,json:{message:'QA fixture assertion failed'}});
      }
    });
    try {
      const query=new URLSearchParams({kind,namespace:'prod',mode:'form'});
      if(kind==='Widget') {query.set('apiVersion',versions[kind]);query.set('resource','widgets');}
      if(mode==='edit') query.set('name',`qa-${kind.toLowerCase()}`);
      const url=`${origin}/clusters/${clusterId}/resources/editor?${query}`;
      await page.goto(url);
      await page.addScriptTag({content:editorProbe.outputFiles[0].text});
      const name=page.getByRole('textbox',{name:'资源名称',exact:true});
      await name.first().waitFor();
      assert.equal(await page.getByRole('combobox',{name:'资源类型',exact:true}).count(),0);
      assert.equal(await page.getByText('目标集群',{exact:true}).count(),0);
      if(mode==='edit') {
        assert.ok(await name.first().isDisabled(),`${kind}: edit identity must be locked`);
        if(workloads.includes(kind)) {
          await page.getByRole('button',{name:'添加资源标签',exact:true}).click();
          const key=page.getByRole('textbox',{name:'资源标签 键 key',exact:true});
          await key.fill('qa-editor');
          await key.press('Tab');
          await page.getByRole('textbox',{name:'资源标签 值 qa-editor',exact:true}).fill('edit');
        } else await mapValue(page,'标签','qa-editor','edit');
      } else {
      await name.fill(`qa-${kind.toLowerCase()}`);
      if(workloads.includes(kind)) {
        if(kind==='StatefulSet') await page.getByRole('textbox',{name:'无头 Service 名称',exact:true}).fill('web');
        await page.getByRole('button',{name:'下一步',exact:true}).click();
        await page.getByRole('textbox',{name:'镜像',exact:true}).fill('nginx:1.27');
        await page.getByRole('button',{name:'下一步',exact:true}).click();
      } else if(kind==='Service') {
        await choose(page,'Service 类型','ClusterIP');
        await page.getByRole('button',{name:'新增Service 端口',exact:true}).click();
        await page.getByRole('spinbutton',{name:'服务端口',exact:true}).fill('8080');
      } else if(kind==='ConfigMap') {
        await mapValue(page,'文本配置','message','QA multiline\nsecond line');
      } else if(kind==='Secret') {
        await page.getByRole('button',{name:'新增键值',exact:true}).last().click();
        await page.getByRole('textbox',{name:'新增 Secret 键名',exact:true}).fill('qa-value');
        await page.getByRole('textbox',{name:'新增 Secret 值',exact:true}).fill('fixture-only-secret');
        await page.getByRole('button',{name:'应用新增键值',exact:true}).click();
      } else if(kind==='Ingress') {
        await page.getByRole('button',{name:'新增域名路由',exact:true}).click();
        await page.getByRole('textbox',{name:'域名（可空，匹配所有）',exact:true}).fill('qa.example.test');
        await choose(page,'后端服务名称','web');
        await choose(page,'后端服务端口','http / 80 (TCP)');
      } else if(kind==='IngressClass') {
        await page.getByRole('textbox',{name:'控制器',exact:true}).fill('k8s.io/ingress-nginx');
      } else if(kind==='Endpoints') {
        await page.getByRole('button',{name:'新增地址子集',exact:true}).click();
        await page.getByRole('textbox',{name:'IP 地址',exact:true}).fill('10.0.0.1');
      } else if(kind==='EndpointSlice') {
        await choose(page,'地址类型','IPv4');
        await page.getByRole('button',{name:'新增端点',exact:true}).click();
        await tag(page,'地址','10.0.0.1');
      } else if(kind==='NetworkPolicy') {
        await mapValue(page,'Pod 选择器标签','app','web');
        await choose(page,'策略方向','Ingress');
        await page.keyboard.press('Escape');
      } else if(kind==='PersistentVolume') {
        await page.getByRole('textbox',{name:'容量',exact:true}).fill('1Gi');
        await choose(page,'访问模式','ReadWriteOnce');
        await page.keyboard.press('Escape');
        await choose(page,'存储源类型','nfs');
        await page.getByRole('textbox',{name:'NFS 服务地址',exact:true}).fill('10.0.0.2');
        await page.getByRole('textbox',{name:'NFS 路径',exact:true}).fill('/qa');
      } else if(kind==='PersistentVolumeClaim') {
        await page.getByRole('textbox',{name:'申请容量',exact:true}).fill('1Gi');
        await choose(page,'访问模式','ReadWriteOnce');
        await page.keyboard.press('Escape');
      } else if(kind==='StorageClass') {
        await page.getByRole('textbox',{name:'Provisioner',exact:true}).fill('example.test/csi');
      } else if(kind==='ServiceAccount') {
        await page.getByRole('button',{name:'新增镜像拉取 Secret',exact:true}).click();
        await page.getByRole('textbox',{name:'Secret 名称',exact:true}).fill('qa-registry');
      } else if(kind==='ResourceQuota') {
        await mapValue(page,'配额上限','pods','20');
      } else if(kind==='LimitRange') {
        await page.getByRole('button',{name:'新增资源限制',exact:true}).click();
        await mapValue(page,'默认限制','memory','256Mi');
      } else if(['Role','ClusterRole'].includes(kind)) {
        await page.getByRole('button',{name:'新增权限规则',exact:true}).click();
        await tag(page,'资源','pods');
      } else if(['RoleBinding','ClusterRoleBinding'].includes(kind)) {
        await page.getByRole('button',{name:'配置角色引用',exact:true}).click();
        await choose(page,'角色类型',kind==='RoleBinding'?'Role':'ClusterRole');
        await page.getByRole('textbox',{name:'角色名称',exact:true}).fill('qa-reader');
        await page.getByRole('textbox',{name:'API 组',exact:true}).fill('rbac.authorization.k8s.io');
        await page.getByRole('button',{name:'新增绑定主体',exact:true}).click();
        await page.getByRole('textbox',{name:'主体名称',exact:true}).fill('qa-account');
      } else if(kind==='HorizontalPodAutoscaler') {
        await page.getByRole('button',{name:'配置目标资源',exact:true}).click();
        await page.getByRole('textbox',{name:'API 版本',exact:true}).fill('apps/v1');
        await page.getByRole('textbox',{name:'资源类型',exact:true}).fill('Deployment');
        await page.getByRole('textbox',{name:'资源名称',exact:true}).last().fill('web');
        await page.getByRole('spinbutton',{name:'最大副本数',exact:true}).fill('5');
        await page.getByRole('button',{name:'新增扩缩容指标',exact:true}).click();
      } else if(kind==='VerticalPodAutoscaler') {
        await page.getByRole('textbox',{name:'目标 API 版本',exact:true}).fill('apps/v1');
        await page.getByRole('textbox',{name:'目标类型',exact:true}).fill('Deployment');
        await page.getByRole('textbox',{name:'目标名称',exact:true}).fill('web');
        await choose(page,'更新模式','Off');
      } else if(kind==='Gateway') {
        await page.getByRole('textbox',{name:'网关类名称',exact:true}).fill('qa-class');
        await page.getByRole('button',{name:'新增监听器项',exact:true}).click();
        await page.getByRole('textbox',{name:'监听器名称',exact:true}).fill('http');
        await choose(page,'监听协议','HTTP');
        await page.getByRole('spinbutton',{name:'监听端口',exact:true}).fill('8080');
      } else if(kind==='GatewayClass') {
        await page.getByRole('textbox',{name:'网关控制器',exact:true}).fill('qa.example.test/gateway-controller');
      } else if(kind==='HTTPRoute') {
        await page.getByRole('button',{name:'新增父网关项',exact:true}).click();
        await page.getByRole('textbox',{name:'父网关名称',exact:true}).fill('qa-gateway');
        await page.getByRole('button',{name:'新增主机名项',exact:true}).click();
        await page.getByRole('textbox',{name:'路由主机名',exact:true}).fill('qa.example.test');
        await page.getByRole('button',{name:'新增路由规则项',exact:true}).click();
        await page.getByRole('button',{name:'新增后端引用项',exact:true}).click();
        await page.getByRole('textbox',{name:'后端名称',exact:true}).fill('web');
        await page.getByRole('spinbutton',{name:'后端端口',exact:true}).fill('80');
      } else if(kind==='Widget') {
        await page.getByRole('textbox',{name:'消息',exact:true}).fill('CRD fixture\nsecond line');
        await page.getByRole('spinbutton',{name:'副本数量',exact:true}).fill('3');
        await page.getByRole('switch',{name:'启用',exact:true}).click();
        await choose(page,'运行模式','Active');
        await page.getByRole('button',{name:'新增目标项',exact:true}).click();
        await page.getByRole('textbox',{name:'目标名称',exact:true}).fill('web');
      }
      }
      await page.getByRole('tab',{name:'YAML',exact:true}).click();
      if(kind==='Secret') await page.getByRole('button',{name:'显示敏感 YAML',exact:true}).click();
      const editor=page.getByRole('textbox',{name:'资源 YAML',exact:true});
      await editor.waitFor();
      const manifest=load(await page.evaluate(()=>window.qaReadYaml()));
      assert.equal(manifest.kind,kind);
      assert.equal(manifest.apiVersion,versions[kind]);
      assert.equal(manifest.metadata.name,`qa-${kind.toLowerCase()}`);
      assert.equal(manifest.metadata.namespace,clusterScoped.has(kind)?undefined:'prod');
      if(workloads.includes(kind)) {
        const spec=kind==='Pod'?manifest.spec:kind==='CronJob'?manifest.spec.jobTemplate.spec.template.spec:manifest.spec.template.spec;
        assert.equal(spec.containers[0].image,'nginx:1.27');
        assert.equal(spec.containers[0].name,'main');
        if(kind==='StatefulSet') assert.equal(manifest.spec.serviceName,'web');
        if(kind==='CronJob') assert.equal(manifest.spec.schedule,'0 * * * *');
      }
      if(kind==='ConfigMap') assert.equal(manifest.data.message,'QA multiline\nsecond line');
      if(kind==='Service') assert.equal(manifest.spec.ports[0].port,8080);
      if(kind==='Secret') assert.equal(mode==='create'?manifest.stringData['qa-value']:Buffer.from(manifest.data['qa-value'],'base64').toString(),'fixture-only-secret');
      if(kind==='Ingress') assert.equal(manifest.spec.rules[0].http.paths[0].backend.service.name,'web');
      if(kind==='Ingress') {
        assert.equal(manifest.spec.ingressClassName,'nginx');
        assert.equal(manifest.spec.rules[0].host,'qa.example.test');
        assert.equal(manifest.spec.rules[0].http.paths[0].backend.service.port.name,'http');
      }
      if(kind==='IngressClass') assert.equal(manifest.spec.controller,'k8s.io/ingress-nginx');
      if(kind==='Endpoints') assert.equal(manifest.subsets[0].addresses[0].ip,'10.0.0.1');
      if(kind==='EndpointSlice') {assert.equal(manifest.addressType,'IPv4');assert.deepEqual(manifest.endpoints[0].addresses,['10.0.0.1']);}
      if(kind==='NetworkPolicy') {assert.equal(manifest.spec.podSelector.matchLabels.app,'web');assert.deepEqual(manifest.spec.policyTypes,['Ingress']);}
      if(kind==='PersistentVolume') {assert.equal(manifest.spec.capacity.storage,'1Gi');assert.deepEqual(manifest.spec.nfs,{server:'10.0.0.2',path:'/qa'});}
      if(kind==='PersistentVolumeClaim') {assert.equal(manifest.spec.resources.requests.storage,'1Gi');assert.deepEqual(manifest.spec.accessModes,['ReadWriteOnce']);}
      if(kind==='StorageClass') assert.equal(manifest.provisioner,'example.test/csi');
      if(kind==='ServiceAccount') assert.equal(manifest.imagePullSecrets[0].name,'qa-registry');
      if(kind==='ResourceQuota') assert.equal(manifest.spec.hard.pods,'20');
      if(kind==='LimitRange') {assert.equal(manifest.spec.limits[0].type,'Container');assert.equal(manifest.spec.limits[0].default.memory,'256Mi');}
      if(['Role','ClusterRole'].includes(kind)) {assert.deepEqual(manifest.rules[0].resources,['pods']);assert.deepEqual(manifest.rules[0].verbs,['get']);assert.deepEqual(manifest.rules[0].apiGroups,['']);}
      if(['RoleBinding','ClusterRoleBinding'].includes(kind)) {assert.equal(manifest.roleRef.kind,kind==='RoleBinding'?'Role':'ClusterRole');assert.equal(manifest.roleRef.name,'qa-reader');assert.equal(manifest.subjects[0].name,'qa-account');}
      if(kind==='HorizontalPodAutoscaler') {assert.deepEqual(manifest.spec.scaleTargetRef,{apiVersion:'apps/v1',kind:'Deployment',name:'web'});assert.equal(manifest.spec.maxReplicas,5);assert.equal(manifest.spec.metrics[0].resource.target.averageUtilization,80);}
      if(kind==='VerticalPodAutoscaler') assert.deepEqual(manifest.spec,{targetRef:{apiVersion:'apps/v1',kind:'Deployment',name:'web'},updatePolicy:{updateMode:'Off'}});
      if(kind==='Gateway') assert.deepEqual(manifest.spec,{gatewayClassName:'qa-class',listeners:[{name:'http',protocol:'HTTP',port:8080}]});
      if(kind==='GatewayClass') assert.equal(manifest.spec.controllerName,'qa.example.test/gateway-controller');
      if(kind==='HTTPRoute') assert.deepEqual(manifest.spec,{parentRefs:[{name:'qa-gateway'}],hostnames:['qa.example.test'],rules:[{backendRefs:[{name:'web',port:80}]}]});
      if(kind==='Widget') assert.deepEqual(manifest.spec,{message:'CRD fixture\nsecond line',replicas:3,enabled:true,mode:'Active',targets:[{name:'web'}]});
      if(mode==='edit') {
        assert.equal(manifest.metadata.resourceVersion,'42');
        assert.equal(manifest.metadata.labels['qa-editor'],'edit');
        const before=structuredClone(created.get(kind)), after=structuredClone(manifest);
        delete before.metadata;delete after.metadata;
        if(kind==='Secret') {delete before.stringData;delete after.data;}
        assert.deepEqual(after,before,`${kind}: editing metadata must preserve resource configuration`);
      } else created.set(kind,structuredClone(manifest));
      manifest.metadata.annotations={...manifest.metadata.annotations,'qa-roundtrip':mode};
      await page.evaluate(yaml=>window.qaWriteYaml(yaml),dump(manifest));
      await page.getByRole('tab',{name:'表单',exact:true}).click();
      assert.equal(await page.locator('input[aria-label="资源名称"]').first().inputValue(),`qa-${kind.toLowerCase()}`);
      if(workloads.includes(kind)&&mode==='create') {
        await page.getByRole('button',{name:'上一步',exact:true}).click();
        await page.getByRole('button',{name:'上一步',exact:true}).click();
      }
      assert.equal(await page.getByRole('textbox',{name:workloads.includes(kind)?'资源注解 值 qa-roundtrip':'注解 qa-roundtrip 值',exact:true}).inputValue(),mode);
      if(workloads.includes(kind)&&mode==='create') {
        await page.getByRole('button',{name:'下一步',exact:true}).click();
        await page.getByRole('button',{name:'下一步',exact:true}).click();
      }
      await page.getByRole('button',{name:/校验并预览$/}).click();
      const preview=page.getByRole('dialog',{name:'确认资源变更',exact:true});
      await preview.waitFor();
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kind}: desktop preview overflow`);
      assert.equal(posts.length,1);
      assert.equal(posts[0].dryRun,true);
      assert.equal(posts[0].clusterId,clusterId);
      assert.equal(posts[0].operation,mode==='edit'?'update':'create');
      assert.equal(posts[0].namespace,clusterScoped.has(kind)?undefined:'prod');
      if(mode==='edit') {
        assert.equal(posts[0].resourceVersion,'42');
        assert.equal(posts[0].identity.kind,kind);
        assert.equal(posts[0].identity.apiVersion,versions[kind]);
        assert.equal(posts[0].identity.namespace,clusterScoped.has(kind)?undefined:'prod');
        if(kind==='Widget') assert.equal(posts[0].identity.resource,'widgets');
      }
      assert.deepEqual(load(posts[0].yaml),manifest);
      if(kind==='Secret') assert.ok(!await preview.textContent().then(text=>text.includes('fixture-only-secret')),'preview must redact Secret values');
      await preview.getByRole('button',{name:/^取\s*消$/}).click();
      await preview.waitFor({state:'hidden'});
      await page.setViewportSize({width:390,height:844});
      await page.waitForFunction(()=>innerWidth===390);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kind}: mobile document overflow`);
      if(workloads.includes(kind)&&mode==='create') {
        for(let index=0;index<2;index++) {
          await page.getByRole('button',{name:'上一步',exact:true}).click();
          assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kind}: mobile workload step overflow`);
        }
        await page.getByRole('button',{name:'下一步',exact:true}).click();
        await page.getByRole('button',{name:'下一步',exact:true}).click();
      }
      await page.getByRole('tab',{name:'YAML',exact:true}).click();
      if(kind==='Secret' && await page.getByRole('button',{name:'显示敏感 YAML',exact:true}).isVisible()) await page.getByRole('button',{name:'显示敏感 YAML',exact:true}).click();
      assert.deepEqual(load(await page.evaluate(()=>window.qaReadYaml())),manifest);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kind}: mobile YAML overflow`);
      await page.getByRole('tab',{name:'表单',exact:true}).click();
      await page.getByRole('button',{name:/校验并预览$/}).click();
      await preview.waitFor();
      assert.equal(posts.length,2);
      assert.deepEqual(posts[1],posts[0]);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${kind}: mobile preview overflow`);
      await preview.getByRole('button',{name:/^取\s*消$/}).click();
      await preview.waitFor({state:'hidden'});
      for (const viewport of viewports) {
        await page.setViewportSize(viewport);
        await page.waitForFunction(width=>innerWidth===width,viewport.width);
        for (const theme of ['dark','light']) {
          const label=`${mode} ${kind} ${theme} ${viewport.width}px`;
          await page.getByRole('tab',{name:'YAML',exact:true}).click();
          if(kind==='Secret' && await page.getByRole('button',{name:'显示敏感 YAML',exact:true}).isVisible()) await page.getByRole('button',{name:'显示敏感 YAML',exact:true}).click();
          const beforeTheme=load(await page.evaluate(()=>window.qaReadYaml()));
          assert.deepEqual(beforeTheme,manifest,`${label}: manifest before theme switch`);
          await setTheme(page,theme);
          assert.deepEqual(load(await page.evaluate(()=>window.qaReadYaml())),beforeTheme,`${label}: theme switch must preserve manifest`);
          await assertLayout(page,`${label} YAML`,'.cm-editor');
          await page.getByRole('tab',{name:'表单',exact:true}).click();
          await assertLayout(page,`${label} form`,'.ant-form');
          const capture=process.env.RESOURCE_EDITOR_QA_SCREENSHOT_DIR && mode==='create' &&
            ((viewport.width===1024 && theme==='light') || (viewport.width===390 && theme==='dark'));
          if(capture) await page.screenshot({path:join(process.env.RESOURCE_EDITOR_QA_SCREENSHOT_DIR,`${mode}-${kind}-${theme}-${viewport.width}-form.png`)});
          if(workloads.includes(kind)&&mode==='create') {
            for(let index=0;index<2;index++) {
              await page.getByRole('button',{name:'上一步',exact:true}).click();
              await assertLayout(page,`${label} workload step ${1-index}`,'.ant-form');
            }
            await page.getByRole('button',{name:'下一步',exact:true}).click();
            await page.getByRole('button',{name:'下一步',exact:true}).click();
          }
          const postCount=posts.length;
          await page.getByRole('button',{name:/校验并预览$/}).click();
          await preview.waitFor();
          await page.waitForFunction(dialog=>{
            const style=getComputedStyle(dialog);
            return dialog.getClientRects().length && style.opacity==='1' && style.transform==='none';
          },await preview.elementHandle());
          assert.equal(posts.length,postCount+1,`${label}: exactly one dry-run preview request`);
          assert.deepEqual(posts.at(-1),posts[0],`${label}: unchanged preview payload`);
          await assertLayout(page,`${label} preview`,'[role="dialog"]');
          const firstChangeRow=await preview.locator('.ant-table-tbody > tr.ant-table-row').first().boundingBox();
          assert.ok(firstChangeRow && firstChangeRow.height<=120,`${label}: first change row must remain readable, not stretch to fill the preview: ${JSON.stringify(firstChangeRow)}`);
          if(capture) await page.screenshot({path:join(process.env.RESOURCE_EDITOR_QA_SCREENSHOT_DIR,`${mode}-${kind}-${theme}-${viewport.width}-preview.png`)});
          if(kind==='Secret') assert.ok(!await preview.textContent().then(text=>text.includes('fixture-only-secret')),`${label}: preview must redact Secret values`);
          await preview.getByRole('button',{name:/^取\s*消$/}).click();
          await preview.waitFor({state:'hidden'});
        }
      }
      await page.getByRole('button',{name:/^返\s*回$/}).click();
      const leave=page.getByRole('dialog',{name:'离开资源编辑器？',exact:true});
      await leave.getByRole('button',{name:'继续编辑',exact:true}).click();
      assert.equal(page.url(),url);
      assert.deepEqual(errors,[]);
      assert.deepEqual(unexpected,[]);
      console.log(`PASS ${mode} ${kind}: form/YAML/form/preview/cancel/leave; dark/light x 1440/1024/390px (fixture-only)`);
    } catch(error) {
      const motion=await page.evaluate(()=>({visibility:document.visibilityState,reducedMotion:matchMedia('(prefers-reduced-motion: reduce)').matches,
        animations:document.getAnimations().map(animation=>({target:animation.effect?.target?.className,playState:animation.playState,currentTime:animation.currentTime,timing:animation.effect?.getComputedTiming()}))})).catch(error=>({diagnosticError:error.message}));
      failures.push(`${mode} ${kind}: ${error.stack}; pageerrors=${JSON.stringify(errors)}; unexpected=${JSON.stringify(unexpected)}; buttons=${JSON.stringify(await page.getByRole('button').allTextContents())}; motion=${JSON.stringify(motion)}; url=${page.url()}`);
      console.error(failures.at(-1));
    } finally {await context.close();}
  }
} finally {await browser.close();}
assert.deepEqual(failures,[]);
console.log(`PASS ${selectedKinds.length} kinds / ${selectedKinds.length*2} create-edit cases / ${selectedKinds.length*12} theme-viewport checks; API writes and WebSockets isolated`);
