import { OTPWidget } from '@msg91comm/sendotp-react-native';

/**
 * MSG91 OTP widget wrapper. Sends/verifies SMS OTP client-side; verifyOtp
 * returns the widget access token which the backend re-verifies server-side
 * before creating an account or resetting credentials.
 *
 * Dev fallback: if the widget can't send/verify (no SMS credits, web, SDK not
 * wired), in __DEV__ we return a sentinel reqId and an empty token — the API's
 * non-production path bypasses MSG91 verification, so local testing still works.
 */
const WIDGET_ID = '36687066776e353634313839';
const TOKEN_AUTH = '561099TX5dEjdynr26a8157afP1';

const DEV = typeof __DEV__ !== 'undefined' && __DEV__;
const DEV_REQ_ID = 'dev-reqid';

let initialized = false;
function ensureInit(): void {
  if (!initialized) {
    OTPWidget.initializeWidget(WIDGET_ID, TOKEN_AUTH);
    initialized = true;
  }
}

/** Send an OTP to a 10-digit Indian number. Returns the reqId for verify/resend. */
export async function sendOtp(phone10: string): Promise<string> {
  try {
    ensureInit();
    const res = (await OTPWidget.sendOTP({ identifier: `91${phone10}` })) as {
      type?: string;
      message?: unknown;
    };
    if (res?.type === 'success') return String(res.message);
    throw new Error(res?.message ? String(res.message) : 'Could not send OTP.');
  } catch (e) {
    if (DEV) return DEV_REQ_ID;
    throw e;
  }
}

/** Verify a 6-digit OTP against a reqId. Returns the widget access token. */
export async function verifyOtp(reqId: string, otp: string): Promise<string> {
  try {
    const res = (await OTPWidget.verifyOTP({ reqId, otp })) as {
      type?: string;
      message?: unknown;
    };
    if (res?.type === 'success') return String(res.message);
    throw new Error(res?.message ? String(res.message) : 'Incorrect OTP.');
  } catch (e) {
    if (DEV && reqId === DEV_REQ_ID) return '';
    throw e;
  }
}

/** Resend an OTP for an existing reqId. */
export async function resendOtp(reqId: string): Promise<void> {
  try {
    ensureInit();
    await OTPWidget.retryOTP({ reqId });
  } catch (e) {
    if (DEV && reqId === DEV_REQ_ID) return;
    throw e;
  }
}
