import type { BlockDef, Point, ShapePiece, Vec3 } from "../types.ts";
import {
  arc,
  block,
  box,
  capsule,
  compound,
  cylinder,
  extrude,
  rect,
  roundedBox,
  sector,
  slab,
  socket,
  torus,
} from "./helpers.ts";

export const ROAD_TILE = 8;
export const SIDEWALK_HEIGHT = 0.14;
export const TRACK_TILE = 12;

const ASPHALT = "#3a3d44";
const SIDEWALK = "#aeb3ba";
const CURB = "#8d9299";
const LINE = "#f0efe6";
const GRASS = "#4f9a4a";
const RED = "#d62f3a";
const WHITE = "#f4f1ea";

// Road tiles: 6 m of asphalt between 1 m sidewalks. Tile openings are listed in generators/tiles.ts.

const roadHalf = ROAD_TILE / 2;
const lane = roadHalf - 1;
const ROAD_TOP = 0.04;
const LINE_TOP = 0.045;

const groundSockets = (top: number) => [
  socket("bottom", [0, 0, 0], [0, -1, 0]),
  socket("top", [0, top, 0], [0, 1, 0]),
];

const asphalt = (points: Point[]) => slab(points, ROAD_TOP);
const line = (points: Point[]) => slab(points, LINE_TOP, { color: LINE });
const walk = (points: Point[]) => slab(points, SIDEWALK_HEIGHT, { color: SIDEWALK });
const curb = (points: Point[]) => slab(points, SIDEWALK_HEIGHT + 0.005, { color: CURB });

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

// Track tiles: 8 m of asphalt with striped kerbs, on a 12 m grass tile.

const trackHalf = TRACK_TILE / 2;
const trackEdge = 4;
const KERB_WIDTH = 0.55;
const GRASS_TOP = 0.02;
const TRACK_TOP = 0.05;
const KERB_TOP = 0.075;
const MARK_TOP = 0.055;

const grass = () =>
  slab(rect(-trackHalf, -trackHalf, trackHalf, trackHalf), GRASS_TOP, { color: GRASS });
const track = (points: Point[]) => slab(points, TRACK_TOP);

function straightKerbs(): ShapePiece[] {
  const kerbs: ShapePiece[] = [];
  for (let i = 0; i < TRACK_TILE; i++) {
    const z = -trackHalf + i;
    const color = i % 2 === 0 ? RED : WHITE;
    for (const side of [-1, 1]) {
      const x0 = side > 0 ? trackEdge : -trackEdge - KERB_WIDTH;
      kerbs.push(slab(rect(x0, z, x0 + KERB_WIDTH, z + 1), KERB_TOP, { color }));
    }
  }
  return kerbs;
}

function curveKerbs(): ShapePiece[] {
  const kerbs: ShapePiece[] = [];
  const addBand = (inner: number, count: number) => {
    const step = 90 / count;
    for (let i = 0; i < count; i++) {
      const color = i % 2 === 0 ? RED : WHITE;
      kerbs.push(
        slab(sector(trackHalf, trackHalf, inner, inner + KERB_WIDTH, 180 + i * step, 180 + (i + 1) * step, 2), KERB_TOP, { color }),
      );
    }
  };
  addBand(2 - KERB_WIDTH, 4);
  addBand(10, 16);
  return kerbs;
}

const trackDashes = (): ShapePiece[] =>
  [-4.5, -1.5, 1.5, 4.5].map((z) =>
    slab(rect(-0.1, z - 0.7, 0.1, z + 0.7), MARK_TOP, { color: LINE }),
  );

const checker = (): ShapePiece[] => {
  const squares: ShapePiece[] = [];
  const size = 0.5;
  for (let row = 0; row < 3; row++) {
    for (let column = 0; column < 16; column++) {
      if ((row + column) % 2 !== 0) continue;
      const x = -trackEdge + column * size;
      const z = -0.75 + row * size;
      squares.push(slab(rect(x, z, x + size, z + size), MARK_TOP, { color: WHITE }));
    }
  }
  return squares;
};

const gridBoxes = (): ShapePiece[] =>
  [
    [-2, -3.2],
    [2, -5],
  ].flatMap(([x, z]) => [
    slab(rect(x - 1.1, z - 0.06, x + 1.1, z + 0.06), MARK_TOP, { color: LINE }),
    slab(rect(x - 1.1, z - 0.06, x - 0.98, z + 1.2), MARK_TOP, { color: LINE }),
    slab(rect(x + 0.98, z - 0.06, x + 1.1, z + 1.2), MARK_TOP, { color: LINE }),
  ]);

function trackTile(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`track.${id}`, name, "track", "#34363d", compound(grass(), pieces), groundSockets(TRACK_TOP), {
    ground: true,
    snap: TRACK_TILE,
  });
}

function trackProp(
  id: string,
  name: string,
  color: string,
  pieces: ShapePiece[],
  top: Vec3 = [0, 1, 0],
): BlockDef {
  return block(`track.${id}`, name, "track", color, compound(pieces), [
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", top, [0, 1, 0]),
  ]);
}

const tireStack = (x: number, z: number): ShapePiece[] =>
  [0.14, 0.42, 0.7].map((y, index) =>
    torus(0.24, 0.13, {
      at: [x, y, z],
      rot: [90, 0, 0],
      color: index === 1 ? WHITE : "#1c1e24",
    }),
  );

const flag = (x: number, height: number, color: string): ShapePiece[] => [
  cylinder(0.03, 0.03, height, 8, { at: [x, height / 2, 0], color: "#c8ced6" }),
  box([0.7, 0.42, 0.015], { at: [x + 0.37, height - 0.25, 0], color }),
];

const grandstandSteps: Point[] = Array.from({ length: 6 }, (_, index): Point[] => [
  [2 - index * 0.8, 0.5 + index * 0.55],
  [1.2 - index * 0.8, 0.5 + index * 0.55],
]).flat();

export const roadBlocks: BlockDef[] = [
  roadTile("straight", "Rua reta", [tileSlab(fullAsphalt), ...sideWalks(), ...dashes("z")]),
  roadTile("crosswalk", "Faixa de pedestre", [tileSlab(fullAsphalt), ...sideWalks(), ...zebra()]),
  roadTile("curve", "Curva", [
    tileSlab(fullAsphalt),
    walk(curveOuter),
    slab(sector(corner, corner, 0, 1, 180, 270, 6), SIDEWALK_HEIGHT, { color: SIDEWALK }),
    slab(sector(corner, corner, 6.92, 7, 180, 270, 16), SIDEWALK_HEIGHT + 0.005, { color: CURB }),
    slab(sector(corner, corner, 1, 1.08, 180, 270, 6), SIDEWALK_HEIGHT + 0.005, { color: CURB }),
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
    compound(
      slab(rect(-roadHalf, -roadHalf, roadHalf, roadHalf), SIDEWALK_HEIGHT),
      ...[-2, 0, 2].flatMap((v) => [
        slab(rect(-roadHalf, v - 0.01, roadHalf, v + 0.01), SIDEWALK_HEIGHT + 0.002, { color: CURB }),
        slab(rect(v - 0.01, -roadHalf, v + 0.01, roadHalf), SIDEWALK_HEIGHT + 0.002, { color: CURB }),
      ]),
    ),
    groundSockets(SIDEWALK_HEIGHT),
    { ground: true, snap: ROAD_TILE },
  ),
  block(
    "road.grass",
    "Gramado",
    "road",
    GRASS,
    slab(rect(-roadHalf, -roadHalf, roadHalf, roadHalf), 0.1).shape,
    groundSockets(0.1),
    { ground: true, snap: ROAD_TILE },
  ),

  trackTile("straight", "Pista reta", [
    track(rect(-trackEdge, -trackHalf, trackEdge, trackHalf)),
    ...straightKerbs(),
    ...trackDashes(),
  ]),
  trackTile("curve", "Pista em curva", [
    track(sector(trackHalf, trackHalf, 2, 10, 180, 270, 24)),
    ...curveKerbs(),
  ]),
  trackTile("start", "Largada", [
    track(rect(-trackEdge, -trackHalf, trackEdge, trackHalf)),
    ...straightKerbs(),
    ...checker(),
    ...gridBoxes(),
  ]),
  block(
    "track.infield",
    "Grama de pista",
    "track",
    GRASS,
    slab(rect(-trackHalf, -trackHalf, trackHalf, trackHalf), GRASS_TOP).shape,
    groundSockets(GRASS_TOP),
    { ground: true, snap: TRACK_TILE },
  ),

  trackProp("barrier_concrete", "Barreira de concreto", "#b8bcc2", [
    extrude(
      [
        [-0.3, 0],
        [0.3, 0],
        [0.1, 0.8],
        [-0.1, 0.8],
      ],
      4,
      0.015,
    ),
    ...[-1.4, 0, 1.4].map((x) => box([0.7, 0.12, 0.42], { at: [x, 0.68, 0], color: RED })),
  ], [0, 0.8, 0]),
  trackProp("barrier_armco", "Guard-rail", "#c8ced6", [
    box([4, 0.3, 0.05], { at: [0, 0.6, 0] }),
    ...[-1.9, 0, 1.9].map((x) =>
      box([0.1, 0.7, 0.08], { at: [x, 0.35, -0.04], color: "#6d7480" }),
    ),
  ], [0, 0.75, 0]),
  trackProp("tires", "Pilha de pneus", "#1c1e24", [...tireStack(0, 0)], [0, 0.84, 0]),
  trackProp("tire_wall", "Muro de pneus", "#1c1e24", [
    ...tireStack(-0.6, 0),
    ...tireStack(0, 0),
    ...tireStack(0.6, 0),
  ], [0, 0.84, 0]),
  trackProp("cone", "Cone", "#f26b1d", [
    box([0.4, 0.03, 0.4], { at: [0, 0.015, 0], color: "#1c1e24" }),
    cylinder(0.03, 0.16, 0.55, 14, { at: [0, 0.3, 0] }),
    cylinder(0.083, 0.11, 0.1, 14, { at: [0, 0.3, 0], color: WHITE }),
  ], [0, 0.58, 0]),
  trackProp("gate", "Pórtico de largada", "#22242c", [
    ...[-4.8, 4.8].map((x) => box([0.4, 6, 0.4], { at: [x, 3, 0] })),
    box([10, 1.2, 0.4], { at: [0, 6.4, 0] }),
    ...Array.from({ length: 20 }, (_, index) =>
      box([0.5, 0.3, 0.02], {
        at: [-4.75 + index * 0.5, index % 2 === 0 ? 6.6 : 6.3, 0.21],
        color: WHITE,
      }),
    ),
  ], [0, 7, 0]),
  trackProp("checkpoint", "Arco de checkpoint", "#1ef5a6", [
    ...[-4.8, 4.8].map((x) => cylinder(0.2, 0.25, 5, 12, { at: [x, 2.5, 0] })),
    box([10, 0.5, 0.3], { at: [0, 5.2, 0] }),
    box([3.4, 0.9, 0.08], { at: [0, 5.2, 0.17], color: "#14181f" }),
  ], [0, 5.5, 0]),
  trackProp("flag_checker", "Bandeira", "#f4f1ea", [...flag(0, 3.5, WHITE)], [0, 3.5, 0]),
  trackProp("flag_red", "Bandeira vermelha", RED, [...flag(0, 3.5, RED)], [0, 3.5, 0]),
  trackProp("jump", "Rampa de salto", "#d6a12b", [
    extrude(
      [
        [-2.2, 0],
        [2.2, 0],
        [2.2, 0.95],
        [1.6, 0.92],
        [0.4, 0.5],
        [-1.2, 0.12],
      ],
      6,
      0.02,
    ),
    ...[-2, -1, 0, 1, 2].map((x) =>
      box([0.12, 0.02, 1.2], { at: [x, 0.62, 0.9], rot: [-22, 0, 0], color: "#2b2f38" }),
    ),
  ], [0, 0.95, 1.9]),
  trackProp("grandstand", "Arquibancada", "#3f8cff", [
    extrude(
      [
        [2.3, 0],
        [2.3, 0.5],
        ...grandstandSteps,
        [-2.5, 3.8],
        [-2.8, 3.8],
        [-2.8, 0],
      ],
      12,
      0,
    ),
    ...[-5.6, 0, 5.6].map((x) => box([0.25, 3.6, 0.25], { at: [x, 5.5, -2.65], color: "#6d7480" })),
    box([12.4, 0.2, 5.2], { at: [0, 7.35, -0.3], rot: [-6, 0, 0], color: "#d9dde3" }),
  ], [0, 3.8, -2.65]),
  trackProp("billboard", "Placa de patrocínio", "#e0a81f", [
    ...[-2.2, 2.2].map((x) => box([0.15, 4, 0.15], { at: [x, 2, 0], color: "#6d7480" })),
    roundedBox([6, 2.2, 0.15], 0.05, { at: [0, 4.2, 0] }),
    box([4.6, 1.2, 0.02], { at: [0, 4.2, 0.085], color: "#14181f" }),
  ], [0, 5.3, 0]),
  trackProp("pit", "Box da pista", "#d9dde3", [
    box([12, 3.4, 5], { at: [0, 1.7, 0] }),
    box([12.6, 0.3, 6.2], { at: [0, 3.55, 0.5], shade: 0.8 }),
    ...[-4, 0, 4].map((x) => box([3.2, 2.6, 0.05], { at: [x, 1.3, 2.52], color: "#2b2f38" })),
    ...[-2, 2].map((x) => box([0.3, 3.2, 0.3], { at: [x, 1.6, 3.2], color: "#6d7480" })),
  ], [0, 3.7, 0]),
  trackProp("spectator_light", "Torre de luz", "#6d7480", [
    cylinder(0.12, 0.2, 12, 10, { at: [0, 6, 0] }),
    box([3, 1.2, 0.25], { at: [0, 12.4, 0] }),
    ...[-1, 0, 1].map((x) =>
      capsule(0.2, 0.4, { at: [x, 12.4, 0.2], rot: [0, 0, 90], color: "#fff3c4" }),
    ),
  ], [0, 13, 0]),
];
