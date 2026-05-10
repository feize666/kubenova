import { randomUUID } from 'crypto';

type RequestLike = {
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string;
};

type ResponseLike = {
  setHeader?: (name: string, value: string) => void;
};

function pickHeaderValue(value: string | string[] | undefined): string | null {
  if (!value) {
    return null;
  }
  if (Array.isArray(value)) {
    const first = value.find(
      (item) => typeof item === 'string' && item.trim().length > 0,
    );
    return first?.trim() ?? null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function resolveRequestId(req: RequestLike, res?: ResponseLike): string {
  if (req.requestId && req.requestId.trim().length > 0) {
    if (res?.setHeader) {
      res.setHeader('x-request-id', req.requestId);
    }
    return req.requestId;
  }

  const headerValue = pickHeaderValue(req.headers?.['x-request-id']);
  const requestId = headerValue ?? randomUUID();
  req.requestId = requestId;

  if (res?.setHeader) {
    res.setHeader('x-request-id', requestId);
  }

  return requestId;
}
