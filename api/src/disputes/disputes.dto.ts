import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RaiseDisputeDto {
  @IsString() @IsNotEmpty()
  orderId!: string;

  @IsString() @IsNotEmpty() @MaxLength(500)
  reason!: string;
}

export class SendMessageDto {
  @IsString() @IsNotEmpty() @MaxLength(1000)
  body!: string;
}
