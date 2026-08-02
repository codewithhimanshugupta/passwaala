/**
 * Seed 25 realistic shops across Jhansi with products and photos.
 * Run: cd api && node seed-jhansi.js
 */
const { PrismaClient } = require('@prisma/client');
const { randomUUID } = require('crypto');
const p = new PrismaClient();

// 25 real Jhansi locations (lat, lng, area name)
const LOCATIONS = [
  [25.4484, 78.5739, 'Sipri Bazar'],
  [25.4510, 78.5782, 'Civil Lines'],
  [25.4537, 78.5821, 'Nagra'],
  [25.4562, 78.5860, 'Budhwara'],
  [25.4588, 78.5899, 'Sadar Bazar'],
  [25.4615, 78.5938, 'Nai Sadak'],
  [25.4641, 78.5977, 'Golghar'],
  [25.4490, 78.5870, 'Vishnu Puri'],
  [25.4520, 78.5910, 'Rani Lakshmi Bai Colony'],
  [25.4550, 78.5950, 'Raksa'],
  [25.4580, 78.5990, 'Babina Road'],
  [25.4610, 78.6030, 'Medical College Area'],
  [25.4635, 78.6060, 'Tejpur Gadbadi'],
  [25.4465, 78.5800, 'Jhansi Cantt'],
  [25.4495, 78.5840, 'Lucknow Gate'],
  [25.4525, 78.5880, 'Mall Road'],
  [25.4555, 78.5920, 'Datia Road'],
  [25.4575, 78.5955, 'Shastri Nagar'],
  [25.4600, 78.5975, 'Krishna Nagar'],
  [25.4620, 78.6000, 'Gandhi Nagar'],
  [25.4645, 78.6025, 'Sai Nagar'],
  [25.4500, 78.5760, 'Gwalior Road'],
  [25.4530, 78.5800, 'Rani Mahal Area'],
  [25.4560, 78.5840, 'Collectorate Area'],
  [25.4590, 78.5875, 'Orhwa Road'],
];

// Shop templates with categories and products
const SHOP_TEMPLATES = [
  {
    name: 'Sharma Kirana Store', category: 'kirana',
    address: 'Shop No. 12, Main Market',
    phone: '9876540001',
    photo: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80',
    products: [
      { name: 'Aashirvaad Atta 5kg', price: 25500, mrp: 28000, img: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&q=80', stock: 50 },
      { name: 'Fortune Sunflower Oil 1L', price: 13000, mrp: 14500, img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', stock: 40 },
      { name: 'Tata Salt 1kg', price: 2000, mrp: 2200, img: 'https://images.unsplash.com/photo-1612257416648-c7bc0cc81b71?w=400&q=80', stock: 80 },
      { name: 'Surf Excel 1kg', price: 18500, mrp: 20000, img: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=400&q=80', stock: 30 },
      { name: 'Maggi Noodles 12-pack', price: 14400, mrp: 16800, img: 'https://images.unsplash.com/photo-1612929633738-8fe44f7ec841?w=400&q=80', stock: 60 },
    ],
  },
  {
    name: 'Gupta Dairy & Sweets', category: 'dairy',
    address: 'Near Bus Stand',
    phone: '9876540002',
    photo: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=600&q=80',
    products: [
      { name: 'Amul Full Cream Milk 500ml', price: 2800, mrp: 3000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 100 },
      { name: 'Amul Butter 100g', price: 5500, mrp: 6000, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&q=80', stock: 50 },
      { name: 'Dahi 400g', price: 4000, mrp: 4500, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 40 },
      { name: 'Amul Cheese Slices 200g', price: 9500, mrp: 10500, img: 'https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=400&q=80', stock: 30 },
      { name: 'Paneer 200g Fresh', price: 8000, mrp: 9000, img: 'https://images.unsplash.com/photo-1631452180519-c014fe946bc7?w=400&q=80', stock: 25 },
    ],
  },
  {
    name: 'Jeevan Medical Store', category: 'medical',
    address: 'Opposite Civil Hospital',
    phone: '9876540003',
    photo: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=80',
    products: [
      { name: 'Dettol Antiseptic 100ml', price: 8500, mrp: 9500, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 40 },
      { name: 'Bandage Roll 5cm', price: 3500, mrp: 4000, img: 'https://images.unsplash.com/photo-1583947215259-38e31be8751f?w=400&q=80', stock: 50 },
      { name: 'Digital Thermometer', price: 29900, mrp: 35000, img: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=400&q=80', stock: 20 },
      { name: 'Glucose-D 500g Orange', price: 12000, mrp: 13500, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 30 },
      { name: 'Mask N95 Pack of 5', price: 19900, mrp: 25000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 25 },
    ],
  },
  {
    name: 'Fresh Harvest Vegetables', category: 'fruits-veg',
    address: 'Sabzi Mandi Road',
    phone: '9876540004',
    photo: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80',
    products: [
      { name: 'Tomatoes 1kg', price: 4000, mrp: 5000, img: 'https://images.unsplash.com/photo-1546470427-e26264be0b0d?w=400&q=80', stock: 100 },
      { name: 'Potatoes 1kg', price: 3000, mrp: 3500, img: 'https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=400&q=80', stock: 100 },
      { name: 'Onions 1kg', price: 3500, mrp: 4500, img: 'https://images.unsplash.com/photo-1508747703725-719777637510?w=400&q=80', stock: 100 },
      { name: 'Spinach 500g', price: 2500, mrp: 3000, img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&q=80', stock: 50 },
      { name: 'Bananas Dozen', price: 4500, mrp: 5000, img: 'https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=400&q=80', stock: 60 },
    ],
  },
  {
    name: 'Tech Zone Electronics', category: 'electronics',
    address: 'Sipri Market Complex',
    phone: '9876540005',
    photo: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=600&q=80',
    products: [
      { name: 'USB-C Cable 1m', price: 29900, mrp: 39900, img: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&q=80', stock: 30 },
      { name: 'Mobile Screen Guard', price: 14900, mrp: 19900, img: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80', stock: 40 },
      { name: 'Earphones Wired', price: 19900, mrp: 29900, img: 'https://images.unsplash.com/photo-1484704849700-f032a568e944?w=400&q=80', stock: 25 },
      { name: 'Phone Back Cover', price: 9900, mrp: 14900, img: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80', stock: 35 },
      { name: 'Power Bank 10000mAh', price: 89900, mrp: 119900, img: 'https://images.unsplash.com/photo-1609692814858-f7cd2f0afa4f?w=400&q=80', stock: 15 },
    ],
  },
  {
    name: 'Roti Ghar Bakery', category: 'bakery',
    address: 'Civil Lines Junction',
    phone: '9876540006',
    photo: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=600&q=80',
    products: [
      { name: 'Whole Wheat Bread 400g', price: 4500, mrp: 5000, img: 'https://images.unsplash.com/photo-1509440159596-0249088772ff?w=400&q=80', stock: 30 },
      { name: 'Butter Biscuits 200g', price: 3500, mrp: 4000, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', stock: 50 },
      { name: 'Cream Rolls 6pc', price: 6000, mrp: 7000, img: 'https://images.unsplash.com/photo-1586190848861-99aa4a171e90?w=400&q=80', stock: 20 },
      { name: 'Khari Biscuit 250g', price: 2500, mrp: 3000, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', stock: 40 },
      { name: 'Cake Pastry 2pc', price: 8000, mrp: 9500, img: 'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?w=400&q=80', stock: 15 },
    ],
  },
  {
    name: 'Bunty Hardware Store', category: 'hardware',
    address: 'Industrial Area Road',
    phone: '9876540007',
    photo: 'https://images.unsplash.com/photo-1581092921461-39b2f2e65c8d?w=600&q=80',
    products: [
      { name: 'Hammer 500g Steel', price: 18000, mrp: 22000, img: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=400&q=80', stock: 20 },
      { name: 'Screwdriver Set 6pc', price: 25000, mrp: 30000, img: 'https://images.unsplash.com/photo-1614313913007-2b4ae8ce32d6?w=400&q=80', stock: 15 },
      { name: 'White Wall Paint 1L', price: 35000, mrp: 42000, img: 'https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=400&q=80', stock: 25 },
      { name: 'Door Lock Set', price: 45000, mrp: 55000, img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80', stock: 10 },
      { name: 'Electrical Tape 3pc', price: 8000, mrp: 10000, img: 'https://images.unsplash.com/photo-1581092921461-39b2f2e65c8d?w=400&q=80', stock: 30 },
    ],
  },
  {
    name: 'Akash Stationery & Books', category: 'stationery',
    address: 'Near Government School',
    phone: '9876540008',
    photo: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=600&q=80',
    products: [
      { name: 'Classmate Notebook 200 pages', price: 8500, mrp: 10000, img: 'https://images.unsplash.com/photo-1531346680769-a1d79b57de5c?w=400&q=80', stock: 60 },
      { name: 'Reynolds Pen Blue 10pc', price: 5000, mrp: 6000, img: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=400&q=80', stock: 80 },
      { name: 'Geometry Box', price: 12000, mrp: 15000, img: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=400&q=80', stock: 25 },
      { name: 'Colour Pencils 24pc', price: 9500, mrp: 12000, img: 'https://images.unsplash.com/photo-1513475382585-d06e58bcb0e0?w=400&q=80', stock: 30 },
      { name: 'A4 Paper Ream 500 sheets', price: 25000, mrp: 30000, img: 'https://images.unsplash.com/photo-1531346680769-a1d79b57de5c?w=400&q=80', stock: 20 },
    ],
  },
  {
    name: 'Meena Fashions Clothing', category: 'clothing',
    address: 'Cloth Market Area',
    phone: '9876540009',
    photo: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&q=80',
    products: [
      { name: 'Cotton Kurta for Men', price: 45000, mrp: 60000, img: 'https://images.unsplash.com/photo-1594938298603-c8148c4b4571?w=400&q=80', stock: 20 },
      { name: 'Salwar Kameez Set', price: 89900, mrp: 120000, img: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&q=80', stock: 15 },
      { name: 'Kids School Uniform Set', price: 35000, mrp: 45000, img: 'https://images.unsplash.com/photo-1503944583220-79d8926ad5e2?w=400&q=80', stock: 25 },
      { name: 'Ladies Dupatta', price: 15000, mrp: 20000, img: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&q=80', stock: 30 },
      { name: 'Cotton Socks 3-pair', price: 9900, mrp: 12900, img: 'https://images.unsplash.com/photo-1586350977771-b3b0abd50c82?w=400&q=80', stock: 40 },
    ],
  },
  {
    name: 'Shyam Supermarket', category: 'kirana',
    address: 'Nai Sadak Main Road',
    phone: '9876540010',
    photo: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80',
    products: [
      { name: 'Basmati Rice 5kg', price: 45000, mrp: 52000, img: 'https://images.unsplash.com/photo-1586201375761-83865001e31c?w=400&q=80', stock: 30 },
      { name: 'Dal Arhar 1kg', price: 18500, mrp: 22000, img: 'https://images.unsplash.com/photo-1585589329256-0ce86e3e9b03?w=400&q=80', stock: 50 },
      { name: 'Biscuits Parle-G 800g', price: 4500, mrp: 5000, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', stock: 60 },
      { name: 'Tea Tata Gold 250g', price: 18500, mrp: 20000, img: 'https://images.unsplash.com/photo-1564890369478-c89ca6d9cde9?w=400&q=80', stock: 40 },
      { name: 'Ghee Amul 500ml', price: 34000, mrp: 38000, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&q=80', stock: 25 },
    ],
  },
  {
    name: 'Raksha Medical Hall', category: 'medical',
    address: 'Gandhi Nagar Chowk',
    phone: '9876540011',
    photo: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=80',
    products: [
      { name: 'Crocin Advance 10 Tablets', price: 3200, mrp: 3600, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 50 },
      { name: 'Vitamin C Tablets 30pc', price: 12900, mrp: 15000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 30 },
      { name: 'BP Monitor Digital', price: 149900, mrp: 200000, img: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=400&q=80', stock: 8 },
      { name: 'Dettol Soap 125g 3pc', price: 7500, mrp: 9000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 40 },
      { name: 'ORS Electrolyte 10pc', price: 5500, mrp: 6500, img: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=400&q=80', stock: 35 },
    ],
  },
  {
    name: 'Ganga Fruits & Dry Fruits', category: 'fruits-veg',
    address: 'Mall Road Junction',
    phone: '9876540012',
    photo: 'https://images.unsplash.com/photo-1610832958506-aa56368176cf?w=600&q=80',
    products: [
      { name: 'Almonds 250g Premium', price: 28000, mrp: 32000, img: 'https://images.unsplash.com/photo-1608797178974-15b35a64ede9?w=400&q=80', stock: 20 },
      { name: 'Cashews 250g', price: 32000, mrp: 38000, img: 'https://images.unsplash.com/photo-1608797178974-15b35a64ede9?w=400&q=80', stock: 20 },
      { name: 'Apples 1kg Shimla', price: 22000, mrp: 25000, img: 'https://images.unsplash.com/photo-1567306226416-28f0efdc88ce?w=400&q=80', stock: 30 },
      { name: 'Mangoes Dussehra 1kg', price: 18000, mrp: 22000, img: 'https://images.unsplash.com/photo-1553279768-865429fa0078?w=400&q=80', stock: 40 },
      { name: 'Mixed Dry Fruit 250g', price: 25000, mrp: 30000, img: 'https://images.unsplash.com/photo-1608797178974-15b35a64ede9?w=400&q=80', stock: 15 },
    ],
  },
  {
    name: 'Vishal Mobile & Accessories', category: 'electronics',
    address: 'Medical College Road',
    phone: '9876540013',
    photo: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=600&q=80',
    products: [
      { name: 'Screen Protector Tempered Glass', price: 9900, mrp: 14900, img: 'https://images.unsplash.com/photo-1601784551446-20c9e07cdbdb?w=400&q=80', stock: 50 },
      { name: 'Bluetooth Speaker Mini', price: 59900, mrp: 79900, img: 'https://images.unsplash.com/photo-1608043152269-423dbba4e7e1?w=400&q=80', stock: 15 },
      { name: 'Charger Fast 18W', price: 39900, mrp: 55000, img: 'https://images.unsplash.com/photo-1609692814858-f7cd2f0afa4f?w=400&q=80', stock: 25 },
      { name: 'OTG Adapter Type-C', price: 14900, mrp: 19900, img: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&q=80', stock: 30 },
      { name: 'Smart Watch Budget', price: 129900, mrp: 199900, img: 'https://images.unsplash.com/photo-1523275335684-37898b6baf30?w=400&q=80', stock: 10 },
    ],
  },
  {
    name: 'Soni Sweet Corner', category: 'bakery',
    address: 'Budhwara Chowk',
    phone: '9876540014',
    photo: 'https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=600&q=80',
    products: [
      { name: 'Gulab Jamun 250g', price: 8000, mrp: 9500, img: 'https://images.unsplash.com/photo-1625398407796-82650a8c135f?w=400&q=80', stock: 25 },
      { name: 'Ladoo Besan 500g', price: 15000, mrp: 18000, img: 'https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=400&q=80', stock: 20 },
      { name: 'Barfi Milk 500g', price: 18000, mrp: 22000, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 15 },
      { name: 'Namkeen Mixture 400g', price: 9500, mrp: 12000, img: 'https://images.unsplash.com/photo-1606831478430-9e28f6cb9b02?w=400&q=80', stock: 30 },
      { name: 'Samosa 4pc Fresh', price: 3000, mrp: 4000, img: 'https://images.unsplash.com/photo-1601050690597-df0568f70950?w=400&q=80', stock: 40 },
    ],
  },
  {
    name: 'Annapurna Grocery', category: 'kirana',
    address: 'Shastri Nagar',
    phone: '9876540015',
    photo: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80',
    products: [
      { name: 'Detergent Bar Wheel 4pc', price: 6500, mrp: 8000, img: 'https://images.unsplash.com/photo-1585421514284-efb74c2b69ba?w=400&q=80', stock: 40 },
      { name: 'Cooking Gas Lighter', price: 5500, mrp: 7000, img: 'https://images.unsplash.com/photo-1504328345606-18bbc8c9d7d1?w=400&q=80', stock: 25 },
      { name: 'Colgate Toothpaste 200g', price: 8500, mrp: 10000, img: 'https://images.unsplash.com/photo-1559925393-8be0ec4767c8?w=400&q=80', stock: 35 },
      { name: 'Chyawanprash 1kg Dabur', price: 28000, mrp: 32000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 20 },
      { name: 'Parachute Coconut Oil 500ml', price: 17500, mrp: 20000, img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', stock: 30 },
    ],
  },
  {
    name: 'Vijay Dairy Point', category: 'dairy',
    address: 'Krishna Nagar',
    phone: '9876540016',
    photo: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=600&q=80',
    products: [
      { name: 'Toned Milk 1L Pouch', price: 5600, mrp: 6000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 80 },
      { name: 'Lassi Sweet 300ml', price: 4000, mrp: 4500, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 30 },
      { name: 'Ghee Homemade 250ml', price: 22000, mrp: 26000, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&q=80', stock: 15 },
      { name: 'Flavoured Milk Mango 200ml', price: 3500, mrp: 4000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 50 },
      { name: 'Curd Cup 200g', price: 3000, mrp: 3500, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 60 },
    ],
  },
  {
    name: 'Green Valley Organic', category: 'fruits-veg',
    address: 'Gwalior Road Market',
    phone: '9876540017',
    photo: 'https://images.unsplash.com/photo-1542838132-92c53300491e?w=600&q=80',
    products: [
      { name: 'Organic Turmeric 200g', price: 8500, mrp: 10000, img: 'https://images.unsplash.com/photo-1615485736169-c44ca25c7d21?w=400&q=80', stock: 30 },
      { name: 'Green Chillies 250g', price: 2500, mrp: 3000, img: 'https://images.unsplash.com/photo-1526346698789-22fd84314424?w=400&q=80', stock: 40 },
      { name: 'Garlic 250g Fresh', price: 4500, mrp: 5500, img: 'https://images.unsplash.com/photo-1587049633312-d628ae50a8ae?w=400&q=80', stock: 50 },
      { name: 'Cauliflower 1 piece', price: 3500, mrp: 4500, img: 'https://images.unsplash.com/photo-1510627498534-cf7e9002facc?w=400&q=80', stock: 30 },
      { name: 'Bitter Gourd 500g', price: 3000, mrp: 3500, img: 'https://images.unsplash.com/photo-1576045057995-568f588f82fb?w=400&q=80', stock: 35 },
    ],
  },
  {
    name: 'Sunrise Milk Booth', category: 'dairy',
    address: 'Cantt Area',
    phone: '9876540018',
    photo: 'https://images.unsplash.com/photo-1628088062854-d1870b4553da?w=600&q=80',
    products: [
      { name: 'Buffalo Milk 1L', price: 7200, mrp: 8000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 60 },
      { name: 'Shrikhand 100g', price: 5500, mrp: 6500, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 20 },
      { name: 'Khoa 250g Fresh', price: 12000, mrp: 14000, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 15 },
      { name: 'Cream 100ml Fresh', price: 4000, mrp: 4800, img: 'https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=400&q=80', stock: 25 },
      { name: 'Chass 500ml Salted', price: 3000, mrp: 3500, img: 'https://images.unsplash.com/photo-1571167243872-43c6d592f8f4?w=400&q=80', stock: 30 },
    ],
  },
  {
    name: 'Jai Ganesh Kirana', category: 'kirana',
    address: 'Rani Mahal Area',
    phone: '9876540019',
    photo: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80',
    products: [
      { name: 'Sugar 1kg', price: 4500, mrp: 5000, img: 'https://images.unsplash.com/photo-1612257416648-c7bc0cc81b71?w=400&q=80', stock: 80 },
      { name: 'Maida 1kg', price: 4000, mrp: 4500, img: 'https://images.unsplash.com/photo-1574323347407-f5e1ad6d020b?w=400&q=80', stock: 60 },
      { name: 'Mustard Oil 1L', price: 17500, mrp: 20000, img: 'https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=400&q=80', stock: 35 },
      { name: 'Poha 500g', price: 4000, mrp: 4800, img: 'https://images.unsplash.com/photo-1585589329256-0ce86e3e9b03?w=400&q=80', stock: 40 },
      { name: 'Dhania Powder 200g', price: 4500, mrp: 5500, img: 'https://images.unsplash.com/photo-1615485736169-c44ca25c7d21?w=400&q=80', stock: 30 },
    ],
  },
  {
    name: 'Digital World Computers', category: 'electronics',
    address: 'Golghar Market',
    phone: '9876540020',
    photo: 'https://images.unsplash.com/photo-1550009158-9ebf69173e03?w=600&q=80',
    products: [
      { name: 'Pen Drive 32GB SanDisk', price: 45000, mrp: 55000, img: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&q=80', stock: 20 },
      { name: 'Mouse Wireless Logitech', price: 89900, mrp: 120000, img: 'https://images.unsplash.com/photo-1527864550417-7fd91fc51a46?w=400&q=80', stock: 10 },
      { name: 'HDMI Cable 1.5m', price: 25000, mrp: 35000, img: 'https://images.unsplash.com/photo-1591488320449-011701bb6704?w=400&q=80', stock: 15 },
      { name: 'Keyboard USB Wired', price: 59900, mrp: 79900, img: 'https://images.unsplash.com/photo-1587829741301-dc798b83add3?w=400&q=80', stock: 12 },
      { name: 'Laptop Cooling Pad', price: 79900, mrp: 100000, img: 'https://images.unsplash.com/photo-1526170375885-4d8ecf77b99f?w=400&q=80', stock: 8 },
    ],
  },
  {
    name: 'Mittal Book House', category: 'stationery',
    address: 'Sadar Bazar',
    phone: '9876540021',
    photo: 'https://images.unsplash.com/photo-1456735190827-d1262f71b8a3?w=600&q=80',
    products: [
      { name: 'CBSE Maths Class 10 Guide', price: 32500, mrp: 39900, img: 'https://images.unsplash.com/photo-1516979187457-637abb4f9353?w=400&q=80', stock: 15 },
      { name: 'Drawing Book A3 20 sheets', price: 7500, mrp: 9000, img: 'https://images.unsplash.com/photo-1531346680769-a1d79b57de5c?w=400&q=80', stock: 25 },
      { name: 'Stapler with 1000 pins', price: 18500, mrp: 22000, img: 'https://images.unsplash.com/photo-1612831455359-970e23a1e4e9?w=400&q=80', stock: 20 },
      { name: 'Whiteboard Marker 4pc', price: 8500, mrp: 10000, img: 'https://images.unsplash.com/photo-1583485088034-697b5bc54ccd?w=400&q=80', stock: 30 },
      { name: 'Calculator Scientific', price: 45000, mrp: 55000, img: 'https://images.unsplash.com/photo-1587145820266-a5951ee6f620?w=400&q=80', stock: 10 },
    ],
  },
  {
    name: 'Laxmi Cloth House', category: 'clothing',
    address: 'Collectorate Area',
    phone: '9876540022',
    photo: 'https://images.unsplash.com/photo-1558769132-cb1aea458c5e?w=600&q=80',
    products: [
      { name: 'Readymade Saree Cotton', price: 149900, mrp: 199900, img: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&q=80', stock: 20 },
      { name: 'Men Casual T-Shirt', price: 29900, mrp: 45000, img: 'https://images.unsplash.com/photo-1521572163474-6864f9cf17ab?w=400&q=80', stock: 30 },
      { name: 'Lehenga Choli Set', price: 299900, mrp: 450000, img: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&q=80', stock: 10 },
      { name: 'Jeans Men Slim Fit', price: 79900, mrp: 120000, img: 'https://images.unsplash.com/photo-1542272604-787c3835535d?w=400&q=80', stock: 15 },
      { name: 'Woollen Shawl Ladies', price: 59900, mrp: 80000, img: 'https://images.unsplash.com/photo-1583391733956-6c78276477e2?w=400&q=80', stock: 18 },
    ],
  },
  {
    name: 'Prabha Health Pharmacy', category: 'medical',
    address: 'Vishnu Puri Colony',
    phone: '9876540023',
    photo: 'https://images.unsplash.com/photo-1576091160399-112ba8d25d1d?w=600&q=80',
    products: [
      { name: 'Betadine Solution 100ml', price: 14500, mrp: 17000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 25 },
      { name: 'Hand Sanitizer 500ml', price: 12000, mrp: 15000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 30 },
      { name: 'Glucometer Set', price: 89900, mrp: 120000, img: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?w=400&q=80', stock: 10 },
      { name: 'Vicks VapoRub 50g', price: 9900, mrp: 12000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 40 },
      { name: 'Iron Folic Tablets 30pc', price: 8500, mrp: 10000, img: 'https://images.unsplash.com/photo-1584308666744-24d5c474f2ae?w=400&q=80', stock: 35 },
    ],
  },
  {
    name: 'Ratan Hardware & Paint', category: 'hardware',
    address: 'Orhwa Road',
    phone: '9876540024',
    photo: 'https://images.unsplash.com/photo-1581092921461-39b2f2e65c8d?w=600&q=80',
    products: [
      { name: 'Asian Paints Exterior 1L', price: 45000, mrp: 55000, img: 'https://images.unsplash.com/photo-1562259929-b4e1fd3aef09?w=400&q=80', stock: 20 },
      { name: 'Flush Tank Complete Set', price: 129900, mrp: 160000, img: 'https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&q=80', stock: 8 },
      { name: 'Plywood Sheet 4x8ft', price: 180000, mrp: 220000, img: 'https://images.unsplash.com/photo-1581092921461-39b2f2e65c8d?w=400&q=80', stock: 10 },
      { name: 'Drill Bits Set 10pc', price: 35000, mrp: 45000, img: 'https://images.unsplash.com/photo-1504148455328-c376907d081c?w=400&q=80', stock: 15 },
      { name: 'PVC Pipe 1 inch 3m', price: 18000, mrp: 22000, img: 'https://images.unsplash.com/photo-1581092921461-39b2f2e65c8d?w=400&q=80', stock: 20 },
    ],
  },
  {
    name: 'Kuldeep Kirana General Store', category: 'kirana',
    address: 'Sai Nagar',
    phone: '9876540025',
    photo: 'https://images.unsplash.com/photo-1604719312566-8912e9227c6a?w=600&q=80',
    products: [
      { name: 'Horlicks 500g', price: 29900, mrp: 35000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 25 },
      { name: 'Bournvita 500g', price: 28500, mrp: 33000, img: 'https://images.unsplash.com/photo-1563636619-e9143da7973b?w=400&q=80', stock: 25 },
      { name: 'Moong Dal 1kg', price: 16000, mrp: 19000, img: 'https://images.unsplash.com/photo-1585589329256-0ce86e3e9b03?w=400&q=80', stock: 40 },
      { name: 'Hajmola Candy 100pc', price: 5000, mrp: 6000, img: 'https://images.unsplash.com/photo-1558961363-fa8fdf82db35?w=400&q=80', stock: 50 },
      { name: 'Shampoo Head&Shoulders 200ml', price: 22500, mrp: 27000, img: 'https://images.unsplash.com/photo-1612817288484-6f916006741a?w=400&q=80', stock: 30 },
    ],
  },
];

async function main() {
  // Use owner 9876543210 (already in DB as shopkeeper)
  const owner = await p.user.findFirst({ where: { phone: '+919876543210' } });
  if (!owner) { console.error('Owner +919876543210 not found. Seed existing shops first.'); process.exit(1); }
  console.log('Owner:', owner.id, owner.name);

  let created = 0;
  for (let i = 0; i < SHOP_TEMPLATES.length; i++) {
    const tmpl = SHOP_TEMPLATES[i];
    const [lat, lng, area] = LOCATIONS[i];
    const shopId = randomUUID();
    const shortId = `S${shopId.replace(/-/g,'').slice(0,8).toUpperCase()}`;

    // Create shop
    const shop = await p.shop.create({
      data: {
        id: shopId,
        shortId,
        ownerId: owner.id,
        name: tmpl.name,
        shopCategory: tmpl.category,
        storefrontPhotoUrl: tmpl.photo,
        latitude: lat,
        longitude: lng,
        city: 'Jhansi',
        addressLine: `${tmpl.address}, ${area}, Jhansi`,
        contactPhone: tmpl.phone,
        deliveryFeePaise: 1500,
        minOrderValuePaise: 5000,
        platformDeliveryEnabled: i % 3 === 0, // every 3rd shop uses platform delivery
        verificationStatus: 'APPROVED',
        isOpen: true,
        avgRating: 3.5 + (i % 5) * 0.3,
        ratingCount: 5 + i * 3,
        creditLimitPaise: 50000,
      },
    });

    // Update PostGIS geog
    await p.$executeRawUnsafe(
      `UPDATE "Shop" SET geog = ST_SetSRID(ST_MakePoint($1,$2),4326)::geography WHERE id=$3`,
      lng, lat, shop.id
    );

    // Create products with shortIds
    for (const prod of tmpl.products) {
      const prodId = randomUUID();
      await p.product.create({
        data: {
          id: prodId,
          shopId: shop.id,
          name: prod.name,
          pricePaise: prod.price,
          mrpPaise: prod.mrp,
          imageUrl: prod.img,
          stock: prod.stock,
          available: true,
          orderCount: Math.floor(Math.random() * 50),
        },
      });
    }
    created++;
    console.log(`✓ ${tmpl.name} (${area}) — ${tmpl.products.length} products`);
  }
  console.log(`\n✅ Done! Created ${created} shops with ${created * 5} products.`);
  await p.$disconnect();
}

main().catch(e => { console.error(e); process.exit(1); });
