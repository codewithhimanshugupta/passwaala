import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** UpdateAddressDto — body for PATCH /addresses/:id (all fields optional). */
export class UpdateAddressDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  line?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  label?: string;
}
