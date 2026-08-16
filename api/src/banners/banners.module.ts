import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { BannersService } from './banners.service';
import { AdminBannersController, BannersController } from './banners.controller';

@Module({
  imports: [PrismaModule],
  controllers: [BannersController, AdminBannersController],
  providers: [BannersService],
  exports: [BannersService],
})
export class BannersModule {}
