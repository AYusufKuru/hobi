import {
  GEN_SPEED_PER_POINT,
  getCatalogItem,
  HULL_SPEED_PER_POINT,
  marketCatalog,
  MAX_DROIDS,
  shipSlotCounts,
  type ShopItem,
} from './catalog';

export interface ShipFit {
  lasers: (string | null)[];
  generators: (string | null)[];
}

export interface DroidFit {
  /** Two module slots — laser or shield each */
  slots: [string | null, string | null];
}

export function emptyDroidFit(): DroidFit {
  return { slots: [null, null] };
}

export const SKILL_AMMO_IDS = [
  'ammo-x1',
  'ammo-x2',
  'ammo-x3',
  'ammo-x4',
  'ammo-rsb',
] as const;

export type SkillAmmoId = (typeof SKILL_AMMO_IDS)[number];

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
  /** @deprecated legacy total — migrated into ammo stocks */
  laserAmmo: number;
  /** Stock per ammo pack id (ammo-x1 … ammo-rsb) */
  ammo: Record<string, number>;
  /** Selected skill-bar ammo */
  activeAmmoId: SkillAmmoId;
  /** Skill bar slot assignments (ammo ids) */
  skillBar: (SkillAmmoId | null)[];
  /** Owned escort droids (0–MAX_DROIDS), bought one by one */
  droidCount: number;
  /** Per-droid equipment — same laser/generator modules as the ship */
  droidFits: DroidFit[];
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
  sprite: 'ship-player' | 'ship-elite' | 'ship-goliath';
  ammoDamageMult: number;
  laserSlots: number;
  generatorSlots: number;
}

export function defaultAmmoStocks(): Record<string, number> {
  return {
    'ammo-x1': 2000,
    'ammo-x2': 500,
    'ammo-x3': 200,
    'ammo-x4': 100,
    'ammo-rsb': 50,
  };
}

export function defaultSkillBar(): (SkillAmmoId | null)[] {
  return [...SKILL_AMMO_IDS];
}

export function isSkillAmmoId(id: string): id is SkillAmmoId {
  return (SKILL_AMMO_IDS as readonly string[]).includes(id);
}

export function getAmmoMult(ammoId: string): number {
  return getCatalogItem(ammoId)?.ammoMult ?? 1;
}

export function getAmmoColor(ammoId: string): number {
  return getCatalogItem(ammoId)?.ammoColor ?? 0x66e0ff;
}

export function activeAmmoCount(loadout: Loadout): number {
  return Math.max(0, Math.floor(loadout.ammo[loadout.activeAmmoId] ?? 0));
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

function ensureDroidFits(loadout: Loadout): DroidFit[] {
  if (!Array.isArray(loadout.droidFits)) {
    loadout.droidFits = [];
  }
  while (loadout.droidFits.length < MAX_DROIDS) {
    loadout.droidFits.push(emptyDroidFit());
  }
  if (loadout.droidFits.length > MAX_DROIDS) {
    const overflow = loadout.droidFits.splice(MAX_DROIDS);
    for (const fit of overflow) {
      for (const id of fit.slots) {
        if (!id) continue;
        const item = getCatalogItem(id);
        if (item?.category === 'lasers') {
          addDepot(loadout.lasers, id, 1);
        } else if (item?.category === 'generators') {
          addDepot(loadout.generators, id, 1);
        }
      }
    }
  }
  for (const fit of loadout.droidFits) {
    if (!Array.isArray(fit.slots) || fit.slots.length < 2) {
      fit.slots = [fit.slots?.[0] ?? null, fit.slots?.[1] ?? null];
    } else {
      fit.slots = [fit.slots[0] ?? null, fit.slots[1] ?? null];
    }
  }
  return loadout.droidFits;
}

function migrateLegacyDroidDepots(loadout: Loadout) {
  const raw = loadout as Loadout & {
    droidLasers?: Record<string, number>;
    droidShields?: Record<string, number>;
  };
  for (const [id, n] of Object.entries(raw.droidLasers ?? {})) {
    const item = getCatalogItem(id);
    if (item?.category === 'lasers') addDepot(loadout.lasers, id, n);
  }
  for (const [id, n] of Object.entries(raw.droidShields ?? {})) {
    const item = getCatalogItem(id);
    if (item?.category === 'generators') addDepot(loadout.generators, id, n);
  }
  delete raw.droidLasers;
  delete raw.droidShields;
  for (const fit of loadout.droidFits ?? []) {
    for (let i = 0; i < 2; i++) {
      const id = fit.slots[i];
      if (!id) continue;
      const item = getCatalogItem(id);
      if (item?.category !== 'lasers' && item?.category !== 'generators') {
        fit.slots[i] = null;
      }
    }
  }
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
    laserAmmo: 2000,
    ammo: defaultAmmoStocks(),
    activeAmmoId: 'ammo-x1',
    skillBar: defaultSkillBar(),
    droidCount: 0,
    droidFits: Array.from({ length: MAX_DROIDS }, () => emptyDroidFit()),
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
        : 2000,
    ammo: defaultAmmoStocks(),
    activeAmmoId: 'ammo-x1',
    skillBar: defaultSkillBar(),
    droidCount: 0,
    droidFits: Array.from({ length: MAX_DROIDS }, () => emptyDroidFit()),
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
    loadout.laserAmmo = Math.max(0, Math.floor(loadout.laserAmmo ?? 2000));
    if (!loadout.ammo || typeof loadout.ammo !== 'object') {
      loadout.ammo = defaultAmmoStocks();
      // Migrate legacy single pool into X1
      if (loadout.laserAmmo > 0) {
        loadout.ammo['ammo-x1'] = Math.max(
          loadout.ammo['ammo-x1'] ?? 0,
          loadout.laserAmmo,
        );
      }
    }
    for (const id of SKILL_AMMO_IDS) {
      if (typeof loadout.ammo[id] !== 'number') loadout.ammo[id] = 0;
      loadout.ammo[id] = Math.max(0, Math.floor(loadout.ammo[id]));
    }
    // Legacy packs
    if (typeof (loadout.ammo as Record<string, number>)['ammo-ucb'] === 'number') {
      loadout.ammo['ammo-x4'] =
        (loadout.ammo['ammo-x4'] ?? 0) +
        Math.floor((loadout.ammo as Record<string, number>)['ammo-ucb']);
      delete (loadout.ammo as Record<string, number>)['ammo-ucb'];
    }
    if (!isSkillAmmoId(loadout.activeAmmoId ?? '')) {
      loadout.activeAmmoId = 'ammo-x1';
    }
    if (!Array.isArray(loadout.skillBar) || loadout.skillBar.length < 5) {
      loadout.skillBar = defaultSkillBar();
    } else {
      loadout.skillBar = loadout.skillBar.slice(0, 5).map((id) =>
        id && isSkillAmmoId(id) ? id : null,
      );
      while (loadout.skillBar.length < 5) loadout.skillBar.push(null);
    }
    loadout.laserAmmo = activeAmmoCount(loadout);
    const rawDroids =
      typeof (loadout as { droidCount?: unknown }).droidCount === 'number'
        ? (loadout as { droidCount: number }).droidCount
        : 0;
    loadout.droidCount = Math.max(
      0,
      Math.min(MAX_DROIDS, Math.floor(rawDroids)),
    );
    migrateLegacyDroidDepots(loadout);
    ensureDroidFits(loadout);
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

  let hullSpeedPoints = ship.speed ?? 5;
  let genSpeedPoints = 0;
  let maxShield = ship.maxShield ?? 0;
  const maxHp = ship.maxHp ?? 256_000;
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
    genSpeedPoints += g.speedBonus ?? 0;
    maxShield += g.shieldBonus ?? 0;
    if ((g.absorbPct ?? 0) > bestAbsorb) bestAbsorb = g.absorbPct ?? 0;
  }

  const droidFits = ensureDroidFits(loadout);
  const droidN = Math.max(
    0,
    Math.min(MAX_DROIDS, Math.floor(loadout.droidCount ?? 0)),
  );
  for (let di = 0; di < droidN; di++) {
    for (const modId of droidFits[di].slots) {
      if (!modId) continue;
      const mod = getCatalogItem(modId);
      if (!mod) continue;
      if (mod.category === 'lasers') {
        equippedLasers += 1;
        damage += mod.baseDamage ?? 0;
        npcBonus += mod.npcBonus ?? 0;
      } else if (mod.category === 'generators') {
        maxShield += mod.shieldBonus ?? 0;
        if ((mod.absorbPct ?? 0) > bestAbsorb) bestAbsorb = mod.absorbPct ?? 0;
      }
    }
  }

  const ammoDamageMult = getAmmoMult(loadout.activeAmmoId);

  const hullPx = hullSpeedPoints * HULL_SPEED_PER_POINT;
  const genPx = genSpeedPoints * GEN_SPEED_PER_POINT;

  return {
    speed: Math.max(100, Math.round(hullPx + genPx)),
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

export { ensureFit, emptyFit, ensureDroidFits };
