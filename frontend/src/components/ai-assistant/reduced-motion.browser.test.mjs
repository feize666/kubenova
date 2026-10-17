import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';

test('streaming caret stops blinking when reduced motion is requested without hiding streamed text',async()=>{
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  try{
    const page=await browser.newPage();
    await page.setContent('<div class="kn-ai-float__msg--streaming"><div class="kn-ai-float__msg-content"><p>Streamed response</p></div></div>');
    await page.addStyleTag({content:await readFile(new URL('../../app/globals.css',import.meta.url),'utf8')});
    const caret=()=>page.locator('.kn-ai-float__msg-content > p').evaluate(element=>getComputedStyle(element,'::after').animationName);
    await page.emulateMedia({reducedMotion:'no-preference'});
    assert.equal(await caret(),'kn-ai-caret','normal streaming keeps its visual progress cue');
    await page.emulateMedia({reducedMotion:'reduce'});
    assert.equal(await caret(),'none','reduced motion must stop the actual descendant pseudo-element animation');
    assert.equal(await page.getByText('Streamed response',{exact:true}).isVisible(),true);
  }finally{await browser.close();}
});
