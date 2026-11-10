import type {
  BlockDef,
  BlockShape,
  BodyDeform,
  Bump,
  LoftRing,
  Point,
  Primitive,
  ShapePiece,
  SocketDef,
  Vec3,
} from "../types.ts";

export type PieceOptions = Omit<ShapePiece, "shape">;

const piece = (shape: Primitive, options: PieceOptions = {}): ShapePiece => ({ shape, ...options });

export const box = (size: Vec3, options?: PieceOptions) => piece({ kind: "box", size }, options);
export const roundedBox = (size: Vec3, radius: number, options?: PieceOptions) =>
  piece({ kind: "roundedBox", size, radius }, options);
export const cylinder = (
  radiusTop: number,
  radiusBottom: number,
  height: number,
  segments: number,
  options?: PieceOptions,
) => piece({ kind: "cylinder", radiusTop, radiusBottom, height, segments }, options);
export const sphere = (radius: number, options?: PieceOptions) =>
  piece({ kind: "sphere", radius }, options);
export const capsule = (radius: number, length: number, options?: PieceOptions) =>
  piece({ kind: "capsule", radius, length }, options);
export const icosahedron = (radius: number, detail: number, options?: PieceOptions) =>
  piece({ kind: "icosahedron", radius, detail }, options);
export const lumpy = (
  radius: number,
  seed: number,
  options: PieceOptions & { detail?: number; amount?: number; frequency?: number } = {},
) => {
  const { detail = 8, amount = 0.09, frequency, ...rest } = options;
  return piece(
    { kind: "lumpy", radius, detail, amount, seed, ...(frequency === undefined ? {} : { frequency }) },
    rest,
  );
};
export const loft = (
  rings: LoftRing[],
  options: PieceOptions & { axis?: "y" | "z"; bumps?: Bump[]; segments?: number; steps?: number } = {},
) => {
  const { axis, bumps, segments, steps, ...rest } = options;
  return piece(
    {
      kind: "loft",
      rings,
      ...(axis ? { axis } : {}),
      ...(bumps ? { bumps } : {}),
      ...(segments ? { segments } : {}),
      ...(steps ? { steps } : {}),
    },
    rest,
  );
};
export const tube = (
  path: Vec3[],
  radius: number[],
  options: PieceOptions & { radial?: number; steps?: number; flat?: number } = {},
) => {
  const { radial, steps, flat, ...rest } = options;
  return piece(
    {
      kind: "tube",
      path,
      radius,
      ...(radial ? { radial } : {}),
      ...(steps ? { steps } : {}),
      ...(flat ? { flat } : {}),
    },
    rest,
  );
};
export const torus = (radius: number, tube: number, options?: PieceOptions & { arc?: number }) => {
  const { arc, ...rest } = options ?? {};
  return piece({ kind: "torus", radius, tube, ...(arc === undefined ? {} : { arc }) }, rest);
};
export const lathe = (profile: Point[], options?: PieceOptions, segments = 36) =>
  piece({ kind: "lathe", profile, segments }, options);
export const extrude = (
  points: Point[],
  depth: number,
  bevel: number,
  options: PieceOptions & { bevelSteps?: number; deform?: BodyDeform } = {},
) => {
  const { bevelSteps, deform, ...rest } = options;
  return piece(
    { kind: "extrude", points, depth, bevel, ...(bevelSteps ? { bevelSteps } : {}), ...(deform ? { deform } : {}) },
    rest,
  );
};
export const slab = (points: Point[], height: number, options?: PieceOptions) =>
  piece({ kind: "slab", points, height }, options);

export const compound = (...pieces: (ShapePiece | ShapePiece[])[]): BlockShape => ({
  kind: "compound",
  pieces: pieces.flat(),
});

const round = (value: number) => Math.round(value * 10000) / 10000;

export function socket(id: string, p: Vec3, n: Vec3): SocketDef {
  const length = Math.hypot(...n);
  return { id, p: p.map(round) as Vec3, n: n.map((v) => round(v / length)) as Vec3 };
}

/** Face sockets for a box, with `bottom` first so the block rests on what it touches. */
export function boxSockets([w, h, d]: Vec3, center: Vec3 = [0, 0, 0]): SocketDef[] {
  const [x, y, z] = center;
  return [
    socket("bottom", [x, y - h / 2, z], [0, -1, 0]),
    socket("top", [x, y + h / 2, z], [0, 1, 0]),
    socket("left", [x - w / 2, y, z], [-1, 0, 0]),
    socket("right", [x + w / 2, y, z], [1, 0, 0]),
    socket("front", [x, y, z + d / 2], [0, 0, 1]),
    socket("back", [x, y, z - d / 2], [0, 0, -1]),
  ];
}

export function block(
  id: string,
  name: string,
  category: string,
  color: string,
  shape: BlockShape | Primitive,
  sockets: SocketDef[],
  extra: Pick<BlockDef, "ground" | "upright" | "snap"> = {},
): BlockDef {
  return { id, name, category, color, shape, sockets, ...extra };
}

/** Points along a circle. Angles are in degrees and both ends are included. */
export function arc(
  cx: number,
  cy: number,
  radius: number,
  from: number,
  to: number,
  steps: number,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = ((from + ((to - from) * i) / steps) * Math.PI) / 180;
    points.push([cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)]);
  }
  return points;
}

/** A ring sector as a floor outline, for road and track curves. */
export function sector(
  cx: number,
  cz: number,
  inner: number,
  outer: number,
  from: number,
  to: number,
  steps: number,
): Point[] {
  return [...arc(cx, cz, outer, from, to, steps), ...arc(cx, cz, inner, to, from, steps)];
}

/** Rounds the corners of an open line while keeping its two ends. */
export function smoothLine(points: Point[], iterations = 2): Point[] {
  let line = points;
  for (let n = 0; n < iterations; n++) {
    const next: Point[] = [line[0]];
    for (let i = 0; i < line.length - 1; i++) {
      const [ax, ay] = line[i];
      const [bx, by] = line[i + 1];
      next.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25]);
      next.push([ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
    }
    next.push(line[line.length - 1]);
    line = next;
  }
  return line;
}

export function rect(minX: number, minZ: number, maxX: number, maxZ: number): Point[] {
  return [
    [minX, minZ],
    [maxX, minZ],
    [maxX, maxZ],
    [minX, maxZ],
  ];
}
