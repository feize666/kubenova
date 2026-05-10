import type {
  BatchOperationRequest,
  BatchOperationResult,
} from '../contracts/batch.contract';

export interface BatchItemDto<TPayload = Record<string, unknown>> {
  id: string;
  payload?: TPayload;
}

export interface BatchOperationRequestDto<
  TAction extends string = string,
  TPayload = Record<string, unknown>,
> extends BatchOperationRequest<TAction, TPayload> {
  items: BatchItemDto<TPayload>[];
}

export type BatchOperationResultDto<TData = Record<string, unknown>> =
  BatchOperationResult<TData>;
