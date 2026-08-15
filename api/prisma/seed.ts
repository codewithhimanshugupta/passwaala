/**
 * Dev seed — 25 shops across Jhansi with realistic products and real images.
 * All shops owned by +919876543210 (SHOPKEEPER).
 *
 * Run: cd api && npx ts-node prisma/seed.ts
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CENTER = { lat: 25.4484, lng: 78.5685 };

function offset(dLatM: number, dLngM: number) {
  const lat = CENTER.lat + dLatM / 111_111;
  const lng = CENTER.lng + dLngM / (111_111 * Math.cos((CENTER.lat * Math.PI) / 180));
  return { lat, lng };
}

async function setGeog(shopId: string, lng: number, lat: number) {
  await prisma.$executeRawUnsafe(
    `UPDATE "Shop" SET geog = ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography WHERE id = $3`,
    lng, lat, shopId,
  );
}

// Unsplash source URLs (free, no auth) — 400×200 banners, 96×96 logos
const IMG = {
  // Shop banners
  kirana_banner:    'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=800&q=80',
  dairy_banner:     'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&q=80',
  medical_banner:   'https://images.unsplash.com/photo-1587854692152-cbe660dbde88?w=800&q=80',
  fruitsVeg_banner: 'https://images.unsplash.com/photo-1488459716781-31db52582fe9?w=800&q=80',
  bakery_banner:    'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80',
  electronics_banner:'https://images.unsplash.com/photo-1518770660439-4636190af475?w=800&q=80',
  clothing_banner:  'https://images.unsplash.com/photo-1567401893414-76b7b1e5a7a5?w=800&q=80',
  hardware_banner:  'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=800&q=80',
  stationery_banner:'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=800&q=80',

  // Shop logos
  kirana_logo:    'https://images.unsplash.com/photo-1542838132-92c53300491e?w=200&q=80',
  dairy_logo:     'https://images.unsplash.com/photo-1550583724-b2692b85b150?w=200&q=80',
  medical_logo:   'https://images.unsplash.com/photo-1631549916768-4119b4123a21?w=200&q=80',
  fruitsVeg_logo: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=200&q=80',
  bakery_logo:    'https://images.unsplash.com/photo-1486427944299-d1955d23e34d?w=200&q=80',
  electronics_logo:'https://images.unsplash.com/photo-1498049794561-7780e7231661?w=200&q=80',
  clothing_logo:  'https://images.unsplash.com/photo-1441984904996-e0b6ba687e04?w=200&q=80',
  hardware_logo:  'https://images.unsplash.com/photo-1581244277943-fe4a9c777189?w=200&q=80',
  stationery_logo:'https://images.unsplash.com/photo-1497032628192-86f99bcd76bc?w=200&q=80',
};

// Product images by category
const PRODUCT_IMAGES: Record<string, string[]> = {
  kirana: [
    'https://images.unsplash.com/photo-1601493700631-2851bdbb7b46?w=400&q=80', // atta
    'https://images.unsplash.com/photo-1573910091977-f29c94d0f4b5?w=400&q=80', // salt
    'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&q=80', // butter
    'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=400&q=80', // maggi
    'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', // oil
    'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', // biscuit
    'https://images.unsplash.com/photo-1582735689369-4fe89db7114c?w=400&q=80', // detergent
    'https://images.unsplash.com/photo-1556229174-5e42a09e45af?w=400&q=80', // soap
  ],
  dairy: [
    'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', // milk
    'https://images.unsplash.com/photo-1571212515416-fca988083f72?w=400&q=80', // curd
    'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&q=80', // paneer
    'https://images.unsplash.com/photo-1618164436241-4473940d1f5c?w=400&q=80', // cheese
    'https://images.unsplash.com/photo-1570696516188-ade861b84a49?w=400&q=80', // lassi
    'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=400&q=80', // buttermilk
  ],
  medical: [
    'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', // medicine
    'https://images.unsplash.com/photo-1559757175-5700dde675bc?w=400&q=80', // thermometer
    'https://images.unsplash.com/photo-1587556930799-8dca6fad6d43?w=400&q=80', // sanitizer
    'https://images.unsplash.com/photo-1603398938378-e54eab446dde?w=400&q=80', // bandage
    'https://images.unsplash.com/photo-1564571605019-e17a78d18bdc?w=400&q=80', // dettol
    'https://images.unsplash.com/photo-1550572017-edd951b55104?w=400&q=80', // vitamins
  ],
  'fruits-veg': [
    'https://images.unsplash.com/photo-1546470427-e26264be0b0d?w=400&q=80', // tomato
    'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80', // onion
    'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80', // banana
    'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=400&q=80', // apple
    'https://images.unsplash.com/photo-1518977956812-cd3dbadaaf31?w=400&q=80', // potato
    'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&q=80', // spinach
    'https://images.unsplash.com/photo-1568584711075-3d021a7c3ca3?w=400&q=80', // cauliflower
    'https://images.unsplash.com/photo-1445282768818-728615cc910a?w=400&q=80', // carrot
  ],
  bakery: [
    'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', // bread
    'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80', // cake
    'https://images.unsplash.com/photo-1612240498936-65f5101365d2?w=400&q=80', // cream roll
    'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', // cookies
    'https://images.unsplash.com/photo-1586444248902-2f64eddc13df?w=400&q=80', // pav
    'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&q=80', // samosa
  ],
  electronics: [
    'https://images.unsplash.com/photo-1588345921523-c2dcdb7f1dcd?w=400&q=80', // cable
    'https://images.unsplash.com/photo-1609091839311-d5365f9ff1c5?w=400&q=80', // powerbank
    'https://images.unsplash.com/photo-1590658268037-6bf12165a8df?w=400&q=80', // earphones
    'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80', // screen glass
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80', // bulb
    'https://images.unsplash.com/photo-1484704324500-528d0ae4dc5b?w=400&q=80', // extension board
  ],
  clothing: [
    'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80', // tshirt
    'https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?w=400&q=80', // formal shirt
    'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=80', // jeans
    'https://images.unsplash.com/photo-1572804013427-4d7ca7268217?w=400&q=80', // kurti
    'https://images.unsplash.com/photo-1601379329542-31c59347e2b9?w=400&q=80', // dupatta
    'https://images.unsplash.com/photo-1519238263530-99bdd11df2ea?w=400&q=80', // kids frock
  ],
  hardware: [
    'https://images.unsplash.com/photo-1572981779307-38b8cabb2407?w=400&q=80', // hammer
    'https://images.unsplash.com/photo-1581166397057-235af2b3c6dd?w=400&q=80', // screwdriver
    'https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=400&q=80', // paint brush
    'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80', // pvc pipe
    'https://images.unsplash.com/photo-1589939705384-5185137a7f0f?w=400&q=80', // putty
    'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=400&q=80', // drill bit
  ],
  stationery: [
    'https://images.unsplash.com/photo-1531346878377-a5be20888e57?w=400&q=80', // notebook
    'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=400&q=80', // gel pen
    'https://images.unsplash.com/photo-1517697471339-4aa32003c11a?w=400&q=80', // geometry box
    'https://images.unsplash.com/photo-1586769852836-bc069f19e1b6?w=400&q=80', // sticky notes
    'https://images.unsplash.com/photo-1471107340929-a87cd0f5b5f3?w=400&q=80', // highlighter
    'https://images.unsplash.com/photo-1603486002664-c8f9f7df66d3?w=400&q=80', // a4 paper
  ],
};

type ShopDef = {
  name: string; cat: string; area: string; upi: string; off: { lat: number; lng: number };
  open: boolean; rating: number; rc: number; delivery: number; min: number;
  free: number | null; platform: boolean; self: boolean;
};

const SHOPS: ShopDef[] = [
  { name: 'Sharma Kirana Store', cat: 'kirana', area: 'Sadar Bazaar', upi: 'sharma.kirana@upi', off: offset(0, 0), open: true, rating: 4.5, rc: 24, delivery: 2000, min: 0, free: 20000, platform: false, self: true },
  { name: 'Gupta Dairy & Sweets', cat: 'dairy', area: 'Sadar Bazaar', upi: 'gupta.dairy@upi', off: offset(100, 80), open: true, rating: 4.3, rc: 18, delivery: 1500, min: 5000, free: null, platform: false, self: true },
  { name: 'Jeevan Medical Hall', cat: 'medical', area: 'Sadar Bazaar', upi: 'jeevan.med@upi', off: offset(-80, 120), open: true, rating: 4.7, rc: 41, delivery: 0, min: 0, free: null, platform: false, self: false },
  { name: 'Fresh Harvest Veggie', cat: 'fruits-veg', area: 'Sadar Bazaar', upi: 'freshharvest@upi', off: offset(60, -100), open: true, rating: 4.1, rc: 9, delivery: 2500, min: 3000, free: 25000, platform: true, self: true },
  { name: 'Jai Ganesh Kirana', cat: 'kirana', area: 'Sipri Bazaar', upi: 'jaig.kirana@upi', off: offset(400, 300), open: true, rating: 4.2, rc: 15, delivery: 1800, min: 0, free: 15000, platform: true, self: false },
  { name: 'Sunrise Milk Booth', cat: 'dairy', area: 'Sipri Bazaar', upi: 'sunrise.milk@upi', off: offset(450, 200), open: true, rating: 3.9, rc: 7, delivery: 1200, min: 2000, free: null, platform: false, self: true },
  { name: 'Raksha Medical Store', cat: 'medical', area: 'Sipri Bazaar', upi: 'raksha.med@upi', off: offset(350, 400), open: false, rating: 4.6, rc: 33, delivery: 0, min: 0, free: null, platform: false, self: false },
  { name: 'Annapurna Grocery', cat: 'kirana', area: 'Mawai Road', upi: 'annapurna@upi', off: offset(-300, 500), open: true, rating: 4.0, rc: 12, delivery: 2200, min: 0, free: 18000, platform: true, self: true },
  { name: 'Vijay Dairy Point', cat: 'dairy', area: 'Mawai Road', upi: 'vijay.dairy@upi', off: offset(-250, 450), open: true, rating: 4.4, rc: 21, delivery: 1500, min: 4000, free: null, platform: false, self: true },
  { name: 'Green Valley Organic', cat: 'fruits-veg', area: 'Mawai Road', upi: 'greenvalley@upi', off: offset(-350, 550), open: true, rating: 4.6, rc: 28, delivery: 3000, min: 5000, free: 30000, platform: true, self: true },
  { name: 'Tech Zone Electronics', cat: 'electronics', area: 'Civil Lines', upi: 'techzone@upi', off: offset(600, -200), open: true, rating: 4.3, rc: 19, delivery: 3500, min: 10000, free: null, platform: false, self: true },
  { name: 'Laxmi Cloth House', cat: 'clothing', area: 'Civil Lines', upi: 'laxmi.cloth@upi', off: offset(550, -300), open: true, rating: 4.1, rc: 11, delivery: 2500, min: 5000, free: null, platform: false, self: true },
  { name: 'Digital World Computers', cat: 'electronics', area: 'Civil Lines', upi: 'digitalworld@upi', off: offset(700, -150), open: false, rating: 3.8, rc: 5, delivery: 4000, min: 20000, free: null, platform: false, self: true },
  { name: 'Roti Ghar Bakery', cat: 'bakery', area: 'Civil Lines', upi: 'rotighar@upi', off: offset(620, -280), open: true, rating: 4.8, rc: 47, delivery: 1500, min: 3000, free: 20000, platform: true, self: true },
  { name: 'Shyam Supermarket', cat: 'kirana', area: 'Mewatipura', upi: 'shyam.super@upi', off: offset(-500, -400), open: true, rating: 4.3, rc: 22, delivery: 2000, min: 0, free: 20000, platform: true, self: true },
  { name: 'Prabha Health Pharmacy', cat: 'medical', area: 'Mewatipura', upi: 'prabha.health@upi', off: offset(-550, -350), open: true, rating: 4.5, rc: 16, delivery: 0, min: 0, free: null, platform: false, self: false },
  { name: 'Meena Fashions', cat: 'clothing', area: 'Mewatipura', upi: 'meena.fashion@upi', off: offset(-480, -420), open: true, rating: 4.0, rc: 8, delivery: 2500, min: 5000, free: null, platform: false, self: true },
  { name: 'Ganga Fruits & Dry Fruits', cat: 'fruits-veg', area: 'Pashan Road', upi: 'ganga.fruits@upi', off: offset(200, -600), open: true, rating: 4.2, rc: 14, delivery: 2800, min: 4000, free: 28000, platform: true, self: true },
  { name: 'Soni Sweet Corner', cat: 'bakery', area: 'Pashan Road', upi: 'soni.sweet@upi', off: offset(150, -650), open: true, rating: 4.7, rc: 39, delivery: 1200, min: 2000, free: 15000, platform: false, self: true },
  { name: 'Vishal Mobile & Accessories', cat: 'electronics', area: 'Pashan Road', upi: 'vishal.mob@upi', off: offset(250, -580), open: true, rating: 4.1, rc: 10, delivery: 3000, min: 10000, free: null, platform: false, self: true },
  { name: 'Kuldeep General Store', cat: 'kirana', area: 'Nai Basti', upi: 'kuldeep.store@upi', off: offset(-700, 200), open: true, rating: 3.9, rc: 6, delivery: 2500, min: 0, free: null, platform: true, self: true },
  { name: 'Ratan Hardware & Paint', cat: 'hardware', area: 'Nai Basti', upi: 'ratan.hw@upi', off: offset(-750, 150), open: true, rating: 4.4, rc: 17, delivery: 3000, min: 5000, free: null, platform: false, self: true },
  { name: 'Mittal Book House', cat: 'stationery', area: 'Nai Basti', upi: 'mittal.books@upi', off: offset(-680, 250), open: true, rating: 4.3, rc: 13, delivery: 2000, min: 1000, free: 10000, platform: false, self: true },
  { name: 'Bunty Hardware Store', cat: 'hardware', area: 'Rampur', upi: 'bunty.hw@upi', off: offset(800, 600), open: false, rating: 4.0, rc: 9, delivery: 3500, min: 5000, free: null, platform: false, self: true },
  { name: 'Akash Stationery Books', cat: 'stationery', area: 'Rampur', upi: 'akash.stat@upi', off: offset(850, 550), open: true, rating: 4.2, rc: 11, delivery: 2500, min: 0, free: null, platform: false, self: true },
];

const PRODUCTS: Record<string, Array<[string, number, number, number]>> = {
  kirana: [
    ['Aashirvaad Atta 5kg', 25500, 28000, 40],
    ['Tata Salt 1kg', 2800, 3000, 100],
    ['Amul Butter 500g', 27500, 29000, 25],
    ['Maggi Masala 12-pack', 14400, 15600, 60],
    ['Fortune Sunflower Oil 1L', 14000, 15500, 35],
    ['Parle-G Biscuit 800g', 5500, 6000, 80],
    ['Surf Excel Matic 1kg', 18500, 20000, 30],
    ['Lifebuoy Soap 100g ×4', 7200, 8000, 50],
  ],
  dairy: [
    ['Full Cream Milk 1L', 6800, 7000, 50],
    ['Fresh Curd 400g', 4000, 4200, 30],
    ['Paneer 200g', 9000, 9500, 15],
    ['Amul Processed Cheese Slices', 11500, 12000, 20],
    ['Mango Lassi 200ml', 3000, 3200, 40],
    ['Chaas Buttermilk 500ml', 2500, 2800, 35],
  ],
  medical: [
    ['Paracetamol 500mg Strip ×10', 3000, 3200, 200],
    ['Dr. Morepen Digital Thermometer', 18000, 22000, 12],
    ['Dettol Hand Sanitizer 200ml', 9900, 12000, 40],
    ['Crepe Bandage 10cm', 5500, 6500, 30],
    ['Dettol Antiseptic Liquid 100ml', 8500, 10000, 25],
    ['Vitamin C + Zinc Tablets ×20', 12000, 14000, 50],
  ],
  'fruits-veg': [
    ['Fresh Tomatoes 1kg', 4000, 4500, 30],
    ['Red Onion 1kg', 3500, 4000, 40],
    ['Banana Dozen', 6000, 6500, 25],
    ['Shimla Apple 1kg', 18000, 20000, 20],
    ['Aloo (Potato) 1kg', 2800, 3200, 60],
    ['Fresh Palak 250g', 2500, 3000, 20],
    ['Gobhi (Cauliflower)', 4500, 5000, 15],
    ['Gajar (Carrot) 500g', 3000, 3500, 30],
  ],
  bakery: [
    ['Britannia White Bread 400g', 4500, 5000, 30],
    ['Fresh Butter Cake 500g', 18000, 20000, 15],
    ['Cream Roll ×6', 9000, 10000, 20],
    ['Assorted Cookies 200g', 7500, 8500, 35],
    ['Ladi Pav ×6', 3500, 4000, 40],
    ['Crispy Samosa ×4', 6000, 7000, 25],
  ],
  electronics: [
    ['Anker USB-C Cable 1m', 8000, 12000, 20],
    ['Mi Power Bank 10000mAh', 95000, 120000, 8],
    ['boAt BassHeads Wired Earphones', 35000, 50000, 15],
    ['Tempered Glass Screen Guard', 5000, 8000, 40],
    ['Syska LED Bulb 9W', 9000, 12000, 30],
    ['Belkin 4-Port Extension Board', 28000, 35000, 12],
  ],
  clothing: [
    ['Men\'s Cotton Crew T-Shirt', 29900, 39900, 25],
    ['Men\'s Check Formal Shirt', 69900, 89900, 15],
    ['Slim Fit Denim Jeans', 89900, 119900, 10],
    ['Women\'s Printed Kurti', 59900, 79900, 20],
    ['Silk Dupatta with Embroidery', 39900, 55000, 18],
    ['Girls Cotton Frock 3-6 yrs', 45000, 60000, 12],
  ],
  hardware: [
    ['Taparia Hammer 500g', 22000, 28000, 15],
    ['Stanley Screwdriver Set ×6', 18000, 25000, 20],
    ['Asian Paints Brush Set', 12000, 16000, 30],
    ['PVC Pipe ½ inch 1m', 8000, 10000, 50],
    ['Birla White Wall Putty 1kg', 6500, 8000, 40],
    ['Bosch HSS Drill Bit Set', 35000, 45000, 10],
  ],
  stationery: [
    ['Classmate Notebook A4 ×3', 9000, 11000, 50],
    ['Reynolds Gel Pen ×10', 7500, 9000, 40],
    ['Camlin Geometry Box', 14000, 18000, 25],
    ['3M Post-it Sticky Notes ×100', 5500, 7000, 60],
    ['Faber-Castell Highlighter ×5', 8000, 10000, 35],
    ['JK Copier A4 Paper Ream 500', 35000, 40000, 20],
  ],
};

function getBanner(cat: string): string {
  const key = (cat.replace('-', '') + '_banner') as keyof typeof IMG;
  const alt = (cat.split('-')[0] + '_banner') as keyof typeof IMG;
  return IMG[key] ?? IMG[alt] ?? IMG['kirana_banner'];
}
function getLogo(cat: string): string {
  const key = (cat.replace('-', '') + '_logo') as keyof typeof IMG;
  const alt = (cat.split('-')[0] + '_logo') as keyof typeof IMG;
  return IMG[key] ?? IMG[alt] ?? IMG['kirana_logo'];
}

async function main() {
  console.log('Wiping app tables…');
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE "LedgerEntry","Review","OrderItem","Order","CartItem","Cart","Product","Category","ShopKyc","Shop","Address","Referral","AdminInvite","User","ServiceableCity" RESTART IDENTITY CASCADE;`,
  );

  console.log('Creating users…');
  await prisma.user.create({ data: { phone: '+919000000001', role: 'OWNER', name: 'NearBaz Founder', appType: 'OWNER' } });
  await prisma.user.create({ data: { phone: '+919000000002', role: 'ADMIN', name: 'Admin', appType: 'ADMIN' } });

  const shopkeeper = await prisma.user.create({ data: { phone: '+919876543210', role: 'SHOPKEEPER', name: 'Himanshu Jain', appType: 'SHOPKEEPER' } });
  const customer   = await prisma.user.create({ data: { phone: '+919999999999', role: 'CUSTOMER', name: 'Priya Sharma', appType: 'CUSTOMER' } });
  const customer2  = await prisma.user.create({ data: { phone: '+919888888888', role: 'CUSTOMER', name: 'Rohit Verma', appType: 'CUSTOMER' } });

  await prisma.address.create({
    data: {
      userId: customer.id,
      line: 'MG Road, Sadar Bazaar',
      landmark: 'Near Clock Tower',
      latitude: CENTER.lat,
      longitude: CENTER.lng,
      label: 'Home',
    },
  });

  console.log('Creating 25 shops across Jhansi…');
  const holiday = new Date();
  holiday.setMonth(holiday.getMonth() + 1);

  const createdShops: { id: string; name: string }[] = [];

  for (const s of SHOPS) {
    const banner = getBanner(s.cat);
    const logo   = getLogo(s.cat);

    const shop = await prisma.shop.create({
      data: {
        ownerId: shopkeeper.id,
        name: s.name,
        shopCategory: s.cat,
        city: 'Jhansi',
        addressLine: `${s.area}, Jhansi`,
        storefrontPhotoUrl: banner,
        bannerUrl: banner,
        logoUrl: logo,
        upiVpa: s.upi,
        latitude: s.off.lat,
        longitude: s.off.lng,
        isOpen: s.open,
        avgRating: s.rating,
        ratingCount: s.rc,
        minOrderValuePaise: s.min,
        deliveryFeePaise: s.delivery,
        freeDeliveryAbovePaise: s.free,
        platformDeliveryEnabled: s.platform,
        selfPickupEnabled: s.self,
        commissionFreeUntil: holiday,
        creditLimitPaise: 50000,
      },
    });
    await setGeog(shop.id, s.off.lng, s.off.lat);
    createdShops.push({ id: shop.id, name: s.name });

    const productImages = PRODUCT_IMAGES[s.cat] ?? [];
    const productDefs = PRODUCTS[s.cat] ?? [];
    for (let i = 0; i < productDefs.length; i++) {
      const [name, price, mrp, stock] = productDefs[i];
      await prisma.product.create({
        data: {
          shopId: shop.id,
          name,
          pricePaise: price,
          mrpPaise: mrp,
          stock,
          available: true,
          orderCount: Math.floor(Math.random() * 80),
          imageUrl: productImages[i] ?? null,
        },
      });
    }
    process.stdout.write(`  ✓ ${s.name} (${s.area})\n`);
  }

  // Sample orders
  console.log('Creating sample orders…');
  const firstShop = createdShops[0];
  const products = await prisma.product.findMany({ where: { shopId: firstShop.id }, take: 2 });
  if (products.length > 0) {
    const p = products[0];
    for (const [status, custId, idem] of [
      ['PLACED', customer.id, 'seed-1'],
      ['PREPARING', customer2.id, 'seed-2'],
      ['DELIVERED', customer.id, 'seed-3'],
    ] as [string, string, string][]) {
      const order = await prisma.order.create({
        data: {
          customerId: custId, shopId: firstShop.id, status: status as never,
          paymentMethod: 'COD', deliveryMode: 'SELF_DELIVERY',
          originalTotalPaise: p.pricePaise * 2 + 1000, platformFeePaise: 1000, deliveryFeePaise: 0,
          commissionRateSnapshot: 0.02, idempotencyKey: idem,
          items: { create: [{ productId: p.id, nameSnapshot: p.name, pricePaiseSnapshot: p.pricePaise, qty: 2 }] },
        },
      });
      if (status === 'DELIVERED') {
        await prisma.review.create({ data: { shopId: firstShop.id, customerId: custId, orderId: order.id, rating: 5, comment: 'Great shop, fresh stock!' } });
        await prisma.ledgerEntry.create({ data: { shopId: firstShop.id, orderId: order.id, type: 'PLATFORM_FEE', basePaise: 1000, gstPaise: 180, totalPaise: 1180 } });
      }
    }
  }

  console.log('\n✅ Seed complete:');
  console.log(`  25 approved shops with real images across Jhansi`);
  console.log(`  All owned by: +919876543210 (Himanshu Jain)`);
  console.log(`  Customers: +919999999999 (Priya), +919888888888 (Rohit)`);
  console.log(`  Admin: +919000000002 · Owner: +919000000001`);
}

main()
  .catch(e => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
