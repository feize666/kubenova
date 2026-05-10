import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { OperationsController } from './operations.controller';

@Module({
  imports: [AuthModule],
  controllers: [OperationsController],
  providers: [AuthGuard],
})
export class OperationsModule {}
