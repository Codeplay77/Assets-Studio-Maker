import type { Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import { KIT_BUILDINGS, KIT_HOUSES, KIT_TOWERS, KIT_TREES, placeFitted } from "./kit";
import type { Rng } from "./rng";

const WALLS = ["#b8876a", "#c9b89a", "#d6d8dc", "#a8c0b0", "#c96a4a", "#8d98a6", "#d9c28f", "#9a7f6e"];
const HOUSE_WALLS = ["#e8d6b0", "#b7cfc0", "#d9b8a8", "#c4d3e0", "#ece7d8", "#e0c07a"];
const ROOF_TILES = ["#a64b35", "#6d4c41", "#54606e", "#3f6b52"];
const TREE_LEAVES = ["#3fae5a", "#4c9e55", "#7fb04a", "#d98a2b", "#c9502e", "#2f7a4e"];

const FLOORS = ["floor_windows", "floor_narrow", "floor_ribbon", "floor_curtain", "floor_balcony"];
const GROUNDS = ["ground_shop", "ground_cafe", "ground_office"];
const ROOFS = ["roof_flat", "roof_tank", "roof_antenna", "roof_helipad", "roof_hip"];
const TREES = ["oak", "birch", "pine", "pine_slim", "palm", "dead_tree"];

const LOT_WIDTH = 7.4;

export interface BuildingOptions {
  position?: Vec3;
  yawSteps?: number;
  minFloors?: number;
  maxFloors?: number;
}

function buildModularTower(asm: Assembler, rng: Rng, options: BuildingOptions): void {
  const color = rng.pick(WALLS);
  const floorCount = rng.int(options.minFloors ?? 2, options.maxFloors ?? 12);
  const floor = rng.pick(FLOORS);
  const ground = asm.add(`building.${rng.pick(GROUNDS)}`, options.position ?? [0, 0, 0], {
    color,
    yawSteps: options.yawSteps,
  });

  let top = ground;
  for (let i = 0; i < floorCount; i++) {
    top = asm.attach(top, "top", `building.${floor}`, { color });
  }
  const roof = floorCount > 7 ? rng.pick(["roof_antenna", "roof_helipad"]) : rng.pick(ROOFS);
  asm.attach(top, "top", `building.${roof}`, roof === "roof_hip" ? { color: rng.pick(ROOF_TILES) } : {});
}

export function buildBuilding(asm: Assembler, rng: Rng, options: BuildingOptions = {}): void {
  if (rng.chance(0.25)) {
    buildModularTower(asm, rng, options);
    return;
  }
  const tall = (options.maxFloors ?? 12) > 6 && rng.chance(0.4);
  placeFitted(asm, rng, tall ? KIT_TOWERS : KIT_BUILDINGS, {
    position: options.position ?? [0, 0, 0],
    yawSteps: options.yawSteps,
    maxWidth: LOT_WIDTH,
  });
}

export function buildHouse(asm: Assembler, rng: Rng, options: BuildingOptions = {}): void {
  if (rng.chance(0.75)) {
    placeFitted(asm, rng, KIT_HOUSES, {
      position: options.position ?? [0, 0, 0],
      yawSteps: options.yawSteps,
      maxWidth: LOT_WIDTH,
    });
    return;
  }
  const body = asm.add(
    `building.${rng.pick(["house_body", "house_body_green"])}`,
    options.position ?? [0, 0, 0],
    { color: rng.pick(HOUSE_WALLS), yawSteps: options.yawSteps },
  );
  asm.attach(body, "top", "building.house_gable", { color: rng.pick(ROOF_TILES) });
}

export interface TreeOptions {
  position?: Vec3;
  kinds?: string[];
}

export function buildTree(asm: Assembler, rng: Rng, options: TreeOptions = {}): void {
  if (rng.chance(0.8)) {
    asm.add(rng.pick(KIT_TREES), options.position ?? [0, 0, 0], {
      scale: rng.range(0.85, 1.4),
      yawSteps: rng.int(0, 3),
    });
    return;
  }
  const kind = rng.pick(options.kinds ?? TREES);
  asm.add(`nature.${kind}`, options.position ?? [0, 0, 0], {
    color: kind === "dead_tree" ? "#6e4a2c" : rng.pick(TREE_LEAVES),
    scale: rng.range(0.8, 1.35),
    yawSteps: rng.int(0, 3),
  });
}
