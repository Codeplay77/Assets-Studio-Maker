import type { BlockDef, BlockShape, Primitive, ShapePiece } from "../types.ts";

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
    shape: { kind: "compound", pieces: piecesOf(block.shape).map(shiny) },
  };
}
