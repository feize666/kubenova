import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthRepository } from './auth.repository';
import { AuthService } from './auth.service';
import { TokenService } from './token.service';
import { OidcFlowService } from './oidc-flow.service';
import { OidcTransactionStore } from './oidc-transaction.store';
import Redis from 'ioredis';
import { OidcIdentityRepository } from './oidc-identity.repository';
import { OidcProviderService } from './oidc-provider.service';
import { OidcController } from './oidc.controller';
import { LoginAttemptLimiter } from './login-attempt-limiter';
import { MfaCredentialRepository } from './mfa-credential.repository';
import { MfaChallengeStore } from './mfa-challenge.store';
import { MfaEnrollmentStore } from './mfa-enrollment.store';
import { ConfigService } from '@nestjs/config';
import { MfaResetController } from './mfa-reset.controller';
import { MfaResetStore } from './mfa-reset.store';
import { NativeSettingsController } from './native-settings.controller';
import { NativeSettingsService } from './native-settings.service';

@Module({
  controllers: [AuthController, OidcController, MfaResetController, NativeSettingsController],
  providers: [NativeSettingsService, AuthService, AuthRepository, TokenService, OidcFlowService, OidcIdentityRepository, OidcProviderService, MfaCredentialRepository, {
    provide: MfaResetStore,
    useFactory: () => {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000, commandTimeout: 3000,
      });
      redis.on('error', () => {});
      return new MfaResetStore(redis);
    },
  }, {
    provide: MfaEnrollmentStore,
    useFactory: (config: ConfigService) => {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000, commandTimeout: 3000 });
      redis.on('error', () => {});
      return new MfaEnrollmentStore(redis, config.get<string>('mfaEncryptionKey') ?? process.env.MFA_ENCRYPTION_KEY ?? '');
    },
    inject: [ConfigService],
  }, {
    provide: MfaChallengeStore,
    useFactory: () => {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000, commandTimeout: 3000,
      });
      redis.on('error', () => {});
      return new MfaChallengeStore(redis);
    },
  }, {
    provide: LoginAttemptLimiter,
    useFactory: () => {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: true, maxRetriesPerRequest: 0, connectTimeout: 3000, commandTimeout: 3000,
      });
      redis.on('error', () => {});
      return new LoginAttemptLimiter(redis);
    },
  }, {
    provide: OidcTransactionStore,
    useFactory: () => {
      const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
        lazyConnect: true, maxRetriesPerRequest: 0,
        connectTimeout: 3000, commandTimeout: 3000,
      });
      // Storage failures are returned by the login flow without logging credentials.
      redis.on('error', () => {});
      return new OidcTransactionStore(redis);
    },
  }],
  exports: [AuthService, OidcFlowService],
})
export class AuthModule {}
