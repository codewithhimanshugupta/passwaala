import { IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** RegisterRiderDto — a logged-in user becomes a RIDER (name + optional vehicle). */
export class RegisterRiderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  vehicle?: string;
}

/** SetOnlineDto — rider online/offline toggle. */
export class SetRiderOnlineDto {
  @IsBoolean()
  online!: boolean;

  @IsOptional()
  @IsLatitude()
  latitude?: number;

  @IsOptional()
  @IsLongitude()
  longitude?: number;
}

/** RiderLocationDto — a live position ping while on an active delivery. */
export class RiderLocationDto {
  @IsLatitude()
  latitude!: number;

  @IsLongitude()
  longitude!: number;
}
