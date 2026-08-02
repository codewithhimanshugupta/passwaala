import { Module } from '@nestjs/common';
import { GstController } from './gst.controller';
import { GstService } from './gst.service';

/**
 * GstModule — GST compliance (config, tax-invoice generation, GSTR-1, summary).
 * PrismaService is provided by the @Global() PrismaModule, so no local import
 * is needed (matching the other feature modules).
 */
@Module({
  controllers: [GstController],
  providers: [GstService],
  exports: [GstService],
})
export class GstModule {}
