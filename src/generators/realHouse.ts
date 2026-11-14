import type { GeneratedShape, ShapeMaterial, Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import { Rng } from "./rng";
import { MeshBuilder } from "./terrain";

// The Realista house: one mesh with the depth real houses have. Windows sit back in the wall with
// frames and stone sills, the roof has thickness and overhang with gutters, and the walls stand on
// a plinth. Every surface is a photographed texture at its real size.

const PLINTH = 0.45;
const STOREY = 2.8;
const OVERHANG = 0.5;
const ROOF_THICKNESS = 0.18;
/** How far windows and the door sit back from the face of the wall. */
const REVEAL = 0.16;
const WINDOW_WIDTH = 1.2;
const WINDOW_HEIGHT = 1.35;
const SILL_HEIGHT = 0.95;
const DOOR_WIDTH = 1.0;
const DOOR_HEIGHT = 2.15;
const FRAME = 0.07;

const enum M {
  Wall,
  Plinth,
  Roof,
  Trim,
  Glass,
  Sill,
  Door,
  Metal,
  Chimney,
  Steps,
}

/** Roof colors of the house options, as the texture and tint that look like them. */
const ROOF_LOOKS: Record<string, ShapeMaterial> = {
  "#a64b35": { texture: "roof_clay", color: "#ffffff" },
  "#6d4c41": { texture: "roof_clay", color: "#b89a8c" },
  "#54606e": { texture: "roof_slate", color: "#c4cad2" },
  "#3f6b52": { texture: "roof_grey", color: "#a9c4b0" },
};

type Axes = [Vec3, Vec3, Vec3];

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const UP: Vec3 = [0, 1, 0];

class Builder {
  readonly mesh = new MeshBuilder();

  quad(a: Vec3, b: Vec3, c: Vec3, d: Vec3, outward: Vec3, material: M): void {
    this.mesh.wall(a, b, c, d, outward, material);
  }

  /** A box from its center and half sizes along three perpendicular axes. */
  box(center: Vec3, [ax, ay, az]: Axes, [hx, hy, hz]: [number, number, number], material: M): void {
    const corner = (sx: number, sy: number, sz: number) => add(center, add(times(ax, sx * hx), add(times(ay, sy * hy), times(az, sz * hz))));
    for (const s of [-1, 1]) {
      this.quad(corner(s, -1, -1), corner(s, 1, -1), corner(s, 1, 1), corner(s, -1, 1), times(ax, s), material);
      this.quad(corner(-1, s, -1), corner(1, s, -1), corner(1, s, 1), corner(-1, s, 1), times(ay, s), material);
      this.quad(corner(-1, -1, s), corner(1, -1, s), corner(1, 1, s), corner(-1, 1, s), times(az, s), material);
    }
  }
}

interface Opening {
  u0: number;
  u1: number;
  y0: number;
  y1: number;
  door: boolean;
}

/** One outside wall: `start` is its left end seen from outside, `along` runs to the right. */
interface Wall {
  start: Vec3;
  along: Vec3;
  out: Vec3;
  length: number;
}

const point = (wall: Wall, u: number, y: number, depth = 0): Vec3 => add(add(wall.start, times(wall.along, u)), add([0, y, 0], times(wall.out, -depth)));

/** The face of a wall cut around its openings, one rectangle per cell between their edges. */
function wallFace(b: Builder, wall: Wall, bottom: number, top: number, openings: Opening[]): void {
  const us = [...new Set([0, wall.length, ...openings.flatMap((o) => [o.u0, o.u1])])].sort((p, q) => p - q);
  const ys = [...new Set([bottom, top, ...openings.flatMap((o) => [o.y0, o.y1]).filter((y) => y > bottom && y < top)])].sort((p, q) => p - q);
  for (let i = 0; i + 1 < us.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      const mu = (us[i] + us[i + 1]) / 2;
      const my = (ys[j] + ys[j + 1]) / 2;
      if (openings.some((o) => mu > o.u0 && mu < o.u1 && my > o.y0 && my < o.y1)) continue;
      b.quad(point(wall, us[i], ys[j]), point(wall, us[i + 1], ys[j]), point(wall, us[i + 1], ys[j + 1]), point(wall, us[i], ys[j + 1]), wall.out, M.Wall);
    }
  }
}

function opening(b: Builder, wall: Wall, o: Opening, rng: Rng): void {
  const { u0, u1, y0, y1 } = o;
  const along = wall.along;
  const back = times(along, -1);
  // The sides of the hole, from the face of the wall back to the window.
  b.quad(point(wall, u0, y0), point(wall, u0, y1), point(wall, u0, y1, REVEAL), point(wall, u0, y0, REVEAL), along, M.Wall);
  b.quad(point(wall, u1, y0), point(wall, u1, y1), point(wall, u1, y1, REVEAL), point(wall, u1, y0, REVEAL), back, M.Wall);
  b.quad(point(wall, u0, y1), point(wall, u1, y1), point(wall, u1, y1, REVEAL), point(wall, u0, y1, REVEAL), [0, -1, 0], M.Wall);
  if (!o.door) b.quad(point(wall, u0, y0), point(wall, u1, y0), point(wall, u1, y0, REVEAL), point(wall, u0, y0, REVEAL), UP, M.Wall);

  const axes: Axes = [along, UP, wall.out];
  const mid = (u0 + u1) / 2;
  const width = u1 - u0;
  const height = y1 - y0;
  const frameAt = (u: number, y: number) => point(wall, u, y, REVEAL - 0.03);
  const frame = (u: number, y: number, hu: number, hy: number) => b.box(frameAt(u, y), axes, [hu, hy, 0.035], M.Trim);

  if (o.door) {
    frame(u0 + FRAME / 2, y0 + height / 2, FRAME / 2, height / 2);
    frame(u1 - FRAME / 2, y0 + height / 2, FRAME / 2, height / 2);
    frame(mid, y1 - FRAME / 2, width / 2, FRAME / 2);
    b.box(point(wall, mid, y0 + (height - FRAME) / 2, REVEAL - 0.01), axes, [width / 2 - FRAME, (height - FRAME) / 2, 0.025], M.Door);
    b.box(point(wall, u1 - FRAME - 0.12, y0 + 1.0, REVEAL - 0.06), axes, [0.06, 0.012, 0.02], M.Metal);
    // A small canopy keeps the rain off the door.
    b.box(point(wall, mid, y1 + 0.32, -0.42), axes, [width / 2 + 0.35, 0.05, 0.45], M.Trim);
    return;
  }

  frame(u0 + FRAME / 2, y0 + height / 2, FRAME / 2, height / 2);
  frame(u1 - FRAME / 2, y0 + height / 2, FRAME / 2, height / 2);
  frame(mid, y1 - FRAME / 2, width / 2, FRAME / 2);
  frame(mid, y0 + FRAME / 2, width / 2, FRAME / 2);
  // Two sashes, and a top light on taller windows.
  frame(mid, y0 + height / 2, 0.025, height / 2 - FRAME);
  if (height > 1.2 && rng.chance(0.6)) frame(mid, y1 - height * 0.28, width / 2 - FRAME, 0.025);
  b.quad(point(wall, u0, y0, REVEAL), point(wall, u1, y0, REVEAL), point(wall, u1, y1, REVEAL), point(wall, u0, y1, REVEAL), wall.out, M.Glass);
  // A stone sill that sticks out past the wall so rain drips clear of it.
  b.box(point(wall, mid, y0 - 0.03, (REVEAL - 0.05) / 2), axes, [width / 2 + 0.06, 0.03, (REVEAL + 0.05) / 2], M.Sill);
}

/** Window spots along a wall, evenly spread with room left at the corners. */
function spots(length: number, spacing: number): number[] {
  const count = Math.max(1, Math.floor((length - 0.8) / spacing));
  return Array.from({ length: count }, (_, k) => ((k + 0.5) * length) / count);
}

export interface RealHouseOptions {
  position?: Vec3;
  yawSteps?: number;
  size?: string;
  /** Width along the street and depth of the lot it has to fit, in meters. */
  lot?: [number, number];
}

/** Moves a mesh so its footprint is centered on the origin. */
export function centerFootprint(vertices: Vec3[]): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of vertices) {
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z);
    maxZ = Math.max(maxZ, z);
  }
  const dx = (minX + maxX) / 2;
  const dz = (minZ + maxZ) / 2;
  for (const vertex of vertices) {
    vertex[0] -= dx;
    vertex[2] -= dz;
  }
}

/** Houses a city repeats, recolored and turned, so its meshes stay few. */
const CITY_HOUSES = 8;

export function buildRealHouse(asm: Assembler, rng: Rng, wallColor: string, roofColor: string, options: RealHouseOptions): void {
  const place = (block: string) => asm.add(block, options.position ?? [0, 0, 0], { color: wallColor, yawSteps: options.yawSteps });
  if (options.lot) {
    const variant = rng.fork("variant").int(0, CITY_HOUSES - 1);
    // Clay most of the time, as on real streets; the mossy green roof only when someone picks it.
    const roofs = ["#a64b35", "#6d4c41", "#a64b35", "#54606e"];
    place(asm.sharedShape(`casa ${variant} ${options.lot.join(" ")}`, () => houseShape(new Rng(variant * 977 + 13), wallColor, roofs[variant % roofs.length], options)));
    return;
  }
  place(asm.addShape(houseShape(rng, wallColor, roofColor, options)));
}

function houseShape(rng: Rng, wallColor: string, roofColor: string, options: RealHouseOptions): GeneratedShape {
  const large = options.size === "large" || (options.size !== "small" && rng.fork("floors").chance(0.45));
  const floors = large ? 2 : 1;
  // On a lot, the eaves, gutters and front steps have to fit too.
  const width = Math.min(rng.fork("width").range(large ? 9 : 7.2, large ? 11.5 : 9), (options.lot?.[0] ?? Infinity) - 2 * OVERHANG - 0.2);
  const depth = Math.min(rng.fork("depth").range(large ? 7.4 : 6.2, large ? 9 : 7.6), (options.lot?.[1] ?? Infinity) - OVERHANG - 1.6);
  const wallTop = PLINTH + floors * STOREY + 0.15;
  const pitch = (rng.fork("pitch").range(28, 38) * Math.PI) / 180;
  const hip = rng.fork("roof kind").chance(0.4);
  const brick = rng.fork("brick").chance(0.3);
  const b = new Builder();

  const hx = width / 2;
  const hz = depth / 2;
  const walls: Wall[] = [
    { start: [-hx, 0, hz], along: [1, 0, 0], out: [0, 0, 1], length: width },
    { start: [hx, 0, hz], along: [0, 0, -1], out: [1, 0, 0], length: depth },
    { start: [hx, 0, -hz], along: [-1, 0, 0], out: [0, 0, -1], length: width },
    { start: [-hx, 0, -hz], along: [0, 0, 1], out: [-1, 0, 0], length: depth },
  ];

  // Openings: the door on the front, windows on every side and floor, upper ones over lower ones.
  const frontSpots = spots(width, 2.5);
  const doorIndex = frontSpots.length === 1 ? -1 : rng.fork("door").int(0, frontSpots.length - 1);
  const doorU = doorIndex < 0 ? width * 0.3 : frontSpots[doorIndex];
  walls.forEach((wall, side) => {
    const openings: Opening[] = [];
    const along = side % 2 === 0 ? (side === 0 ? frontSpots : spots(width, 2.7)) : spots(depth, 2.9);
    for (let floor = 0; floor < floors; floor++) {
      const level = PLINTH + floor * STOREY;
      for (const [index, u] of along.entries()) {
        if (side === 0 && floor === 0 && (index === doorIndex || (doorIndex < 0 && Math.abs(u - doorU) < 1.4))) continue;
        const half = (side % 2 === 1 && wall.length < 7 ? 1.0 : WINDOW_WIDTH) / 2;
        openings.push({ u0: u - half, u1: u + half, y0: level + SILL_HEIGHT, y1: level + SILL_HEIGHT + WINDOW_HEIGHT, door: false });
      }
    }
    if (side === 0) openings.push({ u0: doorU - DOOR_WIDTH / 2, u1: doorU + DOOR_WIDTH / 2, y0: PLINTH, y1: PLINTH + DOOR_HEIGHT, door: true });
    wallFace(b, wall, PLINTH, wallTop, openings);
    for (const item of openings) opening(b, wall, item, rng.fork(`opening ${side} ${item.u0}`));
    // A band between the floors of a two-storey house.
    if (floors === 2) b.box(point(wall, wall.length / 2, PLINTH + STOREY + 0.05, -0.025), [wall.along, UP, wall.out], [wall.length / 2 + 0.025, 0.07, 0.025], M.Trim);
  });

  // The plinth, a little proud of the walls, and the steps up to the door.
  b.box([0, PLINTH / 2, 0], [[1, 0, 0], UP, [0, 0, 1]], [hx + 0.03, PLINTH / 2, hz + 0.03], M.Plinth);
  b.box([-hx + doorU, PLINTH / 2, hz + 0.55], [[1, 0, 0], UP, [0, 0, 1]], [0.95, PLINTH / 2, 0.52], M.Steps);
  b.box([-hx + doorU, PLINTH / 4, hz + 1.22], [[1, 0, 0], UP, [0, 0, 1]], [0.95, PLINTH / 4, 0.16], M.Steps);

  const tan = Math.tan(pitch);
  const lift = ROOF_THICKNESS / Math.cos(pitch);
  const eaveY = wallTop - OVERHANG * tan;
  const X = hx + OVERHANG;
  const Z = hz + OVERHANG;
  const ridgeY = wallTop + hz * tan;

  if (hip) {
    const ridge = Math.max(X - Z, 0);
    const top = (p: Vec3): Vec3 => [p[0], p[1] + lift, p[2]];
    const front = [[-X, eaveY, Z], [X, eaveY, Z], [ridge, ridgeY, 0], [-ridge, ridgeY, 0]] as Vec3[];
    for (const s of [1, -1]) {
      const [a, bb, c, d] = front.map(([x, y, z]) => [x, y, z * s] as Vec3);
      b.quad(top(a), top(bb), top(c), top(d), [0, Math.cos(pitch), s * Math.sin(pitch)], M.Roof);
      b.quad(top([s * X, eaveY, -Z]), top([s * X, eaveY, Z]), top([s * ridge, ridgeY, 0]), top([s * ridge, ridgeY, 0]), [s * Math.sin(pitch), Math.cos(pitch), 0], M.Roof);
    }
    // Under the eaves: a flat soffit from the wall out to a fascia board all around.
    const ring: [Vec3, Vec3, Vec3, Vec3][] = [
      [[-X, eaveY, Z], [X, eaveY, Z], [hx, eaveY, hz], [-hx, eaveY, hz]],
      [[X, eaveY, Z], [X, eaveY, -Z], [hx, eaveY, -hz], [hx, eaveY, hz]],
      [[X, eaveY, -Z], [-X, eaveY, -Z], [-hx, eaveY, -hz], [hx, eaveY, -hz]],
      [[-X, eaveY, -Z], [-X, eaveY, Z], [-hx, eaveY, hz], [-hx, eaveY, -hz]],
    ];
    for (const [a, bb, c, d] of ring) b.quad(a, bb, c, d, [0, -1, 0], M.Trim);
    const fascia = (a: Vec3, bb: Vec3, out: Vec3) => b.quad(a, bb, top(bb), top(a), out, M.Trim);
    fascia([-X, eaveY, Z], [X, eaveY, Z], [0, 0, 1]);
    fascia([X, eaveY, -Z], [-X, eaveY, -Z], [0, 0, -1]);
    fascia([X, eaveY, Z], [X, eaveY, -Z], [1, 0, 0]);
    fascia([-X, eaveY, -Z], [-X, eaveY, Z], [-1, 0, 0]);
    for (const s of [1, -1]) {
      b.box([0, eaveY - 0.05, s * (Z + 0.06)], [[1, 0, 0], UP, [0, 0, 1]], [X + 0.06, 0.06, 0.06], M.Metal);
      b.box([s * (X + 0.06), eaveY - 0.05, 0], [[1, 0, 0], UP, [0, 0, 1]], [0.06, 0.06, Z], M.Metal);
    }
  } else {
    const roofY = (z: number) => wallTop + (hz - Math.abs(z)) * tan;
    for (const s of [1, -1]) {
      const eave = s * Z;
      const out: Vec3 = [0, Math.cos(pitch), s * Math.sin(pitch)];
      const under: Vec3 = [0, -Math.cos(pitch), -s * Math.sin(pitch)];
      const low = roofY(eave);
      b.quad([-X, low + lift, eave], [X, low + lift, eave], [X, ridgeY + lift, 0], [-X, ridgeY + lift, 0], out, M.Roof);
      b.quad([-X, low, eave], [X, low, eave], [X, ridgeY, 0], [-X, ridgeY, 0], under, M.Trim);
      b.quad([-X, low, eave], [X, low, eave], [X, low + lift, eave], [-X, low + lift, eave], [0, 0, s], M.Trim);
      for (const x of [-X, X]) b.quad([x, low, eave], [x, low + lift, eave], [x, ridgeY + lift, 0], [x, ridgeY, 0], [Math.sign(x), 0, 0], M.Trim);
      b.box([0, low - 0.05, s * (Z + 0.06)], [[1, 0, 0], UP, [0, 0, 1]], [X, 0.06, 0.06], M.Metal);
      // The gable: the end walls rise to the roof.
      const gable = walls[s > 0 ? 1 : 3];
      const xs = s > 0 ? hx : -hx;
      b.quad([xs, wallTop, -hz], [xs, wallTop, hz], [xs, ridgeY, 0], [xs, ridgeY, 0], gable.out, M.Wall);
    }
    b.box([0, ridgeY + lift + 0.04, 0], [[1, 0, 0], UP, [0, 0, 1]], [X, 0.06, 0.13], M.Roof);
  }

  // Downpipes at the four corners.
  for (const [x, z] of [[hx, hz], [-hx, hz], [hx, -hz], [-hx, -hz]] as const) {
    b.box([x - Math.sign(x) * 0.2, (eaveY - 0.05) / 2, z + Math.sign(z) * 0.07], [[1, 0, 0], UP, [0, 0, 1]], [0.045, (eaveY - 0.05) / 2, 0.045], M.Metal);
  }

  // A brick chimney through the roof.
  if (rng.fork("chimney").chance(0.75)) {
    const cx = hx * rng.fork("chimney x").range(-0.6, 0.6);
    const cz = -hz * 0.35;
    const height = ridgeY + 0.9 - wallTop;
    b.box([cx, wallTop + height / 2, cz], [[1, 0, 0], UP, [0, 0, 1]], [0.32, height / 2, 0.32], M.Chimney);
    b.box([cx, wallTop + height + 0.04, cz], [[1, 0, 0], UP, [0, 0, 1]], [0.38, 0.05, 0.38], M.Plinth);
  }

  centerFootprint(b.mesh.vertices);
  const materials: ShapeMaterial[] = [
    brick ? { texture: "brick_red", color: "#ffffff" } : { texture: "plaster" },
    { texture: "plaster", color: "#9b9c98" },
    ROOF_LOOKS[roofColor] ?? ROOF_LOOKS["#a64b35"],
    { color: "#f1efe9" },
    { color: "#4c5a66", finish: "glass" },
    { texture: "plaster_smooth", color: "#e9e6df" },
    { texture: "wood_dark", color: "#b39a8a" },
    { color: "#8c9196", finish: "metal" },
    { texture: "brick_red", color: "#ffffff" },
    { texture: "sidewalk", color: "#ffffff" },
  ];
  return {
    name: "Casa",
    color: wallColor,
    vertices: b.mesh.vertices,
    faces: b.mesh.faces,
    faceMaterials: b.mesh.faceMaterials,
    materials,
    smoothAngle: 0,
    sockets: [],
  };
}
