import { blocks } from "../blocks/catalog";

// Realista plants and rocks are Poly Haven scans. Maps and cities scatter hundreds of them, so they
// use the light copy each one has (`_leve`); a tree made on its own gets the full one.

const PREFIX = "rz.polyhaven.";

/** Every block made from a Poly Haven model, its versions included, light or full. */
function versionsOf(source: string, light: boolean): string[] {
  const stem = PREFIX + source;
  return blocks
    .map(({ id }) => id)
    .filter((id) => (id === stem || id.startsWith(`${stem}_`)) && /^(_\d+)?(_leve)?$/.test(id.slice(stem.length)))
    .filter((id) => id.endsWith("_leve") === light);
}

/** Light copies when asked and there are any; the full models otherwise. */
export function realBlocks(sources: string[], light: boolean): string[] {
  const found = sources.flatMap((source) => {
    const wanted = versionsOf(source, light);
    return wanted.length > 0 ? wanted : versionsOf(source, false);
  });
  return [...new Set(found)];
}

/**
 * Poly Haven has no palms or standing dead trees: islands get its tropical trees, deserts its
 * quiver trees, and swamps fallen trunks and stumps.
 */
export const REAL_TREES: Record<string, string[]> = {
  leafy: ["island_tree_01", "island_tree_02", "island_tree_03", "tree_small_02", "jacaranda_tree"],
  pine: ["fir_tree_01", "pine_sapling_medium", "fir_sapling"],
  palm: ["island_tree_01", "island_tree_02", "quiver_tree_01"],
  dead: ["dead_tree_trunk_02", "tree_stump_01"],
};

export const REAL_PROPS = {
  rock: ["rock_07", "rock_09", "stone_01"],
  boulder: ["boulder_01", "namaqualand_boulder_02", "rock_moss_set_01"],
  bush: ["shrub_01", "shrub_02", "shrub_03", "shrub_04", "wild_rooibos_bush", "fern_02"],
  flower: ["flower_gazania", "dandelion_01", "celandine_01", "periwinkle_plant"],
  tuft: ["grass_medium_01", "grass_medium_02", "grass_bermuda_01", "nettle_plant"],
  cactus: ["quiver_tree_01"],
};
