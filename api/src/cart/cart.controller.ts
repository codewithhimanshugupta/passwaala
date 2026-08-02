import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { CartService } from './cart.service';
import { AddToCartDto } from './dto/add-to-cart.dto';
import { CartViewQuery } from './dto/cart-view.query';

/**
 * CartController — the shopping cart, scoped to the authenticated user
 * (customerId from the JWT, never client input).
 *
 * The customer surface is open to ANY authenticated user (a shopkeeper/admin can
 * also shop) — so no @Roles gate here; the JwtAuthGuard still requires a valid
 * token. Shopkeeper/admin management surfaces remain role-gated elsewhere.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cart: CartService) {}

  /**
   * View the current cart + bill breakdown. Optional `?deliveryMode=&addressId=`
   * preview the exact delivery fee for that fulfilment choice.
   */
  @Get()
  view(@CurrentUser() user: AuthPayload, @Query() query: CartViewQuery) {
    return this.cart.view(user.sub, {
      deliveryMode: query.deliveryMode,
      addressId: query.addressId,
      selectedOfferId: query.selectedOfferId,
    });
  }

  /** Add (or increment) a product line. */
  @Post('items')
  addItem(@CurrentUser() user: AuthPayload, @Body() dto: AddToCartDto) {
    return this.cart.addItem(user.sub, dto);
  }

  /** Set an exact quantity for a line (0 removes it). */
  @Patch('items/:productId')
  setQty(
    @CurrentUser() user: AuthPayload,
    @Param('productId') productId: string,
    @Body('qty') qty: number,
  ) {
    return this.cart.setQty(user.sub, productId, qty);
  }

  /** Clear the entire cart. */
  @Delete()
  clear(@CurrentUser() user: AuthPayload) {
    return this.cart.clear(user.sub);
  }
}
