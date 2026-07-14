import type { MapId } from './game.types';

export type NpcKind = 'streuner' | 'cubikon' | 'protegit';

export interface NpcTemplate {
  kind: NpcKind;
  name: string;
  maxHp: number;
  credits: number;
  gold: number;
  /** 0 = instant respawn (streuner) */
  respawnMs: number;
  laserDamage: number;
  fireCooldownMs: number;
  speed: number;
  wanderSpeed: number;
  leashRange: number;
  laserRange: number;
  preferRange: number;
  sprite: string;
}

export const NPC_TEMPLATES: Record<NpcKind, NpcTemplate> = {
  streuner: {
    kind: 'streuner',
    name: 'Streuner',
    maxHp: 1200,
    credits: 1000,
    gold: 1000,
    respawnMs: 0,
    laserDamage: 55,
    fireCooldownMs: 420,
    speed: 70,
    wanderSpeed: 55,
    leashRange: 1100,
    laserRange: 580,
    preferRange: 360,
    sprite: 'ship-npc',
  },
  cubikon: {
    kind: 'cubikon',
    name: 'Cubikon',
    maxHp: 120_000,
    credits: 50_000,
    gold: 10_000,
    respawnMs: 30_000,
    laserDamage: 0,
    fireCooldownMs: 999_999,
    speed: 0,
    wanderSpeed: 0,
    leashRange: 9999,
    laserRange: 0,
    preferRange: 0,
    sprite: 'cubikon-idle',
  },
  protegit: {
    kind: 'protegit',
    name: 'Protegit',
    maxHp: 4_000,
    credits: 400,
    gold: 80,
    respawnMs: 0,
    laserDamage: 85,
    fireCooldownMs: 380,
    speed: 120,
    wanderSpeed: 90,
    leashRange: 1400,
    laserRange: 920,
    preferRange: 280,
    sprite: 'protegit',
  },
};

export const CUBIKON_MINION_COUNT = 20;
export const CUBIKON_MINION_DESPAWN_MS = 5000;
export const CUBIKON_ORBIT_RADIUS = 200;

export function bossSpawnPoint(mapId: MapId) {
  const maps: Record<MapId, { width: number; height: number }> = {
    'map-1': { width: 5600, height: 5600 },
    'map-2': { width: 5600, height: 5600 },
  };
  const m = maps[mapId];
  return { x: m.width / 2, y: m.height / 2 };
}
