import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { UsersModule } from '../users/users.module';
import { SecurityController } from './security.controller';
import { SecurityService } from './security.service';

@Module({
  imports: [AuthModule, UsersModule],
  controllers: [SecurityController],
  providers: [SecurityService, AuthGuard],
})
export class SecurityModule {}
