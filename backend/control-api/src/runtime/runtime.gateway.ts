import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import {
  RuntimeSessionService,
  type RuntimeGatewayPath,
} from './runtime-session.service';

type RuntimeSocketContext = {
  sessionId: string;
  path: RuntimeGatewayPath;
  type: 'terminal' | 'logs';
};

type RuntimeSocket = Socket & {
  data: {
    runtimeContext?: RuntimeSocketContext;
  };
};

@WebSocketGateway({
  namespace: /^\/ws\/(terminal|logs)$/,
  cors: {
    origin: '*',
  },
})
export class RuntimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RuntimeGateway.name);

  constructor(private readonly runtimeSessionService: RuntimeSessionService) {}

  async handleConnection(client: Socket): Promise<void> {
    const expectedPath = this.resolvePathFromNamespace(client.nsp.name);
    if (!expectedPath) {
      client.disconnect(true);
      return;
    }

    const sessionId = this.readHandshakeString(client, 'sessionId');
    const runtimeToken = this.readHandshakeString(client, 'runtimeToken');

    if (!sessionId || !runtimeToken) {
      this.emitRuntimeError(client, {
        code: 'RUNTIME_SESSION_UNAUTHORIZED',
        message: '缺少 sessionId 或 runtimeToken',
      });
      client.disconnect(true);
      return;
    }

    const validation =
      await this.runtimeSessionService.validateSessionTokenDetailed({
        sessionId,
        runtimeToken,
        expectedPath,
      });

    if (!validation.payload) {
      this.emitRuntimeError(client, {
        code: validation.code ?? 'RUNTIME_SESSION_UNAUTHORIZED',
        message: validation.message ?? 'runtime session token 无效或已过期',
      });
      this.logger.warn(
        `runtime socket rejected: namespace=${client.nsp.name}, sessionId=${sessionId}, code=${validation.code ?? 'RUNTIME_SESSION_UNAUTHORIZED'}`,
      );
      client.disconnect(true);
      return;
    }
    const payload = validation.payload;

    client.data.runtimeContext = {
      sessionId,
      path: expectedPath,
      type: payload.type,
    };
    client.join(`runtime:${sessionId}`);
    client.emit('runtime.ready', {
      sessionId,
      channel: payload.type,
      mode: 'skeleton',
      message: 'gateway connected; attach/stream not implemented',
    });

    this.logger.debug(
      `runtime socket connected: namespace=${client.nsp.name}, sessionId=${sessionId}`,
    );
  }

  @SubscribeMessage('terminal.input')
  onTerminalInput(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ): void {
    const context = this.requireRuntimeContext(
      client as RuntimeSocket,
      '/ws/terminal',
      'terminal.input',
    );
    if (!context) {
      return;
    }

    const parsed = this.parseTerminalInput(data);
    if (!parsed) {
      this.emitRuntimeError(client, {
        event: 'terminal.input',
        code: 'RUNTIME_BAD_REQUEST',
        message: 'terminal.input 参数无效，input 必须为非空字符串',
      });
      return;
    }

    client.emit('terminal.ack', {
      accepted: true,
      mode: 'skeleton',
      sessionId: context.sessionId,
      message: 'terminal attach not implemented yet',
      received: parsed,
    });
  }

  @SubscribeMessage('logs.subscribe')
  onLogsSubscribe(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: unknown,
  ): void {
    const context = this.requireRuntimeContext(
      client as RuntimeSocket,
      '/ws/logs',
      'logs.subscribe',
    );
    if (!context) {
      return;
    }

    const parsed = this.parseLogsSubscribe(data);
    if (!parsed) {
      this.emitRuntimeError(client, {
        event: 'logs.subscribe',
        code: 'RUNTIME_BAD_REQUEST',
        message:
          'logs.subscribe 参数无效，tailLines/sinceSeconds 必须为正整数，level 必须为 INFO/WARN/ERROR',
      });
      return;
    }

    client.emit('logs.ack', {
      accepted: true,
      mode: 'skeleton',
      sessionId: context.sessionId,
      message: 'logs stream not implemented yet',
      received: parsed,
    });
  }

  private resolvePathFromNamespace(
    namespace: string,
  ): RuntimeGatewayPath | null {
    if (namespace === '/ws/terminal') {
      return '/ws/terminal';
    }
    if (namespace === '/ws/logs') {
      return '/ws/logs';
    }
    return null;
  }

  private readHandshakeString(client: Socket, key: string): string | null {
    const authValue = client.handshake.auth[key];
    if (typeof authValue === 'string' && authValue.trim().length > 0) {
      return authValue;
    }

    const queryValue = client.handshake.query[key];
    if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
      return queryValue;
    }

    if (
      Array.isArray(queryValue) &&
      typeof queryValue[0] === 'string' &&
      queryValue[0].trim().length > 0
    ) {
      return queryValue[0];
    }

    return null;
  }

  private requireRuntimeContext(
    client: RuntimeSocket,
    expectedPath: RuntimeGatewayPath,
    event: 'terminal.input' | 'logs.subscribe',
  ): RuntimeSocketContext | null {
    const context = client.data.runtimeContext;
    if (!context) {
      this.emitRuntimeError(client, {
        event,
        code: 'RUNTIME_SESSION_UNAUTHORIZED',
        message: 'runtime 会话未初始化或已失效',
      });
      return null;
    }

    if (context.path !== expectedPath || client.nsp.name !== expectedPath) {
      this.emitRuntimeError(client, {
        event,
        code: 'RUNTIME_CHANNEL_MISMATCH',
        message: '当前 websocket 通道与事件不匹配',
      });
      return null;
    }

    return context;
  }

  private parseTerminalInput(data: unknown): { input: string } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const input = (data as { input?: unknown }).input;
    if (typeof input !== 'string' || input.length === 0) {
      return null;
    }

    return { input };
  }

  private parseLogsSubscribe(data: unknown): {
    tailLines?: number;
    sinceSeconds?: number;
    level?: 'INFO' | 'WARN' | 'ERROR';
    keyword?: string;
  } | null {
    if (!data || typeof data !== 'object') {
      return null;
    }

    const payload = data as {
      tailLines?: unknown;
      sinceSeconds?: unknown;
      level?: unknown;
      keyword?: unknown;
    };

    const parsed: {
      tailLines?: number;
      sinceSeconds?: number;
      level?: 'INFO' | 'WARN' | 'ERROR';
      keyword?: string;
    } = {};

    if (payload.tailLines !== undefined) {
      if (
        typeof payload.tailLines !== 'number' ||
        !Number.isInteger(payload.tailLines) ||
        payload.tailLines <= 0
      ) {
        return null;
      }
      parsed.tailLines = payload.tailLines;
    }

    if (payload.sinceSeconds !== undefined) {
      if (
        typeof payload.sinceSeconds !== 'number' ||
        !Number.isInteger(payload.sinceSeconds) ||
        payload.sinceSeconds <= 0
      ) {
        return null;
      }
      parsed.sinceSeconds = payload.sinceSeconds;
    }

    if (payload.level !== undefined) {
      if (
        payload.level !== 'INFO' &&
        payload.level !== 'WARN' &&
        payload.level !== 'ERROR'
      ) {
        return null;
      }
      parsed.level = payload.level;
    }

    if (payload.keyword !== undefined) {
      if (
        typeof payload.keyword !== 'string' ||
        payload.keyword.trim().length === 0
      ) {
        return null;
      }
      parsed.keyword = payload.keyword;
    }

    return parsed;
  }

  private emitRuntimeError(
    client: RuntimeSocket,
    error: {
      event?: string;
      code: string;
      message: string;
    },
  ): void {
    client.emit('runtime.error', {
      event: error.event,
      code: error.code,
      message: error.message,
    });
  }
}
