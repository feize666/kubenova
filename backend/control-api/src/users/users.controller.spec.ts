import { PATH_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('exposes api and api/v1 route aliases', () => {
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toEqual([
      'api/users',
      'api/v1/users',
    ]);
  });
});
