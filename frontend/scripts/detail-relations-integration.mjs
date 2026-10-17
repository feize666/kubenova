import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';

// All API requests and sockets are isolated; no Kubernetes writes or runtime sessions.
const origin = process.env.DETAIL_QA_URL || 'http://127.0.0.1:3000';
const clusterId = 'detail-qa-cluster';
const kinds = { Deployment: 'deployments', StatefulSet: 'statefulsets', DaemonSet: 'daemonsets', ReplicaSet: 'replicasets', Job: 'jobs', CronJob: 'cronjobs' };
const timestamp = '2026-10-11T00:00:00Z';
const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
const failures = [];
const selectedKinds = process.env.DETAIL_QA_KIND ? Object.entries(kinds).filter(([kind]) => kind === process.env.DETAIL_QA_KIND) : Object.entries(kinds);
assert.ok(selectedKinds.length, 'DETAIL_QA_KIND must identify a supported controller');

function item(kind, name, ownerReferences = [], uid = `${name}-uid`) {
  return { id: `${name}-id`, clusterId, namespace: 'prod', kind, name, replicas: 1, readyReplicas: 1, availableReplicas: 1, state: 'active', labels: { app: 'shared' }, spec: {}, statusJson: { uid, phase: 'Running', ownerReferences, podIP: '10.0.0.1', nodeName: 'fixture-node' }, createdAt: timestamp, updatedAt: timestamp };
}

function detail(resource) {
  return {
    descriptor: { resourceKind: resource.kind, sections: ['overview', 'runtime', 'metadata', 'events'], capabilities: { rawSpec: true, rawStatus: true, relationships: true }, fieldsBySection: {} },
    overview: { ...resource, createdAt: timestamp, updatedAt: timestamp },
    rawSpec: resource.kind === 'Pod' ? {} : { selector: { matchLabels: { app: 'shared' } } },
    rawStatus: resource.statusJson,
    runtime: { replicas: 1, readyReplicas: 1, containerDetails: resource.kind === 'Pod' ? [{ name: 'main', image: 'nginx:1.27' }] : [] }, metadata: { labels: resource.labels, annotations: {}, ownerReferences: [], configUsages: [] },
    associations: [], relationships: [], events: { items: [], status: 'empty' }, network: {}, storage: {}, generatedAt: timestamp,
  };
}

try {
  for (const [kind, routeName] of selectedKinds) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });
    const page = await context.newPage();
    page.setDefaultTimeout(10000);
    const errors = [], unexpected = [], requests = [], runtimeSessions = [];
    page.on('pageerror', error => errors.push(error.message));
    const owner = item(kind, 'fixture-owner');
    const intermediaryKind = kind === 'Deployment' ? 'ReplicaSet' : kind === 'CronJob' ? 'Job' : null;
    const intermediary = intermediaryKind ? item(intermediaryKind, 'fixture-child', [{ kind, name: owner.name, uid: owner.statusJson.uid, controller: true }]) : null;
    const podOwner = intermediary || owner;
    const owned = item('Pod', 'fixture-owned-pod', [{ kind: podOwner.kind, name: podOwner.name, uid: podOwner.statusJson.uid, controller: true }]);
    const manifest = resource => ({ apiVersion: resource.kind === 'Pod' ? 'v1' : 'batch/v1', kind: resource.kind,
      metadata: { name: resource.name, namespace: resource.namespace, uid: resource.statusJson.uid, ownerReferences: resource.statusJson.ownerReferences }, spec: {} });
    const accessWorkload = manifest(owner), accessPod = manifest(owned);
    const accessOwner = intermediary ? manifest(intermediary) : null;
    const manualService = { apiVersion: 'v1', kind: 'Service', metadata: { name: 'fixture-manual-service', namespace: 'prod', uid: 'manual-service' }, spec: { ports: [{ name: 'http', port: 80 }] } };
    let invalidAccessOwner = false;
    const pods = [...Array.from({ length: 200 }, (_, index) => item('Pod', `foreign-${index}`, [{ kind: podOwner.kind, name: 'foreign', uid: 'foreign-uid', controller: true }])), owned];
    let relationStatus = 200;
    let listStatus = 200;
    let listReads = 0;
    await context.addInitScript(() => {
      localStorage.setItem('aiops_auth_access', 'detail-qa-fixture');
      localStorage.setItem('aiops_auth_user', 'Detail QA');
      localStorage.setItem('aiops_auth_role', 'admin');
      localStorage.setItem('aiops_auth_expires_at', '2030-01-01T00:00:00Z');
      localStorage.setItem('kubenova.console.utility-sidebar.collapsed', '1');
      localStorage.setItem('kubenova-theme-mode', 'dark');
    });
    await context.routeWebSocket('**/*', socket => {
      if (socket.url().includes('/qa-detail-runtime/')) {
        socket.onMessage(() => {});
      } else socket.close();
    });
    await context.route('**/api/**', route => {
      const request = route.request(), url = new URL(request.url()), path = url.pathname;
      const fulfill = data => route.fulfill({ json: { data } });
      if (request.method() === 'POST' && ['/api/logs/stream', '/api/runtime/sessions'].includes(path)) {
        const payload = request.postDataJSON();
        runtimeSessions.push({ path, payload });
        return fulfill({ sessionId: 'fixture-runtime', gatewayWsUrl: `${origin.replace(/^http/, 'ws')}/qa-detail-runtime/${path.endsWith('stream') ? 'logs' : 'terminal'}`, sessionState: 'ready', reconnectable: true,
          target: { clusterId, namespace: 'prod', pod: owned.name, container: 'main', availableContainers: ['main'], podPhase: 'Running' } });
      }
      if (request.method() !== 'GET') { unexpected.push(`${request.method()} ${path}`); return route.fulfill({ status: 400, json: { message: 'Writes blocked in QA' } }); }
      if (path === '/api/v1/auth/me') return fulfill({ user: { username: 'Detail QA', role: 'admin' }, expiresAt: '2030-01-01T00:00:00Z' });
      if (path === '/api/capabilities' || path === '/api/ai-assistant/sessions') return fulfill([]);
      if (path === '/api/system/update/status') return fulfill({ updateAvailable: false });
      if (path === `/api/clusters/${clusterId}`) return fulfill({ id: clusterId, name: 'Detail QA Cluster', runtimeStatus: 'running', connectionStatus: 'connected' });
      if (path === '/api/clusters') return fulfill({ items: [{ id: clusterId, name: 'Detail QA Cluster', state: 'active', hasKubeconfig: true }], total: 1 });
      if (path === '/api/cluster-health') return fulfill({ items: [{ clusterId, runtimeStatus: 'running' }], total: 1 });
      if (path === '/api/namespaces') return fulfill({ items: [{ id: 'prod-id', name: 'prod', clusterId }], total: 1 });
      if (path === '/api/logs') return fulfill({ items: [], total: 0 });
      if (path === '/api/resources/access/context') return fulfill({ workload: accessWorkload, canMutate: false, limit: 500,
        lists: [
          { kind: owner.kind, items: [accessWorkload], incomplete: false },
          ...(accessOwner ? [{ kind: accessOwner.kind, items: [{ ...accessOwner, metadata: { ...accessOwner.metadata, namespace: invalidAccessOwner ? 'private' : 'prod' } }], incomplete: false }] : []),
          { kind: 'Pod', items: [accessPod], incomplete: false },
          { kind: 'Service', items: [manualService], incomplete: false },
          { kind: 'Ingress', items: [], incomplete: false },
          { kind: 'Endpoints', items: [{ apiVersion: 'v1', kind: 'Endpoints', metadata: { name: manualService.metadata.name, namespace: 'prod' }, subsets: [{ addresses: [{ targetRef: { kind: 'Pod', name: accessPod.metadata.name, uid: accessPod.metadata.uid } }] }] }], incomplete: false },
          { kind: 'EndpointSlice', items: [], incomplete: false },
        ] });
      if (path.startsWith('/api/users/preferences/table/')) return fulfill(null);
      if (path.endsWith('/events/stream')) return route.fulfill({ contentType: 'text/event-stream', body: ': QA fixture\n\n' });
      if (/^\/api\/resources\/[^/]+\/[^/]+\/detail$/.test(path)) return fulfill(detail(path.includes('fixture-owned-pod-id') ? owned : owner));
      if (path === '/api/workloads') {
        const requestedKind = url.searchParams.get('kind');
        const currentPage = Number(url.searchParams.get('page') || 1);
        const size = Number(url.searchParams.get('pageSize') || 25);
        const relationRead = requestedKind === 'Pod' || (requestedKind === intermediaryKind && size === 200);
        requests.push({ kind: requestedKind, page: currentPage, size, relationRead });
        if (relationRead && relationStatus !== 200) return route.fulfill({ status: relationStatus, json: { message: 'QA relation read failed' } });
        if(requestedKind===kind && !relationRead) {
          listReads++;
          if(listStatus!==200) return route.fulfill({status:listStatus,json:{message:'QA controller list read failed'}});
        }
        let source = requestedKind === 'Pod' ? pods : requestedKind === intermediaryKind ? [intermediary] : requestedKind === kind ? [owner] : [];
        const keyword=url.searchParams.get('keyword');
        if(keyword) source=source.filter(resource=>resource.name.includes(keyword));
        return fulfill({ items: source.slice((currentPage - 1) * size, currentPage * size), total: source.length, page: currentPage, pageSize: size });
      }
      unexpected.push(`GET ${path}`);
      return route.fulfill({ status: 500, json: { message: `Missing QA fixture: ${path}` } });
    });
    try {
      const url = `${origin}/clusters/${clusterId}/workloads/${routeName}?namespace=prod`;
      await page.goto(url);
      const background = page.locator('.resource-table-shell').first();
      const ownerLink = background.locator('a:visible').filter({ hasText: owner.name }).first();
      await ownerLink.waitFor();
      const resourceSearch=background.getByRole('textbox',{name:'搜索资源',exact:true});
      for(const keyword of ['qa-no-such-controller',owner.name]) {
        const response=page.waitForResponse(response=>{
          const requested=new URL(response.url());
          return requested.pathname==='/api/workloads' && requested.searchParams.get('kind')===kind && requested.searchParams.get('keyword')===keyword && response.request().method()==='GET';
        });
        await resourceSearch.fill(keyword);
        assert.equal((await response).status(),200,`${kind}: search must read the controller list`);
        if(keyword===owner.name) await ownerLink.waitFor();
        else await ownerLink.waitFor({state:'hidden'});
        await page.waitForFunction(keyword=>new URL(location.href).searchParams.get('keyword')===keyword,keyword);
      }
      await page.reload({waitUntil:'networkidle'});
      await ownerLink.waitFor();
      assert.equal(await resourceSearch.inputValue(),owner.name,`${kind}: reload restores the resource keyword`);
      const initialUrl=page.url();
      const refreshList=page.getByRole('button',{name:'刷新页面',exact:true});
      let denied=false;
      for(const status of [503,403,503,200]) {
        const before=listReads;
        listStatus=status;
        await refreshList.click();
        await page.waitForFunction(()=>!document.querySelector('[aria-label="刷新页面"].ant-btn-loading'));
        assert.ok(listReads>before,`${kind}: main list refresh must be requested`);
        if(status===403) denied=true;
        if(status===200) denied=false;
        if(denied) {
          await background.getByText(status===403?'没有查看权限':'资源数据加载失败',{exact:true}).waitFor();
          assert.equal(await ownerLink.count(),0,`${kind}: denied rows cannot return after a transient failure`);
        } else await ownerLink.waitFor();
        assert.equal(page.url(),initialUrl,`${kind}: namespace and list URL survive refresh`);
        assert.equal(await resourceSearch.inputValue(),owner.name,`${kind}: refresh preserves resource search`);
      }
      await ownerLink.click();
      const drawer = page.locator('.ant-drawer:visible').last();
      await drawer.getByRole('tab', { name: '访问方式', exact: true }).click();
      const manualLink = drawer.getByText(manualService.metadata.name, { exact: true });
      await manualLink.waitFor();
      if (kind === 'CronJob') {
        invalidAccessOwner = true;
        await drawer.getByRole('button', { name: /刷新访问关系/ }).click();
        await manualLink.waitFor({ state: 'hidden' });
        await page.waitForFunction(() => ![...document.querySelectorAll('.ant-drawer button')].some(button => button.textContent.includes('刷新访问关系') && button.classList.contains('ant-btn-loading')));
        invalidAccessOwner = false;
        await drawer.getByRole('button', { name: /刷新访问关系/ }).click();
        await manualLink.waitFor();
      }
      assert.equal(await ownerLink.count(), 1, 'access relations preserve the background list');
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      const podLink = drawer.locator('.ant-table a').filter({ hasText: owned.name });
      await podLink.waitFor();
      assert.equal(await drawer.locator('.ant-table tbody tr.ant-table-row').count(), 1);
      assert.ok(requests.some(request => request.kind === 'Pod' && request.page === 2));
      assert.equal(await ownerLink.count(), 1, 'background list stays mounted');
      assert.equal(new URL(page.url()).pathname, new URL(url).pathname);
      await podLink.click();
      await drawer.getByRole('tab', { name: '日志', exact: true }).waitFor();
      assert.equal(new URL(page.url()).searchParams.get('detailId'), owned.id);
      assert.equal(await ownerLink.count(), 1);
      const podUrl = page.url();
      for (const [tab, mode] of [['日志', 'logs'], ['终端', 'terminal']]) {
        await drawer.getByRole('tab', { name: tab, exact: true }).click();
        const overlay = page.getByRole('dialog', { name: `${owned.name} · ${tab}`, exact: true });
        await overlay.waitFor();
        await page.waitForFunction(() => document.querySelector('.ant-modal .xterm'));
        await overlay.getByText('已连接', { exact: true }).first().waitFor();
        assert.equal(page.url(), podUrl, `${mode}: no navigation away from Pod detail`);
        assert.equal(await ownerLink.count(), 1, `${mode}: underlying list remains mounted`);
        const openingGeometry=await overlay.evaluate(element=>{
          const rect=element.getBoundingClientRect(),style=getComputedStyle(element);
          return {width:rect.width,height:rect.height,transform:style.transform,opacity:style.opacity};
        });
        await page.waitForFunction(element=>{
          const style=getComputedStyle(element);
          return style.transform==='none' && style.opacity==='1';
        },await overlay.elementHandle());
        const box = await overlay.boundingBox();
        assert.ok(box.width >= 1438 && box.height >= 898, `${mode}: workbench fills desktop viewport; opening=${JSON.stringify(openingGeometry)}; settled=${JSON.stringify(box)}`);
        if(openingGeometry.width<1438 || openingGeometry.height<898) console.log(`TRANSITION ${kind} ${mode}: opening=${JSON.stringify(openingGeometry)} settled=${JSON.stringify(box)}`);
        await page.getByRole('button', { name: /返回资源$/ }).click();
        if (mode === 'terminal') {
          const confirmation = page.getByRole('dialog', { name: '断开终端并返回？', exact: true });
          await confirmation.getByRole('button', { name: '继续操作', exact: true }).click();
          await confirmation.waitFor({ state: 'hidden' });
          assert.equal(await overlay.isVisible(), true, 'canceling disconnect retains terminal');
          assert.equal(page.url(), podUrl);
          await page.getByRole('button', { name: /返回资源$/ }).click();
          await confirmation.getByRole('button', { name: '断开并返回', exact: true }).click();
        }
        await overlay.waitFor({ state: 'hidden' });
        assert.equal(page.url(), podUrl, `${mode}: close retains same detail identity`);
        await drawer.getByRole('tab', { name: '概览', exact: true }).click();
      }
      assert.equal(runtimeSessions.length, 2, 'one isolated runtime session per entry');
      for (const { payload } of runtimeSessions) {
        assert.equal(payload.clusterId, clusterId);
        assert.equal(payload.namespace, 'prod');
        assert.equal(payload.pod, owned.name);
      }
      await drawer.getByRole('button', { name: /^返\s*回$/ }).click();
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      await podLink.waitFor();
      if (process.env.DETAIL_QA_DIR) {
        await mkdir(process.env.DETAIL_QA_DIR, { recursive: true });
        await page.screenshot({ path: join(process.env.DETAIL_QA_DIR, `${kind}-dark.png`) });
        const reopenPods = async () => {
          await ownerLink.click();
          await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
          await podLink.waitFor();
        };
        await drawer.locator('.ant-drawer-close').click();
        await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
        await page.locator('.shell-theme-toggle').click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'light');
        await reopenPods();
        await page.screenshot({ path: join(process.env.DETAIL_QA_DIR, `${kind}-light.png`) });
        await drawer.locator('.ant-drawer-close').click();
        await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
        await page.locator('.shell-theme-toggle').click();
        await page.waitForFunction(() => document.documentElement.dataset.theme === 'dark');
        await reopenPods();
      }
      relationStatus = 503;
      await drawer.getByRole('tab', { name: '概览', exact: true }).click();
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      await drawer.getByText('Pod 列表刷新失败', { exact: true }).waitFor();
      assert.equal(await podLink.count(), 1, 'ordinary failure keeps last authorized snapshot');
      relationStatus = 403;
      await drawer.getByRole('tab', { name: '概览', exact: true }).click();
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      await drawer.getByText('加载 Pod 列表失败', { exact: true }).waitFor();
      assert.equal(await podLink.count(), 0);
      relationStatus = 503;
      await drawer.getByRole('tab', { name: '概览', exact: true }).click();
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      await drawer.getByText('加载 Pod 列表失败', { exact: true }).waitFor();
      assert.equal(await podLink.count(), 0, 'remount with 503 cannot expose denied snapshot');
      relationStatus = 200;
      await drawer.getByRole('tab', { name: '概览', exact: true }).click();
      await drawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
      await podLink.waitFor();
      await page.setViewportSize({ width: 390, height: 844 });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile document must not overflow');
      if (process.env.DETAIL_QA_DIR) await page.screenshot({ path: join(process.env.DETAIL_QA_DIR, `${kind}-mobile.png`) });
      await drawer.locator('.ant-drawer-close').click();
      await page.locator('.ant-drawer').waitFor({ state: 'hidden' });
      assert.equal(new URL(page.url()).searchParams.get('detailId'), null);
      assert.equal(await background.count(), 1);
      assert.deepEqual(errors, []);
      assert.deepEqual(unexpected, []);
      console.log(`PASS ${kind}: page201/owner/Pod ID/logs-terminal-overlay/return/background/503/403/remount/restore/390px (fixture-only)`);
    } catch (error) { failures.push(`${kind}: ${error.stack}; errors=${JSON.stringify(errors)}; unexpected=${JSON.stringify(unexpected)}; requests=${JSON.stringify(requests)}; body=${(await page.locator('body').innerText()).slice(0, 4000)}`); console.error(failures.at(-1)); }
    finally { await context.close(); }
  }
} finally { await browser.close(); }
assert.deepEqual(failures, []);
console.log(`DETAIL_RELATIONS_PASS=${selectedKinds.length}`);
