import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';
import { OfferType } from '@nearbaz/shared';

export class CreateOfferDto {
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title!: string;

  @IsEnum(OfferType)
  type!: OfferType;

  @IsInt()
  @Min(0)
  @Max(100000000)
  value!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderPaise?: number;
}

export class UpdateOfferDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(80)
  title?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(100000000)
  value?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  minOrderPaise?: number;

  @IsOptional()
  @IsBoolean()
  active?: boolean;
}
