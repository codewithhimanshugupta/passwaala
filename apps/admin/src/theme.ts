/**
 * NearBaz Admin design tokens. A serious, professional admin palette (navy /
 * slate accent) — distinct from the consumer green so operators know they are in
 * the back office. Kept framework-free (plain objects) so RN + RN Web consume
 * them identically.
 */
export const theme = {
  color: {
    // Brand / accent — deep navy for a back-office feel.
    primary: '#1E293B', // slate-800 navy
    primaryDark: '#0F172A', // slate-900
    accent: '#2563EB', // blue-600 for interactive accents / links
    accentDark: '#1D4ED8',

    // Surfaces
    bg: '#F1F5F9', // slate-100 app canvas
    surface: '#FFFFFF', // card surface
    surfaceAlt: '#F8FAFC', // subtle inner surface / table stripes
    sidebar: '#0F172A', // slate-900 sidebar
    sidebarText: '#CBD5E1', // slate-300
    sidebarActive: '#2563EB',

    // Ink
    text: '#0F172A', // slate-900
    textMuted: '#64748B', // slate-500
    textFaint: '#94A3B8', // slate-400
    border: '#E2E8F0', // slate-200
    borderStrong: '#CBD5E1', // slate-300

    // Reserved status palette (good / warning / serious / critical) — used only
    // for state badges + alerts, never as decorative "series" colors.
    good: '#15803D', // green-700
    goodBg: '#DCFCE7',
    warning: '#B45309', // amber-700
    warningBg: '#FEF3C7',
    serious: '#C2410C', // orange-700
    seriousBg: '#FFEDD5',
    critical: '#B91C1C', // red-700
    criticalBg: '#FEE2E2',
    info: '#1D4ED8', // blue-700
    infoBg: '#DBEAFE',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 10, lg: 16, pill: 999 },
  font: {
    display: 32,
    h1: 24,
    h2: 20,
    h3: 17,
    body: 15,
    small: 13,
    tiny: 11,
  },
  /** The admin panel is a wide desktop surface, not a mobile column. */
  maxContentWidth: 1180,
  sidebarWidth: 232,
  shadow: {
    // A subtle card elevation that works on RN Web.
    card: {
      shadowColor: '#0F172A',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.06,
      shadowRadius: 3,
      elevation: 2,
    },
  },
} as const;

/** Format integer paise as ₹X,XX,XXX.XX (Indian grouping) for display. */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  const rupees = abs / 100;
  const formatted = rupees.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${negative ? '-' : ''}₹${formatted}`;
}

/** Compact ₹ for big KPI tiles: ₹1.2L / ₹3.4Cr / ₹9,999. Integer paise in. */
export function formatRupeesCompact(paise: number): string {
  const negative = paise < 0;
  const rupees = Math.abs(paise) / 100;
  let out: string;
  if (rupees >= 1e7) out = `${(rupees / 1e7).toFixed(2)}Cr`;
  else if (rupees >= 1e5) out = `${(rupees / 1e5).toFixed(2)}L`;
  else if (rupees >= 1e3) out = `${(rupees / 1e3).toFixed(1)}K`;
  else out = rupees.toFixed(0);
  return `${negative ? '-' : ''}₹${out}`;
}
