import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  RuntimeRepository,
  type CreateRuntimeSessionRecordInput,
} from './runtime.repository';

export type RuntimeGatewayPath = '/ws/terminal' | '/ws/logs';

export interface RuntimeTokenPayload {
  sessionId: string;
  userId: string;
  type: 'terminal' | 'logs';
  clusterId: string;
  namespace: string;
  pod: string;
  container: string;
  availableContainers?: string[];
  podPhase?: string;
  level?: 'INFO' | 'WARN' | 'ERROR';
  keyword?: string;
  tailLines?: number;
  sinceSeconds?: number;
  follow?: boolean;
  previous?: boolean;
  timestamps?: boolean;
  path: RuntimeGatewayPath;
  exp: number;
}

export interface ValidateRuntimeSessionTokenInput {
  sessionId: string;
  runtimeToken: string;
  expectedPath: RuntimeGatewayPath;
}

export type RuntimeSessionValidationCode =
  | 'RUNTIME_TOKEN_FORMAT_INVALID'
  | 'RUNTIME_TOKEN_SIGNATURE_INVALID'
  | 'RUNTIME_TOKEN_PAYLOAD_INVALID'
  | 'RUNTIME_TOKEN_EXPIRED'
  | 'RUNTIME_TOKEN_SESSION_MISMATCH'
  | 'RUNTIME_TOKEN_PATH_MISMATCH'
  | 'RUNTIME_SESSION_NOT_FOUND'
  | 'RUNTIME_SESSION_CLOSED'
  | 'RUNTIME_SESSION_EXPIRED';

export interface RuntimeSessionValidationResult {
  payload: RuntimeTokenPayload | null;
  code?: RuntimeSessionValidationCode;
  message?: string;
}

@Injectable()
export class RuntimeSessionService {
  private readonly runtimeTokenSecret =
    process.env.RUNTIME_TOKEN_SECRET ?? 'dev-runtime-token-secret';

  constructor(private readonly runtimeRepository: RuntimeRepository) {}

  persistSession(input: CreateRuntimeSessionRecordInput): Promise<void> {
    return this.runtimeRepository.createSession(input).then(() => undefined);
  }

  createRuntimeToken(payload: RuntimeTokenPayload): string {
    const header = { alg: 'HS256', typ: 'JWT' } as const;
    const encodedHeader = this.base64UrlEncodeJson(header);
    const encodedPayload = this.base64UrlEncodeJson(payload);
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signature = createHmac('sha256', this.runtimeTokenSecret)
      .update(signingInput)
      .digest('base64url');
    return `${signingInput}.${signature}`;
  }

  async validateSessionToken(
    input: ValidateRuntimeSessionTokenInput,
  ): Promise<RuntimeTokenPayload | null> {
    const result = await this.validateSessionTokenDetailed(input);
    return result.payload;
  }

  async validateSessionTokenDetailed(
    input: ValidateRuntimeSessionTokenInput,
  ): Promise<RuntimeSessionValidationResult> {
    const tokenVerification = this.verifyRuntimeToken(input.runtimeToken);
    if (!tokenVerification.payload) {
      const failureCode =
        tokenVerification.code ?? 'RUNTIME_TOKEN_PAYLOAD_INVALID';
      return {
        payload: null,
        code: failureCode,
        message: this.resolveValidationMessage(failureCode),
      };
    }

    const payload = tokenVerification.payload;
    if (payload.sessionId !== input.sessionId) {
      return {
        payload: null,
        code: 'RUNTIME_TOKEN_SESSION_MISMATCH',
        message: this.resolveValidationMessage(
          'RUNTIME_TOKEN_SESSION_MISMATCH',
        ),
      };
    }
    if (payload.path !== input.expectedPath) {
      return {
        payload: null,
        code: 'RUNTIME_TOKEN_PATH_MISMATCH',
        message: this.resolveValidationMessage('RUNTIME_TOKEN_PATH_MISMATCH'),
      };
    }

    const session = await this.runtimeRepository.findSessionById(
      input.sessionId,
    );
    if (!session) {
      return {
        payload: null,
        code: 'RUNTIME_SESSION_NOT_FOUND',
        message: this.resolveValidationMessage('RUNTIME_SESSION_NOT_FOUND'),
      };
    }
    if (session.closedAt) {
      return {
        payload: null,
        code: 'RUNTIME_SESSION_CLOSED',
        message: this.resolveValidationMessage('RUNTIME_SESSION_CLOSED'),
      };
    }
    if (session.expiresAt.getTime() <= Date.now()) {
      return {
        payload: null,
        code: 'RUNTIME_SESSION_EXPIRED',
        message: this.resolveValidationMessage('RUNTIME_SESSION_EXPIRED'),
      };
    }

    return { payload };
  }

  private verifyRuntimeToken(token: string): {
    payload: RuntimeTokenPayload | null;
    code?: RuntimeSessionValidationCode;
  } {
    const chunks = token.split('.');
    if (chunks.length !== 3) {
      return { payload: null, code: 'RUNTIME_TOKEN_FORMAT_INVALID' };
    }

    const [encodedHeader, encodedPayload, receivedSignature] = chunks;
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', this.runtimeTokenSecret)
      .update(signingInput)
      .digest('base64url');

    if (!this.safeCompare(receivedSignature, expectedSignature)) {
      return { payload: null, code: 'RUNTIME_TOKEN_SIGNATURE_INVALID' };
    }

    try {
      const parsedPayload = JSON.parse(
        Buffer.from(encodedPayload, 'base64url').toString('utf8'),
      ) as RuntimeTokenPayload;
      if (!parsedPayload || typeof parsedPayload !== 'object') {
        return { payload: null, code: 'RUNTIME_TOKEN_PAYLOAD_INVALID' };
      }
      if (typeof parsedPayload.exp !== 'number') {
        return { payload: null, code: 'RUNTIME_TOKEN_PAYLOAD_INVALID' };
      }
      if (parsedPayload.exp <= Math.floor(Date.now() / 1000)) {
        return { payload: null, code: 'RUNTIME_TOKEN_EXPIRED' };
      }
      return { payload: parsedPayload };
    } catch {
      return { payload: null, code: 'RUNTIME_TOKEN_PAYLOAD_INVALID' };
    }
  }

  private resolveValidationMessage(code: RuntimeSessionValidationCode): string {
    switch (code) {
      case 'RUNTIME_TOKEN_FORMAT_INVALID':
      case 'RUNTIME_TOKEN_SIGNATURE_INVALID':
      case 'RUNTIME_TOKEN_PAYLOAD_INVALID':
      case 'RUNTIME_TOKEN_SESSION_MISMATCH':
      case 'RUNTIME_TOKEN_PATH_MISMATCH':
        return 'runtimeToken 无效，请重新进入终端创建新会话';
      case 'RUNTIME_TOKEN_EXPIRED':
      case 'RUNTIME_SESSION_EXPIRED':
        return 'runtime 会话已过期，请重新进入终端';
      case 'RUNTIME_SESSION_NOT_FOUND':
      case 'RUNTIME_SESSION_CLOSED':
        return 'runtime 会话不存在或已关闭，请重新进入终端';
      default:
        return 'runtime 会话校验失败';
    }
  }

  private safeCompare(received: string, expected: string): boolean {
    const left = Buffer.from(received);
    const right = Buffer.from(expected);

    if (left.length !== right.length) {
      return false;
    }

    return timingSafeEqual(left, right);
  }

  private base64UrlEncodeJson(value: object): string {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
  }
}
