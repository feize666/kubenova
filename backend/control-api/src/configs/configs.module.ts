import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { DatabaseModule } from '../platform/database/database.module';
import { ConfigsController } from './configs.controller';
import { ConfigsRepository } from './configs.repository';
import { ConfigsService } from './configs.service';

@Module({
  imports: [AuthModule, DatabaseModule, ClustersModule],
  controllers: [ConfigsController],
  providers: [ConfigsService, ConfigsRepository, AuthGuard],
  exports: [ConfigsService],
})
export class ConfigsModule {}
