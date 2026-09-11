import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ClustersModule } from '../clusters/clusters.module';
import { DatabaseModule } from '../platform/database/database.module';
import { TopologyGraphController } from './topology-graph.controller';
import { TopologyGraphCacheService } from './topology-graph-cache.service';
import { TopologyGraphService } from './topology-graph.service';

@Module({
  imports: [AuthModule, ClustersModule, DatabaseModule],
  controllers: [TopologyGraphController],
  providers: [TopologyGraphCacheService, TopologyGraphService],
  exports: [TopologyGraphService],
})
export class TopologyGraphModule {}
