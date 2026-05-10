import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  appendAudit,
  assertWritePermission,
  listAudits,
  type PlatformRole,
} from '../common/governance';

interface BatchItem {
  resourceType: string;
  resourceId: string;
  action: 'enable' | 'disable';
  reason?: string;
}

interface BatchStateRequest {
  items: BatchItem[];
}

@Controller('api')
@UseGuards(AuthGuard)
export class OperationsController {
  @Get('audit-records')
  getAuditRecords(
    @Query('action') action?: string,
    @Query('resourceType') resourceType?: string,
    @Query('actor') actor?: string,
    @Query('result') result?: string,
    @Query('requestId') requestId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const currentPage = this.parsePositiveInt(page, 1);
    const currentPageSize = this.parsePositiveInt(pageSize, 20);

    return {
      ...listAudits({
        action,
        resourceType,
        actor,
        result,
        requestId,
        page: currentPage,
        pageSize: currentPageSize,
      }),
      timestamp: new Date().toISOString(),
    };
  }

  @Post('operations/batch-state')
  applyBatchState(
    @Req()
    req: {
      user: { user?: { username?: string; role?: PlatformRole } };
      headers?: Record<string, string | string[] | undefined>;
    },
    @Body() body: BatchStateRequest,
  ) {
    const actor = req.user?.user;
    assertWritePermission(actor);
    const requestIdHeader = req.headers?.['x-request-id'];
    const requestId = Array.isArray(requestIdHeader)
      ? requestIdHeader[0]
      : requestIdHeader;

    if (!body || !Array.isArray(body.items) || body.items.length === 0) {
      throw new BadRequestException('items 不能为空');
    }

    const items = body.items.map((item, index) => {
      const resourceType = item.resourceType?.trim();
      const resourceId = item.resourceId?.trim();
      if (!resourceType || !resourceId) {
        throw new BadRequestException(
          `items[${index}] resourceType/resourceId 是必填字段`,
        );
      }
      if (item.action !== 'enable' && item.action !== 'disable') {
        throw new BadRequestException(
          `items[${index}] action 仅支持 enable 或 disable`,
        );
      }

      appendAudit({
        actor: actor?.username ?? 'unknown',
        role: actor?.role ?? 'read-only',
        action: item.action,
        resourceType,
        resourceId,
        result: 'success',
        reason: item.reason,
        requestId,
      });

      return {
        resourceType,
        resourceId,
        action: item.action,
        status: 'success' as const,
      };
    });

    return {
      status: 'success',
      result: items,
      timestamp: new Date().toISOString(),
    };
  }

  private parsePositiveInt(
    value: string | undefined,
    fallback: number,
  ): number {
    if (!value) return fallback;
    const parsed = Number.parseInt(value, 10);
    if (Number.isNaN(parsed) || parsed <= 0) return fallback;
    return parsed;
  }
}
