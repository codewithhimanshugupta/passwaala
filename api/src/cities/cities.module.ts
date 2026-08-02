import { Global, Module } from '@nestjs/common';
import { CitiesController } from './cities.controller';
import { CitiesService } from './cities.service';

/**
 * CitiesModule — owner-controlled serviceable cities. Global so ShopsService can
 * inject CitiesService to gate registration on an enabled city.
 */
@Global()
@Module({
  controllers: [CitiesController],
  providers: [CitiesService],
  exports: [CitiesService],
})
export class CitiesModule {}
