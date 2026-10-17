import { getManifestValue, setManifestValue, type ResourceManifest } from "@/lib/resource-editor";

export type WorkloadPath = (string | number)[];
export type WorkloadObject = Record<string, unknown>;

export function workloadObject(value: unknown): WorkloadObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as WorkloadObject : {};
}

export function workloadList(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

export function workloadPodPath(kind: string): WorkloadPath {
  return kind === "Pod" ? ["spec"] : kind === "CronJob"
    ? ["spec", "jobTemplate", "spec", "template", "spec"]
    : ["spec", "template", "spec"];
}

export function workloadLockReason(kind: string, mode: "create" | "edit", path: WorkloadPath): string | undefined {
  if (mode !== "edit") return;
  if (["apiVersion", "kind"].includes(String(path[0])) || (path[0] === "metadata" &&
    ["name", "namespace", "resourceVersion"].includes(String(path[1])))) return "资源身份在编辑时不可变。";
  if (path[0] !== "spec") return;
  if (kind === "Pod") {
    if (path.length === 4 && ["containers", "initContainers"].includes(String(path[1])) &&
      typeof path[2] === "number" && path[3] === "image") return;
    if (path.length === 2 && path[1] === "activeDeadlineSeconds") return;
    return "已有 Pod 的此字段不可直接修改；镜像可编辑，其余配置请重建 Pod。";
  }
  if (["Deployment", "DaemonSet", "StatefulSet", "ReplicaSet"].includes(kind) && path[1] === "selector") {
    return "编辑时锁定选择器，避免更改已有工作负载的 Pod 归属。";
  }
  if (kind === "Job" && ["template", "selector", "manualSelector", "completionMode", "completions"].includes(String(path[1]))) {
    return "已有 Job 的模板、选择器及完成模式在本表单中锁定；条件式更新请使用 YAML 并通过服务端校验。";
  }
  if (kind === "StatefulSet" && ["serviceName", "podManagementPolicy", "volumeClaimTemplates"].includes(String(path[1]))) {
    return "StatefulSet 创建后不能修改服务名、Pod 管理策略或卷声明模板。";
  }
}

/** One mutable cursor per render: rapid handlers compose, one user action emits once. */
export function createWorkloadEditor(value: ResourceManifest, onChange: (value: ResourceManifest) => void, mode: "create" | "edit", disabled = false) {
  let current = value;
  const reason = (path: WorkloadPath) => disabled ? "当前只读或正在提交。" : workloadLockReason(value.kind, mode, path);
  const read = (path: WorkloadPath) => getManifestValue(current, path);
  const write = (path: WorkloadPath, next: unknown) => {
    if (reason(path)) return;
    current = setManifestValue(current, path, next);
    onChange(current);
  };
  return { read, write, reason, update: (path: WorkloadPath, change: (old: unknown) => unknown) => {
    if (!reason(path)) write(path, change(read(path)));
  } };
}
export type WorkloadEditor = ReturnType<typeof createWorkloadEditor>;

export function renameWorkloadKey(value: unknown, oldKey: string, newKey: string): WorkloadObject {
  const old = workloadObject(value);
  if (!newKey || ["__proto__", "prototype", "constructor"].includes(newKey)) throw new Error("请输入安全且非空的键名。");
  if (oldKey !== newKey && Object.hasOwn(old, newKey)) throw new Error("键名已存在。");
  return Object.fromEntries(Object.entries(old).map(([key, child]) => [key === oldKey ? newKey : key, child]));
}

export function switchToleration(value: unknown, operator: string): WorkloadObject {
  const next = { ...workloadObject(value), operator } as WorkloadObject;
  if (operator === "Exists") delete next.value;
  return next;
}

export function switchSeccomp(value: unknown, type: string): WorkloadObject | undefined {
  if (!type) return undefined;
  const next = { ...workloadObject(value), type } as WorkloadObject;
  if (type !== "Localhost") delete next.localhostProfile;
  return next;
}

export function moveWorkloadItem(value: unknown, index: number, delta: number): unknown[] {
  const list = [...workloadList(value)];
  const target = index + delta;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  [list[index], list[target]] = [list[target], list[index]];
  return list;
}

export function copyWorkloadContainer(value: unknown, index: number): unknown[] {
  const list = workloadList(value);
  if (index < 0 || index >= list.length) return list;
  const copy = structuredClone(workloadObject(list[index]));
  const names = new Set(list.map(item => workloadObject(item).name));
  let name = `${String(copy.name || "container")}-copy`;
  while (names.has(name)) name += "-copy";
  copy.name = name;
  return [...list, copy];
}

function switchMember(value: unknown, members: readonly string[], member: string, fallback: WorkloadObject): WorkloadObject {
  const old = workloadObject(value);
  const next = { ...old };
  for (const key of members) delete next[key];
  if (member) next[member] = old[member] ?? fallback;
  return next;
}

export const ENV_SOURCES = ["secretKeyRef", "configMapKeyRef", "fieldRef", "resourceFieldRef"] as const;
export function switchEnvSource(value: unknown, source: string): WorkloadObject {
  const next = { ...workloadObject(value) };
  if (source === "value") {
    delete next.valueFrom;
    next.value = typeof next.value === "string" ? next.value : "";
  } else {
    delete next.value;
    const fallback = source === "fieldRef" ? { fieldPath: "metadata.name" }
      : source === "resourceFieldRef" ? { resource: "limits.cpu" } : { name: "", key: "" };
    next.valueFrom = switchMember(next.valueFrom, ENV_SOURCES, source, fallback);
  }
  return next;
}
export function switchEnvFrom(value: unknown, source: string): WorkloadObject {
  return switchMember(value, ["configMapRef", "secretRef"], source, { name: "" });
}

export const ACTION_TYPES = ["httpGet", "tcpSocket", "exec", "grpc", "sleep"] as const;
export function switchAction(value: unknown, type: string): WorkloadObject | undefined {
  if (!type) return undefined;
  const fallback = type === "exec" ? { command: ["sh", "-c", "true"] }
    : type === "httpGet" ? { path: "/", port: 80, scheme: "HTTP" }
      : type === "sleep" ? { seconds: 1 } : { port: 80 };
  return switchMember(value, ACTION_TYPES, type, fallback);
}

// Remove Kubernetes union members only; never discard unrelated extension fields.
export const VOLUME_TYPES = [
  "emptyDir", "configMap", "secret", "persistentVolumeClaim", "hostPath", "nfs",
  "projected", "downwardAPI", "csi", "ephemeral", "image", "awsElasticBlockStore",
  "azureDisk", "azureFile", "cephfs", "cinder", "fc", "flexVolume", "flocker",
  "gcePersistentDisk", "gitRepo", "glusterfs", "iscsi", "photonPersistentDisk",
  "portworxVolume", "quobyte", "rbd", "scaleIO", "storageos", "vsphereVolume",
] as const;
export function switchVolume(value: unknown, type: string): WorkloadObject {
  const fallback: WorkloadObject = type === "configMap" ? { name: "" }
    : type === "secret" ? { secretName: "" }
      : type === "persistentVolumeClaim" ? { claimName: "" }
        : type === "hostPath" ? { path: "" }
          : type === "nfs" ? { server: "", path: "/" } : {};
  return switchMember(value, VOLUME_TYPES, type, fallback);
}

export function parseWorkloadPort(raw: string): number | string | undefined {
  const value = raw.trim();
  if (!value) return undefined;
  return /^\d+$/.test(value) ? Number(value) : value;
}

export function parseAdvancedWorkloadObject(raw: string): WorkloadObject | undefined {
  if (!raw.trim()) return undefined;
  if (raw.length > 200_000) throw new Error("配置超过 200KB，请使用 YAML 编辑器。");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("请输入 JSON 对象。");
  function check(value: unknown, depth: number) {
    if (depth > 40) throw new Error("配置嵌套过深。");
    if (value && typeof value === "object") for (const [key, child] of Object.entries(value)) {
      if (["__proto__", "prototype", "constructor"].includes(key)) throw new Error("配置包含不安全字段。");
      check(child, depth + 1);
    }
  }
  check(parsed, 0);
  return parsed as WorkloadObject;
}
