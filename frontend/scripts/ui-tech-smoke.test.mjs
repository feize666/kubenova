import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('./ui-tech-smoke.mjs', import.meta.url), 'utf8');
const routeFunction = source.slice(source.indexOf('function routeUrl(route)'), source.indexOf('async function pageTextSnippet'));
const consoleFunction = source.slice(source.indexOf('function isAllowedConsoleIssue(issue)'), source.indexOf('function installIssueCapture'));

test('overlay capture waits for finite entrance animations before checking its bounds', async () => {
  let animationFinished = false;
  const context = vm.createContext({ Date, fail(message) { throw new Error(message); } });
  const probe = source.slice(source.indexOf('async function assertOverlayVisible'), source.indexOf('async function locatorUsable'));
  vm.runInContext(`${probe};this.check=assertOverlayVisible`, context);
  const overlay = { isVisible: async () => true, boundingBox: async () => ({x:0,width:200}), evaluate: async () => { animationFinished=true; } };
  const page = { locator: () => ({count:async()=>1,nth:()=>overlay}), waitForTimeout:async()=>{} };
  await context.check(page,{width:390,name:'mobile'},{id:'fixture'},'.dialog','dialog');
  assert.equal(animationFinished,true);
});

test('one smoke run reuses a legitimate login across browser contexts', async () => {
  let logins = 0;
  const written = [];
  const context = vm.createContext({ baseUrl: 'http://local', username: 'fixture', password: 'fixture', timeout: 1000, info() {}, fail(message) { throw new Error(message); }, fetch: async () => { logins++; return { ok: true, json: async () => ({ accessToken: 'access', refreshToken: 'refresh', user: { role: 'viewer' } }) }; } });
  const auth = source.slice(source.indexOf('function readAuthSnapshot'), source.indexOf('async function authenticateViaUi'));
  vm.runInContext(`${auth};this.login = authenticateViaApi`, context);
  const page = { goto: async () => {}, evaluate: async (_fn, snapshot) => written.push(snapshot.accessToken) };
  await context.login(page);
  await context.login(page);
  assert.deepEqual(written, ['access', 'access']);
  assert.equal(logins, 1);
});

test('backend failures remain failures unless degradation is explicitly enabled', () => {
  const context = vm.createContext({ process: { env: {} } });
  vm.runInContext(`${consoleFunction};this.allowed = isAllowedConsoleIssue`, context);
  for (const [path, status] of [['/api/workloads',404], ['/api/resources/discovery/catalog',404], ['/api/topology/summary/namespaces',503], ['/api/runtime/session',403], ['/api/logs',400]]) {
    const issue = { text: `Failed to load resource: ${status}`, url: `http://127.0.0.1:3000${path}` };
    assert.equal(context.allowed(issue), false, `${path} must fail strict smoke`);
    context.process.env.UI_TECH_ALLOW_BACKEND_DEGRADATION = '1';
    assert.equal(context.allowed(issue), true);
    delete context.process.env.UI_TECH_ALLOW_BACKEND_DEGRADATION;
  }
});

test('explicit cluster scope replaces only the cluster query parameter', () => {
  const context = vm.createContext({ URL, baseUrl: 'http://127.0.0.1:3000', process: { env: { UI_TECH_CLUSTER_ID: 'cluster/with space' } } });
  vm.runInContext(`${routeFunction};this.build = routeUrl`, context);
  const result = new URL(context.build({ path: '/workloads/deployments?clusterId=local&namespace=prod&keyword=web' }));
  assert.equal(result.searchParams.get('clusterId'), 'cluster/with space');
  assert.equal(result.searchParams.get('namespace'), 'prod');
  assert.equal(result.searchParams.get('keyword'), 'web');
  assert.equal(context.build({ path: '/ai-assistant' }), 'http://127.0.0.1:3000/ai-assistant');
});

test('unconfigured cluster scope retains the original route', () => {
  const context = vm.createContext({ URL, baseUrl: 'http://127.0.0.1:3000', process: { env: {} } });
  vm.runInContext(`${routeFunction};this.build = routeUrl`, context);
  assert.equal(context.build({ path: '/network/topology?clusterId=local&namespace=default' }), 'http://127.0.0.1:3000/network/topology?clusterId=local&namespace=default');
});

test('explicit namespace uses real populated scope without altering cluster-scoped routes', () => {
  const context = vm.createContext({ URL, baseUrl: 'http://127.0.0.1:3000', process: { env: { UI_TECH_NAMESPACE: 'loop' } } });
  vm.runInContext(`${routeFunction};this.build = routeUrl`, context);
  assert.equal(new URL(context.build({ path: '/workloads/pods?clusterId=local&namespace=default' })).searchParams.get('namespace'), 'loop');
  assert.equal(new URL(context.build({ path: '/namespaces?clusterId=local' })).searchParams.has('namespace'), false);
});
