// Converts CC0 model packs into the editor's model pack and block definitions.
//
//   node scripts/import-models.ts <folder with one subfolder per kit>
//
// Textures are baked into per-triangle colors, so imported models behave like every other
// block. Each input file is only parsed as data; nothing from it is ever executed.
import { mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Matrix3, Matrix4, Quaternion, Vector2, Vector3 } from "three";
import pngjs from "pngjs";
import { translateName } from "./model-names.ts";

const { PNG } = pngjs;

interface Kit {
  id: string;
  folder: string;
  category: string;
  /** Multiplies the model's units to reach meters. */
  scale: number;
  /** Tiles placed on the ground and snapped to this grid. */
  grid?: number;
  gridMatch?: RegExp;
  /** Keeps the file's origin, for kits whose tiles are authored around it. */
  keepOrigin?: boolean;
  /** For textures with real drawings (faces, banners), not smooth color ramps. */
  detailedTexture?: boolean;
  skip?: RegExp;
}

const KITS: Kit[] = [
  { id: "car-kit", folder: "car-kit/x/Models/GLB format", category: "lib_vehicles", scale: 1.6, skip: /^debris-|^wheel-/ },
  { id: "commercial", folder: "city-kit-commercial/x/Models/GLB format", category: "lib_city", scale: 6.5, skip: /^low-detail-/ },
  { id: "suburban", folder: "city-kit-suburban/x/Models/GLB format", category: "lib_city", scale: 4 },
  { id: "roads", folder: "city-kit-roads/x/Models/GLB format", category: "lib_roads", scale: 8, grid: 8, gridMatch: /^(road-|tile-|bridge-)/, keepOrigin: true },
  { id: "racing", folder: "racing-kit/x/Models/glTF format", category: "lib_race", scale: 8, grid: 4, gridMatch: /^(road|grass)/, detailedTexture: true },
  { id: "nature", folder: "nature-kit/x/Models/GLTF format", category: "lib_nature", scale: 3.2 },
  { id: "blocky", folder: "blocky-characters/x/Models/GLB format", category: "lib_people", scale: 0.66, detailedTexture: true },
];

const MAX_CELLS_PER_TRIANGLE = 900;
const BYTES_PER_VERTEX = 12;

const repo = path.resolve(import.meta.dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Informe a pasta com os pacotes baixados.");

interface Gltf {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: Primitive[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  materials?: {
    pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number } };
  }[];
  textures?: { source: number }[];
  images?: { uri?: string }[];
}
interface GltfNode {
  children?: number[];
  mesh?: number;
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}
interface Primitive {
  attributes: { POSITION: number; NORMAL?: number; TEXCOORD_0?: number };
  indices?: number;
  material?: number;
  mode?: number;
}
interface Image {
  width: number;
  height: number;
  data: Uint8Array;
}
interface Corner {
  p: Vector3;
  n: Vector3;
  uv: Vector2;
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const imageCache = new Map<string, Image>();

function readImage(file: string): Image {
  let image = imageCache.get(file);
  if (!image) {
    const png = PNG.sync.read(readFileSync(file));
    image = { width: png.width, height: png.height, data: png.data };
    imageCache.set(file, image);
  }
  return image;
}

function load(file: string): { gltf: Gltf; buffers: Buffer[] } {
  const data = readFileSync(file);
  if (file.toLowerCase().endsWith(".gltf")) {
    const gltf = JSON.parse(data.toString("utf8")) as Gltf;
    const buffers = gltf.buffers.map((buffer) => {
      if (!buffer.uri || buffer.uri.startsWith("data:")) throw new Error(`Buffer não suportado: ${file}`);
      return readFileSync(path.join(path.dirname(file), decodeURIComponent(buffer.uri)));
    });
    return { gltf, buffers };
  }
  const jsonLength = data.readUInt32LE(12);
  const gltf = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binaryStart = 20 + jsonLength + 8;
  return { gltf, buffers: [data.subarray(binaryStart)] };
}

function readAccessor(gltf: Gltf, buffers: Buffer[], index: number): number[][] {
  const accessor = gltf.accessors[index];
  const view = gltf.bufferViews[accessor.bufferView];
  const buffer = buffers[view.buffer];
  const size = COMPONENTS[accessor.type];
  const component = accessor.componentType;
  const bytes = component === 5126 || component === 5125 ? 4 : component === 5123 ? 2 : 1;
  const stride = view.byteStride ?? size * bytes;
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out: number[][] = [];
  for (let i = 0; i < accessor.count; i++) {
    const item: number[] = [];
    for (let c = 0; c < size; c++) {
      const offset = start + i * stride + c * bytes;
      if (component === 5126) item.push(buffer.readFloatLE(offset));
      else if (component === 5125) item.push(buffer.readUInt32LE(offset));
      else if (component === 5123) item.push(buffer.readUInt16LE(offset));
      else if (component === 5121) item.push(buffer.readUInt8(offset));
      else throw new Error(`Tipo de componente não suportado: ${component}`);
    }
    out.push(item);
  }
  return out;
}

const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

interface Texture {
  width: number;
  height: number;
  sample(uv: Vector2): [number, number, number];
}

function sampler(file: string, gltf: Gltf, primitive: Primitive): Texture | ((uv: Vector2) => [number, number, number]) {
  const pbr = gltf.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness;
  const factor = pbr?.baseColorFactor ?? [1, 1, 1, 1];
  const textureIndex = pbr?.baseColorTexture?.index;
  const uri = textureIndex === undefined ? undefined : gltf.images?.[gltf.textures![textureIndex].source]?.uri;
  const image = uri ? readImage(path.join(path.dirname(file), decodeURIComponent(uri))) : null;

  const sample = (uv: Vector2): [number, number, number] => {
    let color: [number, number, number] = [1, 1, 1];
    if (image) {
      const x = Math.min(Math.floor((uv.x - Math.floor(uv.x)) * image.width), image.width - 1);
      const y = Math.min(Math.floor((uv.y - Math.floor(uv.y)) * image.height), image.height - 1);
      const at = (x + y * image.width) * 4;
      color = [
        srgbToLinear(image.data[at] / 255),
        srgbToLinear(image.data[at + 1] / 255),
        srgbToLinear(image.data[at + 2] / 255),
      ];
    }
    return [
      Math.round(linearToSrgb(color[0] * factor[0]) * 255),
      Math.round(linearToSrgb(color[1] * factor[1]) * 255),
      Math.round(linearToSrgb(color[2] * factor[2]) * 255),
    ];
  };
  return image ? { width: image.width, height: image.height, sample } : sample;
}

type Rgb = [number, number, number];

interface Triangle {
  corners: [Corner, Corner, Corner];
  colors: [Rgb, Rgb, Rgb];
}

/** Keeps the triangle and colors each corner, which reproduces smooth color ramps. */
function bakeCorners(
  corners: [Corner, Corner, Corner],
  sample: (uv: Vector2) => Rgb,
  out: Triangle[],
): void {
  const center = corners[0].uv.clone().add(corners[1].uv).add(corners[2].uv).divideScalar(3);
  // Pulled slightly inward, because corners sit right on the edge of a color swatch.
  const at = (corner: Corner) => sample(corner.uv.clone().lerp(center, 0.12));
  out.push({ corners, colors: [at(corners[0]), at(corners[1]), at(corners[2])] });
}

function lerpCorner(a: Corner, b: Corner, t: number): Corner {
  return {
    p: a.p.clone().lerp(b.p, t),
    n: a.n.clone().lerp(b.n, t).normalize(),
    uv: a.uv.clone().lerp(b.uv, t),
  };
}

/** Keeps the part of a polygon on one side of a line in texture space. */
function clip(polygon: Corner[], axis: "x" | "y", bound: number, keepAbove: boolean): Corner[] {
  const inside = (corner: Corner) => (keepAbove ? corner.uv[axis] >= bound : corner.uv[axis] <= bound);
  const result: Corner[] = [];
  polygon.forEach((a, index) => {
    const b = polygon[(index + 1) % polygon.length];
    if (inside(a)) result.push(a);
    if (inside(a) !== inside(b)) result.push(lerpCorner(a, b, (bound - a.uv[axis]) / (b.uv[axis] - a.uv[axis])));
  });
  return result;
}

/**
 * Cuts a triangle along the texture's pixel grid, so drawings stay as sharp as the original.
 * Neighboring pixels of the same color become one piece, which keeps the count low.
 */
function bakeTexels(corners: [Corner, Corner, Corner], texture: Texture, out: Triangle[]): void {
  const us = corners.map((corner) => corner.uv.x * texture.width);
  const vs = corners.map((corner) => corner.uv.y * texture.height);
  const area = (Math.max(...us) - Math.min(...us)) * (Math.max(...vs) - Math.min(...vs));
  const step = Math.max(1, Math.ceil(Math.sqrt(area / MAX_CELLS_PER_TRIANGLE)));
  const firstU = Math.floor(Math.min(...us) / step);
  const lastU = Math.ceil(Math.max(...us) / step);
  const firstV = Math.floor(Math.min(...vs) / step);
  const lastV = Math.ceil(Math.max(...vs) / step);

  const u = (cell: number) => (cell * step) / texture.width;
  const v = (cell: number) => (cell * step) / texture.height;
  const colorAt = (cu: number, cv: number) => texture.sample(new Vector2(u(cu + 0.5), v(cv + 0.5)));
  const same = (a: Rgb, b: Rgb) => a.every((value, channel) => value === b[channel]);

  for (let row = firstV; row < lastV; row++) {
    let start = firstU;
    while (start < lastU) {
      const color = colorAt(start, row);
      let end = start + 1;
      while (end < lastU && same(colorAt(end, row), color)) end++;

      let polygon: Corner[] = [...corners];
      polygon = clip(polygon, "x", u(start), true);
      polygon = clip(polygon, "x", u(end), false);
      polygon = clip(polygon, "y", v(row), true);
      polygon = clip(polygon, "y", v(row + 1), false);

      for (let i = 1; i + 1 < polygon.length; i++) {
        const [a, b, c] = [polygon[0], polygon[i], polygon[i + 1]];
        const size = b.p.clone().sub(a.p).cross(c.p.clone().sub(a.p)).length();
        if (size < 1e-10) continue;
        const copy = (corner: Corner): Corner => ({ p: corner.p.clone(), n: corner.n.clone(), uv: corner.uv });
        out.push({ corners: [copy(a), copy(b), copy(c)], colors: [color, color, color] });
      }
      start = end;
    }
  }
}

function nodeMatrix(node: GltfNode): Matrix4 {
  if (node.matrix) return new Matrix4().fromArray(node.matrix);
  return new Matrix4().compose(
    new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    new Vector3().fromArray(node.scale ?? [1, 1, 1]),
  );
}

function extract(file: string, detailedTexture: boolean): Triangle[] {
  const { gltf, buffers } = load(file);
  const triangles: Triangle[] = [];

  const visit = (index: number, parent: Matrix4) => {
    const node = gltf.nodes[index];
    const world = parent.clone().multiply(nodeMatrix(node));
    if (node.mesh !== undefined) {
      const normalMatrix = new Matrix3().getNormalMatrix(world);
      for (const primitive of gltf.meshes[node.mesh].primitives) {
        if ((primitive.mode ?? 4) !== 4) continue;
        const positions = readAccessor(gltf, buffers, primitive.attributes.POSITION);
        const normals = primitive.attributes.NORMAL === undefined ? null : readAccessor(gltf, buffers, primitive.attributes.NORMAL);
        const uvs = primitive.attributes.TEXCOORD_0 === undefined ? null : readAccessor(gltf, buffers, primitive.attributes.TEXCOORD_0);
        const indices = primitive.indices === undefined
          ? positions.map((_, i) => i)
          : readAccessor(gltf, buffers, primitive.indices).map(([value]) => value);
        const source = sampler(file, gltf, primitive);
        const sample = typeof source === "function" ? source : source.sample;

        const corner = (i: number): Corner => ({
          p: new Vector3().fromArray(positions[i]).applyMatrix4(world),
          n: normals ? new Vector3().fromArray(normals[i]).applyMatrix3(normalMatrix).normalize() : new Vector3(0, 1, 0),
          uv: uvs ? new Vector2().fromArray(uvs[i]) : new Vector2(),
        });
        for (let t = 0; t + 2 < indices.length; t += 3) {
          const face: [Corner, Corner, Corner] = [corner(indices[t]), corner(indices[t + 1]), corner(indices[t + 2])];
          if (detailedTexture && typeof source !== "function") bakeTexels(face, source, triangles);
          else bakeCorners(face, sample, triangles);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new Matrix4());
  return triangles;
}

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: number[]) => values.map(round);

function chunks(items: string[]): string {
  return items.map((item) => `  ${item},`).join("\n");
}

const packParts: Buffer[] = [];
let packSize = 0;
const blockSources: string[] = [];
const stats: string[] = [];

for (const kit of KITS) {
  const folder = path.join(source, kit.folder);
  const files = readdirSync(folder)
    .filter((name) => /\.(glb|gltf)$/i.test(name) && statSync(path.join(folder, name)).isFile())
    .sort();

  let total = 0;
  let triangles = 0;
  let sample = "";
  for (const fileName of files) {
    const name = fileName.replace(/\.(glb|gltf)$/i, "");
    if (kit.skip?.test(name)) continue;

    const baked = extract(path.join(folder, fileName), kit.detailedTexture === true);
    if (baked.length === 0) continue;

    const isTile = kit.grid !== undefined && (kit.gridMatch?.test(name) ?? true);
    const keepsOrigin = isTile && kit.keepOrigin === true;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { corners } of baked) {
      for (const { p } of corners) {
        p.multiplyScalar(kit.scale);
        min.min(p);
        max.max(p);
      }
    }

    // Everything rests on y = 0. Free-standing models are also centered on their footprint.
    const shift = new Vector3(
      keepsOrigin ? 0 : -(min.x + max.x) / 2,
      -min.y,
      keepsOrigin ? 0 : -(min.z + max.z) / 2,
    );
    min.add(shift);
    max.add(shift);
    const span = max.clone().sub(min);
    const safeSpan = [span.x || 1, span.y || 1, span.z || 1];

    const vertices = baked.length * 3;
    const buffer = Buffer.alloc(vertices * BYTES_PER_VERTEX);
    let at = 0;
    for (const { corners, colors } of baked) {
      for (let c = 0; c < 3; c++) {
        const { p, n } = corners[c];
        const color = colors[c];
        p.add(shift);
        buffer.writeInt16LE(Math.round(((p.x - min.x) / safeSpan[0]) * 65534 - 32767), at);
        buffer.writeInt16LE(Math.round(((p.y - min.y) / safeSpan[1]) * 65534 - 32767), at + 2);
        buffer.writeInt16LE(Math.round(((p.z - min.z) / safeSpan[2]) * 65534 - 32767), at + 4);
        buffer.writeInt8(Math.round(n.x * 127), at + 6);
        buffer.writeInt8(Math.round(n.y * 127), at + 7);
        buffer.writeInt8(Math.round(n.z * 127), at + 8);
        buffer.writeUInt8(color[0], at + 9);
        buffer.writeUInt8(color[1], at + 10);
        buffer.writeUInt8(color[2], at + 11);
        at += BYTES_PER_VERTEX;
      }
    }

    const offset = packSize;
    packParts.push(buffer);
    packSize += buffer.length;

    const center = [round((min.x + max.x) / 2), round((min.y + max.y) / 2), round((min.z + max.z) / 2)];
    const sockets = [
      ["bottom", [center[0], round(min.y), center[2]], [0, -1, 0]],
      ["top", [center[0], round(max.y), center[2]], [0, 1, 0]],
      ["left", [round(min.x), center[1], center[2]], [-1, 0, 0]],
      ["right", [round(max.x), center[1], center[2]], [1, 0, 0]],
      ["front", [center[0], center[1], round(max.z)], [0, 0, 1]],
      ["back", [center[0], center[1], round(min.z)], [0, 0, -1]],
    ].map(([id, p, n]) => ({ id, p, n }));

    const extra = isTile ? { ground: true, snap: kit.grid } : { upright: true };
    blockSources.push(
      JSON.stringify({
        id: `kit.${kit.id}.${name}`,
        name: translateName(name),
        category: kit.category,
        color: "#ffffff",
        shape: {
          kind: "model",
          model: `${kit.id}/${name}`,
          offset,
          vertices,
          min: roundAll(min.toArray()),
          max: roundAll(max.toArray()),
        },
        sockets,
        ...extra,
      }),
    );

    total++;
    triangles += baked.length;
    if (!sample) sample = `${name}: ${roundAll(span.toArray()).join(" x ")} m`;
  }
  stats.push(`${kit.id}: ${total} modelos, média ${Math.round(triangles / Math.max(total, 1))} triângulos (${sample})`);
}

mkdirSync(path.join(repo, "public/models"), { recursive: true });
writeFileSync(path.join(repo, "public/models/pack.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/models.generated.ts"),
  `// Generated by scripts/import-models.ts. Do not edit by hand.\nimport type { BlockDef } from "../types.ts";\n\nexport const modelBlocks: BlockDef[] = [\n${chunks(blockSources)}\n];\n`,
);

console.log(stats.join("\n"));
console.log(`Total: ${blockSources.length} modelos, ${(packSize / 1048576).toFixed(1)} MB`);
