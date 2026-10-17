import assert from 'node:assert/strict';
import { after, test } from 'node:test';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { build } from 'esbuild';
import { act, createElement, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { JSDOM } from 'jsdom';

const frontend = fileURLToPath(new URL('../../..', import.meta.url));
const tmp = join(frontend, 'tmp');
mkdirSync(tmp, { recursive: true });
const buildDir = mkdtempSync(join(tmp, 'headlamp-preferences-test-'));
after(() => rmSync(buildDir, { recursive: true, force: true }));
const outfile = join(buildDir, 'hook.cjs');
await build({
  entryPoints: [fileURLToPath(new URL('./headlamp-table.tsx', import.meta.url))],
  outfile,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  packages: 'external',
  jsx: 'automatic',
});
const { useHeadlampTableState } = createRequire(import.meta.url)(outfile);

const columns = [
  { key: 'name', title: 'Name', required: true },
  { key: 'namespace', title: 'Namespace' },
  { key: 'status', title: 'Status' },
];

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((accept, fail) => { resolve = accept; reject = fail; });
  return { promise, resolve, reject };
}

async function harness(options = {}, storage = {}) {
  const dom = new JSDOM('<div id="root"></div>', { url: 'http://preferences-test.local/' });
  for (const [scope, value] of Object.entries(storage)) {
    dom.window.localStorage.setItem(`resource-table-preferences:user:${scope}`, JSON.stringify(value));
  }
  const originals = new Map();
  for (const [key, value] of Object.entries({
    window: dom.window,
    document: dom.window.document,
    IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const root = createRoot(dom.window.document.getElementById('root'));
  let props = { tableKey: 'pods', preferenceUser: 'alice', columns, ...options };
  let state;
  function Probe(value) {
    state = useHeadlampTableState(value);
    return createElement('output', null, JSON.stringify({
      visible: state.visibleColumnKeys,
      filterRowVisible: state.filterRowVisible,
    }));
  }
  const render = async (next = {}) => {
    props = { ...props, ...next };
    // The real ResourceTable keys its hook owner by the same account/table scope.
    await act(async () => root.render(createElement(StrictMode, null,
      createElement(Probe, { ...props, key: JSON.stringify([props.preferenceUser, props.tableKey]) }))));
  };
  await render();
  return {
    render,
    state: () => state,
    shown: () => JSON.parse(dom.window.document.querySelector('output').textContent),
    storage: (user, table) => JSON.parse(dom.window.localStorage.getItem(
      `resource-table-preferences:user:${JSON.stringify([user, table])}`)),
    change: async (change) => { await act(async () => change(state)); },
    settle: async (pending, value, rejected = false) => {
      await act(async () => {
        if (rejected) pending.reject(value); else pending.resolve(value);
        await pending.promise.catch(() => {});
      });
    },
    close: async () => {
      await act(async () => root.unmount());
      dom.window.close();
      for (const [key, descriptor] of originals) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}

test('a cached remote request cannot overwrite a local column choice after columns are recreated', async () => {
  const pending = deferred();
  const saves = [];
  const client = {
    loadTablePreferences: () => pending.promise,
    saveTablePreferences: async (table, value) => { saves.push({ table, value }); },
  };
  const view = await harness({ preferencesClient: client });
  try {
    await view.change((state) => state.setColumnVisible('namespace', false));
    assert.deepEqual(view.shown().visible, ['name', 'status']);
    await view.render({ columns: columns.map((column) => ({ ...column })) });
    await view.settle(pending, { columnVisibility: { name: true, namespace: true, status: true } });
    assert.deepEqual(view.shown().visible, ['name', 'status'], 'late remote values must not revert the local choice');
    assert.equal(view.storage('alice', 'pods').columnVisibility.namespace, false);
    assert.equal(saves.at(-1).table, 'pods');
    assert.equal(saves.at(-1).value.columnVisibility.namespace, false);
  } finally { await view.close(); }
});

test('recreated column settings cannot restore remote visibility after a local choice', async () => {
  const pending = deferred();
  const view = await harness({
    columnSettings: [{ key: 'status', visible: true }],
    preferencesClient: { loadTablePreferences: () => pending.promise },
  });
  try {
    await view.change((state) => state.setColumnVisible('status', false));
    await view.render({ columnSettings: [{ key: 'status', visible: true }] });
    await view.settle(pending, { columnVisibility: { status: true } });
    assert.deepEqual(view.shown().visible, ['name', 'namespace']);
  } finally { await view.close(); }
});

test('late hydration cannot overwrite preferences after a local filter-row action', async () => {
  const pending = deferred();
  const view = await harness({ preferencesClient: { loadTablePreferences: () => pending.promise } }, {
    '["alice","pods"]': { columnVisibility: { namespace: false } },
  });
  try {
    await view.change((state) => state.setFilterRowVisible(true));
    await view.render({ columns: columns.map((column) => ({ ...column })) });
    await view.settle(pending, { columnVisibility: { namespace: true }, filterRowVisible: false });
    assert.deepEqual(view.shown(), { visible: ['name', 'status'], filterRowVisible: true });
    assert.equal(view.storage('alice', 'pods').filterRowVisible, true);
  } finally { await view.close(); }
});

test('remote hydration respects required columns and never performs a preference write', async () => {
  const pending = deferred();
  let saves = 0;
  const view = await harness({
    initialFilterRowVisible: true,
    preferencesClient: {
      loadTablePreferences: () => pending.promise,
      saveTablePreferences: async () => { saves++; },
    },
  });
  try {
    await view.settle(pending, {
      columnVisibility: { name: false, namespace: false, status: true },
      filterRowVisible: false,
    });
    assert.deepEqual(view.shown(), { visible: ['name', 'status'], filterRowVisible: true });
    assert.equal(view.storage('alice', 'pods'), null);
    assert.equal(saves, 0);
    await view.change((state) => state.setColumnVisible('name', false));
    assert.deepEqual(view.shown().visible, ['name', 'status']);
    assert.equal(saves, 0, 'required column changes must not persist a false preference');
  } finally { await view.close(); }
});

test('failed remote reads and writes retain usable local column preferences', async () => {
  const pending = deferred();
  const view = await harness({
    preferencesClient: {
      loadTablePreferences: () => pending.promise,
      saveTablePreferences: async () => { throw new Error('preference API unavailable'); },
    },
  }, { '["alice","pods"]': { columnVisibility: { namespace: false } } });
  try {
    await view.settle(pending, new Error('read unavailable'), true);
    assert.deepEqual(view.shown().visible, ['name', 'status']);
    await view.change((state) => state.setColumnVisible('status', false));
    assert.deepEqual(view.shown().visible, ['name']);
    assert.deepEqual(view.storage('alice', 'pods').columnVisibility,
      { name: true, namespace: false, status: false });
    await view.change((state) => state.resetColumnVisibility());
    assert.deepEqual(view.shown().visible, ['name', 'namespace', 'status']);
  } finally { await view.close(); }
});

test('account changes isolate local preferences and discard the previous account remote result', async () => {
  const alice = deferred();
  const bob = deferred();
  const view = await harness({ preferencesClient: { loadTablePreferences: () => alice.promise } }, {
    '["alice","pods"]': { columnVisibility: { namespace: false } },
    '["bob","pods"]': { columnVisibility: { status: false } },
  });
  try {
    assert.deepEqual(view.shown().visible, ['name', 'status']);
    await view.render({ preferenceUser: 'bob', preferencesClient: { loadTablePreferences: () => bob.promise } });
    assert.deepEqual(view.shown().visible, ['name', 'namespace']);
    await view.settle(alice, { columnVisibility: { namespace: false, status: true } });
    assert.deepEqual(view.shown().visible, ['name', 'namespace']);
    await view.settle(bob, { columnVisibility: { namespace: true, status: true } });
    assert.deepEqual(view.shown().visible, ['name', 'namespace', 'status']);
    await view.change((state) => state.setColumnVisible('namespace', false));
    assert.equal(view.storage('bob', 'pods').columnVisibility.namespace, false);
    assert.deepEqual(view.storage('alice', 'pods'), { columnVisibility: { namespace: false } });
  } finally { await view.close(); }
});

test('table changes rehydrate that table only and cannot accept the previous table result', async () => {
  const pods = deferred();
  const nodes = deferred();
  const client = {
    loadTablePreferences: (key) => key === 'pods' ? pods.promise : nodes.promise,
  };
  const view = await harness({ preferencesClient: client }, {
    '["alice","pods"]': { columnVisibility: { namespace: false } },
    '["alice","nodes"]': { columnVisibility: { status: false } },
  });
  try {
    await view.render({ tableKey: 'nodes' });
    assert.deepEqual(view.shown().visible, ['name', 'namespace']);
    await view.settle(pods, { columnVisibility: { namespace: false, status: true } });
    assert.deepEqual(view.shown().visible, ['name', 'namespace']);
    await view.settle(nodes, { columnVisibility: { namespace: false, status: false } });
    assert.deepEqual(view.shown().visible, ['name']);
  } finally { await view.close(); }
});

test('schema changes after a local action retain existing choices and apply defaults for new columns', async () => {
  const pending = deferred();
  const view = await harness({ preferencesClient: { loadTablePreferences: () => pending.promise } });
  try {
    await view.change((state) => state.setColumnVisible('namespace', false));
    await view.render({
      columns: [...columns, { key: 'age', title: 'Age' }, { key: 'uid', title: 'UID' }],
      columnSettings: [{ key: 'age', visible: false }],
    });
    assert.deepEqual(view.shown().visible, ['name', 'status', 'uid']);
    await view.settle(pending, { columnVisibility: { namespace: true, age: true, uid: false } });
    assert.deepEqual(view.shown().visible, ['name', 'status', 'uid']);
  } finally { await view.close(); }
});

test('schema rerenders before a local action still hydrate remote preferences using the current required columns', async () => {
  const pending = deferred();
  const view = await harness({ preferencesClient: { loadTablePreferences: () => pending.promise } });
  try {
    await view.render({ columns: columns.map((column) => ({
      ...column,
      required: column.key === 'status' ? true : column.required,
    })) });
    await view.settle(pending, { columnVisibility: { namespace: false, status: false } });
    assert.deepEqual(view.shown().visible, ['name', 'status']);
  } finally { await view.close(); }
});
