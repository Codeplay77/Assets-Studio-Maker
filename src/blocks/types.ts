export type Vec3 = [number, number, number];
export type Point = [number, number];

/** Position along the axis, half width, half depth, squareness (2 = ellipse), sideways offset. */
export type LoftRing = [number, number, number, number?, number?];

export interface Bump {
  at: Vec3;
  radius: number;
  /** Positive pushes the surface out and negative dents it. */
  height: number;
  stretch?: Vec3;
}

/** Narrows extruded parts so a car body curves instead of being a flat slab. */
export interface BodyDeform {
  barrel: number;
  center: number;
  span: number;
  plan: number;
  length: number;
  taper?: number;
  taperFrom?: number;
  taperTo?: number;
}

export type Finish = "matte" | "gloss" | "metal" | "glass" | "glow";

export type Primitive =
  | { kind: "box"; size: Vec3 }
  | { kind: "roundedBox"; size: Vec3; radius: number }
  | { kind: "wedge"; size: Vec3 }
  | { kind: "frustum"; bottom: Point; top: Point; height: number }
  | { kind: "cylinder"; radiusTop: number; radiusBottom: number; height: number; segments: number }
  | { kind: "sphere"; radius: number }
  | { kind: "dome"; radius: number }
  | { kind: "capsule"; radius: number; length: number }
  /** Smooth surface through cross-sections, with optional sculpted bumps. */
  | { kind: "loft"; rings: LoftRing[]; axis?: "y" | "z"; segments?: number; steps?: number; bumps?: Bump[] }
  /** A smooth curved tube whose radius varies along the path. `flat` squashes it into a ribbon. */
  | { kind: "tube"; path: Vec3[]; radius: number[]; radial?: number; steps?: number; flat?: number }
  /** An irregular ball, for rocks and foliage. */
  | { kind: "lumpy"; radius: number; detail: number; amount: number; seed: number; frequency?: number }
  /** An imported model, stored in the model pack (see scripts/import-models.ts). */
  | { kind: "model"; model: string; offset: number; vertices: number; min: Vec3; max: Vec3 }
  | { kind: "icosahedron"; radius: number; detail?: number }
  | { kind: "dodecahedron"; radius: number }
  | { kind: "torus"; radius: number; tube: number; arc?: number }
  /** Revolves [radius, y] points, listed from bottom to top, around Y. */
  | { kind: "lathe"; profile: Point[]; segments: number }
  /** A [z, y] side profile extruded across X, centered. */
  | { kind: "extrude"; points: Point[]; depth: number; bevel?: number; bevelSteps?: number; deform?: BodyDeform }
  /** An [x, z] floor outline extruded upward from y = 0. */
  | { kind: "slab"; points: Point[]; height: number }
  /** Free polygons, from a shape made in the editor. `crease` is in degrees. */
  | { kind: "polygons"; vertices: Vec3[]; faces: number[][]; crease: number };

export interface ShapePiece {
  shape: Primitive;
  at?: Vec3;
  /** XYZ Euler angles in degrees. */
  rot?: Vec3;
  scale?: Vec3;
  /** A fixed color. Without it, the piece follows the part's color. */
  color?: string;
  /** Darkens a piece that follows the part's color. */
  shade?: number;
  finish?: Finish;
}

export type BlockShape = Primitive | { kind: "compound"; pieces: ShapePiece[] };

export interface SocketDef {
  id: string;
  /** Position relative to the block's origin. */
  p: Vec3;
  /** Outward direction of the attachment point. */
  n: Vec3;
}

export interface BlockDef {
  id: string;
  name: string;
  category: string;
  color: string;
  shape: BlockShape;
  /** The first socket is the one the block uses to attach to others. */
  sockets: SocketDef[];
  /** Always placed on the ground, ignoring other blocks (road tiles, for example). */
  ground?: boolean;
  /** Only rests on upward-facing surfaces, so a car never ends up stuck to a wall. */
  upright?: boolean;
  /** Placement grid, when it differs from the default. */
  snap?: number;
}

export interface BlockCategory {
  id: string;
  name: string;
  /** `parts` are the editor's own blocks and `library` the ready-made CC0 models. */
  group: "parts" | "library";
}
