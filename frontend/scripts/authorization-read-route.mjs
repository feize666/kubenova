import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
const context=await browser.newContext({viewport:{width:1440,height:900},serviceWorkers:'block'});
const page=await context.newPage();page.setDefaultTimeout(10000);
let status=200;
const writes=[],errors=[];
page.on('pageerror',error=>errors.push(error.message));
await context.addInitScript(()=>{
  localStorage.setItem('aiops_auth_access','authorization-route-fixture');
  localStorage.setItem('aiops_auth_user','Authorization QA');
  localStorage.setItem('aiops_auth_role','admin');
  localStorage.setItem('aiops_auth_expires_at','2030-01-01T00:00:00Z');
});
await context.routeWebSocket('**/*',socket=>socket.close());
await context.route('**/api/**',route=>{
  const request=route.request(),path=new URL(request.url()).pathname;
  const ok=data=>route.fulfill({json:{data}});
  if(request.method()!=='GET'){writes.push(path);return route.abort();}
  if(path==='/api/v1/auth/me')return ok({user:{username:'Authorization QA',role:'admin'},expiresAt:'2030-01-01T00:00:00Z'});
  if(path==='/api/users/access-grants')return route.fulfill({status,json:status===200?{data:{items:[{id:'g1',principal:{type:'user',username:'Private principal'},cluster:{id:'c1',name:'Private cluster'},role:'viewer',state:'active',validFrom:'2026-01-01T00:00:00Z',expiresAt:null,namespaces:[],capabilities:[]}],total:1}}:{message:'Denied authorization fixture'}});
  if(path==='/api/users/native-access/c1')return route.fulfill({status,json:status===200?{data:{clusterId:'c1',enabled:true,issuer:'https://private.example.com',audience:'test',jwksUri:'https://private.example.com/jwks',gatewayUrl:'https://gateway.example.com',revision:4,syncState:'pending'}}:{message:'Denied settings fixture'}});
  if(path==='/api/clusters')return ok({items:[{id:'c1',name:'Private cluster',state:'active'}],total:1});
  if(path==='/api/v1/clusters/events/stream')return route.fulfill({contentType:'text/event-stream',body:': fixture\n\n'});
  if(path==='/api/capabilities'||path==='/api/ai-assistant/sessions')return ok([]);
  if(path==='/api/system/update/status')return ok({updateAvailable:false,runningVersion:'v1.1',latestVersion:'v1.1'});
  return ok({items:[],total:0});
});
try{
  await page.goto((process.env.AUTHORIZATION_QA_URL||'http://127.0.0.1:3000')+'/authorization');
  await page.getByRole('tab',{name:'集群访问授权',exact:true}).click();
  await page.getByText('Private principal',{exact:true}).waitFor();
  status=503;await page.getByRole('button',{name:'刷新授权列表',exact:true}).click();
  await page.getByText('授权列表刷新失败，当前内容可能已过期',{exact:true}).waitFor();
  assert.equal(await page.getByText('Private principal',{exact:true}).count(),1);
  status=403;await page.getByRole('button',{name:'刷新授权列表',exact:true}).click();
  await page.getByText('Private principal',{exact:true}).waitFor({state:'hidden'});
  status=503;await page.getByRole('button',{name:'刷新授权列表',exact:true}).click();
  await page.getByText('授权列表加载失败',{exact:true}).waitFor();
  assert.equal(await page.getByText('Private principal',{exact:true}).count(),0);
  status=200;await page.getByRole('button',{name:'刷新授权列表',exact:true}).click();
  await page.getByText('Private principal',{exact:true}).waitFor();
  await page.getByRole('tab',{name:'kubectl 访问',exact:true}).click();
  await page.getByRole('combobox',{name:'选择待配置的集群'}).click();
  await page.locator('.ant-select-item-option-content').getByText('Private cluster',{exact:true}).click();
  const issuer=page.getByPlaceholder('https://sso.example.com/realms/kubenova',{exact:true});
  await issuer.fill('https://draft.example.com');
  status=503;await page.getByRole('button',{name:/重新读取$/}).click();
  await page.getByText('访问配置刷新失败，当前内容可能已过期',{exact:true}).waitFor();
  assert.equal(await issuer.inputValue(),'https://draft.example.com');
  status=403;await page.getByRole('button',{name:/重新读取$/}).click();
  await issuer.waitFor({state:'hidden'});
  status=503;await page.getByRole('button',{name:/重新读取$/}).click();
  await page.getByText('访问配置加载失败',{exact:true}).waitFor();
  assert.equal(await issuer.count(),0);
  status=200;await page.getByRole('button',{name:/重新读取$/}).click();
  await issuer.waitFor();assert.equal(await issuer.inputValue(),'https://draft.example.com');
  assert.deepEqual(writes,[]);assert.deepEqual(errors,[]);
  console.log('PASS Next authorization route: snapshot / denial latch / recovery / kubectl draft / no writes');
} finally {await browser.close();}
