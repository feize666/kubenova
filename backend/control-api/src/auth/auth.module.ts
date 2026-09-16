import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { OidcFlowService } from './oidc-flow.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, AuthRepository, TokenService, OidcFlowService],
  exports: [AuthService, OidcFlowService],
})
export class AuthModule {}
