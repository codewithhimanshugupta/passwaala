import { IsInt, Min } from 'class-validator';

/** PayDuesDto — shopkeeper self-settles their PassWaala dues (amount in paise). */
export class PayDuesDto {
  @IsInt()
  @Min(1)
  amountPaise!: number;
}
