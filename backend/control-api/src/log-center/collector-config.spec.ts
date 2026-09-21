import { buildCollectorConfig } from './collector-config';

describe('Filebeat collector contract', () => {
  const input = { clusterId: 'cluster-a', endpoint: 'https://es.internal:9200' };
  it('keeps trusted identity separate from message text and pins scoped-query fields', () => {
    const result = buildCollectorConfig(input);
    expect(result.image).toBe('docker.elastic.co/beats/filebeat:9.5.4');
    expect(result.config['filebeat.inputs'][0].fields).toEqual({ kubenova: { cluster_id: 'cluster-a' } });
    expect(result.config.processors[0]).toEqual({ add_kubernetes_metadata: {
      host: '${NODE_NAME}', scope: 'node', add_resource_metadata: { namespace: { enabled: true }, node: { enabled: false } },
      matchers: [{ logs_path: { logs_path: '/var/log/containers/' } }],
    } });
    expect(result.config.processors[1]).toHaveProperty('drop_event.when.not.has_fields', [
      'kubernetes.namespace_uid', 'kubernetes.namespace', 'kubernetes.pod.name', 'kubernetes.container.name',
    ]);
    expect(result.logQuery).toMatchObject({ namespaceUidField: 'kubernetes.namespace_uid', indexPattern: 'kubenova-logs-34ab3e1c8c468878c75341efcf8fd3cd47540aa2b05cfca2ef4da32fd7dd0c36-*' });
    expect(result.config['output.elasticsearch'].api_key).toBe('${ELASTICSEARCH_API_KEY}');
    expect(result.config['output.elasticsearch'].ssl.verification_mode).toBe('full');
    expect(result.config['queue.disk'].max_size).toBe('1GB');
    expect(JSON.stringify(result.config)).not.toContain('decode_json_fields');
    expect(result.config.processors[2].rename.fields).toContainEqual({ from: 'kubernetes.pod.name', to: 'kubernetes.pod_name' });
  });
  it('generates exact-scope mappings and a separately managed retention policy', () => {
    const result = buildCollectorConfig({ ...input, retentionDays: 30 });
    expect(result.indexTemplate.index_patterns).toEqual(['kubenova-logs-34ab3e1c8c468878c75341efcf8fd3cd47540aa2b05cfca2ef4da32fd7dd0c36-*']);
    expect(result.indexTemplate.template.settings['index.lifecycle.name']).toBe(result.lifecyclePolicy.name);
    expect(result.lifecyclePolicy.body.policy.phases.delete.min_age).toBe('30d');
    expect(result.indexTemplate.template.mappings.properties.kubernetes.properties.namespace_uid.type).toBe('keyword');
    expect(result.indexTemplate.template.mappings.properties.kubenova.properties.cluster_id.type).toBe('keyword');
    expect(result.indexTemplate.template.mappings.properties.message.type).toBe('text');
    expect(result.indexTemplate.template.mappings.dynamic).toBe(false);
    expect(buildCollectorConfig(input).lifecyclePolicy.body.policy.phases.delete.min_age).toBe('14d');
  });
  it.each([
    { clusterId: 'bad/cluster' },
    { retentionDays: 0 }, { retentionDays: 366 }, { retentionDays: 1.5 }, { retentionDays: '30' },
    { clusterId: '../other' }, { clusterId: 'x\n[OUTPUT]' }, { clusterId: 'a'.repeat(129) },
    { endpoint: 'http://es.internal' }, { endpoint: 'https://user:secret@es.internal' },
    { endpoint: 'https://es.internal?token=secret' }, { endpoint: 'https://es.internal/#secret' },
    { endpoint: 'https://es.internal/${SECRET}' }, { token: 'not-accepted' },
  ])('rejects unsafe or unsupported configuration %j', patch => {
    expect(() => buildCollectorConfig({ ...input, ...patch })).toThrow();
  });
});
