import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { assertWritePermission, type PlatformRole } from '../common/governance';
import type {
  SystemUpdateInstallRequest,
  SystemUpdatePostReleaseAuditRequest,
  SystemUpdateRestartRequest,
  SystemUpdateRollbackRequest,
} from './dto/system-update.dto';
import { SystemUpdateService } from './system-update.service';

@Controller('api/system/update')
@UseGuards(AuthGuard)
export class SystemUpdateController {
  constructor(private readonly systemUpdateService: SystemUpdateService) {}

  @Get('status')
  getStatus() {
    return this.systemUpdateService.getStatus();
  }

  @Post('install')
  install(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdateInstallRequest,
  ) {
    assertWritePermission(req.user?.user);
    return this.systemUpdateService.install(
      body ?? {},
      req.user?.user?.username ?? 'unknown',
    );
  }

  @Post('restart')
  restart(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdateRestartRequest,
  ) {
    assertWritePermission(req.user?.user);
    return this.systemUpdateService.restart(
      body?.confirm,
      req.user?.user?.username ?? 'unknown',
      body?.message,
    );
  }

  @Post('rollback')
  rollback(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdateRollbackRequest,
  ) {
    assertWritePermission(req.user?.user);
    return this.systemUpdateService.rollback(
      body ?? {},
      req.user?.user?.username ?? 'unknown',
    );
  }

  @Post('post-release-audit')
  triggerPostReleaseAudit(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdatePostReleaseAuditRequest,
  ) {
    assertWritePermission(req.user?.user);
    return this.systemUpdateService.triggerPostReleaseAudit(
      body ?? {},
      req.user?.user?.username ?? 'unknown',
    );
  }

  @Get('history')
  getHistory() {
    return this.systemUpdateService.getHistory();
  }
}
