import { Injectable, ForbiddenException } from '@nestjs/common';
import type { RuntimeSession } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export interface CreateRuntimeSessionRecordInput {
  authzVersion?: number;
  id: string;
  clusterId: string;
  userId?: string;
  type: 'terminal' | 'logs';
  namespace: string;
  pod: string;
  container: string;
  expiresAt: Date;
}

@Injectable()
export class RuntimeRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createSession(
    input: CreateRuntimeSessionRecordInput,
  ): Promise<RuntimeSession> {
    if (!input.userId || !Number.isSafeInteger(input.authzVersion) || input.authzVersion! < 1) throw new ForbiddenException('Runtime session authorization snapshot required');
    const owner = await this.prisma.user.findUnique({ where: { id: input.userId }, select: { isActive: true, authzVersion: true } });
    if (!owner?.isActive || owner.authzVersion !== input.authzVersion) throw new ForbiddenException('Runtime session owner unavailable');
    return this.prisma.runtimeSession.create({
      data: {
        id: input.id,
        authzVersion: input.authzVersion,
        clusterId: input.clusterId,
        userId: input.userId,
        type: input.type,
        namespace: input.namespace,
        pod: input.pod,
        container: input.container,
        expiresAt: input.expiresAt,
      },
    });
  }

  async findSessionById(id: string): Promise<(RuntimeSession & { subject: { id: string; role: string } }) | null> {
    const session = await this.prisma.runtimeSession.findFirst({
      where: { id, user: { isActive: true } },
      include: { user: { select: { id: true, role: true, authzVersion: true } } },
    });
    if (!session || session.authzVersion === null || session.authzVersion !== session.user?.authzVersion) return null;
    if (!session.user) return null;
    const { user, ...record } = session;
    return { ...record, subject: { id: user.id, role: user.role } };
  }

  closeSession(id: string): Promise<RuntimeSession> {
    return this.prisma.runtimeSession.update({
      where: { id },
      data: { closedAt: new Date() },
    });
  }
}
