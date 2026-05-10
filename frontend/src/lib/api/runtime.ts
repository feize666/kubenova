import { apiRequest } from "./client";
import { sanitizeInternalReturnTo } from "@/lib/login-return";

export type RuntimeSessionType = "terminal" | "logs";

export interface RuntimeTargetBase {
  clusterId: string;
  namespace: string;
  pod: string;
  container?: string;
  containerNames?: string[];
}

export type CreateRuntimeSessionRequest = {
  type: RuntimeSessionType;
} & RuntimeTargetBase & {
  keyword?: string;
  [key: string]: unknown;
};

export type CreateRuntimeSessionResponse = {
  sessionId?: string;
  gatewayWsUrl: string;
  expiresAt?: string;
  reconnectable?: boolean;
  sessionState?: "ready" | "expired" | "closed";
  target?: {
    clusterId: string;
    namespace: string;
    pod: string;
    container: string;
    availableContainers: string[];
    podPhase?: string;
  };
};

export function resolveRuntimeContainer(container?: string, containerNames?: string[]): string {
  const normalized = typeof container === "string" ? container.trim() : "";
  if (normalized) {
    return normalized;
  }
  if (Array.isArray(containerNames)) {
    const first = containerNames.find((item) => typeof item === "string" && item.trim().length > 0);
    if (first) {
      return first.trim();
    }
  }
  return "main";
}

export function buildRuntimeTargetParams(target: RuntimeTargetBase): URLSearchParams {
  const params = new URLSearchParams({
    clusterId: target.clusterId,
    namespace: target.namespace,
    pod: target.pod,
    container: resolveRuntimeContainer(target.container, target.containerNames),
  });
  return params;
}

export function resolveSafeRuntimeReturnTo(value?: string | null): string {
  const target = sanitizeInternalReturnTo(value);
  if (!target) {
    return "";
  }
  if (target.startsWith("/terminal")) {
    return "";
  }
  if (target.startsWith("/logs")) {
    return "";
  }
  if (target.startsWith("/login")) {
    return "";
  }
  return target;
}

export async function createRuntimeSession(
  payload: CreateRuntimeSessionRequest,
  token: string,
): Promise<CreateRuntimeSessionResponse> {
  const body: CreateRuntimeSessionRequest = {
    ...payload,
    container: resolveRuntimeContainer(payload.container, payload.containerNames),
  };
  const result = await apiRequest<CreateRuntimeSessionResponse, CreateRuntimeSessionRequest>("/api/runtime/sessions", {
    method: "POST",
    body,
    token,
  });

  if (!result?.gatewayWsUrl || typeof result.gatewayWsUrl !== "string") {
    throw new Error("运行时会话创建成功，但未返回可用的 WebSocket 地址");
  }

  return result;
}
