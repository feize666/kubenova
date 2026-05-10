import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthService } from '../auth/auth.service';
import { resolveRequestId } from './request-id';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly authService: AuthService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const response = context.switchToHttp().getResponse();
    const requestId = resolveRequestId(request, response);
    const authHeader = request.headers.authorization as string | undefined;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_MISSING',
        message: '未提供访问令牌',
        requestId,
      });
    }

    const token = authHeader.replace('Bearer ', '').trim();
    const session = await this.authService.validate(token);

    if (!session) {
      throw new UnauthorizedException({
        code: 'AUTH_TOKEN_INVALID',
        message: '访问令牌无效或已过期',
        requestId,
      });
    }

    request.user = session;
    return true;
  }
}
