const assert = require('node:assert/strict');
const http = require('node:http');
const https = require('node:https');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { NativeGatewayService } = require('../dist/src/auth/native-gateway.service');
const { planNativeRbac, nativeRbacSubject } = require('../dist/src/auth/native-rbac');

// Real verifier, Kubernetes client, readiness checks and TLS transport;
// persistence and revocation delivery are controlled dependencies, not a live cluster.
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'kn-native-service-'));
  const servers = [];
  let failure;
  try {
    const { generateKeyPair, exportJWK, SignJWT } = await import('jose');
    const k8s = await import('@kubernetes/client-node');
    const keys = await generateKeyPair('RS256');
    const jwk = { ...await exportJWK(keys.publicKey), kid: 'fixture', alg: 'RS256' };
    let jwksRequests = 0;
    const listen = async server => {
      servers.push(server);
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      return server.address().port;
    };
    const issuer = `http://127.0.0.1:${await listen(http.createServer((req, res) => {
      jwksRequests++;
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ keys: [jwk] }));
    }))}`;
    const grant = { id: 'grant', userId: 'user', clusterId: 'cluster', role: 'viewer', state: 'active',
      validFrom: new Date(0), expiresAt: null, revokedAt: null,
      namespaces: [{ namespaceName: 'ai', namespaceUid: 'ns-uid' }], capabilities: [{ capability: 'kubeconfig' }] };
    const [plan] = planNativeRbac({ userId: 'user', clusterId: 'cluster', grants: [grant], namespaces: [{ name: 'ai', uid: 'ns-uid' }] });
    let namespaceUid = 'ns-uid', bindingPresent = true, active = true, granted = true, podReads = 0, closedLeases = 0;
    const key = path.join(dir, 'key.pem'), cert = path.join(dir, 'cert.pem');
    const created = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', key,
      '-out', cert, '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=IP:127.0.0.1'], { encoding: 'utf8' });
    assert.equal(created.status, 0, created.stderr);
    const port = await listen(https.createServer({ key: fs.readFileSync(key), cert: fs.readFileSync(cert) }, (req, res) => {
      try {
        assert.equal(req.headers.authorization, 'Bearer fixture-cluster-credential');
        assert.equal(req.method, 'GET', 'readiness must not apply RBAC');
        let body;
        if (req.url === '/api/v1/namespaces/ai') body = { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'ai', uid: namespaceUid } };
        else if (req.url === `/apis/rbac.authorization.k8s.io/v1/namespaces/ai/roles/${plan.role.metadata.name}`) body = { ...plan.role, metadata: { ...plan.role.metadata, uid: 'role', resourceVersion: '1' } };
        else if (bindingPresent && req.url === `/apis/rbac.authorization.k8s.io/v1/namespaces/ai/rolebindings/${plan.binding.metadata.name}`) body = { ...plan.binding, metadata: { ...plan.binding.metadata, uid: 'binding', resourceVersion: '1' } };
        else if (req.url === '/api/v1/namespaces/ai/pods') {
          assert.equal(req.headers['impersonate-user'], nativeRbacSubject('user', 'cluster'));
          podReads++;
          body = { apiVersion: 'v1', kind: 'PodList', items: [{ metadata: { name: 'fixture-pod', namespace: 'ai' } }] };
        }
        res.writeHead(body ? 200 : 404, { 'content-type': 'application/json' }).end(JSON.stringify(body ?? { kind: 'Status', status: 'Failure', code: 404, reason: 'NotFound' }));
      } catch (error) { failure = error; res.writeHead(500).end(); }
    }));
    const config = new k8s.KubeConfig();
    config.loadFromOptions({ clusters: [{ name: 'fixture', server: `https://127.0.0.1:${port}`, caData: fs.readFileSync(cert).toString('base64') }],
      users: [{ name: 'fixture', token: 'fixture-cluster-credential' }], contexts: [{ name: 'fixture', cluster: 'fixture', user: 'fixture' }], currentContext: 'fixture' });
    const settings = { enabled: true, revision: 1, issuer, audience: 'native', jwksUri: `${issuer}/jwks`, cluster: { deletedAt: null, status: 'online' } };
    const service = new NativeGatewayService({ nativeAccessConfig: { findUnique: async () => settings }, apiResourceCapability: { findMany: async () => [
      { group: '', version: 'v1', kind: 'Pod', resource: 'pods', namespaced: true, verbsJson: ['get', 'list', 'watch'] },
      { group: '', version: 'v1', kind: 'Secret', resource: 'secrets', namespaced: true, verbsJson: ['get', 'list'] },
    ] } }, { getKubeconfig: async () => config.exportConfig() }, { listEffectiveGrants: async () => granted ? [grant] : [] },
    { resolve: async (_, namespace) => namespace === 'ai' ? namespaceUid : 'foreign-uid' },
    { resolve: async (iss, sub) => { assert.equal(iss, issuer); assert.equal(sub, 'subject'); if (!active) throw Error('disabled'); return { id: 'user', authzVersion: 1 }; } },
    { get: async () => ({ register: () => ({ signal: new AbortController().signal, close: () => { closedLeases++; } }) }) });
    const token = await new SignJWT({ iss: issuer, aud: 'native', sub: 'subject' }).setIssuedAt().setExpirationTime('5m').setProtectedHeader({ alg: 'RS256', kid: 'fixture' }).sign(keys.privateKey);
    const input = target => ({ clusterId: 'cluster', token, target, signal: AbortSignal.timeout(10000) });
    const discovery = await service.discover(input('/api/v1?timeout=10s'));
    assert.deepEqual(discovery.resources.map(row => row.name), ['pods']);
    const response = await service.open(input('/api/v1/namespaces/ai/pods'));
    assert.equal(response.statusCode, 200);
    const chunks = [];
    for await (const chunk of response) chunks.push(chunk);
    assert.equal(JSON.parse(Buffer.concat(chunks)).items[0].metadata.name, 'fixture-pod');
    assert.equal(closedLeases, 1);
    assert.equal(jwksRequests, 1, 'discovery and data requests share signing-key cache');
    await assert.rejects(service.open(input('/api/v1/namespaces/other/pods')), { status: 403 });
    await assert.rejects(service.open(input('/api/v1/namespaces/ai/secrets')), { status: 403 });
    bindingPresent = false;
    await assert.rejects(service.open(input('/api/v1/namespaces/ai/pods')), /RBAC is not ready/);
    bindingPresent = true; namespaceUid = 'recreated';
    await assert.rejects(service.open(input('/api/v1/namespaces/ai/pods')), { status: 403 });
    namespaceUid = 'ns-uid'; granted = false;
    await assert.rejects(service.discover(input('/api/v1')), { status: 403 });
    granted = true; active = false;
    await assert.rejects(service.open(input('/api/v1/namespaces/ai/pods')), { status: 401 });
    assert.equal(podReads, 1, 'all denied requests stop before workload transport');
    assert.equal(failure, undefined);
    console.log('PASS native service: signed OIDC -> live TLS RBAC -> impersonated PodList; discovery/cache, scope, secrets, missing RBAC, recreated namespace, revoked grant and disabled identity. DB/listener/Kubernetes are fixtures.');
  } finally {
    for (const server of servers) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
