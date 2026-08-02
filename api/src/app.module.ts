import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { HealthController } from './health/health.controller';
import { JwtAuthGuard } from './common/jwt-auth.guard';
import { RolesGuard } from './common/roles.guard';
import { AuthModule } from './auth/auth.module';
import { ShopsModule } from './shops/shops.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { LedgerModule } from './ledger/ledger.module';
import { NotificationsModule } from './notifications/notifications.module';
import { RealtimeModule } from './realtime/realtime.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { AdminModule } from './admin/admin.module';
import { CartModule } from './cart/cart.module';
import { ReviewsModule } from './reviews/reviews.module';
import { AccountModule } from './account/account.module';
import { AddressesModule } from './addresses/addresses.module';
import { UploadModule } from './uploads/upload.module';
import { AdminManagementModule } from './admin-management/admin-management.module';
import { CategoriesModule } from './categories/categories.module';
import { ReferralsModule } from './referrals/referrals.module';
import { CitiesModule } from './cities/cities.module';
import { RidersModule } from './riders/riders.module';
import { AutomationModule } from './automation/automation.module';
import { DisputesModule } from './disputes/disputes.module';
import { CouponsModule } from './coupons/coupons.module';
import { GstModule } from './gst/gst.module';

/**
 * AppModule — root module.
 *
 * Wires the config, global Prisma, and all Phase-0 feature modules (auth, shops,
 * products, orders, ledger, notifications, realtime, dispatch). The feature
 * modules are scaffolds — routes + DI + the pieces of logic that are testable
 * without a DB (order transitions, ledger GST math, OTP/JWT); the DB-backed
 * behaviour lands in Phases 1–4.
 *
 * SECURITY (plan → deny-by-default RBAC): two GLOBAL guards run on every route —
 *  1. JwtAuthGuard  — verifies the bearer token unless the route is @Public().
 *  2. RolesGuard    — enforces @Roles(...) against the token's role.
 * Order matters: authentication (JwtAuthGuard) must run before authorization
 * (RolesGuard), so it is registered first.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    ShopsModule,
    ProductsModule,
    OrdersModule,
    LedgerModule,
    NotificationsModule,
    RealtimeModule,
    DispatchModule,
    AdminModule,
    CartModule,
    ReviewsModule,
    AccountModule,
    AddressesModule,
    UploadModule,
    AdminManagementModule,
    CategoriesModule,
    ReferralsModule,
    CitiesModule,
    RidersModule,
    AutomationModule,
    DisputesModule,
    CouponsModule,
    GstModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
