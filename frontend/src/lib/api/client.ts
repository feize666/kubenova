import type { ApiRequestOptions, QueryParams } from "./types";
import { buildListQuery, withQuery } from "./query";

// 浏览器端默认走同源 /api。仅当配置了绝对 URL 时，才使用外部基址。
export const CONTROL_API_BASE = process.env.NEXT_PUBLIC_CONTROL_API_BASE ?? "";
export const AUTH_EXPIRED_EVENT = "aiops:auth-expired";
export const AUTH_EXPIRED_MESSAGE = "访问令牌无效或已过期，请重新登录";
const AUTH_EXPIRED_CODES = new Set([
  "AUTH_EXPIRED",
  "TOKEN_EXPIRED",
  "ACCESS_TOKEN_EXPIRED",
  "REFRESH_TOKEN_EXPIRED",
  "UNAUTHORIZED",
  "INVALID_TOKEN",
]);

interface ApiErrorLike {
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
  error?: unknown;
}

export interface ApiEnvelope<TData = unknown> {
  data: TData;
  code?: string;
  message?: string;
  details?: unknown;
  requestId?: string;
}

export interface ApiErrorInfo {
  message: string;
  code?: string;
  details?: unknown;
  requestId?: string;
}

type AuthExpiredDetail = {
  message: string;
  requestId?: string;
  code?: string;
};

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: unknown;
  readonly requestId?: string;

  constructor(message: string, status: number, code?: string, details?: unknown, requestId?: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

let authExpiredBroadcasted = false;
let authExpiryController = new AbortController();

export function resetAuthExpiryState() {
  authExpiredBroadcasted = false;
  authExpiryController = new AbortController();
}

function mergeSignals(signals: Array<AbortSignal | undefined>): AbortSignal | undefined {
  const activeSignals = signals.filter((signal): signal is AbortSignal => Boolean(signal));
  if (activeSignals.length === 0) {
    return undefined;
  }
  if (activeSignals.length === 1) {
    return activeSignals[0];
  }

  const controller = new AbortController();
  const abort = () => controller.abort();
  for (const signal of activeSignals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", abort, { once: true });
  }
  return controller.signal;
}

function broadcastAuthExpired(detail: AuthExpiredDetail) {
  if (authExpiredBroadcasted) {
    return;
  }

  authExpiredBroadcasted = true;
  authExpiryController.abort();

  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<AuthExpiredDetail>(AUTH_EXPIRED_EVENT, {
      detail,
    }),
  );
}

function normalizePath(path: string): string {
  if (path.startsWith("http://") || path.startsWith("https://")) {
    return path;
  }

  const configuredBase = CONTROL_API_BASE.trim().replace(/\/+$/, "");
  if (!configuredBase || !/^https?:\/\//i.test(configuredBase)) {
    return path;
  }

  // In browser, prefer same-origin /api when the configured control-api base is loopback.
  // This lets Next rewrites preserve the page host for runtime session URL generation.
  if (typeof window !== "undefined") {
    try {
      const parsed = new URL(configuredBase);
      const hostname = parsed.hostname.toLowerCase();
      if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
        return path;
      }
    } catch {
      return path;
    }
  }

  return `${configuredBase}${path.startsWith("/") ? "" : "/"}${path}`;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMessage(input: unknown): string | undefined {
  if (typeof input === "string") {
    return input;
  }

  if (Array.isArray(input)) {
    const messages = input.filter((item): item is string => typeof item === "string");
    if (messages.length > 0) {
      return messages.join("; ");
    }
  }

  return undefined;
}

export function isApiEnvelope(payload: unknown): payload is ApiEnvelope {
  return isObject(payload) && Object.prototype.hasOwnProperty.call(payload, "data");
}

export function extractApiError(payload: unknown, status?: number): ApiErrorInfo {
  const fallback = status ? `Request failed with status ${status}` : "Request failed";

  if (!isObject(payload)) {
    return { message: fallback };
  }

  const direct = payload as ApiErrorLike;
  const nested = isObject(direct.error) ? (direct.error as ApiErrorLike) : undefined;

  const message =
    readMessage(direct.message) ?? readMessage(nested?.message) ?? readMessage((payload as { error?: unknown }).error) ?? fallback;

  return {
    message,
    code: direct.code ?? nested?.code,
    details: direct.details ?? nested?.details,
    requestId: direct.requestId ?? nested?.requestId,
  };
}

function compactSnippet(text: string): string {
  const compact = text.replace(/\s+/g, " ").trim();
  if (!compact) return "";
  return compact.length > 240 ? `${compact.slice(0, 240)}...` : compact;
}

async function safeParseJson(response: Response): Promise<{
  payload: unknown;
  textPreview?: string;
  contentType: string;
}> {
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.includes("application/json")) {
    const text = await response.text().catch(() => "");
    return {
      payload: null,
      textPreview: compactSnippet(text),
      contentType: contentType || "unknown",
    };
  }

  try {
    return {
      payload: await response.json(),
      contentType,
    };
  } catch {
    const text = await response.text().catch(() => "");
    return {
      payload: null,
      textPreview: compactSnippet(text),
      contentType,
    };
  }
}

function unwrapApiResponse<TResponse>(payload: unknown): TResponse {
  if (isApiEnvelope(payload)) {
    return payload.data as TResponse;
  }
  return payload as TResponse;
}

export async function apiRequest<TResponse, TBody = unknown>(
  path: string,
  options: ApiRequestOptions<TBody> = {},
): Promise<TResponse> {
  const { method = "GET", token, query, body, headers, signal, suppressAuthExpiryBroadcast } = options;

  const requestHeaders = new Headers(headers);

  if (token) {
    requestHeaders.set("Authorization", `Bearer ${token}`);
  }

  const hasJsonBody = body !== undefined && !(body instanceof FormData);
  if (hasJsonBody && !requestHeaders.has("Content-Type")) {
    requestHeaders.set("Content-Type", "application/json");
  }

  const url = normalizePath(withQuery(path, query));

  const response = await fetch(url, {
    method,
    headers: requestHeaders,
    body: body === undefined ? undefined : body instanceof FormData ? body : JSON.stringify(body),
    signal: mergeSignals([signal, authExpiryController.signal]),
  });

  const parsed = await safeParseJson(response);

  if (!response.ok) {
    const errorInfo = extractApiError(parsed.payload, response.status);
    const detail =
      errorInfo.message.startsWith("Request failed") && parsed.textPreview
        ? `${errorInfo.message}. Response(${parsed.contentType}): ${parsed.textPreview}`
        : errorInfo.message;
    if (
      response.status === 401 &&
      !suppressAuthExpiryBroadcast &&
      AUTH_EXPIRED_CODES.has(String(errorInfo.code || "").trim().toUpperCase())
    ) {
      broadcastAuthExpired({
        message: AUTH_EXPIRED_MESSAGE,
        code: errorInfo.code,
        requestId: errorInfo.requestId,
      });
    }
    throw new ApiError(detail, response.status, errorInfo.code, errorInfo.details, errorInfo.requestId);
  }

  return unwrapApiResponse<TResponse>(parsed.payload);
}

export { buildListQuery };
export type { QueryParams };
