import type { GeneratedShape, ShapeMaterial, Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import { centerFootprint } from "./realHouse";
import { Rng } from "./rng";
import { MeshBuilder } from "./terrain";

// The Realista building, one mesh per tower, in the three kinds a Brazilian street has:
// - residential: wide sliding windows with split air conditioners under some of them, stacked
//   balconies, a lobby under a concrete canopy (or shops, in a mixed building) and the water tank
//   over the stair core on the roof;
// - old: a downtown building of a few floors with tall windows in mouldings, a string course at
//   each floor, corner pilasters, a crown cornice and shops with rolling shutters and awnings;
// - office: glass bands or a curtain wall over a granite-clad ground floor.
// Each window shows the sky, blinds, curtains or a dark room, so a facade is never one repeated
// picture. A city has dozens of these, so every window is only a few faces.

const PARAPET = 1.1;
const REVEAL = 0.14;
const BALCONY = 1.2;

const enum M {
  Wall,
  Glass,
  Frame,
  Concrete,
  Roof,
  Awning,
  Base,
  Metal,
  Shopfront,
  Blinds,
  Curtain,
  Dark,
  Shutter,
  Trim,
  Railing,
  Unit,
  Sign,
}

type Kind = "residential" | "old" | "office";
/** From u0 to u1 along a side and y0 to y1 high, and how deep its sides go when not the usual. */
type Hole = [number, number, number, number, number?];
type Axes = [Vec3, Vec3, Vec3];

interface Side {
  start: Vec3;
  along: Vec3;
  out: Vec3;
  length: number;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const UP: Vec3 = [0, 1, 0];
const DOWN: Vec3 = [0, -1, 0];
/** A point on a side: `u` along it, `y` up, and `depth` into the wall (negative: out of it). */
const at = (side: Side, u: number, y: number, depth = 0): Vec3 => add(add(side.start, times(side.along, u)), add([0, y, 0], times(side.out, -depth)));
const axesOf = (side: Side): Axes => [side.along, UP, side.out];

class Builder {
  readonly mesh = new MeshBuilder();

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, outward: Vec3, material: M): void {
    this.mesh.wall(a, b, c, d, outward, material);
  }

  box(center: Vec3, [ax, ay, az]: Axes, [hx, hy, hz]: [number, number, number], material: M): void {
    const corner = (sx: number, sy: number, sz: number) => add(center, add(times(ax, sx * hx), add(times(ay, sy * hy), times(az, sz * hz))));
    for (const s of [-1, 1]) {
      this.quad(corner(s, -1, -1), corner(s, 1, -1), corner(s, 1, 1), corner(s, -1, 1), times(ax, s), material);
      this.quad(corner(-1, s, -1), corner(1, s, -1), corner(1, s, 1), corner(-1, s, 1), times(ay, s), material);
      this.quad(corner(-1, -1, s), corner(1, -1, s), corner(1, 1, s), corner(-1, 1, s), times(az, s), material);
    }
  }

  /** A box against a side: from u0 to u1 along it, y0 to y1 high, and `back` to `front` meters out of the wall. */
  block(side: Side, u0: number, u1: number, y0: number, y1: number, back: number, front: number, material: M): void {
    this.box(at(side, (u0 + u1) / 2, (y0 + y1) / 2, -(back + front) / 2), axesOf(side), [(u1 - u0) / 2, (y1 - y0) / 2, (front - back) / 2], material);
  }

  /** A wall face between two heights with rectangular holes, and the sides of each hole `depth` into the wall. */
  cut(side: Side, bottom: number, top: number, holes: Hole[], wall: M, depth = REVEAL): void {
    const us = [...new Set([0, side.length, ...holes.flatMap(([u0, u1]) => [u0, u1])])].sort((p, q) => p - q);
    const ys = [...new Set([bottom, top, ...holes.flatMap(([, , y0, y1]) => [y0, y1])])].sort((p, q) => p - q);
    for (let i = 0; i + 1 < us.length; i++) {
      for (let j = 0; j + 1 < ys.length; j++) {
        const mu = (us[i] + us[i + 1]) / 2;
        const my = (ys[j] + ys[j + 1]) / 2;
        if (holes.some(([u0, u1, y0, y1]) => mu > u0 && mu < u1 && my > y0 && my < y1)) continue;
        this.quad(at(side, us[i], ys[j]), at(side, us[i + 1], ys[j]), at(side, us[i + 1], ys[j + 1]), at(side, us[i], ys[j + 1]), side.out, wall);
      }
    }
    for (const [u0, u1, y0, y1, own] of holes) {
      const d = own ?? depth;
      this.quad(at(side, u0, y0), at(side, u0, y1), at(side, u0, y1, d), at(side, u0, y0, d), side.along, wall);
      this.quad(at(side, u1, y0), at(side, u1, y1), at(side, u1, y1, d), at(side, u1, y0, d), times(side.along, -1), wall);
      this.quad(at(side, u0, y1), at(side, u1, y1), at(side, u1, y1, d), at(side, u0, y1, d), DOWN, wall);
      this.quad(at(side, u0, y0), at(side, u1, y0), at(side, u1, y0, d), at(side, u0, y0, d), UP, wall);
    }
  }

  /**
   * What fills a hole at the back of its reveal: a frame around the opening, the glass a little
   * further in, and mullions (and a transom, at that fraction of the height) dividing the panes.
   */
  window(side: Side, [u0, u1, y0, y1, own]: Hole, fill: M, frame: M, mullions = 1, transom = 0): void {
    const depth = own ?? REVEAL;
    const f = 0.055;
    const glass = depth + 0.04;
    const outer: [number, number][] = [[u0, y0], [u1, y0], [u1, y1], [u0, y1]];
    const inner: [number, number][] = [[u0 + f, y0 + f], [u1 - f, y0 + f], [u1 - f, y1 - f], [u0 + f, y1 - f]];
    const facing: Vec3[] = [UP, times(side.along, -1), DOWN, side.along];
    const p = ([u, y]: [number, number], d: number) => at(side, u, y, d);
    for (let i = 0; i < 4; i++) {
      const j = (i + 1) % 4;
      this.quad(p(outer[i], depth), p(outer[j], depth), p(inner[j], depth), p(inner[i], depth), side.out, frame);
      this.quad(p(inner[i], depth), p(inner[j], depth), p(inner[j], glass), p(inner[i], glass), facing[i], frame);
    }
    this.quad(p(inner[0], glass), p(inner[1], glass), p(inner[2], glass), p(inner[3], glass), side.out, fill);
    const axes = axesOf(side);
    const middle = (depth + glass) / 2;
    const half = (glass - depth) / 2;
    for (let k = 1; k <= mullions; k++) {
      this.box(at(side, u0 + (k * (u1 - u0)) / (mullions + 1), (y0 + y1) / 2, middle), axes, [0.03, (y1 - y0) / 2 - f, half], frame);
    }
    if (transom > 0) this.box(at(side, (u0 + u1) / 2, y0 + transom * (y1 - y0), middle), axes, [(u1 - u0) / 2 - f, 0.03, half], frame);
  }

  /** A fabric awning over an opening, sloping down and out, with its sides and a hanging edge. */
  awning(side: Side, u0: number, u1: number, y: number, reach: number, material: M): void {
    const drop = reach * 0.5;
    const back = (u: number) => at(side, u, y, 0);
    const front = (u: number, h = 0) => at(side, u, y - drop - h, -reach);
    this.quad(back(u0), back(u1), front(u1), front(u0), add(UP, side.out), material);
    this.quad(back(u0), back(u1), front(u1), front(u0), add(DOWN, times(side.out, -1)), material);
    this.quad(front(u0), front(u1), front(u1, 0.25), front(u0, 0.25), side.out, material);
    this.quad(front(u0), front(u1), front(u1, 0.25), front(u0, 0.25), times(side.out, -1), material);
    for (const [u, toward] of [[u0, -1], [u1, 1]] as const) {
      this.mesh.wall(back(u), front(u), front(u, 0.25), front(u, 0.25), times(side.along, toward), material);
      this.mesh.wall(back(u), front(u, 0.25), front(u), front(u), times(side.along, -toward), material);
    }
  }
}

/** Bays of about `pitch` meters across a side, as their centers. */
const bays = (length: number, pitch: number) => {
  const count = Math.max(1, Math.round(length / pitch));
  return Array.from({ length: count }, (_, k) => ((k + 0.5) * length) / count);
};

export interface RealTowerOptions {
  position?: Vec3;
  yawSteps?: number;
  floors: number;
  /** Footprint it has to fit, in meters. */
  lot?: [number, number];
}

/** Plaster colors seen on real buildings, for when nobody picked one. */
export const REAL_TOWER_COLORS = ["#e6e1d6", "#ddd3bf", "#e3d3b4", "#d0d4d4", "#e0c9b4", "#cfd5cb", "#d9c6a5", "#cccbc6", "#c99a7c", "#e5d49a", "#b8c4cc"];

/** Towers a city repeats: a few designs at a few heights, recolored and turned. */
const CITY_TOWERS = 6;
const CITY_FLOORS = [2, 3, 4, 6, 8, 11, 14];

export function buildRealTower(asm: Assembler, rng: Rng, color: string, options: RealTowerOptions): void {
  const place = (block: string) => asm.add(block, options.position ?? [0, 0, 0], { color, yawSteps: options.yawSteps });
  if (options.lot) {
    const variant = rng.fork("variant").int(0, CITY_TOWERS - 1);
    const floors = CITY_FLOORS.reduce((best, value) => (Math.abs(value - options.floors) < Math.abs(best - options.floors) ? value : best));
    place(asm.sharedShape(`predio ${variant} ${floors} ${options.lot.join(" ")}`, () => towerShape(new Rng(variant * 7919 + floors), color, { ...options, floors })));
    return;
  }
  place(asm.addShape(towerShape(rng, color, options)));
}

interface Plan {
  kind: Kind;
  floors: number;
  ground: number;
  storey: number;
  top: number;
  /** Shops on the street instead of a lobby, for residential buildings. */
  shops: boolean;
}

function towerShape(rng: Rng, color: string, options: RealTowerOptions): GeneratedShape {
  const { floors } = options;
  const kind: Kind = rng.fork("kind").pick(
    floors <= 6 ? ["old", "old", "residential"] : floors <= 9 ? ["residential", "residential", "office", "old"] : ["residential", "residential", "office"],
  );
  const ground = kind === "residential" ? 4.0 : 4.6;
  const storey = kind === "old" ? 3.5 : kind === "office" ? 3.4 : 2.95;
  const plan: Plan = { kind, floors, ground, storey, top: ground + floors * storey, shops: kind !== "office" && (kind === "old" || rng.fork("shops").chance(0.4)) };

  const balconies = kind === "residential";
  const lotWidth = (options.lot?.[0] ?? Infinity) - 0.6;
  const lotDepth = (options.lot?.[1] ?? Infinity) - 0.6 - (balconies ? 2 * BALCONY : 0);
  const width = Math.min(rng.fork("width").range(11, 17), lotWidth);
  const depth = Math.max(6, Math.min(rng.fork("depth").range(10, 15), lotDepth));
  const hx = width / 2;
  const hz = depth / 2;
  const sides: Side[] = [
    { start: [-hx, 0, hz], along: [1, 0, 0], out: [0, 0, 1], length: width },
    { start: [hx, 0, hz], along: [0, 0, -1], out: [1, 0, 0], length: depth },
    { start: [hx, 0, -hz], along: [-1, 0, 0], out: [0, 0, -1], length: width },
    { start: [-hx, 0, -hz], along: [0, 0, 1], out: [-1, 0, 0], length: depth },
  ];

  const b = new Builder();
  const panes = rng.fork("panes");
  const fill = (): M =>
    // Office glass is one tint with a slightly darker pane here and there, as real curtain walls are.
    kind === "office" ? (panes.chance(0.15) ? M.Shopfront : M.Glass) : panes.pick([M.Glass, M.Glass, M.Glass, M.Blinds, M.Blinds, M.Curtain, M.Curtain, M.Dark]);
  const units = rng.fork("units");
  const bands = kind === "residential" && rng.fork("bands").chance(0.5);
  const pitch = kind === "old" ? rng.fork("bay").range(2.3, 2.8) : rng.fork("bay").range(2.8, 3.3);

  sides.forEach((side, index) => {
    groundFloor(b, side, index, plan, rng.fork(`ground ${index}`));
    if (kind === "office") officeFloors(b, side, plan, rng.fork("facade").chance(0.5), fill);
    else {
      const centers = bays(side.length, pitch);
      const bay = side.length / centers.length;
      // Balconies stack on the front and the back, over a run of bays in the middle.
      const run = balconies && index % 2 === 0 && bay >= 2.6 ? Math.max(1, Math.round(centers.length * rng.fork("run").range(0.5, 1))) : 0;
      const first = Math.floor((centers.length - run) / 2);
      const onBalcony = (k: number) => k >= first && k < first + run;
      const holes: Hole[] = [];
      for (let floor = 0; floor < floors; floor++) {
        const y = ground + floor * storey;
        centers.forEach((u, k) => {
          if (onBalcony(k)) {
            const hole: Hole = [u - Math.min(1.15, bay / 2 - 0.2), u + Math.min(1.15, bay / 2 - 0.2), y + 0.05, y + 2.25];
            holes.push(hole);
            b.window(side, hole, fill(), M.Frame, 1);
            return;
          }
          // Narrow sides of residential buildings get a small bathroom window every other bay.
          const small = kind === "residential" && index % 2 === 1 && k % 2 === 1;
          const half = small ? 0.35 : kind === "old" ? 0.55 : Math.min(0.85, bay / 2 - 0.35);
          const hole: Hole =
            kind === "old" ? [u - half, u + half, y + 0.55, y + 2.75] : small ? [u - half, u + half, y + 1.6, y + 2.2] : [u - half, u + half, y + 1.0, y + 2.2];
          holes.push(hole);
          b.window(side, hole, small ? M.Blinds : fill(), M.Frame, small ? 0 : 1, kind === "old" ? 0.72 : 0);
          const [u0, u1, y0, y1] = hole;
          // The sill, and for old buildings a moulding around the window and a small cornice over it.
          b.block(side, u0 - 0.06, u1 + 0.06, y0 - 0.05, y0, -REVEAL, 0.06, M.Concrete);
          if (kind === "old") {
            b.block(side, u0 - 0.14, u0, y0, y1, 0, 0.05, M.Trim);
            b.block(side, u1, u1 + 0.14, y0, y1, 0, 0.05, M.Trim);
            b.block(side, u0 - 0.24, u1 + 0.24, y1, y1 + 0.2, 0, 0.12, M.Trim);
          }
          if (!small && units.chance(0.15)) {
            const offset = units.range(-0.25, 0.25);
            const c = (u0 + u1) / 2 + offset;
            b.block(side, c - 0.42, c + 0.42, y0 - 0.85, y0 - 0.3, 0.04, 0.34, M.Unit);
            // The fan grille on its front.
            b.quad(at(side, c - 0.3, y0 - 0.78, -0.345), at(side, c + 0.18, y0 - 0.78, -0.345), at(side, c + 0.18, y0 - 0.37, -0.345), at(side, c - 0.3, y0 - 0.37, -0.345), side.out, M.Dark);
          }
        });
        if (bands) b.block(side, -0.03, side.length + 0.03, y - 0.1, y + 0.1, 0, 0.03, M.Trim);
        if (kind === "old" && floor > 0) b.block(side, -0.06, side.length + 0.06, y + 0.38, y + 0.5, 0, 0.06, M.Trim);
        if (run > 0) balcony(b, side, centers[first] - bay / 2 + 0.12, centers[first + run - 1] + bay / 2 - 0.12, y, rng.fork("railing").chance(0.5));
      }
      b.cut(side, ground, plan.top, holes, M.Wall);
      if (kind === "old") {
        for (const [u0, u1] of [[-0.06, 0.45], [side.length - 0.45, side.length + 0.06]]) b.block(side, u0, u1, ground, plan.top, 0, 0.06, M.Trim);
        b.block(side, -0.2, side.length + 0.2, plan.top - 0.55, plan.top - 0.3, 0, 0.14, M.Trim);
        b.block(side, -0.36, side.length + 0.36, plan.top - 0.3, plan.top, 0, 0.32, M.Trim);
      }
    }
    // The slab edge over the ground floor.
    b.block(side, -0.06, side.length + 0.06, ground - 0.14, ground + 0.12, 0, 0.06, kind === "old" ? M.Trim : M.Concrete);
    // The parapet, with a coping on top.
    const top = plan.top;
    b.quad(at(side, 0, top), at(side, side.length, top), at(side, side.length, top + PARAPET), at(side, 0, top + PARAPET), side.out, kind === "office" ? M.Concrete : M.Wall);
    b.block(side, -0.05, side.length + 0.05, top + PARAPET, top + PARAPET + 0.08, -0.25, 0.05, M.Concrete);
    b.quad(at(side, side.length, top + 0.05, 0.25), at(side, 0, top + 0.05, 0.25), at(side, 0, top + PARAPET, 0.25), at(side, side.length, top + PARAPET, 0.25), times(side.out, -1), M.Concrete);
  });

  roof(b, rng.fork("roof"), plan, hx, hz);
  centerFootprint(b.mesh.vertices);

  const frames: ShapeMaterial[] =
    kind === "old"
      ? [{ color: "#ecebe6" }, { color: "#3b3631" }, { color: "#33402f" }]
      : [{ color: "#c4c8cb", finish: "metal" }, { color: "#ededeb", finish: "gloss" }, { color: "#2a2c2f", finish: "metal" }];
  const walls: ShapeMaterial[] =
    kind === "old"
      ? [{ texture: "plaster" }, { texture: "plaster" }, { texture: "brick_red", color: "#ffffff" }, { texture: "brick_old", color: "#ffffff" }]
      : kind === "office"
        ? [{ texture: "plaster_smooth", color: "#dedcd6" }, { color: "#c3c7ca", finish: "metal" }]
        : [{ texture: "plaster" }, { texture: "plaster" }, { texture: "plaster_smooth" }];
  const materials: ShapeMaterial[] = [
    rng.fork("wall").pick(walls),
    { color: "#7f909c", finish: "glass" },
    rng.fork("frames").pick(frames),
    // The concrete texture is a dark, yellowish concrete: light trims are painted plaster instead.
    { texture: "plaster_smooth", color: "#d6d4cd" },
    { texture: "roof_flat", color: "#ffffff" },
    { texture: "cotton", color: rng.fork("awning").pick(["#8b3a33", "#2f4d6b", "#3e5b3f", "#8a6a3a", "#55595e"]) },
    { color: kind === "office" ? "#8b8781" : "#5f5d5a", finish: "gloss" },
    { color: "#8a9096", finish: "metal" },
    { color: "#56656e", finish: "glass" },
    { color: "#bdb6a8", finish: "gloss" },
    { color: rng.fork("curtains").pick(["#b49a7c", "#9c8b78", "#c2b49b"]), finish: "gloss" },
    { color: "#2b3036", finish: "gloss" },
    { color: "#a3a7a9", finish: "metal" },
    { texture: "plaster_smooth", color: kind === "old" ? "#ece6da" : "#f1efea" },
    { color: "#6f828c", finish: "glass" },
    { color: "#cfd0cc" },
    { color: rng.fork("sign").pick(["#1f3b5c", "#7a1f24", "#22442e", "#2b2b2b", "#c47a1c", "#d9d4c6"]) },
  ];
  return {
    name: "Prédio",
    color,
    vertices: b.mesh.vertices,
    faces: b.mesh.faces,
    faceMaterials: b.mesh.faceMaterials,
    materials,
    smoothAngle: 0,
    sockets: [],
  };
}

/** A balcony on one floor, from u0 to u1: its slab, and a railing of glass or a low wall. */
function balcony(b: Builder, side: Side, u0: number, u1: number, y: number, glass: boolean): void {
  b.block(side, u0, u1, y - 0.15, y + 0.05, 0, BALCONY, M.Trim);
  const rail = 1.05;
  if (glass) {
    b.block(side, u0 + 0.03, u1 - 0.03, y + 0.1, y + rail - 0.05, BALCONY - 0.07, BALCONY - 0.05, M.Railing);
    b.block(side, u0 + 0.02, u0 + 0.04, y + 0.1, y + rail - 0.05, 0, BALCONY - 0.07, M.Railing);
    b.block(side, u1 - 0.04, u1 - 0.02, y + 0.1, y + rail - 0.05, 0, BALCONY - 0.07, M.Railing);
    const posts = Math.max(2, Math.round((u1 - u0) / 1.4) + 1);
    for (let k = 0; k < posts; k++) {
      const u = u0 + 0.04 + (k * (u1 - u0 - 0.08)) / (posts - 1);
      b.block(side, u - 0.025, u + 0.025, y + 0.05, y + rail, BALCONY - 0.09, BALCONY - 0.03, M.Metal);
    }
    b.block(side, u0, u1, y + rail, y + rail + 0.05, BALCONY - 0.09, BALCONY - 0.01, M.Metal);
    b.block(side, u0, u0 + 0.05, y + rail, y + rail + 0.05, 0, BALCONY - 0.09, M.Metal);
    b.block(side, u1 - 0.05, u1, y + rail, y + rail + 0.05, 0, BALCONY - 0.09, M.Metal);
  } else {
    b.block(side, u0, u1, y + 0.05, y + rail, BALCONY - 0.12, BALCONY, M.Wall);
    b.block(side, u0, u0 + 0.12, y + 0.05, y + rail, 0, BALCONY - 0.12, M.Wall);
    b.block(side, u1 - 0.12, u1, y + 0.05, y + rail, 0, BALCONY - 0.12, M.Wall);
    b.block(side, u0 - 0.02, u1 + 0.02, y + rail, y + rail + 0.06, BALCONY - 0.15, BALCONY + 0.02, M.Trim);
  }
}

/** Office floors: glass bands between concrete spandrels, or a curtain wall of vision glass and dark spandrels. */
function officeFloors(b: Builder, side: Side, plan: Plan, curtain: boolean, fill: () => M): void {
  const { ground, storey, floors, top } = plan;
  const axes = axesOf(side);
  const mullions = Math.max(1, Math.round(side.length / 1.5));
  if (curtain) {
    for (let floor = 0; floor < floors; floor++) {
      const y = ground + floor * storey;
      b.quad(at(side, 0, y), at(side, side.length, y), at(side, side.length, y + 0.9), at(side, 0, y + 0.9), side.out, M.Dark);
      for (let k = 0; k < mullions; k++) {
        const u0 = (k * side.length) / mullions;
        const u1 = ((k + 1) * side.length) / mullions;
        b.quad(at(side, u0, y + 0.9), at(side, u1, y + 0.9), at(side, u1, y + storey), at(side, u0, y + storey), side.out, fill());
      }
      b.box(at(side, side.length / 2, y + 0.9, -0.05), axes, [side.length / 2, 0.04, 0.05], M.Frame);
      b.box(at(side, side.length / 2, y, -0.05), axes, [side.length / 2, 0.05, 0.05], M.Frame);
    }
    for (let k = 0; k <= mullions; k++) b.box(at(side, (k * side.length) / mullions, (ground + top) / 2, -0.06), axes, [0.04, (top - ground) / 2, 0.06], M.Frame);
    return;
  }
  const holes: Hole[] = [];
  for (let floor = 0; floor < floors; floor++) {
    const y = ground + floor * storey;
    const hole: Hole = [0.45, side.length - 0.45, y + 0.95, y + 2.65, 0.25];
    holes.push(hole);
    b.window(side, hole, fill(), M.Frame, Math.max(1, Math.round((side.length - 0.9) / 1.5)) - 1);
  }
  b.cut(side, ground, top, holes, M.Wall, 0.25);
}

/** The street floor: shops, a lobby with its canopy, or an office entrance hall. */
function groundFloor(b: Builder, side: Side, index: number, plan: Plan, rng: Rng): void {
  const { kind, ground } = plan;
  const holes: Hole[] = [];
  const back = index === 2;
  const wall = kind === "old" ? M.Wall : M.Base;
  if (back) {
    // The back: a service door and a few high windows.
    const door: Hole = [1.0, 2.0, 0, 2.2, 0.1];
    holes.push(door);
    b.window(side, door, M.Shutter, M.Metal, 0);
    for (const u of bays(side.length, 3.5).filter((u) => u > 3)) {
      const hole: Hole = [u - 0.5, u + 0.5, 2.2, 3.0];
      holes.push(hole);
      b.window(side, hole, M.Dark, M.Frame, 0);
    }
  } else if (kind === "office") {
    if (index === 0) {
      const hall: Hole = [0.8, side.length - 0.8, 0, ground - 0.6, 0.3];
      holes.push(hall);
      b.window(side, hall, M.Shopfront, M.Frame, Math.max(2, Math.round(side.length / 1.8)), 0.75);
      b.block(side, 0.4, side.length - 0.4, ground - 0.55, ground - 0.4, 0, 1.4, M.Metal);
    } else {
      const band: Hole = [0.6, side.length - 0.6, 1.0, ground - 0.8, 0.2];
      holes.push(band);
      b.window(side, band, M.Shopfront, M.Frame, Math.max(1, Math.round(side.length / 1.8)));
    }
  } else if (plan.shops) {
    for (const u of bays(side.length, 4.0)) {
      const state = rng.pick(["open", "open", "half", "closed"]);
      const hole: Hole = [u - 1.6, u + 1.6, 0, ground - 1.0, state === "closed" ? 0.1 : 0.16];
      holes.push(hole);
      const [u0, u1, , y1] = hole;
      if (state === "closed") {
        b.window(side, hole, M.Shutter, M.Metal, 0);
      } else {
        b.window(side, hole, M.Shopfront, M.Frame, 2, 0.78);
        if (state === "half") b.block(side, u0, u1, y1 - 0.45 * y1, y1, -0.1, -0.08, M.Shutter);
      }
      // The rolled shutter's box over the opening.
      b.block(side, u0, u1, y1 - 0.25, y1, -0.08, 0, M.Metal);
      if (rng.chance(0.5)) b.awning(side, u0 - 0.05, u1 + 0.05, y1 + 0.35, 1.0, M.Awning);
      else b.block(side, u0, u1, y1 + 0.15, y1 + 0.75, 0, 0.08, M.Sign);
    }
  } else if (index === 0) {
    // The residential lobby under a concrete canopy, and the garage gate beside it.
    const middle = side.length / 2;
    const lobby: Hole = [middle - 1.3, middle + 1.3, 0, 2.7, 0.2];
    holes.push(lobby);
    b.window(side, lobby, M.Shopfront, M.Frame, 1, 0.8);
    b.block(side, middle - 2.2, middle + 2.2, 2.95, 3.15, 0, 1.5, M.Concrete);
    if (side.length > 10) {
      const gate: Hole = [side.length - 3.8, side.length - 0.8, 0, 2.5, 0.12];
      holes.push(gate);
      b.window(side, gate, M.Shutter, M.Metal, 0);
    }
  } else {
    for (const u of bays(side.length, 3.5)) {
      const hole: Hole = [u - 0.6, u + 0.6, 2.0, 3.0];
      holes.push(hole);
      b.window(side, hole, M.Dark, M.Frame, 1);
    }
  }
  b.cut(side, 0, ground, holes, wall);
  // A granite plinth along old walls.
  if (kind === "old") {
    let from = 0;
    for (const [u0, u1, y0] of [...holes].sort((p, q) => p[0] - q[0])) {
      if (y0 > 0) continue;
      if (u0 > from) b.block(side, from, u0, 0, 0.5, 0, 0.03, M.Base);
      from = u1;
    }
    if (from < side.length) b.block(side, from, side.length, 0, 0.5, 0, 0.03, M.Base);
  }
}

/** The roof: its surface, the stair core with the water tank over it, and machines and antennas. */
function roof(b: Builder, rng: Rng, plan: Plan, hx: number, hz: number): void {
  const { top, kind, floors } = plan;
  const axes: Axes = [[1, 0, 0], UP, [0, 0, 1]];
  b.quad([-hx + 0.25, top + 0.05, -hz + 0.25], [hx - 0.25, top + 0.05, -hz + 0.25], [hx - 0.25, top + 0.05, hz - 0.25], [-hx + 0.25, top + 0.05, hz - 0.25], UP, M.Roof);
  const cx = rng.range(-Math.max(0, hx - 3), Math.max(0, hx - 3));
  const cz = rng.range(-Math.max(0, hz - 3), Math.max(0, hz - 3));
  if (floors >= 6) {
    // Elevator machines and stairs, with the water tank on top.
    b.box([cx, top + 1.35, cz], axes, [1.5, 1.3, 1.2], M.Wall);
    b.box([cx, top + 3.25, cz], axes, [1.7, 0.6, 1.4], M.Concrete);
    b.quad([cx - 0.45, top + 0.05, cz + 1.21], [cx + 0.45, top + 0.05, cz + 1.21], [cx + 0.45, top + 2.15, cz + 1.21], [cx - 0.45, top + 2.15, cz + 1.21], [0, 0, 1], M.Frame);
  } else {
    b.box([cx, top + 0.65, cz], axes, [1.1, 0.6, 0.9], M.Concrete);
  }
  if (kind === "office") {
    for (let k = 0; k < 4; k++) b.box([-hx + 1.4 + k * 1.3, top + 0.55, hz - 1.4], axes, [0.5, 0.5, 0.45], M.Unit);
  }
  const antennas = kind === "office" ? 1 : rng.int(0, 2);
  for (let k = 0; k < antennas; k++) {
    const x = rng.range(-hx + 1, hx - 1);
    const z = rng.range(-hz + 1, hz - 1);
    b.box([x, top + 1.3, z], axes, [0.025, 1.25, 0.025], M.Metal);
    b.box([x, top + 2.1, z], axes, [0.5, 0.02, 0.02], M.Metal);
  }
}
