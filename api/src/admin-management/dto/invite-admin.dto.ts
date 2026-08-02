import { IsEmail, IsOptional, IsString, Matches } from 'class-validator';

export class InviteAdminDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'Enter a valid 10-digit Indian mobile number' })
  phone!: string;

  @IsOptional()
  @IsEmail()
  email?: string;
}
