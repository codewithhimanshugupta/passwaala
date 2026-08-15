/**
 * NearBaz rider design tokens. Mirrors the shopkeeper design system so the
 * whole partner family reads consistently, but swaps in a distinct rider accent
 * (a confident orange) for the app chrome, nav, and primary rider actions so the
 * rider app is instantly recognisable. Kept framework-free (plain objects) so
 * RN + RN Web consume them identically.
 */
export const theme = {
  color: {
    // NearBaz brand green (kept for continuity with the customer app).
    primary: '#0B7A4B',
    primaryDark: '#075C39',
    primarySoft: '#E6F4EC',

    // Rider accent — a confident orange used for the app chrome, nav, and
    // primary rider actions so the rider app reads distinctly from shopkeeper.
    accent: '#F2711C',
    accentDark: '#C25510',
    accentSoft: '#FDEEE0',

    // Neutrals.
    bg: '#F4F5F9',
    surface: '#FFFFFF',
    surfaceAlt: '#F5F6F8',
    text: '#101828',
    textMuted: '#667085',
    textFaint: '#98A2B3',
    border: '#E4E7EC',
    borderStrong: '#D0D5DD',

    // Feedback.
    danger: '#DC2626',
    dangerSoft: '#FDECEC',
    success: '#0B7A4B',
    successSoft: '#E6F4EC',
    warning: '#B45309',
    warningSoft: '#FDF3E7',
    info: '#F2711C',
    infoSoft: '#FDEEE0',

    white: '#FFFFFF',
    overlay: 'rgba(16,24,40,0.45)',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 10, lg: 16, xl: 22, pill: 999 },
  font: {
    display: 30,
    h1: 24,
    h2: 20,
    h3: 17,
    body: 15,
    small: 13,
    tiny: 11,
  },
  /** Reusable elevation presets (work on RN + RN Web). */
  shadow: {
    sm: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 1,
    },
    md: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.08,
      shadowRadius: 12,
      elevation: 3,
    },
    lg: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 10 },
      shadowOpacity: 0.12,
      shadowRadius: 24,
      elevation: 6,
    },
  },
  /** On large screens the web app centers to a mobile-width column. */
  maxContentWidth: 480,
} as const;

/** Format integer paise as ₹X.XX for display. */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? '-' : ''}₹${(abs / 100).toFixed(2)}`;
}

/** Format paise as a whole-rupee string (₹499) when there are no paise. */
export function formatRupeesShort(paise: number): string {
  const rupees = paise / 100;
  const whole = Number.isInteger(rupees);
  return whole ? `₹${rupees}` : formatRupees(paise);
}
