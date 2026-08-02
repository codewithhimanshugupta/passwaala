import { Module } from '@nestjs/common';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

/**
 * ProductsModule — product CRUD (shopkeeper) + catalog reads (customer).
 * Phase 0 stub (routes + DI wiring); logic lands in Phase 1/2.
 */
@Module({
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
