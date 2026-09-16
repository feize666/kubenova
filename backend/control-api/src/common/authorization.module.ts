import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';
import { NamespaceIdentityService } from './namespace-identity.service';
import { ClustersModule } from '../clusters/clusters.module';

/** Provides the fine-grained authorization evaluator to all feature modules. */
@Global()
@Module({
  imports: [ClustersModule],
  providers: [AuthorizationService, NamespaceIdentityService],
  exports: [AuthorizationService, NamespaceIdentityService],
})
export class AuthorizationModule {}
