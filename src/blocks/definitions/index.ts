import type { BlockCategory, BlockDef } from "../types.ts";
import { basicBlocks } from "./basic.ts";
import { bodyBlocks } from "./body.ts";
import { cityBlocks } from "./city.ts";
import { modelBlocks } from "./models.generated.ts";
import { natureBlocks } from "./nature.ts";
import { roadBlocks } from "./roads.ts";
import { vehicleBlocks } from "./vehicles.ts";

export const categories: BlockCategory[] = [
  { id: "lib_vehicles", name: "Veículos", group: "library" },
  { id: "lib_city", name: "Construções", group: "library" },
  { id: "lib_roads", name: "Ruas", group: "library" },
  { id: "lib_race", name: "Autódromo", group: "library" },
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
  { id: "track", name: "Pistas", group: "parts" },
  { id: "nature", name: "Natureza", group: "parts" },
  { id: "basic", name: "Formas", group: "parts" },
];

export const blocks: BlockDef[] = [
  ...basicBlocks,
  ...bodyBlocks,
  ...vehicleBlocks,
  ...roadBlocks,
  ...cityBlocks,
  ...natureBlocks,
  ...modelBlocks,
];
