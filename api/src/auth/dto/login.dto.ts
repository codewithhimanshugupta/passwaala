import { IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';

export class LoginDto {
  @IsString()
  @Matches(/^(\+91)?[6-9]\d{9}$/, { message: 'phone must be a valid Indian mobile number' })
  phone!: string;

  /** The credential value — a 4-digit PIN or a password, per `method`. */
  @IsString()
  @Length(4, 64, { message: 'enter your PIN or password' })
  credential!: string;

  /**
   * Which credential the user chose on the login screen. 'pin' → verify against
   * the PIN hash; 'password' → the password hash. Omitted → legacy fallback that
   * tries password, then PIN, then the backup OTP.
   */
  @IsOptional()
  @IsIn(['pin', 'password'])
  method?: 'pin' | 'password';

  @IsOptional()
  @IsIn(['CUSTOMER', 'SHOPKEEPER', 'RIDER', 'ADMIN', 'OWNER'])
  appType?: string;
}
