import type { BlockCategory, BlockDef } from "../types.ts";
import { basicBlocks } from "./basic.ts";
import { bodyBlocks } from "./body.ts";
import { cityBlocks } from "./city.ts";
import { homeBlocks } from "./family/homes.ts";
import { bakedBlocks } from "./family/baked.ts";
import { lowPolyBlocks } from "./lowpoly.ts";
import { modelBlocks } from "./models.generated.ts";
import { natureBlocks } from "./nature.ts";
import { roadBlocks } from "./roads.ts";
import { arcadeFromLowPoly, arcadeFromRealistic } from "./styleize.ts";
import { voxelBlocks } from "./voxel.ts";

export const categories: BlockCategory[] = [
  { id: "lib_vehicles", name: "Veículos", group: "library" },
  { id: "lib_city", name: "Construções", group: "library" },
  { id: "lib_roads", name: "Ruas", group: "library" },
  { id: "lib_nature", name: "Natureza", group: "library" },
  { id: "lib_people", name: "Personagens", group: "library" },

  { id: "body", name: "Corpo", group: "parts" },
  { id: "face", name: "Rosto", group: "parts" },
  { id: "hair", name: "Cabelo", group: "parts" },
  { id: "vehicle", name: "Veículos", group: "parts" },
  { id: "wheel", name: "Rodas", group: "parts" },
  { id: "building", name: "Prédios", group: "parts" },
  { id: "city", name: "Cidade", group: "parts" },
  { id: "road", name: "Ruas", group: "parts" },
  { id: "nature", name: "Natureza", group: "parts" },
  { id: "basic", name: "Formas", group: "parts" },
];

const arcadeRoads = [...roadBlocks, ...cityBlocks, ...natureBlocks].filter((block) => !block.id.startsWith("road.parking"));

/** Arcade is built from the editor's other sets, plus its own houses. */
const arcadeFamily: BlockDef[] = [
  ...homeBlocks,
  ...lowPolyBlocks.map(arcadeFromLowPoly),
  ...arcadeRoads.map(arcadeFromRealistic),
];

/** The race track kit stays out of the editor. Its grass tile is what low poly city parks are made of. */
const libraryModels: BlockDef[] = modelBlocks.flatMap((block) => {
  if (block.category !== "lib_race") return [block];
  return block.id === "kit.racing.grass" ? [{ ...block, category: "lib_nature" }] : [];
});

export const blocks: BlockDef[] = [
  ...basicBlocks,
  ...bodyBlocks,
  ...roadBlocks,
  ...cityBlocks,
  ...natureBlocks,
  ...lowPolyBlocks,
  ...voxelBlocks,
  ...arcadeFamily,
  ...bakedBlocks,
  ...libraryModels,
];
