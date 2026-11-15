import type { LoftRing, Primitive, Vec3 } from "../types.ts";

// Hair drawn the way a stylist thinks of it: a layer that follows the head at some thickness, from
// the crown down to a hairline that can come down in front of the ears and down the nape. It is
// worked out against the head's own surface, as the loft draws it, so the hair never grazes the
// skin and cuts into it in a ragged line: at the hairline the layer turns in and meets the head
// along a clean edge. The same hair is drawn coarse and faceted for Low poly and fine for Arcade.

/** A loft as it is drawn: its rings, how many sides it has and how many steps it takes between rings. */
export interface LoftForm {
  rings: LoftRing[];
  segments: number;
  steps: number;
}

type Ring = [number, number, number, number, number];

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t);
}

const signedPower = (value: number, power: number) => Math.sign(value) * Math.abs(value) ** power;

/** The rings the loft really draws, as `denseRings` in geometry.ts makes them. */
function drawnRings({ rings, steps }: LoftForm): Ring[] {
  const full = rings.map(([h, a, b, p = 2, o = 0]): Ring => [h, a, b, p, o]);
  const out: Ring[] = [];
  for (let i = 0; i < full.length - 1; i++) {
    const r0 = full[Math.max(i - 1, 0)];
    const r1 = full[i];
    const r2 = full[i + 1];
    const r3 = full[Math.min(i + 2, full.length - 1)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const value = (channel: number) => catmullRom(r0[channel], r1[channel], r2[channel], r3[channel], t);
      out.push([value(0), Math.max(value(1), 0.0002), Math.max(value(2), 0.0002), Math.max(value(3), 1), value(4)]);
    }
  }
  const last = full[full.length - 1];
  out.push([last[0], Math.max(last[1], 0.0002), Math.max(last[2], 0.0002), last[3], last[4]]);
  return out;
}

/** A loft as a solid that can be asked whether a point is in it and how far a ray goes through it. */
export interface Solid {
  inside(point: Vec3): boolean;
  /** How far from `from` along `dir` the last point inside is, or -1 if the ray never enters. */
  reach(from: Vec3, dir: Vec3): number;
}

export function solidOf(form: LoftForm, shift: Vec3 = [0, 0, 0]): Solid {
  return solidOfSections(
    drawnRings(form).map(([y, rx, rz, power, offset]) => ({
      y: y + shift[1],
      points: Array.from({ length: form.segments }, (_, j): [number, number] => {
        const angle = (j / form.segments) * Math.PI * 2;
        return [rx * signedPower(Math.cos(angle), 2 / power) + shift[0], rz * signedPower(Math.sin(angle), 2 / power) + offset + shift[2]];
      }),
    })),
  );
}

/**
 * A lathe as it is drawn: [radius, height] points turned round the y axis in `segments` flat sides,
 * the first corner straight ahead (+z), as THREE.LatheGeometry makes it. `at` moves it.
 */
export function latheSolid(profile: [number, number][], segments: number, at: Vec3 = [0, 0, 0]): Solid {
  return solidOfSections(
    profile.map(([radius, y]) => ({
      y: y + at[1],
      // Counterclockwise from +z, as the inside test below needs.
      points: Array.from({ length: segments }, (_, j): [number, number] => {
        const angle = Math.PI / 2 + (j / segments) * Math.PI * 2;
        const r = Math.max(radius, 0.0002);
        return [r * Math.cos(angle) + at[0], r * Math.sin(angle) + at[2]];
      }),
    })),
  );
}

/** Convex sections at heights, each joined straight to the next. */
function solidOfSections(sections: { y: number; points: [number, number][] }[]): Solid {
  const inside = ([x, y, z]: Vec3): boolean => {
    for (let i = 0; i < sections.length - 1; i++) {
      const a = sections[i];
      const b = sections[i + 1];
      const low = Math.min(a.y, b.y);
      const high = Math.max(a.y, b.y);
      if (y < low || y > high) continue;
      const t = high - low < 1e-9 ? 0 : (y - a.y) / (b.y - a.y);
      const points = a.points.map(([px, pz], j): [number, number] => [px + (b.points[j][0] - px) * t, pz + (b.points[j][1] - pz) * t]);
      let inPolygon = true;
      for (let j = 0; j < points.length && inPolygon; j++) {
        const [x0, z0] = points[j];
        const [x1, z1] = points[(j + 1) % points.length];
        if ((x1 - x0) * (z - z0) - (z1 - z0) * (x - x0) < 0) inPolygon = false;
      }
      if (inPolygon) return true;
    }
    return false;
  };
  const reach = (from: Vec3, dir: Vec3): number => {
    const step = 0.002;
    let last = -1;
    for (let r = 0; r <= 0.6; r += step) {
      if (inside([from[0] + dir[0] * r, from[1] + dir[1] * r, from[2] + dir[2] * r])) last = r;
    }
    if (last < 0) return -1;
    let low = last;
    let high = last + step;
    for (let i = 0; i < 20; i++) {
      const middle = (low + high) / 2;
      if (inside([from[0] + dir[0] * middle, from[1] + dir[1] * middle, from[2] + dir[2] * middle])) low = middle;
      else high = middle;
    }
    return low;
  };
  return { inside, reach };
}

export interface ShellSpec {
  /** The head, in its own space: the widest of the heads the hair is worn on. */
  head: Solid;
  /** The narrowest of those heads, which the hair's edge still has to reach into. */
  inner?: Solid;
  /** Head-space height of the socket the hair hangs from: it is y = 0 for the hair. */
  top: number;
  /** A point well inside the head that the hair is drawn around, in head space. */
  center: Vec3;
  /** Directions round the head, in degrees: 90 looks at the face and 270 at the nape. */
  around: number[];
  /** Rows from the crown (or from `start`) down to the hairline. */
  rows: number;
  /** Head-space height of the hairline, by degrees from the face (0) round to the nape (180). */
  hairline: (fromFace: number) => number;
  /** For hair under a hat: head-space height where it begins, by degrees from the face. */
  start?: (fromFace: number) => number;
  /** How thick the hair is, by degrees from the face and how far up, from the hairline (0) to the crown (1). */
  thickness: (fromFace: number, up: number) => number;
  /** Other hair the layer must cover where it reaches above the hairline, in head space. */
  covers?: Solid[];
  /** How far outside what it covers the layer stays. */
  margin?: number;
  /**
   * For hair under a hat: the hat's crown, in head space. Where the hair goes up into it, it is
   * pressed in to stay this far inside: `[crown, gap]`.
   */
  within?: [Solid, number];
  /** Smooth shading below this angle, in degrees, for Arcade; Low poly pieces are faceted anyway. */
  crease?: number;
}

const radians = (degrees: number) => (degrees * Math.PI) / 180;
const direction = (around: number, elevation: number): Vec3 => [
  Math.cos(radians(elevation)) * Math.cos(radians(around)),
  Math.sin(radians(elevation)),
  Math.cos(radians(elevation)) * Math.sin(radians(around)),
];

/** Degrees from the face, 0 to 180, whichever side. */
export function fromFace(around: number): number {
  const turned = (((around - 90) % 360) + 540) % 360 - 180;
  return Math.abs(turned);
}

/**
 * The hair's edge goes this far into the narrowest head, so it meets the skin along a clean line, and
 * slopes this many degrees further down onto it, so it catches light like the rest of the hair.
 */
const TUCK = 0.004;
const BEVEL = 6;

/** What the layer is drawn with: the head's surface and the hair's, seen from the center. */
function shellTools(spec: ShellSpec) {
  const { head, center, top } = spec;
  const covers = spec.covers ?? [];
  const margin = spec.margin ?? 0.004;
  const inner = spec.inner ?? head;
  const skin = (dir: Vec3) => head.reach(center, dir);
  const point = (dir: Vec3, distance: number): Vec3 => [
    center[0] + dir[0] * distance,
    center[1] + dir[1] * distance - top,
    center[2] + dir[2] * distance,
  ];
  /** The elevation, seen from the center, at which the head's surface is at a height. */
  const elevationAt = (around: number, height: number): number => {
    let low = -85;
    let high = 89.5;
    for (let i = 0; i < 40; i++) {
      const middle = (low + high) / 2;
      const dir = direction(around, middle);
      if (center[1] + dir[1] * skin(dir) < height) low = middle;
      else high = middle;
    }
    return (low + high) / 2;
  };
  const hairlineAt = (around: number) => elevationAt(around, spec.hairline(fromFace(around)));
  /** How far from the center the outside of the hair is, given where its hairline is in that direction. */
  const outside = (around: number, elevation: number, bottom: number): number => {
    const dir = direction(around, elevation);
    const up = (elevation - bottom) / (90 - bottom);
    let distance = skin(dir) + spec.thickness(fromFace(around), Math.min(Math.max(up, 0), 1));
    for (const cover of covers) {
      const reach = cover.reach(center, dir);
      if (reach > 0) distance = Math.max(distance, reach + margin);
    }
    if (spec.within) {
      // Pressed in under the hat, but never into the head.
      const [crown, gap] = spec.within;
      const reach = crown.reach(center, dir);
      if (reach > 0) distance = Math.min(distance, Math.max(reach - gap, skin(dir) + 0.001));
    }
    return distance;
  };
  const tuckedIn = (around: number, elevation: number): Vec3 => {
    const dir = direction(around, elevation);
    return point(dir, inner.reach(center, dir) - TUCK);
  };
  return { skin, point, elevationAt, hairlineAt, outside, tuckedIn };
}

/** A layer of hair over the head: free polygons, in the hair's space. */
export function hairShell(spec: ShellSpec): Primitive {
  const tools = shellTools(spec);
  const columns = spec.around.map((around) => {
    const face = fromFace(around);
    const bottom = tools.hairlineAt(around);
    return { around, face, bottom, top: spec.start ? tools.elevationAt(around, spec.start(face)) : 90 };
  });

  const vertices: Vec3[] = [];
  const faces: number[][] = [];
  const add = (vertex: Vec3) => vertices.push(vertex.map((value) => Math.round(value * 1e5) / 1e5) as Vec3) - 1;
  const outer = (column: (typeof columns)[number], elevation: number) =>
    add(tools.point(direction(column.around, elevation), tools.outside(column.around, elevation, column.bottom)));

  const rows: number[][] = [];
  if (spec.start) rows.push(columns.map((column) => add(tools.tuckedIn(column.around, column.top + BEVEL))));
  for (let k = spec.start ? 0 : 1; k <= spec.rows; k++) {
    rows.push(columns.map((column) => outer(column, column.top + ((column.bottom - column.top) * k) / spec.rows)));
  }
  rows.push(columns.map((column) => add(tools.tuckedIn(column.around, column.bottom - BEVEL))));

  const count = columns.length;
  if (!spec.start) {
    // The crown is as thick as the hair round it, whichever way it faces.
    const crownThickness = columns.reduce((sum, column) => sum + spec.thickness(column.face, 1), 0) / columns.length;
    const crown = add(tools.point([0, 1, 0], tools.skin([0, 1, 0]) + crownThickness));
    for (let j = 0; j < count; j++) faces.push([crown, rows[0][(j + 1) % count], rows[0][j]]);
  }
  for (let r = 0; r < rows.length - 1; r++) {
    for (let j = 0; j < count; j++) {
      const next = (j + 1) % count;
      faces.push([rows[r][j], rows[r][next], rows[r + 1][next]]);
      faces.push([rows[r][j], rows[r + 1][next], rows[r + 1][j]]);
    }
  }
  return { kind: "polygons", vertices, faces, crease: spec.crease ?? 50 };
}

/**
 * A spot on the outside of the hair, in the hair's space, and the way out from the head there:
 * where to sit a curl, a spike or a hair tie. `lift` moves it further out (or in, when negative).
 */
export function onHair(spec: ShellSpec, around: number, elevation: number, lift = 0): { at: Vec3; out: Vec3 } {
  const tools = shellTools(spec);
  const out = direction(around, elevation);
  const at = tools.point(out, tools.outside(around, elevation, tools.hairlineAt(around)) + lift);
  return { at: at.map((value) => Math.round(value * 1e4) / 1e4) as Vec3, out };
}

/** Euler angles, in degrees, that turn a piece's +Y to point along `dir`. */
export function pointing([x, y, z]: Vec3): Vec3 {
  const length = Math.hypot(x, y, z);
  const [dx, dy, dz] = [x / length, y / length, z / length];
  const degrees = (value: number) => Math.round(((value * 180) / Math.PI) * 10) / 10;
  return [degrees(Math.atan2(dz, dy)), 0, degrees(-Math.asin(dx))];
}

/** Smooth steps between [degrees from the face, value] marks, for hairlines and thickness. */
export function marks(points: [number, number][]): (fromFace: number) => number {
  return (at) => {
    if (at <= points[0][0]) return points[0][1];
    for (let i = 0; i < points.length - 1; i++) {
      const [a0, v0] = points[i];
      const [a1, v1] = points[i + 1];
      if (at <= a1) {
        const t = (at - a0) / (a1 - a0);
        return v0 + (v1 - v0) * t * t * (3 - 2 * t);
      }
    }
    return points[points.length - 1][1];
  };
}

/** Directions round the head for `fromFace` marks on one side, mirrored onto the other. */
export function bothSides(fromFaceMarks: number[]): number[] {
  const side = fromFaceMarks.filter((a) => a > 0 && a < 180);
  // 90 - a on one side and 90 + a on the other, sorted the way the polygons go round.
  const all = [90, ...side.map((a) => 90 - a), ...side.map((a) => 90 + a), 270];
  return [...new Set(all.map((a) => ((a % 360) + 360) % 360))].sort((x, y) => x - y);
}

/** Evenly spaced directions round the head. */
export function evenly(count: number): number[] {
  return Array.from({ length: count }, (_, i) => (i * 360) / count);
}
