import { blocks, getBlock } from "../blocks/catalog";
import type { Vec3 } from "../core/types";
import type { Assembler, PartOptions } from "./assembler";
import type { Rng } from "./rng";

// Lists come from the catalog, so a re-import with more models is picked up automatically.
const matching = (pattern: RegExp) => blocks.filter((block) => pattern.test(block.id)).map((block) => block.id);

export const KIT_TRACTORS = matching(/^kit\.car-kit\.(tractor|tractor-shovel)$/);

export const KIT_BUILDINGS = matching(/^kit\.commercial\.building-[a-z]$/);
export const KIT_TOWERS = matching(/^kit\.commercial\.building-skyscraper-.+$/);
export const KIT_HOUSES = matching(/^kit\.suburban\.building-type-.+$/);
export const KIT_LEAFY_TREES = matching(/^kit\.nature\.tree_(default|oak|fat|tall|simple|detailed|plateau|thin)$/);
export const KIT_AUTUMN_TREES = matching(/^kit\.nature\.tree_(default|oak|fat|tall|simple|detailed|plateau|thin)_fall$/);
export const KIT_PINE_TREES = matching(/^kit\.nature\.tree_(cone|pineRound[A-F]|pineTall[A-D])$/);
export const KIT_PALM_TREES = matching(/^kit\.nature\.tree_palm(Short|Tall|Bend|DetailedShort|DetailedTall)?$/);
export const KIT_ROCKS = matching(/^kit\.nature\.(rock|stone)_small[A-Z]$/);
export const KIT_BOULDERS = matching(/^kit\.nature\.(rock|stone)_large[A-Z]$/);
export const KIT_BUSHES_ONLY = matching(/^kit\.nature\.plant_bush[A-Za-z]*$/);
export const KIT_FLOWERS = matching(/^kit\.nature\.flower_[A-Za-z]+$/);
export const KIT_TUFTS = matching(/^kit\.nature\.grass(_[A-Za-z]+)?$/);
export const KIT_CACTI = matching(/^kit\.nature\.cactus_[a-z]+$/);
export const KIT_STUMPS = matching(/^kit\.nature\.stump_[A-Za-z]+$/);
export const KIT_BUSHES = matching(/^kit\.nature\.(plant_bush[A-Za-z]*|flower_[A-Za-z]+)$/);

/** Largest horizontal side of a model, in meters. */
export function footprint(block: string): number {
  const { shape } = getBlock(block);
  if (shape.kind !== "model") return 0;
  return Math.max(shape.max[0] - shape.min[0], shape.max[2] - shape.min[2]);
}

export function modelHeight(block: string): number {
  const { shape } = getBlock(block);
  return shape.kind === "model" ? shape.max[1] - shape.min[1] : 0;
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
