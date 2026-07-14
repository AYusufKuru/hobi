export const WORLD = {
  width: 5600,
  height: 5600,
  maxHp: 100,
  maxShield: 100,
  shipSpeed: 120,
  bulletSpeed: 980,
  rocketSpeed: 560,
  bulletLifetimeMs: 1400,
  rocketLifetimeMs: 2200,
  fireCooldownMs: 500,
  laserDpsIntervalMs: 1000,
  rocketCooldownMs: 1000,
  laserDamage: 12,
  rocketDamage: 40,
  laserRange: 720,
  rocketRange: 900,
  shipRadius: 18,
  bulletRadius: 4,
  rocketRadius: 7,
  arriveRadius: 8,
  npcCount: 14,
  npcSpeed: 70,
  npcWanderSpeed: 55,
  npcRadius: 16,
  npcHp: 1200,
  /** For future hostile NPCs that aggro on sight */
  npcSightRange: 680,
  /** Drop chase if player flees beyond this */
  npcLeashRange: 1100,
  npcLaserRange: 580,
  npcLaserDamage: 55,
  npcFireCooldownMs: 420,
  npcBulletSpeed: 820,
  killCredits: 25,
  npcCredits: 10,
  cargoCollectRadius: 45,
  shieldRegenDelayMs: 3000,
  /** Must stand still / not take damage this long before hull repair starts */
  repairIdleMs: 3000,
  /** Hull heal tick interval while repairing */
  repairIntervalMs: 1000,
  /** Fraction of maxHp restored per repair tick */
  repairPct: 0.03,
  /** Shield heal tick interval after no-damage delay */
  shieldRegenIntervalMs: 1000,
  /** Fraction of maxShield restored per shield tick */
  shieldRegenPct: 0.05,
  radiationInset: 120,
  radiationDps: 10,
  startingRockets: 20,
  portalRadius: 55,
  portalChannelMs: 3000,
  /** Must be this close to the portal to start a jump */
  portalUseRange: 140,
} as const;

export const PORTALS = [
  { id: 'portal-home', x: 500, y: 500, label: 'Home Base', toX: 5100, toY: 5100 },
  { id: 'portal-far', x: 5100, y: 5100, label: 'Outer Gate', toX: 500, toY: 500 },
] as const;

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  credits: number;
  gold: number;
  kills: number;
  rockets: number;
  laserAmmo: number;
  shipId: string;
  shipSprite: 'ship-player' | 'ship-elite';
  shipSpeed: number;
  laserDamage: number;
  /** Extra laser damage vs NPCs */
  laserNpcBonus: number;
  /** Equipped laser count — 0 means cannot fire lasers */
  equippedLasers: number;
  /** 0–100 shield absorption from generators */
  shieldAbsorb: number;
  /** Full hangar depot + per-ship fits */
  loadout: import('../hangar/loadout').Loadout;
  color: string;
  lastShotAt: number;
  lastLaserDpsAt: number;
  lastRocketAt: number;
  lastDamageAt: number;
  lastMovedAt: number;
  lastRepairAt: number;
  lastShieldRegenAt: number;
  targetId: string | null;
  firing: boolean;
  lastPortalAt: number;
  /** Portal id being channeled; null if none */
  portalChannelId: string | null;
  /** Timestamp when channel completes */
  portalChannelEndsAt: number;
}

export interface BulletState {
  id: string;
  ownerId: string;
  /** Locked when fired — lasers/rockets only affect this target */
  targetId: string;
  /** Homing point — frozen when target dies so beams finish at death spot */
  aimX: number;
  aimY: number;
  /** True after target exploded — stop retargeting (e.g. NPC respawn) */
  frozen: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  bornAt: number;
  kind: 'laser' | 'rocket';
  /** Rockets deal this on reach; lasers are visual (DPS is separate) */
  damage: number;
  npcExtra: number;
}

export interface NpcState {
  id: string;
  name: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  vx: number;
  vy: number;
  lastShotAt: number;
  lastDpsAt: number;
  /** Player id being chased; null = wandering */
  aggroId: string | null;
  nextWanderAt: number;
}

export interface CargoBox {
  id: string;
  x: number;
  y: number;
  credits: number;
  rockets: number;
}

export interface Snapshot {
  players: Array<
    Omit<
      PlayerState,
      | 'lastShotAt'
      | 'lastLaserDpsAt'
      | 'lastRocketAt'
      | 'lastDamageAt'
      | 'lastMovedAt'
      | 'lastRepairAt'
      | 'lastShieldRegenAt'
      | 'vx'
      | 'vy'
      | 'lastPortalAt'
      | 'portalChannelId'
      | 'portalChannelEndsAt'
      | 'loadout'
    > & { moving: boolean; inRange: boolean }
  >;
  bullets: Array<
    Pick<
      BulletState,
      'id' | 'ownerId' | 'targetId' | 'aimX' | 'aimY' | 'frozen' | 'x' | 'y' | 'kind'
    >
  >;
  npcs: Omit<
    NpcState,
    'vx' | 'vy' | 'lastShotAt' | 'lastDpsAt' | 'aggroId' | 'nextWanderAt'
  >[];
  cargo: CargoBox[];
  portals: typeof PORTALS;
  serverTime: number;
}

export interface PlayerInput {
  destX: number | null;
  destY: number | null;
  targetId: string | null;
  firing: boolean;
  /** Edge-triggered rocket request */
  fireRocket: boolean;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  self?: Omit<
    PlayerState,
    | 'lastShotAt'
    | 'lastLaserDpsAt'
    | 'lastRocketAt'
    | 'lastDamageAt'
    | 'lastMovedAt'
    | 'lastRepairAt'
    | 'lastShieldRegenAt'
    | 'vx'
    | 'vy'
    | 'lastPortalAt'
    | 'portalChannelId'
    | 'portalChannelEndsAt'
    | 'loadout'
  >;
  world?: typeof WORLD;
  snapshot?: Snapshot;
  hangar?: unknown;
}

export type GameEvent =
  | {
      type: 'hit';
      targetId: string;
      hp: number;
      shield: number;
      byId: string;
      kind: 'player' | 'npc';
      damage: number;
    }
  | { type: 'killed'; victimId: string; killerId: string; kind: 'player' | 'npc' }
  | { type: 'youDied'; victimId: string }
  | {
      type: 'credits';
      playerId: string;
      credits: number;
      gold: number;
      kills: number;
      rockets: number;
    }
  | { type: 'loot'; playerId: string; credits: number; rockets: number }
  | { type: 'portal'; playerId: string; portalId: string }
  | {
      type: 'portalChannel';
      playerId: string;
      portalId: string;
      endsAt: number;
    }
  | { type: 'portalCancel'; playerId: string; reason: string };
