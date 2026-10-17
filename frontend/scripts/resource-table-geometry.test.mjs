import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { Table } = require('antd');
const { StyleProvider, createCache, extractStyle } = require('@ant-design/cssinjs');
const { chromium } = require('playwright');
const { build } = require('esbuild');
const css = ['globals.css', 'ops-design-system.css', 'ops-layout-consistency.css']
  .map(file => readFileSync(new URL(`../src/app/${file}`, import.meta.url), 'utf8')).join('\n');

test('page size selector shows its unit without clipping or shifting when the size changes', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Table } from 'antd';
        import { buildResourceTablePagination } from './src/lib/table/pagination';
        function Fixture() {
          const [size, setSize] = useState(25);
          return <Table className="resource-table" rowKey="id"
            columns={[{title:'Name',dataIndex:'name'}]}
            dataSource={[{id:1,name:'web'}]}
            pagination={buildResourceTablePagination({current:1,pageSize:size,total:120,onChange:(_, next)=>setSize(next)})}/>;
        }
        createRoot(document.getElementById('fixture')).render(<Fixture/>);
      `,
      loader: 'tsx', resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true, write: false, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html data-theme="light"><style>${css}</style><body><div id="fixture"></div></body></html>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    const selector = page.locator('.ant-pagination-options .ant-select');
    await selector.waitFor();
    assert.match(await selector.innerText(), /25 条\/页/, 'the selected option must include the page-size unit');
    const initial = await selector.boundingBox();
    assert.ok(initial.width >= 104 && initial.width <= 128, 'page-size control should remain compact but fit 100 条/页');
    for (const size of [100, 10, 25]) {
      await selector.click();
      await page.getByRole('option', {name:`${size} 条/页`,exact:true}).click();
      assert.match(await selector.innerText(), new RegExp(`${size} 条/页`));
      assert.equal((await selector.boundingBox()).width, initial.width, 'changing the size must not resize the control');
      const clipped = await selector.evaluate(el => [...el.querySelectorAll('.ant-select-selection-item, .ant-select-content-value')].some(label => label.scrollWidth > label.clientWidth + 1));
      assert.equal(clipped, false, 'the complete selected label must fit');
    }
  } finally { await browser.close(); }
});

test('detail table measurement rows do not add a false first row or distort column rails', async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    for (const theme of ['light', 'dark']) {
      for (const className of [undefined, 'resource-table']) {
        // A classless AntD table is the existing Pod/access detail boundary.
        const cache = createCache();
        const markup = renderToStaticMarkup(React.createElement(StyleProvider, { cache }, React.createElement(Table, {
          className, size: 'small', scroll: { x: 800 }, pagination: false, rowKey: 'id',
          columns: [{ title: '名称', dataIndex: 'name' }, { title: '状态', dataIndex: 'status', width: 130 }, { title: '节点', dataIndex: 'node', width: 160, ellipsis: true }],
          dataSource: [
            { id: 'one', name: 'application-with-a-long-name-7fc98bc7cf-b29jx', status: 'Running', node: 'node-192.168.100.123' },
            { id: 'two', name: 'web', status: 'Running', node: 'node-b' },
          ],
        })));
        await page.setContent(`<html data-theme="${theme}">${extractStyle(cache)}<style>${css}</style><body>${markup}</body></html>`);
        const geometry = await page.locator('.ant-table-wrapper').evaluate(table => ({
          measure: table.querySelector('.ant-table-measure-row').getBoundingClientRect().height,
          headerBottom: table.querySelector('thead').getBoundingClientRect().bottom,
          rows: [...table.querySelectorAll('.ant-table-row')].map(row => ({
            top: row.getBoundingClientRect().top,
            cells: [...row.children].map(cell => ({ left: cell.getBoundingClientRect().left, width: cell.getBoundingClientRect().width })),
          })),
          header: [...table.querySelectorAll('thead th')].map(cell => ({ left: cell.getBoundingClientRect().left, width: cell.getBoundingClientRect().width })),
        }));
        assert.equal(geometry.measure, 0, `${theme}/${className}: hidden measurement row must occupy no space`);
        assert.ok(Math.abs(geometry.rows[0].top - geometry.headerBottom) <= 1, `first resource must immediately follow its header: ${JSON.stringify(geometry)}`);
        for (const row of geometry.rows) {
          row.cells.forEach((cell, index) => {
            assert.ok(Math.abs(cell.width - geometry.header[index].width) <= 1, 'all rows must share header widths');
            assert.ok(Math.abs(cell.left - geometry.header[index].left) <= 1, 'all rows must share header positions');
          });
        }
      }
    }
  } finally { await browser.close(); }
});

test('resource viewport reaches page bottom after resize, banners and short result sets without stretching rows', async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import React, { useState } from 'react';
        import { createRoot } from 'react-dom/client';
        import { Table } from 'antd';
        import { useResourceTableViewportHeight } from './src/components/resource-table/use-viewport-height';
        function Fixture() {
          const ref = useResourceTableViewportHeight(true);
          const [banner, setBanner] = useState(false);
          const [short, setShort] = useState(false);
          return <main className="app-content" style={{position:'fixed',inset:'58px 0 0',padding:24,overflow:'auto'}}>
            <section className="ops-surface--panel" style={{border:'1px solid gray',padding:12}}>
              <div style={{height:70}}>Resource list</div>
              {banner && <div style={{height:80}}>Refresh warning</div>}
              <div ref={ref} className="resource-table-shell resource-table-shell--viewport-scroll">
                <div style={{height:40}}><button onClick={() => setBanner(!banner)}>Toggle warning</button><button onClick={() => setShort(!short)}>Toggle results</button></div>
                <Table className="resource-table" rowKey="id" scroll={{x:800,y:'var(--resource-table-body-height)'}}
                  columns={[{title:'Name',dataIndex:'name',width:300},{title:'Status',dataIndex:'status',width:130}]}
                  dataSource={Array.from({length:short?1:25},(_,id)=>({id,name:'web-'+id,status:'Running'}))}
                  pagination={{pageSize:25,total:short?1:60}}/>
              </div>
            </section>
          </main>;
        }
        createRoot(document.getElementById('fixture')).render(<Fixture/>);
      `,
      loader: 'tsx', resolveDir: new URL('..', import.meta.url).pathname,
    },
    bundle: true, write: false, platform: 'browser', define: { 'process.env.NODE_ENV': '"production"' },
  });
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined });
  try {
    const page = await browser.newPage();
    await page.setContent(`<html data-theme="light"><style>${css}</style><body><div id="fixture"></div></body></html>`);
    await page.addScriptTag({content:bundle.outputFiles[0].text});
    await page.locator('.ant-table-body').waitFor();
    const header = await page.locator('.ant-table-thead').boundingBox();
    const pagination = await page.locator('.ant-pagination').boundingBox();
    await page.locator('.ant-table-body').hover();
    await page.mouse.wheel(0, 480);
    await page.waitForFunction(() => document.querySelector('.ant-table-body').scrollTop > 100);
    assert.equal(await page.locator('.app-content').evaluate(el => el.scrollTop), 0, 'scroll must stay inside the resource list');
    assert.equal((await page.locator('.ant-table-thead').boundingBox()).y, header.y, 'header must not move with resource rows');
    assert.equal((await page.locator('.ant-pagination').boundingBox()).y, pagination.y, 'pagination must not move with resource rows');
    await page.mouse.wheel(0, 5000);
    await page.waitForFunction(() => {
      const body = document.querySelector('.ant-table-body');
      return body.scrollTop >= body.scrollHeight - body.clientHeight - 1;
    });
    assert.equal(await page.locator('.app-content').evaluate(el => el.scrollTop), 0, 'reaching the end must not scroll the page');
    for (const height of [900, 1200, 720]) {
      await page.setViewportSize({width:1440,height});
      for (const control of [null, 'Toggle warning', 'Toggle results']) {
        if (control) await page.getByRole('button',{name:control}).click();
        await page.waitForFunction(() => {
          const panel = document.querySelector('.ops-surface--panel');
          return panel && Math.abs(panel.getBoundingClientRect().bottom - (innerHeight-24)) <= 2;
        });
        const rowHeight = await page.locator('.ant-table-row').first().evaluate(row => row.getBoundingClientRect().height);
        assert.equal(rowHeight, 52, 'filling remaining space must not stretch resource rows');
        const footer = await page.locator('.ant-pagination').boundingBox();
        assert.ok(footer.y + footer.height <= height - 24, 'pagination stays inside page boundary');
      }
    }
  } finally { await browser.close(); }
});
