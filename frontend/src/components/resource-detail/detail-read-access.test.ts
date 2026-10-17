import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { createContext, isValidElement, type ReactElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { transformSync } from 'esbuild';
import { hashKey } from '@tanstack/react-query';
import { readAccessState } from '@/lib/query/read-access-state';
import * as queryState from './query-state';

type Element = ReactElement<Record<string, unknown>>;
const detail = {
  overview: { kind: 'Deployment', name: 'cached-private-workload', namespace: 'private', clusterId: 'c1' },
  descriptor: { resourceKind: 'Deployment' },
};
const denied = Object.assign(new Error('forbidden'), { status: 403 });
const unavailable = Object.assign(new Error('unavailable'), { status: 503 });

function fixture(standalone = false, nested = false) {
  let error: Error | null = null;
  let data: typeof detail | undefined = detail;
  let resourceId = 'c1:private:private-workload';
  const states: unknown[] = [];
  let slot = 0;
  let queryIndex = 0;
  const useState = (initial: unknown) => {
    const index = slot++;
    if (!(index in states)) states[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [states[index], (next: unknown) => { states[index] = next; }];
  };
  const source = readFileSync(new URL(standalone
    ? '../../app/clusters/[clusterId]/resource/[kind]/[...id]/page.tsx'
    : './resource-detail-drawer.tsx', import.meta.url), 'utf8');
  const { code } = transformSync(source, { loader: 'tsx', format: 'cjs', jsx: 'automatic' });
  const fixtureModule = { exports: {} as Record<string, (props?: Record<string, unknown>) => Element> };
  const require = (id: string): unknown => {
    if (id === 'react/jsx-runtime') return jsxRuntime;
    if (id === 'react') return { createContext, useState, useMemo: (fn: () => unknown) => fn(), useCallback: (fn: unknown) => fn };
    if (id === '@tanstack/react-query') return {
      hashKey,
      useQuery: () => {
        queryIndex++;
        if (!standalone && queryIndex === 1) return { data: { items: [] } };
        return { data, error, isSuccess: !error, isLoading: false, isPending: false, isFetching: false, refetch: () => {} };
      },
    };
    if (id === '@/lib/query/read-access-state') return {
      useReadAccess: (scope: string, query: { error: unknown; isSuccess: boolean }) => {
        const [state, setState] = useState({ scope, denied: false });
        const next = readAccessState(state as { scope: string; denied: boolean }, scope, { error: query.error, succeeded: query.isSuccess });
        if (next !== state) (setState as (value: unknown) => void)(next);
        return next.denied;
      },
    };
    if (id === './query-state' || id === '@/components/resource-detail/query-state') return queryState;
    if (id.endsWith('visible-resource-data')) return { isResourceAccessDenied: (value: { status?: number }) => [401, 403].includes(value?.status ?? 0) };
    if (id === 'next/navigation') return { useParams: () => ({ clusterId: 'c1', kind: 'deployment', id: [resourceId] }), useRouter: () => ({}) };
    if (id === '@/components/auth-context') return { useAuth: () => ({ accessToken: 'test-token' }) };
    if (id.endsWith('resource-edit-boundary')) return { ResourceEditBoundaryContext: createContext(null), useResourceEditBoundary: () => ({ request: (fn: () => void) => fn() }) };
    if (id.endsWith('detail-config')) return { getDetailTabs: () => [{ key: 'overview', label: 'Overview' }], renderTabContent: () => 'private-overview' };
    if (id === './utils') return { normalizeKind: (kind: string) => kind.toLowerCase(), getKindTitle: (kind: string) => kind, getRenderProfile: () => ({ title: 'Deployment' }) };
    if (id === 'antd') return { Space: 'Space', Tabs: 'Tabs', Spin: 'Spin', Alert: 'Alert', Typography: { Text: 'Text' } };
    return new Proxy({}, { get: (_, name) => name === '__esModule' ? true : String(name) });
  };
  vm.runInNewContext(code + (nested ? '\nmodule.exports.NestedResourceDetail = NestedResourceDetail;' : ''), { module: fixtureModule, exports: fixtureModule.exports, require, Error });
  return {
    render(nextError: Error | null = error, nextData: typeof detail | undefined = data, nextId = resourceId) {
      error = nextError; data = nextData; resourceId = nextId; slot = 0; queryIndex = 0;
      if (nested) return fixtureModule.exports.NestedResourceDetail({ clusterId: 'c1', target: { kind: 'deployment', id: resourceId }, accessToken: 'test-token', onClose: () => {}, onNavigate: () => {} });
      return standalone ? fixtureModule.exports.default() : fixtureModule.exports.ResourceDetailDrawer({
        open: true, token: 'test-token', request: { kind: 'deployment', id: resourceId, snapshot: { labels: { secret: 'private-snapshot' } } }, onClose: () => {},
      });
    },
  };
}

function elements(tree: unknown, type: string): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(child => elements(child, type));
  if (!isValidElement<Record<string, unknown>>(tree)) return [];
  return [...(tree.type === type || typeof tree.type === 'function' && tree.type.name === type ? [tree] : []), ...elements(tree.props.children, type)];
}

test('drawer keeps permission denial across a subsequent 503 without exposing cached overview or topology snapshot', () => {
  const drawer = fixture();
  assert.equal(elements(drawer.render(), 'Tabs').length, 1);
  assert.equal(elements(drawer.render(denied), 'Tabs').length, 0);
  const blocked = drawer.render(unavailable);
  assert.equal(elements(blocked, 'Tabs').length, 0, '503 cannot reauthorize a stale cached resource');
  assert.equal(elements(blocked, 'OpsPermissionState').length, 1);
  assert.equal(elements(blocked, 'SnapshotBlock').length, 0);
  assert.equal(elements(drawer.render(null), 'Tabs').length, 1, 'successful read releases the guard');
});

test('ordinary drawer refresh failure retains cached detail as degraded', () => {
  const drawer = fixture();
  const degraded = drawer.render(unavailable);
  assert.equal(elements(degraded, 'Tabs').length, 1);
  assert.equal(elements(degraded, 'OpsDegradedState').length, 1);
});

test('standalone detail denial hides cached resource identity after 503, and success restores it', () => {
  const page = fixture(true);
  assert.equal(elements(page.render(), 'Tabs').length, 1);
  const forbidden = page.render(denied);
  assert.equal(JSON.stringify(elements(forbidden, 'MasterDetailShell')[0].props.title).includes('cached-private-workload'), false, 'cached detail title must not survive denial');
  const blocked = page.render(unavailable);
  assert.equal(elements(blocked, 'Tabs').length, 0);
  assert.equal(elements(blocked, 'OpsPermissionState').length, 1);
  assert.equal(elements(page.render(null), 'Tabs').length, 1);
});

test('standalone ordinary refresh failure keeps overview mounted with a degraded notice', () => {
  const page = fixture(true);
  const degraded = page.render(unavailable);
  assert.equal(elements(degraded, 'Tabs').length, 1);
  assert.equal(elements(degraded, 'OpsDegradedState').length, 1);
});

test('denied topology-only detail cannot fall back to labels after a transient retry failure', () => {
  const drawer = fixture();
  drawer.render(denied, undefined);
  const blocked = drawer.render(unavailable, undefined);
  assert.equal(elements(blocked, 'SnapshotBlock').length, 0);
  assert.equal(elements(blocked, 'OpsPermissionState').length, 1);
});

test('denial is scoped to the selected resource and does not block another successful detail', () => {
  const drawer = fixture();
  drawer.render(denied);
  assert.equal(elements(drawer.render(null, detail, 'c1:private:other-workload'), 'Tabs').length, 1);
});

test('nested standalone detail latches denial and recovers only after successful read', () => {
  const nested = fixture(true, true);
  assert.equal(elements(nested.render(), 'Tabs').length, 1);
  nested.render(denied);
  const blocked = nested.render(unavailable);
  assert.equal(elements(blocked, 'Tabs').length, 0);
  assert.equal(elements(blocked, 'OpsPermissionState').length, 1);
  assert.equal(JSON.stringify(elements(blocked, 'MasterDetailShell')[0].props.title).includes('cached-private-workload'), false);
  assert.equal(elements(nested.render(null), 'Tabs').length, 1);
});
