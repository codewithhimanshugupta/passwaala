/**
 * WEB / fallback print module (Metro picks `print.native.ts` on device). Thermal
 * Bluetooth (ESC/POS) printing needs the native module + Classic Bluetooth SPP,
 * neither of which exists on web or in Expo Go — so every operation here is a
 * graceful no-op that signals "unsupported" rather than crashing. The POS sale
 * itself still completes; only the physical print is unavailable.
 */
import type { PrintableSale, PaperWidth } from './escpos';

/** A Bluetooth printer the user can pick / connect to. */
export interface PrinterDevice {
  name: string;
  address: string;
}

/** Thrown when a print is attempted on a platform without a thermal printer. */
export class PrintUnavailableError extends Error {
  constructor(message = 'Printing needs the installed NearBaz Partner app with a Bluetooth printer.') {
    super(message);
    this.name = 'PrintUnavailableError';
  }
}

/** False on web — no thermal printer available. */
export function isPrintingSupported(): boolean {
  return false;
}

/** No saved printer on web. */
export async function getSavedPrinter(): Promise<PrinterDevice | null> {
  return null;
}

/** No paired printers on web. */
export async function listPairedPrinters(): Promise<PrinterDevice[]> {
  return [];
}

/** Cannot connect on web. */
export async function connectPrinter(_device: PrinterDevice): Promise<void> {
  throw new PrintUnavailableError();
}

/** Cannot print on web. */
export async function printSale(
  _sale: PrintableSale,
  _opts?: { width?: PaperWidth; withKot?: boolean },
): Promise<void> {
  throw new PrintUnavailableError();
}
