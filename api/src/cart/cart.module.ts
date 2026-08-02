import { Module } from '@nestjs/common';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

/**
 * CartModule — the customer's single-shop cart + bill breakdown.
 * Exported so the orders module (Phase 2 placement) can read the cart.
 */
@Module({
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
