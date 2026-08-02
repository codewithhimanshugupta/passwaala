import { IsBoolean, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

/** UpsertCityDto — owner adds/updates a serviceable city. */
export class UpsertCityDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsString()
  @Matches(/^$|^[\w.\-]{2,}@[\w.\-]{2,}$/, { message: 'collectionUpiVpa must be a valid UPI id (e.g. passwala@upi)' })
  @MaxLength(120)
  collectionUpiVpa?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  collectionUpiName?: string;

  @IsOptional()
  @IsInt()
  @Min(1000)
  @Max(100000)
  deliveryRadiusMeters?: number;

  @IsOptional()
  @IsInt()
  @Min(500)
  @Max(50000)
  riderCheckRadiusMeters?: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  deliveryTiersJson?: string;
}
