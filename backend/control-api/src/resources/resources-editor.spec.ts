jest.mock('@kubernetes/client-node', () => ({
  loadYaml: (text: string) => require('js-yaml').load(text),
  dumpYaml: (value: unknown) => require('js-yaml').dump(value),
  KubernetesObjectApi: class {
    constructor(configuration: any) { return configuration.objectApi; }
    static makeApiClient(kc: any) { return kc.objectApi; }
  },
  ApiextensionsV1Api: class {},
}));
import { HttpException } from '@nestjs/common';
import { ResourcesService, type ResourceEditorSubmitRequest } from './resources.service';
import { ResourcesController } from './resources.controller';
import { ClusterAccessService } from '../common/cluster-access.service';
import { AuthorizationService } from '../common/authorization.service';
import { HttpExceptionFilter } from '../common/filters/http-exception.filter';

const request = { user: { user: { id: 'u', role: 'operator' } } };
const rows = [
  { group: '', version: 'v1', resource: 'configmaps', kind: 'ConfigMap', namespaced: true },
  { group: '', version: 'v1', resource: 'secrets', kind: 'Secret', namespaced: true },
  { group: '', version: 'v1', resource: 'nodes', kind: 'Node', namespaced: false },
  { group: 'example.test', version: 'v1', resource: 'mice', kind: 'Mouse', namespaced: true },
  { group: 'example.test', version: 'v2', resource: 'mice', kind: 'Mouse', namespaced: true },
  { group: 'example.test', version: 'v1', resource: 'fleets', kind: 'Fleet', namespaced: false },
  { group: 'networking.k8s.io', version: 'v1', resource: 'networkpolicies', kind: 'NetworkPolicy', namespaced: true },
].map(row => ({ ...row, id: row.resource, clusterId: 'c', verbsJson: ['get', 'create', 'update'], lastDiscoveredAt: new Date(0) }));
const key = (m: any) => [m.apiVersion, m.kind, m.metadata.namespace ?? '', m.metadata.name].join('|');
const doc = (kind = 'ConfigMap', namespace: string | undefined = 'apps', name = 'x') => ({
  apiVersion: ['Mouse', 'Fleet'].includes(kind) ? 'example.test/v1' : 'v1', kind,
  metadata: { name, ...(namespace ? { namespace } : {}) },
});
const body = (documents: any[] = [doc()], overrides: Partial<ResourceEditorSubmitRequest> = {}): ResourceEditorSubmitRequest => ({
  clusterId: 'c', operation: 'create', yaml: documents.map(d => JSON.stringify(d)).join('\n---\n'), dryRun: false, ...overrides,
});
const apiError = (code: number, message = 'sensitive-secret-value') => Object.assign(new Error(message), { code, body: { code, message } });
function grant(namespace = 'apps', role = 'operator', secret = false) {
  return { id: namespace, userId: 'u', groupId: null, clusterId: 'c', role, state: 'active', validFrom: new Date(0), expiresAt: null, revokedAt: null, namespaces: [{ namespaceUid: 'uid-' + namespace }], capabilities: secret ? [{ capability: 'secrets' }] : [] };
}
function harness(opts: { unrestricted?: boolean; grants?: ReturnType<typeof grant>[] } = {}) {
  const events: Array<{ action: string; manifest: any; dryRun?: string }> = [];
  const live = new Map<string, any>();
  const external = { failCreateName: '', failCreateStatus: 422, race: false, crdError: undefined as unknown, uid: 'uid-apps' };
  const objectApi = {
    resource: async () => ({}),
    list: async (_version: string, kind: string) => ({ items: kind === 'Service' ? [doc('Service')] : [], metadata: {} }),
    async create(m: any, _pretty?: string, dryRun?: string) {
      events.push({ action: 'create', manifest: structuredClone(m), dryRun });
      if (live.has(key(m))) throw apiError(409);
      if (!dryRun && m.metadata.name === external.failCreateName) throw apiError(external.failCreateStatus);
      const result = { ...m, metadata: { ...m.metadata, resourceVersion: '1' } };
      if (!dryRun) live.set(key(m), result);
      return result;
    },
    async read(m: any) {
      events.push({ action: 'read', manifest: structuredClone(m) });
      const result = live.get(key(m));
      if (!result) throw apiError(404);
      return structuredClone(result);
    },
    async replace(m: any, _pretty?: string, dryRun?: string) {
      events.push({ action: 'replace', manifest: structuredClone(m), dryRun });
      const current = live.get(key(m));
      if (!current) throw apiError(404);
      if (external.race || current.metadata.resourceVersion !== m.metadata.resourceVersion) throw apiError(409);
      const result = { ...m, metadata: { ...m.metadata, resourceVersion: '2' } };
      if (!dryRun) live.set(key(m), result);
      return result;
    },
  };
  const schema = { type: 'object', properties: { spec: { type: 'object', properties: { size: { type: 'integer' } } } } };
  const crd = { spec: { group: 'example.test', names: { kind: 'Mouse', plural: 'mice' }, scope: 'Namespaced', versions: [
    { name: 'v1', served: true, schema: { openAPIV3Schema: schema } }, { name: 'v2', served: true },
  ] } };
  const crdReads: unknown[] = [];
  const crdApi = { async readCustomResourceDefinition(param: { name: string }) {
    crdReads.push(param);
    if (external.crdError) throw external.crdError;
    if (param?.name !== 'mice.example.test') throw apiError(404);
    return crd;
  } };
  const prisma = {
    apiResourceCapability: {
      findMany: async () => rows,
      findFirst: async ({ where }: any) => rows.find(row => Object.entries(where).every(([k, v]) => (row as any)[k] === v)),
    },
    clusterRegistry: { findFirst: async () => ({ id: 'c' }) },
    clusterRoleBinding: {
      findFirst: async () => opts.unrestricted ? { clusterId: 'c', role: 'operator' } : null,
      findMany: async () => opts.unrestricted ? [{ clusterId: 'c' }] : [],
    },
    groupMembership: { findMany: async () => [] }, accessGrant: { findMany: async () => opts.grants ?? [grant()] },
  };
  const clusters = { getKubeconfig: async () => 'kc' };
  const authorization = new AuthorizationService(prisma as never);
  const service = new ResourcesService(clusters as never, { assertClusterOnlineForRead: async () => {} } as never, { createClient: () => ({ objectApi, makeApiClient: (Api: any) => Api === require('@kubernetes/client-node').ApiextensionsV1Api ? crdApi : new Api({ objectApi }) }) } as never, prisma as never);
  const sync = jest.fn();
  const controller = new ResourcesController(service, clusters as never, { syncCluster: sync } as never, new ClusterAccessService(prisma as never, authorization), authorization, { resolve: async (_c: string, ns: string) => ns === 'apps' ? external.uid : 'uid-' + ns } as never);
  return { controller, service, live, events, external, schema, crd, crdReads, sync };
}
async function rejected(call: Promise<unknown>, status: number) {
  try { await call; throw new Error('expected rejection'); } catch (error) {
    expect(error).toBeInstanceOf(HttpException);
    expect((error as HttpException).getStatus()).toBe(status);
    return error as HttpException;
  }
}

describe('workload access reads', () => {
  afterEach(() => jest.useRealTimers());
  it('returns readable lists when one resource API never responds', async () => {
    jest.useFakeTimers();
    const h = harness();
    const workload = { apiVersion: 'apps/v1', kind: 'Deployment', metadata: { name: 'app', namespace: 'apps' } };
    h.live.set(key(workload), workload);
    const client = (h.service as any).k8sClientService.createClient().objectApi;
    const list = client.list;
    client.list = (version: string, kind: string) => kind === 'EndpointSlice' ? new Promise(() => {}) : list(version, kind);
    let result: any;
    const pending = h.service.getAccessContext({ clusterId: 'c', namespace: 'apps', kind: 'Deployment', name: 'app' }).then(value => { result = value; });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(result).toBeDefined();
    expect(result.lists.find((row: any) => row.kind === 'Service').items[0].metadata.name).toBe('x');
    expect(result.lists.find((row: any) => row.kind === 'EndpointSlice')).toMatchObject({ incomplete: true, items: [], error: expect.any(String) });
    await pending;
  });
  it('fails explicitly rather than waiting forever for the required workload', async () => {
    jest.useFakeTimers();
    const h = harness();
    (h.service as any).k8sClientService.createClient().objectApi.read = () => new Promise(() => {});
    let failure: any;
    const pending = h.service.getAccessContext({ clusterId: 'c', namespace: 'apps', kind: 'Deployment', name: 'app' }).catch(error => { failure = error; });
    await jest.advanceTimersByTimeAsync(30_000);
    expect(failure).toBeInstanceOf(HttpException);
    expect(failure.getStatus()).toBe(504);
    await pending;
  });
});

describe('resource editor security behavior', () => {
  const previous = process.env.KUBENOVA_AUTHZ_ENFORCE;
  beforeEach(() => { process.env.KUBENOVA_AUTHZ_ENFORCE = 'true'; });
  afterEach(() => { if (previous === undefined) delete process.env.KUBENOVA_AUTHZ_ENFORCE; else process.env.KUBENOVA_AUTHZ_ENFORCE = previous; });
  it.each([doc('Mouse', 'private'), doc('Fleet', ''), doc('Node', 'apps')])('rejects unauthorized discovered scope before any batch preflight: %j', async denied => {
    const h = harness(); await rejected(h.controller.submitEditor(request, body([doc(), denied])), 403);
    expect(h.events).toEqual([]); expect(h.live.size).toBe(0); expect(h.sync).not.toHaveBeenCalled();
  });
  it('checks mutation on the target namespace, not an operator grant elsewhere', async () => {
    const h = harness({ grants: [grant('private'), grant('apps', 'viewer')] });
    await rejected(h.controller.submitEditor(request, body()), 403); expect(h.events).toEqual([]);
  });
  it.each([false, true])('Secret denial blocks preflight and mutation (dryRun=%s)', async dryRun => {
    const h = harness({ unrestricted: true }); await rejected(h.controller.submitEditor(request, body([doc(), doc('Secret')], { dryRun })), 403);
    expect(h.events).toEqual([]);
  });
  it('uses current namespace UID and fails a recreated namespace grant', async () => {
    const h = harness(); h.external.uid = 'uid-recreated'; await rejected(h.controller.submitEditor(request, body([doc('Mouse')])), 403);
    expect(h.events).toEqual([]);
  });
  it('dry-runs all resources without persistence or sync', async () => {
    const h = harness(); const result = await h.controller.submitEditor(request, body([doc(), doc('Mouse')], { dryRun: true }));
    expect(result.total).toBe(2); expect(result.dryRun).toBe(true); expect(h.events.map(e => e.dryRun)).toEqual(['All', 'All']);
    expect(h.live.size).toBe(0); expect(h.sync).not.toHaveBeenCalled();
  });
  it('preflights the complete batch before create-only persistence', async () => {
    const h = harness(); await h.controller.submitEditor(request, body([doc(), doc('Mouse')]));
    expect(h.events.map(e => e.dryRun)).toEqual(['All', 'All', undefined, undefined]); expect(h.live.size).toBe(2);
  });
  it('strips a copied resourceVersion from create manifests', async () => {
    const h = harness();
    const draft = { ...doc(), metadata: { ...doc().metadata, resourceVersion: 'stale' } };
    await h.controller.submitEditor(request, body([draft]));
    expect(h.events.filter(e => e.action === 'create').every(e => e.manifest.metadata.resourceVersion === undefined)).toBe(true);
  });
  it('returns 409 on an existing name without live writes', async () => {
    const h = harness(); h.live.set(key(doc()), doc()); await rejected(h.controller.submitEditor(request, body()), 409);
    expect(h.events.every(e => e.dryRun === 'All')).toBe(true); expect(h.live.size).toBe(1);
  });
  it('rejects duplicate identities before preflight', async () => {
    const h = harness(); await rejected(h.controller.submitEditor(request, body([doc(), doc()])), 400); expect(h.events).toEqual([]);
  });
  it.each([{ operation: 'apply' }, { dryRun: 'false' }, { dryRun: undefined }, { yaml: 42 }, { identity: {}, operation: 'update' }, { namespace: 42 }])('rejects malformed request without effects: %j', async override => {
    const h = harness(); await rejected(h.controller.submitEditor(request, body([doc()], override as any)), 400); expect(h.events).toEqual([]);
  });
  it('returns structured partial failure with identity-only details and no Secret values', async () => {
    const h = harness({ unrestricted: true, grants: [grant('apps', 'operator', true)] }); h.external.failCreateName = 'second';
    const error = await rejected(h.controller.submitEditor(request, body([doc('Secret', 'apps', 'first'), doc('Secret', 'apps', 'second')])), 409);
    const response = error.getResponse() as any;
    expect(response.code).toBe('PARTIAL_CREATE_FAILED');
    expect(response.details.completed).toEqual([{ apiVersion: 'v1', kind: 'Secret', name: 'first', namespace: 'apps', resourceVersion: '1' }]);
    expect(response.details.failed).toEqual({ apiVersion: 'v1', kind: 'Secret', name: 'second', namespace: 'apps' });
    expect(JSON.stringify(response)).not.toContain('sensitive-secret-value'); expect(h.live.size).toBe(1);
    const json = jest.fn(); const status = jest.fn(() => ({ json }));
    new HttpExceptionFilter().catch(error, { switchToHttp: () => ({ getResponse: () => ({ status, setHeader: jest.fn() }), getRequest: () => ({ headers: {}, url: '/api/resources/editor/submit' }) }) } as any);
    expect(json.mock.calls[0][0].details.completed[0].name).toBe('first');
  });
  it('preserves original failure status when zero resources were created', async () => {
    const h = harness(); h.external.failCreateName = 'x'; const error = await rejected(h.controller.submitEditor(request, body()), 422);
    expect((error.getResponse() as any).code).not.toBe('PARTIAL_CREATE_FAILED');
    expect(JSON.stringify(error.getResponse())).not.toContain('sensitive-secret-value'); expect(h.live.size).toBe(0);
  });
  it('does not echo malformed Secret YAML through parser diagnostics', async () => {
    const h = harness();
    const error = await rejected(h.controller.submitEditor(request, body([], { yaml: 'apiVersion: v1\nkind: Secret\nstringData: [sensitive-secret-value' })), 400);
    expect(JSON.stringify(error.getResponse())).not.toContain('sensitive-secret-value'); expect(h.events).toEqual([]);
  });
  it.each([{ metadata: [] }, { metadata: { name: 'x', namespace: 'apps', resourceVersion: 12 } }, { apiVersion: 5 }])('rejects malformed manifest fields before effects: %j', async override => {
    const h = harness(); await rejected(h.controller.submitEditor(request, body([{ ...doc(), ...override }])), 400); expect(h.events).toEqual([]);
  });
});

describe('resource editor version-protected replacement', () => {
  function edit(kind = 'Mouse', namespace = 'apps') {
    const h = harness({ unrestricted: true });
    const original = { ...doc(kind, namespace), metadata: { ...doc(kind, namespace).metadata, resourceVersion: '1' }, spec: { keep: 'old', remove: true }, unknown: { keep: true } };
    h.live.set(key(original), original);
    const draft = { ...original, spec: { keep: 'new' }, status: { phase: 'ignored' }, metadata: { ...original.metadata, managedFields: [{ manager: 'server' }] } };
    const input = body([draft], { operation: 'update', identity: { apiVersion: original.apiVersion, kind, name: 'x', ...(namespace ? { namespace } : {}) } });
    return { ...h, original, draft, input };
  }
  it('replaces exact desired draft, retains unknown fields and RV, strips server fields', async () => {
    const h = edit(); await h.controller.submitEditor(request, h.input); const saved = h.live.get(key(h.original));
    expect(saved.spec).toEqual({ keep: 'new' }); expect(saved.unknown).toEqual({ keep: true }); expect(saved.status).toBeUndefined(); expect(saved.metadata.managedFields).toBeUndefined();
    expect(h.events.find(e => e.action === 'replace')?.manifest.metadata.resourceVersion).toBe('1');
  });
  it('accepts omitted namespace for a discovered cluster-scoped identity', async () => {
    const h = edit('Fleet', ''); const result = await h.controller.submitEditor(request, h.input);
    expect(result.items[0].namespace).toBe(''); expect(h.live.get(key(h.original)).spec).toEqual({ keep: 'new' });
  });
  it('rejects adding a namespace to a cluster-scoped update', async () => {
    const h = edit('Fleet', ''); h.input.yaml = JSON.stringify({ ...h.draft, metadata: { ...h.draft.metadata, namespace: 'apps' } });
    await rejected(h.controller.submitEditor(request, h.input), 400); expect(h.events).toEqual([]);
  });
  it.each(['stale', 'race', 'inconsistent'])('returns 409 for %s resourceVersion without overwriting', async mode => {
    const h = edit(); if (mode === 'stale') h.live.get(key(h.original)).metadata.resourceVersion = '7'; if (mode === 'race') h.external.race = true; if (mode === 'inconsistent') h.input.resourceVersion = '8';
    await rejected(h.controller.submitEditor(request, h.input), 409); expect(h.live.get(key(h.original)).spec).toEqual({ keep: 'old', remove: true });
  });
  it.each(['namespace', 'apiVersion', 'resource', 'missingVersion', 'missingIdentity', 'missingKind'])('rejects %s identity/precondition bypass', async field => {
    const h = edit();
    if (field === 'namespace') h.input.identity!.namespace = 'private'; if (field === 'apiVersion') h.input.identity!.apiVersion = 'example.test/v2'; if (field === 'resource') h.input.identity!.resource = 'fleets';
    if (field === 'missingVersion') { delete (h.draft.metadata as any).resourceVersion; h.input.yaml = JSON.stringify(h.draft); }
    if (field === 'missingIdentity') delete h.input.identity; if (field === 'missingKind') { delete (h.draft as any).kind; h.input.yaml = JSON.stringify(h.draft); }
    await rejected(h.controller.submitEditor(request, h.input), 400); expect(h.events.filter(e => e.action === 'replace')).toEqual([]);
  });
  it('update dry-run preserves live state and never syncs', async () => {
    const h = edit(); h.input.dryRun = true; await h.controller.submitEditor(request, h.input);
    expect(h.live.get(key(h.original)).spec.keep).toBe('old'); expect(h.sync).not.toHaveBeenCalled(); expect(h.events.find(e => e.action === 'replace')?.dryRun).toBe('All');
  });
  it.each(['typed', 'dynamic'])('legacy %s updater uses version-protected replace and preserves 409', async route => {
    const h = edit(route === 'typed' ? 'ConfigMap' : 'Mouse');
    const legacy = { clusterId: 'c', kind: h.original.kind, name: 'x', namespace: 'apps', yaml: h.input.yaml, group: 'example.test', version: 'v1', resource: 'mice', dryRun: false };
    const run = () => route === 'typed' ? h.service.updateYaml(legacy) : h.service.updateDynamicYaml(legacy);
    h.external.race = true; await rejected(run(), 409); expect(h.live.get(key(h.original)).spec.keep).toBe('old');
    h.external.race = false; await run(); expect(h.live.get(key(h.original)).spec).toEqual({ keep: 'new' });
  });
  it.each(['typed', 'dynamic'])('legacy %s updater cannot retarget apiVersion', async route => {
    const h = edit(route === 'typed' ? 'ConfigMap' : 'Mouse'); h.draft.apiVersion = 'evil.test/v2';
    const legacy = { clusterId: 'c', kind: h.original.kind, name: 'x', namespace: 'apps', yaml: JSON.stringify(h.draft), group: 'example.test', version: 'v1', resource: 'mice' };
    await rejected(route === 'typed' ? h.service.updateYaml(legacy) : h.service.updateDynamicYaml(legacy), 400); expect(h.events).toEqual([]);
  });
});

describe('resource editor schema authorization and discovery', () => {
  const query = { clusterId: 'c', apiVersion: 'example.test/v1', kind: 'Mouse', namespace: 'apps', resource: 'mice' };
  it('reads exact discovered plural with object-parameter client and exact version', async () => {
    const h = harness(); const result = await h.controller.getEditorSchema(request, query);
    expect(result).toEqual({ schema: h.schema, source: 'crd' }); expect(h.crdReads).toEqual([{ name: 'mice.example.test' }]);
    const missing = await h.controller.getEditorSchema(request, { ...query, apiVersion: 'example.test/v2' }); expect(missing.schema).toBeNull(); expect(missing.source).toBe('unavailable');
  });
  it.each([{ namespace: 'private' }, { kind: 'Fleet', resource: 'fleets', namespace: undefined }])('denies unauthorized schema scope before reading CRDs: %j', async override => {
    const h = harness(); await rejected(h.controller.getEditorSchema(request, { ...query, ...override }), 403); expect(h.crdReads).toEqual([]);
  });
  it('uses networkpolicies discovery plural rather than kind+s', async () => {
    const h = harness({ unrestricted: true }); const result = await h.controller.getEditorSchema(request, { clusterId: 'c', apiVersion: 'networking.k8s.io/v1', kind: 'NetworkPolicy', namespace: 'apps' });
    expect(h.crdReads).toEqual([{ name: 'networkpolicies.networking.k8s.io' }]); expect(result.source).toBe('unavailable');
  });
  it('does not return a schema for an unserved CRD version', async () => {
    const h = harness(); h.crd.spec.versions[0].served = false; expect((await h.controller.getEditorSchema(request, query)).schema).toBeNull();
  });
  it('degrades only 404 to unavailable', async () => {
    const h = harness(); h.external.crdError = apiError(404); expect((await h.controller.getEditorSchema(request, query)).source).toBe('unavailable');
  });
  it.each([400, 401, 403, 422, 500, 503])('preserves CRD API status %s rather than unavailable', async status => {
    const h = harness(); h.external.crdError = apiError(status); const error = await rejected(h.controller.getEditorSchema(request, query), status);
    expect(JSON.stringify(error.getResponse())).not.toContain('sensitive-secret-value');
  });
  it('propagates network failure as 502 rather than unavailable', async () => {
    const h = harness(); h.external.crdError = new Error('ECONNRESET sensitive-secret-value'); await rejected(h.controller.getEditorSchema(request, query), 502);
  });
  it('returns honest unavailable for core OpenAPI without a fabricated schema', async () => {
    const h = harness(); const result = await h.controller.getEditorSchema(request, { clusterId: 'c', apiVersion: 'v1', kind: 'ConfigMap', namespace: 'apps' });
    expect(result.source).toBe('unavailable'); expect(result.schema).toBeNull(); expect(h.crdReads).toEqual([]);
  });
});
