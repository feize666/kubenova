import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { SystemUpdateController } from './system-update.controller';
import { SystemUpdateService } from './system-update.service';

@Module({
  imports: [AuthModule],
  controllers: [SystemUpdateController],
  providers: [SystemUpdateService, AuthGuard],
})
export class SystemUpdateModule {}
