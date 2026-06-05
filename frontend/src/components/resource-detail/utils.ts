"use client";

import type {
  ResourceDetailMetadata,
  ResourceDetailNetworkSummary,
  ResourceDetailResponse,
  ResourceDetailRuntime,
  ResourceDetailSection,
  ResourceDetailStorageSummary,
} from "@/lib/api/resources";
import { getClusterDisplayName } from "@/lib/cluster-display-name";
import type { ResourceDetailRenderProfile, SectionFieldMap } from "./types";

const DEFAULT_SECTION_FIELDS: SectionFieldMap = {
  overview: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
  runtime: ["phase"],
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
    runtimeFields: [
      "phase",
      "restartCount",
      "image",
      "images",
      "podIP",
      "nodeName",
      "serviceAccountName",
      "restartPolicy",
      "dnsPolicy",
      "schedulerName",
      "priorityClassName",
    ],
  },
  node: {
    title: "Node 详情",
    overviewFields: ["clusterId", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "ready", "roles", "internalIP", "externalIP", "osImage", "kernelVersion", "containerRuntimeVersion", "cpuCapacity", "memoryCapacity", "taints", "unschedulable"],
  },
  deployment: {
    title: "Deployment 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image", "images", "selector"],
  },
  statefulset: {
    title: "StatefulSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image", "images", "selector"],
  },
  daemonset: {
    title: "DaemonSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image", "images", "selector"],
  },
  replicaset: {
    title: "ReplicaSet 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas", "availableReplicas", "image", "images", "selector"],
  },
  job: {
    title: "Job 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas", "readyReplicas"],
  },
  cronjob: {
    title: "CronJob 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
  },
  service: {
    title: "Service 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
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
    runtimeFields: ["phase", "controllerName"],
  },
  gateway: {
    title: "Gateway 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "gatewayClassName", "hostnames"],
  },
  httproute: {
    title: "HTTPRoute 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "hostnames", "parentRefs", "backendRefs"],
  },
  "network-policy": {
    title: "NetworkPolicy 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["policyTypes", "podSelector"],
  },
  endpoints: {
    title: "Endpoints 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
  },
  endpointslice: {
    title: "EndpointSlice 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
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
    runtimeFields: [],
  },
  configmap: {
    title: "ConfigMap 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
  },
  secret: {
    title: "Secret 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
  },
  serviceaccount: {
    title: "ServiceAccount 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: [],
  },
  horizontalpodautoscaler: {
    title: "HorizontalPodAutoscaler 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase", "replicas"],
  },
  verticalpodautoscaler: {
    title: "VerticalPodAutoscaler 详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
    runtimeFields: ["phase"],
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
  dynamic: {
    title: "自定义资源详情",
    overviewFields: ["clusterId", "namespace", "kind", "name", "state", "createdAt", "updatedAt"],
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
    case "node":
    case "nodes":
      return "node";
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
    case "dynamic":
    case "dynamicresource":
    case "customresource":
      return "dynamic";
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
      runtimeFields: ["phase"],
    }
  );
}

export function getOrderedFields(
  detail: ResourceDetailResponse,
  section: ResourceDetailSection,
  fallback: string[],
): string[] {
  const configured = detail.descriptor.fieldsBySection[section] ?? [];
  if (section === "runtime") {
    const allowed = new Set(fallback);
    return (configured.length > 0 ? configured : fallback).filter((field) =>
      allowed.has(field),
    );
  }
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
    selector: "Selector",
    serviceAccountName: "ServiceAccount",
    restartPolicy: "重启策略",
    dnsPolicy: "DNS 策略",
    schedulerName: "调度器",
    priorityClassName: "优先级类",
    ready: "Ready",
    roles: "角色",
    internalIP: "Internal IP",
    externalIP: "External IP",
    osImage: "OS Image",
    kernelVersion: "Kernel",
    containerRuntimeVersion: "容器运行时",
    cpuCapacity: "CPU 容量",
    memoryCapacity: "内存容量",
    taints: "Taints",
    unschedulable: "不可调度",
    controllerName: "Controller",
    gatewayClassName: "GatewayClass",
    hostnames: "Hostnames",
    parentRefs: "ParentRefs",
    backendRefs: "BackendRefs",
    policyTypes: "策略类型",
    podSelector: "Pod Selector",
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

export function buildOverviewFieldMap(
  detail: ResourceDetailResponse,
  clusterMap?: Record<string, string>,
): Record<string, unknown> {
  return {
    id: detail.overview.id,
    clusterId: getClusterDisplayName(clusterMap ?? {}, detail.overview.clusterId),
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
    selector: runtime.selector,
    serviceAccountName: runtime.serviceAccountName,
    restartPolicy: runtime.restartPolicy,
    dnsPolicy: runtime.dnsPolicy,
    schedulerName: runtime.schedulerName,
    priorityClassName: runtime.priorityClassName,
    controllerName: runtime.controllerName,
    gatewayClassName: runtime.gatewayClassName,
    hostnames: runtime.hostnames?.join(", "),
    parentRefs: runtime.parentRefs?.join(", "),
    backendRefs: runtime.backendRefs?.join(", "),
    ready: runtime.ready,
    roles: runtime.roles?.join(", "),
    internalIP: runtime.internalIP,
    externalIP: runtime.externalIP,
    osImage: runtime.osImage,
    kernelVersion: runtime.kernelVersion,
    containerRuntimeVersion: runtime.containerRuntimeVersion,
    cpuCapacity: runtime.cpuCapacity,
    memoryCapacity: runtime.memoryCapacity,
    taints: runtime.taints?.join(", "),
    unschedulable: runtime.unschedulable,
    policyTypes: runtime.policyTypes?.join(", "),
    podSelector: runtime.podSelector,
  };
}

export function hasMetadataContent(metadata: ResourceDetailMetadata): boolean {
  return (
    Object.keys(metadata.labels).length > 0 ||
    Object.keys(metadata.annotations).length > 0 ||
    metadata.ownerReferences.length > 0 ||
    metadata.configUsages.length > 0
  );
}

export function hasNetworkContent(network: ResourceDetailNetworkSummary): boolean {
  return (
    network.clusterIPs.length > 0 ||
    network.podIPs.length > 0 ||
    network.nodeNames.length > 0 ||
    network.endpoints.length > 0 ||
    network.networkPipelines.length > 0
  );
}

export function hasStorageContent(storage: ResourceDetailStorageSummary): boolean {
  return (
    storage.storageClasses.length > 0 ||
    storage.persistentVolumeClaims.length > 0 ||
    storage.persistentVolumes.length > 0 ||
    storage.volumes.length > 0 ||
    storage.mounts.length > 0 ||
    storage.storagePipelines.length > 0
  );
}
