import {
  getCatalogItem,
  marketCatalog,
  shipSlotCounts,
  SPEED_PER_POINT,
  type ShopItem,
} from './catalog';

export interface ShipFit {
  lasers: (string | null)[];
  generators: (string | null)[];
}

/** Depot + per-ship equipment */
export interface Loadout {
  version: 2;
  /** Owned ship hull ids */
  ships: string[];
  /** Laser modules sitting in depot (not on a ship) */
  lasers: Record<string, number>;
  /** Generator modules in depot */
  generators: Record<string, number>;
  /** Equipment config per owned ship */
  fits: Record<string, ShipFit>;
  activeShipId: string;
  laserAmmo: number;
}

export interface DerivedStats {
  speed: number;
  maxHp: number;
  maxShield: number;
  /** 0–100: % of incoming damage routed to shield */
  shieldAbsorb: number;
  /** Sum of equipped laser baseDamage (× ammo mult). 0 if no lasers. */
  laserDamage: number;
  /** Extra damage applied only vs NPCs (sum of equipped npcBonus × ammo mult). */
  laserNpcBonus: number;
  /** Number of filled laser slots */
  equippedLasers: number;
  sprite: 'ship-player' | 'ship-elite';
  ammoDamageMult: number;
  laserSlots: number;
  generatorSlots: number;
}

function emptyFit(shipId: string): ShipFit {
  const { laserSlots, generatorSlots } = shipSlotCounts(shipId);
  return {
    lasers: Array.from({ length: laserSlots }, () => null),
    generators: Array.from({ length: generatorSlots }, () => null),
  };
}

function ensureFit(loadout: Loadout, shipId: string): ShipFit {
  const { laserSlots, generatorSlots } = shipSlotCounts(shipId);
  let fit = loadout.fits[shipId];
  if (!fit) {
    fit = emptyFit(shipId);
    loadout.fits[shipId] = fit;
  }
  while (fit.lasers.length < laserSlots) fit.lasers.push(null);
  while (fit.generators.length < generatorSlots) fit.generators.push(null);
  if (fit.lasers.length > laserSlots) {
    // Return overflow to depot
    for (const extra of fit.lasers.splice(laserSlots)) {
      if (extra) addDepot(loadout.lasers, extra, 1);
    }
  }
  if (fit.generators.length > generatorSlots) {
    for (const extra of fit.generators.splice(generatorSlots)) {
      if (extra) addDepot(loadout.generators, extra, 1);
    }
  }
  return fit;
}

function addDepot(bag: Record<string, number>, id: string, n: number) {
  bag[id] = (bag[id] ?? 0) + n;
  if (bag[id] <= 0) delete bag[id];
}

export function defaultLoadout(): Loadout {
  const loadout: Loadout = {
    version: 2,
    ships: ['ship-phoenix'],
    lasers: { 'laser-lf1': 0 }, // LF-1 starts equipped, none free in depot
    generators: {},
    fits: {
      'ship-phoenix': {
        lasers: ['laser-lf1'],
        generators: [null],
      },
    },
    activeShipId: 'ship-phoenix',
    laserAmmo: 100,
  };
  return loadout;
}

/** Migrate v1 flat loadout → v2 depot/fits */
function migrateV1(parsed: Record<string, unknown>): Loadout {
  const base = defaultLoadout();
  const owned = Array.isArray(parsed.owned)
    ? parsed.owned.map(String)
    : base.ships;
  const ships = [
    ...new Set([
      'ship-phoenix',
      ...owned.filter((id) => getCatalogItem(id)?.category === 'ships'),
    ]),
  ];
  const lasers: Record<string, number> = {};
  const generators: Record<string, number> = {};
  for (const id of owned) {
    const item = getCatalogItem(id);
    if (!item) continue;
    if (item.category === 'lasers') addDepot(lasers, id, 1);
    if (item.category === 'generators') addDepot(generators, id, 1);
  }

  const activeShipId =
    typeof parsed.shipId === 'string' && ships.includes(parsed.shipId)
      ? parsed.shipId
      : 'ship-phoenix';

  const fits: Record<string, ShipFit> = {};
  for (const sid of ships) {
    fits[sid] = emptyFit(sid);
  }

  const activeFit = fits[activeShipId];
  const oldLaser =
    typeof parsed.laserId === 'string' ? parsed.laserId : 'laser-lf1';
  if (activeFit.lasers.length > 0) {
    activeFit.lasers[0] = oldLaser;
    if (lasers[oldLaser]) {
      addDepot(lasers, oldLaser, -1);
    }
  }
  const oldGens = Array.isArray(parsed.generators)
    ? parsed.generators.map(String)
    : [];
  oldGens.forEach((gid, i) => {
    if (i < activeFit.generators.length) {
      activeFit.generators[i] = gid;
      if (generators[gid]) addDepot(generators, gid, -1);
    }
  });

  return {
    version: 2,
    ships,
    lasers,
    generators,
    fits,
    activeShipId,
    laserAmmo:
      typeof parsed.laserAmmo === 'number' && parsed.laserAmmo >= 0
        ? Math.floor(parsed.laserAmmo)
        : 100,
  };
}

export function parseLoadout(raw: string | null | undefined): Loadout {
  if (!raw) return defaultLoadout();
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (parsed.version !== 2) {
      return migrateV1(parsed);
    }
    const loadout = parsed as unknown as Loadout;
    if (!Array.isArray(loadout.ships) || loadout.ships.length === 0) {
      return defaultLoadout();
    }
    if (!loadout.ships.includes('ship-phoenix')) {
      loadout.ships.unshift('ship-phoenix');
    }
    loadout.lasers = loadout.lasers ?? {};
    loadout.generators = loadout.generators ?? {};
    loadout.fits = loadout.fits ?? {};
    for (const sid of loadout.ships) {
      ensureFit(loadout, sid);
    }
    if (!loadout.ships.includes(loadout.activeShipId)) {
      loadout.activeShipId = loadout.ships[0];
    }
    loadout.laserAmmo = Math.max(0, Math.floor(loadout.laserAmmo ?? 100));
    loadout.version = 2;
    return loadout;
  } catch {
    return defaultLoadout();
  }
}

export function deriveStats(loadout: Loadout): DerivedStats {
  const shipId = loadout.activeShipId;
  const ship = getCatalogItem(shipId) ?? getCatalogItem('ship-phoenix')!;
  const fit = ensureFit(loadout, shipId);
  const { laserSlots, generatorSlots } = shipSlotCounts(shipId);

  let speedPoints = ship.speed ?? 4;
  let maxShield = ship.maxShield ?? 0;
  const maxHp = ship.maxHp ?? 5000;
  let damage = 0;
  let npcBonus = 0;
  let equippedLasers = 0;
  let bestAbsorb = 0;

  for (const lid of fit.lasers) {
    if (!lid) continue;
    const laser = getCatalogItem(lid);
    if (!laser) continue;
    equippedLasers += 1;
    damage += laser.baseDamage ?? 0;
    npcBonus += laser.npcBonus ?? 0;
  }

  for (const gid of fit.generators) {
    if (!gid) continue;
    const g = getCatalogItem(gid);
    if (!g) continue;
    speedPoints += g.speedBonus ?? 0;
    maxShield += g.shieldBonus ?? 0;
    if ((g.absorbPct ?? 0) > bestAbsorb) bestAbsorb = g.absorbPct ?? 0;
  }

  const ammoDamageMult =
    equippedLasers > 0 && loadout.laserAmmo > 0 ? 1.5 : 1;

  return {
    speed: Math.max(55, Math.round(speedPoints * SPEED_PER_POINT)),
    maxHp,
    maxShield,
    shieldAbsorb: maxShield > 0 ? bestAbsorb : 0,
    laserDamage: Math.round(damage * ammoDamageMult),
    laserNpcBonus: Math.round(npcBonus * ammoDamageMult),
    equippedLasers,
    sprite: ship.sprite ?? 'ship-player',
    ammoDamageMult,
    laserSlots,
    generatorSlots,
  };
}

export function catalogForClient(): ShopItem[] {
  return marketCatalog();
}

export function addToDepot(
  bag: Record<string, number>,
  id: string,
  n = 1,
) {
  addDepot(bag, id, n);
}

export function takeFromDepot(
  bag: Record<string, number>,
  id: string,
  n = 1,
): boolean {
  if ((bag[id] ?? 0) < n) return false;
  addDepot(bag, id, -n);
  return true;
}

export { ensureFit, emptyFit };
