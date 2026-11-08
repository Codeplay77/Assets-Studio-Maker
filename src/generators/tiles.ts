/** Grid directions, in the order a quarter turn advances them. */
export const NORTH = 0; // +Z
export const EAST = 1; // +X
export const SOUTH = 2; // -Z
export const WEST = 3; // -X

export type Direction = number;

/** [x, z] movement for each direction. */
export const STEPS: [number, number][] = [
  [0, 1],
  [1, 0],
  [0, -1],
  [-1, 0],
];

export const opposite = (direction: Direction): Direction => (direction + 2) % 4;

/** Openings of each tile before any rotation. */
export const TILE_OPENINGS = {
  straight: [NORTH, SOUTH],
  curve: [NORTH, EAST],
  t: [NORTH, SOUTH, EAST],
  cross: [NORTH, EAST, SOUTH, WEST],
} as const;

export type TileKind = keyof typeof TILE_OPENINGS;

export function rotateOpenings(openings: readonly Direction[], steps: number): Direction[] {
  return openings.map((direction) => (direction + steps) % 4);
}

/** The tile and quarter turns that connect exactly the wanted directions. */
export function fitTile(wanted: readonly Direction[]): { kind: TileKind; yawSteps: number } {
  const target = [...wanted].sort().join();
  for (const kind of Object.keys(TILE_OPENINGS) as TileKind[]) {
    for (let yawSteps = 0; yawSteps < 4; yawSteps++) {
      const rotated = rotateOpenings(TILE_OPENINGS[kind], yawSteps);
      if ([...new Set(rotated)].sort().join() === target) return { kind, yawSteps };
    }
  }
  throw new Error(`Nenhum bloco conecta as direções ${target}`);
}

/** Rotates a tile-local [x, z] offset by quarter turns. */
export function rotateOffset([x, z]: [number, number], steps: number): [number, number] {
  let rx = x;
  let rz = z;
  for (let i = 0; i < ((steps % 4) + 4) % 4; i++) [rx, rz] = [rz, -rx];
  return [rx, rz];
}
