import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { DatabaseModule } from '../platform/database/database.module';
import { NetworkController } from './network.controller';
import { NetworkRepository } from './network.repository';
import { NetworkService } from './network.service';

@Module({
  imports: [AuthModule, DatabaseModule, ClustersModule],
  controllers: [NetworkController],
  providers: [NetworkService, NetworkRepository, AuthGuard],
  exports: [NetworkService],
})
export class NetworkModule {}
