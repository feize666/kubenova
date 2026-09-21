import { buildCollectorConfig } from './collector-config';

/** Preview only. The namespace, writer Secret and Elasticsearch setup must exist first. */
export function buildCollectorManifests(input: unknown) {
  const collector = buildCollectorConfig(input);
  const name = 'kubenova-filebeat';
  const namespace = 'kubenova-system';
  const labels = { 'app.kubernetes.io/name': name };
  const metadata = { name, namespace, labels };
  const config = {
    ...collector.config,
    processors: collector.config.processors.map(processor => 'add_kubernetes_metadata' in processor ? {
      add_kubernetes_metadata: {
        ...processor.add_kubernetes_metadata,
        add_resource_metadata: {
          ...processor.add_kubernetes_metadata.add_resource_metadata,
          deployment: false, cronjob: false,
        },
      },
    } : processor),
  };
  return {
    apiVersion: 'v1', kind: 'List',
    items: [
      { apiVersion: 'v1', kind: 'ServiceAccount', metadata },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRole',
        metadata: { name, labels },
        rules: [{ apiGroups: [''], resources: ['pods', 'namespaces'], verbs: ['get', 'list', 'watch'] }],
      },
      {
        apiVersion: 'rbac.authorization.k8s.io/v1', kind: 'ClusterRoleBinding',
        metadata: { name, labels },
        roleRef: { apiGroup: 'rbac.authorization.k8s.io', kind: 'ClusterRole', name },
        subjects: [{ kind: 'ServiceAccount', name, namespace }],
      },
      { apiVersion: 'v1', kind: 'ConfigMap', metadata, data: { 'filebeat.yml': JSON.stringify(config, null, 2) } },
      {
        apiVersion: 'apps/v1', kind: 'DaemonSet', metadata,
        spec: {
          selector: { matchLabels: labels },
          updateStrategy: { type: 'RollingUpdate', rollingUpdate: { maxUnavailable: 1 } },
          template: {
            metadata: { labels },
            spec: {
              serviceAccountName: name,
              nodeSelector: { 'kubernetes.io/os': 'linux' },
              tolerations: [{ operator: 'Exists', effect: 'NoSchedule' }],
              terminationGracePeriodSeconds: 30,
              containers: [{
                name: 'filebeat', image: collector.image,
                args: ['-e', '-c', '/etc/filebeat/filebeat.yml'],
                env: [
                  { name: 'NODE_NAME', valueFrom: { fieldRef: { fieldPath: 'spec.nodeName' } } },
                  { name: 'ELASTICSEARCH_API_KEY', valueFrom: { secretKeyRef: { name: 'kubenova-log-writer', key: 'api-key' } } },
                ],
                securityContext: {
                  runAsUser: 0, privileged: false, allowPrivilegeEscalation: false,
                  readOnlyRootFilesystem: true, capabilities: { drop: ['ALL'] },
                  seccompProfile: { type: 'RuntimeDefault' },
                },
                resources: { requests: { cpu: '100m', memory: '128Mi' }, limits: { cpu: '500m', memory: '512Mi' } },
                volumeMounts: [
                  { name: 'config', mountPath: '/etc/filebeat', readOnly: true },
                  { name: 'logs', mountPath: '/var/log', readOnly: true },
                  { name: 'data', mountPath: '/usr/share/filebeat/data' },
                  { name: 'tmp', mountPath: '/tmp' },
                  ...(collector.caSecretName ? [{ name: 'ca', mountPath: '/etc/filebeat-ca', readOnly: true }] : []),
                ],
              }],
              volumes: [
                { name: 'config', configMap: { name, defaultMode: 420 } },
                { name: 'logs', hostPath: { path: '/var/log', type: 'Directory' } },
                { name: 'data', hostPath: { path: '/var/lib/kubenova/filebeat', type: 'DirectoryOrCreate' } },
                { name: 'tmp', emptyDir: { sizeLimit: '64Mi' } },
                ...(collector.caSecretName ? [{ name: 'ca', secret: { secretName: collector.caSecretName, items: [{ key: 'ca.crt', path: 'ca.crt' }] } }] : []),
              ],
            },
          },
        },
      },
    ],
  };
}
