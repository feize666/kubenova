import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { PrismaService } from '../platform/database/prisma.service';

export type KubernetesUpdateTaskPayload = {
  action: 'install' | 'rollback' | 'preflight';
  targetVersion: string;
  preflightId: string;
  preflightExpiresAt: string;
  backupTargetId: string;
  migrationTargetId?: string;
  settingsFingerprint?: string;
  previousVersion?: string;
  rollbackTaskId?: string;
  preflightChecks?: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; message: string }>;
  images: {
    frontend: string;
    controlApi: string;
    runtimeGateway: string;
  };
  operator: string;
};

export type KubernetesUpdateTaskResult = {
  checks?: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; message: string }>;
  previousImages?: Record<string, string>;
  previousVersion?: string;
};

export type KubernetesUpdateTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed';

export type KubernetesUpdateTaskRecord = {
  id: string;
  action: KubernetesUpdateTaskPayload['action'];
  payload: KubernetesUpdateTaskPayload;
  status: KubernetesUpdateTaskStatus;
  phase: string;
  percent: number | null;
  message: string | null;
  attempt: number;
  createdAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  backupLocation: string | null;
  backupBytes: string | null;
  result: KubernetesUpdateTaskResult | null;
  resultSignature?: string | null;
};

const LEASE_MS = 30_000;
const progressPhases = new Set(['initializing', 'backing-up', 'migration-test', 'updating', 'rolling-back', 'health-check']);
const trustedImages: Record<keyof KubernetesUpdateTaskPayload['images'], RegExp> = {
  frontend: /^ghcr\.io\/feize666\/kubenova-frontend@sha256:[a-f0-9]{64}$/i,
  controlApi: /^ghcr\.io\/feize666\/kubenova-control-api@sha256:[a-f0-9]{64}$/i,
  runtimeGateway: /^ghcr\.io\/feize666\/kubenova-runtime-gateway@sha256:[a-f0-9]{64}$/i,
};

@Injectable()
export class KubernetesUpdateTasksService {
  constructor(private readonly db: PrismaService) {}

  async submit(payload: KubernetesUpdateTaskPayload): Promise<KubernetesUpdateTaskRecord> {
    validateTaskPayload(payload);
    let row: any;
    try {
      row = await this.db.kubernetesUpdateTask.create({
        data: {
          action: payload.action,
          payload: canonicalValue(payload) as Prisma.InputJsonValue,
          signature: this.sign(payload),
          status: 'queued',
          phase: 'queued',
          percent: 0,
          message: null,
          claimedBy: null,
          leaseUntil: null,
          result: Prisma.DbNull,
          activeSlot: 'system-update',
        },
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) throw new BadRequestException('已有 Kubernetes 更新或预检任务正在执行');
      throw error;
    }
    return publicTask(row);
  }

  async get(id: string): Promise<KubernetesUpdateTaskRecord | null> {
    const row = await this.db.kubernetesUpdateTask.findUnique({ where: { id } });
    return row ? this.verifiedPublicTask(row) : null;
  }

  async getLatest(): Promise<KubernetesUpdateTaskRecord | null> {
    const row = await this.db.kubernetesUpdateTask.findFirst({
      where: { action: { in: ['install', 'rollback'] } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.verifiedPublicTask(row) : null;
  }

  async getLatestPreflight(): Promise<KubernetesUpdateTaskRecord | null> {
    const row = await this.db.kubernetesUpdateTask.findFirst({
      where: { action: 'preflight' },
      orderBy: { createdAt: 'desc' },
    });
    return row ? this.verifiedPublicTask(row) : null;
  }

  async invalidateLatestPreflight(checks: Array<{ name: string; status: 'passed' | 'failed' | 'skipped'; message: string }>, message: string): Promise<void> {
    if (!Array.isArray(checks) || checks.length === 0 || checks.some((check) => !check?.name || !['passed', 'failed', 'skipped'].includes(check.status) || typeof check.message !== 'string'))
      throw new BadRequestException('Kubernetes invalidation checks are invalid');
    const latest = await this.db.kubernetesUpdateTask.findFirst({ where: { action: 'preflight' }, orderBy: { createdAt: 'desc' } });
    if (!latest) return;
    const updated = await this.db.kubernetesUpdateTask.updateMany({
      where: { id: latest.id, action: 'preflight', status: 'succeeded' },
      data: { status: 'failed', phase: 'failed', completedAt: new Date(), message: normalizeMessage(message), activeSlot: null,
        result: canonicalValue({ checks }) as Prisma.InputJsonValue, resultSignature: this.signResult({ checks }) },
    });
    if (!updated.count) return;
    this.verifiedPublicTask(await this.db.kubernetesUpdateTask.findUnique({ where: { id: latest.id } }));
  }

  async listRecent(limit = 50): Promise<KubernetesUpdateTaskRecord[]> {
    const rows = await this.db.kubernetesUpdateTask.findMany({
      orderBy: { createdAt: 'desc' },
      take: Math.min(Math.max(Math.trunc(limit), 1), 200),
    });
    return rows.map((row) => this.verifiedPublicTask(row));
  }

  async claimNext(workerId: string): Promise<KubernetesUpdateTaskRecord | null> {
    if (!workerId.trim() || workerId.length > 128) throw new BadRequestException('Kubernetes update worker id is invalid');
    const now = new Date();
    for (let invalidAttempts = 0; invalidAttempts < 10; invalidAttempts += 1) {
      const candidate = await this.db.kubernetesUpdateTask.findFirst({
        where: {
          OR: [
            { status: 'queued' },
            { status: 'running', leaseUntil: { lt: now } },
          ],
        },
        orderBy: { createdAt: 'asc' },
      });
      if (!candidate) return null;
      // A missing or invalid worker secret is an installation error, not a
      // corrupt task. Do not consume queued work when verification is unavailable.
      this.key();
      let payload: KubernetesUpdateTaskPayload;
      try {
        payload = candidate.payload as KubernetesUpdateTaskPayload;
        validateTaskPayload(payload);
        if (!this.verify(payload, candidate.signature)) throw new Error('signature does not match task payload');
        if (Date.parse(payload.preflightExpiresAt) <= now.getTime()) throw new Error('bound preflight has expired');
      } catch (error) {
        const failed = await this.db.kubernetesUpdateTask.updateMany({
          where: candidate.status === 'queued'
            ? { id: candidate.id, status: 'queued' }
            : { id: candidate.id, status: 'running', leaseUntil: { lt: now } },
          data: {
            status: 'failed', phase: 'rejected', completedAt: now,
            activeSlot: null,
            message: error instanceof Error ? error.message.slice(0, 1000) : 'task validation failed',
          },
        });
        if (failed.count) continue;
        return null;
      }
      const claimed = await this.db.kubernetesUpdateTask.updateMany({
        where: candidate.status === 'queued'
          ? { id: candidate.id, status: 'queued' }
          : { id: candidate.id, status: 'running', leaseUntil: { lt: now } },
        data: {
          status: 'running', phase: 'initializing', claimedBy: workerId,
          leaseUntil: new Date(now.getTime() + LEASE_MS),
          attempt: { increment: 1 },
          startedAt: candidate.startedAt ?? now,
          message: null,
        },
      });
      if (!claimed.count) return null;
      return this.get(candidate.id);
    }
    return null;
  }

  async heartbeat(id: string, workerId: string, phase: string, percent: number | null, message: string | null): Promise<void> {
    if (!progressPhases.has(phase)) throw new BadRequestException('Kubernetes update task phase is invalid');
    if (percent !== null && (!Number.isInteger(percent) || percent < 0 || percent > 100))
      throw new BadRequestException('Kubernetes update task progress is invalid');
    const result = await this.db.kubernetesUpdateTask.updateMany({
      where: { id, status: 'running', claimedBy: workerId, leaseUntil: { gt: new Date() } },
      data: {
        phase,
        percent,
        message: normalizeMessage(message),
        leaseUntil: new Date(Date.now() + LEASE_MS),
      },
    });
    if (!result.count) throw new BadRequestException('Kubernetes update task worker lease is not owned or has expired');
  }

  async finish(id: string, workerId: string, status: 'succeeded' | 'failed', phase: string, percent: number | null, message: string, taskResult?: KubernetesUpdateTaskResult): Promise<void> {
    const validTerminalPhase = status === 'succeeded'
      ? phase === 'completed'
      : phase === 'failed' || phase === 'rollback-incomplete';
    if (!validTerminalPhase)
      throw new BadRequestException('Kubernetes update terminal phase is invalid');
    if (percent !== null && (!Number.isInteger(percent) || percent < 0 || percent > 100))
      throw new BadRequestException('Kubernetes update task progress is invalid');
    const now = new Date();
    const result = await this.db.kubernetesUpdateTask.updateMany({
      where: { id, status: 'running', claimedBy: workerId, leaseUntil: { gt: now } },
      data: {
        status,
        phase,
        percent,
        message: normalizeMessage(message) ?? (status === 'succeeded' ? 'Kubernetes update completed' : 'Kubernetes update failed'),
        ...(taskResult ? { result: canonicalValue(taskResult) as Prisma.InputJsonValue, resultSignature: this.signResult(taskResult) } : {}),
        activeSlot: null,
        completedAt: now,
        leaseUntil: null,
      },
    });
    if (!result.count) throw new BadRequestException('Kubernetes update task worker lease is not owned or has expired');
  }

  async recordBackup(id: string, workerId: string, location: string, bytes: number): Promise<void> {
    if (typeof location !== 'string' || !location || location.length > 2048 || !Number.isSafeInteger(bytes) || bytes <= 0)
      throw new BadRequestException('Kubernetes update backup result is invalid');
    const result = await this.db.kubernetesUpdateTask.updateMany({
      where: { id, status: 'running', claimedBy: workerId, leaseUntil: { gt: new Date() } },
      data: { backupLocation: location, backupBytes: String(bytes) },
    });
    if (!result.count) throw new BadRequestException('Kubernetes update task worker lease is not owned or has expired');
  }

  private sign(payload: KubernetesUpdateTaskPayload): string {
    return createHmac('sha256', this.key()).update(canonicalJson(payload)).digest('hex');
  }

  private verify(payload: KubernetesUpdateTaskPayload, signature: string): boolean {
    if (!/^[a-f0-9]{64}$/.test(signature)) return false;
    const expected = Buffer.from(this.sign(payload), 'hex');
    return timingSafeEqual(expected, Buffer.from(signature, 'hex'));
  }

  private signResult(result: KubernetesUpdateTaskResult): string {
    return createHmac('sha256', this.key()).update(`result:${canonicalJson(result)}`).digest('hex');
  }

  private verifiedPublicTask(row: any): KubernetesUpdateTaskRecord {
    const payload = row.payload as KubernetesUpdateTaskPayload;
    validateTaskPayload(payload, false);
    if (!this.verify(payload, row.signature)) throw new BadRequestException('Kubernetes update task signature verification failed');
    if (row.result !== null && row.result !== undefined) {
      if (typeof row.resultSignature !== 'string' || !/^[a-f0-9]{64}$/.test(row.resultSignature)
        || !timingSafeEqual(Buffer.from(this.signResult(row.result as KubernetesUpdateTaskResult), 'hex'), Buffer.from(row.resultSignature, 'hex')))
        throw new BadRequestException('Kubernetes update task result signature verification failed');
    }
    return publicTask(row);
  }

  private key(): Buffer {
    const raw = process.env.KUBENOVA_K8S_UPDATE_TASK_KEY?.trim() ?? '';
    if (!/^[a-f0-9]{64}$/i.test(raw) || /^(.)\1{63}$/.test(raw) || /replace-with|change-me|placeholder/i.test(raw))
      throw new BadRequestException('KUBENOVA_K8S_UPDATE_TASK_KEY must be a distinct 256-bit hex secret');
    return Buffer.from(raw, 'hex');
  }
}

function validateTaskPayload(value: KubernetesUpdateTaskPayload, requireUnexpired = true): void {
  if (!value || typeof value !== 'object' || !['install', 'rollback', 'preflight'].includes(value.action))
    throw new BadRequestException('Kubernetes update task action is invalid');
  if (!/^v\d+\.\d+(?:\.\d+)?$/.test(value.targetVersion))
    throw new BadRequestException('Kubernetes update task version is invalid');
  if (value.previousVersion !== undefined && (typeof value.previousVersion !== 'string' || !/^v\d+\.\d+(?:\.\d+)?$/.test(value.previousVersion)))
    throw new BadRequestException('Kubernetes previous update version is invalid');
  if (value.rollbackTaskId !== undefined && (typeof value.rollbackTaskId !== 'string' || !value.rollbackTaskId.trim() || value.rollbackTaskId.length > 128))
    throw new BadRequestException('Kubernetes rollback task reference is invalid');
  if (!/^[a-f0-9]{64}$/i.test(value.settingsFingerprint ?? ''))
    throw new BadRequestException('Kubernetes update settings fingerprint is invalid');
  if (typeof value.preflightId !== 'string' || !value.preflightId || value.preflightId.length > 128)
    throw new BadRequestException('Kubernetes update task preflight binding is invalid');
  if (typeof value.backupTargetId !== 'string' || !value.backupTargetId.trim() || value.backupTargetId.length > 128)
    throw new BadRequestException('Kubernetes update backup target binding is invalid');
  if (value.action === 'preflight' && (typeof value.migrationTargetId !== 'string' || !value.migrationTargetId.trim() || !/^[a-f0-9]{64}$/i.test(value.settingsFingerprint ?? '')))
    throw new BadRequestException('Kubernetes preflight migration target binding is invalid');
  if (value.action === 'preflight' && (!Array.isArray(value.preflightChecks) || value.preflightChecks.some((check) => !check?.name || !['passed', 'failed', 'skipped'].includes(check.status) || typeof check.message !== 'string')))
    throw new BadRequestException('Kubernetes preflight checks are invalid');
  if (typeof value.preflightExpiresAt !== 'string' || !Number.isFinite(Date.parse(value.preflightExpiresAt)) || (requireUnexpired && Date.parse(value.preflightExpiresAt) <= Date.now()))
    throw new BadRequestException('Kubernetes update task preflight expiry is invalid');
  if (!value.images || typeof value.images !== 'object') throw new BadRequestException('Kubernetes update task image map is invalid');
  for (const component of Object.keys(trustedImages) as Array<keyof typeof trustedImages>) {
    if (typeof value.images[component] !== 'string' || !trustedImages[component].test(value.images[component]))
      throw new BadRequestException(`Kubernetes update task ${component} image must use a trusted immutable digest`);
  }
  if (typeof value.operator !== 'string' || !value.operator.trim() || value.operator.length > 128)
    throw new BadRequestException('Kubernetes update task operator is invalid');
}

function normalizeMessage(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new BadRequestException('Kubernetes update task message is invalid');
  return value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').slice(0, 1000);
}

function isUniqueConstraintError(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002');
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalValue(value));
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => [key, canonicalValue(item)]));
  }
  return value;
}

function publicTask(row: any): KubernetesUpdateTaskRecord {
  return {
    id: row.id,
    action: row.action ?? (row.payload as KubernetesUpdateTaskPayload).action,
    payload: row.payload as KubernetesUpdateTaskPayload,
    status: row.status as KubernetesUpdateTaskStatus,
    phase: row.phase,
    percent: row.percent,
    message: row.message,
    attempt: row.attempt,
    createdAt: row.createdAt,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    backupLocation: row.backupLocation ?? null,
    backupBytes: row.backupBytes ?? null,
    result: row.result ?? null,
  };
}
