import type { ArtStyle } from "../blocks/styles";
import { ROAD_TILE, SIDEWALK_HEIGHT } from "../blocks/definitions/roads.ts";
import type { Assembler } from "./assembler";
import { buildBuilding, buildHouse, buildTree } from "./buildings";
import { buildVehicle } from "./car";
import type { Rng } from "./rng";
import { buildStreetCity } from "./streetCity";
import { EAST, fitTile, NORTH, rotateOffset, SOUTH, WEST, type Direction, type TileKind } from "./tiles";

const LANE_OFFSET = 1.5;

export interface CityKit {
  road: Record<TileKind, string>;
  crosswalk: string;
  /** Quarter turns between this kit's tiles and the openings in tiles.ts. */
  yaw: number;
  roadTop: number;
  sidewalk: string;
  sidewalkTop: number;
  park: string;
  parkTop: number;
  lamp?: string;
  bench?: string;
}

const CITY_KITS: Record<ArtStyle, CityKit> = {
  realistic: {
    road: { straight: "road.straight", curve: "road.curve", t: "road.t", cross: "road.cross" },
    crosswalk: "road.crosswalk",
    yaw: 0,
    roadTop: 0.04,
    sidewalk: "road.sidewalk",
    sidewalkTop: SIDEWALK_HEIGHT,
    park: "road.grass",
    parkTop: 0.1,
    lamp: "city.lamp",
    bench: "city.bench",
  },
  lowpoly: {
    road: {
      straight: "kit.roads.road-straight",
      curve: "kit.roads.road-bend",
      t: "kit.roads.road-intersection",
      cross: "kit.roads.road-crossroad",
    },
    crosswalk: "kit.roads.road-crossing",
    yaw: 1,
    roadTop: 0.08,
    sidewalk: "kit.roads.tile-low",
    sidewalkTop: 0.16,
    park: "kit.racing.grass",
    parkTop: 0.02,
    lamp: "kit.roads.light-curved",
  },
  arcade: {
    road: { straight: "ar.road_straight", curve: "ar.road_curve", t: "ar.road_t", cross: "ar.road_cross" },
    crosswalk: "ar.road_crosswalk",
    yaw: 0,
    roadTop: 0.04,
    sidewalk: "ar.road_sidewalk",
    sidewalkTop: SIDEWALK_HEIGHT,
    park: "ar.road_grass",
    parkTop: 0.1,
    lamp: "ar.city_lamp",
    bench: "ar.city_bench",
  },
  blocks: {
    road: { straight: "vx.road_straight", curve: "vx.road_curve", t: "vx.road_t", cross: "vx.road_cross" },
    crosswalk: "vx.road_crosswalk",
    yaw: 0,
    roadTop: 0.05,
    sidewalk: "vx.sidewalk",
    sidewalkTop: SIDEWALK_HEIGHT,
    park: "vx.grass",
    parkTop: 0.1,
    lamp: "vx.lamp",
    bench: "vx.bench",
  },
};

export interface CityOptions {
  style?: ArtStyle;
  /** "grid" keeps every block square; the others let the streets wander. */
  layout?: string;
  /** Blocks along each side. */
  width?: string;
  length?: string;
  /** Lots along each side of a block. */
  lots?: string;
  height?: string;
  density?: string;
  traffic?: string;
}

/** The tallest a building can be, in floors. */
const TALLEST: Record<string, number> = { low: 3, medium: 6, tall: 12, skyscraper: 20 };
const DEFAULT_TALLEST = 12;
const CAR_CHANCE = 0.45;
/** Large cities keep about this many cars, because each one is a detailed model. */
const MOST_CARS = 60;

interface CityPlan {
  style: ArtStyle;
  kit: CityKit;
  density: string | undefined;
  cars: boolean;
  carChance: number;
  /** Tiles from one road to the next. */
  spacing: number;
  tallest: number;
}

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

export function buildCity(asm: Assembler, rng: Rng, options: CityOptions = {}): void {
  const style = options.style ?? "realistic";
  const blocksAcross = (name: "width" | "length") => {
    const value = chosen(options[name]);
    return value ? Number(value) : rng.fork(name).int(2, 3);
  };
  const blocksX = blocksAcross("width");
  const blocksZ = blocksAcross("length");
  const lots = Number(chosen(options.lots) ?? 2);
  const layout = chosen(options.layout) ?? rng.fork("layout").pick(["irregular", "organic"]);
  if (layout === "grid") {
    buildGridCity(asm, rng, options, style, blocksX, blocksZ, lots + 1);
    return;
  }
  buildStreetCity(asm, rng, {
    style,
    kit: CITY_KITS[style],
    layout,
    blocksX,
    blocksZ,
    lots,
    tallest: TALLEST[chosen(options.height) ?? ""] ?? DEFAULT_TALLEST,
    density: chosen(options.density),
    cars: options.traffic !== "no",
  });
}

/** Road lines run every `spacing` tiles and form a closed grid. */
function buildGridCity(asm: Assembler, rng: Rng, options: CityOptions, style: ArtStyle, blocksX: number, blocksZ: number, spacing: number): void {
  const tilesX = blocksX * spacing + 1;
  const tilesZ = blocksZ * spacing + 1;
  const centerX = ((tilesX - 1) * ROAD_TILE) / 2;
  const centerZ = ((tilesZ - 1) * ROAD_TILE) / 2;
  const isRoad = (index: number) => index % spacing === 0;
  const roadTiles = (blocksX + 1) * tilesZ + (blocksZ + 1) * tilesX;
  const plan: CityPlan = {
    style,
    kit: CITY_KITS[style],
    density: chosen(options.density),
    cars: options.traffic !== "no",
    carChance: Math.min(CAR_CHANCE, MOST_CARS / roadTiles),
    spacing,
    tallest: TALLEST[chosen(options.height) ?? ""] ?? DEFAULT_TALLEST,
  };

  for (let i = 0; i < tilesX; i++) {
    for (let j = 0; j < tilesZ; j++) {
      const x = i * ROAD_TILE - centerX;
      const z = j * ROAD_TILE - centerZ;
      if (isRoad(i) || isRoad(j)) placeRoad(asm, rng, plan, i, j, x, z, tilesX, tilesZ, isRoad);
      else placeLot(asm, rng, plan, i, j, x, z);
    }
  }
}

function placeRoad(
  asm: Assembler,
  rng: Rng,
  plan: CityPlan,
  i: number,
  j: number,
  x: number,
  z: number,
  tilesX: number,
  tilesZ: number,
  isRoad: (index: number) => boolean,
): void {
  const { kit } = plan;
  const openings: Direction[] = [];
  if (isRoad(i) && j < tilesZ - 1) openings.push(NORTH);
  if (isRoad(i) && j > 0) openings.push(SOUTH);
  if (isRoad(j) && i < tilesX - 1) openings.push(EAST);
  if (isRoad(j) && i > 0) openings.push(WEST);

  const { kind, yawSteps } = fitTile(openings);
  const crossing = kind === "straight" && rng.chance(0.15);
  asm.add(crossing ? kit.crosswalk : kit.road[kind], [x, 0, z], { yawSteps: yawSteps + kit.yaw });
  if (kind !== "straight") return;

  const side = rng.chance(0.5) ? 1 : -1;
  if (kit.lamp && rng.chance(0.6)) {
    const [dx, dz] = rotateOffset([side * (ROAD_TILE / 2 - 0.5), 0], yawSteps);
    asm.add(kit.lamp, [x + dx, kit.sidewalkTop, z + dz], { yawSteps: yawSteps + (side > 0 ? 3 : 1) });
  }
  const carHere = rng.chance(plan.carChance);
  if (!crossing && carHere && plan.cars) {
    const lane = rng.chance(0.5) ? 1 : -1;
    const [dx, dz] = rotateOffset([lane * LANE_OFFSET, 0], yawSteps);
    const position: [number, number, number] = [x + dx, kit.roadTop, z + dz];
    const yaw = yawSteps + (lane > 0 ? 2 : 0);
    buildVehicle(asm, rng.fork(`car ${i} ${j}`), { style: plan.style, kind: "car", position, yawSteps: yaw });
  }
}

function placePark(asm: Assembler, rng: Rng, plan: CityPlan, i: number, j: number, x: number, z: number): void {
  const { kit, style } = plan;
  asm.add(kit.park, [x, 0, z]);
  for (let n = rng.int(2, 4); n > 0; n--) {
    buildTree(asm, rng.fork(`tree ${i} ${j} ${n}`), {
      style,
      position: [x + rng.range(-3, 3), kit.parkTop, z + rng.range(-3, 3)],
      kind: rng.chance(0.7) ? "leafy" : "pine",
    });
  }
  if (kit.bench && rng.chance(0.6)) {
    asm.add(kit.bench, [x + rng.range(-2, 2), kit.parkTop, z + rng.range(-2, 2)], { yawSteps: rng.int(0, 3) });
  }
}

function placeLot(asm: Assembler, rng: Rng, plan: CityPlan, i: number, j: number, x: number, z: number): void {
  const { kit, style, spacing } = plan;
  const west = i % spacing === 1;
  const east = i % spacing === spacing - 1;
  const south = j % spacing === 1;
  const north = j % spacing === spacing - 1;
  const alongX = west || east;
  const alongZ = south || north;
  // A lot in the middle of a large block has no street, so it becomes a courtyard.
  if (!alongX && !alongZ) {
    placePark(asm, rng, plan, i, j, x, z);
    return;
  }

  // Each block has a character, so its lots match. Seeded by block, not by lot.
  const blockI = Math.floor(i / spacing);
  const blockJ = Math.floor(j / spacing);
  const natural = (blockI * 7 + blockJ * 13) % 4;
  const character = plan.density === "suburb" ? (natural === 3 ? 3 : 0) : plan.density === "downtown" ? (natural === 3 ? 2 : natural === 0 ? 1 : natural) : natural;

  if (character === 3) {
    placePark(asm, rng, plan, i, j, x, z);
    return;
  }

  asm.add(kit.sidewalk, [x, 0, z]);
  const facesX = alongX && (!alongZ || rng.chance(0.5));
  const yawSteps = facesX ? (west ? WEST : EAST) : south ? SOUTH : NORTH;
  const position: [number, number, number] = [x, kit.sidewalkTop, z];
  const lot = rng.fork(`lot ${i} ${j}`);

  if (character === 0) buildHouse(asm, lot, { style, position, yawSteps });
  else buildBuilding(asm, lot, { style, position, yawSteps, minFloors: 2, maxFloors: character === 1 ? Math.min(5, plan.tallest) : plan.tallest });
}
