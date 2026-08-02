import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { UserRole } from '@passwaala/shared';
import { Public } from '../common/public.decorator';
import { Roles } from '../common/roles.decorator';
import { CitiesService } from './cities.service';
import { UpsertCityDto } from './dto/upsert-city.dto';
import { CreateOfferDto, UpdateOfferDto } from './dto/offer.dto';

@Controller('cities')
export class CitiesController {
  constructor(private readonly cities: CitiesService) {}

  /** Public: enabled cities with their active offer templates. */
  @Public()
  @Get('serviceable')
  serviceable() {
    return this.cities.listEnabled();
  }

  /** Owner: all cities. */
  @Roles(UserRole.OWNER)
  @Get()
  listAll() {
    return this.cities.listAll();
  }

  /** Owner: add / update a city. */
  @Roles(UserRole.OWNER)
  @Post()
  upsert(@Body() dto: UpsertCityDto) {
    return this.cities.upsert(dto);
  }

  /** Owner: enable/disable a city. */
  @Roles(UserRole.OWNER)
  @Patch(':id')
  setEnabled(@Param('id') id: string, @Body('enabled') enabled: boolean) {
    return this.cities.setEnabled(id, enabled);
  }

  /** Owner: list offer templates for a city. */
  @Roles(UserRole.OWNER)
  @Get(':cityId/offers')
  listOffers(@Param('cityId') cityId: string) {
    return this.cities.listOffers(cityId);
  }

  /** Owner: create an offer template for a city. */
  @Roles(UserRole.OWNER)
  @Post(':cityId/offers')
  createOffer(@Param('cityId') cityId: string, @Body() dto: CreateOfferDto) {
    return this.cities.createOffer(cityId, dto);
  }

  /** Owner: update an offer template. */
  @Roles(UserRole.OWNER)
  @Patch('offers/:offerId')
  updateOffer(@Param('offerId') offerId: string, @Body() dto: UpdateOfferDto) {
    return this.cities.updateOffer(offerId, dto);
  }

  /** Owner: delete an offer template (detaches from all shops). */
  @Roles(UserRole.OWNER)
  @Delete('offers/:offerId')
  deleteOffer(@Param('offerId') offerId: string) {
    return this.cities.deleteOffer(offerId);
  }
}
