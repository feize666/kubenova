import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('YAML editor preserves controlled drafts, colors, undo, readonly and keyboard escape', async () => {
  assert.ok(existsSync(new URL('./yaml-code-editor.tsx', import.meta.url)), 'CodeMirror YAML editor is missing');
  const bundle = await build({
    stdin: {
      contents: `import React, {useState} from 'react';
        import {createRoot} from 'react-dom/client';
        import {YamlCodeEditor} from './yaml-code-editor';
        import {EditorView} from '@codemirror/view';
        function Fixture(){
          const [value,setValue]=useState('apiVersion: v1\\nmetadata:\\n  name: web\\nspec:\\n  replicas: 3\\n  enabled: true\\n');
          const [readOnly,setReadOnly]=useState(false);
          window.editorState={value,changes:window.editorState?.changes??0};
          window.setEditorValue=setValue;window.setEditorReadonly=setReadOnly;
          window.getEditorText=()=>EditorView.findFromDOM(document.querySelector('.cm-content')).state.sliceDoc();
          return <><YamlCodeEditor value={value} onChange={next=>{window.editorState.changes++;setValue(next)}} readOnly={readOnly} embedded/><button>After editor</button></>;
        }
        createRoot(document.getElementById('root')).render(<Fixture/>);`,
      resolveDir: new URL('.', import.meta.url).pathname,
      loader: 'tsx',
    },
    bundle: true, write: false, format: 'iife', jsx: 'automatic', outfile: 'tmp/yaml-editor.js',
  });
  const browser = await chromium.launch({ headless: true, channel: process.env.YAML_EDITOR_BROWSER_CHANNEL || 'chrome' });
  try {
    const page = await browser.newPage({ viewport: { width: 1000, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent(`<style>body{margin:16px}#root{width:100%}${bundle.outputFiles.find(file=>file.path.endsWith('.css')).text}</style><div id="root"></div>`);
    await page.addScriptTag({ content: bundle.outputFiles.find(file=>file.path.endsWith('.js')).text });
    const input = page.getByRole('textbox', { name: '资源 YAML' });
    await input.waitFor();
    assert.equal(await page.locator('.cm-editor').evaluate(element => getComputedStyle(element).backgroundColor), 'rgb(16, 16, 16)');
    const colorOf = text => page.locator('.cm-content span').filter({ hasText: new RegExp('^'+text+'$') }).first().evaluate(element=>getComputedStyle(element).color);
    assert.equal(await colorOf('apiVersion'), 'rgb(240, 164, 91)');
    assert.equal(await colorOf('web'), 'rgb(169, 232, 117)');
    assert.equal(await colorOf('3'), 'rgb(184, 239, 176)');
    assert.ok(await page.locator('.cm-gutters').count()>0);
    const fold = page.locator('.cm-foldGutter .cm-gutterElement').filter({hasText:'⌄'}).first();
    await fold.click();
    assert.equal(await page.locator('.cm-foldPlaceholder').count(), 1);
    await page.locator('.cm-foldPlaceholder').click();
    if (process.env.YAML_EDITOR_SCREENSHOT) await page.screenshot({ path: process.env.YAML_EDITOR_SCREENSHOT });
    const beforeUrl = page.url();
    const changed = 'metadata:\n  name: "updated # name"\n  replicas: 2\n';
    await input.fill(changed);
    assert.equal(await page.evaluate(()=>window.editorState.value), changed);
    await input.press('Meta+z');
    assert.equal(await page.evaluate(()=>window.editorState.value), 'apiVersion: v1\nmetadata:\n  name: web\nspec:\n  replicas: 3\n  enabled: true\n');
    await input.press('Tab');
    assert.equal(await page.getByRole('button', { name: 'After editor' }).evaluate(element=>element===document.activeElement), true);
    await input.click();
    await input.press('Meta+f');
    assert.equal(await page.locator('.cm-search').count(), 1);
    await page.locator('.cm-search input').first().press('Escape');
    const count = await page.evaluate(()=>window.editorState.changes);
    const malformed = 'data:\n  note: "unfinished\n';
    await page.evaluate(value=>window.setEditorValue(value), malformed);
    await page.waitForFunction(value=>document.querySelector('.cm-content')?.textContent?.includes(value), 'unfinished');
    assert.equal(await page.evaluate(()=>window.editorState.changes), count, 'external values must not call onChange');
    await page.evaluate(()=>window.setEditorReadonly(true));
    await page.waitForFunction(()=>document.querySelector('.cm-content')?.getAttribute('contenteditable')==='false');
    assert.equal(await page.evaluate(()=>window.editorState.value), malformed);
    assert.equal(await input.getAttribute('aria-readonly'), 'true');
    await input.click();
    await input.press('a');
    assert.equal(await page.evaluate(()=>window.getEditorText()), malformed);
    await page.evaluate(()=>window.setEditorReadonly(false));
    await input.waitFor();
    await page.waitForFunction(()=>document.querySelector('.cm-content')?.getAttribute('contenteditable')==='true');
    assert.equal(await page.evaluate(()=>window.editorState.value), malformed);
    const crlf = 'apiVersion: v1\r\nmetadata:\r\n  name: windows\r\n';
    await page.evaluate(value=>window.setEditorValue(value), crlf);
    await page.waitForFunction(()=>document.querySelector('.cm-content')?.textContent?.includes('windows'));
    assert.equal(await page.evaluate(()=>window.getEditorText()), crlf);
    await input.press('Meta+ArrowDown');
    await input.press('a');
    assert.equal(await page.evaluate(()=>window.editorState.value), crlf+'a');
    const manyLines = Array.from({length:100},(_,i)=>'line'+i+': '+ 'x'.repeat(170)).join('\n');
    await page.evaluate(value=>window.setEditorValue(value), manyLines);
    await page.setViewportSize({width:390,height:844});
    await page.waitForFunction(()=>document.querySelector('.cm-scroller')?.scrollHeight>document.querySelector('.cm-scroller')?.clientHeight);
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false);
    assert.equal(await page.locator('.cm-scroller').evaluate(element=>getComputedStyle(element).overscrollBehavior), 'contain');
    await page.locator('.cm-scroller').evaluate(element=>{element.scrollTop=220;element.scrollLeft=180});
    assert.deepEqual(await page.locator('.cm-scroller').evaluate(element=>[element.scrollTop,element.scrollLeft]), [220,180]);
    await input.click();
    await input.press('Meta+f');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth), false);
    await page.locator('.cm-search input').first().press('Escape');
    assert.equal(page.url(), beforeUrl);
    assert.deepEqual(errors, []);
    if (process.env.YAML_EDITOR_SCREENSHOT) await page.screenshot({ path: process.env.YAML_EDITOR_SCREENSHOT.replace('.png', '-mobile.png') });
  } finally { await browser.close(); }
});
