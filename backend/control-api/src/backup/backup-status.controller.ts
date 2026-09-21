import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth.guard';
import { assertAdministrationPermission } from '../common/governance';
import { BackupStatusService } from './backup-status.service';

type RequestWithActor = {
  user?: { user?: { role?: string; username?: string } };
};

@Controller('api/system/backup')
@UseGuards(AuthGuard)
export class BackupStatusController {
  constructor(private readonly backupStatusService: BackupStatusService) {}

  @Get('status')
  getStatus(@Req() request: RequestWithActor) {
    assertAdministrationPermission(request.user?.user);
    return this.backupStatusService.getStatus();
  }
}
