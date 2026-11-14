// Builds the Realista library: public/textures/, public/models/realista.bin and
// src/blocks/definitions/realistic.generated.ts.
//
//   node scripts/import-realistic.ts <downloads> <prepared>
//
// <downloads> is what scripts/download-realistic.ts saved, and <prepared> what
// tools/blender/prepare_polyhaven.py made of its models. Files are only read as data. Every model
// ends up facing +Z, resting on y = 0 and centered on its footprint.
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PNG } from "pngjs";
import { TILING_SURFACES, type SurfaceDef } from "../src/blocks/surfaces.ts";
import { REALISTIC_MODELS, type Mount, type RealisticModel } from "./realistic-names.ts";

const [downloads, prepared] = process.argv.slice(2);
if (!downloads || !prepared) throw new Error("Informe a pasta dos downloads e a dos modelos preparados.");

const repo = path.resolve(import.meta.dirname, "..");
const textures = path.join(repo, "public/textures");
const MAPPED_VERTEX_BYTES = 13;

interface PreparedMaterial {
  name: string;
  vertices: number;
  indices: number;
  offset: number;
  kind: "textured" | "plain";
  images?: { color: string; normal: string; arm: string } | null;
  cutout?: boolean;
  double?: boolean;
  color?: [number, number, number];
  finish?: "tint" | "metal" | "matte";
}

interface Chunk {
  positions: Float32Array;
  normals: Float32Array;
  uvs: Float32Array;
  indices: Uint32Array;
  material: PreparedMaterial;
}

// --- tiling textures ------------------------------------------------------------------------

mkdirSync(textures, { recursive: true });
for (const entry of readdirSync(textures)) rmSync(path.join(textures, entry), { recursive: true });

/**
 * A gray copy of a photo whose average is light: multiplied by the vertex paint of a terrain, it
 * adds grain and keeps the paint's color.
 */
function grayDetail(from: string, to: string, contrast: number): void {
  const image = PNG.sync.read(readFileSync(from));
  const { data } = image;
  let sum = 0;
  for (let i = 0; i < data.length; i += 4) sum += 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  const mean = sum / (data.length / 4);
  for (let i = 0; i < data.length; i += 4) {
    const light = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const value = Math.max(0, Math.min(255, Math.round(210 * (1 + (light / mean - 1) * contrast))));
    data[i] = data[i + 1] = data[i + 2] = value;
    data[i + 3] = 255;
  }
  writeFileSync(to, PNG.sync.write(image, { colorType: 0 }));
}

for (const surface of TILING_SURFACES) {
  const from = path.join(downloads, "textures", surface.source);
  const to = path.join(textures, surface.id);
  mkdirSync(to, { recursive: true });
  for (const file of ["normal.jpg", "arm.jpg"]) copyFileSync(path.join(from, file), path.join(to, file));
  // Ground keeps most of its grain; painted walls and fabric only a hint of it.
  if (surface.detail) grayDetail(path.join(from, "color.png"), path.join(to, "color.png"), surface.group === "ground" ? 0.85 : 0.45);
  else copyFileSync(path.join(from, "color.jpg"), path.join(to, "color.jpg"));
}

// The sky that lights Realista scenes in the editor.
mkdirSync(path.join(repo, "public/environments"), { recursive: true });
copyFileSync(path.join(downloads, "sky", "sky.hdr"), path.join(repo, "public/environments/sky.hdr"));

// --- models ---------------------------------------------------------------------------------

const round = (value: number) => Math.round(value * 1000) / 1000;
const packParts: Buffer[] = [];
let packSize = 0;

function readChunks(folder: string, materials: PreparedMaterial[]): Chunk[] {
  const blob = readFileSync(path.join(folder, "mesh.bin"));
  return materials.map((material) => {
    const floats = (offset: number, count: number) =>
      new Float32Array(blob.buffer.slice(blob.byteOffset + offset, blob.byteOffset + offset + count * 4));
    const n = material.vertices;
    const at = material.offset;
    return {
      positions: floats(at, n * 3),
      normals: floats(at + n * 12, n * 3),
      uvs: floats(at + n * 24, n * 2),
      indices: new Uint32Array(blob.buffer.slice(blob.byteOffset + at + n * 32, blob.byteOffset + at + n * 32 + material.indices * 4)),
      material,
    };
  });
}

function bounds(chunks: Chunk[]): { min: number[]; max: number[] } {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const { positions } of chunks) {
    for (let i = 0; i < positions.length; i += 3) {
      for (let axis = 0; axis < 3; axis++) {
        min[axis] = Math.min(min[axis], positions[i + axis]);
        max[axis] = Math.max(max[axis], positions[i + axis]);
      }
    }
  }
  return { min, max };
}

/**
 * Blender draws a tree's crown on square planes, as wide as the crown and as tall as the tree. A
 * crown wider than the tree is tall leaves the bottom of each square empty and below the trunk,
 * and resting that invisible edge on the ground left trees floating. Each plane is cut down to the
 * pixels that show something, which also spares the empty corners from being drawn.
 *
 * Each plane comes as quads of four corners in the order Blender writes them: bottom left,
 * bottom right, top right, top left.
 */
function cropImpostor(chunk: Chunk, folder: string): void {
  const png = PNG.sync.read(readFileSync(path.join(folder, chunk.material.images!.color)));
  const { positions, uvs } = chunk;
  const solid = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3] > 8;
  const PAD = 2;
  for (let quad = 0; quad < positions.length / 12; quad++) {
    const v = quad * 4;
    const u0 = uvs[v * 2], u1 = uvs[(v + 1) * 2];
    const x0 = Math.round(u0 * png.width), x1 = Math.round(u1 * png.width);
    // v = 0 is the bottom of the plane, the last row of the picture.
    let left = x1, right = x0 - 1, top = png.height, bottom = -1;
    for (let y = 0; y < png.height; y++) {
      for (let x = x0; x < x1; x++) {
        if (!solid(x, y)) continue;
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
    }
    if (bottom < 0) continue;
    left = Math.max(x0, left - PAD);
    right = Math.min(x1 - 1, right + PAD);
    top = Math.max(0, top - PAD);
    // The bottom keeps no margin: it is where the tree meets the ground.
    const fu = [(left - x0) / (x1 - x0), (right + 1 - x0) / (x1 - x0)];
    const fv = [1 - (bottom + 1) / png.height, 1 - top / png.height];
    const corner = (i: number) => [positions[(v + i) * 3], positions[(v + i) * 3 + 1], positions[(v + i) * 3 + 2]];
    const origin = corner(0);
    const across = corner(1).map((value, axis) => value - origin[axis]);
    const upward = corner(3).map((value, axis) => value - origin[axis]);
    [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([iu, iv], i) => {
      for (let axis = 0; axis < 3; axis++) positions[(v + i) * 3 + axis] = origin[axis] + across[axis] * fu[iu] + upward[axis] * fv[iv];
      uvs[(v + i) * 2] = (x0 + (x1 - x0) * fu[iu]) / png.width;
      uvs[(v + i) * 2 + 1] = fv[iv];
    });
  }
}

/** Scales a model to meters and puts it on the ground, centered on its footprint. */
function normalize(chunks: Chunk[], scale: number): void {
  for (const { positions } of chunks) for (let i = 0; i < positions.length; i++) positions[i] *= scale;
  const { min, max } = bounds(chunks);
  const shift = [-(min[0] + max[0]) / 2, -min[1], -(min[2] + max[2]) / 2];
  for (const { positions } of chunks) {
    for (let i = 0; i < positions.length; i += 3) for (let axis = 0; axis < 3; axis++) positions[i + axis] += shift[axis];
  }
}

/** Writes one material of a model in the layout decodeMapped reads. */
function writeChunk({ positions, normals, uvs, indices }: Chunk) {
  const vertices = positions.length / 3;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const uvMin = [Infinity, Infinity];
  const uvMax = [-Infinity, -Infinity];
  for (let i = 0; i < vertices; i++) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], positions[i * 3 + axis]);
      max[axis] = Math.max(max[axis], positions[i * 3 + axis]);
    }
    for (let axis = 0; axis < 2; axis++) {
      uvMin[axis] = Math.min(uvMin[axis], uvs[i * 2 + axis]);
      uvMax[axis] = Math.max(uvMax[axis], uvs[i * 2 + axis]);
    }
  }
  const span = max.map((value, axis) => value - min[axis] || 1);
  const uvSpan = uvMax.map((value, axis) => value - uvMin[axis] || 1);
  const wide = vertices > 65535;
  const buffer = Buffer.alloc(vertices * MAPPED_VERTEX_BYTES + indices.length * (wide ? 4 : 2));
  for (let i = 0; i < vertices; i++) {
    const at = i * MAPPED_VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      buffer.writeInt16LE(Math.round(((positions[i * 3 + axis] - min[axis]) / span[axis]) * 65534 - 32767), at + axis * 2);
      buffer.writeInt8(Math.max(-127, Math.min(127, Math.round(normals[i * 3 + axis] * 127))), at + 6 + axis);
    }
    for (let axis = 0; axis < 2; axis++) {
      buffer.writeUInt16LE(Math.round(((uvs[i * 2 + axis] - uvMin[axis]) / uvSpan[axis]) * 65535), at + 9 + axis * 2);
    }
  }
  const first = vertices * MAPPED_VERTEX_BYTES;
  indices.forEach((index, i) => (wide ? buffer.writeUInt32LE(index, first + i * 4) : buffer.writeUInt16LE(index, first + i * 2)));
  const shape = {
    kind: "mapped",
    offset: packSize,
    vertices,
    indices: indices.length,
    min: min.map(round),
    max: max.map(round),
    // Rounded outward, so no coordinate falls outside the stored range.
    uv: [Math.floor(uvMin[0] * 1e4) / 1e4, Math.floor(uvMin[1] * 1e4) / 1e4, Math.ceil(uvMax[0] * 1e4) / 1e4, Math.ceil(uvMax[1] * 1e4) / 1e4],
  };
  packParts.push(buffer);
  packSize += buffer.length;
  return shape;
}

function sockets(chunks: Chunk[], mount: Mount | undefined) {
  const { min, max } = bounds(chunks);
  const center = [round((min[0] + max[0]) / 2), round((min[1] + max[1]) / 2), round((min[2] + max[2]) / 2)];
  const all = {
    bottom: { id: "bottom", p: [center[0], round(min[1]), center[2]], n: [0, -1, 0] },
    top: { id: "top", p: [center[0], round(max[1]), center[2]], n: [0, 1, 0] },
    left: { id: "left", p: [round(min[0]), center[1], center[2]], n: [-1, 0, 0] },
    right: { id: "right", p: [round(max[0]), center[1], center[2]], n: [1, 0, 0] },
    front: { id: "front", p: [center[0], center[1], round(max[2])], n: [0, 0, 1] },
    back: { id: "back", p: [center[0], center[1], round(min[2])], n: [0, 0, -1] },
  };
  // The first socket is the one the piece attaches with.
  const first = mount === "w" ? "back" : mount === "c" ? "top" : "bottom";
  return [all[first], ...Object.values(all).filter((socket) => socket.id !== first)];
}

const hex = (rgb: number[]) => `#${rgb.map((value) => value.toString(16).padStart(2, "0")).join("")}`;

const surfaces: SurfaceDef[] = [];
const blocks: string[] = [];
const credits: string[] = [];
let totalTriangles = 0;
let textureBytes = 0;

interface Entry {
  blockId: string;
  label: string;
  folder: string;
  /** For a light version: the folder of the full one, whose images it shares. */
  full?: string;
}

/**
 * The blocks a model gives: the whole file, or each of its versions when it has several, and
 * after each one its light copy for maps, when Blender made one.
 */
function entriesOf(id: string, model: RealisticModel): Entry[] {
  const versions = model.variants
    ? readdirSync(prepared)
        .filter((name) => name.startsWith(`${id}@`) && !name.endsWith("~leve"))
        .sort((a, b) => Number(a.split("@")[1]) - Number(b.split("@")[1]))
    : [];
  const main: Entry[] =
    versions.length === 0
      ? [{ blockId: id, label: model.label, folder: path.join(prepared, id) }]
      : versions.map((name, index) => ({
          blockId: index === 0 ? id : `${id}_${index + 1}`,
          label: index === 0 ? model.label : `${model.label} (variação ${index + 1})`,
          folder: path.join(prepared, name),
        }));
  return main.flatMap((entry) =>
    existsSync(path.join(`${entry.folder}~leve`, "mesh.json"))
      ? [entry, { blockId: `${entry.blockId}_leve`, label: `${entry.label} (leve)`, folder: `${entry.folder}~leve`, full: entry.folder }]
      : [entry],
  );
}

/** The surface each material of a model became, by material name, for its light copy to share. */
const surfacesOfFolder = new Map<string, Map<string, string>>();

for (const [source, model] of Object.entries(REALISTIC_MODELS)) for (const { blockId: id, label, folder, full } of entriesOf(source, model)) {
  if (!existsSync(path.join(folder, "mesh.json"))) {
    console.warn(`sem modelo preparado: ${id}`);
    continue;
  }
  const mesh = JSON.parse(readFileSync(path.join(folder, "mesh.json"), "utf8")) as { materials: PreparedMaterial[] };
  const chunks = readChunks(folder, mesh.materials);
  for (const chunk of chunks) if (chunk.material.name === "impostor") cropImpostor(chunk, folder);
  normalize(chunks, model.scale ?? 1);

  let textured = 0;
  const named = new Map<string, string>();
  surfacesOfFolder.set(folder, named);
  // Plants follow the part's color only in their leaves, so an autumn tint leaves the bark alone.
  const tintable = (cutout: boolean | undefined) => model.category !== "lib_nature" || cutout === true;
  const pieces = chunks.map((chunk) => {
    const shape = writeChunk(chunk);
    const { material } = chunk;
    totalTriangles += material.indices / 3;
    if (material.kind === "plain") {
      // Untextured glass comes in all sorts of tints; a neutral one reads as glass in any room.
      const color = material.finish === "tint" ? "#c9d5da" : hex(material.color ?? [200, 200, 200]);
      return { shape, color, ...(material.finish === "matte" ? {} : { finish: material.finish }) };
    }
    // A light copy shares the full model's images, unless it brings its own (a tree drawn as an impostor).
    if (full && !material.images) {
      const shared = surfacesOfFolder.get(full)?.get(material.name);
      if (!shared) throw new Error(`${id}: a versão leve tem um material que a completa não tem (${material.name})`);
      const def = surfaces.find((surface) => surface.id === shared);
      return { shape, surface: shared, ...(tintable(def?.cutout) ? {} : { color: "#ffffff" }) };
    }
    const surfaceId = `ph.${id}.${textured++}`;
    named.set(material.name, surfaceId);
    const images = material.images!;
    const to = path.join(textures, surfaceId);
    mkdirSync(to, { recursive: true });
    const colorFile = material.cutout ? "color.png" : "color.jpg";
    for (const [from, name] of [[images.color, colorFile], [images.normal, "normal.jpg"], [images.arm, "arm.jpg"]]) {
      copyFileSync(path.join(folder, from), path.join(to, name));
      textureBytes += readFileSync(path.join(to, name)).length;
    }
    surfaces.push({
      id: surfaceId,
      name: label,
      group: "model",
      ...(material.cutout ? { cutout: true } : {}),
      ...(material.double && !material.cutout ? { double: true } : {}),
      // Impostor planes bring a face for each side; drawing both sides of each would make them flicker.
      ...(material.cutout && material.double === false ? { double: false } : {}),
      source,
    });
    return { shape, surface: surfaceId, ...(tintable(material.cutout) ? {} : { color: "#ffffff" }) };
  });

  // Glass goes last, so it is drawn over what stands behind it.
  pieces.sort((a, b) => Number("finish" in a && a.finish === "tint") - Number("finish" in b && b.finish === "tint"));
  blocks.push(
    JSON.stringify({
      id: `rz.polyhaven.${id}`,
      name: label,
      category: model.category,
      color: "#ffffff",
      shape: { kind: "compound", pieces },
      sockets: sockets(chunks, model.mount),
      ...(model.mount === "w" || model.mount === "c" ? {} : { upright: true }),
    }),
  );
  if (id !== source) continue;
  const info = JSON.parse(readFileSync(path.join(downloads, "models", source, "info.json"), "utf8")) as { name: string; authors: Record<string, string> };
  credits.push(`| ${info.name} | ${Object.keys(info.authors).join(", ")} | [${source}](https://polyhaven.com/a/${source}) |`);
}

writeFileSync(path.join(repo, "public/models/realista.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/realistic.generated.ts"),
  `// Generated by scripts/import-realistic.ts. Do not edit by hand.
import type { BlockDef } from "../types.ts";
import type { SurfaceDef } from "../surfaces.ts";

export const modelSurfaces: SurfaceDef[] = [
${surfaces.map((surface) => `  ${JSON.stringify(surface)},`).join("\n")}
];

export const realisticModelBlocks: BlockDef[] = [
${blocks.map((block) => `  ${block},`).join("\n")}
];
`,
);

const skyInfo = JSON.parse(readFileSync(path.join(downloads, "sky", "info.json"), "utf8")) as { id: string; name: string; authors: Record<string, string> };
const textureCredits = TILING_SURFACES.map((surface) => {
  const info = JSON.parse(readFileSync(path.join(downloads, "textures", surface.source, "info.json"), "utf8")) as { name: string; authors: Record<string, string> };
  return `| ${surface.name} | ${info.name} | ${Object.keys(info.authors).join(", ")} | [${surface.source}](https://polyhaven.com/a/${surface.source}) |`;
});
writeFileSync(
  path.join(prepared, "credits.md"),
  `| Modelo | Autor | Página |\n| --- | --- | --- |\n${credits.join("\n")}\n\n| Textura | Nome no Poly Haven | Autor | Página |\n| --- | --- | --- | --- |\n${textureCredits.join("\n")}\n\nCéu: ${skyInfo.name}, de ${Object.keys(skyInfo.authors).join(", ")} ([${skyInfo.id}](https://polyhaven.com/a/${skyInfo.id}))\n`,
);

const mb = (bytes: number) => (bytes / 1048576).toFixed(1);
console.log(`${blocks.length} modelos, ${surfaces.length} materiais com textura, ${Math.round(totalTriangles)} triângulos`);
console.log(`realista.bin: ${mb(packSize)} MB; texturas dos modelos: ${mb(textureBytes)} MB`);
