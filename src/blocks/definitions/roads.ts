import type { BlockDef, Point, ShapePiece } from "../types.ts";
import { arc, block, compound, rect, sector, slab, socket } from "./helpers.ts";

export const ROAD_TILE = 8;
export const SIDEWALK_HEIGHT = 0.14;

const ASPHALT = "#3a3d44";
const SIDEWALK = "#aeb3ba";
const LINE = "#f0efe6";
const GRASS = "#4f9a4a";

// Road tiles: 6 m of asphalt between 1 m sidewalks. Tile openings are listed in generators/tiles.ts.

const roadHalf = ROAD_TILE / 2;
const lane = roadHalf - 1;
const ROAD_TOP = 0.04;
const LINE_TOP = 0.045;

const groundSockets = (top: number) => [
  socket("bottom", [0, 0, 0], [0, -1, 0]),
  socket("top", [0, top, 0], [0, 1, 0]),
];

// Photographed surfaces at their own colors; Arcade swaps them back for plain paint (see styleize.ts).
const REAL = "#ffffff";
const asphalt = (points: Point[]) => slab(points, ROAD_TOP, { color: REAL, surface: "asphalt" });
const line = (points: Point[]) => slab(points, LINE_TOP, { color: LINE });
const walk = (points: Point[]) => slab(points, SIDEWALK_HEIGHT, { color: REAL, surface: "sidewalk" });
const curb = (points: Point[]) => slab(points, SIDEWALK_HEIGHT + 0.005, { color: REAL, surface: "concrete" });

const dashes = (axis: "x" | "z", length = 1.2): ShapePiece[] =>
  [-2.8, 0, 2.8].map((center) => {
    const half = length / 2;
    return axis === "z"
      ? line(rect(-0.07, center - half, 0.07, center + half))
      : line(rect(center - half, -0.07, center + half, 0.07));
  });

const sideWalks = () => [
  walk(rect(-roadHalf, -roadHalf, -lane, roadHalf)),
  walk(rect(lane, -roadHalf, roadHalf, roadHalf)),
  curb(rect(-lane - 0.08, -roadHalf, -lane, roadHalf)),
  curb(rect(lane, -roadHalf, lane + 0.08, roadHalf)),
];

const cornerWalk = (signX: number, signZ: number) => {
  const inner = lane * 1;
  const x0 = signX > 0 ? inner : -roadHalf;
  const x1 = signX > 0 ? roadHalf : -inner;
  const z0 = signZ > 0 ? inner : -roadHalf;
  const z1 = signZ > 0 ? roadHalf : -inner;
  return walk(rect(x0, z0, x1, z1));
};

const stopLine = (side: "x+" | "z+" | "z-" | "x-"): ShapePiece => {
  const near = lane - 0.15;
  const far = lane - 0.55;
  if (side === "z+") return line(rect(-lane + 0.1, far, lane - 0.1, near));
  if (side === "z-") return line(rect(-lane + 0.1, -near, lane - 0.1, -far));
  if (side === "x+") return line(rect(far, -lane + 0.1, near, lane - 0.1));
  return line(rect(-near, -lane + 0.1, -far, lane - 0.1));
};

const corner = roadHalf;
const curveCenter: Point = [corner, corner];

const curveOuter: Point[] = [
  [-corner, -corner],
  [corner, -corner],
  [corner, -corner + 1],
  ...arc(corner, corner, ROAD_TILE - 1, 270, 180, 16).slice(1, -1),
  [-corner + 1, corner],
  [-corner, corner],
];

function curveMarks(): ShapePiece[] {
  const marks: ShapePiece[] = [];
  const count = 5;
  for (let i = 0; i < count; i++) {
    const start = 180 + 6 + (i * 84) / count;
    const end = start + 9;
    marks.push(line(sector(curveCenter[0], curveCenter[1], 3.93, 4.07, start, end, 3)));
  }
  return marks;
}

function roadTile(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`road.${id}`, name, "road", ASPHALT, compound(pieces), groundSockets(ROAD_TOP), {
    ground: true,
    snap: ROAD_TILE,
  });
}

const tileSlab = (points: Point[]) => asphalt(points);

const fullAsphalt = rect(-roadHalf, -roadHalf, roadHalf, roadHalf);

const zebra = (): ShapePiece[] =>
  Array.from({ length: 7 }, (_, index) => {
    const x = -2.55 + index * 0.85;
    return line(rect(x - 0.22, -1.1, x + 0.22, 1.1));
  });

const stalls = (): ShapePiece[] =>
  Array.from({ length: 6 }, (_, index) => {
    const x = -3.6 + index * 2.4;
    return line(rect(x - 0.05, -3.6, x + 0.05, -0.8));
  }).concat(
    Array.from({ length: 6 }, (_, index) => {
      const x = -3.6 + index * 2.4;
      return line(rect(x - 0.05, 0.8, x + 0.05, 3.6));
    }),
  );

export const roadBlocks: BlockDef[] = [
  roadTile("straight", "Rua reta", [tileSlab(fullAsphalt), ...sideWalks(), ...dashes("z")]),
  roadTile("crosswalk", "Faixa de pedestre", [tileSlab(fullAsphalt), ...sideWalks(), ...zebra()]),
  roadTile("curve", "Curva", [
    tileSlab(fullAsphalt),
    walk(curveOuter),
    walk(sector(corner, corner, 0, 1, 180, 270, 6)),
    curb(sector(corner, corner, 6.92, 7, 180, 270, 16)),
    curb(sector(corner, corner, 1, 1.08, 180, 270, 6)),
    ...curveMarks(),
  ]),
  roadTile("t", "Bifurcação", [
    tileSlab(fullAsphalt),
    walk(rect(-roadHalf, -roadHalf, -lane, roadHalf)),
    curb(rect(-lane - 0.08, -roadHalf, -lane, roadHalf)),
    cornerWalk(1, 1),
    cornerWalk(1, -1),
    stopLine("x+"),
  ]),
  roadTile("cross", "Cruzamento", [
    tileSlab(fullAsphalt),
    cornerWalk(1, 1),
    cornerWalk(1, -1),
    cornerWalk(-1, 1),
    cornerWalk(-1, -1),
    stopLine("z+"),
    stopLine("z-"),
    stopLine("x+"),
    stopLine("x-"),
  ]),
  roadTile("parking", "Estacionamento", [tileSlab(fullAsphalt), ...stalls()]),
  block(
    "road.sidewalk",
    "Calçada",
    "road",
    SIDEWALK,
    compound(walk(rect(-roadHalf, -roadHalf, roadHalf, roadHalf))),
    groundSockets(SIDEWALK_HEIGHT),
    { ground: true, snap: ROAD_TILE },
  ),
  block(
    "road.grass",
    "Gramado",
    "road",
    GRASS,
    compound(slab(rect(-roadHalf, -roadHalf, roadHalf, roadHalf), 0.1, { color: REAL, surface: "grass" })),
    groundSockets(0.1),
    { ground: true, snap: ROAD_TILE },
  ),
];
