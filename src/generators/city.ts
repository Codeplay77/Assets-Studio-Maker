import { ROAD_TILE, SIDEWALK_HEIGHT } from "../blocks/definitions/roads.ts";
import type { Assembler } from "./assembler";
import { buildBuilding, buildHouse, buildTree } from "./buildings";
import { KIT_STREET_CARS } from "./kit";
import type { Rng } from "./rng";
import { EAST, fitTile, NORTH, rotateOffset, SOUTH, WEST, type Direction } from "./tiles";

const ROAD_TOP = 0.04;
const SIDEWALK_INSET = ROAD_TILE / 2 - 0.5;
const LANE_OFFSET = 1.5;

const ROAD_BLOCK: Record<string, string> = {
  straight: "road.straight",
  curve: "road.curve",
  t: "road.t",
  cross: "road.cross",
};

/** Road lines run every `spacing` tiles and form a closed grid. */
export function buildCity(asm: Assembler, rng: Rng): void {
  const spacing = 3;
  const blocksAcross = rng.int(2, 3);
  const size = blocksAcross * spacing + 1;
  const center = ((size - 1) * ROAD_TILE) / 2;
  const isRoad = (index: number) => index % spacing === 0;
  const world = (i: number, j: number): [number, number] => [
    i * ROAD_TILE - center,
    j * ROAD_TILE - center,
  ];

  for (let i = 0; i < size; i++) {
    for (let j = 0; j < size; j++) {
      const [x, z] = world(i, j);
      if (isRoad(i) || isRoad(j)) placeRoad(asm, rng, i, j, x, z, size, isRoad);
      else placeLot(asm, rng, i, j, x, z, spacing);
    }
  }
}

function placeRoad(
  asm: Assembler,
  rng: Rng,
  i: number,
  j: number,
  x: number,
  z: number,
  size: number,
  isRoad: (index: number) => boolean,
): void {
  const openings: Direction[] = [];
  if (isRoad(i) && j < size - 1) openings.push(NORTH);
  if (isRoad(i) && j > 0) openings.push(SOUTH);
  if (isRoad(j) && i < size - 1) openings.push(EAST);
  if (isRoad(j) && i > 0) openings.push(WEST);

  const { kind, yawSteps } = fitTile(openings);
  const crossing = kind === "straight" && rng.chance(0.15);
  asm.add(crossing ? "road.crosswalk" : ROAD_BLOCK[kind], [x, 0, z], { yawSteps });
  if (kind !== "straight") return;

  const side = rng.chance(0.5) ? 1 : -1;
  if (rng.chance(0.6)) {
    const [dx, dz] = rotateOffset([side * SIDEWALK_INSET, 0], yawSteps);
    asm.add("city.lamp", [x + dx, SIDEWALK_HEIGHT, z + dz], { yawSteps: yawSteps + (side > 0 ? 3 : 1) });
  }
  if (!crossing && rng.chance(0.45)) {
    const lane = rng.chance(0.5) ? 1 : -1;
    const [dx, dz] = rotateOffset([lane * LANE_OFFSET, 0], yawSteps);
    asm.add(rng.pick(KIT_STREET_CARS), [x + dx, ROAD_TOP, z + dz], {
      yawSteps: yawSteps + (lane > 0 ? 2 : 0),
    });
  }
}

function placeLot(
  asm: Assembler,
  rng: Rng,
  i: number,
  j: number,
  x: number,
  z: number,
  spacing: number,
): void {
  // Each block has a character, so its lots match. Seeded by block, not by lot.
  const blockI = Math.floor(i / spacing);
  const blockJ = Math.floor(j / spacing);
  const character = (blockI * 7 + blockJ * 13) % 4;
  const parkBlock = character === 3;

  if (parkBlock) {
    asm.add("road.grass", [x, 0, z]);
    for (let n = rng.int(2, 4); n > 0; n--) {
      buildTree(asm, rng, {
        position: [x + rng.range(-3, 3), 0.1, z + rng.range(-3, 3)],
        kinds: ["oak", "birch", "pine"],
      });
    }
    if (rng.chance(0.6)) asm.add("city.bench", [x + rng.range(-2, 2), 0.1, z + rng.range(-2, 2)], { yawSteps: rng.int(0, 3) });
    return;
  }

  asm.add("road.sidewalk", [x, 0, z]);
  const nearWest = i % spacing === 1;
  const nearSouth = j % spacing === 1;
  const facesX = rng.chance(0.5);
  const yawSteps = facesX ? (nearWest ? WEST : EAST) : nearSouth ? SOUTH : NORTH;
  const position: [number, number, number] = [x, SIDEWALK_HEIGHT, z];

  if (character === 0) buildHouse(asm, rng, { position, yawSteps });
  else buildBuilding(asm, rng, { position, yawSteps, minFloors: 2, maxFloors: character === 1 ? 5 : 12 });
}
