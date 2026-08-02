import { IsOptional, IsString, Length, MaxLength, MinLength } from 'class-validator';

/**
 * UpsertGstConfigDto — owner sets PassWaala's own GST registration details
 * (the single PlatformGstConfig row). gstin is the 15-char GSTIN; stateCode is
 * the 2-char state code that defines PassWaala's home state (intra- vs
 * inter-state split). invoicePrefix defaults to "PW" in the schema when absent.
 */
export class UpsertGstConfigDto {
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  legalName!: string;

  @IsString()
  @Length(15, 15, { message: 'gstin must be exactly 15 characters' })
  gstin!: string;

  @IsString()
  @Length(2, 2, { message: 'stateCode must be exactly 2 characters' })
  stateCode!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  address?: string;

  @IsOptional()
  @IsString()
  @MaxLength(16)
  invoicePrefix?: string;
}
