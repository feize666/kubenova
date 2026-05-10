"use client";

import { ArrowLeftOutlined, PlusOutlined } from "@ant-design/icons";
import { useQuery } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Col,
  Form,
  Input,
  InputNumber,
  Row,
  Select,
  Space,
  Steps,
  Switch,
  Typography,
} from "antd";
import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/components/auth-context";
import { getClusters } from "@/lib/api/clusters";
import { getStorageResources } from "@/lib/api/storage";
import { ApiError } from "@/lib/api/client";
import {
  renderWorkloadWorkspaceYaml,
  submitWorkloadWorkspace,
  validateWorkloadWorkspace,
  type WorkloadWorkspacePayload,
  type WorkloadWorkspaceValidationIssue,
} from "@/lib/api/workloads";
import { mapApiErrorToWorkspaceIssues } from "./error-mapping";

type SupportedKind = "Pod" | "Deployment" | "StatefulSet" | "ReplicaSet" | "DaemonSet";

interface InitContainerFormItem {
  name?: string;
  image?: string;
  command?: string;
  args?: string;
}

interface WorkspaceFormValues {
  clusterId: string;
  namespace: string;
  kind: SupportedKind;
  name: string;
  replicas?: number;
  containerName?: string;
  image: string;
  command?: string;
  args?: string;
  scheduling?: {
    nodeSelector?: string;
    tolerations?: string;
    affinity?: string;
  };
  probes?: {
    liveness?: ProbeFormItem;
    readiness?: ProbeFormItem;
    startup?: ProbeFormItem;
  };
  mountPvc?: boolean;
  pvcMount?: {
    storageSourceType?: "PVC" | "PV" | "SC";
    useExistingPvc?: boolean;
    existingPvcName?: string;
    existingPvName?: string;
    existingStorageClassName?: string;
    newPvcName?: string;
    newPvcCapacity?: string;
    newPvcStorageClass?: string;
    mountPath?: string;
  };
  createService?: boolean;
  service?: {
    name?: string;
    type?: "ClusterIP" | "NodePort" | "LoadBalancer";
    containerPort?: number;
    servicePort?: number;
  };
  createIngress?: boolean;
  networkMode?: "ingress" | "ingressroute";
  ingress?: {
    name?: string;
    host?: string;
    path?: string;
    ingressClassName?: string;
  };
  ingressRoute?: {
    name?: string;
    entryPoints?: string;
    match?: string;
    middlewares?: string;
    tlsSecretName?: string;
    serviceName?: string;
    servicePort?: number;
  };
  initContainers?: InitContainerFormItem[];
}

interface ProbeFormItem {
  enabled?: boolean;
  type?: "httpGet" | "tcpSocket" | "exec";
  path?: string;
  port?: number;
  scheme?: "HTTP" | "HTTPS";
  command?: string;
  initialDelaySeconds?: number;
  periodSeconds?: number;
  timeoutSeconds?: number;
  successThreshold?: number;
  failureThreshold?: number;
}

const KIND_OPTIONS: Array<{ label: string; value: SupportedKind }> = [
  { label: "Pod", value: "Pod" },
  { label: "Deployment", value: "Deployment" },
  { label: "StatefulSet", value: "StatefulSet" },
  { label: "ReplicaSet", value: "ReplicaSet" },
  { label: "DaemonSet", value: "DaemonSet" },
];

const TARGET_ROUTE_MAP: Record<SupportedKind, string> = {
  Pod: "/workloads/pods",
  Deployment: "/workloads/deployments",
  StatefulSet: "/workloads/statefulsets",
  ReplicaSet: "/workloads/replicasets",
  DaemonSet: "/workloads/daemonsets",
};

const WORKSPACE_STEPS = [
  "基础信息",
  "镜像配置",
  "存储配置",
  "网络配置",
  "初始化容器",
  "高级选项",
  "预览提交",
];

const STEP_INDEX: Record<NonNullable<WorkloadWorkspaceValidationIssue["step"]>, number> = {
  basic: 0,
  image: 1,
  storage: 2,
  network: 3,
  init: 4,
  advanced: 5,
  submit: 6,
};

function normalizeKind(input: string | null): SupportedKind {
  const value = (input ?? "").trim().toLowerCase();
  if (value === "deployment" || value === "deployments" || value === "deploy") return "Deployment";
  if (value === "statefulset" || value === "statefulsets" || value === "sts") return "StatefulSet";
  if (value === "replicaset" || value === "replicasets" || value === "rs") return "ReplicaSet";
  if (value === "daemonset" || value === "daemonsets" || value === "ds") return "DaemonSet";
  return "Pod";
}

function splitTokens(raw?: string): string[] | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const tokens = text.split(/\s+/).map((item) => item.trim()).filter(Boolean);
  return tokens.length > 0 ? tokens : undefined;
}

function buildContainerSpec(
  name: string,
  image: string,
  command?: string,
  args?: string,
  probes?: WorkspaceFormValues["probes"],
): Record<string, unknown> {
  const livenessProbe = buildProbeSpec(probes?.liveness);
  const readinessProbe = buildProbeSpec(probes?.readiness);
  const startupProbe = buildProbeSpec(probes?.startup);
  return {
    name,
    image,
    ...(splitTokens(command) ? { command: splitTokens(command) } : {}),
    ...(splitTokens(args) ? { args: splitTokens(args) } : {}),
    ...(livenessProbe ? { livenessProbe } : {}),
    ...(readinessProbe ? { readinessProbe } : {}),
    ...(startupProbe ? { startupProbe } : {}),
  };
}

function parseNodeSelector(raw?: string): Record<string, string> | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  const out: Record<string, string> = {};
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx <= 0 || idx >= line.length - 1) return undefined;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!key || !value) return undefined;
    out[key] = value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function parseJsonObject(raw?: string): Record<string, unknown> | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

function parseJsonArray(raw?: string): unknown[] | undefined {
  const text = raw?.trim();
  if (!text) return undefined;
  try {
    const parsed = JSON.parse(text) as unknown;
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isValidLabelSegment(value: string): boolean {
  return /^[A-Za-z0-9]([A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(value);
}

function validateNodeSelectorInput(value?: string): Promise<void> {
  const text = value?.trim();
  if (!text) return Promise.resolve();
  const lines = text.split("\n").map((line) => line.trim()).filter(Boolean);
  for (const line of lines) {
    const idx = line.indexOf("=");
    if (idx <= 0 || idx >= line.length - 1) {
      return Promise.reject(new Error("每行必须是 key=value"));
    }
    const key = line.slice(0, idx).trim();
    const val = line.slice(idx + 1).trim();
    if (!key || !val) {
      return Promise.reject(new Error("key/value 不能为空"));
    }
    const segments = key.split("/");
    const label = segments[segments.length - 1];
    if (!isValidLabelSegment(label)) {
      return Promise.reject(new Error("key 不符合 Kubernetes label 规则"));
    }
  }
  return Promise.resolve();
}

function validateJsonArrayInput(value?: string): Promise<void> {
  const text = value?.trim();
  if (!text) return Promise.resolve();
  if (!parseJsonArray(text)) {
    return Promise.reject(new Error("请输入合法 JSON 数组"));
  }
  return Promise.resolve();
}

function validateJsonObjectInput(value?: string): Promise<void> {
  const text = value?.trim();
  if (!text) return Promise.resolve();
  if (!parseJsonObject(text)) {
    return Promise.reject(new Error("请输入合法 JSON 对象"));
  }
  return Promise.resolve();
}

function validateProbeCommandInput(value?: string): Promise<void> {
  if (splitTokens(value)) return Promise.resolve();
  return Promise.reject(new Error("请输入有效命令（按空格分词）"));
}

function validateProbeHttpPathInput(value?: string): Promise<void> {
  const text = value?.trim();
  if (!text) return Promise.reject(new Error("请输入 Path"));
  if (!text.startsWith("/")) return Promise.reject(new Error("HTTP Path 必须以 / 开头"));
  return Promise.resolve();
}

function buildSchedulingSpec(
  scheduling: WorkspaceFormValues["scheduling"] | undefined,
): Record<string, unknown> {
  if (!scheduling) return {};
  const out: Record<string, unknown> = {};
  const nodeSelector = parseNodeSelector(scheduling.nodeSelector);
  if (nodeSelector) out.nodeSelector = nodeSelector;
  const tolerations = parseJsonArray(scheduling.tolerations);
  if (tolerations) out.tolerations = tolerations;
  const affinity = parseJsonObject(scheduling.affinity);
  if (affinity) out.affinity = affinity;
  return out;
}

function buildProbeSpec(probe: ProbeFormItem | undefined): Record<string, unknown> | undefined {
  if (!probe?.enabled) return undefined;
  const common: Record<string, unknown> = {};
  if (typeof probe.initialDelaySeconds === "number") common.initialDelaySeconds = probe.initialDelaySeconds;
  if (typeof probe.periodSeconds === "number") common.periodSeconds = probe.periodSeconds;
  if (typeof probe.timeoutSeconds === "number") common.timeoutSeconds = probe.timeoutSeconds;
  if (typeof probe.successThreshold === "number") common.successThreshold = probe.successThreshold;
  if (typeof probe.failureThreshold === "number") common.failureThreshold = probe.failureThreshold;
  const type = probe.type ?? "httpGet";
  if (type === "exec") {
    const command = splitTokens(probe.command);
    if (!command) return undefined;
    return { exec: { command }, ...common };
  }
  if (typeof probe.port !== "number") return undefined;
  if (type === "tcpSocket") return { tcpSocket: { port: probe.port }, ...common };
  if (!probe.path?.trim()) return undefined;
  return {
    httpGet: {
      path: probe.path.trim(),
      port: probe.port,
      scheme: probe.scheme === "HTTPS" ? "HTTPS" : "HTTP",
    },
    ...common,
  };
}

function buildWorkloadSpec(values: Partial<WorkspaceFormValues> | undefined): Record<string, unknown> | undefined {
  const workloadName = values?.name?.trim();
  const image = values?.image?.trim();
  if (!workloadName || !image) return undefined;

  const labels = { app: workloadName };
  const mainContainer = buildContainerSpec(
    values?.containerName?.trim() || "main",
    image,
    values?.command,
    values?.args,
    values?.probes,
  );
  const initContainers = (values?.initContainers ?? [])
    .filter((item) => item.name?.trim() && item.image?.trim())
    .map((item) =>
      buildContainerSpec(item.name!.trim(), item.image!.trim(), item.command, item.args),
    );

  const volumeMounts: Array<Record<string, unknown>> = [];
  const volumes: Array<Record<string, unknown>> = [];

  if (values?.mountPvc && values?.pvcMount?.mountPath) {
    const sourceType = values?.pvcMount?.storageSourceType ?? "PVC";
    const claimName = values.pvcMount.useExistingPvc
      ? sourceType === "PVC"
        ? values?.pvcMount?.existingPvcName?.trim()
        : values?.pvcMount?.newPvcName?.trim()
      : values?.pvcMount?.newPvcName?.trim();
    if (claimName) {
      volumeMounts.push({
        name: "workspace-pvc",
        mountPath: values?.pvcMount?.mountPath?.trim(),
      });
      volumes.push({
        name: "workspace-pvc",
        persistentVolumeClaim: { claimName },
      });
    }
  }

  const schedulingPatch = buildSchedulingSpec(values?.scheduling);
  const podSpec = {
    containers: [
      {
        ...mainContainer,
        ...(volumeMounts.length > 0 ? { volumeMounts } : {}),
      },
    ],
    ...(initContainers.length > 0 ? { initContainers } : {}),
    ...(volumes.length > 0 ? { volumes } : {}),
    ...schedulingPatch,
  };

  if (values?.kind === "Pod") return podSpec;
  if (values?.kind === "Deployment") {
    return {
      replicas: values?.replicas ?? 1,
      selector: { matchLabels: labels },
      template: { metadata: { labels }, spec: podSpec },
    };
  }
  if (values?.kind === "StatefulSet") {
    return {
      replicas: values?.replicas ?? 1,
      serviceName: workloadName,
      selector: { matchLabels: labels },
      template: { metadata: { labels }, spec: podSpec },
    };
  }
  if (values?.kind === "ReplicaSet") {
    return {
      replicas: values?.replicas ?? 1,
      selector: { matchLabels: labels },
      template: { metadata: { labels }, spec: podSpec },
    };
  }
  return {
    selector: { matchLabels: labels },
    template: { metadata: { labels }, spec: podSpec },
  };
}

function toNamePath(field: string): Array<string | number> {
  return field
    .split(".")
    .filter(Boolean)
    .map((item) => (/^\d+$/.test(item) ? Number(item) : item));
}

function firstSegmentOfPath(path: Array<string | number>): string {
  const first = path[0];
  return typeof first === "number" ? String(first) : (first ?? "");
}

function mapFieldPathToStep(path: Array<string | number>): number {
  const first = firstSegmentOfPath(path);
  if (first === "clusterId" || first === "namespace" || first === "kind" || first === "name" || first === "replicas") {
    return 0;
  }
  if (first === "containerName" || first === "image") {
    return 1;
  }
  if (first === "mountPvc" || first === "pvcMount") {
    return 2;
  }
  if (first === "createService" || first === "createIngress" || first === "networkMode" || first === "service" || first === "ingress" || first === "ingressRoute") {
    return 3;
  }
  if (first === "initContainers") {
    return 4;
  }
  if (first === "scheduling" || first === "probes") {
    return 5;
  }
  return 6;
}

function flattenChangedValuePaths(
  input: unknown,
  prefix: Array<string | number> = [],
): Array<Array<string | number>> {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return prefix.length > 0 ? [prefix] : [];
  }
  const obj = input as Record<string, unknown>;
  const keys = Object.keys(obj);
  if (keys.length === 0) {
    return prefix.length > 0 ? [prefix] : [];
  }
  const paths: Array<Array<string | number>> = [];
  for (const key of keys) {
    const value = obj[key];
    const nextPrefix = [...prefix, key];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      paths.push(...flattenChangedValuePaths(value, nextPrefix));
    } else {
      paths.push(nextPrefix);
    }
  }
  return paths;
}

export default function WorkloadCreateWorkspacePage() {
  const { message } = App.useApp();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { accessToken, isInitializing } = useAuth();
  const [submitting, setSubmitting] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const [isDirty, setIsDirty] = useState(false);
  const [form] = Form.useForm<WorkspaceFormValues>();

  const initialKind = useMemo(() => normalizeKind(searchParams.get("kind")), [searchParams]);
  const draftStorageKey = useMemo(() => `kubenova.workload.create.${initialKind}`, [initialKind]);

  const clustersQuery = useQuery({
    queryKey: ["clusters", "all-for-workload-create-workspace", accessToken],
    queryFn: () => getClusters({ pageSize: 200, state: "active", selectableOnly: true }, accessToken!),
    enabled: !isInitializing && Boolean(accessToken),
  });

  const clusterOptions = useMemo(
    () => (clustersQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.id })),
    [clustersQuery.data?.items],
  );

  const kind = Form.useWatch("kind", form) ?? initialKind;
  const previewValues = Form.useWatch([], form) as Partial<WorkspaceFormValues> | undefined;
  const clusterId = Form.useWatch("clusterId", form);
  const namespace = Form.useWatch("namespace", form);
  const mountPvc = Form.useWatch("mountPvc", form);
  const createService = Form.useWatch("createService", form);
  const createIngress = Form.useWatch("createIngress", form);
  const networkMode = (Form.useWatch("networkMode", form) ?? "ingress") as "ingress" | "ingressroute";
  const useExistingPvc = Form.useWatch(["pvcMount", "useExistingPvc"], form);
  const storageSourceType = (Form.useWatch(["pvcMount", "storageSourceType"], form) ?? "PVC") as "PVC" | "PV" | "SC";
  const supportsReplicas = kind === "Deployment" || kind === "StatefulSet" || kind === "ReplicaSet";
  const previewSpec = buildWorkloadSpec(previewValues);
  const previewPayload = useMemo(
    () => (previewValues ?? {}) as WorkloadWorkspacePayload,
    [previewValues],
  );
  const previewPayloadKey = useMemo(
    () => JSON.stringify(previewPayload),
    [previewPayload],
  );

  const pvcQuery = useQuery({
    queryKey: ["storage", "workspace-pvc", clusterId, namespace, accessToken],
    queryFn: () =>
      getStorageResources(
        {
          kind: "PVC",
          clusterId: clusterId || undefined,
          namespace: namespace?.trim() || undefined,
          pageSize: 200,
        },
        accessToken,
      ),
    enabled: Boolean(accessToken) && Boolean(clusterId) && Boolean(namespace),
  });

  const storageClassQuery = useQuery({
    queryKey: ["storage", "workspace-sc", clusterId, accessToken],
    queryFn: () =>
      getStorageResources(
        {
          kind: "SC",
          clusterId: clusterId || undefined,
          pageSize: 200,
        },
        accessToken,
      ),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });
  const pvQuery = useQuery({
    queryKey: ["storage", "workspace-pv", clusterId, accessToken],
    queryFn: () =>
      getStorageResources(
        {
          kind: "PV",
          clusterId: clusterId || undefined,
          pageSize: 200,
        },
        accessToken,
      ),
    enabled: Boolean(accessToken) && Boolean(clusterId),
  });


  const pvcOptions = useMemo(
    () => (pvcQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.name })),
    [pvcQuery.data?.items],
  );
  const selectedClusterLabel = useMemo(() => {
    const match = clusterOptions.find((item) => item.value === clusterId);
    return match?.label ?? clusterId ?? "-";
  }, [clusterOptions, clusterId]);
  const pvcScopeText = useMemo(() => {
    const ns = namespace?.trim();
    if (!clusterId) {
      return "请先选择集群";
    }
    if (storageSourceType === "PVC" && !ns) {
      return "请先填写名称空间";
    }
    if (storageSourceType === "PVC") {
      return `当前作用域：集群 ${selectedClusterLabel} / 名称空间 ${ns}`;
    }
    return `当前作用域：集群 ${selectedClusterLabel}`;
  }, [clusterId, namespace, selectedClusterLabel, storageSourceType]);
  const pvOptions = useMemo(
    () => (pvQuery.data?.items ?? []).map((item) => ({ label: item.name, value: item.name })),
    [pvQuery.data?.items],
  );
  const showPvcEmptyScopedState =
    Boolean(mountPvc) &&
    Boolean(useExistingPvc) &&
    Boolean(clusterId) &&
    !(
      storageSourceType === "PVC"
        ? pvcQuery.isLoading || !namespace?.trim() || pvcOptions.length > 0
        : storageSourceType === "PV"
          ? pvQuery.isLoading || pvOptions.length > 0
          : storageClassQuery.isLoading || (storageClassQuery.data?.items?.length ?? 0) > 0
    );
  const storageQueryErrorMessage = useMemo(() => {
    if (storageSourceType === "PVC" && pvcQuery.error instanceof Error) {
      return pvcQuery.error.message;
    }
    if (storageSourceType === "PV" && pvQuery.error instanceof Error) {
      return pvQuery.error.message;
    }
    if (storageSourceType === "SC" && storageClassQuery.error instanceof Error) {
      return storageClassQuery.error.message;
    }
    return null;
  }, [storageSourceType, pvcQuery.error, pvQuery.error, storageClassQuery.error]);
  const storageClassOptions = useMemo(
    () =>
      (storageClassQuery.data?.items ?? []).map((item) => ({
        label: item.name,
        value: item.name,
      })),
    [storageClassQuery.data?.items],
  );

  const previewYamlQuery = useQuery({
    queryKey: ["workloads", "workspace", "render-yaml", accessToken, currentStep, previewPayloadKey],
    queryFn: () => renderWorkloadWorkspaceYaml(previewPayload, accessToken),
    enabled: Boolean(accessToken) && currentStep === 6,
    retry: false,
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    const raw = window.localStorage.getItem(draftStorageKey);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as Partial<WorkspaceFormValues>;
      form.setFieldsValue(parsed);
      setIsDirty(true);
    } catch {
      window.localStorage.removeItem(draftStorageKey);
    }
  }, [draftStorageKey, form]);

  useEffect(() => {
    if (typeof window === "undefined" || !isDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  const persistDraft = () => {
    if (typeof window === "undefined") return;
    const values = form.getFieldsValue();
    window.localStorage.setItem(draftStorageKey, JSON.stringify(values));
    setIsDirty(true);
  };

  const clearDraft = () => {
    if (typeof window === "undefined") return;
    window.localStorage.removeItem(draftStorageKey);
    setIsDirty(false);
  };

  const handleGoBack = () => {
    if (typeof window !== "undefined" && isDirty && !window.confirm("当前工作区有未保存改动，确认离开吗？")) {
      return;
    }
    router.back();
  };

  const validateStep = async (step: number) => {
    if (step === 0) {
      await form.validateFields(["clusterId", "namespace", "kind", "name", ...(supportsReplicas ? ["replicas"] : [])]);
      return;
    }
    if (step === 1) {
      await form.validateFields(["containerName", "image"]);
      return;
    }
    if (step === 2 && mountPvc) {
      const fields: Array<string | string[]> = [["pvcMount", "mountPath"]];
      if (useExistingPvc) {
        if (storageSourceType === "PVC") {
          fields.push(["pvcMount", "existingPvcName"]);
        } else if (storageSourceType === "PV") {
          fields.push(["pvcMount", "existingPvName"]);
        } else {
          fields.push(["pvcMount", "existingStorageClassName"]);
        }
      } else {
        fields.push(["pvcMount", "newPvcName"]);
      }
      await form.validateFields(fields);
      return;
    }
    if (step === 3) {
      const fields: Array<string | string[]> = [];
      if (createService) {
        fields.push(["service", "name"], ["service", "containerPort"], ["service", "servicePort"]);
      }
      if (createIngress) {
        fields.push("networkMode");
        if (networkMode === "ingressroute") {
          fields.push(["ingressRoute", "name"], ["ingressRoute", "entryPoints"], ["ingressRoute", "match"]);
        } else {
          fields.push(["ingress", "name"], ["ingress", "host"]);
        }
      }
      if (fields.length > 0) {
        await form.validateFields(fields);
      }
      return;
    }
    if (step === 5) {
      const values = form.getFieldsValue(true) as Partial<WorkspaceFormValues>;
      const fields: Array<string | string[]> = [];
      (["liveness", "readiness", "startup"] as const).forEach((name) => {
        const probe = values.probes?.[name];
        if (!probe?.enabled) return;
        const type = probe.type ?? "httpGet";
        if (type === "httpGet") {
          fields.push(["probes", name, "path"], ["probes", name, "port"]);
        } else if (type === "tcpSocket") {
          fields.push(["probes", name, "port"]);
        } else {
          fields.push(["probes", name, "command"]);
        }
      });
      if (fields.length > 0) {
        await form.validateFields(fields);
      }
    }
  };

  const getPreviewRequiredFields = (): Array<string | string[]> => {
    const values = form.getFieldsValue(true) as Partial<WorkspaceFormValues>;
    const needsReplicas = values.kind === "Deployment" || values.kind === "StatefulSet" || values.kind === "ReplicaSet";
    const fields: Array<string | string[]> = [
      "clusterId",
      "namespace",
      "kind",
      "name",
      ...(needsReplicas ? ["replicas"] : []),
      "containerName",
      "image",
    ];

    if (values.mountPvc) {
      fields.push(["pvcMount", "mountPath"]);
      if (values.pvcMount?.useExistingPvc ?? true) {
        const sourceType = values.pvcMount?.storageSourceType ?? "PVC";
        if (sourceType === "PVC") {
          fields.push(["pvcMount", "existingPvcName"]);
        } else if (sourceType === "PV") {
          fields.push(["pvcMount", "existingPvName"]);
        } else {
          fields.push(["pvcMount", "existingStorageClassName"]);
        }
      } else {
        fields.push(["pvcMount", "newPvcName"]);
      }
    }

    if (values.createService) {
      fields.push(["service", "name"], ["service", "containerPort"], ["service", "servicePort"]);
    }
    if (values.createIngress) {
      fields.push("networkMode");
      const mode = values.networkMode ?? "ingress";
      if (mode === "ingressroute") {
        fields.push(["ingressRoute", "name"], ["ingressRoute", "entryPoints"], ["ingressRoute", "match"]);
      } else {
        fields.push(["ingress", "name"], ["ingress", "host"]);
      }
    }

    (["liveness", "readiness", "startup"] as const).forEach((name) => {
      const probe = values.probes?.[name];
      if (!probe?.enabled) return;
      const type = probe.type ?? "httpGet";
      if (type === "httpGet") {
        fields.push(["probes", name, "path"], ["probes", name, "port"]);
      } else if (type === "tcpSocket") {
        fields.push(["probes", name, "port"]);
      } else {
        fields.push(["probes", name, "command"]);
      }
    });

    return fields;
  };

  const routeToEarliestInvalidStep = (error: unknown): void => {
    const fields = (
      error &&
      typeof error === "object" &&
      "errorFields" in error &&
      Array.isArray((error as { errorFields?: unknown[] }).errorFields)
    )
      ? ((error as { errorFields: Array<{ name?: Array<string | number> }> }).errorFields)
      : [];

    const firstPath = fields.find((item) => Array.isArray(item?.name) && item.name.length > 0)?.name;
    if (!firstPath) return;
    const targetStep = mapFieldPathToStep(firstPath);
    setCurrentStep(targetStep);
    form.scrollToField(firstPath as never, { behavior: "smooth", block: "center" });
  };

  const handleStepChange = async (targetStep: number) => {
    if (targetStep < 0 || targetStep >= WORKSPACE_STEPS.length) return;
    if (targetStep !== WORKSPACE_STEPS.length - 1) {
      setCurrentStep(targetStep);
      return;
    }

    try {
      await form.validateFields(getPreviewRequiredFields());
      setCurrentStep(targetStep);
    } catch (error) {
      routeToEarliestInvalidStep(error);
    }
  };

  const nextStep = async () => {
    try {
      await validateStep(currentStep);
      setCurrentStep((prev) => Math.min(prev + 1, WORKSPACE_STEPS.length - 1));
    } catch {
      return;
    }
  };

  const prevStep = () => setCurrentStep((prev) => Math.max(prev - 1, 0));

  const applyWorkspaceIssues = (issues: WorkloadWorkspaceValidationIssue[]) => {
    if (!issues.length) return;

    const formIssues = issues.map((issue) => ({
      name: toNamePath(issue.fieldPath ?? issue.field),
      errors: [issue.message],
    }));
    form.setFields(formIssues as never);

    const first = issues[0];
    const step = first.step ?? first.section ?? "submit";
    setCurrentStep(STEP_INDEX[step] ?? STEP_INDEX.submit);
    form.scrollToField(toNamePath(first.fieldPath ?? first.field) as never, { behavior: "smooth", block: "center" });
  };

  const extractWorkspaceIssuesFromError = (
    error: unknown,
  ): WorkloadWorkspaceValidationIssue[] => {
    if (!(error instanceof ApiError)) {
      return [];
    }
    return mapApiErrorToWorkspaceIssues(error);
  };

  return (
    <Space orientation="vertical" size={16} style={{ width: "100%" }}>
      <Card>
        <Row justify="space-between" align="middle">
          <Col>
            <Typography.Title level={4} style={{ marginBottom: 4 }}>
              统一创建工作区
            </Typography.Title>
            <Typography.Text type="secondary">
              支持 Pod / Deployment / StatefulSet / ReplicaSet / DaemonSet，并提供镜像、存储、网络与初始化容器配置。
            </Typography.Text>
          </Col>
          <Col>
            <Button icon={<ArrowLeftOutlined />} onClick={handleGoBack}>
              返回
            </Button>
          </Col>
        </Row>
      </Card>

      {!isInitializing && !accessToken ? (
        <Alert type="warning" showIcon message="未检测到登录状态，请先登录后再创建资源。" />
      ) : null}

      <Card>
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            kind: initialKind,
            namespace: "default",
            replicas: 1,
            containerName: "main",
            mountPvc: false,
            createService: false,
            createIngress: false,
            networkMode: "ingress",
            service: { type: "ClusterIP", servicePort: 80, containerPort: 80 },
            ingress: { path: "/" },
            pvcMount: { useExistingPvc: true, storageSourceType: "PVC" },
            probes: {
              liveness: { enabled: false, type: "httpGet", scheme: "HTTP" },
              readiness: { enabled: false, type: "httpGet", scheme: "HTTP" },
              startup: { enabled: false, type: "httpGet", scheme: "HTTP" },
            },
            initContainers: [],
          }}
          onValuesChange={(changedValues) => {
            persistDraft();
            const changedPaths = flattenChangedValuePaths(changedValues);
            if (changedPaths.length === 0) return;
            form.setFields(
              changedPaths.map((name) => ({
                name,
                errors: [],
              })) as never,
            );
          }}
          onFinish={async () => {
            if (!accessToken) {
              message.warning("请先登录");
              return;
            }
            setSubmitting(true);
            try {
              const payload = form.getFieldsValue(true) as WorkspaceFormValues;
              const validation = await validateWorkloadWorkspace(payload, accessToken);
              if (!validation.valid) {
                const firstError = validation.errors[0];
                applyWorkspaceIssues(validation.errors);
                message.error(firstError?.message || "工作区校验失败");
                return;
              }
              await submitWorkloadWorkspace(payload, accessToken);
              message.success(payload.kind + " 创建成功");
              clearDraft();
              router.push(TARGET_ROUTE_MAP[payload.kind]);
            } catch (error) {
              const issues = extractWorkspaceIssuesFromError(error);
              if (issues.length > 0) {
                applyWorkspaceIssues(issues);
              }
              message.error(error instanceof Error ? error.message : "创建失败");
            } finally {
              setSubmitting(false);
            }
          }}
        >
          <Steps
            current={currentStep}
            items={WORKSPACE_STEPS.map((title) => ({ title }))}
            onChange={(targetStep) => void handleStepChange(targetStep)}
            style={{ marginBottom: 24 }}
          />

          {currentStep === 0 ? (
            <>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Form.Item name="clusterId" label="集群" rules={[{ required: true, message: "请选择集群" }]}>
                    <Select options={clusterOptions} loading={clustersQuery.isLoading} placeholder="选择集群" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="namespace" label="名称空间" rules={[{ required: true, message: "请输入名称空间" }]}>
                    <Input placeholder="default" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={8}>
                  <Form.Item name="kind" label="资源类型" rules={[{ required: true, message: "请选择资源类型" }]}>
                    <Select options={KIND_OPTIONS} />
                  </Form.Item>
                </Col>
              </Row>

              <Row gutter={[16, 16]}>
                <Col xs={24} md={12}>
                  <Form.Item name="name" label="名称" rules={[{ required: true, message: "请输入名称" }]}>
                    <Input placeholder="example-workload" />
                  </Form.Item>
                </Col>
                {supportsReplicas ? (
                  <Col xs={24} md={12}>
                    <Form.Item name="replicas" label="副本数" rules={[{ required: true, message: "请输入副本数" }]}>
                      <InputNumber min={1} precision={0} style={{ width: "100%" }} />
                    </Form.Item>
                  </Col>
                ) : null}
              </Row>
            </>
          ) : null}

          {currentStep === 1 ? (
            <>
              <Typography.Title level={5}>主容器</Typography.Title>
              <Row gutter={[16, 16]}>
                <Col xs={24} md={8}>
                  <Form.Item name="containerName" label="容器名称" rules={[{ required: true, message: "请输入容器名称" }]}>
                    <Input placeholder="main" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={16}>
                  <Form.Item name="image" label="镜像地址" rules={[{ required: true, message: "请输入镜像地址" }]}>
                    <Input placeholder="nginx:latest" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="command" label="命令（可选）">
                    <Input placeholder="sh -c" />
                  </Form.Item>
                </Col>
                <Col xs={24} md={12}>
                  <Form.Item name="args" label="参数（可选）">
                    <Input placeholder="echo hello" />
                  </Form.Item>
                </Col>
              </Row>
            </>
          ) : null}

          {currentStep === 2 ? (
            <>
              <Typography.Title level={5}>存储配置</Typography.Title>
              <Form.Item name="mountPvc" valuePropName="checked">
                <Switch checkedChildren="启用 PVC 挂载" unCheckedChildren="不挂载 PVC" />
              </Form.Item>

              {mountPvc ? (
                <Card size="small" style={{ background: "rgba(37,99,235,0.04)" }}>
                  <Form.Item name={["pvcMount", "useExistingPvc"]} valuePropName="checked">
                    <Switch checkedChildren="使用现有 PVC" unCheckedChildren="新建 PVC" />
                  </Form.Item>

                  {useExistingPvc ? (
                    <>
                      <Form.Item name={["pvcMount", "storageSourceType"]} label="资源类型">
                        <Select
                          options={[
                            { label: "PersistentVolumeClaim (PVC)", value: "PVC" },
                            { label: "PersistentVolume (PV)", value: "PV" },
                            { label: "StorageClass", value: "SC" },
                          ]}
                        />
                      </Form.Item>
                      <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                        {storageSourceType === "PVC"
                          ? (pvcQuery.isLoading ? "正在加载 PVC 列表..." : pvcScopeText)
                          : storageSourceType === "PV"
                            ? (pvQuery.isLoading ? "正在加载 PV 列表..." : pvcScopeText)
                            : (storageClassQuery.isLoading ? "正在加载 StorageClass 列表..." : pvcScopeText)}
                      </Typography.Text>
                      {storageQueryErrorMessage ? (
                        <Alert
                          type="error"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message={storageQueryErrorMessage}
                        />
                      ) : null}
                      {showPvcEmptyScopedState ? (
                        <Alert
                          type="info"
                          showIcon
                          style={{ marginBottom: 12 }}
                          message={
                            storageSourceType === "PVC"
                              ? `在 ${pvcScopeText.replace("当前作用域：", "")} 下未发现 PVC，可切换名称空间或改为新建 PVC。`
                              : storageSourceType === "PV"
                                ? `在 ${pvcScopeText.replace("当前作用域：", "")} 下未发现 PV。`
                                : `在 ${pvcScopeText.replace("当前作用域：", "")} 下未发现 StorageClass。`
                          }
                        />
                      ) : null}
                      {storageSourceType === "PVC" ? (
                        <Form.Item
                          name={["pvcMount", "existingPvcName"]}
                          label="选择 PVC"
                          rules={[{ required: true, message: "请选择 PVC" }]}
                        >
                          <Select
                            placeholder="选择已有 PVC"
                            options={pvcOptions}
                            loading={pvcQuery.isLoading}
                            showSearch
                            optionFilterProp="label"
                            notFoundContent={pvcQuery.isLoading ? "正在加载..." : `未找到 PVC（${pvcScopeText}）`}
                          />
                        </Form.Item>
                      ) : null}
                      {storageSourceType === "PV" ? (
                        <>
                          <Form.Item
                            name={["pvcMount", "existingPvName"]}
                            label="选择 PV"
                            rules={[{ required: true, message: "请选择 PV" }]}
                          >
                            <Select
                              placeholder="选择已有 PV"
                              options={pvOptions}
                              loading={pvQuery.isLoading}
                              showSearch
                              optionFilterProp="label"
                              notFoundContent={pvQuery.isLoading ? "正在加载..." : `未找到 PV（${pvcScopeText}）`}
                            />
                          </Form.Item>
                          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                            选择 PV 后会自动创建并绑定一个 PVC 再挂载到容器。
                          </Typography.Text>
                        </>
                      ) : null}
                      {storageSourceType === "SC" ? (
                        <>
                          <Form.Item
                            name={["pvcMount", "existingStorageClassName"]}
                            label="选择 StorageClass"
                            rules={[{ required: true, message: "请选择 StorageClass" }]}
                          >
                            <Select
                              placeholder="选择 StorageClass"
                              options={storageClassOptions}
                              loading={storageClassQuery.isLoading}
                              showSearch
                              optionFilterProp="label"
                              notFoundContent={storageClassQuery.isLoading ? "正在加载..." : `未找到 StorageClass（${pvcScopeText}）`}
                            />
                          </Form.Item>
                          <Typography.Text type="secondary" style={{ display: "block", marginBottom: 8 }}>
                            选择 StorageClass 后会自动创建 PVC 并挂载到容器。
                          </Typography.Text>
                        </>
                      ) : null}
                      {storageSourceType !== "PVC" ? (
                        <Row gutter={[12, 12]}>
                          <Col xs={24} md={12}>
                            <Form.Item name={["pvcMount", "newPvcName"]} label="自动创建 PVC 名称（可选）">
                              <Input placeholder="留空将自动生成" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={6}>
                            <Form.Item name={["pvcMount", "newPvcCapacity"]} label="容量（可选）">
                              <Input placeholder="5Gi" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={6}>
                            <Form.Item name={["pvcMount", "newPvcStorageClass"]} label="覆盖 StorageClass（可选）">
                              <Select allowClear placeholder="可选" options={storageClassOptions} />
                            </Form.Item>
                          </Col>
                        </Row>
                      ) : null}
                    </>
                  ) : (
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name={["pvcMount", "newPvcName"]}
                          label="新 PVC 名称"
                          rules={[{ required: true, message: "请输入 PVC 名称" }]}
                        >
                          <Input placeholder="my-pvc" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={["pvcMount", "newPvcCapacity"]} label="容量">
                          <Input placeholder="5Gi" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={["pvcMount", "newPvcStorageClass"]} label="StorageClass">
                          <Select allowClear placeholder="可选" options={storageClassOptions} />
                        </Form.Item>
                      </Col>
                    </Row>
                  )}

                  <Form.Item
                    name={["pvcMount", "mountPath"]}
                    label="挂载路径"
                    rules={[{ required: true, message: "请输入挂载路径" }]}
                  >
                    <Input placeholder="/data" />
                  </Form.Item>
                </Card>
              ) : null}
            </>
          ) : null}

          {currentStep === 3 ? (
            <>
              <Typography.Title level={5}>网络配置</Typography.Title>
              <Form.Item name="createService" valuePropName="checked">
                <Switch checkedChildren="同时创建 Service" unCheckedChildren="不创建 Service" />
              </Form.Item>

              {createService ? (
                <Card size="small" style={{ background: "rgba(37,99,235,0.04)", marginBottom: 12 }}>
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                      <Form.Item name={["service", "name"]} label="Service 名称" rules={[{ required: true, message: "请输入 Service 名称" }]}>
                        <Input placeholder="my-app-svc" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name={["service", "type"]} label="Service 类型">
                        <Select
                          options={[
                            { label: "ClusterIP", value: "ClusterIP" },
                            { label: "NodePort", value: "NodePort" },
                            { label: "LoadBalancer", value: "LoadBalancer" },
                          ]}
                        />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Form.Item name={["service", "containerPort"]} label="容器端口" rules={[{ required: true, message: "请输入容器端口" }]}>
                        <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Form.Item name={["service", "servicePort"]} label="Service 端口" rules={[{ required: true, message: "请输入 Service 端口" }]}>
                        <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                      </Form.Item>
                    </Col>
                  </Row>
                </Card>
              ) : null}

              <Form.Item name="createIngress" valuePropName="checked">
                <Switch checkedChildren="同时创建 Ingress" unCheckedChildren="不创建 Ingress" disabled={!createService} />
              </Form.Item>

              {createIngress ? (
                <Card size="small" style={{ background: "rgba(37,99,235,0.04)" }}>
                  <Form.Item name="networkMode" label="网络模式" rules={[{ required: true, message: "请选择网络模式" }]}>
                    <Select
                      options={[
                        { label: "Ingress", value: "ingress" },
                        { label: "IngressRoute (Traefik CRD)", value: "ingressroute" },
                      ]}
                    />
                  </Form.Item>
                  {networkMode === "ingressroute" ? (
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name={["ingressRoute", "name"]}
                          label="IngressRoute 名称"
                          rules={[{ required: true, message: "请输入 IngressRoute 名称" }]}
                        >
                          <Input placeholder="my-app-route" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item
                          name={["ingressRoute", "entryPoints"]}
                          label="EntryPoints"
                          rules={[{ required: true, message: "请输入 entryPoints" }]}
                        >
                          <Input placeholder="web,websecure" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={["ingressRoute", "tlsSecretName"]} label="TLS Secret（可选）">
                          <Input placeholder="my-tls-secret" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={12}>
                        <Form.Item
                          name={["ingressRoute", "match"]}
                          label="Match 表达式"
                          rules={[{ required: true, message: "请输入 Match 表达式" }]}
                        >
                          <Input placeholder="Host(`example.internal`) && PathPrefix(`/`)" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["ingressRoute", "serviceName"]} label="后端服务名（可选）">
                          <Input placeholder="默认使用上方 Service 名称" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["ingressRoute", "servicePort"]} label="后端服务端口（可选）">
                          <InputNumber min={1} max={65535} style={{ width: "100%" }} />
                        </Form.Item>
                      </Col>
                      <Col xs={24}>
                        <Form.Item name={["ingressRoute", "middlewares"]} label="Middlewares（可选）">
                          <Input placeholder="auth,ratelimit" />
                        </Form.Item>
                      </Col>
                    </Row>
                  ) : (
                  <Row gutter={[12, 12]}>
                    <Col xs={24} md={8}>
                      <Form.Item name={["ingress", "name"]} label="Ingress 名称" rules={[{ required: true, message: "请输入 Ingress 名称" }]}>
                        <Input placeholder="my-app-ingress" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={8}>
                      <Form.Item name={["ingress", "host"]} label="Host" rules={[{ required: true, message: "请输入访问域名" }]}>
                        <Input placeholder="example.internal" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Form.Item name={["ingress", "path"]} label="Path">
                        <Input placeholder="/" />
                      </Form.Item>
                    </Col>
                    <Col xs={24} md={4}>
                      <Form.Item name={["ingress", "ingressClassName"]} label="IngressClass">
                        <Input placeholder="nginx" />
                      </Form.Item>
                    </Col>
                  </Row>
                  )}
                </Card>
              ) : null}
            </>
          ) : null}

          {currentStep === 4 ? (
            <>
              <Typography.Title level={5}>初始化容器</Typography.Title>
              <Form.List name="initContainers">
                {(fields, { add, remove }) => (
                  <Space orientation="vertical" size={12} style={{ width: "100%" }}>
                    {fields.map((field, index) => (
                      <Card key={field.key} size="small">
                        <Row gutter={[12, 12]}>
                          <Col xs={24} md={6}>
                            <Form.Item
                              name={[field.name, "name"]}
                              label={`容器名 #${index + 1}`}
                              rules={[{ required: true, message: "请输入初始化容器名称" }]}
                            >
                              <Input placeholder="init-setup" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={10}>
                            <Form.Item
                              name={[field.name, "image"]}
                              label="镜像"
                              rules={[{ required: true, message: "请输入初始化容器镜像" }]}
                            >
                              <Input placeholder="busybox:1.36" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={4}>
                            <Form.Item name={[field.name, "command"]} label="命令">
                              <Input placeholder="sh -c" />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={4}>
                            <Form.Item name={[field.name, "args"]} label="参数">
                              <Input placeholder="echo init" />
                            </Form.Item>
                          </Col>
                        </Row>
                        <Button danger onClick={() => remove(field.name)}>
                          删除初始化容器
                        </Button>
                      </Card>
                    ))}
                    <Button icon={<PlusOutlined />} onClick={() => add({})}>
                      添加初始化容器
                    </Button>
                  </Space>
                )}
              </Form.List>
            </>
          ) : null}

          {currentStep === 5 ? (
            <>
              <Typography.Title level={5}>高级选项</Typography.Title>
              <Card size="small" style={{ background: "rgba(37,99,235,0.04)", marginBottom: 12 }}>
                <Typography.Title level={5} style={{ marginTop: 0 }}>
                  调度策略
                </Typography.Title>
                <Row gutter={[12, 12]}>
                  <Col xs={24}>
                    <Form.Item
                      name={["scheduling", "nodeSelector"]}
                      label="Node Selector（每行 key=value）"
                      rules={[{ validator: (_, value) => validateNodeSelectorInput(value) }]}
                    >
                      <Input.TextArea rows={3} placeholder={"disktype=ssd\nzone=cn-shanghai-a"} />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name={["scheduling", "tolerations"]}
                      label="Tolerations（JSON 数组）"
                      rules={[{ validator: (_, value) => validateJsonArrayInput(value) }]}
                    >
                      <Input.TextArea
                        rows={6}
                        placeholder={'[{"key":"dedicated","operator":"Equal","value":"aiops","effect":"NoSchedule"}]'}
                      />
                    </Form.Item>
                  </Col>
                  <Col xs={24} md={12}>
                    <Form.Item
                      name={["scheduling", "affinity"]}
                      label="Affinity（JSON 对象）"
                      rules={[{ validator: (_, value) => validateJsonObjectInput(value) }]}
                    >
                      <Input.TextArea
                        rows={6}
                        placeholder={'{"nodeAffinity":{"requiredDuringSchedulingIgnoredDuringExecution":{"nodeSelectorTerms":[{"matchExpressions":[{"key":"kubernetes.io/arch","operator":"In","values":["amd64"]}]}]}}}'}
                      />
                    </Form.Item>
                  </Col>
                </Row>
              </Card>

              {(["liveness", "readiness", "startup"] as const).map((probeName) => {
                const probeLabelMap = {
                  liveness: "Liveness Probe",
                  readiness: "Readiness Probe",
                  startup: "Startup Probe",
                } as const;
                const currentProbe = previewValues?.probes?.[probeName];
                const probeType = currentProbe?.type ?? "httpGet";
                const enabled = currentProbe?.enabled ?? false;
                return (
                  <Card key={probeName} size="small" style={{ background: "rgba(37,99,235,0.04)", marginBottom: 12 }}>
                    <Row gutter={[12, 12]} align="middle">
                      <Col xs={24} md={8}>
                        <Typography.Title level={5} style={{ margin: 0 }}>{probeLabelMap[probeName]}</Typography.Title>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={["probes", probeName, "enabled"]} valuePropName="checked" style={{ marginBottom: 0 }}>
                          <Switch checkedChildren="启用" unCheckedChildren="关闭" />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={8}>
                        <Form.Item name={["probes", probeName, "type"]} label="探针类型" style={{ marginBottom: 0 }}>
                          <Select
                            options={[
                              { label: "HTTP GET", value: "httpGet" },
                              { label: "TCP Socket", value: "tcpSocket" },
                              { label: "Exec", value: "exec" },
                            ]}
                            disabled={!enabled}
                          />
                        </Form.Item>
                      </Col>
                    </Row>
                    <Row gutter={[12, 12]} style={{ marginTop: 8 }}>
                      {probeType === "httpGet" ? (
                        <>
                          <Col xs={24} md={8}>
                            <Form.Item
                              name={["probes", probeName, "path"]}
                              label="Path"
                              rules={enabled ? [{ validator: (_, value) => validateProbeHttpPathInput(value) }] : undefined}
                            >
                              <Input placeholder="/healthz" disabled={!enabled} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item
                              name={["probes", probeName, "port"]}
                              label="Port"
                              rules={[{ required: enabled, message: "请输入端口" }]}
                            >
                              <InputNumber min={1} max={65535} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                            </Form.Item>
                          </Col>
                          <Col xs={24} md={8}>
                            <Form.Item name={["probes", probeName, "scheme"]} label="Scheme">
                              <Select
                                options={[
                                  { label: "HTTP", value: "HTTP" },
                                  { label: "HTTPS", value: "HTTPS" },
                                ]}
                                disabled={!enabled}
                              />
                            </Form.Item>
                          </Col>
                        </>
                      ) : null}
                      {probeType === "tcpSocket" ? (
                        <Col xs={24} md={8}>
                          <Form.Item
                            name={["probes", probeName, "port"]}
                            label="Port"
                            rules={[{ required: enabled, message: "请输入端口" }]}
                          >
                            <InputNumber min={1} max={65535} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                          </Form.Item>
                        </Col>
                      ) : null}
                      {probeType === "exec" ? (
                        <Col xs={24}>
                          <Form.Item
                            name={["probes", probeName, "command"]}
                            label="Command"
                            rules={enabled ? [{ validator: (_, value) => validateProbeCommandInput(value) }] : undefined}
                          >
                            <Input placeholder="sh -c cat /tmp/healthy" disabled={!enabled} />
                          </Form.Item>
                        </Col>
                      ) : null}
                    </Row>
                    <Row gutter={[12, 12]}>
                      <Col xs={24} md={6}>
                        <Form.Item name={["probes", probeName, "initialDelaySeconds"]} label="Initial Delay(s)">
                          <InputNumber min={0} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["probes", probeName, "periodSeconds"]} label="Period(s)">
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["probes", probeName, "timeoutSeconds"]} label="Timeout(s)">
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["probes", probeName, "failureThreshold"]} label="Failure Threshold">
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                        </Form.Item>
                      </Col>
                      <Col xs={24} md={6}>
                        <Form.Item name={["probes", probeName, "successThreshold"]} label="Success Threshold">
                          <InputNumber min={1} precision={0} style={{ width: "100%" }} disabled={!enabled} />
                        </Form.Item>
                      </Col>
                    </Row>
                  </Card>
                );
              })}
            </>
          ) : null}

          {currentStep === 6 ? (
            <Card size="small" style={{ background: "rgba(37,99,235,0.04)" }}>
              <Typography.Title level={5}>预览提交</Typography.Title>
              <Typography.Paragraph>
                资源类型：{previewYamlQuery.data?.summary.kind || previewValues?.kind || initialKind}
                <br />
                名称：{previewYamlQuery.data?.summary.name || previewValues?.name || "-"}
                <br />
                名称空间：{previewYamlQuery.data?.summary.namespace || previewValues?.namespace || "-"}
                <br />
                集群：{previewYamlQuery.data?.summary.clusterId || previewValues?.clusterId || "-"}
              </Typography.Paragraph>
              <Typography.Paragraph>
                主容器镜像：{previewYamlQuery.data?.summary.image || previewValues?.image || "-"}
                <br />
                PVC 挂载：{previewYamlQuery.data?.summary.createPvc ? "新建" : (previewValues?.mountPvc ? "已启用" : "否")}
                <br />
                创建 Service：{previewYamlQuery.data?.summary.createService ? "是" : "否"}
                <br />
                创建 Ingress：{previewYamlQuery.data?.summary.createIngress ? "是" : "否"}
                <br />
                网络模式：{createIngress ? (networkMode === "ingressroute" ? "IngressRoute" : "Ingress") : "-"}
                <br />
                调度策略：
                {previewValues?.scheduling?.nodeSelector?.trim() ||
                previewValues?.scheduling?.tolerations?.trim() ||
                previewValues?.scheduling?.affinity?.trim()
                  ? "已配置"
                  : "默认"}
                <br />
                探针配置：
                {(previewValues?.probes?.liveness?.enabled ||
                  previewValues?.probes?.readiness?.enabled ||
                  previewValues?.probes?.startup?.enabled)
                  ? "已配置"
                  : "默认"}
                <br />
                初始化容器数量：{previewValues?.initContainers?.filter((item) => item.name?.trim() && item.image?.trim()).length ?? 0}
              </Typography.Paragraph>
              {previewYamlQuery.isLoading ? (
                <Typography.Text type="secondary">正在渲染 YAML 预览...</Typography.Text>
              ) : null}
              {previewYamlQuery.isError ? (
                <Alert
                  type="error"
                  showIcon
                  message={previewYamlQuery.error instanceof Error ? previewYamlQuery.error.message : "YAML 预览生成失败"}
                  style={{ marginBottom: 12 }}
                />
              ) : null}
              <Typography.Text code style={{ whiteSpace: "pre-wrap", display: "block" }}>
                {previewYamlQuery.data?.yaml || JSON.stringify(previewSpec ?? {}, null, 2)}
              </Typography.Text>
            </Card>
          ) : null}

          <Space style={{ marginTop: 20 }}>
            <Button onClick={prevStep} disabled={currentStep === 0}>
              上一步
            </Button>
            {currentStep < WORKSPACE_STEPS.length - 1 ? (
              <Button type="primary" onClick={() => void nextStep()}>
                下一步
              </Button>
            ) : (
              <Button type="primary" htmlType="submit" loading={submitting}>
                创建资源
              </Button>
            )}
          </Space>
        </Form>
      </Card>
    </Space>
  );
}
