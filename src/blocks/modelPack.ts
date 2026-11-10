import * as THREE from "three";
import type { Primitive } from "./types";

type ModelShape = Extract<Primitive, { kind: "model" }>;
type BakedShape = Extract<Primitive, { kind: "baked" }>;

const BYTES_PER_VERTEX = 12;

/** Int16 x 3 position and int8 x 3 normal. */
const BAKED_VERTEX_BYTES = 9;

let pack: DataView | null = null;
let vehiclePack: DataView | null = null;

export function setModelPack(buffer: ArrayBuffer): void {
  pack = new DataView(buffer);
}

export function setVehiclePack(buffer: ArrayBuffer): void {
  vehiclePack = new DataView(buffer);
}

async function fetchPack(url: string): Promise<ArrayBuffer> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Falha ao carregar os modelos: ${response.status}`);
  return response.arrayBuffer();
}

/** Must finish before any block is built, so the catalog can stay synchronous. */
export async function loadModelPack(): Promise<void> {
  const [models, vehicles] = await Promise.all([fetchPack("/models/pack.bin"), fetchPack("/models/vehicles.bin")]);
  setModelPack(models);
  setVehiclePack(vehicles);
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
