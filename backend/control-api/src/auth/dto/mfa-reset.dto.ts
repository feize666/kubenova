import { IsIn, IsString, Length, Matches, ValidateIf } from 'class-validator';

export class MfaResetTargetDto {
  @IsString()
  @Length(1, 256)
  @Matches(/^\S(?:[\s\S]*\S)?$/)
  targetUserId!: string;
}

export class MfaResetFactorDto extends MfaResetTargetDto {
  @ValidateIf(o => o.code !== undefined || o.method !== undefined)
  @IsString()
  @Length(1, 128)
  code?: string;

  @ValidateIf(o => o.code !== undefined || o.method !== undefined)
  @IsIn(['totp', 'recovery'])
  method?: 'totp' | 'recovery';
}

export class MfaResetPrepareDto extends MfaResetFactorDto {
  @IsString()
  @Length(1, 1024)
  password!: string;
}

export class MfaResetConfirmDto extends MfaResetTargetDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;
}

export class MfaResetOidcExchangeDto extends MfaResetFactorDto {
  @IsString()
  @Length(1, 8192)
  callbackUrl!: string;
}
