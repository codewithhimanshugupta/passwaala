/**
 * Generate storefront banner SVGs for all shops — clean white card with
 * the shop name styled in two colours (black + brand green) matching the
 * design reference, saved to uploads/ and written to storefrontPhotoUrl.
 *
 * Width 600 × Height 200 — fills the banner slot in the customer app while
 * keeping the name large and readable.
 *
 * Run: cd api && npx ts-node scripts/generate-storefronts.ts
 */
import { PrismaClient } from '@prisma/client';
import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';

const prisma = new PrismaClient();

const CATEGORY_ACCENT: Record<string, string> = {
  kirana:      '#EA580C',
  dairy:       '#2563EB',
  medical:     '#16A34A',
  'fruits-veg':'#CA8A04',
  bakery:      '#9333EA',
  electronics: '#0284C7',
  clothing:    '#E11D48',
  hardware:    '#57534E',
  stationery:  '#D97706',
};

const CATEGORY_BG: Record<string, string> = {
  kirana:      '#FFF7ED',
  dairy:       '#EFF6FF',
  medical:     '#F0FDF4',
  'fruits-veg':'#FEFCE8',
  bakery:      '#FDF4FF',
  electronics: '#F0F9FF',
  clothing:    '#FFF1F2',
  hardware:    '#FAFAF9',
  stationery:  '#FFFBEB',
};

const CATEGORY_EMOJI: Record<string, string> = {
  kirana:      '🛒', dairy:'🥛', medical:'💊', 'fruits-veg':'🥦',
  bakery:'🍞', electronics:'💡', clothing:'👕', hardware:'🔧', stationery:'✏️',
};

function escape(s: string): string {
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

/** Split name into two halves for two-tone colouring. */
function splitName(name: string): [string, string] {
  const words = name.split(' ');
  if (words.length === 1) return [words[0], ''];
  const mid = Math.ceil(words.length / 2);
  return [words.slice(0, mid).join(' '), words.slice(mid).join(' ')];
}

function makeFontSize(line1: string, line2: string, w: number): number {
  const longest = Math.max(line1.length, line2.length || 0);
  // ~0.55 character width ratio at this font; max 48, min 22
  return Math.min(48, Math.max(22, Math.floor(w / (longest * 0.55 + 2))));
}

function generateStorefrontSvg(name: string, category: string): string {
  const W = 600, H = 200;
  const accent = CATEGORY_ACCENT[category] ?? '#25D366';
  const bg = CATEGORY_BG[category] ?? '#ffffff';
  const emoji = CATEGORY_EMOJI[category] ?? '🏪';
  const [p1, p2] = splitName(name);
  const safe1 = escape(p1), safe2 = escape(p2);
  const fs = makeFontSize(p1, p2, W);
  const cy = p2 ? H / 2 - fs * 0.55 : H / 2;

  return `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <!-- Background -->
  <rect width="100%" height="100%" fill="${bg}"/>

  <!-- Subtle bottom accent strip -->
  <rect x="0" y="${H - 6}" width="${W}" height="6" fill="${accent}" opacity="0.7"/>

  <!-- Large faint emoji watermark -->
  <text x="${W - 24}" y="${H - 18}" text-anchor="end"
    font-size="80" opacity="0.07" font-family="Apple Color Emoji, Segoe UI Emoji, sans-serif">${emoji}</text>

  <!-- Shop name — first half dark, second half accent -->
  <text x="50%" y="${cy}" text-anchor="middle" dominant-baseline="middle"
    font-size="${fs}" font-family="Poppins, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif">
    <tspan fill="#111111" font-weight="700">${safe1}</tspan>${p2 ? `<tspan fill="${accent}" font-weight="700"> ${safe2}</tspan>` : ''}
  </text>

  ${p2 ? '' : `<!-- Single-word: show accent on last letter -->
  `}

  <!-- Category chip -->
  <rect x="20" y="${H - 36}" width="${p2 ? p2.length * 8 + 40 : 80}" height="24" rx="12"
    fill="${accent}" opacity="0.12"/>
  <text x="40" y="${H - 20}" font-size="12" font-weight="700" fill="${accent}"
    font-family="-apple-system, BlinkMacSystemFont, sans-serif">${escape(category.toUpperCase())}</text>
</svg>`;
}

async function main() {
  const allShops = await prisma.shop.findMany({
    where: { deletedAt: null },
    select: { id: true, name: true, shopCategory: true, storefrontPhotoUrl: true },
  });
  // Only process shops that have no real storefront photo
  const shops = allShops.filter(s =>
    !s.storefrontPhotoUrl ||
    s.storefrontPhotoUrl.includes('storefront.jpg') ||
    s.storefrontPhotoUrl.includes('picsum') ||
    s.storefrontPhotoUrl.includes('placeholder')
  );

  const uploadsDir = path.join(__dirname, '..', 'uploads');
  if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

  let done = 0;
  for (const shop of shops) {
    const filename = `storefront-${shop.id}.svg`;
    const filepath = path.join(uploadsDir, filename);
    const svg = generateStorefrontSvg(shop.name, shop.shopCategory);
    fs.writeFileSync(filepath, svg, 'utf8');
    await prisma.shop.update({
      where: { id: shop.id },
      data: { storefrontPhotoUrl: `http://localhost:3000/uploads/${filename}` },
    });
    console.log(`  ✓ ${shop.name}`);
    done++;
  }
  console.log(`\nDone: ${done} storefront SVGs generated.`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
