export type KubejojoLegacyRelationRole =
  | "owner"
  | "network"
  | "storage"
  | "config"
  | "policy"
  | "gateway"
  | "scope";

export type KubejojoRelationType =
  | "OWNS"
  | "SELECTS"
  | "PUBLISHES"
  | "RESOLVES"
  | "ROUTES_TO"
  | "GOVERNS"
  | "PROVISIONS"
  | "ACCEPTS"
  | "MOUNTS"
  | "BINDS"
  | "USES_STORAGE_CLASS"
  | "USES_CONFIG"
  | "USES_SECRET"
  | "USES_SERVICE_ACCOUNT"
  | "GROUPS";

export type KubejojoRelationDomain = "workload" | "network" | "storage" | "configuration" | "scope";

export interface KubejojoRelationSemantics {
  type: KubejojoRelationType;
  domain: KubejojoRelationDomain;
  label: string;
  stroke: string;
  dashed: boolean;
}

const SEMANTICS: Record<KubejojoRelationType, Omit<KubejojoRelationSemantics, "type">> = {
  OWNS: { domain: "workload", label: "拥有", stroke: "#475569", dashed: false },
  SELECTS: { domain: "network", label: "选择", stroke: "#2563eb", dashed: false },
  PUBLISHES: { domain: "network", label: "发布端点", stroke: "#0284c7", dashed: false },
  RESOLVES: { domain: "network", label: "解析后端", stroke: "#0369a1", dashed: false },
  ROUTES_TO: { domain: "network", label: "路由至", stroke: "#0891b2", dashed: false },
  GOVERNS: { domain: "network", label: "策略约束", stroke: "#7c3aed", dashed: true },
  PROVISIONS: { domain: "network", label: "供应网关", stroke: "#0e7490", dashed: true },
  ACCEPTS: { domain: "network", label: "接纳路由", stroke: "#155e75", dashed: false },
  MOUNTS: { domain: "storage", label: "挂载", stroke: "#059669", dashed: false },
  BINDS: { domain: "storage", label: "绑定", stroke: "#047857", dashed: false },
  USES_STORAGE_CLASS: { domain: "storage", label: "使用存储类", stroke: "#0f766e", dashed: true },
  USES_CONFIG: { domain: "configuration", label: "使用配置", stroke: "#d97706", dashed: true },
  USES_SECRET: { domain: "configuration", label: "使用密钥", stroke: "#dc2626", dashed: true },
  USES_SERVICE_ACCOUNT: { domain: "configuration", label: "使用服务账号", stroke: "#9333ea", dashed: true },
  GROUPS: { domain: "scope", label: "分组", stroke: "#94a3b8", dashed: true },
};

export function inferKubejojoRelationType(
  role: KubejojoLegacyRelationRole | undefined,
  label = "",
): KubejojoRelationType {
  const normalized = label.toLowerCase();
  if (role === "owner") return "OWNS";
  if (role === "storage") {
    if (normalized.includes("storageclass") || normalized.includes("class")) return "USES_STORAGE_CLASS";
    if (normalized.includes("bind")) return "BINDS";
    return "MOUNTS";
  }
  if (role === "config") {
    if (normalized.includes("secret")) return "USES_SECRET";
    if (normalized.includes("serviceaccount")) return "USES_SERVICE_ACCOUNT";
    return "USES_CONFIG";
  }
  if (role === "policy") return "GOVERNS";
  if (role === "gateway") {
    if (normalized.includes("provision")) return "PROVISIONS";
    if (normalized.includes("accept")) return "ACCEPTS";
    return "ROUTES_TO";
  }
  if (normalized.includes("publish")) return "PUBLISHES";
  if (normalized.includes("resolve") || normalized.includes("endpoint")) return "RESOLVES";
  if (normalized.includes("ingress") || normalized.includes("route")) return "ROUTES_TO";
  if (role === "scope") return "GROUPS";
  return "SELECTS";
}

export function getKubejojoRelationSemantics(
  type: KubejojoRelationType | undefined,
  role?: KubejojoLegacyRelationRole,
  label?: string,
): KubejojoRelationSemantics {
  const resolved = type ?? inferKubejojoRelationType(role, label);
  return { type: resolved, ...SEMANTICS[resolved] };
}

export interface KubejojoStableIdentity {
  clusterId: string;
  uid?: string | null;
  apiVersion?: string | null;
  kind: string;
  namespace?: string | null;
  name: string;
}

export function makeKubejojoStableId(identity: KubejojoStableIdentity): string {
  if (identity.uid?.trim()) return `${identity.clusterId}:uid:${identity.uid.trim()}`;
  return [
    identity.clusterId,
    identity.apiVersion?.trim() || "core/v1",
    identity.kind,
    identity.namespace?.trim() || "_cluster",
    identity.name,
  ].map(encodeURIComponent).join(":");
}

export function makeKubejojoRelationId(
  type: KubejojoRelationType,
  source: string,
  target: string,
): string {
  return `${type}:${source}->${target}`;
}
