import { Injectable } from '@nestjs/common';
import type { Session, User } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

@Injectable()
export class AuthRepository {
  constructor(private readonly prisma: PrismaService) {}

  findActiveUserByUsername(username: string): Promise<User | null> {
    const normalized = username.trim();
    return this.prisma.user.findFirst({
      where: {
        isActive: true,
        OR: [{ email: normalized }, { name: normalized }],
      },
    });
  }

  createSession(input: {
    userId: string;
    refreshTokenHash: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<Session> {
    return this.prisma.session.create({
      data: {
        userId: input.userId,
        refreshTokenHash: input.refreshTokenHash,
        expiresAt: input.expiresAt,
        refreshExpiresAt: input.refreshExpiresAt,
      },
    });
  }

  findValidSessionById(
    sessionId: string,
  ): Promise<(Session & { user: User }) | null> {
    return this.prisma.session.findFirst({
      where: {
        id: sessionId,
        revokedAt: null,
        expiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      include: { user: true },
    });
  }

  findValidSessionByRefreshTokenHash(
    refreshTokenHash: string,
  ): Promise<(Session & { user: User }) | null> {
    return this.prisma.session.findFirst({
      where: {
        refreshTokenHash,
        revokedAt: null,
        refreshExpiresAt: { gt: new Date() },
        user: { isActive: true },
      },
      include: { user: true },
    });
  }

  async revokeSessionById(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        revokedAt: null,
      },
      data: {
        revokedAt: new Date(),
      },
    });
  }

  async revokeSessionByRefreshTokenHash(
    sessionId: string,
    refreshTokenHash: string,
  ): Promise<boolean> {
    const result = await this.prisma.session.updateMany({
      where: {
        id: sessionId,
        refreshTokenHash,
        revokedAt: null,
        refreshExpiresAt: { gt: new Date() },
      },
      data: { revokedAt: new Date() },
    });
    return result.count === 1;
  }

  async rotateSession(input: {
    sessionId: string;
    userId: string;
    currentRefreshTokenHash: string;
    nextRefreshTokenHash: string;
    expiresAt: Date;
    refreshExpiresAt: Date;
  }): Promise<Session | null> {
    return this.prisma.$transaction(async (tx) => {
      const revoked = await tx.session.updateMany({
        where: {
          id: input.sessionId,
          refreshTokenHash: input.currentRefreshTokenHash,
          revokedAt: null,
          refreshExpiresAt: { gt: new Date() },
        },
        data: { revokedAt: new Date() },
      });
      if (revoked.count !== 1) {
        return null;
      }

      return tx.session.create({
        data: {
          userId: input.userId,
          refreshTokenHash: input.nextRefreshTokenHash,
          expiresAt: input.expiresAt,
          refreshExpiresAt: input.refreshExpiresAt,
        },
      });
    });
  }
}
