import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import type { PlatformRole } from '../common/governance';
import { NamespacesService } from './namespaces.service';

interface RequestActor {
  user?: {
    username?: string;
    role?: PlatformRole;
  };
}

@Controller('api/namespaces')
@UseGuards(AuthGuard)
export class NamespacesController {
  constructor(private readonly namespacesService: NamespacesService) {}

  @Get()
  async list(
    @Query('clusterId') clusterId?: string,
    @Query('keyword') keyword?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'asc' | 'desc',
  ) {
    const result = await this.namespacesService.list({
      clusterId: clusterId?.trim() || undefined,
      keyword: keyword?.trim() || undefined,
      page: page?.trim() || undefined,
      pageSize: pageSize?.trim() || undefined,
      sortBy: sortBy?.trim() || undefined,
      sortOrder,
    });
    return {
      items: result.items,
      total: result.total,
      page: result.page,
      pageSize: result.pageSize,
      timestamp: new Date().toISOString(),
    };
  }

  @Post()
  create(
    @Req() req: { user?: RequestActor },
    @Body()
    body: {
      clusterId: string;
      namespace: string;
      labels?: Record<string, string>;
    },
  ) {
    return this.namespacesService.create(req.user?.user, body);
  }

  @Patch(':id')
  update(
    @Req() req: { user?: RequestActor },
    @Param('id') id: string,
    @Body() body: { labels: Record<string, string> },
  ) {
    return this.namespacesService.update(req.user?.user, id, body);
  }

  @Delete(':id')
  remove(@Req() req: { user?: RequestActor }, @Param('id') id: string) {
    return this.namespacesService.remove(req.user?.user, id);
  }
}
