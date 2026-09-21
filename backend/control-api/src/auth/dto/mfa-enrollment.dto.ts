import { IsString, Matches, Length } from 'class-validator';

export class MfaEnrollmentStartDto {
  @IsString()
  @Length(1, 1024)
  password!: string;
}

export class MfaEnrollmentConfirmDto {
  @IsString()
  @Matches(/^[A-Za-z0-9_-]{43}$/)
  token!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}
