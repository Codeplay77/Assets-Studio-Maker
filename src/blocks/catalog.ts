import raw from "./blocks.json";
import type { BlockCategory, BlockDef } from "./types";

export type { BlockCategory, BlockDef, BlockShape, Primitive, ShapePiece, SocketDef, Vec3 } from "./types";

const catalog = raw as unknown as { categories: BlockCategory[]; blocks: BlockDef[] };

export const categories = catalog.categories;
export const blocks = catalog.blocks;

const blocksById = new Map(blocks.map((block) => [block.id, block]));

export function getBlock(id: string): BlockDef {
  const block = blocksById.get(id);
  if (!block) throw new Error(`Bloco desconhecido: ${id}`);
  return block;
}
