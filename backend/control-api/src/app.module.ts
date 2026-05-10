import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { AiAssistantModule } from './ai-assistant/ai-assistant.module';
import { AutoscalingModule } from './autoscaling/autoscaling.module';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { AuthModule } from './auth/auth.module';
import { ClustersModule } from './clusters/clusters.module';
import { ConfigsModule } from './configs/configs.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { LogsModule } from './logs/logs.module';
import { MonitoringModule } from './monitoring/monitoring.module';
import { MultiClusterModule } from './multicluster/multicluster.module';
import { NetworkModule } from './network/network.module';
import { NamespacesModule } from './namespaces/namespaces.module';
import { OperationsModule } from './operations/operations.module';
import { RuntimeModule } from './runtime/runtime.module';
import { ResourcesModule } from './resources/resources.module';
import { SecurityModule } from './security/security.module';
import { StorageModule } from './storage/storage.module';
import { SystemUpdateModule } from './system-update/system-update.module';
import { UsersModule } from './users/users.module';
import { WorkloadsModule } from './workloads/workloads.module';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';
import { ResponseEnvelopeInterceptor } from './common/interceptors/response-envelope.interceptor';
import { parseEnv } from './platform/config/env.schema';
import { DatabaseModule } from './platform/database/database.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      validate: (env) => parseEnv(env),
    }),
    DatabaseModule,
    AiAssistantModule,
    AutoscalingModule,
    AuthModule,
    ClustersModule,
    DashboardModule,
    RuntimeModule,
    ResourcesModule,
    NamespacesModule,
    LogsModule,
    NetworkModule,
    WorkloadsModule,
    StorageModule,
    SystemUpdateModule,
    ConfigsModule,
    UsersModule,
    SecurityModule,
    MonitoringModule,
    MultiClusterModule,
    OperationsModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_INTERCEPTOR,
      useClass: ResponseEnvelopeInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule {}
