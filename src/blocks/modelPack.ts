import * as THREE from "three";
import type { ModelPackName, Primitive } from "./types";

type ModelShape = Extract<Primitive, { kind: "model" }>;
type BakedShape = Extract<Primitive, { kind: "baked" }>;
type MappedShape = Extract<Primitive, { kind: "mapped" }>;
type SkinnedShape = Extract<Primitive, { kind: "skinned" }>;

const BYTES_PER_VERTEX = 12;

/** Int16 x 3 position and int8 x 3 normal. */
const BAKED_VERTEX_BYTES = 9;
/** A baked vertex followed by uint16 x 2 texture coordinates. */
const MAPPED_VERTEX_BYTES = 13;
/** A mapped vertex followed by four bone numbers and their four weights, in bytes. */
const SKINNED_VERTEX_BYTES = 21;

const packs: Partial<Record<ModelPackName, DataView>> = {};
let vehiclePack: DataView | null = null;
let realisticPack: DataView | null = null;
let peoplePack: DataView | null = null;

/** The pack of ready-made models: `models` for the city kits, `interior` for furniture. */
export function setModelPack(buffer: ArrayBuffer, name: ModelPackName = "models"): void {
  packs[name] = new DataView(buffer);
}

export function setVehiclePack(buffer: ArrayBuffer): void {
  vehiclePack = new DataView(buffer);
}

export function setRealisticPack(buffer: ArrayBuffer): void {
  realisticPack = new DataView(buffer);
}

export function setPeoplePack(buffer: ArrayBuffer): void {
  peoplePack = new DataView(buffer);
}

async function fetchPack(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar os modelos: ${response.status}`);
  return response.arrayBuffer();
}

/** Must finish before any block is built, so the catalog can stay synchronous. */
export async function loadModelPack(): Promise<void> {
  const [models, interior, vehicles, realistic, people] = await Promise.all([
    fetchPack("/models/pack.bin"),
    fetchPack("/models/interior.bin"),
    fetchPack("/models/vehicles.bin"),
    fetchPack("/models/realista.bin"),
    fetchPack("/models/pessoas.bin"),
  ]);
  setModelPack(models);
  setModelPack(interior, "interior");
  setVehiclePack(vehicles);
  setRealisticPack(realistic);
  setPeoplePack(people);
}

/** Expands a textured model into plain triangles with their texture coordinates. */
export function decodeMapped(shape: MappedShape): THREE.BufferGeometry {
  if (!realisticPack) throw new Error("O pacote Realista ainda não foi carregado");
  const { offset, vertices, indices, min, max, uv } = shape;
  const view = realisticPack;
  const firstIndex = offset + vertices * MAPPED_VERTEX_BYTES;
  // Indices are 16-bit, or 32-bit when the model has more vertices than 16 bits can count.
  const wide = vertices > 65535;
  const positions = new Float32Array(indices * 3);
  const normals = new Float32Array(indices * 3);
  const uvs = new Float32Array(indices * 2);
  for (let i = 0; i < indices; i++) {
    const vertex = wide ? view.getUint32(firstIndex + i * 4, true) : view.getUint16(firstIndex + i * 2, true);
    const at = offset + vertex * MAPPED_VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      const value = (view.getInt16(at + axis * 2, true) + 32767) / 65534;
      positions[i * 3 + axis] = min[axis] + value * (max[axis] - min[axis]);
      normals[i * 3 + axis] = view.getInt8(at + 6 + axis) / 127;
    }
    uvs[i * 2] = uv[0] + (view.getUint16(at + 9, true) / 65535) * (uv[2] - uv[0]);
    uvs[i * 2 + 1] = uv[1] + (view.getUint16(at + 11, true) / 65535) * (uv[3] - uv[1]);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.normalizeNormals();
  return geometry;
}

/**
 * Expands a piece of a Realista person into plain triangles, with its texture coordinates and the
 * bones that move each corner: `skinIndex` and `skinWeight`, as three.js and glTF name them.
 */
export function decodeSkinned(shape: SkinnedShape): THREE.BufferGeometry {
  if (!peoplePack) throw new Error("O pacote de pessoas ainda não foi carregado");
  const { offset, vertices, indices, min, max, uv } = shape;
  const view = peoplePack;
  const firstIndex = offset + vertices * SKINNED_VERTEX_BYTES;
  const wide = vertices > 65535;
  const positions = new Float32Array(indices * 3);
  const normals = new Float32Array(indices * 3);
  const uvs = new Float32Array(indices * 2);
  const bones = new Uint16Array(indices * 4);
  const weights = new Float32Array(indices * 4);
  for (let i = 0; i < indices; i++) {
    const vertex = wide ? view.getUint32(firstIndex + i * 4, true) : view.getUint16(firstIndex + i * 2, true);
    const at = offset + vertex * SKINNED_VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      const value = (view.getInt16(at + axis * 2, true) + 32767) / 65534;
      positions[i * 3 + axis] = min[axis] + value * (max[axis] - min[axis]);
      normals[i * 3 + axis] = view.getInt8(at + 6 + axis) / 127;
    }
    uvs[i * 2] = uv[0] + (view.getUint16(at + 9, true) / 65535) * (uv[2] - uv[0]);
    uvs[i * 2 + 1] = uv[1] + (view.getUint16(at + 11, true) / 65535) * (uv[3] - uv[1]);
    for (let k = 0; k < 4; k++) {
      bones[i * 4 + k] = view.getUint8(at + 13 + k);
      weights[i * 4 + k] = view.getUint8(at + 17 + k) / 255;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setAttribute("skinIndex", new THREE.BufferAttribute(bones, 4));
  geometry.setAttribute("skinWeight", new THREE.BufferAttribute(weights, 4));
  geometry.normalizeNormals();
  return geometry;
}

/** Expands a Blender zone into plain triangles, which is what block geometry is merged from. */
export function decodeBaked(shape: BakedShape): THREE.BufferGeometry {
  if (!vehiclePack) throw new Error("O pacote de veículos ainda não foi carregado");
  const { offset, vertices, indices, min, max } = shape;
  const view = vehiclePack;
  const firstIndex = offset + vertices * BAKED_VERTEX_BYTES;
  const positions = new Float32Array(indices * 3);
  const normals = new Float32Array(indices * 3);
  for (let i = 0; i < indices; i++) {
    const vertex = view.getUint16(firstIndex + i * 2, true);
    const at = offset + vertex * BAKED_VERTEX_BYTES;
    for (let axis = 0; axis < 3; axis++) {
      const value = (view.getInt16(at + axis * 2, true) + 32767) / 65534;
      positions[i * 3 + axis] = min[axis] + value * (max[axis] - min[axis]);
      normals[i * 3 + axis] = view.getInt8(at + 6 + axis) / 127;
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.normalizeNormals();
  return geometry;
}

export function decodeModel(shape: ModelShape): THREE.BufferGeometry {
  const pack = packs[shape.pack ?? "models"];
  if (!pack) throw new Error("O pacote de modelos ainda não foi carregado");
  const { offset, vertices, min, max } = shape;
  const positions = new Float32Array(vertices * 3);
  const normals = new Float32Array(vertices * 3);
  const colors = new Float32Array(vertices * 3);
  const color = new THREE.Color();

  for (let i = 0; i < vertices; i++) {
    const at = offset + i * BYTES_PER_VERTEX;
    for (let axis = 0; axis < 3; axis++) {
      const value = (pack.getInt16(at + axis * 2, true) + 32767) / 65534;
      positions[i * 3 + axis] = min[axis] + value * (max[axis] - min[axis]);
      normals[i * 3 + axis] = pack.getInt8(at + 6 + axis) / 127;
    }
    color.setRGB(
      pack.getUint8(at + 9) / 255,
      pack.getUint8(at + 10) / 255,
      pack.getUint8(at + 11) / 255,
      THREE.SRGBColorSpace,
    );
    color.toArray(colors, i * 3);
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  // 8-bit normals lose a little length, and glTF requires exactly unit vectors.
  geometry.normalizeNormals();
  return geometry;
}
