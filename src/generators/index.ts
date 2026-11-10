import { ART_STYLES, DEFAULT_STYLE, type ArtStyle } from "../blocks/styles";
import type { GeneratedShape } from "../core/types";
import { Assembler, type GeneratedPart } from "./assembler";
import { buildBuilding, buildHouse, buildTree } from "./buildings";
import { buildVehicle } from "./car";
import { buildCity } from "./city";
import {
  ANY,
  BUILDING_OPTIONS,
  CITY_OPTIONS,
  HOUSE_OPTIONS,
  MAP_OPTIONS,
  PERSON_OPTIONS,
  TREE_OPTIONS,
  VEHICLE_OPTIONS,
  type GeneratorOption,
  type GeneratorSettings,
} from "./options";
import { buildPerson } from "./person";
import { Rng } from "./rng";
import { buildMap } from "./terrain";

export { ANY } from "./options";
export type { GeneratorOption, GeneratorSettings, OptionChoice } from "./options";

export interface Generator {
  id: string;
  name: string;
  options: GeneratorOption[];
  build(assembler: Assembler, rng: Rng, settings: GeneratorSettings): void;
}

export const generators: Generator[] = [
  {
    id: "person",
    name: "Pessoa",
    options: PERSON_OPTIONS,
    build: (asm, rng, { style, options }) => buildPerson(asm, rng, { style, ...options }),
  },
  {
    id: "car",
    name: "Veículo",
    options: VEHICLE_OPTIONS,
    build: (asm, rng, { style, options }) => buildVehicle(asm, rng, { style, ...options }),
  },
  {
    id: "building",
    name: "Prédio",
    options: BUILDING_OPTIONS,
    build: (asm, rng, { style, options }) => buildBuilding(asm, rng, { style, ...options }),
  },
  {
    id: "house",
    name: "Casa",
    options: HOUSE_OPTIONS,
    build: (asm, rng, { style, options }) => buildHouse(asm, rng, { style, ...options }),
  },
  {
    id: "tree",
    name: "Árvore",
    options: TREE_OPTIONS,
    build: (asm, rng, { style, options }) => buildTree(asm, rng, { style, ...options }),
  },
  {
    id: "city",
    name: "Cidade",
    options: CITY_OPTIONS,
    build: (asm, rng, { style, options }) => buildCity(asm, rng, { style, ...options }),
  },
  {
    id: "map",
    name: "Mapa",
    options: MAP_OPTIONS,
    build: (asm, rng, { style, options }) => buildMap(asm, rng, { style, ...options }),
  },
];

export function getGenerator(id: string): Generator {
  const generator = generators.find((candidate) => candidate.id === id);
  if (!generator) throw new Error(`Gerador desconhecido: ${id}`);
  return generator;
}

/** The options of a generator that make sense together with the other settings. */
export function visibleOptions(generator: Generator, settings: GeneratorSettings): GeneratorOption[] {
  return generator.options.filter((option) => option.applies?.(settings) ?? true);
}

/** Refuses a style, option or choice the generator does not have, and says which ones it has. */
export function validateSettings(id: string, settings: GeneratorSettings): void {
  const generator = getGenerator(id);
  if (!ART_STYLES.some(({ id: style }) => style === settings.style)) {
    throw new Error(`estilo desconhecido: ${settings.style}. Use: ${ART_STYLES.map((style) => style.id).join(", ")}`);
  }
  for (const [optionId, choice] of Object.entries(settings.options)) {
    const option = generator.options.find(({ id: candidate }) => candidate === optionId);
    if (!option) {
      throw new Error(`o gerador ${id} não tem a opção ${optionId}. Use: ${generator.options.map((item) => item.id).join(", ")}`);
    }
    if (choice === ANY) continue;
    const valid = option.choices(settings.style, settings.options).map((item) => item.id);
    if (!valid.includes(choice)) {
      throw new Error(`a opção ${optionId} não aceita ${choice} no estilo ${settings.style}. Use: ${valid.join(", ")}`);
    }
  }
}

/** Keeps only choices that still exist in the style, so switching style never breaks a build. */
export function settingsForStyle(id: string, style: ArtStyle, options: Record<string, string>): GeneratorSettings {
  const generator = getGenerator(id);
  const kept: Record<string, string> = {};
  for (const option of generator.options) {
    const choice = options[option.id];
    if (choice && choice !== ANY && option.choices(style, options).some((item) => item.id === choice)) kept[option.id] = choice;
  }
  return { style, options: kept };
}

export interface GeneratedModel {
  parts: GeneratedPart[];
  /** Meshes made for this model. Its parts use them through the block id `@index`. */
  shapes: GeneratedShape[];
}

export function generateModel(
  id: string,
  seed: number,
  settings: GeneratorSettings = { style: DEFAULT_STYLE, options: {} },
): GeneratedModel {
  const generator = getGenerator(id);
  const assembler = new Assembler();
  generator.build(assembler, new Rng(seed), settings);
  return { parts: assembler.result(), shapes: assembler.shapes };
}

export function runGenerator(id: string, seed: number, settings?: GeneratorSettings): GeneratedPart[] {
  return generateModel(id, seed, settings).parts;
}
