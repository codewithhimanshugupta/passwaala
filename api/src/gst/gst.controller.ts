import { Body, Controller, Get, Patch, Post, Query } from '@nestjs/common';
import { UserRole } from '@nearbaz/shared';
import { Roles } from '../common/roles.decorator';
import { GstService } from './gst.service';
import { UpsertGstConfigDto } from './dto/upsert-gst-config.dto';

/**
 * GstController — admin/owner GST compliance surface: NearBaz's own GST config,
 * monthly tax-invoice generation from the ledger, GSTR-1 (B2B) export, and a
 * CA-friendly summary. All routes are ADMIN/OWNER; writing the config (NearBaz's
 * legal identity) is OWNER-only.
 *
 * Dates arrive as ISO strings on the query/body and are parsed to Date here so
 * the service works in native Date terms.
 */
@Controller('admin/gst')
@Roles(UserRole.ADMIN, UserRole.OWNER)
export class GstController {
  constructor(private readonly gst: GstService) {}

  /** Read NearBaz's single GST config row (null until configured). */
  @Get('config')
  getConfig() {
    return this.gst.getConfig();
  }

  /** Owner-only: create/update NearBaz's GST registration details. */
  @Roles(UserRole.OWNER)
  @Patch('config')
  upsertConfig(@Body() dto: UpsertGstConfigDto) {
    return this.gst.upsertConfig(dto);
  }

  /** Generate monthly tax invoices for the window [periodStart, periodEnd). */
  @Post('invoices/generate')
  generateInvoices(@Body() body: { periodStart: string; periodEnd: string }) {
    return this.gst.generateMonthlyInvoices(new Date(body.periodStart), new Date(body.periodEnd));
  }

  /** List tax invoices (most recent first), optionally filtered by status. */
  @Get('invoices')
  listInvoices(@Query('status') status?: string) {
    return this.gst.listInvoices(status);
  }

  /** GSTR-1 B2B export for the window. */
  @Get('gstr1')
  exportGstr1(@Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.gst.exportGstr1(new Date(periodStart), new Date(periodEnd));
  }

  /** CA-friendly GST summary for the window. */
  @Get('summary')
  summary(@Query('periodStart') periodStart: string, @Query('periodEnd') periodEnd: string) {
    return this.gst.summaryReport(new Date(periodStart), new Date(periodEnd));
  }
}
