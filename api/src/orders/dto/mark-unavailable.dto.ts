import { ArrayNotEmpty, IsArray, IsString } from 'class-validator';

/**
 * MarkUnavailableDto — body for the shopkeeper marking order items unavailable
 * during accept-before-pay (plan → Order Exceptions: item substitution). The
 * order recalculates to an adjustedTotal and awaits the customer's approval.
 */
export class MarkUnavailableDto {
  /** OrderItem ids to mark UNAVAILABLE. */
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  orderItemIds!: string[];
}
