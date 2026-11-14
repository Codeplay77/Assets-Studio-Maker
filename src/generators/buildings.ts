import { HOUSE_IDS, HOUSE_ROOFS, HOUSE_WALLS, TOWER_ACCENTS, TOWER_FLOORS, TOWER_GROUNDS, TOWER_ROOFS, TOWER_TRIMS, TOWER_WALLS } from "../blocks/definitions/family/homes.ts";
import type { ArtStyle } from "../blocks/styles";
import type { Vec3 } from "../core/types";
import type { AssembledPart, Assembler } from "./assembler";
import { addLayers } from "./kart";
import { buildRealHouse } from "./realHouse";
import { buildRealTower, REAL_TOWER_COLORS } from "./realTower";
import { REAL_TREES, realBlocks } from "./realNature";
import {
  KIT_AUTUMN_TREES,
  KIT_BUILDINGS,
  KIT_HOUSES,
  KIT_LEAFY_TREES,
  KIT_PALM_TREES,
  KIT_PINE_TREES,
  KIT_TOWERS,
  modelHeight,
  placeFitted,
} from "./kit";
import type { Rng } from "./rng";

export const WALL_COLORS = ["#b8876a", "#c9b89a", "#d6d8dc", "#a8c0b0", "#c96a4a", "#8d98a6", "#d9c28f", "#9a7f6e"];
export const HOUSE_COLORS = ["#e8d6b0", "#b7cfc0", "#d9b8a8", "#c4d3e0", "#ece7d8", "#e0c07a"];
export const ROOF_COLORS = ["#a64b35", "#6d4c41", "#54606e", "#3f6b52"];
/** Realista houses, when nobody picked: the paint and roofs seen on real streets. */
const REAL_HOUSE_COLORS = ["#efe6d2", "#e3d3b5", "#d9c7b0", "#e8e4dc", "#d6c9a8", "#cdd2cc", "#e2c9a6", "#d8b9a0"];
const REAL_ROOF_COLORS = ["#a64b35", "#a64b35", "#6d4c41", "#54606e"];
const TREE_LEAVES = ["#3fae5a", "#4c9e55", "#7fb04a", "#2f7a4e"];
const AUTUMN_LEAVES = ["#d98a2b", "#c9502e", "#e0b13a"];

const LOT_WIDTH = 7.4;

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

interface BuildingKit {
  prefix: string;
  floors: string[];
  grounds: string[];
  roofs: string[];
  tallRoofs: string[];
}

const BUILDING_KITS: Record<"realistic" | "blocks", BuildingKit> = {
  realistic: {
    prefix: "building",
    floors: ["floor_windows", "floor_narrow", "floor_ribbon", "floor_curtain", "floor_balcony"],
    grounds: ["ground_shop", "ground_cafe", "ground_office"],
    roofs: ["roof_flat", "roof_tank", "roof_antenna", "roof_helipad", "roof_hip"],
    tallRoofs: ["roof_antenna", "roof_helipad"],
  },
  blocks: {
    prefix: "vx",
    floors: ["floor_windows", "floor_narrow", "floor_ribbon"],
    grounds: ["ground_shop", "ground_cafe", "ground_office"],
    roofs: ["roof_flat", "roof_tank", "roof_antenna"],
    tallRoofs: ["roof_antenna", "roof_tank"],
  },
};

const FLOORS_BY_SIZE: Record<string, [number, number]> = { low: [1, 3], medium: [4, 7], tall: [8, 14] };

export interface BuildingOptions {
  style?: ArtStyle;
  position?: Vec3;
  yawSteps?: number;
  minFloors?: number;
  maxFloors?: number;
  size?: string;
  color?: string;
  ground?: string;
  floor?: string;
  roof?: string;
  paint?: string;
  trim?: string;
  accent?: string;
  /** Width along the street and depth of the lot it has to fit, in meters. */
  lot?: [number, number];
}

function buildArcadeTower(asm: Assembler, rng: Rng, options: BuildingOptions): void {
  const size = chosen(options.size);
  const [min, max] = size ? FLOORS_BY_SIZE[size] : [options.minFloors ?? 2, options.maxFloors ?? 12];
  const floors = rng.fork("floors").int(min, max);
  const ground = chosen(options.ground) ?? rng.fork("ground").pick(TOWER_GROUNDS);
  const floor = chosen(options.floor) ?? rng.fork("floor").pick(TOWER_FLOORS);
  const roof = chosen(options.roof) ?? rng.fork("roof").pick(TOWER_ROOFS);
  const paint = chosen(options.paint) ?? rng.fork("paint").pick(TOWER_WALLS);
  const trim = chosen(options.trim) ?? rng.fork("trim").pick(TOWER_TRIMS);
  const accent = chosen(options.accent) ?? rng.fork("accent").pick(TOWER_ACCENTS);
  const colors = { paint, trim, accent };

  const piece = (from: AssembledPart | null, id: string) => {
    const full = `ar.torre_${id}`;
    const part = from ? asm.attach(from, "top", `${full}_base`) : asm.add(`${full}_base`, options.position ?? [0, 0, 0], { yawSteps: options.yawSteps });
    addLayers(asm, part, full, colors);
    return part;
  };
  let top = piece(null, `terreo_${ground}`);
  for (let i = 0; i < floors; i++) top = piece(top, `andar_${floor}`);
  piece(top, `topo_${roof}`);
}

function buildModularTower(asm: Assembler, rng: Rng, style: "realistic" | "blocks", options: BuildingOptions): void {
  const kit = BUILDING_KITS[style];
  const color = chosen(options.color) ?? rng.fork("color").pick(style === "realistic" ? REAL_TOWER_COLORS : WALL_COLORS);
  const size = chosen(options.size);
  const [min, max] = size ? FLOORS_BY_SIZE[size] : [options.minFloors ?? 2, options.maxFloors ?? 12];
  const floorCount = rng.fork("floors").int(min, max);
  if (style === "realistic") {
    buildRealTower(asm, rng.fork("real tower"), color, { position: options.position, yawSteps: options.yawSteps, floors: floorCount, lot: options.lot });
    return;
  }
  const floor = rng.fork("floor").pick(kit.floors);
  const ground = asm.add(`${kit.prefix}.${rng.fork("ground").pick(kit.grounds)}`, options.position ?? [0, 0, 0], {
    color,
    yawSteps: options.yawSteps,
  });

  let top = ground;
  for (let i = 0; i < floorCount; i++) top = asm.attach(top, "top", `${kit.prefix}.${floor}`, { color });
  const roof = rng.fork("roof").pick(floorCount > 7 ? kit.tallRoofs : kit.roofs);
  asm.attach(top, "top", `${kit.prefix}.${roof}`, roof === "roof_hip" ? { color: rng.fork("roof color").pick(ROOF_COLORS) } : {});
}

/** Ready-made low poly buildings, sorted out by how tall each one is. */
function lowPolyBuildings(size: string | undefined, maxFloors: number | undefined): string[] {
  const all = [...KIT_BUILDINGS, ...KIT_TOWERS];
  if (size) {
    const fits = all.filter((id) => {
      const height = modelHeight(id);
      return size === "low" ? height < 15 : size === "medium" ? height >= 15 && height < 30 : height >= 30;
    });
    if (fits.length > 0) return fits;
  }
  return (maxFloors ?? 12) > 6 ? all : KIT_BUILDINGS;
}

export function buildBuilding(asm: Assembler, rng: Rng, options: BuildingOptions = {}): void {
  const style = options.style ?? "realistic";
  if (style === "arcade") {
    buildArcadeTower(asm, rng, options);
    return;
  }
  if (style !== "lowpoly") {
    buildModularTower(asm, rng, style, options);
    return;
  }
  placeFitted(asm, rng.fork("model"), lowPolyBuildings(chosen(options.size), options.maxFloors), {
    position: options.position ?? [0, 0, 0],
    yawSteps: options.yawSteps,
    maxWidth: LOT_WIDTH,
  });
}

export interface HouseOptions {
  style?: ArtStyle;
  position?: Vec3;
  yawSteps?: number;
  size?: string;
  color?: string;
  roof?: string;
  model?: string;
  paint?: string;
  trim?: string;
  accent?: string;
  /** Width along the street and depth of the lot it has to fit, in meters. */
  lot?: [number, number];
}

/** A house is small or large compared to the other ready-made houses. */
function lowPolyHouses(size: string | undefined): string[] {
  if (!size) return KIT_HOUSES;
  const sorted = [...KIT_HOUSES].sort((a, b) => modelHeight(a) - modelHeight(b));
  const middle = Math.floor(sorted.length / 2);
  return size === "small" ? sorted.slice(0, middle) : sorted.slice(middle);
}

export function buildHouse(asm: Assembler, rng: Rng, options: HouseOptions = {}): void {
  const style = options.style ?? "realistic";
  if (style === "arcade") {
    const model = chosen(options.model) ?? rng.fork("model").pick(HOUSE_IDS);
    const id = `ar.casa_${model}`;
    const part = asm.add(`${id}_base`, options.position ?? [0, 0, 0], { yawSteps: options.yawSteps });
    addLayers(asm, part, id, {
      paint: chosen(options.paint) ?? rng.fork("paint").pick(HOUSE_WALLS),
      trim: chosen(options.trim) ?? rng.fork("trim").pick(HOUSE_ROOFS),
      accent: chosen(options.accent) ?? "#f4f4f4",
    });
    return;
  }
  if (style === "lowpoly") {
    placeFitted(asm, rng.fork("model"), lowPolyHouses(chosen(options.size)), {
      position: options.position ?? [0, 0, 0],
      yawSteps: options.yawSteps,
      maxWidth: LOT_WIDTH,
    });
    return;
  }

  const blocks = style === "blocks";
  const color = chosen(options.color) ?? rng.fork("color").pick(blocks ? HOUSE_COLORS : REAL_HOUSE_COLORS);
  if (!blocks) {
    buildRealHouse(asm, rng.fork("real house"), color, chosen(options.roof) ?? rng.fork("roof").pick(REAL_ROOF_COLORS), options);
    return;
  }
  const bodyBlock = blocks ? "vx.house_body" : `building.${rng.fork("body").pick(["house_body", "house_body_green"])}`;
  const body = asm.add(bodyBlock, options.position ?? [0, 0, 0], { color, yawSteps: options.yawSteps });
  asm.attach(body, "top", blocks ? "vx.house_roof" : "building.house_gable", {
    color: chosen(options.roof) ?? rng.fork("roof").pick(ROOF_COLORS),
  });
}

export interface TreeOptions {
  style?: ArtStyle;
  position?: Vec3;
  /** Which trees may appear. Defaults to everything of the chosen kind. */
  kind?: string;
  season?: string;
  size?: string;
  /** Maps and cities place hundreds of trees: Realista then uses the light copy of each. */
  light?: boolean;
}

const TREE_PREFIX: Partial<Record<ArtStyle, string>> = { realistic: "nature.", blocks: "vx.", arcade: "ar.nature_" };

const BUILT_TREES: Record<string, string[]> = {
  leafy: ["oak", "birch"],
  pine: ["pine", "pine_slim"],
  palm: ["palm"],
  dead: ["dead_tree"],
};

const LOW_POLY_TREES: Record<string, string[]> = {
  leafy: KIT_LEAFY_TREES,
  pine: KIT_PINE_TREES,
  palm: KIT_PALM_TREES,
};

const TREE_SCALES: Record<string, [number, number]> = { small: [0.65, 0.85], medium: [0.95, 1.15], large: [1.3, 1.6] };

export const treeKinds = (style: ArtStyle) =>
  style === "realistic" ? ["leafy", "pine", "dead"] : Object.keys(style === "lowpoly" ? LOW_POLY_TREES : BUILT_TREES);

export function buildTree(asm: Assembler, rng: Rng, options: TreeOptions = {}): void {
  const style = options.style ?? "realistic";
  const size = chosen(options.size);
  const [minScale, maxScale] = size ? TREE_SCALES[size] : [0.85, 1.4];
  const scale = rng.fork("scale").range(minScale, maxScale);
  const yawSteps = rng.fork("yaw").int(0, 3);
  const position = options.position ?? [0, 0, 0];
  const autumn = chosen(options.season) === "autumn";
  const wanted = chosen(options.kind);

  if (style === "lowpoly") {
    const kind = wanted ?? rng.fork("kind").pick(["leafy", "leafy", "leafy", "pine", "palm"]);
    const list = autumn && kind === "leafy" ? KIT_AUTUMN_TREES : (LOW_POLY_TREES[kind] ?? KIT_LEAFY_TREES);
    asm.add(rng.fork("model").pick(list), position, { scale, yawSteps });
    return;
  }

  if (style === "realistic") {
    const kind = wanted ?? rng.fork("kind").pick(["leafy", "leafy", "leafy", "pine", "dead"]);
    const list = realBlocks(REAL_TREES[kind] ?? REAL_TREES.leafy, options.light ?? false);
    if (list.length === 0) return;
    // The photographed leaves keep their own green; autumn tints only the leaves.
    asm.add(rng.fork("model").pick(list), position, { color: autumn && kind !== "dead" ? "#f0a24a" : "#ffffff", scale: scale * 0.85, yawSteps });
    return;
  }

  const prefix = TREE_PREFIX[style]!;
  const kind = wanted ?? rng.fork("kind").pick(["leafy", "leafy", "leafy", "pine", "palm", "dead"]);
  const name = rng.fork("model").pick(BUILT_TREES[kind] ?? BUILT_TREES.leafy);
  asm.add(`${prefix}${name}`, position, {
    color: name === "dead_tree" ? "#6e4a2c" : rng.fork("color").pick(autumn ? AUTUMN_LEAVES : TREE_LEAVES),
    scale,
    yawSteps,
  });
}
