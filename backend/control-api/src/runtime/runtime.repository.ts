import { Injectable } from '@nestjs/common';
import type { RuntimeSession } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';

export interface CreateRuntimeSessionRecordInput {
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

  createSession(
    input: CreateRuntimeSessionRecordInput,
  ): Promise<RuntimeSession> {
    return this.prisma.runtimeSession.create({
      data: {
        id: input.id,
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

  findSessionById(id: string): Promise<RuntimeSession | null> {
    return this.prisma.runtimeSession.findUnique({ where: { id } });
  }

  closeSession(id: string): Promise<RuntimeSession> {
    return this.prisma.runtimeSession.update({
      where: { id },
      data: { closedAt: new Date() },
    });
  }
}
