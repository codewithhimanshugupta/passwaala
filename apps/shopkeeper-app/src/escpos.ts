/**
 * Pure-TypeScript ESC/POS receipt + KOT (kitchen order ticket) formatter.
 *
 * Two output forms are produced from the same sale data:
 *   • `formatReceipt` / `formatKot` → column-aligned PLAIN TEXT (alignment done
 *     with spaces) that any thermal printer renders correctly via a single
 *     `printText` call. This is what the native print path (print.native.ts)
 *     sends, because it's robust across the many ESC/POS library API shapes.
 *   • `buildReceiptBytes` / `buildKotBytes` → raw ESC/POS byte streams (init,
 *     alignment, emphasis, cut) for any transport that writes bytes directly.
 *
 * Width-aware: 58mm paper = 32 chars/line, 80mm = 48. Money is printed as
 * `Rs.` + rupees (thermal heads can't render the ₹ glyph), integer paise in,
 * always two decimals out. Non-ASCII characters are stripped to '?' since cheap
 * ESC/POS printers have no Devanagari code page.
 */

export type PaperWidth = 58 | 80;

/** One printable line item (name already resolved to a display string). */
export interface PrintableSaleItem {
  name: string;
  qty: number;
  /** Unit price in paise. */
  pricePaise: number;
}

/** Everything the receipt / KOT need — assembled locally so it prints offline. */
export interface PrintableSale {
  shopName: string;
  /** Human bill reference (server shortId when online; a local id offline). */
  billRef: string;
  /** ISO 8601 timestamp of the sale. */
  createdAt: string;
  items: PrintableSaleItem[];
  subtotalPaise: number;
  totalPaise: number;
  /** Cash handed over (optional — enables the change line). */
  cashTenderedPaise?: number;
  /** Change due back (optional). */
  changePaise?: number;
  notes?: string;
  addressLine?: string;
  contactPhone?: string;
  /** True when the sale is still queued offline (prints a "will sync" note). */
  queuedOffline?: boolean;
}

/** Characters per line for the given paper width. */
export function charsForWidth(width: PaperWidth): number {
  return width === 80 ? 48 : 32;
}

/** integer paise → "Rs.123.00" (ASCII only; ₹ is not printable on thermal heads). */
function money(paise: number): string {
  const neg = paise < 0;
  const abs = Math.abs(paise);
  return `${neg ? '-' : ''}Rs.${(abs / 100).toFixed(2)}`;
}

/** Strip characters a basic ESC/POS printer can't render. */
function ascii(s: string): string {
  // eslint-disable-next-line no-control-regex
  return (s ?? '').replace(/[^\x20-\x7E]/g, '?');
}

/** A full-width divider line of dashes. */
function divider(width: PaperWidth): string {
  return '-'.repeat(charsForWidth(width));
}

/** Centre `text` within the line width (padded with leading spaces). */
function centre(text: string, width: PaperWidth): string {
  const cols = charsForWidth(width);
  const t = ascii(text).slice(0, cols);
  const pad = Math.max(0, Math.floor((cols - t.length) / 2));
  return ' '.repeat(pad) + t;
}

/**
 * A left/right two-column line: `left` flush left, `right` flush right, filled
 * with spaces between. When `left` is too long it wraps onto continuation lines
 * so the right value always stays aligned on the first line.
 */
function lr(left: string, right: string, width: PaperWidth): string {
  const cols = charsForWidth(width);
  const r = ascii(right);
  const maxLeft = Math.max(1, cols - r.length - 1);
  const l = ascii(left);
  if (l.length <= maxLeft) {
    const gap = cols - l.length - r.length;
    return l + ' '.repeat(Math.max(1, gap)) + r;
  }
  // Wrap the left text; the right value sits on the first line.
  const first = l.slice(0, maxLeft);
  const rest = l.slice(maxLeft);
  const firstLine = first + ' ' + r;
  const wrapped = wrap(rest, cols);
  return [firstLine, ...wrapped].join('\n');
}

/** Hard-wrap a string to the line width. */
function wrap(text: string, cols: number): string[] {
  const out: string[] = [];
  let s = ascii(text);
  while (s.length > cols) {
    out.push(s.slice(0, cols));
    s = s.slice(cols);
  }
  if (s.length) out.push(s);
  return out;
}

/** Local, readable date-time (dd/mm/yyyy hh:mm) from an ISO string. */
function stamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/**
 * The customer receipt as printer-ready plain text. One trailing newline per
 * line; alignment done with spaces so a single printText renders it faithfully.
 */
export function formatReceipt(sale: PrintableSale, width: PaperWidth = 58): string {
  const lines: string[] = [];
  lines.push(centre(sale.shopName, width));
  if (sale.addressLine) for (const w of wrap(sale.addressLine, charsForWidth(width))) lines.push(centre(w, width));
  if (sale.contactPhone) lines.push(centre(`Ph: ${sale.contactPhone}`, width));
  lines.push(centre('CASH RECEIPT', width));
  lines.push(divider(width));
  lines.push(lr(`Bill: ${sale.billRef}`, '', width));
  lines.push(lr(`Date: ${stamp(sale.createdAt)}`, '', width));
  lines.push(divider(width));
  lines.push(lr('Item', 'Amount', width));
  lines.push(divider(width));
  for (const it of sale.items) {
    const lineTotal = it.pricePaise * it.qty;
    // First line: item name + line total; second line: the qty x unit breakdown.
    lines.push(lr(ascii(it.name), money(lineTotal), width));
    lines.push(lr(`  ${it.qty} x ${money(it.pricePaise)}`, '', width));
  }
  lines.push(divider(width));
  lines.push(lr('Subtotal', money(sale.subtotalPaise), width));
  lines.push(lr('TOTAL', money(sale.totalPaise), width));
  if (typeof sale.cashTenderedPaise === 'number') {
    lines.push(lr('Cash', money(sale.cashTenderedPaise), width));
    if (typeof sale.changePaise === 'number') lines.push(lr('Change', money(sale.changePaise), width));
  }
  lines.push(divider(width));
  if (sale.notes) for (const w of wrap(sale.notes, charsForWidth(width))) lines.push(w);
  if (sale.queuedOffline) {
    lines.push(centre('* Offline sale - will sync *', width));
  }
  lines.push(centre('Thank you! Visit again', width));
  lines.push(centre('Powered by NearBaz', width));
  return lines.join('\n') + '\n';
}

/**
 * The KOT (kitchen order ticket) as printer-ready plain text — items + qty
 * only, NO prices (it's for fulfilment, not payment).
 */
export function formatKot(sale: PrintableSale, width: PaperWidth = 58): string {
  const lines: string[] = [];
  lines.push(centre('*** KOT ***', width));
  lines.push(lr(`Bill: ${sale.billRef}`, '', width));
  lines.push(lr(`Time: ${stamp(sale.createdAt)}`, '', width));
  lines.push(divider(width));
  for (const it of sale.items) {
    lines.push(lr(`${it.qty} x ${ascii(it.name)}`, '', width));
  }
  lines.push(divider(width));
  if (sale.notes) for (const w of wrap(sale.notes, charsForWidth(width))) lines.push(w);
  return lines.join('\n') + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────
// Raw ESC/POS byte builder — for transports that write bytes directly.
// ─────────────────────────────────────────────────────────────────────────────

const ESC = 0x1b;
const GS = 0x1d;
const LF = 0x0a;

/** Encode an ASCII string to bytes (non-ASCII already stripped by `ascii`). */
function strBytes(s: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < s.length; i += 1) out.push(s.charCodeAt(i) & 0xff);
  return out;
}

/** Turn printer-ready text (from formatReceipt/formatKot) into an ESC/POS byte
 *  stream: init, print the text, feed, then partial-cut. */
function textToEscPos(text: string): Uint8Array {
  const bytes: number[] = [];
  bytes.push(ESC, 0x40); // ESC @ — initialise
  for (const line of text.split('\n')) {
    bytes.push(...strBytes(ascii(line)));
    bytes.push(LF);
  }
  bytes.push(ESC, 0x64, 0x03); // ESC d 3 — feed 3 lines
  bytes.push(GS, 0x56, 0x01); // GS V 1 — partial cut
  return Uint8Array.from(bytes);
}

/** Raw ESC/POS bytes for the customer receipt. */
export function buildReceiptBytes(sale: PrintableSale, width: PaperWidth = 58): Uint8Array {
  return textToEscPos(formatReceipt(sale, width));
}

/** Raw ESC/POS bytes for the KOT. */
export function buildKotBytes(sale: PrintableSale, width: PaperWidth = 58): Uint8Array {
  return textToEscPos(formatKot(sale, width));
}
