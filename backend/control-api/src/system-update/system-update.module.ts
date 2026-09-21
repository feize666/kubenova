import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { SystemUpdateController } from './system-update.controller';
import { SystemUpdateService } from './system-update.service';
import { BackupStatusController } from '../backup/backup-status.controller';
import { BackupStatusService } from '../backup/backup-status.service';

@Module({
  imports: [AuthModule],
  controllers: [SystemUpdateController, BackupStatusController],
  providers: [SystemUpdateService, BackupStatusService, AuthGuard],
})
export class SystemUpdateModule {}
