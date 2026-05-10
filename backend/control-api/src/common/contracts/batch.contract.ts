import type { ErrorCode } from '../errors/error-codes';

export type BatchStatus = 'success' | 'failed' | 'rolled_back';
export type BatchExecutionStatus = 'success' | 'partial_success' | 'failed';

export interface BatchOperationRequest<
  TAction extends string,
  TPayload = Record<string, unknown>,
> {
  action: TAction;
  reason?: string;
  items: Array<{
    id: string;
    payload?: TPayload;
  }>;
}

export interface BatchOperationItemResult<TData = Record<string, unknown>> {
  id: string;
  status: BatchStatus;
  code?: ErrorCode;
  message?: string;
  data?: TData;
}

export interface BatchRollbackResult {
  attempted: number;
  succeeded: number;
  failed: number;
}

export interface BatchOperationResult<TData = Record<string, unknown>> {
  status: BatchExecutionStatus;
  requestId: string;
  total: number;
  succeeded: number;
  failed: number;
  results: BatchOperationItemResult<TData>[];
  rollback?: BatchRollbackResult;
}
