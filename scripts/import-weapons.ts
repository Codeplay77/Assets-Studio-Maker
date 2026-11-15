// Builds the weapons library: public/models/armas.bin and src/blocks/definitions/weapons.generated.ts.
//
//   node scripts/import-weapons.ts <downloads>
//
// <downloads> is what scripts/download-weapons.ts saved, all CC0, each file only parsed as data:
//   quaternius-guns/x/      Quaternius, Ultimate Gun Pack: guns and their parts (Low poly)
//   quaternius-medieval/x/  Quaternius, Low Poly Medieval Weapons (Low poly)
//   quaternius-rpg/x/       Quaternius, Ultimate RPG Items Pack: blades, axes, hammers, bows (Low poly,
//                           and chunkier and glossy, as toys, for Arcade)
//   kenney-blaster/x/       Kenney, Blaster Kit 2.1: toy blasters (Arcade)
// Everything Low poly is also rebuilt out of cubes for the Blocos style. The Realista weapons come
// from Poly Haven with the rest of that style (scripts/realistic-names.ts).
//
// Each weapon stands upright, as scripts/weapon-names.ts describes, centered on its footprint and
// resting on y = 0. Its first socket, `grip`, is where a hand holds it: put on a hand's grip socket,
// a gun points along the arm and a blade comes out of the fist on the thumb's side, and it follows
// the hand when the person moves.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { extract } from "./gltf-read.ts";
import { bounds, readObj, voxelize, type Face, type Finish } from "./mesh-tools.ts";
import { gripOf } from "./weapon-grip.ts";
import {
  KENNEY_BLASTERS,
  QUATERNIUS_GUN_PARTS,
  QUATERNIUS_GUNS,
  QUATERNIUS_MEDIEVAL,
  QUATERNIUS_RPG,
  type Turn,
  type WeaponName,
} from "./weapon-names.ts";

const CATEGORY = "lib_weapons";
const PACK = "armas";
const BYTES_PER_VERTEX = 12;
/**
 * The cubes of a Blocos weapon: half a cube of the Blocos people at most (in theirs a weapon would
 * be a few lumps), and smaller for small pieces, so a pistol is still a pistol.
 */
const voxelFor = (longest: number) => Math.min(0.0275, Math.max(0.012, longest / 24));
/** Pieces this small turn into a shapeless lump of cubes. */
const MIN_VOXEL_SIZE = 0.12;
/** How an Arcade toy differs from the Low poly piece it is made from: thicker (x), shorter (y) and wider (z). */
const TOY: [number, number, number] = [1.8, 0.88, 1.3];

const repo = path.resolve(import.meta.dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Informe a pasta com os pacotes baixados.");

interface Model {
  name: string;
  faces: Face[];
}

interface Kit {
  id: string;
  /** Block ids are `${prefix}.${slug}`. */
  prefix: string;
  names: Record<string, WeaponName>;
  /** Turns every model of the kit, before its own turn. */
  turn: Turn;
  models: () => Model[];
  /** Also builds the model out of cubes, for the Blocos style, with this prefix. */
  voxels?: string;
  /** Arcade: chunkier and glossy. */
  toy?: boolean;
}

const files = (folder: string, extension: string) =>
  readdirSync(folder)
    .filter((name) => name.toLowerCase().endsWith(extension))
    .sort();

/** Steel, iron and gold shine like metal; wood, leather and paint do not. */
const metalOf = (material: string): Finish => (/metal|steel|iron|gold|silver|chrome/i.test(material) ? "metal" : "matte");

function objKit(folder: string, names: Record<string, WeaponName>, textures: Record<string, string> = {}): () => Model[] {
  return () =>
    files(folder, ".obj")
      .map((file) => file.replace(/\.obj$/i, ""))
      .filter((name) => names[name])
      .map((name) => ({
        name,
        faces: readObj(path.join(folder, `${name}.obj`), {
          linear: true,
          finishOf: metalOf,
          ...(textures[name] ? { texture: textures[name] } : {}),
        }),
      }));
}

const GUNS = path.join(source, "quaternius-guns/x/Ultimate Gun Pack - July 2019/OBJ");
const MEDIEVAL = path.join(source, "quaternius-medieval/x/MedievalPack");
const RPG = path.join(source, "quaternius-rpg/x/Ultimate RPG Items Pack - Aug 2019/OBJ");
const BLASTERS = path.join(source, "kenney-blaster/x/Models/GLB format");
const medievalTexture = (name: string) => path.join(MEDIEVAL, "Blends/Textures", `${name}Texture.png`);

const KITS: Kit[] = [
  { id: "quaternius-guns", prefix: "kit.armas", names: QUATERNIUS_GUNS, turn: [["y", -90]], models: objKit(GUNS, QUATERNIUS_GUNS), voxels: "vx.armas" },
  {
    id: "quaternius-gun-parts",
    prefix: "kit.armas",
    names: QUATERNIUS_GUN_PARTS,
    turn: [["y", -90]],
    models: objKit(path.join(GUNS, "Accessories"), QUATERNIUS_GUN_PARTS),
    voxels: "vx.armas",
  },
  {
    id: "quaternius-medieval",
    prefix: "kit.armas",
    names: QUATERNIUS_MEDIEVAL,
    turn: [],
    // The medieval pack paints its pieces with tiny palette images; the swords share one.
    models: objKit(path.join(MEDIEVAL, "OBJ"), QUATERNIUS_MEDIEVAL, {
      Club: medievalTexture("Club"),
      Katana: medievalTexture("Katana"),
      LongSword: medievalTexture("Sword"),
      ShortSword: medievalTexture("Sword"),
      SimpleAxe: medievalTexture("SimpleAxe"),
      Spear: medievalTexture("Spear"),
    }),
    voxels: "vx.armas",
  },
  { id: "quaternius-rpg", prefix: "kit.armas", names: QUATERNIUS_RPG, turn: [["y", -90]], models: objKit(RPG, QUATERNIUS_RPG), voxels: "vx.armas" },
  { id: "quaternius-rpg-arcade", prefix: "ar.armas", names: QUATERNIUS_RPG, turn: [["y", -90]], models: objKit(RPG, QUATERNIUS_RPG), toy: true },
  {
    id: "kenney-blaster",
    prefix: "ar.armas",
    names: KENNEY_BLASTERS,
    turn: [["y", 180]],
    toy: true,
    models: () =>
      files(BLASTERS, ".glb")
        .map((file) => file.replace(/\.glb$/i, ""))
        .filter((name) => KENNEY_BLASTERS[name])
        .map((name) => ({
          name,
          faces: extract(path.join(BLASTERS, `${name}.glb`), {}).map(({ corners, colors }) => ({
            p: corners.map((corner) => corner.p) as Face["p"],
            n: corners.map((corner) => corner.n) as Face["n"],
            c: colors,
            finish: "matte" as Finish,
          })),
        })),
  },
];

const AXES = { x: new Vector3(1, 0, 0), y: new Vector3(0, 1, 0), z: new Vector3(0, 0, 1) };

function turn(faces: Face[], turns: Turn): void {
  for (const [axis, degrees] of turns) {
    const radians = (degrees * Math.PI) / 180;
    for (const face of faces) {
      for (const p of face.p) p.applyAxisAngle(AXES[axis], radians);
      for (const n of face.n) n.applyAxisAngle(AXES[axis], radians);
    }
  }
}

/** Scales a model so its longest side is `length` meters, then stretches it by `stretch` (normals follow). */
function resize(faces: Face[], length: number, stretch: [number, number, number] = [1, 1, 1]): void {
  const { min, max } = bounds(faces);
  const size = max.clone().sub(min);
  const factor = length / Math.max(size.x, size.y, size.z);
  const scale = new Vector3(...stretch).multiplyScalar(factor);
  const inverse = new Vector3(1 / stretch[0], 1 / stretch[1], 1 / stretch[2]);
  for (const face of faces) {
    for (const p of face.p) p.multiply(scale);
    for (const n of face.n) n.multiply(inverse).normalize();
  }
}

/** Centers a model on its footprint and rests it on y = 0; returns how far it moved. */
function center(faces: Face[]): Vector3 {
  const { min, max } = bounds(faces);
  const shift = new Vector3(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  for (const face of faces) for (const p of face.p) p.add(shift);
  return shift;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: number[]) => values.map(round);

const packParts: Buffer[] = [];
let packSize = 0;

function writeChunk(faces: Face[]) {
  const { min, max } = bounds(faces);
  const span = max.clone().sub(min);
  const safe = [span.x || 1, span.y || 1, span.z || 1];
  const vertices = faces.length * 3;
  const buffer = Buffer.alloc(vertices * BYTES_PER_VERTEX);
  let at = 0;
  for (const face of faces) {
    for (let c = 0; c < 3; c++) {
      const p = face.p[c];
      const n = face.n[c];
      buffer.writeInt16LE(Math.round(((p.x - min.x) / safe[0]) * 65534 - 32767), at);
      buffer.writeInt16LE(Math.round(((p.y - min.y) / safe[1]) * 65534 - 32767), at + 2);
      buffer.writeInt16LE(Math.round(((p.z - min.z) / safe[2]) * 65534 - 32767), at + 4);
      buffer.writeInt8(Math.round(n.x * 127), at + 6);
      buffer.writeInt8(Math.round(n.y * 127), at + 7);
      buffer.writeInt8(Math.round(n.z * 127), at + 8);
      buffer.writeUInt8(face.c[c][0], at + 9);
      buffer.writeUInt8(face.c[c][1], at + 10);
      buffer.writeUInt8(face.c[c][2], at + 11);
      at += BYTES_PER_VERTEX;
    }
  }
  const chunk = { offset: packSize, vertices, min: roundAll(min.toArray()), max: roundAll(max.toArray()) };
  packParts.push(buffer);
  packSize += buffer.length;
  return chunk;
}

const FINISH_ORDER: Finish[] = ["matte", "gloss", "metal"];

function blockSource(id: string, model: string, label: string, faces: Face[], grip: Vector3): string {
  const pieces = FINISH_ORDER.map((finish) => ({ finish, faces: faces.filter((face) => face.finish === finish) })).filter((group) => group.faces.length > 0);
  const shapeOf = (chunk: ReturnType<typeof writeChunk>) => ({ kind: "model", model, pack: PACK, ...chunk });
  const shape =
    pieces.length === 1 && pieces[0].finish === "matte"
      ? shapeOf(writeChunk(pieces[0].faces))
      : {
          kind: "compound",
          pieces: pieces.map(({ finish, faces: group }) => ({ shape: shapeOf(writeChunk(group)), ...(finish === "matte" ? {} : { finish }) })),
        };
  const { min, max } = bounds(faces);
  const sockets = [
    // The first socket is the one the piece attaches with: a hand's grip.
    { id: "grip", p: roundAll(grip.toArray()), n: [0, -1, 0] },
    { id: "bottom", p: [round((min.x + max.x) / 2), round(min.y), round((min.z + max.z) / 2)], n: [0, -1, 0] },
    { id: "top", p: [round((min.x + max.x) / 2), round(max.y), round((min.z + max.z) / 2)], n: [0, 1, 0] },
  ];
  // Not `upright`: an upright block never snaps onto a socket, and a weapon belongs on a hand's.
  return JSON.stringify({ id, name: label, category: CATEGORY, color: "#ffffff", shape, sockets });
}

const slug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, "_");

const blockSources: string[] = [];
const stats: string[] = [];
const seen = new Set<string>();

for (const kit of KITS) {
  let count = 0;
  let triangles = 0;
  let voxelTriangles = 0;
  const models = kit.models();
  for (const name of Object.keys(kit.names)) if (!models.some((model) => model.name === name)) console.warn(`não encontrado: ${kit.id}/${name}`);
  for (const model of models) {
    const known = kit.names[model.name];
    turn(model.faces, [...kit.turn, ...(known.turn ?? [])]);
    resize(model.faces, known.length, kit.toy && known.hold !== "gun" && known.hold !== "thing" ? TOY : [1, 1, 1]);
    if (kit.toy) for (const face of model.faces) face.finish = "gloss";
    center(model.faces);
    const id = `${kit.prefix}.${slug(model.name)}`;
    if (seen.has(id)) throw new Error(`bloco repetido: ${id}`);
    seen.add(id);
    const grip = gripOf(model.faces, known);
    const { min, max } = bounds(model.faces);
    if (process.env.SIZES) console.log(`  ${id}: ${roundAll(max.clone().sub(min).toArray()).join(" x ")} m, cabo em ${roundAll(grip.toArray()).join(" ")}`);
    blockSources.push(blockSource(id, `${kit.id}/${model.name}`, known.label, model.faces, grip));
    count++;
    triangles += model.faces.length;

    const size = max.clone().sub(min);
    if (kit.voxels && Math.max(size.x, size.y, size.z) >= MIN_VOXEL_SIZE) {
      const cubes = voxelize(model.faces, voxelFor(Math.max(size.x, size.y, size.z)));
      const shift = center(cubes);
      const voxelId = `${kit.voxels}.${slug(model.name)}`;
      blockSources.push(blockSource(voxelId, `${kit.id}-blocos/${model.name}`, known.label, cubes, grip.clone().add(shift)));
      voxelTriangles += cubes.length;
    }
  }
  stats.push(
    `${kit.id}: ${count} modelos, média ${Math.round(triangles / Math.max(count, 1))} triângulos` +
      (kit.voxels ? `; em cubos, média ${Math.round(voxelTriangles / Math.max(count, 1))}` : ""),
  );
}

mkdirSync(path.join(repo, "public/models"), { recursive: true });
writeFileSync(path.join(repo, "public/models/armas.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/weapons.generated.ts"),
  `// Generated by scripts/import-weapons.ts. Do not edit by hand.\nimport type { BlockDef } from "../types.ts";\n\nexport const weaponModelBlocks: BlockDef[] = [\n${blockSources.map((item) => `  ${item},`).join("\n")}\n];\n`,
);

console.log(stats.join("\n"));
console.log(`Total: ${blockSources.length} blocos, ${(packSize / 1048576).toFixed(1)} MB`);
