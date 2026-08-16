import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';

/**
 * AuthModule — phone OTP + JWT sessions (plan: Auth).
 * Phone verification is wired to the MSG91 OTP Widget: apps verify the number
 * client-side, and AuthService re-verifies the widget access token server-side
 * (verifyMsg91Token) before signup / verify-otp / reset-credentials in prod.
 * Still open for a later phase: rotating refresh tokens + OTP rate-limiting.
 *
 * JwtModule is registered GLOBAL so the app-wide JwtAuthGuard (an APP_GUARD in
 * AppModule) can inject JwtService to verify bearer tokens on every route.
 */
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_SECRET') ?? 'dev-only-change-me',
        // Access-token lifetime. Dev default 7d for testing convenience; set
        // JWT_EXPIRES_IN in prod (rotating refresh tokens are a Phase-1 item).
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN') ?? '365d' },
      }),
    }),
  ],
  controllers: [AuthController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
