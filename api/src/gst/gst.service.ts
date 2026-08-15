import { Injectable } from '@nestjs/common';
import { LedgerEntryType, TaxInvoiceStatus, computeGst } from '@passwaala/shared';
import { PrismaService } from '../prisma/prisma.service';
import { UpsertGstConfigDto } from './dto/upsert-gst-config.dto';

/** SAC code for platform/support services (used on every invoice line). */
const SAC_PLATFORM_SERVICE = '9985';

/** The ledger entry types that are billable to a shop on a tax invoice. */
const BILLABLE_TYPES: LedgerEntryType[] = [
  LedgerEntryType.COMMISSION,
  LedgerEntryType.PLATFORM_FEE,
];

/**
 * GstService — NearBaz's GST compliance: config, monthly tax-invoice
 * generation from the commission/platform-fee ledger, GSTR-1 (B2B) export, and
 * a CA-friendly summary.
 *
 * HARD RULES:
 *  - All money is integer paise; GST is 18% via the shared computeGst helper.
 *  - The CGST/SGST/IGST split is derived FROM the computeGst total (never
 *    re-multiplied) so the three components always sum to the 18% total exactly.
 *  - Invoice numbers are allocated atomically off PlatformGstConfig.invoiceSeq.
 *  - Generation is idempotent per shop+period (no double-invoicing).
 */
@Injectable()
export class GstService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Split the 18% GST on a base into CGST/SGST (intra-state) or IGST
   * (inter-state), keyed off NearBaz's home state (PlatformGstConfig.stateCode)
   * vs the shop's state. A null shopStateCode is assumed intra-state.
   *
   * The total GST is taken from computeGst(base).gstPaise first, then split so
   * cgst + sgst + igst === that total exactly (no rounding drift):
   *  - intra-state: cgst = floor(gst/2), sgst = gst - cgst, igst = 0
   *  - inter-state: igst = gst, cgst = sgst = 0
   */
  async splitGst(
    basePaise: number,
    shopStateCode: string | null,
  ): Promise<{ cgstPaise: number; sgstPaise: number; igstPaise: number }> {
    const config = await this.prisma.platformGstConfig.findFirst();
    const homeState = config?.stateCode ?? null;
    return this.splitGstWithHome(basePaise, shopStateCode, homeState);
  }

  /** Pure split given an explicit home state (avoids re-reading config per line). */
  private splitGstWithHome(
    basePaise: number,
    shopStateCode: string | null,
    homeState: string | null,
  ): { cgstPaise: number; sgstPaise: number; igstPaise: number } {
    const gstPaise = computeGst(basePaise).gstPaise;
    // Intra-state when the shop's state matches the home state OR is unknown.
    const intraState = shopStateCode == null || shopStateCode === homeState;
    if (intraState) {
      const cgstPaise = Math.floor(gstPaise / 2);
      const sgstPaise = gstPaise - cgstPaise;
      return { cgstPaise, sgstPaise, igstPaise: 0 };
    }
    return { cgstPaise: 0, sgstPaise: 0, igstPaise: gstPaise };
  }

  /** The single PlatformGstConfig row (or null when not yet configured). */
  getConfig() {
    return this.prisma.platformGstConfig.findFirst();
  }

  /**
   * Create or update the single PlatformGstConfig row. There is exactly one
   * config row app-wide, so we update the existing one when present and create
   * otherwise. invoicePrefix falls back to the schema default ("PW") when omitted.
   */
  async upsertConfig(dto: UpsertGstConfigDto) {
    const existing = await this.prisma.platformGstConfig.findFirst();
    const data = {
      legalName: dto.legalName,
      gstin: dto.gstin,
      stateCode: dto.stateCode,
      address: dto.address ?? null,
      ...(dto.invoicePrefix != null ? { invoicePrefix: dto.invoicePrefix } : {}),
    };
    if (existing) {
      return this.prisma.platformGstConfig.update({ where: { id: existing.id }, data });
    }
    return this.prisma.platformGstConfig.create({ data });
  }

  /**
   * Generate monthly tax invoices for the window [periodStart, periodEnd).
   *
   * For every shop with billable (COMMISSION + PLATFORM_FEE) ledger entries
   * created in the window, sum the positive basePaise as the taxable value,
   * split GST by the shop's state, allocate a sequential invoice number
   * (atomically bumping PlatformGstConfig.invoiceSeq), and write an ISSUED
   * TaxInvoice with one line per ledger entry (SAC 9985).
   *
   * Idempotent per shop+period: an existing invoice for the same shopId +
   * periodStart + periodEnd is left untouched. Shops with zero taxable are
   * skipped. Returns the invoices created on this run.
   */
  async generateMonthlyInvoices(periodStart: Date, periodEnd: Date) {
    const config = await this.prisma.platformGstConfig.findFirst();
    const homeState = config?.stateCode ?? null;

    // Pull all billable entries in the window, grouped in memory by shop.
    const entries = await this.prisma.ledgerEntry.findMany({
      where: {
        type: { in: BILLABLE_TYPES },
        createdAt: { gte: periodStart, lt: periodEnd },
      },
      select: {
        id: true,
        shopId: true,
        type: true,
        basePaise: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    const byShop = new Map<string, typeof entries>();
    for (const e of entries) {
      // Only positive commission/platform-fee amounts are billable.
      if (e.basePaise <= 0) continue;
      const list = byShop.get(e.shopId) ?? [];
      list.push(e);
      byShop.set(e.shopId, list);
    }

    const created: Awaited<ReturnType<typeof this.issueInvoiceForShop>>[] = [];
    for (const [shopId, shopEntries] of byShop) {
      const taxableValuePaise = shopEntries.reduce((s, e) => s + e.basePaise, 0);
      if (taxableValuePaise <= 0) continue;

      // Idempotency: never double-invoice the same shop+period.
      const existing = await this.prisma.taxInvoice.findFirst({
        where: { shopId, periodStart, periodEnd, deletedAt: null },
      });
      if (existing) continue;

      const invoice = await this.issueInvoiceForShop(
        shopId,
        shopEntries,
        periodStart,
        periodEnd,
        homeState,
      );
      if (invoice) created.push(invoice);
    }
    return created;
  }

  /** Allocate a number + persist one shop's invoice and its lines atomically. */
  private async issueInvoiceForShop(
    shopId: string,
    shopEntries: { id: string; type: unknown; basePaise: number; shopId: string }[],
    periodStart: Date,
    periodEnd: Date,
    homeState: string | null,
  ) {
    const shop = await this.prisma.shop.findUnique({
      where: { id: shopId },
      select: { gstin: true, stateCode: true },
    });
    const shopStateCode = shop?.stateCode ?? null;

    const now = new Date();
    const year = now.getFullYear();

    return this.prisma.$transaction(async (tx) => {
      // Atomically read + bump the running sequence on the single config row.
      const config = await tx.platformGstConfig.findFirst();
      if (!config) {
        throw new Error('PlatformGstConfig is not set — configure GST before issuing invoices');
      }
      const seq = config.invoiceSeq + 1;
      await tx.platformGstConfig.update({
        where: { id: config.id },
        data: { invoiceSeq: seq },
      });
      const invoiceNumber = `${config.invoicePrefix}-${year}-${String(seq).padStart(6, '0')}`;

      // Build per-entry lines with their own GST split, summing the totals.
      let taxableValuePaise = 0;
      let cgstPaise = 0;
      let sgstPaise = 0;
      let igstPaise = 0;
      const lineData = shopEntries.map((e) => {
        const split = this.splitGstWithHome(e.basePaise, shopStateCode, homeState);
        taxableValuePaise += e.basePaise;
        cgstPaise += split.cgstPaise;
        sgstPaise += split.sgstPaise;
        igstPaise += split.igstPaise;
        return {
          ledgerEntryId: e.id,
          description: this.lineDescription(e.type),
          hsnSac: SAC_PLATFORM_SERVICE,
          taxableValuePaise: e.basePaise,
          gstRate: 0.18,
          cgstPaise: split.cgstPaise,
          sgstPaise: split.sgstPaise,
          igstPaise: split.igstPaise,
        };
      });
      const totalPaise = taxableValuePaise + cgstPaise + sgstPaise + igstPaise;

      return tx.taxInvoice.create({
        data: {
          invoiceNumber,
          shopId,
          shopGstin: shop?.gstin ?? null,
          shopStateCode,
          periodStart,
          periodEnd,
          taxableValuePaise,
          cgstPaise,
          sgstPaise,
          igstPaise,
          totalPaise,
          status: TaxInvoiceStatus.ISSUED,
          issuedAt: now,
          lines: { create: lineData },
        },
        include: { lines: true },
      });
    });
  }

  /** Human-readable line description for a billable ledger entry type. */
  private lineDescription(type: unknown): string {
    switch (type) {
      case LedgerEntryType.COMMISSION:
        return 'Platform commission on orders';
      case LedgerEntryType.PLATFORM_FEE:
        return 'Platform / support service fee';
      default:
        return 'Platform service';
    }
  }

  /**
   * List tax invoices, most recent first, optionally filtered by status
   * (DRAFT|ISSUED). Soft-deleted rows are excluded. Includes their lines.
   */
  listInvoices(status?: string) {
    const statusFilter =
      status === TaxInvoiceStatus.DRAFT || status === TaxInvoiceStatus.ISSUED
        ? { status }
        : {};
    return this.prisma.taxInvoice.findMany({
      where: { deletedAt: null, ...statusFilter },
      orderBy: { createdAt: 'desc' },
      include: { lines: true },
    });
  }

  /**
   * GSTR-1 B2B export for the window: one row per ISSUED TaxInvoice plus a
   * totals summary. Money stays in integer paise; invoiceDate is the issuedAt
   * ISO string (falls back to createdAt when somehow absent).
   */
  async exportGstr1(periodStart: Date, periodEnd: Date) {
    const invoices = await this.prisma.taxInvoice.findMany({
      where: {
        status: TaxInvoiceStatus.ISSUED,
        deletedAt: null,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      orderBy: { issuedAt: 'asc' },
    });

    const b2b = invoices.map((inv) => ({
      gstin: inv.shopGstin,
      invoiceNumber: inv.invoiceNumber,
      invoiceDate: (inv.issuedAt ?? inv.createdAt).toISOString(),
      taxableValuePaise: inv.taxableValuePaise,
      rate: 18,
      cgstPaise: inv.cgstPaise,
      sgstPaise: inv.sgstPaise,
      igstPaise: inv.igstPaise,
      totalPaise: inv.totalPaise,
    }));

    const totals = b2b.reduce(
      (acc, r) => {
        acc.taxableValuePaise += r.taxableValuePaise;
        acc.cgstPaise += r.cgstPaise;
        acc.sgstPaise += r.sgstPaise;
        acc.igstPaise += r.igstPaise;
        acc.totalPaise += r.totalPaise;
        return acc;
      },
      {
        invoiceCount: b2b.length,
        taxableValuePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 0,
      },
    );

    return { periodStart: periodStart.toISOString(), periodEnd: periodEnd.toISOString(), b2b, totals };
  }

  /**
   * CA-friendly summary for the window: overall taxable / CGST / SGST / IGST /
   * total-GST / invoice count, plus a per-shop breakdown. Considers ISSUED
   * invoices only.
   */
  async summaryReport(periodStart: Date, periodEnd: Date) {
    const invoices = await this.prisma.taxInvoice.findMany({
      where: {
        status: TaxInvoiceStatus.ISSUED,
        deletedAt: null,
        periodStart: { gte: periodStart },
        periodEnd: { lte: periodEnd },
      },
      orderBy: { issuedAt: 'asc' },
    });

    let totalTaxablePaise = 0;
    let totalCgstPaise = 0;
    let totalSgstPaise = 0;
    let totalIgstPaise = 0;
    let totalPaise = 0;

    const perShopMap = new Map<
      string,
      {
        shopId: string;
        shopGstin: string | null;
        invoiceCount: number;
        taxablePaise: number;
        cgstPaise: number;
        sgstPaise: number;
        igstPaise: number;
        totalPaise: number;
      }
    >();

    for (const inv of invoices) {
      totalTaxablePaise += inv.taxableValuePaise;
      totalCgstPaise += inv.cgstPaise;
      totalSgstPaise += inv.sgstPaise;
      totalIgstPaise += inv.igstPaise;
      totalPaise += inv.totalPaise;

      const row = perShopMap.get(inv.shopId) ?? {
        shopId: inv.shopId,
        shopGstin: inv.shopGstin,
        invoiceCount: 0,
        taxablePaise: 0,
        cgstPaise: 0,
        sgstPaise: 0,
        igstPaise: 0,
        totalPaise: 0,
      };
      row.invoiceCount += 1;
      row.taxablePaise += inv.taxableValuePaise;
      row.cgstPaise += inv.cgstPaise;
      row.sgstPaise += inv.sgstPaise;
      row.igstPaise += inv.igstPaise;
      row.totalPaise += inv.totalPaise;
      perShopMap.set(inv.shopId, row);
    }

    return {
      periodStart: periodStart.toISOString(),
      periodEnd: periodEnd.toISOString(),
      invoiceCount: invoices.length,
      totalTaxablePaise,
      totalCgstPaise,
      totalSgstPaise,
      totalIgstPaise,
      totalGstPaise: totalCgstPaise + totalSgstPaise + totalIgstPaise,
      totalPaise,
      perShop: Array.from(perShopMap.values()),
    };
  }
}
