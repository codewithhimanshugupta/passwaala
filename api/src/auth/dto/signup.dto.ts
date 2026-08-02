import { IsIn, IsOptional, IsString, Length, Matches, MaxLength } from 'class-validator';

export class SignupDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  @IsString()
  @Length(2, 60, { message: 'name must be 2–60 characters' })
  name!: string;

  @IsString()
  @Length(4, 64, { message: 'password must be 4–64 characters' })
  password!: string;

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
