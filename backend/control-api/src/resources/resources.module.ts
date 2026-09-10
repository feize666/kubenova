import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { ClusterAccessService } from '../common/cluster-access.service';
import { ResourcesController } from './resources.controller';
import { ResourcesService } from './resources.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [ResourcesController],
  providers: [ResourcesService, ClusterAccessService],
})
export class ResourcesModule {}
