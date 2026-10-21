import { Body, Controller, ForbiddenException, Get, Optional, Param, Post, Put, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import {
  assertAdministrationPermission,
  type PlatformRole,
} from '../common/governance';
import type {
  SystemUpdateInstallRequest,
  SystemUpdatePostReleaseAuditRequest,
  SystemUpdateRestartRequest,
  SystemUpdateRollbackRequest,
  SystemUpdatePreflightRequest,
} from './dto/system-update.dto';
import { SystemUpdateService } from './system-update.service';
import { UpdateSettingsService, type UpdateSettingsInput } from './update-settings.service';

@Controller('api/system/update')
@UseGuards(AuthGuard)
export class SystemUpdateController {
  constructor(private readonly systemUpdateService: SystemUpdateService, @Optional() private readonly updateSettings?: UpdateSettingsService) {}

  @Get('status')
  getStatus(
    @Req() req: { user: { user?: { role?: PlatformRole } } },
  ) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.getStatusForApi();
  }

  @Post('check')
  check(@Req() req: { user: { user?: { role?: PlatformRole } } }) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.checkForUpdates();
  }

  @Post('preflight')
  preflight(
    @Req() req: { user: { user?: { role?: PlatformRole } } },
    @Body() body: SystemUpdatePreflightRequest,
  ) {
    assertSuperAdmin(req.user?.user);
    return this.systemUpdateService.preflight(body ?? {});
  }

  @Get('settings')
  getSettings(@Req() req: { user: { user?: { role?: PlatformRole } } }) {
    assertSuperAdmin(req.user?.user);
    if (!this.updateSettings) throw new ForbiddenException('更新设置服务未配置');
    return this.updateSettings.get();
  }

  @Put('settings')
  saveSettings(
    @Req() req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: UpdateSettingsInput,
  ) {
    assertSuperAdmin(req.user?.user);
    if (!this.updateSettings) throw new ForbiddenException('更新设置服务未配置');
    return this.updateSettings.save(body, req.user?.user?.username ?? 'unknown');
  }

  @Post('install')
  install(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdateInstallRequest,
  ) {
    assertSuperAdmin(req.user?.user);
    return this.systemUpdateService.install(
      body ?? {},
      req.user?.user?.username ?? 'unknown',
    );
  }

  @Get('tasks/latest')
  getLatestKubernetesTask(@Req() req: { user: { user?: { role?: PlatformRole } } }) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.getLatestKubernetesTask();
  }

  @Get('tasks/:taskId')
  getKubernetesTask(
    @Req() req: { user: { user?: { role?: PlatformRole } } },
    @Param('taskId') taskId: string,
  ) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.getKubernetesTask(taskId);
  }

  @Post('restart')
  restart(
    @Req()
    req: { user: { user?: { username?: string; role?: PlatformRole } } },
    @Body() body: SystemUpdateRestartRequest,
  ) {
    assertAdministrationPermission(req.user?.user);
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
    assertSuperAdmin(req.user?.user);
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
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.triggerPostReleaseAudit(
      body ?? {},
      req.user?.user?.username ?? 'unknown',
    );
  }

  @Get('history')
  getHistory(
    @Req() req: { user: { user?: { role?: PlatformRole } } },
  ) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.getHistoryForApi();
  }

  @Get('releases')
  releases(
    @Req() req: { user: { user?: { role?: PlatformRole } } },
  ) {
    assertAdministrationPermission(req.user?.user);
    return this.systemUpdateService.getReleases();
  }
}

function assertSuperAdmin(actor: { role?: string } | undefined): void {
  if (actor?.role !== 'platform-admin' && actor?.role !== 'admin')
    throw new ForbiddenException('当前操作需要超级管理员权限');
}
