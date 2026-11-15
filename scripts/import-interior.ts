// Builds the furniture library: public/models/interior.bin and
// src/blocks/definitions/interior.generated.ts.
//
//   node scripts/import-interior.ts <downloads> [--debug <folder>]
//
// <downloads> holds the CC0 pack, each file only parsed as data:
//   kenney-furniture/x/Models/*.obj     Kenney Furniture Kit 1.0, from OpenGameArt (Low poly)
//
// Realista furniture is photographed and textured: see scripts/import-realistic.ts.
//
// Every model ends up facing +Z, resting on y = 0 and centered on its footprint. The Kenney kit
// is also rebuilt out of cubes for the Blocos style. --debug writes each result as an OBJ with
// vertex colors, to look at them in Blender before using them.
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { bounds, readObj, voxelize, type Face, type Finish } from "./mesh-tools.ts";
import { KENNEY_NAMES, type InteriorName } from "./interior-names.ts";

interface Model {
  name: string;
  faces: Face[];
}

interface Kit {
  id: string;
  /** Block ids are `${prefix}.${name}`. */
  prefix: string;
  names: Record<string, InteriorName>;
  /** Multiplies the file's units to reach meters. */
  scale: number;
  /** Degrees around Y that turn the model's front to +Z. */
  yaw: number;
  /** Per-model corrections, for the few pieces drawn facing another way. */
  turns?: Record<string, number>;
  /** Per-model scales, for files saved in other units. */
  scales?: Record<string, number>;
  models: () => Model[];
  /** Also builds the model out of cubes, for the Blocos style, with this prefix. */
  voxels?: string;
}

const CATEGORY = "lib_interior";
const BYTES_PER_VERTEX = 12;
/** One cube of the Blocos style: the same unit its people are made of. */
const VOXEL = 0.055;
/** Pieces this small turn into a shapeless lump of cubes. */
const MIN_VOXEL_SIZE = 0.15;

const repo = path.resolve(import.meta.dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Informe a pasta com os pacotes baixados.");
const debugAt = process.argv.indexOf("--debug");
const debugFolder = debugAt > 0 ? process.argv[debugAt + 1] : null;

const listFiles = (folder: string, pattern: RegExp) =>
  readdirSync(folder).filter((name) => pattern.test(name)).sort();

const KITS: Kit[] = [
  {
    id: "furniture",
    prefix: "kit.furniture",
    names: KENNEY_NAMES,
    scale: 0.2,
    yaw: 180,
    // The kit's bathtub fills a whole floor tile: 2.4 m long.
    scales: { bathtub: 0.72 },
    voxels: "vx.mobilia",
    models: () => {
      const folder = path.join(source, "kenney-furniture/x/Models");
      return listFiles(folder, /\.obj$/i).map((file) => ({ name: file.replace(/\.obj$/i, ""), faces: readObj(path.join(folder, file)) }));
    },
  },
];

/** Turns, scales and moves a model so it faces +Z, rests on y = 0 and is centered on its footprint. */
function normalize(faces: Face[], scale: number, yaw: number): void {
  const radians = (yaw * Math.PI) / 180;
  const axis = new Vector3(0, 1, 0);
  for (const face of faces) {
    for (const p of face.p) p.applyAxisAngle(axis, radians).multiplyScalar(scale);
    for (const n of face.n) n.applyAxisAngle(axis, radians);
  }
  const { min, max } = bounds(faces);
  const shift = new Vector3(-(min.x + max.x) / 2, -min.y, -(min.z + max.z) / 2);
  for (const face of faces) for (const p of face.p) p.add(shift);
}

/** Where the tall part of a model sits: a chair's back, a bed's headboard. Printed to check facing. */
function tallSide(faces: Face[]): string {
  const { min, max } = bounds(faces);
  const limit = min.y + (max.y - min.y) * 0.7;
  const sum = new Vector3();
  let count = 0;
  for (const face of faces) for (const p of face.p) {
    if (p.y < limit) continue;
    sum.add(p);
    count++;
  }
  if (count === 0) return "?";
  sum.divideScalar(count);
  const dx = sum.x / Math.max(max.x - min.x, 1e-6);
  const dz = sum.z / Math.max(max.z - min.z, 1e-6);
  if (Math.max(Math.abs(dx), Math.abs(dz)) < 0.12) return "centro";
  return Math.abs(dz) >= Math.abs(dx) ? (dz < 0 ? "-Z" : "+Z") : dx < 0 ? "-X" : "+X";
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: number[]) => values.map(round);

const packParts: Buffer[] = [];
let packSize = 0;

interface Chunk {
  offset: number;
  vertices: number;
  min: number[];
  max: number[];
}

function writeChunk(faces: Face[]): Chunk {
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

const FINISH_ORDER: Finish[] = ["matte", "metal", "glass", "tint"];

function blockSource(id: string, model: string, label: string, mount: InteriorName["mount"], faces: Face[]): string {
  const pieces = FINISH_ORDER.map((finish) => ({ finish, faces: faces.filter((face) => face.finish === finish) })).filter(
    (group) => group.faces.length > 0,
  );
  const shapeOf = (chunk: Chunk) => ({ kind: "model", model, pack: "interior", ...chunk });
  const shape =
    pieces.length === 1 && pieces[0].finish === "matte"
      ? shapeOf(writeChunk(pieces[0].faces))
      : {
          kind: "compound",
          pieces: pieces.map(({ finish, faces: group }) => ({
            shape: shapeOf(writeChunk(group)),
            ...(finish === "matte" ? {} : { finish }),
          })),
        };

  const { min, max } = bounds(faces);
  const center = [round((min.x + max.x) / 2), round((min.y + max.y) / 2), round((min.z + max.z) / 2)];
  const all = {
    bottom: { id: "bottom", p: [center[0], round(min.y), center[2]], n: [0, -1, 0] },
    top: { id: "top", p: [center[0], round(max.y), center[2]], n: [0, 1, 0] },
    left: { id: "left", p: [round(min.x), center[1], center[2]], n: [-1, 0, 0] },
    right: { id: "right", p: [round(max.x), center[1], center[2]], n: [1, 0, 0] },
    front: { id: "front", p: [center[0], center[1], round(max.z)], n: [0, 0, 1] },
    back: { id: "back", p: [center[0], center[1], round(min.z)], n: [0, 0, -1] },
  };
  // The first socket is the one the piece attaches with.
  const first = mount === "w" ? "back" : mount === "c" ? "top" : "bottom";
  const sockets = [all[first], ...Object.values(all).filter((socket) => socket.id !== first)];
  return JSON.stringify({
    id,
    name: label,
    category: CATEGORY,
    color: "#ffffff",
    shape,
    sockets,
    ...(mount === "w" || mount === "c" ? {} : { upright: true }),
  });
}

function writeDebug(id: string, faces: Face[]): void {
  if (!debugFolder) return;
  const lines: string[] = [];
  for (const face of faces) {
    for (let c = 0; c < 3; c++) {
      const p = face.p[c];
      const [r, g, b] = face.c[c].map((value) => (value / 255).toFixed(3));
      lines.push(`v ${p.x.toFixed(4)} ${p.y.toFixed(4)} ${p.z.toFixed(4)} ${r} ${g} ${b}`);
    }
  }
  for (let t = 0; t < faces.length; t++) lines.push(`f ${t * 3 + 1} ${t * 3 + 2} ${t * 3 + 3}`);
  writeFileSync(path.join(debugFolder, `${id}.obj`), lines.join("\n"));
}

const slug = (name: string) => name.replace(/\s+/g, "-");

const blockSources: string[] = [];
const stats: string[] = [];
if (debugFolder) mkdirSync(debugFolder, { recursive: true });

for (const kit of KITS) {
  let count = 0;
  let triangles = 0;
  let voxelTriangles = 0;
  for (const model of kit.models()) {
    const known = kit.names[model.name];
    if (!known) console.warn(`sem nome em português: ${kit.id}/${model.name}`);
    const label = known?.label ?? model.name;
    normalize(model.faces, kit.scale * (kit.scales?.[model.name] ?? 1), kit.yaw + (kit.turns?.[model.name] ?? 0));
    const id = `${kit.prefix}.${slug(model.name)}`;
    const { min, max } = bounds(model.faces);
    const size = max.clone().sub(min);
    if (process.env.SIZES ? new RegExp(process.env.SIZES).test(id) : /chair|sofa|couch|bed|toilet|armchair|bench|closet|bookcase/i.test(model.name)) {
      console.log(`  ${id}: ${roundAll(size.toArray()).join(" x ")} m, alto em ${tallSide(model.faces)}`);
    }
    blockSources.push(blockSource(id, `${kit.id}/${model.name}`, label, known?.mount, model.faces));
    writeDebug(id, model.faces);
    count++;
    triangles += model.faces.length;

    if (kit.voxels && Math.max(size.x, size.y, size.z) >= MIN_VOXEL_SIZE) {
      const cubes = voxelize(model.faces, VOXEL);
      normalize(cubes, 1, 0);
      const voxelId = `${kit.voxels}.${slug(model.name)}`;
      blockSources.push(blockSource(voxelId, `${kit.id}-blocos/${model.name}`, label, known?.mount, cubes));
      writeDebug(voxelId, cubes);
      voxelTriangles += cubes.length;
    }
  }
  stats.push(
    `${kit.id}: ${count} modelos, média ${Math.round(triangles / Math.max(count, 1))} triângulos` +
      (kit.voxels ? `; em cubos, média ${Math.round(voxelTriangles / Math.max(count, 1))}` : ""),
  );
}

mkdirSync(path.join(repo, "public/models"), { recursive: true });
writeFileSync(path.join(repo, "public/models/interior.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/interior.generated.ts"),
  `// Generated by scripts/import-interior.ts. Do not edit by hand.\nimport type { BlockDef } from "../types.ts";\n\nexport const interiorModelBlocks: BlockDef[] = [\n${blockSources.map((item) => `  ${item},`).join("\n")}\n];\n`,
);

console.log(stats.join("\n"));
console.log(`Total: ${blockSources.length} blocos, ${(packSize / 1048576).toFixed(1)} MB`);
