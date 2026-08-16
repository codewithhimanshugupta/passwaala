-- Rider ledger + GST tax invoices + platform GST config + shop GST identity.
-- Additive only (rule #7): all new tables/columns, nothing dropped.

-- New enums (native Postgres enums, matching Prisma).
CREATE TYPE "RiderLedgerType" AS ENUM ('DELIVERY_EARNING', 'EARNING_PAYOUT', 'COD_COLLECTED', 'COD_DEPOSIT');
CREATE TYPE "TaxInvoiceStatus" AS ENUM ('DRAFT', 'ISSUED');

-- Shop GST identity (nullable).
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "gstin"     TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "stateCode" TEXT;
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "legalName" TEXT;

-- RiderLedger: itemized rider earnings/dues history + payout audit trail.
CREATE TABLE "RiderLedger" (
  "id"          TEXT NOT NULL,
  "riderUserId" TEXT NOT NULL,
  "orderId"     TEXT,
  "type"        "RiderLedgerType" NOT NULL,
  "amountPaise" INTEGER NOT NULL,
  "note"        TEXT,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"   TIMESTAMP(3),
  CONSTRAINT "RiderLedger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "RiderLedger_riderUserId_idx" ON "RiderLedger"("riderUserId");
CREATE INDEX "RiderLedger_orderId_idx" ON "RiderLedger"("orderId");
CREATE INDEX "RiderLedger_type_idx" ON "RiderLedger"("type");

-- PlatformGstConfig: NearBaz's own tax identity + invoice counter (single row).
CREATE TABLE "PlatformGstConfig" (
  "id"            TEXT NOT NULL,
  "legalName"     TEXT NOT NULL,
  "gstin"         TEXT NOT NULL,
  "stateCode"     TEXT NOT NULL,
  "address"       TEXT,
  "invoicePrefix" TEXT NOT NULL DEFAULT 'PW',
  "invoiceSeq"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PlatformGstConfig_pkey" PRIMARY KEY ("id")
);

-- TaxInvoice: monthly consolidated tax invoice per shop.
CREATE TABLE "TaxInvoice" (
  "id"                TEXT NOT NULL,
  "invoiceNumber"     TEXT NOT NULL,
  "shopId"            TEXT NOT NULL,
  "shopGstin"         TEXT,
  "shopStateCode"     TEXT,
  "periodStart"       TIMESTAMP(3) NOT NULL,
  "periodEnd"         TIMESTAMP(3) NOT NULL,
  "taxableValuePaise" INTEGER NOT NULL,
  "cgstPaise"         INTEGER NOT NULL DEFAULT 0,
  "sgstPaise"         INTEGER NOT NULL DEFAULT 0,
  "igstPaise"         INTEGER NOT NULL DEFAULT 0,
  "totalPaise"        INTEGER NOT NULL,
  "status"            "TaxInvoiceStatus" NOT NULL DEFAULT 'DRAFT',
  "issuedAt"          TIMESTAMP(3),
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "deletedAt"         TIMESTAMP(3),
  CONSTRAINT "TaxInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "TaxInvoice_invoiceNumber_key" ON "TaxInvoice"("invoiceNumber");
CREATE INDEX "TaxInvoice_shopId_idx" ON "TaxInvoice"("shopId");
CREATE INDEX "TaxInvoice_status_idx" ON "TaxInvoice"("status");
ALTER TABLE "TaxInvoice" ADD CONSTRAINT "TaxInvoice_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- TaxInvoiceLine: one commission/platform-fee component of an invoice.
CREATE TABLE "TaxInvoiceLine" (
  "id"                TEXT NOT NULL,
  "invoiceId"         TEXT NOT NULL,
  "ledgerEntryId"     TEXT,
  "description"       TEXT NOT NULL,
  "hsnSac"            TEXT NOT NULL,
  "taxableValuePaise" INTEGER NOT NULL,
  "gstRate"           DOUBLE PRECISION NOT NULL DEFAULT 0.18,
  "cgstPaise"         INTEGER NOT NULL DEFAULT 0,
  "sgstPaise"         INTEGER NOT NULL DEFAULT 0,
  "igstPaise"         INTEGER NOT NULL DEFAULT 0,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TaxInvoiceLine_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "TaxInvoiceLine_invoiceId_idx" ON "TaxInvoiceLine"("invoiceId");
ALTER TABLE "TaxInvoiceLine" ADD CONSTRAINT "TaxInvoiceLine_invoiceId_fkey"
  FOREIGN KEY ("invoiceId") REFERENCES "TaxInvoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
