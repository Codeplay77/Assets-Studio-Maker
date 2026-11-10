import type { Rng } from "./rng";

/** A spot on the ground: [x, z]. */
export type Point = [number, number];

const plus = (a: Point, b: Point): Point => [a[0] + b[0], a[1] + b[1]];
const minus = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const times = (a: Point, k: number): Point => [a[0] * k, a[1] * k];
const dot = (a: Point, b: Point) => a[0] * b[0] + a[1] * b[1];
const cross = (a: Point, b: Point) => a[0] * b[1] - a[1] * b[0];
const size = (a: Point) => Math.hypot(a[0], a[1]);
const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const turned = ([x, z]: Point, angle: number): Point => [x * Math.cos(angle) - z * Math.sin(angle), x * Math.sin(angle) + z * Math.cos(angle)];
const blend = (a: Point, b: Point, t: number) => plus(a, times(minus(b, a), t));

export const unit = (a: Point): Point => times(a, 1 / (size(a) || 1));
/** A quarter turn. It points into a polygon whose corners run counterclockwise. */
export const inward = ([x, z]: Point): Point => [-z, x];

/** Less of a turn than this is a street bending, not a corner. */
const STRAIGHT_ENOUGH = 0.35;
const NARROWEST_CORNER = (38 * Math.PI) / 180;
const CUT_ATTEMPTS = 24;
/** A new street this close to one on the other side lines up with it and makes a crossing. */
const LINE_UP = 9;
/** Two junctions closer than this, without lining up, would leave a street too short to use. */
const STAGGER = 14;
const CURVE_PIECES = 6;
const SMALLEST_SIDE = 0.3;

export class Polyline {
  /** Distance from the start at each point. */
  readonly marks: number[] = [0];

  constructor(readonly points: Point[]) {
    for (let i = 1; i < points.length; i++) this.marks.push(this.marks[i - 1] + size(minus(points[i], points[i - 1])));
  }

  get total(): number {
    return this.marks[this.marks.length - 1];
  }

  at(distance: number): { point: Point; heading: Point } {
    const spot = clamp(distance, 0, this.total);
    let i = 0;
    while (i < this.marks.length - 2 && this.marks[i + 1] < spot) i++;
    const heading = unit(minus(this.points[i + 1], this.points[i]));
    return { point: plus(this.points[i], times(heading, spot - this.marks[i])), heading };
  }

  /** How far along the line its closest spot to `point` is. */
  locate(point: Point): number {
    let best = 0;
    let closest = Infinity;
    for (let i = 0; i < this.points.length - 1; i++) {
      const step = minus(this.points[i + 1], this.points[i]);
      const t = clamp(dot(minus(point, this.points[i]), step) / (dot(step, step) || 1), 0, 1);
      const away = size(minus(point, plus(this.points[i], times(step, t))));
      if (away < closest) {
        closest = away;
        best = this.marks[i] + t * size(step);
      }
    }
    return best;
  }
}

export interface Join {
  /** Distance along the street where another one arrives. */
  at: number;
  /** Half the width of the one arriving. */
  half: number;
}

export class Street extends Polyline {
  readonly joins: Join[] = [];
  /** Half the width of whatever this street runs into at each end. */
  readonly ends: [number, number] = [0, 0];

  constructor(points: Point[], readonly half: number, readonly avenue: boolean) {
    super(points);
  }
}

/** The side from this corner to the next one runs along `street`. */
export interface Corner {
  point: Point;
  street: Street;
}

/** Counterclockwise, along the middle of the streets around it. */
export type Block = Corner[];

export interface PlanSettings {
  width: number;
  length: number;
  /** The size a block tends to have, street to street. */
  blockArea: number;
  streetHalf: number;
  avenueHalf: number;
  sidewalk: number;
  lotDepth: number;
  /** How far a street may lean, in radians, and the first ones, which cross the whole city. */
  skew: number;
  firstSkew: number;
  bendChance: number;
  /** How far a curved street strays from a straight line, in meters. */
  bow: number;
  /** How much of its size the edge of the city may lose at each corner. */
  wander: number;
  diagonal: boolean;
  /** Streets land on multiples of this. Zero leaves them free. */
  snap: number;
}

export interface StreetPlan {
  streets: Street[];
  blocks: Block[];
  outline: Point[];
}

export function polygonArea(points: Point[]): number {
  let twice = 0;
  points.forEach((point, i) => {
    twice += cross(point, points[(i + 1) % points.length]);
  });
  return twice / 2;
}

export function contains(points: Point[], [x, z]: Point): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, zi] = points[i];
    const [xj, zj] = points[j];
    if (zi > z !== zj > z && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const ab = minus(b, a);
  const cd = minus(d, c);
  const side1 = cross(ab, minus(c, a));
  const side2 = cross(ab, minus(d, a));
  const side3 = cross(cd, minus(a, c));
  const side4 = cross(cd, minus(b, c));
  return side1 * side2 < 0 && side3 * side4 < 0;
}

export function isSimple(points: Point[]): boolean {
  const n = points.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(points[i], points[(i + 1) % n], points[j], points[(j + 1) % n])) return false;
    }
  }
  return true;
}

/** Moves each side in by its own amount. A negative amount moves it out. */
export function offsetPolygon(points: Point[], amounts: number[]): Point[] {
  let sides = points.map((from, i) => ({ from, heading: unit(minus(points[(i + 1) % points.length], from)), amount: amounts[i] }));
  for (;;) {
    const corners = sides.map((side, i) => {
      const previous = sides[(i + sides.length - 1) % sides.length];
      const first = plus(side.from, times(inward(previous.heading), previous.amount));
      const second = plus(side.from, times(inward(side.heading), side.amount));
      const denominator = cross(previous.heading, side.heading);
      if (Math.abs(denominator) < 0.05) return blend(first, second, 0.5);
      return plus(first, times(previous.heading, cross(minus(second, first), side.heading) / denominator));
    });
    if (sides.length <= 3) return corners;
    // A side shorter than the move turns inside out. Without it, its neighbors meet directly.
    const flipped = sides.findIndex((side, i) => dot(minus(corners[(i + 1) % corners.length], corners[i]), side.heading) <= 0);
    if (flipped < 0) return corners;
    sides = sides.filter((_, i) => i !== flipped);
  }
}

/** The block's outline, `extra` meters in from the edge of its streets. */
export function insetBlock(block: Block, extra: number): Point[] {
  return offsetPolygon(block.map(({ point }) => point), block.map(({ street }) => street.half + extra));
}

const turnAt = (before: Point, here: Point, after: Point) => Math.acos(clamp(dot(unit(minus(here, before)), unit(minus(after, here))), -1, 1));

export function roundCorners(points: Point[], radius: number, pieces: number): Point[] {
  if (pieces <= 0 || radius <= 0) return points;
  const n = points.length;
  return points.flatMap((here, i) => {
    const before = points[(i + n - 1) % n];
    const after = points[(i + 1) % n];
    const turn = turnAt(before, here, after);
    if (turn < STRAIGHT_ENOUGH) return [here];
    const back = minus(before, here);
    const front = minus(after, here);
    const trim = Math.min(radius * Math.tan(turn / 2), 0.45 * size(back), 0.45 * size(front));
    const start = plus(here, times(unit(back), trim));
    const end = plus(here, times(unit(front), trim));
    return Array.from({ length: pieces + 1 }, (_, k) => {
      const t = k / pieces;
      return blend(blend(start, here, t), blend(here, end, t), t);
    });
  });
}

/** Where a closed line turns a real corner, as distances along it. */
export function cornerSpots(line: Polyline): number[] {
  const { points, marks } = line;
  const n = points.length - 1;
  const spots: number[] = [];
  for (let i = 0; i < n; i++) {
    if (turnAt(points[(i + n - 1) % n], points[i], points[i + 1]) >= STRAIGHT_ENOUGH) spots.push(marks[i]);
  }
  return spots;
}

export const closedLine = (points: Point[]) => new Polyline([...points, points[0]]);

/** The tightest rectangle around a polygon. */
function frameOf(points: Point[]) {
  let best = { area: Infinity, center: [0, 0] as Point, long: [1, 0] as Point, short: [0, 1] as Point, longSize: 0, shortSize: 0 };
  points.forEach((point, i) => {
    const side = minus(points[(i + 1) % points.length], point);
    if (size(side) < SMALLEST_SIDE) return;
    const u = unit(side);
    const v = inward(u);
    const us = points.map((p) => dot(p, u));
    const vs = points.map((p) => dot(p, v));
    const uSize = Math.max(...us) - Math.min(...us);
    const vSize = Math.max(...vs) - Math.min(...vs);
    if (uSize * vSize >= best.area) return;
    const center = plus(times(u, (Math.max(...us) + Math.min(...us)) / 2), times(v, (Math.max(...vs) + Math.min(...vs)) / 2));
    best = uSize >= vSize
      ? { area: uSize * vSize, center, long: u, short: v, longSize: uSize, shortSize: vSize }
      : { area: uSize * vSize, center, long: v, short: u, longSize: vSize, shortSize: uSize };
  });
  return best;
}

/** `bow` pushes the middle of the line to its left. */
function curved(a: Point, b: Point, bow: number): Point[] {
  if (bow === 0) return [a, b];
  const side = inward(unit(minus(b, a)));
  return Array.from({ length: CURVE_PIECES + 1 }, (_, k) => {
    const t = k / CURVE_PIECES;
    return plus(blend(a, b, t), times(side, bow * 4 * t * (1 - t)));
  });
}

function outlineOf(rng: Rng, settings: PlanSettings, streets: Street[]): Block {
  const { width, length, wander, streetHalf } = settings;
  const corners = ([[-1, -1], [1, -1], [1, 1], [-1, 1]] as Point[]).map(([sx, sz]): Point => [
    sx * (width / 2 - rng.range(0, wander) * width),
    sz * (length / 2 - rng.range(0, wander) * length),
  ]);
  const smaller = Math.min(width, length);
  return corners.flatMap((corner, i) => {
    // A negative bow bulges out, so the city stays convex.
    const street = new Street(curved(corner, corners[(i + 1) % 4], -rng.range(0.3, 1) * wander * smaller), streetHalf, false);
    street.ends[0] = streetHalf;
    street.ends[1] = streetHalf;
    streets.push(street);
    return street.points.slice(0, -1).map((point) => ({ point, street }));
  });
}

interface Crossing {
  edge: number;
  point: Point;
  along: number;
}

function crossingsOf(points: Point[], origin: Point, direction: Point): Crossing[] {
  const found: Crossing[] = [];
  points.forEach((a, edge) => {
    const side = minus(points[(edge + 1) % points.length], a);
    const denominator = cross(direction, side);
    if (Math.abs(denominator) < 1e-6) return;
    const along = cross(minus(a, origin), side) / denominator;
    const t = cross(minus(a, origin), direction) / denominator;
    if (t >= 0 && t < 1) found.push({ edge, point: plus(a, times(side, t)), along });
  });
  return found.sort((p, q) => p.along - q.along);
}

/** Lays out streets by cutting the city in two, then each part again, until blocks are small enough. */
export function planStreets(rng: Rng, settings: PlanSettings): StreetPlan {
  const streets: Street[] = [];
  const blocks: Block[] = [];
  const narrowest = settings.lotDepth + 2 * (settings.streetHalf + settings.sidewalk) + 0.5;
  const fromCorner = narrowest * 0.62;

  const usable = (block: Block): boolean => {
    if (block.length < 3) return false;
    const inner = insetBlock(block, settings.sidewalk);
    if (polygonArea(inner) <= 0 || !isSimple(inner)) return false;
    if (frameOf(inner).shortSize < settings.lotDepth + 0.5) return false;
    return inner.every((here, i) => {
      const n = inner.length;
      const turn = turnAt(inner[(i + n - 1) % n], here, inner[(i + 1) % n]);
      return turn < STRAIGHT_ENOUGH || Math.PI - turn >= NARROWEST_CORNER;
    });
  };

  /** Where the street on this edge has its ends, as seen from this block. */
  const stretchOf = (block: Block, edge: number): [number, number, number, number] => {
    const n = block.length;
    const { street } = block[edge];
    let first = edge;
    for (let i = 0; i < n && block[(first + n - 1) % n].street === street; i++) first = (first + n - 1) % n;
    let last = edge;
    for (let i = 0; i < n && block[(last + 1) % n].street === street; i++) last = (last + 1) % n;
    const a = street.locate(block[first].point);
    const b = street.locate(block[(last + 1) % n].point);
    return [Math.min(a, b), Math.max(a, b), first, last];
  };

  /** Moves a crossing onto a junction across the street, or refuses it if it would be too close. */
  const settle = (block: Block, crossing: Crossing, mayLineUp: boolean): { edge: number; point: Point; at: number } | null => {
    const { street } = block[crossing.edge];
    let at = street.locate(crossing.point);
    const [low, high, first, last] = stretchOf(block, crossing.edge);
    // Joins along this block's own side can only come from the other side of the street.
    let nearest: Join | undefined;
    for (const join of street.joins) {
      if (join.at <= low + 1 || join.at >= high - 1) continue;
      if (!nearest || Math.abs(join.at - at) < Math.abs(nearest.at - at)) nearest = join;
    }
    if (nearest) {
      const gap = Math.abs(nearest.at - at);
      if (gap < 0.01 || (mayLineUp && gap < LINE_UP)) at = nearest.at;
      else if (gap < STAGGER) return null;
    }
    if (at - low < fromCorner || high - at < fromCorner) return null;
    const { point } = street.at(at);
    const n = block.length;
    let edge = crossing.edge;
    let closest = Infinity;
    for (let i = first; ; i = (i + 1) % n) {
      const line = new Polyline([block[i].point, block[(i + 1) % n].point]);
      const away = size(minus(line.at(line.locate(point)).point, point));
      if (away < closest) {
        closest = away;
        edge = i;
      }
      if (i === last) break;
    }
    return { edge, point, at };
  };

  const clean = (block: Block): Block => block.filter(({ point }, i) => size(minus(point, block[(i + 1) % block.length].point)) >= SMALLEST_SIDE);

  const cut = (block: Block, depth: number, attempt: number, diagonal: boolean): [Block, Block] | null => {
    const points = block.map(({ point }) => point);
    const area = polygonArea(points);
    const frame = frameOf(points);
    const acrossLong = attempt >= CUT_ATTEMPTS / 2 || frame.longSize * rng.range(0.75, 1.2) >= frame.shortSize;
    const axis = acrossLong ? frame.long : frame.short;
    const extent = acrossLong ? frame.longSize : frame.shortSize;
    if (extent < narrowest * 2) return null;

    const skew = depth === 0 ? settings.firstSkew : settings.skew;
    const lean = diagonal && attempt < 6 ? (rng.chance(0.5) ? 1 : -1) * rng.range(0.42, 0.72) : rng.range(-skew, skew);
    // Near the middle first. When junctions already sit there, look further out.
    const spread = attempt < CUT_ATTEMPTS / 2 ? 0.13 : 0.32;
    let origin = plus(frame.center, times(axis, rng.range(-spread, spread) * extent));
    if (settings.snap > 0) origin = [Math.round(origin[0] / settings.snap) * settings.snap, Math.round(origin[1] / settings.snap) * settings.snap];
    const direction = turned(inward(axis), lean);
    const crossings = crossingsOf(points, origin, direction);
    if (crossings.length !== 2 || crossings[0].edge === crossings[1].edge) return null;

    let one = settle(block, crossings[0], true);
    let other = settle(block, crossings[1], settings.snap === 0);
    if (settings.snap > 0 && one) {
      // A street kept on the axes can only line up with another by moving as a whole.
      const moved = crossingsOf(points, one.point, direction);
      if (moved.length !== 2) return null;
      one = settle(block, moved[0], false);
      other = settle(block, moved[1], false);
    }
    if (!one || !other || one.edge === other.edge) return null;
    const [start, end] = one.edge < other.edge ? [one, other] : [other, one];
    if (size(minus(end.point, start.point)) < narrowest) return null;

    const avenue = (depth === 0 && area > settings.blockArea * 6) || (depth === 1 && area > settings.blockArea * 3 && rng.chance(0.35));
    const half = avenue ? settings.avenueHalf : settings.streetHalf;
    const bow = !avenue && rng.chance(settings.bendChance) ? (rng.chance(0.5) ? 1 : -1) * rng.range(0.4, 1) * settings.bow : 0;
    const street = new Street(curved(start.point, end.point, bow), half, avenue);
    const middle = street.points.slice(1, -1).map((point) => ({ point, street }));
    const first = clean([
      { point: start.point, street: block[start.edge].street },
      ...block.slice(start.edge + 1, end.edge + 1),
      { point: end.point, street },
      ...[...middle].reverse(),
    ]);
    const second = clean([
      { point: end.point, street: block[end.edge].street },
      ...block.slice(end.edge + 1),
      ...block.slice(0, start.edge + 1),
      { point: start.point, street },
      ...middle,
    ]);
    if (!usable(first) || !usable(second)) return null;

    block[start.edge].street.joins.push({ at: start.at, half });
    block[end.edge].street.joins.push({ at: end.at, half });
    street.ends[0] = block[start.edge].street.half;
    street.ends[1] = block[end.edge].street.half;
    streets.push(street);
    return [first, second];
  };

  const divide = (block: Block, depth: number): void => {
    // Halving a block leaves parts of half to all of this size, so they average near blockArea.
    const area = polygonArea(block.map(({ point }) => point));
    if (area >= settings.blockArea * rng.range(1.05, 1.7)) {
      const diagonal = settings.diagonal && depth === 0 && area > settings.blockArea * 5 && rng.chance(0.55);
      for (let attempt = 0; attempt < CUT_ATTEMPTS; attempt++) {
        const parts = cut(block, depth, attempt, diagonal);
        if (parts) {
          divide(parts[0], depth + 1);
          divide(parts[1], depth + 1);
          return;
        }
      }
    }
    blocks.push(block);
  };

  const whole = outlineOf(rng, settings, streets);
  const outline = whole.map(({ point }) => point);
  divide(whole, 0);
  return { streets, blocks, outline };
}

export interface Lot {
  center: Point;
  /** Along the street. */
  along: Point;
  /** From the street toward the back of the lot. */
  back: Point;
}

function lotCorners({ center, along, back }: Lot, width: number, depth: number): Point[] {
  const pick: Point[] = [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [1, 0], [0, 1], [-1, 0]];
  return pick.map(([u, v]) => plus(center, plus(times(along, (u * width) / 2), times(back, (v * depth) / 2))));
}

function lotsOverlap(a: Lot, b: Lot, width: number, depth: number): boolean {
  const offset = minus(a.center, b.center);
  return [a.along, a.back, b.along, b.back].every((axis) => {
    const reach = (lot: Lot) => (Math.abs(dot(lot.along, axis)) * width) / 2 + (Math.abs(dot(lot.back, axis)) * depth) / 2;
    return Math.abs(dot(offset, axis)) < reach(a) + reach(b);
  });
}

export const isOnLot = (point: Point, lots: Lot[], width: number, depth: number) => lots.some((lot) => {
  const offset = minus(point, lot.center);
  return Math.abs(dot(offset, lot.along)) < width / 2 && Math.abs(dot(offset, lot.back)) < depth / 2;
});

/**
 * Lines lots up along the inside of a block, each one following the street in front of it.
 * A lot may reach out as far as `limit`, which lets a building fill the tip of a sharp block.
 */
export function lotsAlong(inner: Point[], limit: Point[], rng: Rng, width: number, depth: number): Lot[] {
  const line = closedLine(inner);
  const start = cornerSpots(line)[0] ?? 0;
  const spot = (distance: number) => line.at((start + distance) % line.total).point;
  const lots: Lot[] = [];
  for (let walked = 0.2; walked < line.total - 0.5; ) {
    const a = spot(walked);
    const b = spot(walked + width);
    const along = unit(minus(b, a));
    const back = inward(along);
    const lot: Lot = { center: plus(blend(a, b, 0.5), times(back, depth / 2 + 0.25)), along, back };
    const fits = lotCorners(lot, width, depth).every((corner) => contains(limit, corner)) && !lots.some((other) => lotsOverlap(lot, other, width + 0.05, depth + 0.05));
    if (fits) {
      lots.push(lot);
      walked += width + rng.range(0.05, 0.7);
    } else {
      walked += 0.5;
    }
  }
  return lots;
}

/** Scattered spots inside a polygon, kept apart from each other and off its edge. */
export function spotsInside(outline: Point[], rng: Rng, count: number, apart: number, margin: number): Point[] {
  const xs = outline.map(([x]) => x);
  const zs = outline.map(([, z]) => z);
  const line = closedLine(outline);
  const spots: Point[] = [];
  for (let tries = count * 24; tries > 0 && spots.length < count; tries--) {
    const point: Point = [rng.range(Math.min(...xs), Math.max(...xs)), rng.range(Math.min(...zs), Math.max(...zs))];
    if (!contains(outline, point)) continue;
    if (size(minus(line.at(line.locate(point)).point, point)) < margin) continue;
    if (spots.some((other) => size(minus(other, point)) < apart)) continue;
    spots.push(point);
  }
  return spots;
}
