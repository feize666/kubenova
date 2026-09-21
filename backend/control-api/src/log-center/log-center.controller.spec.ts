jest.mock('@kubernetes/client-node', () => ({}));
import 'reflect-metadata';
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ConfigService } from '@nestjs/config';
import { AuthRepository } from '../auth/auth.repository';
import { AuthService } from '../auth/auth.service';
import { TokenService } from '../auth/token.service';
import { AuthGuard } from '../common/auth.guard';
import { ClusterAccessService } from '../common/cluster-access.service';
import { PrismaService } from '../platform/database/prisma.service';
import { LogCenterController } from './log-center.controller';
import { LogCenterService } from './log-center.service';
import { AuthorizationService } from '../common/authorization.service';
import { NamespaceIdentityService } from '../common/namespace-identity.service';

describe('log query authentication boundary', () => {
  it('registers the existing session guard and rejects absent or invalid bearer tokens', async () => {
    const prisma = {
      session: { findFirst: jest.fn().mockResolvedValue(null) },
    } as unknown as PrismaService;
    const auth = new AuthService(
      new AuthRepository(prisma),
      new TokenService(new ConfigService()),
    );
    const guardTypes = Reflect.getMetadata(
      GUARDS_METADATA,
      LogCenterController,
    );
    expect(guardTypes).toContain(AuthGuard);
    const guard = new guardTypes[0](auth) as AuthGuard;
    for (const headers of [{}, { authorization: 'Bearer invalid-session' }]) {
      const context = {
        switchToHttp: () => ({
          getRequest: () => ({ headers }),
          getResponse: () => ({}),
        }),
      } as ExecutionContext;
      await expect(guard.canActivate(context)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    }
  });

  it('reads the nested authenticated session and rejects a missing identity', async () => {
    const prisma = {} as PrismaService;
    const controller = new LogCenterController(
      new LogCenterService(prisma, new ClusterAccessService(prisma), new AuthorizationService(prisma), {} as NamespaceIdentityService),
    );
    await expect(controller.query({}, {})).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(controller.previewCollection({}, {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.previewCollection(
      { user: { user: { id: 'reader', role: 'read-only' } } }, {},
    )).rejects.toMatchObject({ status: 403 });
    await expect(
      controller.query(
        { user: { user: { id: 'reader', role: 'read-only' } } },
        {},
      ),
    ).rejects.toMatchObject({ status: 400 });
  });
});
