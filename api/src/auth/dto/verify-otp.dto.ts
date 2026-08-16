import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  /** MSG91 widget access token — used in production for OTP login. */
  @IsOptional()
  @IsString()
  msg91Token?: string;

  /** Legacy / dev-only: in-memory OTP code (ignored in production). */
  @IsOptional()
  @IsString()
  code?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
