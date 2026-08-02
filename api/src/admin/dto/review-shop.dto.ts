import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * ReviewShopDto — body for the admin reject action (reason shown to the
 * shopkeeper so they can re-submit). Approve/suspend take no body beyond this
 * optional reason.
 */
export class ReviewShopDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(300)
  reason?: string;
}
