import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { AddressesService } from './addresses.service';
import { CreateAddressDto } from './dto/create-address.dto';
import { UpdateAddressDto } from './dto/update-address.dto';

/**
 * AddressesController — delivery addresses, scoped to the authenticated user.
 * Open to any authenticated user (customer surface); the JwtAuthGuard still
 * requires a valid token.
 */
@Controller('addresses')
export class AddressesController {
  constructor(private readonly addresses: AddressesService) {}

  @Get()
  listMine(@CurrentUser() user: AuthPayload) {
    return this.addresses.listMine(user.sub);
  }

  @Post()
  create(@CurrentUser() user: AuthPayload, @Body() dto: CreateAddressDto) {
    return this.addresses.create(user.sub, dto);
  }

  @Patch(':id')
  update(
    @CurrentUser() user: AuthPayload,
    @Param('id') id: string,
    @Body() dto: UpdateAddressDto,
  ) {
    return this.addresses.update(user.sub, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.addresses.remove(user.sub, id);
  }
}
