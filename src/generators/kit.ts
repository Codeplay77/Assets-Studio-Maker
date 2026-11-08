import { blocks, getBlock } from "../blocks/catalog";
import type { Vec3 } from "../core/types";
import type { Assembler, PartOptions } from "./assembler";
import type { Rng } from "./rng";

// Lists come from the catalog, so a re-import with more models is picked up automatically.
const matching = (pattern: RegExp) => blocks.filter((block) => pattern.test(block.id)).map((block) => block.id);

export const KIT_STREET_CARS = matching(
  /^kit\.car-kit\.(sedan|sedan-sports|hatchback-sports|suv|suv-luxury|taxi|police|van|delivery)$/,
);
export const KIT_LARGE_VEHICLES = matching(
  /^kit\.car-kit\.(ambulance|firetruck|garbage-truck|truck|truck-flat|delivery-flat|tractor|tractor-police|tractor-shovel)$/,
);
export const KIT_RACERS = matching(/^kit\.car-kit\.(race|race-future|kart-.+)$/);
export const KIT_BUILDINGS = matching(/^kit\.commercial\.building-[a-z]$/);
export const KIT_TOWERS = matching(/^kit\.commercial\.building-skyscraper-.+$/);
export const KIT_HOUSES = matching(/^kit\.suburban\.building-type-.+$/);
export const KIT_TREES = matching(
  /^kit\.nature\.tree_(default|oak|fat|tall|simple|detailed|plateau|cone|pineRound[A-F]|pineTall[A-D])(_dark|_fall)?$/,
);
export const KIT_BUSHES = matching(/^kit\.nature\.(plant_bush[A-Za-z]*|flower_[A-Za-z]+)$/);
export const KIT_CHARACTERS = matching(/^kit\.blocky\./);

/** Largest horizontal side of a model, in meters. */
export function footprint(block: string): number {
  const { shape } = getBlock(block);
  if (shape.kind !== "model") return 0;
  return Math.max(shape.max[0] - shape.min[0], shape.max[2] - shape.min[2]);
}

export function placeKitModel(
  asm: Assembler,
  block: string,
  position: Vec3,
  options: PartOptions = {},
): void {
  asm.add(block, position, options);
}

export interface FitOptions {
  position: Vec3;
  yawSteps?: number;
  /** The model is scaled down, never up, to fit this width. */
  maxWidth: number;
}

export function placeFitted(asm: Assembler, rng: Rng, list: string[], options: FitOptions): void {
  const block = rng.pick(list);
  const size = footprint(block);
  asm.add(block, options.position, {
    yawSteps: options.yawSteps,
    scale: size > options.maxWidth ? options.maxWidth / size : 1,
  });
}
