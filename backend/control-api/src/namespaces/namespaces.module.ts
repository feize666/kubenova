import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AuthGuard } from '../common/auth.guard';
import { ClustersModule } from '../clusters/clusters.module';
import { NamespacesController } from './namespaces.controller';
import { NamespacesService } from './namespaces.service';

@Module({
  imports: [AuthModule, ClustersModule],
  controllers: [NamespacesController],
  providers: [NamespacesService, AuthGuard],
  exports: [NamespacesService],
})
export class NamespacesModule {}
