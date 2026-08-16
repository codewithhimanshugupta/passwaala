import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class ResetCredentialsDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  @IsString()
  msg91Token!: string;

  @IsOptional()
  @IsString()
  @Length(4, 64, { message: 'password must be 4–64 characters' })
  newPassword?: string;

  @IsOptional()
  @IsString()
  @Matches(/^\d{4}$/, { message: 'PIN must be exactly 4 digits' })
  newPin?: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
