import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import { resolveRequestId } from '../request-id';

type ErrorPayload = {
  code?: string;
  message?: string | string[];
  details?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse();
    const request = ctx.getRequest();
    const requestId = resolveRequestId(request, response);

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const payload = this.normalizeException(exception);

    response.status(status).json({
      code: payload.code ?? this.defaultCode(status),
      message: this.normalizeMessage(payload.message, status),
      ...(payload.details !== undefined ? { details: payload.details } : {}),
      requestId,
      status,
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }

  private normalizeException(exception: unknown): ErrorPayload {
    if (!(exception instanceof HttpException)) {
      return {};
    }

    const response = exception.getResponse();
    if (typeof response === 'string') {
      return { message: response };
    }

    if (isRecord(response)) {
      const details = this.extractDetails(response);
      return {
        code: typeof response.code === 'string' ? response.code : undefined,
        message:
          typeof response.message === 'string' ||
          Array.isArray(response.message)
            ? (response.message as string | string[])
            : undefined,
        ...(details !== undefined ? { details } : {}),
      };
    }

    return {};
  }

  private extractDetails(payload: Record<string, unknown>): unknown {
    if (payload.details !== undefined) {
      return payload.details;
    }

    const details = Object.fromEntries(
      Object.entries(payload).filter(
        ([key]) => !['code', 'message', 'error', 'statusCode'].includes(key),
      ),
    );

    return Object.keys(details).length > 0 ? details : undefined;
  }

  private normalizeMessage(
    message: string | string[] | undefined,
    status: number,
  ): string {
    if (Array.isArray(message)) {
      return message.join('; ');
    }

    if (typeof message === 'string' && message.trim().length > 0) {
      return message;
    }

    return status >= 500 ? 'Internal server error' : 'Request failed';
  }

  private defaultCode(status: number): string {
    if (status >= 500) {
      return 'INTERNAL_SERVER_ERROR';
    }

    return 'REQUEST_FAILED';
  }
}
