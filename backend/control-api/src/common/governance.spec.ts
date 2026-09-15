import { ForbiddenException } from '@nestjs/common';
import { assertWritePermission } from './governance';

describe('explicit write-role boundary', () => {
  it.each([
    undefined,
    '',
    'user',
    'read-only',
    'viewer',
    'cluster-admin',
    'unknown',
    {},
    ['platform-admin'],
  ])('denies unapproved runtime role %j', (role) => {
    expect(() => assertWritePermission({ role } as never)).toThrow(
      ForbiddenException,
    );
  });
  it.each(['platform-admin', 'cluster-operator', 'admin', 'operator'])(
    'retains approved role %s',
    (role) => {
      expect(() => assertWritePermission({ role } as never)).not.toThrow();
    },
  );
});
