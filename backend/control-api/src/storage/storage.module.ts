import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { DatabaseModule } from '../platform/database/database.module';
import { StorageController } from './storage.controller';
import { StorageRepository } from './storage.repository';
import { StorageService } from './storage.service';

@Module({
  imports: [AuthModule, DatabaseModule, ClustersModule],
  controllers: [StorageController],
  providers: [StorageService, StorageRepository, AuthGuard],
  exports: [StorageService],
})
export class StorageModule {}
