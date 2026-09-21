import { buildCollectorManifests } from './collector-manifests';

describe('collector deployment preview', () => {
  it('mounts only the selected CA certificate and preserves TLS verification', () => {
    const result = buildCollectorManifests({ clusterId: 'test', endpoint: 'https://es.example:9200', caSecretName: 'elastic-ca' });
    const objects = result.items as any[];
    const config = JSON.parse(objects.find(item => item.kind === 'ConfigMap').data['filebeat.yml']);
    expect(config['output.elasticsearch'].ssl).toEqual({ verification_mode: 'full', certificate_authorities: ['/etc/filebeat-ca/ca.crt'] });
    const pod = objects.find(item => item.kind === 'DaemonSet').spec.template.spec;
    expect(pod.volumes.find((v: any) => v.name === 'ca').secret).toEqual({ secretName: 'elastic-ca', items: [{ key: 'ca.crt', path: 'ca.crt' }] });
    expect(pod.containers[0].volumeMounts.find((v: any) => v.name === 'ca')).toEqual({ name: 'ca', mountPath: '/etc/filebeat-ca', readOnly: true });
  });
  it.each(['', '../ca', 'UPPER', 'ca/secret', 'ca..secret', 'a'.repeat(254)])('rejects an invalid CA Secret name %s', caSecretName => {
    expect(() => buildCollectorManifests({ clusterId: 'test', endpoint: 'https://es.example', caSecretName })).toThrow();
  });
  it('isolates host access, credentials and metadata permissions', () => {
    const result = buildCollectorManifests({ clusterId: 'test', endpoint: 'https://es.example:9200' });
    const objects = result.items as any[];
    expect(objects.some(item => item.kind === 'Secret')).toBe(false);
    const role = objects.find(item => item.kind === 'ClusterRole');
    expect(role.rules).toEqual([{ apiGroups: [''], resources: ['pods', 'namespaces'], verbs: ['get', 'list', 'watch'] }]);
    const pod = objects.find(item => item.kind === 'DaemonSet').spec.template.spec;
    expect(pod.nodeSelector).toEqual({ 'kubernetes.io/os': 'linux' });
    const container = pod.containers[0];
    expect(container.securityContext).toMatchObject({ privileged: false, allowPrivilegeEscalation: false, readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] } });
    expect(container.env.find((v: any) => v.name === 'ELASTICSEARCH_API_KEY').valueFrom.secretKeyRef).toEqual({ name: 'kubenova-log-writer', key: 'api-key' });
    expect(container.volumeMounts.find((v: any) => v.name === 'logs').readOnly).toBe(true);
    expect(pod.volumes.find((v: any) => v.name === 'logs').hostPath).toEqual({ path: '/var/log', type: 'Directory' });
    expect(pod.volumes.find((v: any) => v.name === 'data').hostPath.path).toBe('/var/lib/kubenova/filebeat');
    expect(container.resources.limits.memory).toBeDefined();
    const config = JSON.parse(objects.find(item => item.kind === 'ConfigMap').data['filebeat.yml']);
    expect(config.processors[0].add_kubernetes_metadata.add_resource_metadata).toMatchObject({ deployment: false, cronjob: false });
    expect(config['output.elasticsearch'].ssl.verification_mode).toBe('full');
    expect(pod.serviceAccountName).toBe(objects.find(item => item.kind === 'ServiceAccount').metadata.name);
  });
});
