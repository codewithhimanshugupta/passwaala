/**
 * NATIVE thermal-printer module (Metro picks `.native.ts` on iOS/Android; the
 * web build uses print.ts). Drives a Classic-Bluetooth (SPP) ESC/POS thermal
 * printer via `react-native-bluetooth-escpos-printer` (autolinked into the EAS
 * dev-client build). Prints a CUSTOMER RECEIPT and, when requested, a KOT.
 *
 * The receipt/KOT layout is produced as column-aligned plain text by escpos.ts
 * and sent in one `printText` call — robust across printer models. The chosen
 * printer's address is persisted (kv) so it auto-reconnects on the next sale.
 *
 * NOTE: this path only runs in a native build with a paired thermal printer —
 * it cannot run on web or in Expo Go (no native module, and Web Bluetooth is
 * BLE-only while most thermal printers are Classic SPP).
 */
import { Platform } from 'react-native';
import { BluetoothManager, BluetoothEscposPrinter } from 'react-native-bluetooth-escpos-printer';
import { formatReceipt, formatKot, type PrintableSale, type PaperWidth } from './escpos';
import { kvGet, kvSet } from './kv';

/** A Bluetooth printer the user can pick / connect to. */
export interface PrinterDevice {
  name: string;
  address: string;
}

/** Thrown when no printer has been paired/selected yet. */
export class PrintUnavailableError extends Error {
  constructor(message = 'No printer connected. Pick your Bluetooth printer first.') {
    super(message);
    this.name = 'PrintUnavailableError';
  }
}

const SAVED_PRINTER_KEY = 'passwaala.shopkeeper.pos.printer.v1';

/** Native platforms support thermal printing. */
export function isPrintingSupported(): boolean {
  return Platform.OS === 'android' || Platform.OS === 'ios';
}

/** The last-connected printer, if any. */
export async function getSavedPrinter(): Promise<PrinterDevice | null> {
  return kvGet<PrinterDevice>(SAVED_PRINTER_KEY);
}

/** Persist the chosen printer so future sales reconnect automatically. */
async function savePrinter(device: PrinterDevice): Promise<void> {
  await kvSet(SAVED_PRINTER_KEY, device);
}

/**
 * Discover printers: ensures Bluetooth is on (Android), scans, and returns the
 * union of paired + freshly found devices (paired first). Names default to the
 * address when the device reports none.
 */
export async function listPairedPrinters(): Promise<PrinterDevice[]> {
  try {
    if (Platform.OS === 'android') {
      const enabled = await BluetoothManager.isBluetoothEnabled().catch(() => true);
      if (!enabled) await BluetoothManager.enableBluetooth().catch(() => undefined);
    }
    const raw = await BluetoothManager.scanDevices();
    const parsed = JSON.parse(raw) as {
      found?: { name?: string; address: string }[];
      paired?: { name?: string; address: string }[];
    };
    const seen = new Set<string>();
    const out: PrinterDevice[] = [];
    for (const d of [...(parsed.paired ?? []), ...(parsed.found ?? [])]) {
      if (!d?.address || seen.has(d.address)) continue;
      seen.add(d.address);
      out.push({ name: d.name || d.address, address: d.address });
    }
    return out;
  } catch {
    return [];
  }
}

/** Connect to a printer and remember it. */
export async function connectPrinter(device: PrinterDevice): Promise<void> {
  await BluetoothManager.connect(device.address);
  await savePrinter(device);
}

/** Ensure a printer is connected: reuse the connected one, else connect the saved one. */
async function ensureConnected(): Promise<void> {
  try {
    const current = await BluetoothManager.getConnectedDeviceAddress();
    if (current) return;
  } catch {
    /* fall through to reconnect */
  }
  const saved = await getSavedPrinter();
  if (!saved) throw new PrintUnavailableError();
  await BluetoothManager.connect(saved.address);
}

/** Print one block of printer-ready text, left-aligned, then feed. */
async function printBlock(text: string): Promise<void> {
  await BluetoothEscposPrinter.printerInit();
  await BluetoothEscposPrinter.printerAlign(BluetoothEscposPrinter.ALIGN.LEFT);
  await BluetoothEscposPrinter.printText(text, {});
  await BluetoothEscposPrinter.printAndFeed(3);
}

/**
 * Print the customer receipt (always) and the KOT (when `withKot`). Reconnects
 * to the saved printer if needed; throws `PrintUnavailableError` when none is
 * set so the caller can prompt the shopkeeper to pick one.
 */
export async function printSale(
  sale: PrintableSale,
  opts?: { width?: PaperWidth; withKot?: boolean },
): Promise<void> {
  const width = opts?.width ?? 58;
  await ensureConnected();
  await printBlock(formatReceipt(sale, width));
  if (opts?.withKot) {
    await printBlock(formatKot(sale, width));
  }
}
