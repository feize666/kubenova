import type { Prisma } from '@prisma/client';
import type {
  PersistedResource,
  TopologyGraphRelation,
  TopologyGraphResource,
  TopologyGraphV2Relation,
  TopologyRelationRole,
  TopologyRelationType,
  TopologyRow,
} from './topology-graph.contract';
import {
  asArray,
  asRecord,
  asString,
  asStringRecord,
} from './topology-resource.projector';

type GraphResource = Pick<TopologyGraphResource, 'id' | 'recordId'>;

interface ResourceReference {
  kind: 'PersistentVolumeClaim' | 'ConfigMap' | 'Secret' | 'ServiceAccount';
  name: string;
  path: string;
}

export class TopologyRelationResolver {
  resolveLegacy(
    rows: TopologyRow[],
    resources: TopologyGraphResource[],
  ): TopologyGraphRelation[] {
    return this.resolve(rows, resources).map((relation) => ({
      id: relation.id,
      source: relation.source,
      target: relation.target,
      label: relation.label,
      role: relation.role,
      direction: relation.direction,
      evidence: relation.evidence,
      ports: relation.ports,
    }));
  }

  resolveV2(
    rows: TopologyRow[],
    resources: GraphResource[],
  ): TopologyGraphV2Relation[] {
    return this.resolve(rows, resources);
  }

  private resolve(
    rows: TopologyRow[],
    resources: GraphResource[],
  ): TopologyGraphV2Relation[] {
    const resourcesByRecordId = new Map(
      resources.map((resource) => [resource.recordId, resource]),
    );
    const byKindName = new Map<string, PersistedResource[]>();
    const byKind = new Map<string, PersistedResource[]>();
    for (const { row } of rows) {
      addToIndex(byKindName, kindNameKey(row), row);
      addToIndex(byKind, row.kind, row);
    }

    const endpointSliceServices = new Set<string>();
    const endpointServices = new Set<string>();
    for (const { source, row } of rows) {
      if (source !== 'network') continue;
      if (row.kind === 'EndpointSlice') {
        const serviceName = asString(
          asStringRecord(row.labels)?.['kubernetes.io/service-name'],
        );
        if (serviceName)
          endpointSliceServices.add(serviceKey(row, serviceName));
      }
      if (row.kind === 'Endpoints')
        endpointServices.add(serviceKey(row, row.name));
    }

    const relations = new Map<string, TopologyGraphV2Relation>();
    const add = (
      source: PersistedResource,
      target: PersistedResource,
      label: string,
      role: TopologyRelationRole,
      type: TopologyRelationType,
      evidence: string[],
      ports: string[] = [],
    ) => {
      const sourceResource = resourcesByRecordId.get(source.id);
      const targetResource = resourcesByRecordId.get(target.id);
      if (
        !sourceResource ||
        !targetResource ||
        sourceResource.id === targetResource.id
      )
        return;
      const id = `${role}:${sourceResource.id}->${targetResource.id}`;
      const existing = relations.get(id);
      if (existing) {
        existing.evidence = uniqueSorted([...existing.evidence, ...evidence]);
        existing.ports = uniqueSorted([...existing.ports, ...ports]);
        return;
      }
      relations.set(id, {
        id,
        source: sourceResource.id,
        target: targetResource.id,
        label,
        role,
        type,
        confidence: confidenceFor(type),
        direction: 'outbound',
        evidence: uniqueSorted(evidence),
        ports: uniqueSorted(ports),
      });
    };

    for (const { source, row } of rows) {
      if (source === 'workloads') {
        for (const ref of ownerReferences(row)) {
          for (const owner of findByKindAndName(
            byKindName,
            row,
            ref.kind,
            ref.name,
          ))
            if (sameNamespace(row, owner))
              add(owner, row, 'owns', 'owner', 'OWNS', [ref.path]);
        }
        for (const ref of workloadReferences(row)) {
          const kind = ref.kind === 'PersistentVolumeClaim' ? 'PVC' : ref.kind;
          for (const target of findByKindAndName(
            byKindName,
            row,
            kind,
            ref.name,
          )) {
            if (!sameNamespace(row, target)) continue;
            if (ref.kind === 'PersistentVolumeClaim')
              add(row, target, 'mounts', 'storage', 'MOUNTS', [ref.path]);
            else
              add(row, target, 'uses', 'config', configRelationType(ref.kind), [
                ref.path,
              ]);
          }
        }
      }

      if (source === 'network' && row.kind === 'Service') {
        const selector = asStringRecord(asRecord(row.spec)?.selector);
        const key = serviceKey(row, row.name);
        if (
          !endpointSliceServices.has(key) &&
          !endpointServices.has(key) &&
          selector &&
          Object.keys(selector).length
        ) {
          for (const pod of byKind.get('Pod') ?? [])
            if (sameNamespace(row, pod) && labelsMatch(selector, pod.labels))
              add(
                row,
                pod,
                'selects',
                'network',
                'SELECTS',
                selectorEvidence(selector),
                servicePorts(row),
              );
        }
      }

      if (source === 'network' && row.kind === 'EndpointSlice') {
        const serviceName = asString(
          asStringRecord(row.labels)?.['kubernetes.io/service-name'],
        );
        if (serviceName)
          for (const service of findByKindAndName(
            byKindName,
            row,
            'Service',
            serviceName,
          ))
            if (sameNamespace(row, service))
              add(service, row, 'publishes', 'network', 'PUBLISHES', [
                'metadata.labels.kubernetes.io/service-name',
              ]);
        for (const target of endpointTargets(row)) {
          const workloads =
            target.kind && target.name
              ? findByKindAndName(byKindName, row, target.kind, target.name)
              : target.ip
                ? (byKind.get('Pod') ?? []).filter(
                    (pod) =>
                      sameNamespace(row, pod) && podIpMatches(pod, target.ip!),
                  )
                : [];
          for (const workload of workloads)
            if (sameNamespace(row, workload))
              add(row, workload, 'resolves', 'network', 'RESOLVES', [
                target.path,
              ]);
        }
      }

      if (source === 'network' && row.kind === 'Endpoints') {
        if (endpointSliceServices.has(serviceKey(row, row.name))) continue;
        for (const service of findByKindAndName(
          byKindName,
          row,
          'Service',
          row.name,
        ))
          if (sameNamespace(row, service))
            add(service, row, 'publishes', 'network', 'PUBLISHES', [
              'metadata.name',
            ]);
        for (const target of endpointTargets(row)) {
          const workloads =
            target.kind && target.name
              ? findByKindAndName(byKindName, row, target.kind, target.name)
              : target.ip
                ? (byKind.get('Pod') ?? []).filter(
                    (pod) =>
                      sameNamespace(row, pod) && podIpMatches(pod, target.ip!),
                  )
                : [];
          for (const workload of workloads)
            if (sameNamespace(row, workload))
              add(row, workload, 'resolves', 'network', 'RESOLVES', [
                target.path,
              ]);
        }
      }

      if (source === 'network' && row.kind === 'NetworkPolicy') {
        const selector = asStringRecord(
          asRecord(asRecord(row.spec)?.podSelector)?.matchLabels,
        );
        if (selector && Object.keys(selector).length)
          for (const pod of byKind.get('Pod') ?? [])
            if (sameNamespace(row, pod) && labelsMatch(selector, pod.labels))
              add(
                row,
                pod,
                'governs',
                'policy',
                'GOVERNS',
                selectorEvidence(selector),
              );
      }

      if (
        source === 'network' &&
        (row.kind === 'Ingress' || row.kind === 'IngressRoute')
      )
        resolveServiceRoutes(row, 'network', byKindName, add);

      if (source === 'gateway' && row.kind === 'Gateway') {
        const gatewayClassName = asString(asRecord(row.spec)?.gatewayClassName);
        if (gatewayClassName)
          for (const gatewayClass of byKind.get('GatewayClass') ?? [])
            if (
              gatewayClass.clusterId === row.clusterId &&
              gatewayClass.name === gatewayClassName
            )
              add(gatewayClass, row, 'provisions', 'gateway', 'PROVISIONS', [
                'spec.gatewayClassName',
              ]);
      }

      if (source === 'gateway' && isGatewayRoute(row.kind)) {
        for (const parent of gatewayParents(row))
          for (const gateway of byKind.get('Gateway') ?? [])
            if (
              gateway.clusterId === row.clusterId &&
              gateway.name === parent.name &&
              (parent.namespace ?? row.namespace) === gateway.namespace
            )
              add(gateway, row, 'accepts', 'gateway', 'ACCEPTS', [parent.path]);
        resolveServiceRoutes(row, 'gateway', byKindName, add);
      }

      if (source === 'storage' && isPersistentVolumeClaim(row.kind)) {
        const spec = asRecord(row.spec);
        const volumeName = asString(spec?.volumeName);
        if (volumeName)
          for (const pv of findClusterScopedByKindAndName(
            byKindName,
            row,
            ['PV', 'PersistentVolume'],
            volumeName,
          ))
            add(row, pv, 'binds', 'storage', 'BINDS', ['spec.volumeName']);
        const storageClass =
          asString(spec?.storageClassName) ?? row.storageClass;
        if (storageClass)
          for (const item of findClusterScopedByKindAndName(
            byKindName,
            row,
            ['SC', 'StorageClass'],
            storageClass,
          ))
            add(row, item, 'class', 'storage', 'USES_STORAGE_CLASS', [
              'spec.storageClassName',
            ]);
      }
    }
    return [...relations.values()].sort((left, right) =>
      left.id.localeCompare(right.id),
    );
  }
}

function confidenceFor(type: TopologyRelationType): number {
  switch (type) {
    case 'SELECTS':
    case 'GOVERNS':
      return 0.9;
    case 'RESOLVES':
    case 'ROUTES_TO':
    case 'ACCEPTS':
      return 0.98;
    default:
      return 1;
  }
}

type AddRelation = (
  source: PersistedResource,
  target: PersistedResource,
  label: string,
  role: TopologyRelationRole,
  type: TopologyRelationType,
  evidence: string[],
  ports?: string[],
) => void;

function resolveServiceRoutes(
  row: PersistedResource,
  role: 'network' | 'gateway',
  byKindName: Map<string, PersistedResource[]>,
  add: AddRelation,
): void {
  for (const backend of serviceBackends(row))
    for (const service of findByKindAndName(
      byKindName,
      row,
      'Service',
      backend.name,
    ))
      if (sameNamespace(row, service))
        add(
          row,
          service,
          'routes',
          role,
          'ROUTES_TO',
          [backend.path],
          backend.ports,
        );
}

function ownerReferences(
  row: PersistedResource,
): Array<{ kind: string; name: string; path: string }> {
  const status = asRecord(row.statusJson);
  const references = [
    ...asArray(status?.ownerReferences).map((value) => ({
      value,
      path: 'statusJson.ownerReferences',
    })),
    ...asArray(asRecord(status?.metadata)?.ownerReferences).map((value) => ({
      value,
      path: 'statusJson.metadata.ownerReferences',
    })),
  ];
  return references.flatMap(({ value, path }) => {
    const reference = asRecord(value);
    const kind = asString(reference?.kind);
    const name = asString(reference?.name);
    return kind && name ? [{ kind, name, path }] : [];
  });
}

function workloadReferences(row: PersistedResource): ResourceReference[] {
  const spec = asRecord(row.spec);
  const podSpec = podTemplateSpec(row.kind, spec);
  const refs: ResourceReference[] = [];
  const add = (
    kind: ResourceReference['kind'],
    name: string | null,
    path: string,
  ) => {
    if (name) refs.push({ kind, name, path });
  };
  for (const item of asArray(podSpec?.volumes)) {
    const volume = asRecord(item);
    add(
      'PersistentVolumeClaim',
      asString(asRecord(volume?.persistentVolumeClaim)?.claimName),
      'spec.volumes[].persistentVolumeClaim.claimName',
    );
    add(
      'ConfigMap',
      asString(asRecord(volume?.configMap)?.name),
      'spec.volumes[].configMap.name',
    );
    add(
      'Secret',
      asString(asRecord(volume?.secret)?.secretName),
      'spec.volumes[].secret.secretName',
    );
    for (const source of asArray(asRecord(volume?.projected)?.sources)) {
      const projected = asRecord(source);
      add(
        'ConfigMap',
        asString(asRecord(projected?.configMap)?.name),
        'spec.volumes[].projected.sources[].configMap.name',
      );
      add(
        'Secret',
        asString(asRecord(projected?.secret)?.name),
        'spec.volumes[].projected.sources[].secret.name',
      );
    }
  }
  for (const container of [
    ...asArray(podSpec?.containers),
    ...asArray(podSpec?.initContainers),
  ]) {
    const value = asRecord(container);
    for (const env of asArray(value?.env)) {
      const valueFrom = asRecord(asRecord(env)?.valueFrom);
      add(
        'ConfigMap',
        asString(asRecord(valueFrom?.configMapKeyRef)?.name),
        'spec.containers[].env[].valueFrom.configMapKeyRef.name',
      );
      add(
        'Secret',
        asString(asRecord(valueFrom?.secretKeyRef)?.name),
        'spec.containers[].env[].valueFrom.secretKeyRef.name',
      );
    }
    for (const envFrom of asArray(value?.envFrom)) {
      const source = asRecord(envFrom);
      add(
        'ConfigMap',
        asString(asRecord(source?.configMapRef)?.name),
        'spec.containers[].envFrom[].configMapRef.name',
      );
      add(
        'Secret',
        asString(asRecord(source?.secretRef)?.name),
        'spec.containers[].envFrom[].secretRef.name',
      );
    }
  }
  add(
    'ServiceAccount',
    asString(podSpec?.serviceAccountName),
    'spec.serviceAccountName',
  );
  for (const secret of asArray(podSpec?.imagePullSecrets))
    add(
      'Secret',
      asString(asRecord(secret)?.name),
      'spec.imagePullSecrets[].name',
    );
  return refs;
}

function endpointTargets(
  row: PersistedResource,
): Array<{ kind?: string; name?: string; ip?: string; path: string }> {
  const spec = asRecord(row.spec);
  const refs: Array<{
    kind?: string;
    name?: string;
    ip?: string;
    path: string;
  }> = [];
  const add = (value: Prisma.JsonValue | null | undefined, path: string) => {
    const target = asRecord(value);
    const kind = asString(target?.kind);
    const name = asString(target?.name);
    const ip = asString(target?.ip);
    if (kind && name) refs.push({ kind, name, path });
    else if (ip) refs.push({ ip, path });
  };
  for (const endpoint of asArray(spec?.endpoints)) {
    const item = asRecord(endpoint);
    if (item?.targetRef) add(item.targetRef, 'spec.endpoints[].targetRef');
    else {
      for (const address of asArray(item?.addresses)) {
        const ip = asString(address);
        if (ip) refs.push({ ip, path: 'spec.endpoints[].addresses[]' });
      }
      add(item, 'spec.endpoints[].addresses[]');
    }
  }
  for (const subset of asArray(spec?.subsets)) {
    for (const address of [
      ...asArray(asRecord(subset)?.addresses),
      ...asArray(asRecord(subset)?.notReadyAddresses),
    ]) {
      const item = asRecord(address);
      add(
        item?.targetRef ?? item,
        item?.targetRef
          ? 'spec.subsets[].addresses[].targetRef'
          : 'spec.subsets[].addresses[].ip',
      );
    }
  }
  return refs;
}

/** Match EndpointSlice/Endpoints address-only entries to persisted Pods. */
function podIpMatches(pod: PersistedResource, ip: string): boolean {
  const status = asRecord(pod.statusJson);
  if (asString(status?.podIP) === ip) return true;
  return asArray(status?.podIPs).some(
    (item) => asString(asRecord(item)?.ip) === ip,
  );
}

function serviceBackends(
  row: PersistedResource,
): Array<{ name: string; path: string; ports: string[] }> {
  const spec = asRecord(row.spec);
  const backends: Array<{ name: string; path: string; ports: string[] }> = [];
  const add = (value: Prisma.JsonValue | null | undefined, path: string) => {
    const backend = asRecord(value);
    const service = asRecord(backend?.service);
    const name =
      asString(service?.name) ??
      asString(backend?.serviceName) ??
      asString(backend?.name);
    if (!name) return;
    const rawPort = service?.port ?? backend?.servicePort ?? backend?.port;
    const port = asRecord(rawPort);
    const portValue =
      asString(port?.number) ?? asString(port?.name) ?? asString(rawPort);
    backends.push({ name, path, ports: portValue ? [portValue] : [] });
  };
  add(spec?.defaultBackend, 'spec.defaultBackend');
  for (const rule of asArray(spec?.rules))
    for (const path of asArray(asRecord(asRecord(rule)?.http)?.paths))
      add(asRecord(path)?.backend, 'spec.rules[].http.paths[].backend');
  for (const route of asArray(spec?.routes))
    for (const service of asArray(asRecord(route)?.services))
      add(service, 'spec.routes[].services[]');
  for (const rule of asArray(spec?.rules))
    for (const backend of asArray(asRecord(rule)?.backendRefs))
      add(backend, 'spec.rules[].backendRefs[]');
  return backends;
}

function gatewayParents(
  row: PersistedResource,
): Array<{ name: string; namespace: string | null; path: string }> {
  return asArray(asRecord(row.spec)?.parentRefs).flatMap((value) => {
    const parent = asRecord(value);
    const name = asString(parent?.name);
    return name
      ? [
          {
            name,
            namespace: asString(parent?.namespace),
            path: 'spec.parentRefs[]',
          },
        ]
      : [];
  });
}

function servicePorts(row: PersistedResource): string[] {
  return asArray(asRecord(row.spec)?.ports)
    .map((item) => {
      const port = asRecord(item);
      const protocol = asString(port?.protocol);
      const value = asString(port?.port);
      const target = asString(port?.targetPort);
      return value
        ? [protocol, target ? `${value}->${target}` : value]
            .filter(Boolean)
            .join(':')
        : null;
    })
    .filter((value): value is string => Boolean(value));
}

function configRelationType(
  kind: Exclude<ResourceReference['kind'], 'PersistentVolumeClaim'>,
): TopologyRelationType {
  if (kind === 'ConfigMap') return 'USES_CONFIG';
  if (kind === 'ServiceAccount') return 'USES_SERVICE_ACCOUNT';
  return 'USES_SECRET';
}

function findByKindAndName(
  index: Map<string, PersistedResource[]>,
  row: PersistedResource,
  kind: string,
  name: string,
): PersistedResource[] {
  return index.get(kindNameKey({ ...row, kind, name })) ?? [];
}

function findClusterScopedByKindAndName(
  index: Map<string, PersistedResource[]>,
  row: PersistedResource,
  kinds: string[],
  name: string,
): PersistedResource[] {
  return kinds.flatMap(
    (kind) =>
      index.get(kindNameKey({ ...row, namespace: null, kind, name })) ?? [],
  );
}

function isPersistentVolumeClaim(kind: string): boolean {
  return kind === 'PVC' || kind === 'PersistentVolumeClaim';
}

function isGatewayRoute(kind: string): boolean {
  return [
    'HTTPRoute',
    'GRPCRoute',
    'TCPRoute',
    'TLSRoute',
    'UDPRoute',
  ].includes(kind);
}

function podTemplateSpec(
  kind: string,
  spec: ReturnType<typeof asRecord>,
): ReturnType<typeof asRecord> {
  if (kind === 'Pod') return spec;
  if (kind === 'CronJob')
    return asRecord(
      asRecord(asRecord(asRecord(spec?.jobTemplate)?.spec)?.template)?.spec,
    );
  return asRecord(asRecord(spec?.template)?.spec);
}

function kindNameKey(
  row: Pick<PersistedResource, 'clusterId' | 'namespace' | 'kind' | 'name'>,
): string {
  return `${row.clusterId}\u0000${row.namespace ?? ''}\u0000${row.kind}\u0000${row.name}`;
}

function serviceKey(row: PersistedResource, name: string): string {
  return `${row.clusterId}\u0000${row.namespace ?? ''}\u0000${name}`;
}

function sameNamespace(
  left: PersistedResource,
  right: PersistedResource,
): boolean {
  return (
    left.clusterId === right.clusterId && left.namespace === right.namespace
  );
}

function labelsMatch(
  selector: Record<string, string>,
  labels: Prisma.JsonValue | null | undefined,
): boolean {
  const actual = asStringRecord(labels);
  return Object.entries(selector).every(
    ([key, value]) => actual?.[key] === value,
  );
}

function selectorEvidence(selector: Record<string, string>): string[] {
  return [
    'spec.selector',
    ...Object.entries(selector).map(
      ([key, value]) => `selector:${key}=${value}`,
    ),
  ];
}

function addToIndex<T>(index: Map<string, T[]>, key: string, value: T): void {
  const values = index.get(key);
  if (values) values.push(value);
  else index.set(key, [value]);
}

function uniqueSorted(values: string[]): string[] {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}
