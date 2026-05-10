import type { ApiErrorPayload } from '../contracts/error.contract';
import { ErrorCode } from './error-codes';

export interface ApiErrorOptions {
  code: ErrorCode;
  message: string;
  details?: ApiErrorPayload['details'];
}

export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly details?: ApiErrorPayload['details'];

  constructor(options: ApiErrorOptions) {
    super(options.message);
    this.name = 'ApiError';
    this.code = options.code;
    this.details = options.details;
  }

  toPayload(): ApiErrorPayload {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
    };
  }
}
