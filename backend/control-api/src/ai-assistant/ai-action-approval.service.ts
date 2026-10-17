import { ForbiddenException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../platform/database/prisma.service';
import { AiActionExecutorService, type AiActionActor, type AiActionExecuteInput } from './ai-action-executor.service';
import { isReadOnlyAiAction } from './ai-action-registry';

const APPROVAL_TTL_MS = 5 * 60_000;
type PreviewResponse = Awaited<ReturnType<AiActionExecutorService['preview']>> & {
  approvalId?: string;
  expiresAt?: string;
};

type StoredApproval = {
  id: string;
  actorUserId: string | null;
  action: string;
  targetJson: Prisma.JsonValue;
  status: string;
  createdAt: Date;
};

function isReadOnly(action: AiActionExecuteInput): boolean {
  return isReadOnlyAiAction(action.operation);
}

function canonicalAction(action: AiActionExecuteInput, operation?: string): AiActionExecuteInput {
  return { ...action, operation: (operation ?? action.operation) as AiActionExecuteInput['operation'] };
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).filter(key => record[key] !== undefined).sort().map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

@Injectable()
export class AiActionApprovalService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly executor: AiActionExecutorService,
  ) {}

  async preview(actor: AiActionActor | undefined, action: AiActionExecuteInput): Promise<PreviewResponse> {
    const preview = await this.executor.preview(actor, action);
    if (preview.status !== 'ok' || !preview.operation || isReadOnly(action)) return preview;
    const userId = actor?.userId?.trim();
    if (!userId) throw new ForbiddenException('高风险操作需要有效的用户身份');

    const confirmedAction = canonicalAction(action, preview.operation);
    const target = confirmedAction.target ?? confirmedAction.targets?.[0];
    await this.prisma.aiActionApproval.updateMany({
      where: { status: 'pending', createdAt: { lt: new Date(Date.now() - APPROVAL_TTL_MS) } },
      data: { status: 'expired' },
    });
    const record = await this.prisma.aiActionApproval.create({
      data: {
        actorUserId: userId,
        clusterId: target?.clusterId ?? null,
        action: preview.operation,
        targetJson: confirmedAction as unknown as Prisma.InputJsonValue,
        previewJson: {
          targets: preview.targets ?? [],
          rollbackSuggestion: preview.rollbackSuggestion ?? null,
        } as unknown as Prisma.InputJsonValue,
        status: 'pending',
      },
      select: { id: true, createdAt: true },
    });
    return {
      ...preview,
      approvalId: record.id,
      expiresAt: new Date(record.createdAt.getTime() + APPROVAL_TTL_MS).toISOString(),
    };
  }

  async execute(
    actor: AiActionActor | undefined,
    action: AiActionExecuteInput,
    approvalId?: string,
  ) {
    if (isReadOnly(action)) return this.executor.execute(actor, action);
    const userId = actor?.userId?.trim();
    if (!userId || !approvalId?.trim()) {
      throw new ForbiddenException('写操作必须先预览并由用户确认');
    }

    const preview = await this.executor.preview(actor, action);
    if (preview.status !== 'ok' || !preview.operation) {
      throw new ForbiddenException('当前操作无法验证，请重新预览');
    }
    const approval = await this.prisma.aiActionApproval.findUnique({
      where: { id: approvalId },
    }) as StoredApproval | null;
    const confirmedAction = canonicalAction(action, preview.operation);
    if (
      !approval ||
      approval.actorUserId !== userId ||
      approval.status !== 'pending' ||
      Date.now() - approval.createdAt.getTime() > APPROVAL_TTL_MS ||
      approval.createdAt.getTime() > Date.now() ||
      stableJson(approval.targetJson) !== stableJson(confirmedAction)
    ) {
      throw new ForbiddenException('审批不存在、已过期、已使用或与当前操作不匹配');
    }

    const consumed = await this.prisma.aiActionApproval.updateMany({
      where: { id: approval.id, actorUserId: userId, status: 'pending' },
      data: { status: 'approved', approvedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new ForbiddenException('审批已被使用或撤销');
    }

    try {
      return await this.executor.execute(actor, action);
    } finally {
      try {
        await this.prisma.aiActionApproval.update({
          where: { id: approval.id },
          data: { status: 'executed' },
        });
      } catch {
        // The approval was already atomically consumed before dispatch. A status
        // write failure must not hide an operation that has already completed.
      }
    }
  }
}
