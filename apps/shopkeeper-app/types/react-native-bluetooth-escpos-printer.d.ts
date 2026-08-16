/**
 * Local type shim for `react-native-bluetooth-escpos-printer`.
 *
 * The package ships no TypeScript declarations, so `tsc` would report
 * "could not find a declaration file". This ambient module declares only the
 * surface our native print path (src/print.native.ts) uses — the real native
 * module is autolinked into the EAS dev-client build; Metro resolves it at
 * bundle time on device. The web build never imports it (print.ts is a no-op).
 */
declare module 'react-native-bluetooth-escpos-printer' {
  /** A paired / discovered Bluetooth device. */
  export interface BtDevice {
    name?: string;
    address: string;
  }

  export const BluetoothManager: {
    /** Android: request enabling Bluetooth; resolves with paired device list. */
    enableBluetooth(): Promise<string[] | undefined>;
    isBluetoothEnabled(): Promise<boolean>;
    /** Returns a JSON string: { found: BtDevice[], paired: BtDevice[] }. */
    scanDevices(): Promise<string>;
    connect(address: string): Promise<void>;
    disconnect(address: string): Promise<void>;
    getConnectedDeviceAddress(): Promise<string | null>;
    EVENT_DEVICE_ALREADY_PAIRED: string;
    EVENT_DEVICE_FOUND: string;
    EVENT_CONNECTION_LOST: string;
  };

  export const BluetoothEscposPrinter: {
    ALIGN: { LEFT: number; CENTER: number; RIGHT: number };
    printerInit(): Promise<void>;
    printerAlign(align: number): Promise<void>;
    printText(text: string, options: Record<string, unknown>): Promise<void>;
    printAndFeed(lines: number): Promise<void>;
    cutOnePoint?(): Promise<void>;
  };
}
