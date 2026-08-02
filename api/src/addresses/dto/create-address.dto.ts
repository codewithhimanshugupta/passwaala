import { IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** CreateAddressDto — body for POST /addresses (a customer saves an address). */
export class CreateAddressDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  line!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  landmark?: string;

  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;

  /** Home / Work / Other */
  @IsString()
  @MaxLength(40)
  label!: string;
}
