import type { BlockDef, LoftRing, ShapePiece, SocketDef, Vec3 } from "../../types.ts";
import { block, loft, socket, torus, tube } from "../helpers.ts";

// Shared tools of the Arcade family: glossy paint split into three colors, chrome, thick
// fenders and big wheels. Models are made of up to four blocks stacked on the same origin, so
// each color can change on its own: base (fixed colors), paint, trim and accent.

export type Options = Omit<ShapePiece, "shape">;

export const CHROME: Options = { color: "#dfe3e8", finish: "metal" };
export const STEEL: Options = { color: "#8d939c", finish: "metal" };
export const DARK_METAL: Options = { color: "#2a2d33", finish: "metal" };
export const CARBON: Options = { color: "#191b20", finish: "gloss" };
export const RUBBER: Options = { color: "#1d1e22" };
export const SEAT: Options = { color: "#23252b" };
export const GLASS: Options = { color: "#1d3346", finish: "glass" };
export const LIGHT: Options = { color: "#fff2c8", finish: "glow" };
export const TAIL: Options = { color: "#e02634", finish: "glow" };
export const AMBER: Options = { color: "#ffb020", finish: "glow" };
export const WHITE: Options = { color: "#f4f4f0" };

export interface Slots {
  base: ShapePiece[];
  paint?: ShapePiece[];
  trim?: ShapePiece[];
  accent?: ShapePiece[];
}

export const PAINT_COLOR = "#e8202a";
export const TRIM_COLOR = "#f4f4f4";
export const ACCENT_COLOR = "#ffc400";

const GROUND = [socket("ground", [0, 0, 0], [0, -1, 0])];

const glossy = (pieces: ShapePiece[]) => pieces.map((piece) => ({ finish: "gloss" as const, ...piece }));

/** One model as up to four blocks. Sockets go on the base, which is always present. */
export function family(
  id: string,
  name: string,
  category: string,
  slots: Slots,
  sockets: SocketDef[],
  extra: Pick<BlockDef, "ground" | "upright" | "snap"> = {},
  colors: { paint?: string; trim?: string; accent?: string } = {},
): BlockDef[] {
  const make = (suffix: string, label: string, color: string, pieces: ShapePiece[], own: SocketDef[]) =>
    block(`ar.${id}_${suffix}`, label, category, color, { kind: "compound", pieces }, own, extra);
  const parts = [make("base", name, "#2a2d33", slots.base, sockets)];
  if (slots.paint?.length) parts.push(make("paint", `${name}: pintura`, colors.paint ?? PAINT_COLOR, glossy(slots.paint), GROUND));
  if (slots.trim?.length) parts.push(make("trim", `${name}: faixas`, colors.trim ?? TRIM_COLOR, glossy(slots.trim), GROUND));
  if (slots.accent?.length) parts.push(make("accent", `${name}: detalhes`, colors.accent ?? ACCENT_COLOR, glossy(slots.accent), GROUND));
  return parts;
}

/** A section across a vehicle: position along Z, half width, top, bottom and squareness. */
export type Section = [number, number, number, number, number?];

/** A smooth body through sections listed from back to front. */
export function hull(sections: Section[], options: Options & { segments?: number; steps?: number } = {}): ShapePiece {
  return loft(
    sections.map(([z, halfWidth, top, bottom, square = 3]): LoftRing => [z, halfWidth, (top - bottom) / 2, square, (top + bottom) / 2]),
    { axis: "z", segments: 28, steps: 3, ...options },
  );
}

const catmull = (a: number, b: number, c: number, d: number, t: number) =>
  0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);

/** One section of a body at a position along its length, following the same curve as the surface. */
function sectionAt(sections: Section[], z: number): { top: number; halfWidth: number; square: number } {
  for (let i = 0; i < sections.length - 1; i++) {
    const [z1, w1, t1, , p1 = 3] = sections[i];
    const [z2, w2, t2] = sections[i + 1];
    if (z < z1 || z > z2) continue;
    const before = sections[Math.max(i - 1, 0)];
    const after = sections[Math.min(i + 2, sections.length - 1)];
    // The surface curves its position along the length too, so z has to be solved for.
    let low = 0;
    let high = 1;
    for (let step = 0; step < 24; step++) {
      const middle = (low + high) / 2;
      if (catmull(before[0], z1, z2, after[0], middle) < z) low = middle;
      else high = middle;
    }
    const t = (low + high) / 2;
    return { top: catmull(before[2], t1, t2, after[2], t), halfWidth: catmull(before[1], w1, w2, after[1], t), square: p1 };
  }
  const last = sections[sections.length - 1];
  return { top: last[2], halfWidth: last[1], square: last[4] ?? 3 };
}

/** Where the top of a body is at a position along its length. */
export const topAt = (sections: Section[], z: number) => sectionAt(sections, z).top;

/** A flat strip lying on top of a body, from z0 to z1, at sideways position x. */
export function strip(sections: Section[], z0: number, z1: number, x: number, halfWidth: number, options: Options = {}, lift = 0.012): ShapePiece {
  const stations = 14;
  const rings = Array.from({ length: stations + 1 }, (_, index): Section => {
    const z = z0 + ((z1 - z0) * index) / stations;
    const { top, halfWidth: half, square } = sectionAt(sections, z);
    // Away from the middle the surface falls off, following the rounded section.
    const drop = (1 - (Math.abs(x) / Math.max(half, 0.001)) ** square) ** (1 / square);
    const center = sections[0][3];
    const height = (top - center) * Math.min(drop, 1) + center + lift;
    return [z, halfWidth, height, height - 0.022, 6];
  });
  return hull(rings, { at: [x, 0, 0], segments: 8, steps: 1, ...options });
}

/** A curved plate over a wheel, in the plane x. Angles run from the front (0) to the back (180). */
export function fender(x: number, y: number, z: number, radius: number, width: number, from = 16, to = 164, options: Options = {}): ShapePiece {
  const thickness = 0.022;
  const path: Vec3[] = [];
  const points = 9;
  for (let i = 0; i < points; i++) {
    const angle = ((from + ((to - from) * i) / (points - 1)) * Math.PI) / 180;
    path.push([x, y + Math.sin(angle) * radius, z + Math.cos(angle) * radius]);
  }
  return tube(path, [thickness, thickness], { flat: width / (2 * thickness), radial: 12, steps: 3, ...options });
}

/** The dark trim under a fender, so its edge reads against the paint. */
export const fenderEdge = (x: number, y: number, z: number, radius: number, width: number, from = 16, to = 164) =>
  fender(x, y, z, radius - 0.03, width + 0.012, from, to, CARBON);

/** A ring in the plane z, for bezels and headlight frames. */
export const ringZ = (radius: number, thickness: number, at: Vec3, options: Options = CHROME) =>
  torus(radius, thickness, { at, ...options });

/** A ring in the plane x, facing the side. */
export const ringX = (radius: number, thickness: number, at: Vec3, options: Options = CHROME) =>
  torus(radius, thickness, { at, rot: [0, 90, 0], ...options });

/** Applies `build` to both sides of the model, where +1 is the left. */
export const sides = (build: (side: 1 | -1) => ShapePiece[]): ShapePiece[] => [...build(1), ...build(-1)];

/** Radial copies around the wheel axle, which is the Y axis. */
export const around = (count: number, build: (angle: number, sin: number, cos: number, index: number) => ShapePiece[], phase = 0): ShapePiece[] =>
  Array.from({ length: count }, (_, index) => {
    const angle = phase + (index / count) * 360;
    const radians = (angle * Math.PI) / 180;
    return build(angle, Math.sin(radians), Math.cos(radians), index);
  }).flat();
