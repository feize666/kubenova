import { IsIn, IsString, Length, Matches } from 'class-validator';

export class MfaVerifyDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  challengeToken!: string;

  @IsString()
  @Length(1, 128)
  code!: string;

  @IsIn(['totp', 'recovery'])
  method!: 'totp' | 'recovery';
}
