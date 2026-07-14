/** Max escort droids a player can own */
export const MAX_DROIDS = 8;

/**
 * Acquisition order → formation side:
 * 1–3 back, 4 right, 5 left, 6 back, 7 right, 8 left
 * Full set: 4 back · 2 right · 2 left (matches red marks)
 */
const DROID_SIDES = [
  'back',
  'back',
  'back',
  'right',
  'left',
  'back',
  'right',
  'left',
] as const;

/**
 * Ship-local offsets: +X forward (nose), +Y right.
 *
 * Back pack = diamond (numbered like the sketch, ship ahead of pack):
 *       3  (closer to ship)
 *   2       1
 *       4  (further aft)
 * Fill order for back slots: 1 → 2 → 3 → 4
 */
const BACK_R = 125;
const BACK_S = 22;
const BACK_OFFSETS = [
  { x: -BACK_R, y: BACK_S }, // 1 right
  { x: -BACK_R, y: -BACK_S }, // 2 left
  { x: -(BACK_R - BACK_S), y: 0 }, // 3 toward ship
  { x: -(BACK_R + BACK_S), y: 0 }, // 4 further back
];

const RIGHT_OFFSETS = [
  { x: 6, y: 94 },
  { x: -30, y: 94 },
];

const LEFT_OFFSETS = [
  { x: 12, y: -94 },
  { x: -44, y: -94 },
];

export function droidLocalOffset(index: number): { x: number; y: number } {
  const side = DROID_SIDES[Math.max(0, Math.min(MAX_DROIDS - 1, index))];
  let slot = 0;
  for (let i = 0; i < index; i++) {
    if (DROID_SIDES[i] === side) slot += 1;
  }
  if (side === 'back') return BACK_OFFSETS[slot] ?? BACK_OFFSETS[0];
  if (side === 'right') return RIGHT_OFFSETS[slot] ?? RIGHT_OFFSETS[0];
  return LEFT_OFFSETS[slot] ?? LEFT_OFFSETS[0];
}

/** Hangar UI clusters (L-shape per wing + center back pair) */
export const DROID_UI_LEFT = [1, 4, 7] as const;
export const DROID_UI_RIGHT = [0, 3, 6] as const;
export const DROID_UI_CENTER = [2, 5] as const;
