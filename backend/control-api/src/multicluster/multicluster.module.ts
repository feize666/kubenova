import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { MultiClusterController } from './multicluster.controller';
import { MultiClusterService } from './multicluster.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [MultiClusterController],
  providers: [MultiClusterService],
})
export class MultiClusterModule {}
