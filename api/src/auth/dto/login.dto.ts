import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  /** Either the account password or the fixed backup OTP. */
  @IsString()
  @Length(4, 64, { message: 'enter your password or 6-digit OTP' })
  credential!: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
