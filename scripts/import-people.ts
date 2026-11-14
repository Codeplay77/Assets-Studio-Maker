// Builds the Realista people: public/models/pessoas.bin, their textures in public/textures/ and
// src/blocks/definitions/people.generated.ts.
//
//   node scripts/import-people.ts <prepared>
//
// <prepared> is what tools/blender/make_people.py made with MPFB and the MakeHuman system assets
// (CC0). Files are only read as data. Every block stands on y = 0 and faces +Z, and its pieces
// carry, for every vertex, the four bones of the editor's skeleton that move it.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

const [prepared] = process.argv.slice(2);
if (!prepared) throw new Error("Informe a pasta das pessoas preparadas no Blender.");

const repo = path.resolve(import.meta.dirname, "..");
const textures = path.join(repo, "public/textures");
const SKINNED_VERTEX_BYTES = 21;

interface PreparedPiece {
  surface: string;
  /** Follows the part's color. */
  tint: boolean;
  vertices: number;
  indices: number;
  offset: number;
}

interface PreparedBlock {
  pieces: PreparedPiece[];
  skeleton: { joints: number[][]; directions: number[][] };
}

interface PreparedSurface {
  id: string;
  name: string;
  source: string;
  cutout: boolean;
}

const BODIES: Record<string, string> = {
  homem: "Homem",
  homem_magro: "Homem magro",
  homem_forte: "Homem forte",
  mulher: "Mulher",
  mulher_magra: "Mulher magra",
  mulher_forte: "Mulher forte",
  rapaz: "Rapaz",
  moca: "Moça",
  menino: "Menino",
  menina: "Menina",
  idoso: "Idoso",
  idosa: "Idosa",
};
const OUTFITS: Record<string, string> = {
  camiseta: "camiseta e jeans",
  manga_longa: "manga longa e jeans",
  camisa: "camisa e jeans",
  jaqueta: "jaqueta e jeans",
  terno: "terno",
  macacao: "macacão",
  camiseta_f: "camiseta e jeans",
  bermuda_f: "camiseta e bermuda",
  esporte_f: "top e legging",
  social_f: "blusa e saia",
};
const HAIRS: Record<string, string> = {
  short01: "curto 1",
  short02: "curto 2",
  short03: "curto 3",
  short04: "raspado",
  afro01: "afro",
  bob01: "chanel",
  bob02: "chanel liso",
  long01: "longo",
  ponytail01: "rabo de cavalo",
  braid01: "trança",
};

function label(id: string): string {
  const [, , body, role] = id.split(".");
  const [kind, ...rest] = role.split("_");
  const which = rest.join("_");
  const person = BODIES[body] ?? body;
  if (kind === "corpo") return `${person}: corpo (${OUTFITS[which] ?? which})`;
  if (kind === "cima") return `${person}: roupa de cima (${OUTFITS[which] ?? which})`;
  if (kind === "baixo") return `${person}: roupa de baixo e sapatos (${OUTFITS[which] ?? which})`;
  if (kind === "cabelo") return `${person}: cabelo ${HAIRS[which] ?? which}`;
  return `${person}: chapéu`;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const packParts: Buffer[] = [];
let packSize = 0;

/** One piece in the layout decodeSkinned reads: a mapped vertex, then 4 bones and 4 weights in bytes. */
function writePiece(blob: Buffer, piece: PreparedPiece) {
  const n = piece.vertices;
  const floats = (at: number, count: number) => new Float32Array(blob.buffer.slice(blob.byteOffset + at, blob.byteOffset + at + count * 4));
  let at = piece.offset;
  const positions = floats(at, n * 3);
  at += n * 12;
  const normals = floats(at, n * 3);
  at += n * 12;
  const uvs = floats(at, n * 2);
  at += n * 8;
  const joints = new Uint8Array(blob.buffer.slice(blob.byteOffset + at, blob.byteOffset + at + n * 4));
  at += n * 4;
  const weights = floats(at, n * 4);
  at += n * 16;
  const indices = new Uint32Array(blob.buffer.slice(blob.byteOffset + at, blob.byteOffset + at + piece.indices * 4));

  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const uvMin = [Infinity, Infinity];
  const uvMax = [-Infinity, -Infinity];
  for (let i = 0; i < n; i++) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i * 3 + axis]);
      max[axis] = Math.max(max[axis], positions[i * 3 + axis]);
    }
    for (let axis = 0; axis < 2; axis++) {
      uvMin[axis] = Math.min(uvMin[axis], uvs[i * 2 + axis]);
      uvMax[axis] = Math.max(uvMax[axis], uvs[i * 2 + axis]);
    }
  }
  // The stored range is rounded outward, so no vertex falls outside it.
  const lo = min.map((value) => Math.floor(value * 1000) / 1000);
  const hi = max.map((value) => Math.ceil(value * 1000) / 1000);
  const uvLo = uvMin.map((value) => Math.floor(value * 1e4) / 1e4);
  const uvHi = uvMax.map((value) => Math.ceil(value * 1e4) / 1e4);
  const span = hi.map((value, axis) => value - lo[axis] || 1);
  const uvSpan = uvHi.map((value, axis) => value - uvLo[axis] || 1);
  const wide = n > 65535;
  const buffer = Buffer.alloc(n * SKINNED_VERTEX_BYTES + piece.indices * (wide ? 4 : 2));
  for (let i = 0; i < n; i++) {
    const base = i * SKINNED_VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      buffer.writeInt16LE(Math.round(((positions[i * 3 + axis] - lo[axis]) / span[axis]) * 65534 - 32767), base + axis * 2);
      buffer.writeInt8(Math.max(-127, Math.min(127, Math.round(normals[i * 3 + axis] * 127))), base + 6 + axis);
    }
    for (let axis = 0; axis < 2; axis++) {
      buffer.writeUInt16LE(Math.round(((uvs[i * 2 + axis] - uvLo[axis]) / uvSpan[axis]) * 65535), base + 9 + axis * 2);
    }
    // Weights in bytes that still add up to exactly 255.
    const bytes = [0, 1, 2, 3].map((k) => Math.round(weights[i * 4 + k] * 255));
    const strongest = bytes.indexOf(Math.max(...bytes));
    bytes[strongest] += 255 - bytes.reduce((a, b) => a + b, 0);
    for (let k = 0; k < 4; k++) {
      buffer.writeUInt8(bytes[k] > 0 ? joints[i * 4 + k] : 0, base + 13 + k);
      buffer.writeUInt8(Math.max(0, bytes[k]), base + 17 + k);
    }
  }
  const first = n * SKINNED_VERTEX_BYTES;
  indices.forEach((index, i) => (wide ? buffer.writeUInt32LE(index, first + i * 4) : buffer.writeUInt16LE(index, first + i * 2)));
  const shape = { kind: "skinned", offset: packSize, vertices: n, indices: piece.indices, min: lo, max: hi, uv: [...uvLo, ...uvHi] };
  packParts.push(buffer);
  packSize += buffer.length;
  return { shape, bounds: { min, max } };
}

// --- surfaces ---------------------------------------------------------------------------------

const preparedSurfaces = JSON.parse(readFileSync(path.join(prepared, "surfaces.json"), "utf8")) as PreparedSurface[];
for (const name of existsSync(textures) ? readdirSync(textures) : []) {
  if (name.startsWith("mh.")) rmSync(path.join(textures, name), { recursive: true });
}
let textureBytes = 0;
const surfaces = preparedSurfaces.map((surface) => {
  const from = path.join(prepared, "surfaces", surface.id);
  const to = path.join(textures, surface.id);
  mkdirSync(to, { recursive: true });
  for (const file of [surface.cutout ? "color.png" : "color.jpg", "normal.jpg", "arm.jpg"]) {
    copyFileSync(path.join(from, file), path.join(to, file));
    textureBytes += readFileSync(path.join(to, file)).length;
  }
  return { id: surface.id, name: surface.name, group: "model", ...(surface.cutout ? { cutout: true } : {}), source: surface.source };
});

// --- blocks -----------------------------------------------------------------------------------

const blocks: string[] = [];
let triangles = 0;
const ids = readdirSync(prepared)
  .filter((name) => name.startsWith("rz.pessoa.") && existsSync(path.join(prepared, name, "mesh.json")))
  .sort();
for (const id of ids) {
  const folder = path.join(prepared, id);
  const mesh = JSON.parse(readFileSync(path.join(folder, "mesh.json"), "utf8")) as PreparedBlock;
  const blob = readFileSync(path.join(folder, "mesh.bin"));
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const pieces = mesh.pieces.map((piece) => {
    const { shape, bounds } = writePiece(blob, piece);
    triangles += piece.indices / 3;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], bounds.min[axis]);
      max[axis] = Math.max(max[axis], bounds.max[axis]);
    }
    return { shape, surface: piece.surface, ...(piece.tint ? {} : { color: "#ffffff" }) };
  });
  const body = id.split(".")[3].startsWith("corpo_");
  const joint = (name: number) => mesh.skeleton.joints[name].map(round);
  const sockets = [
    { id: "bottom", p: [0, 0, 0], n: [0, -1, 0] },
    ...(body
      ? [
          { id: "top", p: [round((min[0] + max[0]) / 2), round(max[1]), joint(5)[2]], n: [0, 1, 0] },
          // The hands, where something held goes.
          { id: "grip_left", p: joint(9), n: [1, 0, 0] },
          { id: "grip_right", p: joint(13), n: [-1, 0, 0] },
        ]
      : []),
  ];
  blocks.push(
    JSON.stringify({
      id,
      name: label(id),
      category: "lib_people",
      color: "#ffffff",
      shape: { kind: "compound", pieces },
      sockets,
      upright: true,
      skeleton: { joints: mesh.skeleton.joints.map((p) => p.map(round)), directions: mesh.skeleton.directions, ...(body ? { body: true } : {}) },
    }),
  );
}

writeFileSync(path.join(repo, "public/models/pessoas.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/people.generated.ts"),
  `// Generated by scripts/import-people.ts. Do not edit by hand.
import type { BlockDef } from "../types.ts";
import type { SurfaceDef } from "../surfaces.ts";

export const peopleSurfaces: SurfaceDef[] = [
${surfaces.map((surface) => `  ${JSON.stringify(surface)},`).join("\n")}
];

export const peopleBlocks: BlockDef[] = [
${blocks.map((block) => `  ${block},`).join("\n")}
];
`,
);

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
console.log(`${blocks.length} blocos de pessoas, ${surfaces.length} texturas, ${Math.round(triangles)} triângulos`);
console.log(`pessoas.bin: ${mb(packSize)} MB; texturas: ${mb(textureBytes)} MB`);
