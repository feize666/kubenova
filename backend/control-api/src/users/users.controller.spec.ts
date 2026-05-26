import { RequestMethod } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('exposes api and api/v1 route aliases', () => {
    expect(Reflect.getMetadata(PATH_METADATA, UsersController)).toEqual([
      'api/users',
      'api/v1/users',
    ]);
  });

  it('exposes table preference GET/PUT routes before dynamic user id routes', () => {
    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        UsersController.prototype.getTablePreference,
      ),
    ).toBe('preferences/table/:tableKey');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        UsersController.prototype.getTablePreference,
      ),
    ).toBe(RequestMethod.GET);

    expect(
      Reflect.getMetadata(
        PATH_METADATA,
        UsersController.prototype.saveTablePreference,
      ),
    ).toBe('preferences/table/:tableKey');
    expect(
      Reflect.getMetadata(
        METHOD_METADATA,
        UsersController.prototype.saveTablePreference,
      ),
    ).toBe(RequestMethod.PUT);
  });
});
