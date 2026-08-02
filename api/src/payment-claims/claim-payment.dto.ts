import { IsInt, Min } from 'class-validator';

export class ClaimPaymentDto {
  @IsInt()
  @Min(1)
  amountPaise!: number;
}
