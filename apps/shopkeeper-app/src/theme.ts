/**
 * NearBaz shopkeeper design tokens. A fuller partner design system layered on
 * the shared base: a distinct partner accent (indigo/blue) alongside the
 * NearBaz green, richer neutrals, spacing, radii, shadows, and typography.
 * Kept framework-free (plain objects) so RN + RN Web consume them identically.
 */
import { Platform } from 'react-native';
export const theme = {
  color: {
    // NearBaz brand green (kept for continuity with the customer app).
    primary: '#0B7A4B',
    primaryDark: '#075C39',
    primarySoft: '#E6F4EC',

    // Partner accent — a confident indigo used for the dashboard chrome,
    // nav, and primary partner actions so the shopkeeper app reads distinctly.
    accent: '#3F51D6',
    accentDark: '#2C3AAE',
    accentSoft: '#EAECFB',

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
    info: '#3F51D6',
    infoSoft: '#EAECFB',

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

/** Paise → a plain rupee string for editable inputs ("125" or "125.50", "" for 0/undefined). */
export function paiseToRupeeInput(paise?: number | null): string {
  if (paise === undefined || paise === null || paise === 0) return '';
  const rupees = paise / 100;
  return Number.isInteger(rupees) ? String(rupees) : rupees.toFixed(2);
}

/** Rupee input string → integer paise (0 for empty/invalid). */
export function rupeeInputToPaise(input: string): number {
  const n = Number(input.trim());
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.round(n * 100);
}

/**
 * A tiny solid-color (neutral #E4E7EC) 1x1 PNG data-URI. React Native's <Image>
 * cannot render SVG data-URIs, so on native we return this renderable neutral
 * placeholder (stretched to fill) instead of the SVG below.
 */
const NATIVE_PLACEHOLDER_PNG =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGN48vwNAAVqArjtQBuUAAAAAElFTkSuQmCC';

/**
 * Generate a branded SVG placeholder as a data URI — shop name displayed
 * over a gradient background. Used when no real storefront photo exists.
 *
 * On native, React Native's <Image> cannot render SVG data-URIs, so we return a
 * neutral solid-color PNG data-URI instead (still a string URI for callers).
 */
export function placeholderImage(seed: string, width = 400, height = 300): string {
  if (Platform.OS !== 'web') return NATIVE_PLACEHOLDER_PNG;
  const name = (seed || 'NearBaz').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const code = [...(seed || 'p')].reduce((n, c) => n + c.charCodeAt(0), 0);
  const gradients = [
    ['#667eea','#764ba2'], ['#f093fb','#f5576c'], ['#4facfe','#00f2fe'],
    ['#43e97b','#38f9d7'], ['#fa709a','#fee140'], ['#a18cd1','#fbc2eb'],
    ['#ffecd2','#fcb69f'], ['#a1c4fd','#c2e9fb'],
  ];
  const [c1, c2] = gradients[code % gradients.length];
  const words = name.split(' ');
  const mid = Math.ceil(words.length / 2);
  const line1 = words.slice(0, mid).join(' ');
  const line2 = words.slice(mid).join(' ');
  const fs1 = Math.min(22, Math.max(13, Math.floor(width / (line1.length * 0.62 + 1))));
  const fs2 = line2 ? Math.min(18, Math.max(11, Math.floor(width / (line2.length * 0.65 + 1)))) : 0;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${c1}"/><stop offset="100%" style="stop-color:${c2}"/></linearGradient></defs><rect width="${width}" height="${height}" fill="url(#g)"/><rect x="0" y="${height - 56}" width="${width}" height="56" fill="rgba(0,0,0,0.38)"/><text x="${width/2}" y="${height-(line2?33:24)}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fs1}" font-weight="800" fill="white">${line1}</text>${line2?`<text x="${width/2}" y="${height-11}" text-anchor="middle" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fs2}" font-weight="600" fill="rgba(255,255,255,0.88)">${line2}</text>`:''}</svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Return `url` when it's a real, loadable URL (includes localhost:3000 uploads
 * in dev); fall back to a placeholder for bare localhost / missing values.
 */
export function resolveImage(url: string | null | undefined, seed: string, w = 400, h = 300): string {
  if (!url) return placeholderImage(seed, w, h);
  // Allow localhost:PORT (real dev API). Block bare localhost / 127 (stale seed).
  if (url.includes('localhost:') || url.includes('localhost:3000')) {
    return /^https?:\/\//.test(url) ? url : placeholderImage(seed, w, h);
  }
  if (url.includes('localhost') || url.includes('127.0.0.1')) return placeholderImage(seed, w, h);
  return /^https?:\/\//.test(url) ? url : placeholderImage(seed, w, h);
}
