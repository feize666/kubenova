import type { ErrorCode } from '../errors/error-codes';

export interface ErrorFieldDetail {
  field: string;
  reason: string;
}

export interface DependencyErrorDetail {
  dependencyType: string;
  dependencyId: string;
  message?: string;
}

export interface ApiErrorPayload {
  code: ErrorCode;
  message: string;
  details?: {
    validation?: ErrorFieldDetail[];
    dependency?: DependencyErrorDetail[];
    conflictResourceVersion?: string;
    [key: string]: unknown;
  };
}

export interface ApiErrorResponse {
  code: string;
  message: string;
  details?: unknown;
  requestId: string;
  status?: number;
  path?: string;
  timestamp?: string;
}
