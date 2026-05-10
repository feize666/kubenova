import { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { ResponseEnvelopeInterceptor } from './response-envelope.interceptor';

describe('ResponseEnvelopeInterceptor', () => {
  const createExecutionContext = (requestId = 'req-123'): ExecutionContext =>
    ({
      getType: () => 'http',
      switchToHttp: () => ({
        getRequest: () => ({ requestId }),
        getResponse: () => ({ setHeader: jest.fn() }),
      }),
    }) as unknown as ExecutionContext;

  it('wraps plain payloads with data and requestId', (done) => {
    const interceptor = new ResponseEnvelopeInterceptor();
    const context = createExecutionContext();
    const next: CallHandler = {
      handle: () => of({ hello: 'world' }),
    };

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toEqual({
        data: { hello: 'world' },
        requestId: 'req-123',
      });
      done();
    });
  });

  it('preserves existing data envelope and merges requestId', (done) => {
    const interceptor = new ResponseEnvelopeInterceptor();
    const context = createExecutionContext('req-456');
    const next: CallHandler = {
      handle: () =>
        of({
          data: { items: [] },
          meta: { total: 0 },
        }),
    };

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toEqual({
        data: { items: [] },
        meta: { total: 0 },
        requestId: 'req-456',
      });
      done();
    });
  });

  it('normalizes legacy pagination into meta', (done) => {
    const interceptor = new ResponseEnvelopeInterceptor();
    const context = createExecutionContext('req-789');
    const next: CallHandler = {
      handle: () =>
        of({
          data: { items: [] },
          pagination: { page: 2, pageSize: 10, total: 15, totalPages: 2 },
          meta: { timestamp: '2026-04-14T16:08:00.000Z' },
        }),
    };

    interceptor.intercept(context, next).subscribe((value) => {
      expect(value).toEqual({
        data: { items: [] },
        meta: {
          page: 2,
          pageSize: 10,
          total: 15,
          totalPages: 2,
          timestamp: '2026-04-14T16:08:00.000Z',
        },
        requestId: 'req-789',
      });
      done();
    });
  });
});
