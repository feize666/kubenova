import { ArgumentsHost, BadRequestException } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter';

describe('HttpExceptionFilter', () => {
  const createHost = () => {
    const status = jest.fn().mockReturnThis();
    const json = jest.fn();
    const response = { status, json };
    const request = { requestId: 'req-789', url: '/api/v1/test' };

    const host = {
      switchToHttp: () => ({
        getResponse: () => response,
        getRequest: () => request,
      }),
    } as unknown as ArgumentsHost;

    return { host, response };
  };

  it('normalizes HttpException payload into contract error shape', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();

    filter.catch(
      new BadRequestException({
        code: 'VALIDATION_FAILED',
        message: 'bad input',
        details: { field: 'name' },
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 'VALIDATION_FAILED',
      message: 'bad input',
      details: { field: 'name' },
      requestId: 'req-789',
      status: 400,
      path: '/api/v1/test',
      timestamp: expect.any(String),
    });
  });

  it('lifts non-contract payload fields into details', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();

    filter.catch(
      new BadRequestException({
        code: 'UNSUPPORTED_CONTRACT_VERSION',
        message: 'Unsupported contract version: 0.9.0',
        supportedVersions: ['1.0.0'],
      }),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(400);
    expect(response.json).toHaveBeenCalledWith({
      code: 'UNSUPPORTED_CONTRACT_VERSION',
      message: 'Unsupported contract version: 0.9.0',
      details: { supportedVersions: ['1.0.0'] },
      requestId: 'req-789',
      status: 400,
      path: '/api/v1/test',
      timestamp: expect.any(String),
    });
  });

  it('falls back to generic internal error code for unexpected exceptions', () => {
    const filter = new HttpExceptionFilter();
    const { host, response } = createHost();

    filter.catch(new Error('boom'), host);

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.json).toHaveBeenCalledWith({
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Internal server error',
      requestId: 'req-789',
      status: 500,
      path: '/api/v1/test',
      timestamp: expect.any(String),
    });
  });
});
