import assert from 'node:assert/strict';
import test from 'node:test';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { JSDOM } from 'jsdom';
import { ApiError } from '@/lib/api/client';
import { listQueryOptions } from '@/lib/query/policies';
import { useResourceListQuery } from './use-resource-list-query';
import { applyRealtimePatch } from '@/components/realtime-sync-utils';

test('resource query hides denied cache on every render but retains transient failures and recovers', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { ...listQueryOptions, retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  client.setQueryData(['resources', 'account-a'], ['private-a']);
  const frames: Array<{ data: string[] | undefined; error: unknown }> = [];
  let failure: Error | undefined;
  let mount = 0;
  let query!: ReturnType<typeof useResourceListQuery<string[]>>;
  function Probe({ account }: { account: string }) {
    const result = useResourceListQuery<string[]>({ queryKey: ['resources', account], staleTime: Infinity, queryFn: async () => {
      if (failure) throw failure;
      return [`private-${account.slice(-1)}`];
    } });
    useLayoutEffect(() => {
      query = result;
      frames.push({ data: result.data, error: result.error });
    }, [result]);
    return createElement('output', null, result.data?.join(',') || 'hidden');
  }
  const render = (account: string) => act(async () => {
    root.render(createElement(StrictMode, null, createElement(QueryClientProvider, { client }, createElement(Probe, { account, key: mount }))));
    await new Promise(resolve => setTimeout(resolve, 15));
  });
  const refresh = () => act(async () => { await query.refetch(); await new Promise(resolve => setTimeout(resolve, 15)); });
  try {
    await render('account-a');
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-a');
    failure = new Error('offline');
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-a');
    for (const status of [401, 403]) {
      failure = new ApiError('forbidden', status);
      frames.length = 0;
      await refresh();
      const denied = frames.filter(frame => frame.error instanceof ApiError);
      assert.ok(denied.length);
      assert.ok(denied.every(frame => frame.data === undefined), 'no denied render may expose cached rows');
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    }
    failure = new ApiError('service unavailable after denial', 503);
    frames.length = 0;
    await refresh();
    assert.ok(frames.length);
    assert.ok(frames.every(frame => frame.data === undefined), 'a transient failure after denial must not restore private cache');
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    mount++;
    frames.length = 0;
    await render('account-a');
    assert.ok(frames.every(frame => frame.data === undefined), 'reopening a denied resource list must not restore private cache');
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    failure = undefined;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-a');
    frames.length = 0;
    await render('account-b');
    assert.ok(frames.every(frame => !frame.data?.includes('private-a')), 'changed account must not inherit previous rows');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    // Drain queued query notifications/React scheduler work while the DOM
    // is still installed; otherwise cleanup can race a pending callback.
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test('realtime updates cannot reveal denied rows; only a fresh successful list read restores them', async () => {
  const dom = new JSDOM('<div id="root"></div>');
  const saved = new Map<string, PropertyDescriptor | undefined>();
  for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, IS_REACT_ACT_ENVIRONMENT: true })) {
    saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  }
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
  const root = createRoot(dom.window.document.getElementById('root')!);
  const frames: Array<string[] | undefined> = [];
  let failure: Error | undefined;
  let query!: ReturnType<typeof useResourceListQuery<{ items: Array<{ name: string }> }>>;
  const item = { name: 'private-config', clusterId: 'qa-cluster', namespace: 'default', state: 'active' };
  function Probe() {
    const result = useResourceListQuery({ queryKey: ['configs', 'configmaps', 'qa-account'], staleTime: Infinity, queryFn: async () => {
      if (failure) throw failure;
      return { items: [item] };
    } });
    useLayoutEffect(() => { query = result; frames.push(result.data?.items.map(row => row.name)); }, [result]);
    return createElement('output', null, result.data?.items[0]?.name ?? 'hidden');
  }
  const settle = () => new Promise(resolve => setTimeout(resolve, 20));
  const refresh = () => act(async () => { await query.refetch(); await settle(); });
  try {
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(QueryClientProvider, { client }, createElement(Probe))));
      await settle();
    });
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-config');
    failure = new ApiError('forbidden', 403);
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden');
    frames.length = 0;
    for (const name of ['unrelated-config', 'private-config']) {
      await act(async () => {
        applyRealtimePatch(client, {
          clusterId: 'qa-cluster', domains: ['configs'], kind: 'ConfigMap', phase: 'update', action: 'upsert',
          resource: { kind: 'ConfigMap', name, namespace: 'default', state: 'updated' }, timestamp: '2026-10-11T00:00:00Z',
        });
        await settle();
      });
      assert.equal(dom.window.document.querySelector('output')!.textContent, 'hidden', 'stream events must not lift read denial');
    }
    failure = new ApiError('unavailable', 503);
    await refresh();
    assert.ok(frames.every(frame => frame === undefined), 'no intermediate commit may expose denied rows');
    failure = undefined;
    await refresh();
    assert.equal(dom.window.document.querySelector('output')!.textContent, 'private-config');
  } finally {
    await act(async () => root.unmount());
    client.clear();
    await act(async () => { await settle(); });
    dom.window.close();
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor); else Reflect.deleteProperty(globalThis, key);
    }
  }
});
