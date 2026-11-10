// Builds the furniture library: public/models/interior.bin and
// src/blocks/definitions/interior.generated.ts.
//
//   node scripts/import-interior.ts <downloads> [--debug <folder>]
//
// <downloads> holds the CC0 packs, each file only parsed as data:
//   kenney-furniture/x/Models/*.obj     Kenney Furniture Kit 1.0, from OpenGameArt (Low poly)
//   quaternius-uhip/*.glb               Quaternius Ultimate House Interior Pack, from Poly Pizza (Realista)
//   quaternius-furniture/*.glb          Quaternius Furniture Pack, from Poly Pizza (Realista)
//   polyhaven/<id>/info.json            Poly Haven downloads (Realista)
//   polyhaven-prepared/<id>.tris        the same models reduced by tools/blender/prepare_polyhaven.py
//
// Every model ends up facing +Z, resting on y = 0 and centered on its footprint. The Kenney kit
// is also rebuilt out of cubes for the Blocos style. --debug writes each result as an OBJ with
// vertex colors, to look at them in Blender before using them.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { extract, type Rgb } from "./gltf-read.ts";
import {
  KENNEY_NAMES,
  POLYHAVEN_NAMES,
  QUATERNIUS_CLASSIC_NAMES,
  QUATERNIUS_NAMES,
  type InteriorName,
} from "./interior-names.ts";

type Finish = "matte" | "metal" | "glass" | "tint";

interface Face {
  p: [Vector3, Vector3, Vector3];
  n: [Vector3, Vector3, Vector3];
  c: [Rgb, Rgb, Rgb];
  finish: Finish;
}

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
  /** Models left out because they come out badly once reduced. */
  skip?: string[];
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

function readMtl(file: string): Record<string, Rgb> {
  const colors: Record<string, Rgb> = {};
  let current = "";
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === "newmtl") current = rest.join(" ");
    // Kenney writes the colors as they look on screen, so they are kept as sRGB.
    else if (command === "Kd") colors[current] = rest.slice(0, 3).map((value) => Math.round(Math.min(1, Number(value)) * 255)) as Rgb;
  }
  return colors;
}

function readObj(file: string): Face[] {
  const positions: Vector3[] = [];
  const normals: Vector3[] = [];
  let colors: Record<string, Rgb> = {};
  let color: Rgb = [200, 200, 200];
  const faces: Face[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === "v") positions.push(new Vector3(Number(rest[0]), Number(rest[1]), Number(rest[2])));
    else if (command === "vn") normals.push(new Vector3(Number(rest[0]), Number(rest[1]), Number(rest[2])).normalize());
    else if (command === "mtllib") colors = readMtl(path.join(path.dirname(file), rest.join(" ")));
    else if (command === "usemtl") color = colors[rest.join(" ")] ?? color;
    else if (command === "f") {
      const refs = rest.map((ref) => ref.split("/").map((value) => (value ? Number(value) : 0)));
      const at = (index: number) => (index < 0 ? positions.length + index : index - 1);
      for (let i = 1; i + 1 < refs.length; i++) {
        const corners = [refs[0], refs[i], refs[i + 1]];
        const p = corners.map(([v]) => positions[at(v)].clone()) as Face["p"];
        const flat = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
        const n = corners.map((ref) => (ref[2] ? normals[ref[2] < 0 ? normals.length + ref[2] : ref[2] - 1].clone() : flat.clone())) as Face["n"];
        faces.push({ p, n, c: [color, color, color], finish: "matte" });
      }
    }
  }
  return faces;
}

const finishOfMaterial = (name = ""): Finish =>
  /glass/i.test(name) ? "tint" : /metal|gold|chrome|steel/i.test(name) ? "metal" : "matte";

function readGlb(file: string, brighten: number): Face[] {
  return extract(file, { brighten }).map(({ corners, colors, material }) => ({
    p: corners.map((corner) => corner.p) as Face["p"],
    n: corners.map((corner) => corner.n) as Face["n"],
    c: colors,
    finish: finishOfMaterial(material),
  }));
}

const TRIS_FINISHES: Finish[] = ["matte", "metal", "tint"];

/** Reads what tools/blender/prepare_polyhaven.py writes. */
function readTris(file: string): Face[] {
  const data = readFileSync(file);
  const count = data.readUInt32LE(0);
  const floats = new Float32Array(data.buffer.slice(data.byteOffset + 4, data.byteOffset + 4 + count * 27 * 4));
  const finishes = data.subarray(4 + count * 27 * 4);
  const faces: Face[] = [];
  for (let t = 0; t < count; t++) {
    const corner = (c: number) => floats.subarray((t * 3 + c) * 9, (t * 3 + c + 1) * 9);
    const cs = [corner(0), corner(1), corner(2)];
    faces.push({
      p: cs.map((f) => new Vector3(f[0], f[1], f[2])) as Face["p"],
      n: cs.map((f) => new Vector3(f[3], f[4], f[5]).normalize()) as Face["n"],
      c: cs.map((f) => [Math.round(f[6] * 255), Math.round(f[7] * 255), Math.round(f[8] * 255)]) as Face["c"],
      finish: TRIS_FINISHES[finishes[t]] ?? "matte",
    });
  }
  return faces;
}

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
  {
    id: "quaternius",
    prefix: "rz.quaternius",
    names: QUATERNIUS_NAMES,
    // Drawn twice the real size: its doors are 4.2 m tall.
    scale: 0.5,
    yaw: 0,
    models: () => {
      const folder = path.join(source, "quaternius-uhip");
      return listFiles(folder, /\.glb$/i).map((file) => ({ name: file.replace(/\.glb$/i, ""), faces: readGlb(path.join(folder, file), 2) }));
    },
  },
  {
    id: "quaternius-classic",
    prefix: "rz.quaternius-classic",
    names: QUATERNIUS_CLASSIC_NAMES,
    scale: 1,
    yaw: 0,
    // Each piece came at its own scale; these bring them to real sizes (a 2.1 m door, a 0.76 m desk).
    scales: {
      Bed_Double: 0.5, Bed_Twin: 0.5, Bookcase_with_Books: 0.6, Chair: 0.85, Chair_2: 0.62, Closet: 0.68,
      Desk: 0.82, Door: 0.68, Door_2: 0.67, Door_3: 0.67, Short_Closet: 0.68, Sofa: 0.5, Sofa_2: 0.5, Sofa_3: 0.5,
      Table: 0.91, Table_2: 0.91,
    },
    models: () => {
      const folder = path.join(source, "quaternius-furniture");
      return listFiles(folder, /\.glb$/i).map((file) => ({ name: file.replace(/\.glb$/i, ""), faces: readGlb(path.join(folder, file), 2) }));
    },
  },
  {
    id: "polyhaven",
    prefix: "rz.polyhaven",
    names: POLYHAVEN_NAMES,
    scale: 1,
    yaw: 0,
    // The file is in decimeters; its page lists it as 1.1 x 0.5 x 2.14 m.
    scales: { steel_frame_shelves_01: 0.1 },
    // A draped cloth crumples, pictures lose their canvas and a glass top turns into a smear.
    skip: ["dining_table", "hanging_picture_frame_01", "hanging_picture_frame_02", "modern_coffee_table_02"],
    models: () => {
      const folder = path.join(source, "polyhaven-prepared");
      return listFiles(folder, /\.tris$/i).map((file) => ({ name: file.replace(/\.tris$/i, ""), faces: readTris(path.join(folder, file)) }));
    },
  },
];

function bounds(faces: Face[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const face of faces) for (const p of face.p) {
    min.min(p);
    max.max(p);
  }
  return { min, max };
}

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

/** Rebuilds a model out of cubes of one size, each with the color most of its surface has. */
function voxelize(faces: Face[], cell: number): Face[] {
  const { min, max } = bounds(faces);
  const origin = new Vector3(min.x, 0, min.z);
  const size = [0, 1, 2].map((axis) => Math.max(1, Math.ceil((max.getComponent(axis) - origin.getComponent(axis)) / cell - 1e-6)));
  const key = (x: number, y: number, z: number) => (x * size[1] + y) * size[2] + z;
  const votes = new Map<number, Map<number, number>>();

  for (const face of faces) {
    const [a, b, c] = face.p;
    const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const steps = Math.max(1, Math.ceil(longest / (cell * 0.3)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const p = a.clone().multiplyScalar(w).addScaledVector(b, u).addScaledVector(c, v);
        const cellOf = (axis: number) =>
          Math.min(size[axis] - 1, Math.max(0, Math.floor((p.getComponent(axis) - origin.getComponent(axis)) / cell)));
        const k = key(cellOf(0), cellOf(1), cellOf(2));
        const corner = w >= u && w >= v ? 0 : u >= v ? 1 : 2;
        const [r, g, bl] = face.c[corner];
        const color = (r << 16) | (g << 8) | bl;
        let tally = votes.get(k);
        if (!tally) votes.set(k, (tally = new Map()));
        tally.set(color, (tally.get(color) ?? 0) + 1);
      }
    }
  }

  const filled = new Map<number, number>();
  for (const [k, tally] of votes) {
    let best = 0;
    let bestCount = -1;
    for (const [color, count] of tally) if (count > bestCount) [best, bestCount] = [color, count];
    filled.set(k, best);
  }
  const colorAt = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2] ? undefined : filled.get(key(x, y, z));

  // Greedy meshing: each run of exposed cube faces of one color in a plane becomes one quad.
  const out: Face[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const sign of [1, -1]) {
      for (let slice = 0; slice < size[axis]; slice++) {
        const mask: (number | undefined)[] = new Array(size[u] * size[v]);
        for (let i = 0; i < size[u]; i++) {
          for (let j = 0; j < size[v]; j++) {
            const at = [0, 0, 0];
            at[axis] = slice;
            at[u] = i;
            at[v] = j;
            const here = colorAt(at[0], at[1], at[2]);
            if (here === undefined) continue;
            at[axis] += sign;
            if (colorAt(at[0], at[1], at[2]) !== undefined) continue;
            mask[i * size[v] + j] = here;
          }
        }
        for (let i = 0; i < size[u]; i++) {
          for (let j = 0; j < size[v]; ) {
            const color = mask[i * size[v] + j];
            if (color === undefined) {
              j++;
              continue;
            }
            let height = 1;
            while (j + height < size[v] && mask[i * size[v] + j + height] === color) height++;
            let width = 1;
            grow: while (i + width < size[u]) {
              for (let k = 0; k < height; k++) if (mask[(i + width) * size[v] + j + k] !== color) break grow;
              width++;
            }
            for (let a = 0; a < width; a++) for (let k = 0; k < height; k++) mask[(i + a) * size[v] + j + k] = undefined;

            const plane = (slice + (sign > 0 ? 1 : 0)) * cell + origin.getComponent(axis);
            const point = (du: number, dv: number) => {
              const p = new Vector3();
              p.setComponent(axis, plane);
              p.setComponent(u, origin.getComponent(u) + du * cell);
              p.setComponent(v, origin.getComponent(v) + dv * cell);
              return p;
            };
            const p00 = point(i, j);
            const p10 = point(i + width, j);
            const p11 = point(i + width, j + height);
            const p01 = point(i, j + height);
            const normal = new Vector3();
            normal.setComponent(axis, sign);
            const rgb: Rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
            const tri = (a: Vector3, b: Vector3, c: Vector3): Face => ({
              p: [a.clone(), b.clone(), c.clone()],
              n: [normal.clone(), normal.clone(), normal.clone()],
              c: [rgb, rgb, rgb],
              finish: "matte",
            });
            // (u, v, axis) is right-handed, so u x v points along +axis.
            if (sign > 0) out.push(tri(p00, p10, p11), tri(p00, p11, p01));
            else out.push(tri(p00, p11, p10), tri(p00, p01, p11));
            j += height;
          }
        }
      }
    }
  }
  return out;
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
  for (const model of kit.models().filter(({ name }) => !kit.skip?.includes(name))) {
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

if (existsSync(path.join(source, "polyhaven"))) {
  const credits = readdirSync(path.join(source, "polyhaven"))
    .filter((id) => existsSync(path.join(source, "polyhaven", id, "info.json")) && existsSync(path.join(source, "polyhaven-prepared", `${id}.tris`)))
    .filter((id) => !KITS.find((kit) => kit.id === "polyhaven")?.skip?.includes(id))
    .map((id) => JSON.parse(readFileSync(path.join(source, "polyhaven", id, "info.json"), "utf8")) as { id: string; name: string; authors: Record<string, string> })
    .map((info) => `| ${info.name} | ${Object.keys(info.authors).join(", ")} | [${info.id}](https://polyhaven.com/a/${info.id}) |`);
  writeFileSync(path.join(debugFolder ?? source, "polyhaven-credits.md"), `| Modelo | Autor | Página |\n| --- | --- | --- |\n${credits.join("\n")}\n`);
}

console.log(stats.join("\n"));
console.log(`Total: ${blockSources.length} blocos, ${(packSize / 1048576).toFixed(1)} MB`);
