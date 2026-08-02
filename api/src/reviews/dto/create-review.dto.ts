import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

/**
 * CreateReviewDto — body for POST /reviews. One review per DELIVERED order
 * (verified purchase). The order + shop are derived from the order, never from
 * client input.
 */
export class CreateReviewDto {
  /** The delivered order being reviewed (proves a verified purchase). */
  @IsString()
  orderId!: string;

  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  comment?: string;
}
