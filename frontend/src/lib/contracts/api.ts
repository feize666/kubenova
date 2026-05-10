import type { PaginationMeta, ResourceState } from "./common";

export type ApiErrorCode =
  | "VALIDATION_ERROR"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "DEPENDENCY_CONFLICT"
  | "PRECONDITION_FAILED"
  | "RATE_LIMITED"
  | "INTERNAL_ERROR"
  | "SERVICE_UNAVAILABLE"
  | "REGISTRY_AUTH_FAILED"
  | "REGISTRY_TIMEOUT"
  | "REGISTRY_UNSUPPORTED_API"
  | "HELM_REPOSITORY_VALIDATE_FAILED"
  | "INGRESSROUTE_CRD_MISSING"
  | "RUNTIME_ASSET_EMBED_MISSING"
  | "RUNTIME_BOOTSTRAP_FAILED"
  | "RUNTIME_HEALTH_CHECK_FAILED"
  | "SYSTEM_UPDATE_INSTALL_FAILED"
  | "SYSTEM_UPDATE_RESTART_FAILED"
  | "SYSTEM_UPDATE_ROLLBACK_FAILED"
  | "SYSTEM_UPDATE_BACKUP_MISSING"
  | (string & {});

export interface ApiErrorModel {
  code: ApiErrorCode;
  message: string;
  details?: unknown;
  requestId?: string;
  status?: number;
}

export interface ApiEnvelope<TData = unknown, TMeta = unknown> {
  data: TData;
  meta?: TMeta;
}

export interface PaginatedEnvelope<TItem> {
  data: TItem[];
  meta: PaginationMeta;
}

export interface BatchResultItem<TItem = unknown> {
  id: string;
  success: boolean;
  data?: TItem;
  error?: ApiErrorModel;
}

export interface BatchResult<TItem = unknown> {
  status: "success" | "partial_success" | "failed";
  results: BatchResultItem<TItem>[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
  };
}

export interface StateTransitionResult {
  id: string;
  prevState: ResourceState;
  nextState: ResourceState;
  updatedAt: string;
}
