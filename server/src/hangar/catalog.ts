export type ShopCategory = 'ships' | 'lasers' | 'generators' | 'ammo';
export type ShopCurrency = 'silver' | 'gold';

/** Converts ship speed points (base + gens) into world px/s */
export const SPEED_PER_POINT = 16;

export interface ShopItem {
  id: string;
  category: ShopCategory;
  name: string;
  desc: string;
  price: number;
  /** Default silver (gümüş). Gold = altın. */
  currency?: ShopCurrency;
  /** When false, hidden from market (e.g. box-only LF-4). */
  inMarket?: boolean;
  /** Ship hull — speed is base points (gens add on top). */
  speed?: number;
  maxHp?: number;
  /** Hull-only base shield (usually 0; gens provide shield). */
  maxShield?: number;
  laserSlots?: number;
  generatorSlots?: number;
  sprite?: 'ship-player' | 'ship-elite';
  /** Damage contributed per equipped module */
  baseDamage?: number;
  /** Extra damage vs NPCs when this laser is equipped */
  npcBonus?: number;
  ammoAdd?: number;
  /** Speed generator points (2–10) */
  speedBonus?: number;
  /** Shield generator max shield add */
  shieldBonus?: number;
  /** Shield absorption % (0–100) when this gen is equipped */
  absorbPct?: number;
}

export const SHOP_CATALOG: ShopItem[] = [
  {
    id: 'ship-phoenix',
    category: 'ships',
    name: 'Phoenix',
    desc: '6 lazer · 6 jeneratör · can 5.000 · hız tabanı 4',
    price: 0,
    currency: 'silver',
    speed: 4,
    maxHp: 5000,
    maxShield: 0,
    laserSlots: 6,
    generatorSlots: 6,
    sprite: 'ship-player',
  },
  {
    id: 'ship-leonov',
    category: 'ships',
    name: 'Leonov',
    desc: '10 lazer · 6 jeneratör · can 8.000 · hız tabanı 5',
    price: 450,
    currency: 'silver',
    speed: 5,
    maxHp: 8000,
    maxShield: 0,
    laserSlots: 10,
    generatorSlots: 6,
    sprite: 'ship-player',
  },
  {
    id: 'ship-goliath',
    category: 'ships',
    name: 'Goliath',
    desc: '16 lazer · 6 jeneratör · can 18.000 · hız tabanı 3',
    price: 1800,
    currency: 'silver',
    speed: 3,
    maxHp: 18000,
    maxShield: 0,
    laserSlots: 16,
    generatorSlots: 6,
    sprite: 'ship-elite',
  },
  {
    id: 'laser-lf1',
    category: 'lasers',
    name: 'LF-1',
    desc: '65 hasar verir',
    price: 100,
    currency: 'silver',
    baseDamage: 65,
  },
  {
    id: 'laser-mp1',
    category: 'lasers',
    name: 'MP-1',
    desc: '75 hasar verir',
    price: 250,
    currency: 'silver',
    baseDamage: 75,
  },
  {
    id: 'laser-lf2',
    category: 'lasers',
    name: 'LF-2',
    desc: '140 hasar verir',
    price: 40,
    currency: 'gold',
    baseDamage: 140,
  },
  {
    id: 'laser-lf3',
    category: 'lasers',
    name: 'LF-3',
    desc: "175 hasar verir (NPC'lere +15 ekstra)",
    price: 80,
    currency: 'gold',
    baseDamage: 175,
    npcBonus: 15,
  },
  {
    id: 'laser-lf4',
    category: 'lasers',
    name: 'LF-4',
    desc: '200 hasar verir · sadece kutudan',
    price: 0,
    currency: 'gold',
    inMarket: false,
    baseDamage: 200,
  },
  {
    id: 'ammo-ucb',
    category: 'ammo',
    name: 'UCB-100 x200',
    desc: '+200 cephane (ateşte +50% hasar)',
    price: 120,
    currency: 'silver',
    ammoAdd: 200,
  },
  {
    id: 'ammo-rsb',
    category: 'ammo',
    name: 'RSB-75 x80',
    desc: '+80 cephane (ateşte +50% hasar)',
    price: 200,
    currency: 'silver',
    ammoAdd: 80,
  },

  // —— Hız jeneratörleri (2–10 puan) ——
  {
    id: 'gen-spd-2',
    category: 'generators',
    name: 'Pulse Drive I',
    desc: '+2 hız',
    price: 80,
    currency: 'silver',
    speedBonus: 2,
  },
  {
    id: 'gen-spd-4',
    category: 'generators',
    name: 'Pulse Drive II',
    desc: '+4 hız',
    price: 180,
    currency: 'silver',
    speedBonus: 4,
  },
  {
    id: 'gen-spd-6',
    category: 'generators',
    name: 'Pulse Drive III',
    desc: '+6 hız',
    price: 320,
    currency: 'silver',
    speedBonus: 6,
  },
  {
    id: 'gen-spd-8',
    category: 'generators',
    name: 'Warp Coil',
    desc: '+8 hız',
    price: 35,
    currency: 'gold',
    speedBonus: 8,
  },
  {
    id: 'gen-spd-10',
    category: 'generators',
    name: 'Warp Core',
    desc: '+10 hız',
    price: 70,
    currency: 'gold',
    speedBonus: 10,
  },

  // —— Kalkan jeneratörleri (görseldeki değerler, farklı isimler) ——
  {
    id: 'gen-shd-1000',
    category: 'generators',
    name: 'Void Veil I',
    desc: '1.000 kalkan · %40 absorb',
    price: 120,
    currency: 'silver',
    shieldBonus: 1000,
    absorbPct: 40,
  },
  {
    id: 'gen-shd-2000',
    category: 'generators',
    name: 'Void Veil II',
    desc: '2.000 kalkan · %50 absorb',
    price: 280,
    currency: 'silver',
    shieldBonus: 2000,
    absorbPct: 50,
  },
  {
    id: 'gen-shd-5000',
    category: 'generators',
    name: 'Void Veil III',
    desc: '5.000 kalkan · %60 absorb',
    price: 550,
    currency: 'silver',
    shieldBonus: 5000,
    absorbPct: 60,
  },
  {
    id: 'gen-shd-4000',
    category: 'generators',
    name: 'Bastion Field',
    desc: '4.000 kalkan · %70 absorb',
    price: 45,
    currency: 'gold',
    shieldBonus: 4000,
    absorbPct: 70,
  },
  {
    id: 'gen-shd-10000',
    category: 'generators',
    name: 'Aegis Dome',
    desc: '10.000 kalkan · %80 absorb',
    price: 95,
    currency: 'gold',
    shieldBonus: 10000,
    absorbPct: 80,
  },
];

/** Old save ids → current catalog ids */
const LEGACY_IDS: Record<string, string> = {
  'gen-speed-1': 'gen-spd-4',
  'gen-speed-2': 'gen-spd-6',
  'gen-shield-1': 'gen-shd-4000',
  'gen-shield-2': 'gen-shd-10000',
};

export function resolveItemId(id: string): string {
  return LEGACY_IDS[id] ?? id;
}

export function getCatalogItem(id: string) {
  return SHOP_CATALOG.find((i) => i.id === resolveItemId(id));
}

/** Items visible in the hangar market UI */
export function marketCatalog(): ShopItem[] {
  return SHOP_CATALOG.filter((i) => i.inMarket !== false);
}

export function shipSlotCounts(shipId: string) {
  const ship = getCatalogItem(shipId) ?? getCatalogItem('ship-phoenix')!;
  return {
    laserSlots: ship.laserSlots ?? 1,
    generatorSlots: ship.generatorSlots ?? 1,
  };
}
