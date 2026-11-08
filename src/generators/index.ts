import { Assembler, type GeneratedPart } from "./assembler";
import { buildBuilding, buildHouse, buildTree } from "./buildings";
import { buildCar } from "./car";
import { buildCity } from "./city";
import {
  KIT_CHARACTERS,
  KIT_LARGE_VEHICLES,
  KIT_RACERS,
  KIT_STREET_CARS,
  placeKitModel,
} from "./kit";
import { buildPerson } from "./person";
import { Rng } from "./rng";
import { buildTrack } from "./track";

export interface Generator {
  id: string;
  name: string;
  build(assembler: Assembler, rng: Rng): void;
}

export const generators: Generator[] = [
  { id: "person", name: "Pessoa", build: (asm, rng) => buildPerson(asm, rng) },
  {
    id: "character",
    name: "Boneco",
    build: (asm, rng) =>
      placeKitModel(asm, rng.pick(KIT_CHARACTERS), [0, 0, 0], { scale: rng.range(0.9, 1.12) }),
  },
  {
    id: "car",
    name: "Veículo",
    build: (asm, rng) => {
      if (rng.chance(0.15)) buildCar(asm, rng);
      else placeKitModel(asm, rng.pick([...KIT_STREET_CARS, ...KIT_LARGE_VEHICLES, ...KIT_RACERS]), [0, 0, 0]);
    },
  },
  { id: "building", name: "Prédio", build: (asm, rng) => buildBuilding(asm, rng) },
  { id: "house", name: "Casa", build: (asm, rng) => buildHouse(asm, rng) },
  { id: "tree", name: "Árvore", build: (asm, rng) => buildTree(asm, rng) },
  { id: "city", name: "Cidade", build: buildCity },
  { id: "track", name: "Pista", build: buildTrack },
];

export function runGenerator(id: string, seed: number): GeneratedPart[] {
  const generator = generators.find((candidate) => candidate.id === id);
  if (!generator) throw new Error(`Gerador desconhecido: ${id}`);
  const assembler = new Assembler();
  generator.build(assembler, new Rng(seed));
  return assembler.result();
}
