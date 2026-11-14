import { ShapeUtils, Vector2 } from "three";
import { ROAD_TILE } from "../blocks/definitions/roads.ts";
import type { ArtStyle } from "../blocks/styles";
import type { GeneratedShape, ShapeMaterial, Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import { buildBuilding, buildHouse, buildTree } from "./buildings";
import { buildVehicle } from "./car";
import type { CityKit } from "./city";
import {
  closedLine,
  contains,
  cornerSpots,
  insetBlock,
  inward,
  isOnLot,
  isSimple,
  lotsAlong,
  offsetPolygon,
  planStreets,
  polygonArea,
  Polyline,
  roundCorners,
  spotsInside,
  unit,
  type Block,
  type PlanSettings,
  type Point,
  type Street,
} from "./cityplan";
import type { Rng } from "./rng";
import { MeshBuilder } from "./terrain";

const STREET_HALF = 4;
const AVENUE_HALF = 7;
const MEDIAN_HALF = 0.9;
const SIDEWALK = 2;
/** The widest building is a little under this. */
const LOT = ROAD_TILE - 0.3;
/** Houses are narrower, so more of them fit along a street. Low poly ones are fitted to the wider size. */
const houseLot = (style: ArtStyle) => (style === "lowpoly" ? LOT : 6.8);
/** How close to the curb the corner of a building may come. */
const BUILDING_LIMIT = 0.8;
/** A center strip shorter than this would look like something left on the road. */
const SHORTEST_MEDIAN = 12;
/** Room per lot along a block, so that rows of lots still fit after the gaps between them. */
const LOT_PITCH = ROAD_TILE + 1;
/** Sidewalk and asphalt that close the city off beyond its outer street. */
const APRON = 2;
const LINE_LIFT = 0.012;
const MEDIAN_RISE = 0.14;
/** Road paint stops here, so a huge city still fits in one shape. */
const MOST_VERTICES = 19000;
const LAMP_EVERY = 24;
const CROSSWALK_DEPTH = 3;
const CAR_EVERY = 9;
const CAR_CHANCE = 0.22;
/** Large cities keep about this many cars, because each one is a detailed model. */
const MOST_CARS = 60;

const Surface = { asphalt: 0, line: 1, walk: 2, curb: 3, grass: 4, paved: 5, side: 6 } as const;

interface Look {
  asphalt: string;
  line: string;
  walk: string;
  curb: string;
  grass: string;
  paved: string;
  side: string;
  round: number;
  roundPieces: number;
}

const BUILT_LOOK: Look = { asphalt: "#3a3d44", line: "#f0efe6", walk: "#aeb3ba", curb: "#8d9299", grass: "#4f9a4a", paved: "#989ea6", side: "#5b6068", round: 2.6, roundPieces: 5 };

const LOOKS: Record<ArtStyle, Look> = {
  realistic: BUILT_LOOK,
  arcade: BUILT_LOOK,
  lowpoly: { asphalt: "#55565f", line: "#f4f3ea", walk: "#c5c7d2", curb: "#a3a6b4", grass: "#7cbf62", paved: "#b3b6c2", side: "#6b6d78", round: 1.8, roundPieces: 2 },
  blocks: { ...BUILT_LOOK, round: 0, roundPieces: 0 },
};

type Tuning = Pick<PlanSettings, "skew" | "firstSkew" | "bendChance" | "bow" | "wander" | "diagonal" | "snap">;

const STREET_LAYOUTS: Record<string, Tuning> = {
  irregular: { skew: 0.14, firstSkew: 0.24, bendChance: 0.18, bow: 5, wander: 0.04, diagonal: true, snap: 0 },
  organic: { skew: 0.3, firstSkew: 0.42, bendChance: 0.75, bow: 11, wander: 0.08, diagonal: false, snap: 0 },
};

/** Voxels have no diagonals, so every street stays on the axes and only the blocks vary. */
const SQUARED: Tuning = { skew: 0, firstSkew: 0, bendChance: 0, bow: 0, wander: 0, diagonal: false, snap: 1 };

export interface StreetCitySettings {
  style: ArtStyle;
  kit: CityKit;
  layout: string;
  blocksX: number;
  blocksZ: number;
  lots: number;
  tallest: number;
  density: string | undefined;
  cars: boolean;
}

export const streetPlanSettings = (settings: Pick<StreetCitySettings, "style" | "layout" | "blocksX" | "blocksZ" | "lots">): PlanSettings => {
  const pitch = settings.lots * LOT_PITCH + 2 * (STREET_HALF + SIDEWALK);
  return {
    width: settings.blocksX * pitch,
    length: settings.blocksZ * pitch,
    blockArea: pitch * pitch,
    streetHalf: STREET_HALF,
    avenueHalf: AVENUE_HALF,
    sidewalk: SIDEWALK,
    lotDepth: LOT,
    ...(settings.style === "blocks" ? SQUARED : (STREET_LAYOUTS[settings.layout] ?? STREET_LAYOUTS.irregular)),
  };
};

class Ground {
  readonly mesh = new MeshBuilder();

  /** A flat polygon looking up. */
  flat(outline: Point[], y: number, surface: number, holes: Point[][] = []): void {
    const toVector = ([x, z]: Point) => new Vector2(x, z);
    const all = [outline, ...holes].flat();
    const ids = all.map(([x, z]) => this.mesh.vertex(x, y, z));
    for (const [a, b, c] of ShapeUtils.triangulateShape(outline.map(toVector), holes.map((hole) => hole.map(toVector)))) {
      if (ids[a] === ids[b] || ids[b] === ids[c] || ids[a] === ids[c]) continue;
      const [p, q, r] = [all[a], all[b], all[c]];
      const up = (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]) < 0;
      this.mesh.face(up ? [ids[a], ids[b], ids[c]] : [ids[a], ids[c], ids[b]], surface);
    }
  }

  /** The step down along an outline. `toInside` makes it face the middle of the polygon. */
  rim(outline: Point[], top: number, bottom: number, surface: number, toInside: boolean): void {
    outline.forEach((a, i) => {
      const b = outline[(i + 1) % outline.length];
      const [nx, nz] = inward(unit([b[0] - a[0], b[1] - a[1]]));
      const way = toInside ? 1 : -1;
      this.mesh.wall([a[0], top, a[1]], [b[0], top, b[1]], [b[0], bottom, b[1]], [a[0], bottom, a[1]], [nx * way, 0, nz * way], surface);
    });
  }

  /** A band of paint along a line, in short pieces so it follows the bends. */
  stripe(line: Polyline, from: number, to: number, offset: number, width: number, y: number): void {
    const pieces = Math.max(1, Math.ceil((to - from) / 5));
    for (let k = 0; k < pieces; k++) {
      const a = line.at(from + ((to - from) * k) / pieces);
      const b = line.at(from + ((to - from) * (k + 1)) / pieces);
      const side = (spot: typeof a, amount: number): Point => {
        const [nx, nz] = inward(spot.heading);
        return [spot.point[0] + nx * amount, spot.point[1] + nz * amount];
      };
      this.flat([side(a, offset - width / 2), side(b, offset - width / 2), side(b, offset + width / 2), side(a, offset + width / 2)], y, Surface.line);
    }
  }

  get full(): boolean {
    return this.mesh.vertices.length >= MOST_VERTICES;
  }
}

/** The parts of a street between junctions. */
function stretchesOf(street: Street, curbRadius: number): [number, number][] {
  const stops = [{ at: 0, half: street.ends[0] }, ...street.joins, { at: street.total, half: street.ends[1] }].sort((a, b) => a.at - b.at);
  const stretches: [number, number][] = [];
  for (let i = 0; i + 1 < stops.length; i++) {
    const from = stops[i].at + stops[i].half + curbRadius + 0.4;
    const to = stops[i + 1].at - stops[i + 1].half - curbRadius - 0.4;
    if (to - from > 5) stretches.push([from, to]);
  }
  return stretches;
}

function drawCrosswalk(ground: Ground, street: Street, from: number, y: number): void {
  const edge = street.half - 0.7;
  const gap = street.avenue ? MEDIAN_HALF + 0.3 : 0;
  for (let lateral = -edge; lateral <= edge; lateral += 1.1) {
    if (Math.abs(lateral) >= gap) ground.stripe(street, from, from + CROSSWALK_DEPTH, lateral, 0.55, y);
  }
}

function drawDashes(ground: Ground, street: Street, from: number, to: number, offset: number, y: number): void {
  for (let spot = from; spot + 2.4 <= to && !ground.full; spot += 6) ground.stripe(street, spot, spot + 2.4, offset, 0.16, y);
}

/** The center strip of an avenue: a low bed with trees, broken at each junction. */
function drawMedian(asm: Assembler, ground: Ground, rng: Rng, street: Street, from: number, to: number, style: ArtStyle, top: number): void {
  const pieces = Math.max(1, Math.ceil((to - from) / 8));
  const sideOf = (sign: number) => Array.from({ length: pieces + 1 }, (_, k): Point => {
    const { point, heading } = street.at(from + ((to - from) * k) / pieces);
    const [nx, nz] = inward(heading);
    return [point[0] + nx * sign * MEDIAN_HALF, point[1] + nz * sign * MEDIAN_HALF];
  });
  const outline = [...sideOf(-1), ...sideOf(1).reverse()];
  const counterclockwise = polygonArea(outline) > 0 ? outline : [...outline].reverse();
  ground.flat(counterclockwise, top + MEDIAN_RISE, Surface.grass);
  ground.rim(counterclockwise, top + MEDIAN_RISE, top, Surface.curb, false);
  for (let spot = from + 4; spot < to - 3; spot += 10) {
    const [x, z] = street.at(spot).point;
    buildTree(asm, rng.fork(`median ${Math.round(x)} ${Math.round(z)}`), { style, light: true, position: [x, top + MEDIAN_RISE, z], kind: "leafy", size: "small" });
  }
}

function drawStreet(asm: Assembler, ground: Ground, rng: Rng, street: Street, settings: StreetCitySettings, curbRadius: number): void {
  const { roadTop } = settings.kit;
  const y = roadTop + LINE_LIFT;
  stretchesOf(street, curbRadius).forEach(([from, to], index, all) => {
    const clear = CROSSWALK_DEPTH + 0.8;
    const atEnd = (first: boolean) => (first ? index === 0 : index === all.length - 1);
    const zebra = (first: boolean) => to - from > clear * 2 + 2 && !ground.full && rng.chance(atEnd(first) ? 0.6 : 0.2);
    if (zebra(true)) drawCrosswalk(ground, street, from, y);
    if (zebra(false)) drawCrosswalk(ground, street, to - CROSSWALK_DEPTH, y);
    const start = from + clear;
    const end = to - clear;
    if (end <= start) return;
    if (street.avenue) {
      if (end - start >= SHORTEST_MEDIAN) drawMedian(asm, ground, rng, street, start, end, settings.style, roadTop);
      for (const sign of [-1, 1]) drawDashes(ground, street, start, end, sign * ((street.half + MEDIAN_HALF) / 2), y);
    } else {
      drawDashes(ground, street, start, end, 0, y);
    }
  });
}

const lanesOf = (street: Street) => (street.avenue ? [-5.5, -2.5, 2.5, 5.5] : [-street.half / 2, street.half / 2]);

/** Every spot a car could take, in the order the streets were made. */
function carSpots(streets: Street[], curbRadius: number) {
  return streets.flatMap((street) => stretchesOf(street, curbRadius).flatMap(([from, to]) => {
    const spots: { street: Street; at: number; lane: number }[] = [];
    for (let at = from + CROSSWALK_DEPTH + 2.5; at < to - CROSSWALK_DEPTH - 2.5; at += CAR_EVERY) for (const lane of lanesOf(street)) spots.push({ street, at, lane });
    return spots;
  }));
}

function placeCars(asm: Assembler, rng: Rng, streets: Street[], settings: StreetCitySettings, curbRadius: number): void {
  const spots = carSpots(streets, curbRadius);
  const chance = Math.min(CAR_CHANCE, MOST_CARS / Math.max(1, spots.length));
  spots.forEach(({ street, at, lane }, index) => {
    if (!rng.chance(chance)) return;
    const { point, heading } = street.at(at);
    const [nx, nz] = inward(heading);
    // Cars keep to the right, which from above is the same quarter turn as `inward`.
    const way = lane > 0 ? 1 : -1;
    const start = asm.parts.length;
    buildVehicle(asm, rng.fork(`car ${index}`), { style: settings.style, kind: "car", position: [0, 0, 0], yawSteps: 0 });
    asm.place(start, [point[0] + nx * lane, settings.kit.roadTop, point[1] + nz * lane], Math.atan2(heading[0] * way, heading[1] * way));
  });
}

type Role = "park" | "houses" | "shops" | "towers";

/** Towers gather in the middle and houses at the edge, unless the region was chosen. `where` is 0 at the center. */
function roleOf(rng: Rng, density: string | undefined, where: number): Role {
  if (density === "suburb") return rng.chance(0.22) ? "park" : "houses";
  if (density === "downtown") return rng.chance(0.1) ? "park" : where < 0.65 ? "towers" : "shops";
  if (rng.chance(0.14)) return "park";
  const mix = where + rng.range(-0.18, 0.18);
  return mix > 0.72 ? "houses" : mix > 0.4 ? "shops" : "towers";
}

function placeOnBlock(asm: Assembler, start: number, [x, z]: Point, top: number, facing: Point): void {
  asm.place(start, [x, top, z], Math.atan2(facing[0], facing[1]));
}

function placePark(asm: Assembler, ground: Ground, rng: Rng, inner: Point[], shown: Point[], settings: StreetCitySettings): void {
  const { style, kit } = settings;
  const top = kit.sidewalkTop;
  ground.flat(shown, top, Surface.grass);
  const area = polygonArea(inner);
  spotsInside(inner, rng.fork("trees"), Math.min(40, Math.round(area / 42)), 3.6, 1.6).forEach(([x, z], index) => {
    buildTree(asm, rng.fork(`park tree ${index}`), { style, light: true, position: [x, top, z], kind: rng.chance(0.75) ? "leafy" : "pine" });
  });
  if (!kit.bench) return;
  spotsInside(inner, rng.fork("benches"), Math.min(6, Math.round(area / 160)), 6, 2).forEach(([x, z], index) => {
    const start = asm.parts.length;
    asm.add(kit.bench!, [0, 0, 0]);
    asm.place(start, [x, top, z], rng.fork(`bench ${index}`).range(0, Math.PI * 2));
  });
}

/** What is left in the middle of a block once its lots are taken, if it is worth keeping. */
function courtyardOf(inner: Point[]): Point[] | null {
  const court = offsetPolygon(inner, inner.map(() => LOT + 1.4));
  const ok = polygonArea(court) > 36 && isSimple(court) && court.every((point) => contains(inner, point));
  return ok ? court : null;
}

/** Lamps, and on quiet streets a row of trees, along the edge of the sidewalk. */
function dressSidewalk(asm: Assembler, rng: Rng, curb: Point[], role: Role, settings: StreetCitySettings): void {
  const { style, kit } = settings;
  const line = closedLine(curb);
  const corners = cornerSpots(line);
  const free = (spot: number) => corners.every((corner) => {
    const gap = Math.abs(spot - corner);
    return Math.min(gap, line.total - gap) > 5.5;
  });
  const offCurb = (spot: number, inset: number): { at: Point; out: Point } => {
    const { point, heading } = line.at(spot);
    const side = inward(heading);
    return { at: [point[0] + side[0] * inset, point[1] + side[1] * inset], out: [-side[0], -side[1]] };
  };
  const lamps: number[] = [];
  if (kit.lamp) {
    for (let spot = rng.range(3, 14); spot < line.total; spot += LAMP_EVERY) {
      if (!free(spot)) continue;
      const { at, out } = offCurb(spot, 0.6);
      const start = asm.parts.length;
      asm.add(kit.lamp, [0, 0, 0]);
      placeOnBlock(asm, start, at, kit.sidewalkTop, out);
      lamps.push(spot);
    }
  }
  if (role !== "houses") return;
  for (let spot = rng.range(4, 9); spot < line.total; spot += 10) {
    if (!free(spot) || !rng.chance(0.7) || lamps.some((lamp) => Math.abs(lamp - spot) < 3)) continue;
    const { at } = offCurb(spot, 0.95);
    buildTree(asm, rng.fork(`sidewalk ${Math.round(spot)}`), { style, light: true, position: [at[0], kit.sidewalkTop, at[1]], kind: "leafy", size: "small" });
  }
}

function placeBuildings(asm: Assembler, ground: Ground, rng: Rng, inner: Point[], limit: Point[], shown: Point[], role: Role, where: number, settings: StreetCitySettings): void {
  const { style, kit, tallest } = settings;
  const top = kit.sidewalkTop;
  const court = courtyardOf(inner);
  ground.flat(shown, top, role === "houses" ? Surface.grass : Surface.paved, court ? [court] : []);
  if (court) {
    ground.flat(court, top, Surface.grass);
    spotsInside(court, rng.fork("court"), Math.min(14, Math.round(polygonArea(court) / 40)), 3.4, 1).forEach(([x, z], index) => {
      buildTree(asm, rng.fork(`court tree ${index}`), { style, light: true, position: [x, top, z], kind: "leafy" });
    });
  }

  const lotWidth = role === "houses" ? houseLot(style) : LOT;
  const lots = lotsAlong(inner, limit, rng.fork("lots"), lotWidth, LOT);
  // Whatever the buildings did not take is planted.
  spotsInside(inner, rng.fork("gaps"), Math.min(16, Math.round(polygonArea(inner) / 40)), 3.4, 1.2)
    .filter((spot) => !isOnLot(spot, lots, lotWidth + 2, LOT + 2) && !(court && contains(court, spot)))
    .forEach(([x, z], index) => {
      buildTree(asm, rng.fork(`gap tree ${index}`), { style, light: true, position: [x, top, z], kind: "leafy", size: "small" });
    });

  lots.forEach((lot, index) => {
    const lotRng = rng.fork(`lot ${index}`);
    if (lotRng.chance(0.05)) {
      buildTree(asm, lotRng.fork("tree"), { style, light: true, position: [lot.center[0], top, lot.center[1]], kind: "leafy" });
      return;
    }
    const start = asm.parts.length;
    const origin: Vec3 = [0, 0, 0];
    if (role === "houses") buildHouse(asm, lotRng, { style, position: origin, yawSteps: 0, lot: [lotWidth, LOT] });
    else {
      const maxFloors = role === "shops" ? Math.min(5, tallest) : Math.max(3, Math.round(tallest * (1 - where * 0.55)));
      buildBuilding(asm, lotRng, { style, position: origin, yawSteps: 0, minFloors: 2, maxFloors, lot: [LOT, LOT] });
    }
    placeOnBlock(asm, start, lot.center, top, [-lot.back[0], -lot.back[1]]);
  });
}

function drawBlock(asm: Assembler, ground: Ground, rng: Rng, block: Block, settings: StreetCitySettings, look: Look, extent: Point): void {
  const { kit } = settings;
  const curb = roundCorners(insetBlock(block, 0), look.round, look.roundPieces);
  const inner = insetBlock(block, SIDEWALK);
  const limit = insetBlock(block, BUILDING_LIMIT);
  const shown = roundCorners(inner, look.round / 2, look.roundPieces);
  ground.flat(curb, kit.sidewalkTop, Surface.walk, [shown]);
  ground.rim(curb, kit.sidewalkTop, kit.roadTop, Surface.curb, false);

  const center = inner.reduce<Point>((sum, [x, z]) => [sum[0] + x / inner.length, sum[1] + z / inner.length], [0, 0]);
  const where = Math.min(1, Math.max(Math.abs(center[0]) / extent[0], Math.abs(center[1]) / extent[1]));
  const role = roleOf(rng.fork("role"), settings.density, where);
  dressSidewalk(asm, rng.fork("sidewalk"), insetBlock(block, 0), role, settings);
  if (role === "park") placePark(asm, ground, rng, inner, shown, settings);
  else placeBuildings(asm, ground, rng, inner, limit, shown, role, where, settings);
}

/** The road surface under the whole city, and the edge that closes it off. */
function drawBase(ground: Ground, outline: Point[], settings: StreetCitySettings, look: Look): void {
  const { roadTop, sidewalkTop } = settings.kit;
  const road = roundCorners(offsetPolygon(outline, outline.map(() => -STREET_HALF)), look.round * 2, look.roundPieces);
  const edge = roundCorners(offsetPolygon(outline, outline.map(() => -STREET_HALF - APRON)), look.round * 2, look.roundPieces);
  ground.flat(road, roadTop, Surface.asphalt);
  ground.flat(edge, sidewalkTop, Surface.walk, [road]);
  ground.rim(road, sidewalkTop, roadTop, Surface.curb, true);
  ground.rim(edge, sidewalkTop, 0, Surface.side, false);
  // Corners that run counterclockwise on the ground make a face that looks down.
  ground.mesh.face(edge.map(([x, z]) => ground.mesh.vertex(x, 0, z)), Surface.side);
}

/** Realista paves its streets with photographed asphalt, concrete, grass and brick; paint stays plain. */
const REAL_GROUND: (string | null)[] = ["asphalt", null, "sidewalk", "concrete", "grass", "cobblestone", "concrete"];

const materialsOf = (look: Look, style: ArtStyle): ShapeMaterial[] =>
  [look.asphalt, look.line, look.walk, look.curb, look.grass, look.paved, look.side].map((color, index) => {
    const texture = style === "realistic" ? REAL_GROUND[index] : null;
    return texture ? { color: "#ffffff", texture } : { color };
  });

export function buildStreetCity(asm: Assembler, rng: Rng, settings: StreetCitySettings): void {
  const look = LOOKS[settings.style];
  const planSettings = streetPlanSettings(settings);
  const plan = planStreets(rng.fork("plan"), planSettings);
  const ground = new Ground();
  const extent: Point = [planSettings.width / 2, planSettings.length / 2];

  drawBase(ground, plan.outline, settings, look);
  plan.blocks.forEach((block, index) => drawBlock(asm, ground, rng.fork(`block ${index}`), block, settings, look, extent));
  plan.streets.forEach((street, index) => drawStreet(asm, ground, rng.fork(`street ${index}`), street, settings, look.round));
  if (settings.cars) placeCars(asm, rng.fork("cars"), plan.streets, settings, look.round);

  const shape: GeneratedShape = {
    name: "Ruas da cidade",
    color: look.asphalt,
    vertices: ground.mesh.vertices,
    faces: ground.mesh.faces,
    faceMaterials: ground.mesh.faceMaterials,
    materials: materialsOf(look, settings.style),
    smoothAngle: 0,
    sockets: [],
  };
  asm.add(asm.addShape(shape), [0, 0, 0]);
}
