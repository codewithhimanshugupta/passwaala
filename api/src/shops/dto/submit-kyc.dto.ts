import { IsOptional, IsString, IsUrl, MaxLength, MinLength } from 'class-validator';

/**
 * SubmitKycDto — body for POST /shops/me/kyc (the shopkeeper submits KYC +
 * docs, moving their shop DRAFT → PENDING_REVIEW).
 *
 * KYC data is the crown jewels (plan → Security): stored privately, ADMIN-only,
 * never returned on customer/shopkeeper reads. This DTO is the write shape only.
 */
export class SubmitKycDto {
  /** Owner identity: Aadhaar and/or PAN number (field-encrypted in prod). */
  @IsString()
  @MinLength(4)
  @MaxLength(40)
  aadhaarPan!: string;

  /** GST number OR shop establishment / Gumasta / trade licence. */
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  gstOrLicence!: string;

  /** FSSAI licence — required for food/restaurant shops (optional otherwise). */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  fssai?: string;

  /** Cancelled cheque / passbook image (payee identity). */
  @IsUrl({ require_tld: false })
  bankProofUrl!: string;

  /** ADMIN-only document image URLs (private bucket). */
  @IsUrl({ require_tld: false }, { each: true })
  docUrls!: string[];
}
