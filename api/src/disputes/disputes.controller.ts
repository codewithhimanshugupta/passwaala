import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { Roles } from '../common/roles.decorator';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthPayload } from '../auth/auth-payload';
import { DisputesService } from './disputes.service';
import { RaiseDisputeDto, SendMessageDto } from './disputes.dto';

@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER, UserRole.RIDER)
  @Post()
  raise(@CurrentUser() user: AuthPayload, @Body() dto: RaiseDisputeDto) {
    return this.disputes.raiseDispute(user.sub, String(user.role), dto.orderId, dto.reason);
  }

  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER, UserRole.RIDER)
  @Get('my/:orderId')
  myDispute(@CurrentUser() user: AuthPayload, @Param('orderId') orderId: string) {
    return this.disputes.getMyDispute(user.sub, orderId);
  }

  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER, UserRole.RIDER)
  @Get(':id/messages')
  thread(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.disputes.getThread(id, user.sub);
  }

  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER, UserRole.RIDER)
  @Post(':id/messages')
  send(@CurrentUser() user: AuthPayload, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.disputes.sendMessage(user.sub, String(user.role), id, dto.body);
  }

  @Roles(UserRole.CUSTOMER, UserRole.SHOPKEEPER, UserRole.RIDER)
  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.disputes.reopenDispute(user.sub, id);
  }
}

@Controller('admin/disputes')
export class AdminDisputesController {
  constructor(private readonly disputes: DisputesService) {}

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('queue')
  queue(@CurrentUser() user: AuthPayload, @Query('role') role?: string) {
    return this.disputes.listQueue(user.sub, String(user.role), role);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('mine')
  mine(@CurrentUser() user: AuthPayload) {
    return this.disputes.listAssigned(user.sub);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('resolved')
  resolved(@CurrentUser() user: AuthPayload, @Query('role') role?: string) {
    return this.disputes.listResolved(user.sub, String(user.role), role);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get('counts')
  counts(@CurrentUser() user: AuthPayload) {
    return this.disputes.queueCounts(user.sub, String(user.role));
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post(':id/assign')
  assign(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.disputes.assignDispute(user.sub, id);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post(':id/resolve')
  resolve(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.disputes.resolveDispute(user.sub, id);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Get(':id/messages')
  thread(@CurrentUser() user: AuthPayload, @Param('id') id: string) {
    return this.disputes.adminGetThread(id, user.sub);
  }

  @Roles(UserRole.ADMIN, UserRole.OWNER)
  @Post(':id/messages')
  send(@CurrentUser() user: AuthPayload, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.disputes.adminSendMessage(user.sub, id, dto.body);
  }
}
