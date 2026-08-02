import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

export class RequestOtpDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  /** Which app is logging in. Determines which identity namespace to use. */
  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
