/**
 * NearBaz design tokens + image helpers (customer app).
 *
 * A single, framework-free token set (plain objects) so RN and RN Web consume
 * them identically. Extends the shared base with a fuller palette, spacing,
 * radii, shadow tokens and typography used across every screen.
 */
import { Platform, type ViewStyle } from 'react-native';

export const theme = {
  color: {
    // Brand
    primary: '#0B7A4B', // NearBaz green
    primaryDark: '#075C39',
    primaryLight: '#E6F4EC',
    accent: '#F59E0B', // warm saffron accent for badges/prices
    accentLight: '#FEF3C7',

    // Surfaces
    bg: '#FFFFFF',
    surface: '#F5F6F8',
    surfaceAlt: '#EEF1F4',
    card: '#FFFFFF',
    overlay: 'rgba(17, 24, 39, 0.55)',

    // Text
    text: '#111827',
    textMuted: '#6B7280',
    textFaint: '#9CA3AF',
    onPrimary: '#FFFFFF',

    // Lines
    border: '#E5E7EB',
    borderStrong: '#D1D5DB',

    // Status
    danger: '#DC2626',
    dangerLight: '#FEE2E2',
    success: '#0B7A4B',
    successLight: '#E6F4EC',
    warning: '#B45309',
    warningLight: '#FEF3C7',
    info: '#1D4ED8',
    infoLight: '#DBEAFE',
    star: '#F59E0B',
  },
  space: { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 },
  radius: { sm: 6, md: 10, lg: 16, xl: 24, pill: 999 },
  font: {
    hero: 30,
    h1: 24,
    h2: 20,
    h3: 17,
    body: 15,
    small: 13,
    tiny: 11,
  },
  weight: {
    regular: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
    heavy: '800',
  },
  /** On large screens the web app centers to a mobile-width column (plan). */
  maxContentWidth: 480,
} as const;

/** Cross-platform elevation/shadow presets (web boxShadow + native shadow*). */
export const shadow: Record<'sm' | 'md' | 'lg', ViewStyle> = {
  sm: Platform.select({
    web: { boxShadow: '0 1px 2px rgba(16, 24, 40, 0.06), 0 1px 3px rgba(16, 24, 40, 0.08)' } as ViewStyle,
    default: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: 0.08,
      shadowRadius: 2,
      elevation: 1,
    },
  }) as ViewStyle,
  md: Platform.select({
    web: { boxShadow: '0 4px 8px rgba(16, 24, 40, 0.08), 0 2px 4px rgba(16, 24, 40, 0.06)' } as ViewStyle,
    default: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 4 },
      shadowOpacity: 0.1,
      shadowRadius: 8,
      elevation: 3,
    },
  }) as ViewStyle,
  lg: Platform.select({
    web: { boxShadow: '0 12px 24px rgba(16, 24, 40, 0.12), 0 4px 8px rgba(16, 24, 40, 0.08)' } as ViewStyle,
    default: {
      shadowColor: '#101828',
      shadowOffset: { width: 0, height: 12 },
      shadowOpacity: 0.16,
      shadowRadius: 24,
      elevation: 8,
    },
  }) as ViewStyle,
};

/** Format integer paise as ₹X.XX for display. */
export function formatRupees(paise: number): string {
  const negative = paise < 0;
  const abs = Math.abs(paise);
  return `${negative ? '-' : ''}₹${(abs / 100).toFixed(2)}`;
}

/** Compact rupee format without paise when whole (₹275, ₹27.50). */
export function formatRupeesShort(paise: number): string {
  const rupees = paise / 100;
  const negative = paise < 0;
  const abs = Math.abs(rupees);
  const str = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  return `${negative ? '-' : ''}₹${str}`;
}

/** Human distance: "180 m" / "1.2 km". */
export function formatDistance(meters?: number): string | null {
  if (meters == null) return null;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}

/**
 * A friendly delivery-time estimate derived from distance (no prep-time model
 * yet): ~12 min base prep + travel at ~18 km/h, presented as a rounded 10-minute
 * band like "25–35 mins". Returns null when distance is unknown.
 */
export function formatEta(meters?: number): string | null {
  if (meters == null) return null;
  const travelMin = (meters / 1000 / 18) * 60; // 18 km/h
  const total = 12 + travelMin;
  const low = Math.max(10, Math.round(total / 5) * 5 - 5);
  return `${low}–${low + 10} mins`;
}

/** Great-circle distance (metres) between two {lat,lng} points. */
export function haversineMeters(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Estimate the minutes remaining on an order, given item count, the relevant
 * travel distance, and the order status. Prep time scales with quantity and is
 * dropped once the order is READY; travel time scales with distance and, once
 * out for delivery, should be the rider→drop distance so it shrinks live.
 * Returns null when there's nothing meaningful to show.
 */
export function estimateOrderMinutes(opts: {
  status: string;
  itemCount: number;
  travelMeters?: number | null;
}): number | null {
  const { status, itemCount, travelMeters } = opts;
  if (status === 'DELIVERED' || status === 'REJECTED' || status === 'CANCELLED' || status === 'REFUND_PENDING' || status === 'REFUNDED') {
    return null;
  }
  const prep = Math.min(30, 8 + 1.5 * Math.max(0, itemCount));
  const travel = travelMeters != null ? (travelMeters / 1000 / 18) * 60 : 0;
  switch (status) {
    case 'PLACED':
    case 'ACCEPTED':
    case 'AWAITING_PAYMENT':
    case 'PREPARING':
      return prep + travel;
    case 'READY':
    case 'RIDER_ASSIGNED':
      return travel; // packed, waiting on / heading to pickup
    case 'OUT_FOR_DELIVERY':
      return travel; // travelMeters should be rider→drop here
    default:
      return prep + travel;
  }
}

/** Round a minutes value to a friendly band like "20–30 mins" (or "~5 mins"). */
export function formatMinutesBand(min: number | null): string | null {
  if (min == null) return null;
  if (min <= 4) return '~5 mins';
  // Clamp absurd values (far-apart test coords / bad data) to a sane ceiling.
  if (min > 90) return '60+ mins';
  const low = Math.max(5, Math.round(min / 5) * 5 - 5);
  return `${low}–${low + 10} mins`;
}

/**
 * Resolve an image URL. Seed data has placeholder/localhost URLs with no real
 * images, so we fall back to picsum by a stable id seed. If a real, reachable
 * (non-localhost) URL is present we use it.
 */
function usableUrl(url?: string | null): url is string {
  if (!url) return false;
  // Allow real localhost:3000 uploads (dev API). Block bare localhost (no port)
  // and 127.0.0.1 which are stale seed values that resolve to nothing.
  if (url.includes('localhost:3000') || url.includes('localhost:')) {
    return /^https?:\/\//.test(url); // real dev API URL — use it
  }
  if (url.includes('localhost') || url.includes('127.0.0.1')) return false;
  return /^https?:\/\//.test(url);
}

/** Deterministic gradient pair from a seed string. */
function seedGradient(seed: string): [string, string] {
  const code = [...(seed || 'p')].reduce((n, c) => n + c.charCodeAt(0), 0);
  const pairs: [string, string][] = [
    ['#667eea','#764ba2'], ['#f093fb','#f5576c'], ['#4facfe','#00f2fe'],
    ['#43e97b','#38f9d7'], ['#fa709a','#fee140'], ['#a18cd1','#fbc2eb'],
    ['#ffecd2','#fcb69f'], ['#a1c4fd','#c2e9fb'],
  ];
  return pairs[code % pairs.length];
}

/** SVG banner placeholder with shop name text centered on gradient. */
function svgBanner(name: string, w: number, h: number): string {
  const safe = (name || 'Shop').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const [c1, c2] = seedGradient(name);
  const words = safe.split(' ');
  const mid = Math.ceil(words.length / 2);
  const l1 = words.slice(0, mid).join(' ');
  const l2 = words.slice(mid).join(' ') || null;
  const lineH = h * 0.14;
  const fs1 = Math.min(28, Math.max(16, Math.floor(w / (l1.length * 0.55 + 1))));
  const fs2 = l2 ? Math.min(22, Math.max(13, Math.floor(w / (l2.length * 0.6 + 1)))) : 0;
  const cy = h / 2;
  const y1 = l2 ? cy - lineH * 0.5 : cy;
  const y2 = cy + lineH * 1.1;
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">`,
    `<defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%">`,
    `<stop offset="0%" style="stop-color:${c1}"/>`,
    `<stop offset="100%" style="stop-color:${c2}"/>`,
    `</linearGradient></defs>`,
    `<rect width="${w}" height="${h}" fill="url(#g)"/>`,
    // Subtle dark vignette overlay so text pops on any gradient
    `<rect width="${w}" height="${h}" fill="rgba(0,0,0,0.22)"/>`,
    // Line 1 — main name
    `<text x="${w/2}" y="${y1}" text-anchor="middle" dominant-baseline="central"`,
    ` font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"`,
    ` font-size="${fs1}" font-weight="900" fill="white"`,
    ` style="text-shadow:0 1px 4px rgba(0,0,0,0.4)">${l1}</text>`,
    // Line 2 — rest of name (if long)
    l2 ? [
      `<text x="${w/2}" y="${y2}" text-anchor="middle" dominant-baseline="central"`,
      ` font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif"`,
      ` font-size="${fs2}" font-weight="700" fill="rgba(255,255,255,0.92)"`,
      ` style="text-shadow:0 1px 3px rgba(0,0,0,0.35)">${l2}</text>`,
    ].join('') : '',
    `</svg>`,
  ].join('');
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** SVG logo placeholder — initials badge on gradient circle. */
function svgLogo(name: string, size: number): string {
  const safe = (name || 'S').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const init = safe.split(' ').map(w=>w[0]?.toUpperCase()??'').slice(0,2).join('');
  const [c1, c2] = seedGradient(name);
  const r = size / 2;
  const fs = Math.round(size * (init.length > 1 ? 0.32 : 0.38));
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" style="stop-color:${c1}"/><stop offset="100%" style="stop-color:${c2}"/></linearGradient></defs><circle cx="${r}" cy="${r}" r="${r}" fill="url(#g)"/><text x="${r}" y="${r}" text-anchor="middle" dominant-baseline="central" font-family="-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif" font-size="${fs}" font-weight="800" fill="white">${init}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/**
 * Image helpers — return the real image URL if usable, else NULL (no SVG
 * placeholder). Callers render a clean text/initial card when null, per the
 * "no image = no image, just text" design. `svgBanner`/`svgLogo` are kept only
 * for any legacy caller but are no longer used by these helpers.
 */
export function bannerImage(id: string, url?: string | null, _w = 400, _h = 200, _name?: string): string | null {
  return usableUrl(url) ? url : null;
}

export function logoImage(id: string, url?: string | null, _size = 96, _name?: string): string | null {
  return usableUrl(url) ? url : null;
}

export function productImage(id: string, url?: string | null, _size = 120, _name?: string): string | null {
  return usableUrl(url) ? url : null;
}

