import { Module } from '@nestjs/common';
import { DispatchService } from './dispatch.service';

/**
 * DispatchModule — the shared dispatch-engine boundary (rider assignment +
 * service matching). Interface-only for the MVP (no controller, no caller); the
 * offer loop is implemented with the delivery/services phases. Exported so those
 * future modules can inject the service against a stable seam.
 */
@Module({
  providers: [DispatchService],
  exports: [DispatchService],
})
export class DispatchModule {}
