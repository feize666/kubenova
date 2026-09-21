import { CONTROL_API_BASE, apiRequest } from "./client";

export type NativeKubeconfigClusterList = { items: Array<{ id: string; name: string }> };

export type NativeAccessSettings = {
  clusterId: string;
  enabled: boolean;
  issuer: string;
  audience: string;
  jwksUri: string;
  gatewayUrl: string;
  revision: number;
  syncState?: "pending" | "ready" | "failed";
  syncRevision?: number | null;
  syncMessage?: string | null;
  syncedAt?: string | null;
};

export type NativeAccessSettingsInput = Pick<
  NativeAccessSettings,
  "enabled" | "issuer" | "audience" | "jwksUri" | "gatewayUrl" | "revision"
>;

export function listNativeKubeconfigClusters(token: string) {
  return apiRequest<NativeKubeconfigClusterList>("/api/users/native-access", { token });
}

export function getNativeAccessSettings(clusterId: string, token: string) {
  return apiRequest<NativeAccessSettings>(`/api/users/native-access/${encodeURIComponent(clusterId)}`, { token });
}

export function saveNativeAccessSettings(clusterId: string, settings: NativeAccessSettingsInput, token: string) {
  return apiRequest<NativeAccessSettings, NativeAccessSettingsInput>(`/api/users/native-access/${encodeURIComponent(clusterId)}`, {
    method: "PUT", body: settings, token,
  });
}

export function reconcileNativeAccess(clusterId: string, token: string) {
  return apiRequest<NativeAccessSettings>(`/api/users/native-access/${encodeURIComponent(clusterId)}/reconcile`, {
    method: "POST", token,
  });
}

function apiUrl(path: string) {
  const base = CONTROL_API_BASE.trim().replace(/\/+$/, "");
  return /^https?:\/\//i.test(base) ? `${base}${path}` : path;
}

export async function downloadNativeKubeconfig(clusterId: string, token: string) {
  const response = await fetch(apiUrl(`/api/users/native-access/${encodeURIComponent(clusterId)}/kubeconfig`), {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  if (!response.ok) throw new Error(`下载 kubeconfig 失败（${response.status}）`);
  const match = response.headers.get("content-disposition")?.match(/filename\*=UTF-8''([^;]+)/i);
  return { blob: await response.blob(), filename: match ? decodeURIComponent(match[1]) : `${clusterId}-kubectl.kubeconfig` };
}
