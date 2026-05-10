import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { resolveRequestId } from '../request-id';

type EnvelopeLike = {
  data: unknown;
  meta?: unknown;
  pagination?: unknown;
  requestId?: string;
};

function isEnvelope(value: unknown): value is EnvelopeLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    Object.prototype.hasOwnProperty.call(value, 'data')
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function normalizeMeta(
  payload: EnvelopeLike,
): Record<string, unknown> | undefined {
  const meta = isRecord(payload.meta) ? { ...payload.meta } : undefined;
  const pagination = isRecord(payload.pagination)
    ? payload.pagination
    : undefined;

  if (!meta && !pagination) {
    return undefined;
  }

  return {
    ...(pagination ?? {}),
    ...(meta ?? {}),
  };
}

@Injectable()
export class ResponseEnvelopeInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const response = context.switchToHttp().getResponse();
    const request = context.switchToHttp().getRequest();
    const requestId = resolveRequestId(request, response);

    return next.handle().pipe(
      map((payload) => {
        if (isEnvelope(payload)) {
          const meta = normalizeMeta(payload);

          return {
            data: payload.data,
            ...(meta ? { meta } : {}),
            requestId: payload.requestId ?? requestId,
          };
        }

        return {
          data: payload,
          requestId,
        };
      }),
    );
  }
}
