import { Body, Controller, Delete, Get, Patch } from '@nestjs/common';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { AccountService } from './account.service';

/**
 * AccountController — the authenticated user's own profile + account deletion.
 * Any authenticated role can manage their own account (no @Roles → all roles).
 */
@Controller('account')
export class AccountController {
  constructor(private readonly account: AccountService) {}

  /** The caller's profile. */
  @Get('me')
  me(@CurrentUser() user: AuthPayload) {
    return this.account.me(user.sub);
  }

  /** Update the caller's display name. */
  @Patch('me')
  updateName(@CurrentUser() user: AuthPayload, @Body('name') name: string) {
    return this.account.updateName(user.sub, name);
  }

  /** In-app account deletion (app-store gate) — anonymize PII, retain history. */
  @Delete('me')
  deleteMe(@CurrentUser() user: AuthPayload) {
    return this.account.deleteMe(user.sub);
  }
}
