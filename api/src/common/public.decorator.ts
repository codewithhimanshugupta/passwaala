import { SetMetadata } from '@nestjs/common';

/**
 * @Public() — marks a route as not requiring authentication (e.g. request-otp,
 * verify-otp, health). Everything else is protected by default.
 */
export const IS_PUBLIC_KEY = 'passwala:isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
