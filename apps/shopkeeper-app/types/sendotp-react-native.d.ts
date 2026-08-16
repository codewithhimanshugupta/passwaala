/**
 * Local type shim for @msg91comm/sendotp-react-native.
 *
 * The published package sets "main": "index.ts" and ships no compiled types,
 * so `tsc` would otherwise pull the package's raw .ts source into the program
 * and report its internal (pre-existing, third-party) type errors. A tsconfig
 * `paths` redirect points the import here for type-checking only — Metro uses
 * its own node resolution at bundle time, so the real package runs unchanged.
 *
 * Only the surface our wrapper (src/msg91.ts) uses is declared.
 */
export const OTPWidget: {
  initializeWidget(widgetId: string, tokenAuth: string): void;
  sendOTP(data: { identifier: string }): Promise<{ type?: string; message?: unknown }>;
  verifyOTP(data: { reqId: string; otp: string }): Promise<{ type?: string; message?: unknown }>;
  retryOTP(data: { reqId: string }): Promise<{ type?: string; message?: unknown }>;
};
