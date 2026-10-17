import assert from 'node:assert/strict';
import test from 'node:test';
import { build } from 'esbuild';
import { chromium } from 'playwright';

test('reduced-motion drawer opens without sliding and returns keyboard focus when closed',async()=>{
  const bundle=await build({stdin:{contents:`import React from 'react';import {createRoot} from 'react-dom/client';import {OpsDrawerShell} from './ops-drawer-shell';import '../../app/globals.css';function Fixture(){const [open,setOpen]=React.useState(false);const trigger=React.useRef(null);return <><button ref={trigger} onClick={()=>setOpen(true)}>Open details</button><OpsDrawerShell open={open} title="Resource details" returnFocusRef={trigger} onClose={()=>setOpen(false)}><button onClick={()=>setOpen(false)}>Close details</button><p>Resource content</p></OpsDrawerShell></>}createRoot(document.getElementById('root')).render(<Fixture/>);`,resolveDir:new URL('.',import.meta.url).pathname,loader:'tsx'},bundle:true,write:false,format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},outfile:'tmp/drawer-motion.js',logLevel:'silent'});
  const browser=await chromium.launch({headless:true,channel:process.env.RESOURCE_BROWSER_CHANNEL||'chrome'});
  try{
    const page=await browser.newPage({reducedMotion:'reduce'});
    await page.route('**/*',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
    await page.goto('http://drawer-motion.test/');
    await page.addStyleTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.css')).text});
    await page.addScriptTag({content:bundle.outputFiles.find(file=>file.path.endsWith('.js')).text});
    await page.getByRole('button',{name:'Open details',exact:true}).click();
    await page.getByText('Resource content',{exact:true}).waitFor();
    const durations=await page.locator('.ant-drawer-content-wrapper').evaluate(element=>getComputedStyle(element).transitionDuration.split(',').map(value=>parseFloat(value)*(value.trim().endsWith('ms')?1:1000)));
    assert.ok(durations.every(value=>value<=1),`drawer sliding remains enabled: ${durations}; ${await page.locator('.ant-drawer-content-wrapper').evaluate(element=>[element.className,element.parentElement.className,element.querySelector('.ant-drawer-content')?.className])}`);
    const maskDurations=await page.locator('.ant-drawer-mask').evaluate(element=>getComputedStyle(element).transitionDuration.split(',').map(value=>parseFloat(value)*(value.trim().endsWith('ms')?1:1000)));
    assert.ok(maskDurations.every(value=>value<=1),`drawer mask still animates: ${maskDurations}`);
    await page.getByRole('button',{name:'Close details',exact:true}).click();
    await page.waitForFunction(()=>document.activeElement?.textContent==='Open details');
    await page.getByRole('button',{name:'Open details',exact:true}).press('Enter');
    await page.getByText('Resource content',{exact:true}).waitFor();
  }finally{await browser.close();}
});
