import type { CustomShape } from "../core/types";
import { meshBounds, type PolyMesh } from "../modeling/mesh";
import raw from "./blocks.json";
import type { BlockCategory, BlockDef, BlockShape, ShapePiece, SocketDef, Vec3 } from "./types";

export type { BlockCategory, BlockDef, BlockShape, Primitive, ShapePiece, SocketDef, Vec3 } from "./types";

const catalog = raw as unknown as { categories: BlockCategory[]; blocks: BlockDef[] };

export const categories = catalog.categories;
export const blocks = catalog.blocks;

const blocksById = new Map(blocks.map((block) => [block.id, block]));

export const CUSTOM_CATEGORY = "custom";

export function meshToBlockShape(mesh: PolyMesh): BlockShape {
  const byMaterial = new Map<number, number[][]>();
  mesh.faces.forEach((face, index) => {
    const material = mesh.faceMaterials[index];
    const faces = byMaterial.get(material);
    if (faces) faces.push(face);
    else byMaterial.set(material, [face]);
  });
  const pieces = [...byMaterial].map(([material, faces]): ShapePiece => {
    const { color, shade, finish, painted } = mesh.materials[material];
    const colors = painted && mesh.vertexColors?.length === mesh.vertices.length ? mesh.vertexColors : undefined;
    return {
      shape: { kind: "polygons", vertices: mesh.vertices, faces, crease: mesh.smoothAngle, ...(colors ? { colors } : {}) },
      ...(color ? { color } : {}),
      ...(shade === undefined ? {} : { shade }),
      ...(finish ? { finish } : {}),
    };
  });
  return { kind: "compound", pieces };
}

const SOCKET_SIDES: { id: string; axis: number; sign: 1 | -1 }[] = [
  { id: "base", axis: 1, sign: -1 },
  { id: "topo", axis: 1, sign: 1 },
  { id: "frente", axis: 2, sign: 1 },
  { id: "tras", axis: 2, sign: -1 },
  { id: "direita", axis: 0, sign: 1 },
  { id: "esquerda", axis: 0, sign: -1 },
];

/** One point in the middle of each side of the bounds. The base comes first, to rest on things. */
export function socketsFromBounds(mesh: PolyMesh): SocketDef[] {
  const { min, max } = meshBounds(mesh);
  const center = min.map((value, axis) => (value + max[axis]) / 2) as Vec3;
  return SOCKET_SIDES.map(({ id, axis, sign }) => {
    const p = [...center] as Vec3;
    const n: Vec3 = [0, 0, 0];
    p[axis] = sign > 0 ? max[axis] : min[axis];
    n[axis] = sign;
    return { id, p, n };
  });
}

function customBlock(shape: CustomShape): BlockDef {
  return {
    id: shape.id,
    name: shape.name,
    category: CUSTOM_CATEGORY,
    color: shape.color,
    shape: meshToBlockShape(shape),
    sockets: shape.sockets.length > 0 ? shape.sockets : socketsFromBounds(shape),
  };
}

const custom = new Map<string, { source: string; block: BlockDef }>();
let customRevision = -Infinity;

/**
 * Keeps the blocks made in the project up to date. An unchanged shape keeps the same object, so
 * anything cached for it stays valid. Events can arrive out of order; the revision settles it.
 */
export function syncCustomBlocks(shapes: readonly CustomShape[], revision: number): void {
  if (revision < customRevision) return;
  customRevision = revision;
  const present = new Set<string>();
  for (const shape of shapes) {
    present.add(shape.id);
    const source = JSON.stringify(shape);
    if (custom.get(shape.id)?.source !== source) custom.set(shape.id, { source, block: customBlock(shape) });
  }
  for (const id of custom.keys()) {
    if (!present.has(id)) custom.delete(id);
  }
}

export function customBlocks(): BlockDef[] {
  return [...custom.values()].map(({ block }) => block);
}

/** A color layer only makes sense on top of its model, so lists leave it out. */
export function isColorLayer(id: string): boolean {
  return /_(paint|trim|accent|band|stripe)$/.test(id) || /\.veh_.*_rim$/.test(id);
}

/** What has to be placed with a block for the model to come out whole. */
export function layersOf(id: string): string[] {
  const suffix = id.endsWith("_base") ? "_base" : /\.wheel_.*_rim$/.test(id) ? "_rim" : "";
  const stem = suffix ? id.slice(0, -suffix.length) : id;
  return ["paint", "trim", "accent", "rim", "band", "stripe"].map((layer) => `${stem}_${layer}`).filter((layer) => layer !== id && hasBlock(layer));
}

export function hasBlock(id: string): boolean {
  return custom.has(id) || blocksById.has(id);
}

export function getBlock(id: string): BlockDef {
  const block = custom.get(id)?.block ?? blocksById.get(id);
  if (!block) throw new Error(`Bloco desconhecido: ${id}`);
  return block;
}
