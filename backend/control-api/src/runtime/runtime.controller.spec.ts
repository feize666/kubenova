import { PATH_METADATA } from '@nestjs/common/constants';
import { RuntimeController } from './runtime.controller';

describe('RuntimeController', () => {
  it('exposes api and api/v1 route aliases', () => {
    expect(Reflect.getMetadata(PATH_METADATA, RuntimeController)).toEqual([
      'api/runtime',
      'api/v1/runtime',
    ]);
  });
});
