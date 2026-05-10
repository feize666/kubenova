import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthGuard } from '../common/auth.guard';
import { DatabaseModule } from '../platform/database/database.module';
import { HelmController } from './helm.controller';
import { HelmRepositoryStore } from './helm-repository.store';
import { HelmService } from './helm.service';

@Module({
  imports: [AuthModule, ClustersModule, DatabaseModule],
  controllers: [HelmController],
  providers: [HelmService, HelmRepositoryStore, AuthGuard],
  exports: [HelmService],
})
export class HelmModule {}
