import { Global, Module } from '@nestjs/common';
import { MemoryCache } from './memory-cache';

/**
 * CacheModule — global so any service can inject the shared in-process
 * MemoryCache without importing this module everywhere.
 */
@Global()
@Module({
  providers: [MemoryCache],
  exports: [MemoryCache],
})
export class CacheModule {}
