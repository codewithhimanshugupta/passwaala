import { Module } from '@nestjs/common';
import { RealtimeGateway } from './realtime.gateway';

/**
 * RealtimeModule — Socket.IO gateway for live order events.
 * Phase 0 stub (gateway + emit helpers); JWT socket auth + real fan-out land in
 * Phase 1. Exported so the orders module can emit on state changes.
 */
@Module({
  providers: [RealtimeGateway],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}
