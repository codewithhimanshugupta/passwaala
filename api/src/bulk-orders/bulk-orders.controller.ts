import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { BulkOrdersService } from './bulk-orders.service';
import { PlaceBulkOrderDto } from './dto/place-bulk-order.dto';

@Controller('bulk-orders')
export class BulkOrdersController {
  constructor(private readonly bulkOrders: BulkOrdersService) {}

  /** Place a multi-shop bulk order. */
  @Roles(UserRole.CUSTOMER)
  @Post()
  place(@CurrentUser() user: AuthPayload, @Body() dto: PlaceBulkOrderDto) {
    return this.bulkOrders.place(user.sub, dto);
  }

  /** Customer: detail of a specific bulk order. */
  @Roles(UserRole.CUSTOMER)
  @Get(':id')
  find(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.bulkOrders.findForCustomer(user.sub, id);
  }

  /** Customer: paginated bulk order history. */
  @Roles(UserRole.CUSTOMER)
  @Get()
  history(
    @CurrentUser() user: AuthPayload,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.bulkOrders.historyForCustomer(user.sub, limit ? parseInt(limit) : 20, cursor);
  }
}
