import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base = process.env.EDITOR_TEST_URL || 'http://127.0.0.1:3000';
const browser = await chromium.launch({ headless: true });
try {
  for (const viewport of [{ width: 1600, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    for (const theme of ['light', 'dark']) {
      const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
      const errors = [];
      const submissions = [];
      const workspaceChecks = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.addInitScript(theme => {
        localStorage.setItem('kubenova-theme-mode', theme);
        for (const [key, value] of Object.entries({ access: 'fixture-access', refresh: 'fixture-refresh', user: 'fixture-admin', role: 'admin', expires_at: new Date(Date.now() + 3600000).toISOString() })) sessionStorage.setItem(`aiops_auth_session_${key}`, value);
      }, theme);
      await page.route('**/api/**', async route => {
        const request = route.request();
        const url = new URL(request.url());
        const path = url.pathname;
        let data = { items: [], total: 0 };
        if (path.endsWith('/auth/me')) data = { user: { id: 'fixture-admin', username: 'fixture-admin', role: 'admin' } };
        if (path === '/api/capabilities') data = [];
        if (path === '/api/resources/editor/submit') {
          const body = request.postDataJSON();
          submissions.push(body);
          data = { dryRun: body.dryRun, items: [], total: 1, message: '校验通过' };
        }
        if (path === '/api/resources/yaml') data = { yaml: 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: fixture, namespace: default, resourceVersion: "7"}\ndata: {key: old}' };
        if (path === '/api/workloads/workspace/render-yaml') data = { yaml: 'apiVersion: v1\nkind: ConfigMap\nmetadata: {name: fixture, namespace: default}\ndata: {key: value}', summary: {kind:'Deployment',name:'fixture',namespace:'default',clusterId:'fixture-cluster',image:'nginx:latest'}, manifests: [] };
        if (path === '/api/workloads/workspace/validate') { workspaceChecks.push(request.postDataJSON()); data = {valid:false,errors:[],warnings:[]}; }
        return route.fulfill({ json: { data } });
      });
      async function open(kind, extra = '') {
        await page.goto(`${base}/clusters/fixture-cluster/resources/editor?kind=${kind}${extra}`);
        await page.getByRole('button', { name: /^校验并预览/ }).waitFor();
        await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      }
      async function checkFooter(primaryText = '校验并预览') {
        const back = page.getByRole('button', { name: /^返\s*回$/ });
        const primary = page.getByRole('button', { name: new RegExp(`${primaryText}$`) });
        const left = await back.boundingBox(), right = await primary.boundingBox();
        const buttons = await page.getByRole('group', {name:'资源编辑操作'}).getByRole('button').all();
        for (let i = 1; i < buttons.length; i++) {
          const previous = await buttons[i-1].boundingBox(), current = await buttons[i].boundingBox();
          assert(current.x - previous.x - previous.width <= 12 && current.x >= previous.x + previous.width, 'adjacent actions must stay together in one row');
        }
        assert.equal(await primary.innerText(), primaryText);
        const footer = back.locator('xpath=..');
        const geometry = await footer.evaluate(el => {
          const rect = el.getBoundingClientRect(), style = getComputedStyle(el);
          const main = document.getElementById('kubenova-main-content').getBoundingClientRect();
          return { bottom: rect.bottom, right: rect.right, left: rect.left, radius: style.borderRadius, mainBottom: main.bottom };
        });
        assert(Math.abs(geometry.bottom - geometry.mainBottom) <= 2, `actions must meet workspace bottom edge: ${JSON.stringify(geometry)}`);
        assert.equal(geometry.radius, '0px');
        assert(right.x + right.width <= geometry.right && right.y + right.height <= viewport.height);
        assert(left.x >= geometry.left && Math.abs(left.y - right.y) <= 1, `actions must fit in one row: ${JSON.stringify({left,right,geometry})}`);
        assert(await primary.evaluate(el => { const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2)); }), 'primary action must not be obscured by floating tools');
        const field = page.locator('.ant-form-item:visible').last();
        await page.locator('#kubenova-main-content').evaluate(el => { el.scrollTop = el.scrollHeight; });
        if (await field.count()) {
          const fieldRect = await field.boundingBox(), footerRect = await footer.boundingBox();
          assert(fieldRect.y + fieldRect.height <= footerRect.y + 1, `last field must be reachable above actions: ${JSON.stringify({fieldRect, footerRect, viewport, theme})}`);
        }
        assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal overflow');
      }
      for (const kind of ['PersistentVolume', 'ConfigMap']) {
        await open(kind);
        await checkFooter();
      }
      await open('ConfigMap', '&name=fixture');
      assert(await page.getByRole('button', { name: '校验并预览', exact: true }).isDisabled());
      await page.getByRole('tab', { name: 'YAML', exact: true }).click();
      const yaml = page.getByRole('textbox', { name: '资源 YAML' });
      await yaml.fill((await yaml.inputValue()).replace('old', 'new'));
      await page.getByRole('button', { name: '校验并预览', exact: true }).click();
      await page.getByRole('button', { name: '确认保存', exact: true }).waitFor();
      assert.equal(submissions.length, 1);
      assert.equal(submissions[0].dryRun, true, 'preview must not submit a real update');
      await page.getByRole('button', { name: /^取\s*消$/ }).click();
      await open('Deployment', '&mode=yaml');
      await page.getByRole('tab', { name: '表单', exact: true }).click();
      await page.getByRole('button', { name: /^下\s*一\s*步$/ }).click();
      await page.getByRole('button', { name: /^下\s*一\s*步$/ }).click();
      const back = await page.getByRole('button', { name: /^返\s*回$/ }).boundingBox();
      const previous = await page.getByRole('button', { name: /^上\s*一\s*步$/ }).boundingBox();
      const validate = await page.getByRole('button', { name: '校验并预览', exact: true }).boundingBox();
      assert(back.x < previous.x && previous.x < validate.x && back.y === validate.y);
      await page.goto(`${base}/clusters/fixture-cluster/workloads/create?kind=Deployment`);
      await page.getByRole('button', { name: '下一步', exact: true }).waitFor();
      await page.evaluate(value => document.documentElement.setAttribute('data-theme', value), theme);
      await checkFooter('下一步');
      await page.getByLabel('名称', {exact:true}).fill('fixture');
      await page.getByRole('button', { name: '下一步', exact: true }).click();
      await page.getByLabel('镜像地址', {exact:true}).fill('nginx:latest');
      for (let step = 1; step < 6; step++) {
        const current = await page.locator('.ant-steps-item-active').innerText();
        await page.getByRole('button', { name: '下一步', exact: true }).click();
        await page.waitForFunction(previous => document.querySelector('.ant-steps-item-active')?.innerText !== previous, current);
      }
      await checkFooter();
      assert.equal(workspaceChecks.length, 0, 'entering the preview step must not submit the form');
      await page.getByRole('button', { name: /^返\s*回$/ }).click();
      await page.getByRole('button', { name: '继续编辑', exact: true }).click();
      await page.getByRole('button', { name: /YAML \/ 上传$/ }).click();
      await checkFooter();
      await page.locator('textarea:visible').fill('apiVersion: v1\nkind: ConfigMap\nmetadata: {name: fixture, namespace: default}\ndata: {key: value}');
      await page.getByRole('button', { name: '校验并预览', exact: true }).click();
      await page.getByRole('heading', { name: '伴生资源 · 校验与创建', exact: true }).waitFor();
      await checkFooter();
      assert.equal(submissions.length, 1, 'preparing YAML must not apply resources');
      assert.deepEqual(errors, []);
      console.log(`PASS ${viewport.width}px ${theme}: footer, scrolling, edit preview, workload steps and companion wizard`);
      await page.close();
    }
  }
} finally {
  await browser.close();
}
