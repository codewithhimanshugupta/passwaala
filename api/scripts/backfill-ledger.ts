/**
 * Backfill ledger accruals for DELIVERED orders that have no COMMISSION or
 * PLATFORM_FEE entry yet. Safe to re-run — accrueOnDelivery is idempotent
 * (it checks for existing entries before writing).
 *
 * Run: cd api && npx ts-node scripts/backfill-ledger.ts
 */
import { PrismaClient } from '@prisma/client';
import { LedgerEntryType } from '@nearbaz/shared';
import { computeGst } from '@nearbaz/shared';

const PLATFORM_FEE_PAISE = 1000; // ₹10

const prisma = new PrismaClient();

async function main() {
  // Find all DELIVERED orders that have no COMMISSION or PLATFORM_FEE entry.
  const allDelivered = await prisma.order.findMany({
    where: { status: 'DELIVERED', deletedAt: null },
    select: {
      id: true,
      shopId: true,
      originalTotalPaise: true,
      adjustedTotalPaise: true,
      platformFeePaise: true,
      deliveryFeePaise: true,
      commissionRateSnapshot: true,
    },
  });

  // Filter to those with no accrual entries yet
  const accrued = await prisma.ledgerEntry.findMany({
    where: { type: { in: ['COMMISSION', 'PLATFORM_FEE'] }, orderId: { not: null } },
    select: { orderId: true },
  });
  const accruedOrderIds = new Set(accrued.map(e => e.orderId!));
  const unaccrued = allDelivered.filter(o => !accruedOrderIds.has(o.id));

  console.log(`Found ${unaccrued.length} DELIVERED orders missing ledger entries.`);
  if (unaccrued.length === 0) { console.log('Nothing to do.'); return; }

  let done = 0;
  for (const order of unaccrued) {
    const shop = await prisma.shop.findUnique({
      where: { id: order.shopId },
      select: { commissionFreeUntil: true, creditLimitPaise: true, outstandingDuesPaise: true },
    });
    if (!shop) { console.log(`  skip ${order.id} — shop not found`); continue; }

    const total = order.adjustedTotalPaise ?? order.originalTotalPaise;
    const orderValuePaise = total - order.platformFeePaise - order.deliveryFeePaise;
    const inHoliday = shop.commissionFreeUntil != null && shop.commissionFreeUntil.getTime() > Date.now();

    const lines: Array<{ type: string; base: number }> = [];
    if (!inHoliday) {
      const commBase = Math.round(orderValuePaise * order.commissionRateSnapshot);
      if (commBase > 0) lines.push({ type: LedgerEntryType.COMMISSION, base: commBase });
    }
    lines.push({ type: LedgerEntryType.PLATFORM_FEE, base: PLATFORM_FEE_PAISE });

    let duesDelta = 0;
    const creates = lines.map((l) => {
      const gst = computeGst(l.base);
      duesDelta += gst.totalPaise;
      return prisma.ledgerEntry.create({
        data: {
          shopId: order.shopId,
          orderId: order.id,
          type: l.type as never,
          basePaise: gst.basePaise,
          gstPaise: gst.gstPaise,
          totalPaise: gst.totalPaise,
        },
      });
    });

    await prisma.$transaction([
      ...creates,
      prisma.shop.update({
        where: { id: order.shopId },
        data: { outstandingDuesPaise: { increment: duesDelta } },
      }),
    ]);

    const newDues = shop.outstandingDuesPaise + duesDelta;
    if (newDues >= shop.creditLimitPaise) {
      await prisma.shop.update({ where: { id: order.shopId }, data: { isOpen: false } });
    }

    console.log(`  ✓ ${order.id.slice(0, 8)} — +${duesDelta / 100}₹ dues`);
    done++;
  }

  console.log(`\nDone: ${done}/${unaccrued.length} orders backfilled.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
