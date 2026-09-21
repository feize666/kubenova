import { AuthorizationInvalidation } from '../common/authorization-invalidation';
import { RuntimeInvalidationService } from './runtime-invalidation.service';
import { PrismaService } from '../platform/database/prisma.service';

describe('runtime invalidation recovery', () => {
  it('replaces a disconnected listener once for concurrent new requests', async () => {
    const previous = process.env.RUNTIME_PUSH_REVOCATION_ENABLED;
    const database = process.env.DATABASE_URL;
    process.env.RUNTIME_PUSH_REVOCATION_ENABLED = 'true';
    process.env.DATABASE_URL = 'postgresql://localhost/fixture';
    const dead = { available: true, close: jest.fn(async () => {}) };
    const live = { available: true, close: jest.fn(async () => {}) };
    const connect = jest.spyOn(AuthorizationInvalidation, 'connect')
      .mockResolvedValueOnce(dead as unknown as AuthorizationInvalidation)
      .mockResolvedValueOnce(live as unknown as AuthorizationInvalidation);
    const prisma = { $queryRaw: jest.fn(async () => [{ schema: 'fixture', count: 2n }]) };
    const service = new RuntimeInvalidationService(prisma as unknown as PrismaService);
    try {
      expect(await service.get()).toBe(dead);
      dead.available = false;
      expect(await Promise.all([service.get(), service.get(), service.get()])).toEqual([live, live, live]);
      expect(connect).toHaveBeenCalledTimes(2);
      expect(dead.close).toHaveBeenCalledTimes(1);
    } finally {
      await service.onModuleDestroy();
      connect.mockRestore();
      if (previous === undefined) delete process.env.RUNTIME_PUSH_REVOCATION_ENABLED;
      else process.env.RUNTIME_PUSH_REVOCATION_ENABLED = previous;
      if (database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = database;
    }
  });
});
