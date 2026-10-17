import assert from 'node:assert/strict';
import test from 'node:test';
import { build, stop } from 'esbuild';
import { chromium } from 'playwright';

test('AI panel resizes from all four corners, preserves dimensions and stays within the viewport', async () => {
  const bundle = await build({
    stdin: { contents: `import React from 'react';import {createRoot} from 'react-dom/client';
      import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
      import {FloatingAiAssistant} from './floating-assistant';import '../../app/globals.css';
      function Fixture(){const [open,setOpen]=React.useState(true);return <><button onClick={()=>setOpen(true)}>Open AI</button><FloatingAiAssistant open={open} onOpenChange={setOpen} onCollapseSidebar={()=>{}} insetRight={56}/></>}
      createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient()}><Fixture/></QueryClientProvider>);`,
      resolveDir: new URL('.', import.meta.url).pathname, loader: 'tsx' },
    plugins: [{ name: 'contexts', setup(builder) {
      builder.onResolve({ filter: /^(next\/navigation|@\/components\/auth-context|@\/lib\/api\/(ai-assistant|clusters)|@\/lib\/ws\/ai-assistant)$/ }, args => ({ path: args.path, namespace: 'mock' }));
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ loader: 'js', contents:
        args.path === 'next/navigation' ? 'export const usePathname=()=>"/clusters/test";'
        : args.path.includes('auth-context') ? 'export const useAuth=()=>({accessToken:"test",role:"admin",isInitializing:false});'
        : args.path.includes('/ws/') ? 'export const createAiAssistantStreamClient=()=>({dispose(){},send(){return false}});'
        : args.path.endsWith('clusters') ? 'export const getClusters=async()=>({items:[]});'
        : 'export const listSessions=async()=>[];export const createSession=async()=>({});export const sendMessage=async()=>({});export const getAiAssistantAccess=async()=>({allowed:true,fullAccess:true,scopes:[]});export const normalizeAiAssistantActionOperation=()=>undefined;export const previewAction=async()=>{throw new Error("unexpected action preview in resize fixture")};export const executeAction=async()=>{throw new Error("unexpected action execution in resize fixture")};' }));
    }}],
    define: { 'process.env.NODE_ENV': '"production"' }, bundle: true, write: false,
    format: 'iife', jsx: 'automatic', outfile: 'tmp/ai-panel-test.js',
  });
  stop();
  const browser = await chromium.launch({ headless: true, channel: process.env.RESOURCE_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 1100 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
    await page.goto('http://ai-panel-test.local/');
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    const script = bundle.outputFiles.find(file => file.path.endsWith('.js')).text;
    await page.addScriptTag({ content: script });
    const panel = page.getByRole('dialog', { name: 'AI 助手', exact: true });
    await panel.waitFor();
    assert.equal(Math.round((await panel.boundingBox()).width), 620);
    for (const [corner, dx, dy] of [['左上', 50, 50], ['右上', -40, 40], ['左下', 40, -40], ['右下', -40, -40]]) {
      const before = await panel.boundingBox();
      const handle = await page.getByRole('button', { name: `${corner}角调整对话框大小` }).boundingBox();
      await page.mouse.move(handle.x + 8, handle.y + 8);
      await page.mouse.down();
      await page.mouse.move(handle.x + 8 + dx, handle.y + 8 + dy, { steps: 8 });
      await page.mouse.up();
      const after = await panel.boundingBox();
      assert.ok(after.width < before.width && after.height < before.height, `${corner} must resize both dimensions`);
      assert.ok(after.x >= 20 && after.y >= 20 && after.x + after.width <= 1364 && after.y + after.height <= 1080);
      const opposite = await page.getByRole('button', { name: `${corner}角调整对话框大小` }).boundingBox();
      await page.mouse.move(opposite.x + 8, opposite.y + 8);
      await page.mouse.down();
      await page.mouse.move(opposite.x + 8 - dx, opposite.y + 8 - dy, { steps: 8 });
      await page.mouse.up();
      const expanded = await panel.boundingBox();
      assert.ok(expanded.width > after.width && expanded.height > after.height, `${corner} must expand both dimensions`);
      assert.equal(Math.round(expanded.width), Math.round(before.width));
      assert.equal(Math.round(expanded.height), Math.round(before.height));
    }
    const keyboardHandle = page.getByRole('button', { name: '左上角调整对话框大小' });
    const beforeKeyboard = await panel.boundingBox();
    await keyboardHandle.focus();
    await keyboardHandle.press('ArrowRight');
    await keyboardHandle.press('ArrowDown');
    const afterKeyboard = await panel.boundingBox();
    assert.equal(Math.round(afterKeyboard.width), Math.round(beforeKeyboard.width - 20));
    assert.equal(Math.round(afterKeyboard.height), Math.round(beforeKeyboard.height - 20));
    const saved = await panel.boundingBox();
    await page.getByRole('button', { name: '收起面板', exact: true }).click();
    assert.equal(await panel.count(), 0);
    await page.getByRole('button', { name: 'Open AI' }).click();
    assert.equal(Math.round((await panel.boundingBox()).width), Math.round(saved.width));
    await page.reload();
    await page.addStyleTag({ content: bundle.outputFiles.find(file => file.path.endsWith('.css')).text });
    await page.addScriptTag({ content: script });
    await panel.waitFor();
    assert.equal(Math.round((await panel.boundingBox()).width), Math.round(saved.width), 'reload restores saved size');
    const handle = await page.getByRole('button', { name: '右下角调整对话框大小' }).boundingBox();
    await page.mouse.move(handle.x + 8, handle.y + 8);
    await page.mouse.down();
    await page.mouse.move(1439, 1099, { steps: 8 });
    await page.mouse.up();
    const bounded = await panel.boundingBox();
    assert.ok(bounded.x + bounded.width <= 1364 && bounded.y + bounded.height <= 1080);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForFunction(() => document.querySelector('.kn-ai-float--fullscreen'));
    assert.equal(await page.locator('.kn-ai-float__resize').count(), 0);
    assert.equal(Math.round((await panel.boundingBox()).width), 390);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); }
});
