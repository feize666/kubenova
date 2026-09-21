import { z } from 'zod';
import { createHash } from 'node:crypto';

export const collectorCaSecretSchema = z.string().min(1).max(253)
  .regex(/^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/);

const inputSchema = z.object({
  clusterId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
  retentionDays: z.number().int().min(1).max(365).default(14),
  caSecretName: collectorCaSecretSchema.optional(),
  endpoint: z.string().url().max(2048).refine(value => {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && !/[\s${}]/.test(value);
  }),
}).strict();

/** Preview only: no credentials, Kubernetes writes or Elasticsearch setup calls. */
export function buildCollectorConfig(input: unknown) {
  const { clusterId, endpoint, retentionDays, caSecretName } = inputSchema.parse(input);
  // Fixed-width names preserve case-sensitive identities and avoid overlapping prefixes.
  const prefix = `kubenova-logs-${createHash('sha256').update(clusterId).digest('hex')}`;
  return {
    caSecretName,
    image: 'docker.elastic.co/beats/filebeat:9.5.4',
    lifecyclePolicy: {
      name: `${prefix}-retention`,
      body: { policy: { phases: { delete: { min_age: `${retentionDays}d`, actions: { delete: {} } } } } },
    },
    indexTemplate: {
      index_patterns: [`${prefix}-*`],
      priority: 200,
      template: {
        settings: { 'index.lifecycle.name': `${prefix}-retention` },
        mappings: {
          dynamic: false,
          properties: {
            '@timestamp': { type: 'date' }, message: { type: 'text' },
            kubenova: { properties: { cluster_id: { type: 'keyword' } } },
            kubernetes: { properties: {
              namespace_name: { type: 'keyword' }, namespace_uid: { type: 'keyword' },
              pod_name: { type: 'keyword' }, container_name: { type: 'keyword' },
            } },
          },
        },
      },
    },
    logQuery: {
      indexPattern: `${prefix}-*`, clusterField: 'kubenova.cluster_id',
      namespaceField: 'kubernetes.namespace_name', namespaceUidField: 'kubernetes.namespace_uid',
      timestampField: '@timestamp', messageField: 'message',
    },
    config: {
      'filebeat.inputs': [{
        type: 'filestream', id: 'kubenova-containers',
        paths: ['/var/log/containers/*.log'],
        'prospector.scanner.symlinks': true,
        parsers: [{ container: { stream: 'all', format: 'auto' } }],
        fields_under_root: true, fields: { kubenova: { cluster_id: clusterId } },
      }],
      processors: [
        { add_kubernetes_metadata: {
          host: '${NODE_NAME}', scope: 'node',
          add_resource_metadata: { namespace: { enabled: true }, node: { enabled: false } },
          matchers: [{ logs_path: { logs_path: '/var/log/containers/' } }],
        } },
        // Unresolved identity is dropped, never indexed under a guessed namespace.
        { drop_event: { when: { not: { has_fields: [
          'kubernetes.namespace_uid', 'kubernetes.namespace', 'kubernetes.pod.name', 'kubernetes.container.name',
        ] } } } },
        { rename: { fields: [
          { from: 'kubernetes.namespace', to: 'kubernetes.namespace_name' },
          { from: 'kubernetes.pod.name', to: 'kubernetes.pod_name' },
          { from: 'kubernetes.container.name', to: 'kubernetes.container_name' },
        ], ignore_missing: false, fail_on_error: true } },
      ] as const,
      'queue.disk': { max_size: '1GB' },
      'output.elasticsearch': {
        hosts: [endpoint], api_key: '${ELASTICSEARCH_API_KEY}',
        index: `${prefix}-%{+yyyy.MM.dd}`, ssl: {
          verification_mode: 'full',
          ...(caSecretName ? { certificate_authorities: ['/etc/filebeat-ca/ca.crt'] } : {}),
        },
      },
      // A separate administrator installs index mappings/retention, not the writer key.
      'setup.ilm.enabled': false, 'setup.template.enabled': false,
      'logging.level': 'warning', 'logging.to_files': false,
    },
  };
}
