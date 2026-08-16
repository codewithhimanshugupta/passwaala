import { Body, Controller, Delete, Get, Param, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { BannersService } from './banners.service';
import { CreateBannerDto, UpdateBannerDto } from './dto/banner.dto';

/**
 * Public banner feed for the customer home carousel. Unauthenticated: the home
 * screen loads before/without a session. `?city=` scopes to the customer's city
 * (empty-city banners always show).
 */
@Controller('banners')
export class BannersController {
  constructor(private readonly banners: BannersService) {}

  @Public()
  @Get()
  list(@Query('city') city?: string) {
    return this.banners.activeForCity(city);
  }
}

/** Admin CRUD for home banners (ADMIN/OWNER only). */
@Controller('admin/banners')
export class AdminBannersController {
  constructor(private readonly banners: BannersService) {}

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get()
  list(@Query('all') all?: string) {
    return this.banners.adminList(all === 'true' || all === '1');
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post()
  create(@Body() dto: CreateBannerDto) {
    return this.banners.adminCreate(dto);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateBannerDto) {
    return this.banners.adminUpdate(id, dto);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.banners.adminDelete(id);
  }
}
