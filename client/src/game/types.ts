export interface WorldConfig {
  width: number;
  height: number;
  maxHp: number;
  maxShield: number;
  shipSpeed: number;
  bulletSpeed: number;
  rocketSpeed?: number;
  bulletLifetimeMs: number;
  rocketLifetimeMs?: number;
  fireCooldownMs: number;
  rocketCooldownMs?: number;
  laserDamage?: number;
  rocketDamage?: number;
  laserRange: number;
  rocketRange: number;
  shipRadius: number;
  bulletRadius: number;
  rocketRadius?: number;
  arriveRadius?: number;
  npcCount: number;
  npcSpeed: number;
  npcRadius: number;
  npcHp: number;
  killCredits: number;
  npcCredits: number;
  cargoCollectRadius?: number;
  shieldRegenPerSec?: number;
  shieldRegenDelayMs?: number;
  radiationInset: number;
  radiationDps?: number;
  startingRockets?: number;
  portalRadius?: number;
  portalChannelMs?: number;
  portalUseRange?: number;
}

export interface PortalPublic {
  id: string;
  mapId: string;
  x: number;
  y: number;
  label: string;
  toMapId: string;
  toX: number;
  toY: number;
}

export interface StationPublic {
  id: string;
  mapId: string;
  x: number;
  y: number;
  label: string;
  safeRadius: number;
}

export interface PlayerPublic {
  id: string;
  name: string;
  mapId?: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp: number;
  shield: number;
  maxShield: number;
  credits: number;
  gold?: number;
  kills: number;
  rockets: number;
  laserAmmo: number;
  activeAmmoId?: string;
  ammo?: Record<string, number>;
  skillBar?: (string | null)[];
  shipId: string;
  shipSpeed: number;
  laserDamage: number;
  laserNpcBonus?: number;
  equippedLasers?: number;
  shipSprite: 'ship-player' | 'ship-elite' | 'ship-goliath';
  droidCount?: number;
  color: string;
  targetId: string | null;
  firing: boolean;
  moving: boolean;
  inRange: boolean;
}

export interface BulletPublic {
  id: string;
  ownerId: string;
  targetId?: string;
  aimX?: number;
  aimY?: number;
  frozen?: boolean;
  x: number;
  y: number;
  kind: 'laser' | 'rocket';
  tint?: number;
}

export interface NpcPublic {
  id: string;
  name: string;
  kind?: string;
  x: number;
  y: number;
  angle: number;
  hp: number;
  maxHp?: number;
  npcSprite?: string;
  enraged?: boolean;
}

export interface CargoPublic {
  id: string;
  x: number;
  y: number;
  credits: number;
  rockets: number;
}

export interface Snapshot {
  players: PlayerPublic[];
  bullets: BulletPublic[];
  npcs: NpcPublic[];
  cargo: CargoPublic[];
  portals: PortalPublic[];
  stations?: StationPublic[];
  mapId?: string;
  mapName?: string;
  serverTime: number;
}

export interface JoinResult {
  ok: boolean;
  error?: string;
  self?: Omit<PlayerPublic, 'moving' | 'inRange'>;
  world?: WorldConfig;
  snapshot?: Snapshot;
}

export interface PlayerInput {
  destX: number | null;
  destY: number | null;
  targetId: string | null;
  firing: boolean;
  fireRocket: boolean;
}
