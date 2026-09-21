import { Module } from '@nestjs/common';
import { ClustersModule } from '../clusters/clusters.module';
import { AuthorizationModule } from '../common/authorization.module';
import { RuntimeModule } from '../runtime/runtime.module';
import { AuthModule } from './auth.module';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { NativeGatewayService } from './native-gateway.service';
import { NativeGatewayController } from './native-gateway.controller';
import { NativeRbacReconcileController } from './native-rbac-reconcile.controller';
import { NativeRbacReconcileService } from './native-rbac-reconcile.service';
import { NativeKubeconfigController } from './native-kubeconfig.controller';
import { NativeKubeconfigService } from './native-kubeconfig.service';

@Module({imports:[AuthModule,ClustersModule,AuthorizationModule,RuntimeModule],controllers:[NativeGatewayController,NativeRbacReconcileController,NativeKubeconfigController],providers:[NativeGatewayService,NativeRbacReconcileService,NativeKubeconfigService,OidcIdentityRepository]})
export class NativeGatewayModule {}
