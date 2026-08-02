/**
 * Generate deterministic SVG logos for all shops that have no logoUrl.
 * Each SVG uses the shop's initials, category-based color palette, and a clean
 * geometric design. Saves to api/uploads/ and updates Shop.logoUrl.
 *
 * Run: cd api && npx ts-node scripts/generate-logos.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const CATEGORY_PALETTES: Record<string, { bg: string; accent: string; icon: string }> = {
  kirana:      { bg: '#FFF7ED', accent: '#EA580C', icon: '🛒' },
  dairy:       { bg: '#EFF6FF', accent: '#2563EB', icon: '🥛' },
  medical:     { bg: '#F0FDF4', accent: '#16A34A', icon: '💊' },
  'fruits-veg':{ bg: '#FEFCE8', accent: '#CA8A04', icon: '🥦' },
  bakery:      { bg: '#FDF2F8', accent: '#9333EA', icon: '🍞' },
  electronics: { bg: '#F0F9FF', accent: '#0284C7', icon: '💡' },
  clothing:    { bg: '#FFF1F2', accent: '#E11D48', icon: '👕' },
  hardware:    { bg: '#F5F5F4', accent: '#57534E', icon: '🔧' },
  stationery:  { bg: '#FEFCE8', accent: '#D97706', icon: '✏️' },
};

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map(w => w[0]?.toUpperCase() ?? '')
    .slice(0, 2)
    .join('');
}

/** A deterministic "random" number from a string seed (0..1). */
function seededRand(seed: string, offset = 0): number {
  const hash = crypto.createHash('md5').update(seed + offset).digest('hex');
  return parseInt(hash.slice(0, 8), 16) / 0xFFFFFFFF;
}

function generateSvg(name: string, category: string, shopId: string): string {
  const pal = CATEGORY_PALETTES[category] ?? { bg: '#F8FAFC', accent: '#6366F1', icon: '🏪' };
  const init = initials(name);
  const size = 200;

  // Decorative circles in background
  const c1x = Math.round(seededRand(shopId, 1) * size);
  const c1y = Math.round(seededRand(shopId, 2) * size);
  const c2x = Math.round(seededRand(shopId, 3) * size);
  const c2y = Math.round(seededRand(shopId, 4) * size);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <defs>
    <clipPath id="circle"><circle cx="${size/2}" cy="${size/2}" r="${size/2}"/></clipPath>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:${pal.bg}"/>
      <stop offset="100%" style="stop-color:${pal.accent}22"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <circle cx="${size/2}" cy="${size/2}" r="${size/2}" fill="url(#grad)"/>

  <!-- Decorative circles -->
  <circle cx="${c1x}" cy="${c1y}" r="60" fill="${pal.accent}" opacity="0.08" clip-path="url(#circle)"/>
  <circle cx="${c2x}" cy="${c2y}" r="40" fill="${pal.accent}" opacity="0.06" clip-path="url(#circle)"/>

  <!-- Inner circle badge -->
  <circle cx="${size/2}" cy="${size/2}" r="72" fill="${pal.accent}" opacity="0.12"/>
  <circle cx="${size/2}" cy="${size/2}" r="68" fill="white" opacity="0.9"/>

  <!-- Initials -->
  <text x="${size/2}" y="${size/2 + 2}" text-anchor="middle" dominant-baseline="middle"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-size="${init.length > 1 ? 52 : 64}" font-weight="800" fill="${pal.accent}">${init}</text>

  <!-- Bottom ribbon -->
  <rect x="0" y="${size - 32}" width="${size}" height="32" fill="${pal.accent}" opacity="0.85" clip-path="url(#circle)"/>
  <text x="${size/2}" y="${size - 12}" text-anchor="middle" dominant-baseline="middle"
    font-family="-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
    font-size="11" font-weight="700" fill="white" letter-spacing="0.5">${name.toUpperCase().slice(0, 18)}</text>
</svg>`;
}

async function main() {
  const shops = await prisma.shop.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, shopCategory: true, logoUrl: true },
  });

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  let updated = 0;
  for (const shop of shops) {
    const filename = `logo-${shop.id}.svg`;
    const filepath = path.join(uploadsDir, filename);
    const svg = generateSvg(shop.name, shop.shopCategory, shop.id);
    fs.writeFileSync(filepath, svg, 'utf8');
    await prisma.shop.update({
      where: { id: shop.id },
      data: { logoUrl: `http://localhost:3000/uploads/${filename}` },
    });
    console.log(`  ✓ ${shop.name} → ${filename}`);
    updated++;
  }
  console.log(`\nDone: ${updated} logos generated.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
