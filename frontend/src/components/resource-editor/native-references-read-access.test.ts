import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { act, createElement, StrictMode, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { JSDOM } from 'jsdom';
import { tsImport } from 'tsx/esm/api';
import type { ResourceManifest } from '@/lib/resource-editor';

// Scope JSX loading to the real component import, leaving the suite loader intact.
const testUrl = pathToFileURL(resolve('src/components/resource-editor/native-references-read-access.test.ts')).href;
const referencesModule = tsImport('./native-references.tsx', testUrl) as Promise<typeof import('./native-references')>;
// tsImport follows this package's CJS mode; use its matching query context.
const { QueryClient, QueryClientProvider } = createRequire(testUrl)('@tanstack/react-query') as typeof import('@tanstack/react-query');
type References = ReturnType<typeof import('./native-references').useNativeReferences>;

// Replacing permission-aware queries with useQuery must fail these tests.
for (const candidate of ['services', 'secrets', 'classes'] as const) {
  test(`${candidate} candidates retain 503 cache, hide 403 through 503/remount, and isolate scope/token`, async () => {
    const { useNativeReferences, NativeReferenceInput } = await referencesModule;
    const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/' });
    const saved = new Map<string, PropertyDescriptor | undefined>();
    let status = 200;
    const fixtureFetch: typeof fetch = async (input, init) => {
      const url = new URL(String(input), 'http://localhost');
      assert.equal(init?.method, 'GET', 'candidate loading must never write resources');
      const clusterId = url.searchParams.get('clusterId');
      const namespace = url.searchParams.get('namespace') ?? 'cluster';
      const token = new Headers(init?.headers).get('Authorization');
      const prefix = `${clusterId}/${namespace}/${token}`;
      let payload: unknown;
      if (url.pathname === '/api/network') {
        assert.equal(url.searchParams.get('kind'), 'Service');
        payload = { items: [{ id: `${prefix}/service`, clusterId, namespace, kind: 'Service', name: `${prefix}/service`, state: 'active', spec: { ports: [{ name: 'https', port: 443, protocol: 'TCP' }] }, createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }], total: 1, page: 1, pageSize: 1000 };
      } else if (url.pathname === '/api/resources/editor/config-references') {
        assert.equal(url.searchParams.get('kind'), 'Secret');
        payload = { items: [{ name: `${prefix}/secret`, type: 'kubernetes.io/tls', keys: ['tls.crt', 'tls.key'] }] };
      } else {
        assert.equal(url.pathname, '/api/resources/ingressclasses');
        payload = { items: [{ name: `${prefix}/class`, controller: 'example.com/ingress', isDefault: true }] };
      }
      return new Response(JSON.stringify(status === 200 ? { data: payload } : { message: `fixture ${status}` }), { status, headers: { 'Content-Type': 'application/json' } });
    };
    for (const [key, value] of Object.entries({ window: dom.window, document: dom.window.document, getComputedStyle: dom.window.getComputedStyle.bind(dom.window), IS_REACT_ACT_ENVIRONMENT: true, fetch: fixtureFetch })) {
      saved.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
      Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    }
    const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity, staleTime: Infinity } } });
    const root = createRoot(dom.window.document.getElementById('root')!);
    const draft: ResourceManifest = { apiVersion: 'networking.k8s.io/v1', kind: 'Ingress', metadata: { name: 'draft', namespace: 'ns-a' }, spec: { ingressClassName: 'old-class', tls: [{ secretName: 'old-secret' }], rules: [{ http: { paths: [{ backend: { service: { name: 'old-service', port: { name: 'old-port' } } } } ] } }] } };
    const originalDraft = JSON.stringify(draft);
    const frames: Array<{ data: unknown; error: unknown }> = [];
    let references!: References;
    let mount = 0;
    const settle = () => new Promise(resolve => setTimeout(resolve, 20));
    function Probe({ clusterId, namespace, token }: { clusterId: string; namespace: string; token: string }) {
      const result = useNativeReferences('Ingress', { ...draft, metadata: { ...draft.metadata, namespace } }, clusterId, token);
      useLayoutEffect(() => {
        references = result;
        frames.push({ data: result[candidate].data, error: result[candidate].error });
      }, [result]);
      return createElement('output', null, result[candidate].data?.items[0]?.name ?? 'hidden');
    }
    const render = (clusterId = 'cluster-a', namespace = 'ns-a', token = 'token-a') => act(async () => {
      root.render(createElement(StrictMode, null, createElement(QueryClientProvider, { client }, createElement(Probe, { clusterId, namespace, token, key: mount }))));
      await settle();
    });
    const refresh = () => act(async () => { await references[candidate].refetch(); await settle(); });
    const visible = () => dom.window.document.querySelector('output')!.textContent;
    const expected = candidate === 'classes' ? 'cluster-a/cluster/Bearer token-a/class' : `cluster-a/ns-a/Bearer token-a/${candidate === 'services' ? 'service' : 'secret'}`;
    try {
      await render();
      await refresh();
      assert.equal(visible(), expected);
      status = 503;
      await refresh();
      assert.equal(visible(), expected, 'transient failure before denial retains candidates');
      status = 403;
      frames.length = 0;
      await refresh();
      const deniedFrames = frames.filter(frame => frame.error instanceof Error && 'status' in frame.error && frame.error.status === 403);
      assert.ok(deniedFrames.length > 0);
      assert.ok(deniedFrames.every(frame => frame.data === undefined), 'no denied committed frame may expose candidate cache');
      assert.equal(visible(), 'hidden');
      const paths: Array<{ path: Array<string | number>; value: unknown }> = [
        { path: ['spec', 'ingressClassName'], value: 'old-class' },
        { path: ['spec', 'tls', 0, 'secretName'], value: 'old-secret' },
        { path: ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'name'], value: 'old-service' },
        { path: ['spec', 'rules', 0, 'http', 'paths', 0, 'backend', 'service', 'port'], value: { name: 'old-port' } },
      ];
      for (const field of paths) {
        const markup = renderToStaticMarkup(createElement(NativeReferenceInput, {
          ...field, manifest: draft, disabled: false, clusterId: 'cluster-a', token: 'token-a', ...references,
          onChange: () => assert.fail('candidate read failures must not mutate the draft'),
        }));
        assert.ok(markup.includes(typeof field.value === 'string' ? field.value : 'old-port'), 'original reference stays visible');
        assert.ok(markup.includes('尚未验证'), 'original reference remains explicitly unverified');
      }
      assert.equal(JSON.stringify(draft), originalDraft);
      status = 503;
      frames.length = 0;
      await refresh();
      assert.ok(frames.length > 0 && frames.every(frame => frame.data === undefined), '503 after denial must not resurrect cache');
      mount++;
      frames.length = 0;
      await render();
      assert.ok(frames.length > 0 && frames.every(frame => frame.data === undefined), 'remount must preserve denial');
      status = 200;
      await refresh();
      assert.equal(visible(), expected, 'fresh success restores candidates');
      for (const [clusterId, namespace, token] of [['cluster-b', 'ns-a', 'token-a'], ['cluster-b', 'ns-a', 'token-b'], ['cluster-b', 'ns-b', 'token-b']]) {
        status = 503;
        frames.length = 0;
        const previous = visible();
        await render(clusterId, namespace, token);
        await refresh();
        if (candidate !== 'classes' || namespace !== 'ns-b') {
          assert.ok(frames.every(frame => frame.data === undefined), 'changed scope/token must not reuse prior candidates');
          assert.equal(visible(), 'hidden');
        }
        status = 200;
        await refresh();
        const next = candidate === 'classes' ? `${clusterId}/cluster/Bearer ${token}/class` : `${clusterId}/${namespace}/Bearer ${token}/${candidate === 'services' ? 'service' : 'secret'}`;
        assert.equal(visible(), next);
        if (candidate !== 'classes' || namespace !== 'ns-b') assert.notEqual(visible(), previous);
      }
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
}
