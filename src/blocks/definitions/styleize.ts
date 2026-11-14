import { TILING_SURFACES } from "../surfaces.ts";
import type { BlockDef, BlockShape, Primitive, ShapePiece } from "../types.ts";

const TONES: Record<string, string | undefined> = Object.fromEntries(TILING_SURFACES.map((surface) => [surface.id, surface.tone]));

/**
 * Arcade streets keep the paint they had before Realista got textures. Null follows the part's
 * color, as their asphalt always did.
 */
const ARCADE_PAINT: Record<string, string | null> = { asphalt: null, sidewalk: "#aeb3ba", concrete: "#8d9299", grass: "#4f9a4a" };

/**
 * Textures belong to Realista: other styles paint the piece instead, in `paint` or else in the
 * texture's average color.
 */
export function withoutSurface(piece: ShapePiece, paint: Record<string, string | null> = {}): ShapePiece {
  if (!piece.surface) return piece;
  const { surface, color: _white, ...rest } = piece;
  if (piece.color !== "#ffffff") return { ...rest, ...(piece.color ? { color: piece.color } : {}) };
  const color = surface in paint ? paint[surface] : TONES[surface];
  return color ? { ...rest, color } : rest;
}

// Makes the Arcade version of blocks drawn in another style, so they only have to be designed once.

function piecesOf(shape: BlockShape): ShapePiece[] {
  return shape.kind === "compound" ? shape.pieces : [{ shape }];
}

function smoothPiece(piece: ShapePiece): ShapePiece {
  const { shape, faceted: _faceted, ...rest } = piece;
  const out = (next: Primitive): ShapePiece => ({ ...rest, shape: next });
  switch (shape.kind) {
    case "loft":
      return out({ ...shape, segments: 24, steps: 3 });
    case "tube":
      return out({ ...shape, radial: 12, steps: 4 });
    case "icosahedron":
      return out({ kind: "sphere", radius: shape.radius });
    case "cylinder":
      return out({ ...shape, segments: 24 });
    case "lathe":
      return out({ ...shape, segments: 28 });
    case "extrude":
      return out({ ...shape, bevel: shape.bevel || 0.004, bevelSteps: 2 });
    default:
      return out(shape);
  }
}

const shiny = (piece: ShapePiece): ShapePiece => (piece.finish || piece.color ? piece : { ...piece, finish: "gloss" });

/** An Arcade version of a low poly block: same shapes, smoothed and glossy. */
export function arcadeFromLowPoly(block: BlockDef): BlockDef {
  return {
    ...block,
    id: `ar.${block.id.slice(block.id.indexOf(".") + 1)}`,
    shape: { kind: "compound", pieces: piecesOf(block.shape).map(smoothPiece).map(shiny) },
  };
}

/** An Arcade version of one of the editor's realistic blocks: same shape, glossy paint. */
export function arcadeFromRealistic(block: BlockDef): BlockDef {
  return {
    ...block,
    id: `ar.${block.id.replace(".", "_")}`,
    shape: { kind: "compound", pieces: piecesOf(block.shape).map((piece) => withoutSurface(piece, ARCADE_PAINT)).map(shiny) },
  };
}
