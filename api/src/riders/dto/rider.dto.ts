import { IsArray, IsBoolean, IsLatitude, IsLongitude, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * RegisterRiderDto — a logged-in user becomes a RIDER. Beyond name + vehicle we
 * now capture the service city and KYC (identity + documents) so admin can
 * verify a delivery partner and pull their records later. KYC fields are
 * optional at the API layer so a partial/staged onboarding still works, but the
 * app collects the core ones (name, aadhaar, DL) up front.
 */
export class RegisterRiderDto {
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  vehicle?: string;

  /** City this rider serves (dispatch scopes jobs by it). Defaults to Jhansi. */
  @IsOptional()
  @IsString()
  @MaxLength(60)
  serviceCity?: string;

  // ---- KYC (identity + documents) ----
  @IsOptional()
  @IsString()
  @MaxLength(120)
  fullName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  aadhaar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  pan?: string;

  @IsOptional()
  @IsString()
  @MaxLength(30)
  dlNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  vehicleNumber?: string;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  emergencyName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  emergencyPhone?: string;

  @IsOptional()
  @IsString()
  photoUrl?: string;

  /** Private document image URLs (admin-only). */
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  docUrls?: string[];
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
