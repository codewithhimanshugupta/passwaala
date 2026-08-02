import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class VerifyOtpDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  @IsString()
  @Length(6, 6, { message: 'code must be a 6-digit OTP' })
  @Matches(/^\d{6}$/, { message: 'code must be 6 digits' })
  code!: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
