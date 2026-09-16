import { Global, Module } from '@nestjs/common';
import { AuthorizationService } from './authorization.service';

/** Provides the fine-grained authorization evaluator to all feature modules. */
@Global()
@Module({
  providers: [AuthorizationService],
  exports: [AuthorizationService],
})
export class AuthorizationModule {}
