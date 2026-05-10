"use client";

import type {
  ResourceDetailMetadata,
  ResourceDetailNetworkSummary,
  ResourceDetailResponse,
  ResourceDetailRuntime,
  ResourceDetailSection,
  ResourceDetailStorageSummary,
} from "@/lib/api/resources";
import type { ResourceDetailRenderProfile, SectionFieldMap } from "./types";

const DEFAULT_SECTION_FIELDS: SectionFieldMap = {
  overview: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
  runtime: ["phase", "replicas", "readyReplicas", "availableReplicas", "restartCount", "image", "podIP", "nodeName"],
  associations: [],
  network: [],
  storage: [],
  events: [],
  metadata: [],
};

const RENDER_PROFILES: Record<string, ResourceDetailRenderProfile> = {
  pod: {
    title: "Pod 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "restartCount", "image", "podIP", "nodeName"],
  },
  deployment: {
    title: "Deployment 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image"],
  },
  statefulset: {
    title: "StatefulSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image"],
  },
  daemonset: {
    title: "DaemonSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "readyReplicas", "availableReplicas", "image"],
  },
  replicaset: {
    title: "ReplicaSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image"],
  },
  job: {
    title: "Job 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "restartCount", "image", "podIP", "nodeName"],
  },
  cronjob: {
    title: "CronJob 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "image"],
  },
  service: {
    title: "Service 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  ingress: {
    title: "Ingress 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  ingressroute: {
    title: "IngressRoute 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  gatewayclass: {
    title: "GatewayClass 详情",
    overviewFields: ["clusterId", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  gateway: {
    title: "Gateway 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  httproute: {
    title: "HTTPRoute 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  "network-policy": {
    title: "NetworkPolicy 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  endpoints: {
    title: "Endpoints 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  endpointslice: {
    title: "EndpointSlice 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  persistentvolume: {
    title: "PersistentVolume 详情",
    overviewFields: ["clusterId", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  persistentvolumeclaim: {
    title: "PersistentVolumeClaim 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  storageclass: {
    title: "StorageClass 详情",
    overviewFields: ["clusterId", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  configmap: {
    title: "ConfigMap 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  secret: {
    title: "Secret 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  serviceaccount: {
    title: "ServiceAccount 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  horizontalpodautoscaler: {
    title: "HorizontalPodAutoscaler 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas"],
  },
  verticalpodautoscaler: {
    title: "VerticalPodAutoscaler 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas"],
  },
  helmrelease: {
    title: "Helm 应用详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  helmrepository: {
    title: "Helm 仓库详情",
    overviewFields: ["clusterId", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
};

export function normalizeKind(kind: string): string {
  const value = kind.trim().toLowerCase().replace(/[\s_-]+/g, "");
  switch (value) {
    case "serviceaccount":
    case "serviceaccounts":
      return "serviceaccount";
    case "secret":
    case "secrets":
      return "secret";
    case "deployments":
      return "deployment";
    case "pods":
      return "pod";
    case "statefulsets":
      return "statefulset";
    case "daemonsets":
      return "daemonset";
    case "replicasets":
      return "replicaset";
    case "jobs":
      return "job";
    case "cronjobs":
      return "cronjob";
    case "services":
      return "service";
    case "ingresses":
      return "ingress";
    case "ingressroutes":
      return "ingressroute";
    case "gatewayclass":
    case "gatewayclasses":
      return "gatewayclass";
    case "gateway":
    case "gateways":
      return "gateway";
    case "httproute":
    case "httproutes":
      return "httproute";
    case "networkpolicy":
    case "networkpolicies":
      return "network-policy";
    case "endpoint":
    case "endpoints":
      return "endpoints";
    case "endpointslices":
      return "endpointslice";
    case "horizontalpodautoscaler":
    case "horizontalpodautoscalers":
    case "hpa":
    case "hpas":
      return "horizontalpodautoscaler";
    case "verticalpodautoscaler":
    case "verticalpodautoscalers":
    case "vpa":
    case "vpas":
      return "verticalpodautoscaler";
    case "pv":
    case "persistentvolumes":
      return "persistentvolume";
    case "pvc":
    case "persistentvolumeclaims":
      return "persistentvolumeclaim";
    case "sc":
    case "storageclasses":
      return "storageclass";
    case "configmaps":
      return "configmap";
    case "helmapplications":
    case "helmreleases":
      return "helmrelease";
    case "helmrepositories":
      return "helmrepository";
    default:
      return value;
  }
}

export function getKindTitle(kind: string): string {
  return (
    RENDER_PROFILES[normalizeKind(kind)]?.title ??
    `${kind.trim() || "资源"}详情`
  );
}

export function getRenderProfile(detail: ResourceDetailResponse): ResourceDetailRenderProfile {
  return (
    RENDER_PROFILES[normalizeKind(detail.descriptor.resourceKind || detail.overview.kind)] ?? {
      title: `${detail.overview.kind || detail.descriptor.resourceKind || "资源"}详情`,
      overviewFields: DEFAULT_SECTION_FIELDS.overview,
      runtimeFields: DEFAULT_SECTION_FIELDS.runtime,
    }
  );
}

export function getOrderedFields(
  detail: ResourceDetailResponse,
  section: ResourceDetailSection,
  fallback: string[],
): string[] {
  const configured = detail.descriptor.fieldsBySection[section] ?? [];
  if (configured.length > 0) {
    return configured;
  }
  return fallback.length > 0 ? fallback : DEFAULT_SECTION_FIELDS[section];
}

export function formatValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "-";
  }
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return value.trim() || "-";
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return "-";
    }
    return value.map((item) => formatValue(item)).join(", ");
  }
  return JSON.stringify(value);
}

export function formatDateTime(value?: string): string {
  if (!value) {
    return "-";
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleString("zh-CN", { hour12: false });
}

export function humanizeFieldLabel(field: string): string {
  const known: Record<string, string> = {
    clusterId: "集群",
    namespace: "名称空间",
    kind: "类型",
    name: "名称",
    state: "状态",
    createdAt: "创建时间",
    updatedAt: "更新时间",
    phase: "阶段",
    replicas: "副本数",
    readyReplicas: "就绪副本",
    availableReplicas: "可用副本",
    restartCount: "重启次数",
    image: "主镜像",
    images: "镜像列表",
    podIP: "Pod IP",
    nodeName: "节点",
    id: "资源 ID",
  };

  if (known[field]) {
    return known[field];
  }

  return field
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (match) => match.toUpperCase());
}

export function buildOverviewFieldMap(detail: ResourceDetailResponse): Record<string, unknown> {
  return {
    id: detail.overview.id,
    clusterId: detail.overview.clusterId,
    namespace: detail.overview.namespace,
    kind: detail.overview.kind,
    name: detail.overview.name,
    state: detail.overview.state,
    createdAt: detail.overview.createdAt,
    updatedAt: detail.overview.updatedAt,
  };
}

export function buildRuntimeFieldMap(runtime: ResourceDetailRuntime): Record<string, unknown> {
  return {
    phase: runtime.phase,
    replicas: runtime.replicas,
    readyReplicas: runtime.readyReplicas,
    availableReplicas: runtime.availableReplicas,
    restartCount: runtime.restartCount,
    image: runtime.image,
    images: runtime.images,
    podIP: runtime.podIP,
    nodeName: runtime.nodeName,
  };
}

export function hasMetadataContent(metadata: ResourceDetailMetadata): boolean {
  return (
    Object.keys(metadata.labels).length > 0 ||
    Object.keys(metadata.annotations).length > 0 ||
    metadata.ownerReferences.length > 0
  );
}

export function hasNetworkContent(network: ResourceDetailNetworkSummary): boolean {
  return (
    network.clusterIPs.length > 0 ||
    network.podIPs.length > 0 ||
    network.nodeNames.length > 0 ||
    network.endpoints.length > 0
  );
}

export function hasStorageContent(storage: ResourceDetailStorageSummary): boolean {
  return (
    storage.storageClasses.length > 0 ||
    storage.persistentVolumeClaims.length > 0 ||
    storage.persistentVolumes.length > 0 ||
    storage.volumes.length > 0 ||
    storage.mounts.length > 0
  );
}
