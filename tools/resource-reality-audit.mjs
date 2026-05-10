#!/usr/bin/env node

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:4000';
const USERNAME = process.env.AUDIT_USERNAME || 'admin@local.dev';
const PASSWORD = process.env.AUDIT_PASSWORD || 'admin123456';

function ts() {
  const d = new Date();
  return d.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function uid(prefix) {
  return `${prefix}-${ts()}-${Math.random().toString(36).slice(2, 6)}`.toLowerCase();
}

async function req(path, { method = 'GET', token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { raw: text };
  }
  const payload = json?.data ?? json;
  if (!res.ok) {
    const msg = payload?.message || json?.message || res.statusText;
    throw new Error(`${method} ${path} -> ${res.status}: ${msg}`);
  }
  return payload;
}

async function dynamicList(token, q) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(q)) {
    if (v !== undefined && v !== null && `${v}` !== '') sp.set(k, String(v));
  }
  return req(`/api/resources/dynamic?${sp.toString()}`, { token });
}

async function dynamicExists(token, q, name) {
  const list = await dynamicList(token, { ...q, page: 1, pageSize: 200, keyword: name });
  const items = list.items || [];
  return items.some((it) => it.name === name);
}

async function waitUntilAbsent(token, q, name, maxTry = 10, waitMs = 1000) {
  for (let i = 0; i < maxTry; i += 1) {
    const exists = await dynamicExists(token, q, name);
    if (!exists) return true;
    await new Promise((r) => setTimeout(r, waitMs));
  }
  return false;
}

async function dynamicDetail(token, identity) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(identity)) {
    if (v !== undefined && v !== null) sp.set(k, String(v));
  }
  return req(`/api/resources/dynamic/detail?${sp.toString()}`, { token });
}

async function main() {
  const report = {
    startedAt: new Date().toISOString(),
    baseUrl: BASE,
    cluster: null,
    cases: [],
    summary: { pass: 0, fail: 0 },
  };

  const login = await req('/api/auth/login', {
    method: 'POST',
    body: { username: USERNAME, password: PASSWORD },
  });
  const token = login.accessToken;
  if (!token) throw new Error('login without accessToken');

  const clusters = await req('/api/clusters?pageSize=200', { token });
  const target = (clusters.items || []).find((c) => c.state === 'active' && c.hasKubeconfig);
  if (!target) throw new Error('no active cluster with kubeconfig');
  report.cluster = { id: target.id, name: target.name };

  const clusterId = target.id;

  await req("/api/resources/discovery/refresh", {
    method: "POST",
    token,
    body: { clusterId },
  });

  const defaultNs = 'default';
  const nsName = uid('audit-ns');
  const depName = uid('audit-dep');

  async function runCase(name, fn) {
    const row = { name, ok: false, detail: '', error: '' };
    try {
      const detail = await fn();
      row.ok = true;
      row.detail = detail || 'ok';
      report.summary.pass += 1;
    } catch (e) {
      row.ok = false;
      row.error = e instanceof Error ? e.message : String(e);
      report.summary.fail += 1;
    }
    report.cases.push(row);
  }

  // 1) Namespace via namespaces API
  let nsRecordId = '';
  await runCase('namespaces.create -> should exist in cluster', async () => {
    const out = await req('/api/namespaces', {
      method: 'POST',
      token,
      body: { clusterId, namespace: nsName, labels: { audit: 'true' } },
    });
    nsRecordId = out.id;
    const ok = await dynamicExists(token, { clusterId, group: '', version: 'v1', resource: 'namespaces' }, nsName);
    if (!ok) throw new Error(`namespace ${nsName} not found in cluster`);
    return `namespace ${nsName} created in cluster`;
  });

  await runCase('namespaces.update(labels) -> should reflect in cluster', async () => {
    if (!nsRecordId) throw new Error('namespace record id missing');
    await req(`/api/namespaces/${nsRecordId}`, {
      method: 'PATCH',
      token,
      body: { labels: { audit: 'true', updated: 'yes' } },
    });
    const detail = await dynamicDetail(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'namespaces',
      namespace: '',
      name: nsName,
    });
    const labels = detail?.raw?.metadata?.labels || detail?.object?.metadata?.labels || {};
    if (labels.updated !== 'yes') throw new Error('cluster namespace labels not updated');
    return 'cluster namespace labels updated';
  });

  // 2) ConfigMap via configs API
  let cmId = '';
  const cmName = uid('audit-cm');
  let secretId = '';
  const secretName = uid('audit-secret');
  await runCase('configs.create(ConfigMap) -> should exist in cluster', async () => {
    const out = await req('/api/configs', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'ConfigMap',
        name: cmName,
        data: { k: 'v1' },
        dataKeys: ['k'],
      },
    });
    cmId = out.item?.id;
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'configmaps',
      namespace: defaultNs,
    }, cmName);
    if (!ok) throw new Error(`configmap ${cmName} not found in cluster`);
    return 'configmap exists in cluster';
  });

  await runCase('configs.update(ConfigMap) -> should reflect in cluster', async () => {
    if (!cmId) throw new Error('configmap id missing');
    await req(`/api/configs/${cmId}`, {
      method: 'PATCH',
      token,
      body: { data: { k: 'v2' }, dataKeys: ['k'] },
    });
    const detail = await dynamicDetail(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'configmaps',
      namespace: defaultNs,
      name: cmName,
    });
    const val = detail?.raw?.data?.k ?? detail?.object?.data?.k;
    if (val !== 'v2') throw new Error(`cluster configmap data.k expected v2 got ${val}`);
    return 'configmap updated in cluster';
  });

  await runCase('configs.create(Secret) -> should exist in cluster', async () => {
    const out = await req('/api/configs', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'Secret',
        name: secretName,
        data: { k: 'c2VjcmV0' },
        dataKeys: ['k'],
      },
    });
    secretId = out.item?.id;
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'secrets',
      namespace: defaultNs,
    }, secretName);
    if (!ok) throw new Error(`secret ${secretName} not found in cluster`);
    return 'secret exists in cluster';
  });

  await runCase('configs.delete(ConfigMap) -> should delete in cluster', async () => {
    if (!cmId) throw new Error('configmap id missing');
    await req(`/api/configs/${cmId}/actions`, {
      method: 'POST',
      token,
      body: { action: 'delete' },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'configmaps',
      namespace: defaultNs,
    }, cmName);
    if (ok) throw new Error(`configmap ${cmName} still exists in cluster`);
    return 'configmap deleted in cluster';
  });

  // 3) Network Service via network API
  let svcId = '';
  const svcName = uid('audit-svc');
  const ingName = uid('audit-ing');
  await runCase('network.create(Service) -> should exist in cluster', async () => {
    const out = await req('/api/network', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'Service',
        name: svcName,
      },
    });
    svcId = out.item?.id;
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'services',
      namespace: defaultNs,
    }, svcName);
    if (!ok) throw new Error(`service ${svcName} not found in cluster`);
    return 'service exists in cluster';
  });

  await runCase('network.create(Ingress) -> should exist in cluster', async () => {
    const out = await req('/api/network', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'Ingress',
        name: ingName,
      },
    });
    const ingId = out.item?.id;
    if (!ingId) throw new Error('ingress id missing');
    const ok = await dynamicExists(token, {
      clusterId,
      group: 'networking.k8s.io',
      version: 'v1',
      resource: 'ingresses',
      namespace: defaultNs,
    }, ingName);
    if (!ok) throw new Error(`ingress ${ingName} not found in cluster`);
    return 'ingress exists in cluster';
  });

  await runCase('network.delete(Service) -> should delete in cluster', async () => {
    if (!svcId) throw new Error('service id missing');
    await req(`/api/network/${svcId}/actions`, {
      method: 'POST',
      token,
      body: { action: 'delete' },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'services',
      namespace: defaultNs,
    }, svcName);
    if (ok) throw new Error(`service ${svcName} still exists in cluster`);
    return 'service deleted in cluster';
  });

  // 4) StorageClass via storage API
  let scId = '';
  const scName = uid('audit-sc');
  const pvName = uid('audit-pv');
  const pvcName = uid('audit-pvc');
  await runCase('storage.create(SC) -> should exist in cluster', async () => {
    const out = await req('/api/storage', {
      method: 'POST',
      token,
      body: {
        clusterId,
        kind: 'SC',
        name: scName,
        provisioner: 'kubernetes.io/no-provisioner',
      },
    });
    scId = out.item?.id;
    const ok = await dynamicExists(token, {
      clusterId,
      group: 'storage.k8s.io',
      version: 'v1',
      resource: 'storageclasses',
      namespace: '',
    }, scName);
    if (!ok) throw new Error(`storageclass ${scName} not found in cluster`);
    return 'storageclass exists in cluster';
  });

  await runCase('storage.create(PV) -> should exist in cluster', async () => {
    const out = await req('/api/storage', {
      method: 'POST',
      token,
      body: {
        clusterId,
        kind: 'PV',
        name: pvName,
        capacity: '1Gi',
      },
    });
    const pvId = out.item?.id;
    if (!pvId) throw new Error('pv id missing');
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'persistentvolumes',
      namespace: '',
    }, pvName);
    if (!ok) throw new Error(`pv ${pvName} not found in cluster`);
    return 'pv exists in cluster';
  });

  await runCase('storage.create(PVC) -> should exist in cluster', async () => {
    const out = await req('/api/storage', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'PVC',
        name: pvcName,
        capacity: '1Gi',
      },
    });
    const pvcId = out.item?.id;
    if (!pvcId) throw new Error('pvc id missing');
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'persistentvolumeclaims',
      namespace: defaultNs,
    }, pvcName);
    if (!ok) throw new Error(`pvc ${pvcName} not found in cluster`);
    return 'pvc exists in cluster';
  });

  await runCase('storage.delete(SC) -> should delete in cluster', async () => {
    if (!scId) throw new Error('storageclass id missing');
    await req(`/api/storage/${scId}/actions`, {
      method: 'POST',
      token,
      body: { action: 'delete' },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: 'storage.k8s.io',
      version: 'v1',
      resource: 'storageclasses',
      namespace: '',
    }, scName);
    if (ok) throw new Error(`storageclass ${scName} still exists in cluster`);
    return 'storageclass deleted in cluster';
  });

  // 5) Workload Deployment via workloads API
  let depId = '';
  await runCase('workloads.create(Deployment) -> should exist in cluster', async () => {
    const out = await req('/api/workloads', {
      method: 'POST',
      token,
      body: {
        clusterId,
        namespace: defaultNs,
        kind: 'Deployment',
        name: depName,
        replicas: 1,
      },
    });
    depId = out.id;
    const ok = await dynamicExists(token, {
      clusterId,
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: defaultNs,
    }, depName);
    if (!ok) throw new Error(`deployment ${depName} not found in cluster`);
    return 'deployment exists in cluster';
  });

  await runCase('workloads.update(namespace) -> should move in cluster', async () => {
    if (!depId) throw new Error('deployment id missing');
    await req(`/api/workloads/${depId}`, {
      method: 'PATCH',
      token,
      body: { namespace: nsName },
    });
    const inOld = await dynamicExists(token, {
      clusterId,
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: defaultNs,
    }, depName);
    const inNew = await dynamicExists(token, {
      clusterId,
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: nsName,
    }, depName);
    if (inOld || !inNew) {
      throw new Error(`cluster deployment not moved: inOld=${inOld} inNew=${inNew}`);
    }
    return 'deployment moved across namespace in cluster';
  });

  await runCase('workloads.delete(Deployment) -> should delete in cluster', async () => {
    if (!depId) throw new Error('deployment id missing');
    await req(`/api/workloads/${depId}/actions`, {
      method: 'POST',
      token,
      body: { action: 'delete' },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: 'apps',
      version: 'v1',
      resource: 'deployments',
      namespace: nsName,
    }, depName);
    if (ok) throw new Error(`deployment ${depName} still exists in cluster`);
    return 'deployment deleted in cluster';
  });

  const extraKinds = [
    { kind: 'StatefulSet', group: 'apps', version: 'v1', resource: 'statefulsets' },
    { kind: 'DaemonSet', group: 'apps', version: 'v1', resource: 'daemonsets' },
    { kind: 'ReplicaSet', group: 'apps', version: 'v1', resource: 'replicasets' },
    { kind: 'Job', group: 'batch', version: 'v1', resource: 'jobs' },
    { kind: 'CronJob', group: 'batch', version: 'v1', resource: 'cronjobs' },
    { kind: 'Pod', group: '', version: 'v1', resource: 'pods' },
  ];

  for (const meta of extraKinds) {
    const n = uid(`audit-${meta.kind.toLowerCase()}`);
    let wid = '';
    await runCase(`workloads.create(${meta.kind}) -> should exist in cluster`, async () => {
      const out = await req('/api/workloads', {
        method: 'POST',
        token,
        body: {
          clusterId,
          namespace: defaultNs,
          kind: meta.kind,
          name: n,
          replicas: 1,
        },
      });
      wid = out.id;
      const ok = await dynamicExists(token, {
        clusterId,
        group: meta.group,
        version: meta.version,
        resource: meta.resource,
        namespace: defaultNs,
      }, n);
      if (!ok) throw new Error(`${meta.kind} ${n} not found in cluster`);
      return `${meta.kind} exists in cluster`;
    });

    await runCase(`workloads.delete(${meta.kind}) -> should delete in cluster`, async () => {
      if (!wid) throw new Error(`${meta.kind} id missing`);
      await req(`/api/workloads/${wid}/actions`, {
        method: 'POST',
        token,
        body: { action: 'delete' },
      });
      const gone = await waitUntilAbsent(token, {
        clusterId,
        group: meta.group,
        version: meta.version,
        resource: meta.resource,
        namespace: defaultNs,
      }, n);
      if (!gone) throw new Error(`${meta.kind} ${n} still exists in cluster`);
      return `${meta.kind} deleted in cluster`;
    });
  }

  // 6) ServiceAccount via resources dynamic API (same as page behavior)
  const saName = uid('audit-sa');
  const saYaml = `apiVersion: v1\nkind: ServiceAccount\nmetadata:\n  name: ${saName}\n  namespace: ${defaultNs}\n  labels:\n    audit: \"true\"\n`;
  await runCase('resources.dynamic.yaml(ServiceAccount) create -> should exist in cluster', async () => {
    await req('/api/resources/dynamic/yaml', {
      method: 'PUT',
      token,
      body: {
        clusterId,
        group: '',
        version: 'v1',
        resource: 'serviceaccounts',
        namespace: defaultNs,
        name: saName,
        yaml: saYaml,
      },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'serviceaccounts',
      namespace: defaultNs,
    }, saName);
    if (!ok) throw new Error(`serviceaccount ${saName} not found in cluster`);
    return 'serviceaccount exists in cluster';
  });

  await runCase('resources.dynamic.delete(ServiceAccount) -> should delete from cluster', async () => {
    await req('/api/resources/dynamic/delete', {
      method: 'POST',
      token,
      body: {
        clusterId,
        group: '',
        version: 'v1',
        resource: 'serviceaccounts',
        namespace: defaultNs,
        name: saName,
      },
    });
    const ok = await dynamicExists(token, {
      clusterId,
      group: '',
      version: 'v1',
      resource: 'serviceaccounts',
      namespace: defaultNs,
    }, saName);
    if (ok) throw new Error(`serviceaccount ${saName} still exists in cluster`);
    return 'serviceaccount deleted from cluster';
  });

  report.finishedAt = new Date().toISOString();
  const out = JSON.stringify(report, null, 2);
  console.log(out);
}

main().catch((err) => {
  console.error(JSON.stringify({
    fatal: true,
    message: err instanceof Error ? err.message : String(err),
    at: new Date().toISOString(),
  }, null, 2));
  process.exit(1);
});
