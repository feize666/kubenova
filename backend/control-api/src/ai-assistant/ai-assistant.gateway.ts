import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service';
import { AiAssistantService } from './ai-assistant.service';

const AI_ASSISTANT_ADMIN_ROLES = new Set(['admin', 'platform-admin']);

type AiSocket = Socket & {
  data: {
    actor?: { id: string; username: string; role: string };
    streaming?: boolean;
  };
};

type ChatSendPayload = {
  requestId?: unknown;
  sessionId?: unknown;
  message?: unknown;
  clusterId?: unknown;
  namespace?: unknown;
  resourceKind?: unknown;
  resourceName?: unknown;
};

function readTrimmed(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

/**
 * AI 助手流式对话网关。
 *
 * 命名空间 `/ws/ai-assistant`，握手时通过 `auth.token` 传入 control-api 的
 * access token；连接后的事件序列：
 *   chat.send  -> chat.delta (0..n) -> chat.done
 *   任意阶段失败 -> chat.error
 *
 * 权限与 REST 端点保持一致：仅 admin / platform-admin 可用。
 */
@WebSocketGateway({
  namespace: '/ws/ai-assistant',
  cors: { origin: '*' },
})
export class AiAssistantGateway
  implements OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(AiAssistantGateway.name);

  constructor(
    private readonly authService: AuthService,
    private readonly aiAssistantService: AiAssistantService,
  ) {}

  async handleConnection(client: AiSocket): Promise<void> {
    const token = this.readHandshakeString(client, 'token');
    if (!token) {
      this.emitError(client, {
        code: 'AI_ASSISTANT_UNAUTHORIZED',
        message: '缺少访问令牌，请重新登录后再试。',
      });
      client.disconnect(true);
      return;
    }

    let session: Awaited<ReturnType<AuthService['validate']>> = null;
    try {
      session = await this.authService.validate(token);
    } catch {
      session = null;
    }

    if (!session) {
      this.emitError(client, {
        code: 'AI_ASSISTANT_UNAUTHORIZED',
        message: '访问令牌无效或已过期，请重新登录。',
      });
      client.disconnect(true);
      return;
    }

    const role = String(session.user.role ?? '').trim().toLowerCase();
    if (!AI_ASSISTANT_ADMIN_ROLES.has(role)) {
      this.emitError(client, {
        code: 'AI_ASSISTANT_FORBIDDEN',
        message: 'AI 助手仅管理员可用。',
      });
      client.disconnect(true);
      return;
    }

    client.data.actor = {
      id: session.user.id,
      username: session.user.username,
      role,
    };
    client.emit('chat.ready', { namespace: '/ws/ai-assistant' });
    this.logger.debug(
      `ai-assistant socket connected: user=${session.user.username}`,
    );
  }

  handleDisconnect(client: AiSocket): void {
    client.data.streaming = false;
    delete client.data.actor;
  }

  @SubscribeMessage('chat.send')
  async onChatSend(
    @ConnectedSocket() client: AiSocket,
    @MessageBody() payload: ChatSendPayload,
  ): Promise<void> {
    const actor = client.data.actor;
    if (!actor) {
      this.emitError(client, {
        code: 'AI_ASSISTANT_UNAUTHORIZED',
        message: '会话未初始化或已失效，请重新连接。',
      });
      return;
    }

    const requestId = readTrimmed(payload?.requestId);

    if (client.data.streaming) {
      this.emitError(client, {
        requestId,
        code: 'AI_ASSISTANT_BUSY',
        message: '上一条回复仍在生成中，请稍候。',
      });
      return;
    }

    const sessionId = readTrimmed(payload?.sessionId);
    const message = readTrimmed(payload?.message);
    if (!sessionId || !message) {
      this.emitError(client, {
        requestId,
        code: 'AI_ASSISTANT_BAD_REQUEST',
        message: 'sessionId 与 message 均为必填项。',
      });
      return;
    }

    const controller = new AbortController();
    const abortOnDisconnect = () => controller.abort();
    client.once('disconnect', abortOnDisconnect);
    client.data.streaming = true;

    try {
      const result = await this.aiAssistantService.appendUserAndReplyStream(
        actor.id,
        sessionId,
        message,
        {
          signal: controller.signal,
          onDelta: (delta) => {
            if (!client.connected) return;
            client.emit('chat.delta', { requestId, sessionId, delta });
          },
        },
        undefined,
        undefined,
        {
          clusterId: readTrimmed(payload?.clusterId),
          namespace: readTrimmed(payload?.namespace),
          resourceKind: readTrimmed(payload?.resourceKind),
          resourceName: readTrimmed(payload?.resourceName),
        },
      );

      if (!client.connected) return;
      client.emit('chat.done', { requestId, ...result });
    } catch (error) {
      const aborted =
        controller.signal.aborted ||
        (error instanceof Error && error.name === 'AbortError');
      if (!aborted && client.connected) {
        this.emitError(client, {
          requestId,
          code: 'AI_ASSISTANT_STREAM_FAILED',
          message:
            error instanceof Error ? error.message : '生成回复失败，请稍后重试。',
        });
      }
    } finally {
      client.off('disconnect', abortOnDisconnect);
      client.data.streaming = false;
    }
  }

  private readHandshakeString(client: Socket, key: string): string | null {
    const authValue = client.handshake.auth?.[key];
    if (typeof authValue === 'string' && authValue.trim().length > 0) {
      return authValue.trim();
    }
    const queryValue = client.handshake.query?.[key];
    if (typeof queryValue === 'string' && queryValue.trim().length > 0) {
      return queryValue.trim();
    }
    return null;
  }

  private emitError(
    client: Socket,
    payload: { code: string; message: string; requestId?: string },
  ): void {
    client.emit('chat.error', payload);
  }
}
