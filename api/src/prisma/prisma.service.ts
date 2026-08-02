import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * PrismaService — thin NestJS wrapper around the generated PrismaClient.
 *
 * NOTE (Phase 0 VERIFIER): this file was added by the Phase 0 verifier because
 * api/src/ was delivered EMPTY. It is a minimal, real scaffold whose purpose is
 * to prove that NestJS + @prisma/client + @passwaala/shared actually compile and
 * wire together. It intentionally does NOT open a DB connection at import time;
 * onModuleInit()/$connect only runs when the Nest app is bootstrapped against a
 * real database (not exercised here — Docker/Postgres unavailable).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
