import * as THREE from "three";
import type { Primitive } from "./types";

type ModelShape = Extract<Primitive, { kind: "model" }>;

const BYTES_PER_VERTEX = 12;

let pack: DataView | null = null;

export function setModelPack(buffer: ArrayBuffer): void {
  pack = new DataView(buffer);
}

/** Must finish before any block is built, so the catalog can stay synchronous. */
export async function loadModelPack(): Promise<void> {
  const response = await fetch("/models/pack.bin");
  if (!response.ok) throw new Error(`Falha ao carregar os modelos: ${response.status}`);
  setModelPack(await response.arrayBuffer());
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
