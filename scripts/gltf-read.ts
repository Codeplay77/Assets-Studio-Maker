// Reads glTF files as plain data and bakes their textures into colors, for the model importers.
// Nothing from a file is ever executed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Matrix3, Matrix4, Quaternion, Vector2, Vector3 } from "three";
import pngjs from "pngjs";

const { PNG } = pngjs;

const MAX_CELLS_PER_TRIANGLE = 900;

export interface Gltf {
  scene?: number;
  scenes: { nodes: number[] }[];
  nodes: GltfNode[];
  meshes: { primitives: Primitive[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[];
  bufferViews: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers: { uri?: string; byteLength: number }[];
  materials?: {
    name?: string;
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
export interface Corner {
  p: Vector3;
  n: Vector3;
  uv: Vector2;
}

export type Rgb = [number, number, number];

export interface Triangle {
  corners: [Corner, Corner, Corner];
  colors: [Rgb, Rgb, Rgb];
  /** The name of the material the triangle came from. */
  material?: string;
}

export interface ExtractOptions {
  /** For textures with real drawings (faces, banners), not smooth color ramps. */
  detailedTexture?: boolean;
  /** Replaces a material's color, by name. Values are linear RGB. */
  recolor?: Record<string, [number, number, number]>;
  /** Multiplies every linear color, for packs whose colors are darker than they look in their own previews. */
  brighten?: number;
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

export function load(file: string): { gltf: Gltf; buffers: Buffer[] } {
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

export function readAccessor(gltf: Gltf, buffers: Buffer[], index: number): number[][] {
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

export const srgbToLinear = (v: number) => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
export const linearToSrgb = (v: number) => (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055);

interface Texture {
  width: number;
  height: number;
  sample(uv: Vector2): Rgb;
}

function sampler(file: string, gltf: Gltf, primitive: Primitive, options: ExtractOptions): Texture | ((uv: Vector2) => Rgb) {
  const material = gltf.materials?.[primitive.material ?? -1];
  const pbr = material?.pbrMetallicRoughness;
  const factor = options.recolor?.[material?.name ?? ""] ?? pbr?.baseColorFactor ?? [1, 1, 1, 1];
  const gain = options.brighten ?? 1;
  const textureIndex = pbr?.baseColorTexture?.index;
  const uri = textureIndex === undefined ? undefined : gltf.images?.[gltf.textures![textureIndex].source]?.uri;
  const image = uri ? readImage(path.join(path.dirname(file), decodeURIComponent(uri))) : null;

  const sample = (uv: Vector2): Rgb => {
    let color: Rgb = [1, 1, 1];
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
    const channel = (c: number) => Math.round(linearToSrgb(Math.min(1, color[c] * factor[c] * gain)) * 255);
    return [channel(0), channel(1), channel(2)];
  };
  return image ? { width: image.width, height: image.height, sample } : sample;
}

/** Keeps the triangle and colors each corner, which reproduces smooth color ramps. */
function bakeCorners(corners: [Corner, Corner, Corner], sample: (uv: Vector2) => Rgb, out: Triangle[], material?: string): void {
  const center = corners[0].uv.clone().add(corners[1].uv).add(corners[2].uv).divideScalar(3);
  // Pulled slightly inward, because corners sit right on the edge of a color swatch.
  const at = (corner: Corner) => sample(corner.uv.clone().lerp(center, 0.12));
  out.push({ corners, colors: [at(corners[0]), at(corners[1]), at(corners[2])], material });
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

/** Every triangle of the default scene, in the file's units, with its colors baked in. */
export function extract(file: string, options: ExtractOptions = {}): Triangle[] {
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
        const source = sampler(file, gltf, primitive, options);
        const sample = typeof source === "function" ? source : source.sample;
        const material = gltf.materials?.[primitive.material ?? -1]?.name;
        // A mirrored node turns its triangles inside out; swapping two corners turns them back.
        const mirrored = world.determinant() < 0;

        const corner = (i: number): Corner => ({
          p: new Vector3().fromArray(positions[i]).applyMatrix4(world),
          n: normals ? new Vector3().fromArray(normals[i]).applyMatrix3(normalMatrix).normalize() : new Vector3(0, 1, 0),
          uv: uvs ? new Vector2().fromArray(uvs[i]) : new Vector2(),
        });
        for (let t = 0; t + 2 < indices.length; t += 3) {
          const order = mirrored ? [t, t + 2, t + 1] : [t, t + 1, t + 2];
          const face: [Corner, Corner, Corner] = [corner(indices[order[0]]), corner(indices[order[1]]), corner(indices[order[2]])];
          if (options.detailedTexture && typeof source !== "function") bakeTexels(face, source, triangles);
          else bakeCorners(face, sample, triangles, material);
        }
      }
    }
    for (const child of node.children ?? []) visit(child, world);
  };

  for (const root of gltf.scenes[gltf.scene ?? 0].nodes) visit(root, new Matrix4());
  return triangles;
}
