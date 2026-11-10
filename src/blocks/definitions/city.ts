import type { BlockDef, Point, ShapePiece, Vec3 } from "../types.ts";
import {
  block,
  box,
  capsule,
  compound,
  cylinder,
  extrude,
  roundedBox,
  socket,
  sphere,
  torus,
} from "./helpers.ts";

export const BUILDING_WIDTH = 7;
export const FLOOR_HEIGHT = 3.2;
export const HOUSE_WIDTH = 6;
export const HOUSE_HEIGHT = 3;

const GLASS = "#2a4258";
const GLASS_LIGHT = "#6f9bb8";
const FRAME = "#e8e4d8";
const DARK = "#22242c";
const METAL = "#6d7480";
const WOOD = "#7a5230";

const half = BUILDING_WIDTH / 2;

const stackSockets = (height: number) => [
  socket("bottom", [0, 0, 0], [0, -1, 0]),
  socket("top", [0, height, 0], [0, 1, 0]),
];

/** Repeats details on all four walls. `build` works on the front wall, at z = 0. */
function aroundWalls(
  depth: number,
  build: (offsetZ: number) => ShapePiece[],
  sides: number[] = [0, 90, 180, 270],
): ShapePiece[] {
  return sides.flatMap((angle) => {
    const radians = (angle * Math.PI) / 180;
    return build(depth).map((piece) => {
      const [x, y, z] = piece.at ?? [0, 0, 0];
      return {
        ...piece,
        at: [
          x * Math.cos(radians) + z * Math.sin(radians),
          y,
          -x * Math.sin(radians) + z * Math.cos(radians),
        ] as Vec3,
        rot: [0, angle, 0] as Vec3,
      };
    });
  });
}

function framedWindow(x: number, y: number, z: number, w: number, h: number): ShapePiece[] {
  return [
    box([w + 0.18, h + 0.18, 0.06], { at: [x, y, z], color: FRAME }),
    box([w + 0.34, 0.1, 0.2], { at: [x, y - h / 2 - 0.13, z + 0.06], color: FRAME }),
    box([w + 0.3, 0.14, 0.12], { at: [x, y + h / 2 + 0.15, z + 0.03], shade: 0.78 }),
    box([w, h, 0.09], { at: [x, y, z + 0.005], color: GLASS, finish: "glass" }),
    box([0.05, h, 0.11], { at: [x, y, z + 0.012], color: FRAME }),
    box([w, 0.05, 0.11], { at: [x, y + h * 0.18, z + 0.012], color: FRAME }),
  ];
}

function floorModule(id: string, name: string, color: string, details: ShapePiece[]): BlockDef {
  return block(
    `building.${id}`,
    name,
    "building",
    color,
    compound(
      box([BUILDING_WIDTH, FLOOR_HEIGHT, BUILDING_WIDTH], { at: [0, FLOOR_HEIGHT / 2, 0] }),
      box([BUILDING_WIDTH + 0.08, 0.12, BUILDING_WIDTH + 0.08], {
        at: [0, FLOOR_HEIGHT - 0.06, 0],
        shade: 0.8,
      }),
      box([BUILDING_WIDTH + 0.2, 0.07, BUILDING_WIDTH + 0.2], {
        at: [0, FLOOR_HEIGHT - 0.02, 0],
        shade: 0.68,
      }),
      ...[1, -1].flatMap((x) =>
        [1, -1].map((z) =>
          box([0.3, FLOOR_HEIGHT - 0.14, 0.3], {
            at: [(x * BUILDING_WIDTH) / 2, FLOOR_HEIGHT / 2 - 0.05, (z * BUILDING_WIDTH) / 2],
            shade: 0.86,
          }),
        ),
      ),
      details,
    ),
    stackSockets(FLOOR_HEIGHT),
  );
}

const windows3 = aroundWalls(half + 0.01, (z) =>
  [-2.2, 0, 2.2].flatMap((x) => framedWindow(x, 1.65, z, 1.2, 1.5)),
);

const narrowWindows = aroundWalls(half + 0.01, (z) =>
  [-2.5, -1.25, 0, 1.25, 2.5].flatMap((x) => framedWindow(x, 1.65, z, 0.55, 1.9)),
);

const ribbon = aroundWalls(half + 0.01, (z) => [
  box([6.56, 1.46, 0.05], { at: [0, 1.7, z], color: FRAME }),
  box([6.4, 1.3, 0.08], { at: [0, 1.7, z + 0.005], color: GLASS, finish: "glass" }),
  box([6.8, 0.1, 0.22], { at: [0, 0.92, z + 0.08], shade: 0.78 }),
  ...[-2.4, -1.2, 0, 1.2, 2.4].map((x) =>
    box([0.07, 1.3, 0.1], { at: [x, 1.7, z + 0.012], color: FRAME }),
  ),
]);

const curtain = aroundWalls(half + 0.005, (z) => [
  box([6.92, 3.0, 0.05], { at: [0, 1.6, z], color: GLASS, finish: "glass" }),
  ...[-2.625, -1.75, -0.875, 0, 0.875, 1.75, 2.625].map((x) =>
    box([0.05, 3.0, 0.07], { at: [x, 1.6, z + 0.01], color: "#b9c2cc" }),
  ),
  box([6.92, 0.06, 0.07], { at: [0, 1.6, z + 0.01], color: "#b9c2cc" }),
]);

const balconies = [
  ...aroundWalls(half + 0.01, (z) =>
    [-2.2, 0, 2.2].flatMap((x) => framedWindow(x, 1.65, z, 1.2, 1.5)),
  [90, 180, 270]),
  ...[-2.2, 0, 2.2].flatMap((x) => [
    ...framedWindow(x, 1.65, half + 0.01, 1.2, 1.5),
    box([1.8, 0.1, 0.8], { at: [x, 0.62, half + 0.4], shade: 0.85 }),
    box([1.8, 0.7, 0.05], { at: [x, 1.0, half + 0.78], color: DARK }),
    ...[1, -1].map((side) =>
      box([0.05, 0.7, 0.75], { at: [x + side * 0.88, 1.0, half + 0.4], color: DARK }),
    ),
  ]),
];

const shopFront: ShapePiece[] = [
  box([3.2, 2.46, 0.05], { at: [1.6, 1.45, half + 0.005], color: DARK }),
  box([3.0, 2.3, 0.08], { at: [1.6, 1.45, half + 0.01], color: GLASS_LIGHT, finish: "glass" }),
  box([0.08, 2.3, 0.1], { at: [1.6, 1.45, half + 0.02], color: DARK }),
  box([3.1, 0.3, 0.14], { at: [1.6, 0.18, half + 0.05], color: DARK }),
  box([1.5, 2.42, 0.05], { at: [-2.1, 1.21, half + 0.005], color: DARK }),
  box([1.3, 2.3, 0.08], { at: [-2.1, 1.25, half + 0.01], color: GLASS, finish: "glass" }),
  box([0.05, 0.4, 0.14], { at: [-1.6, 1.15, half + 0.05], color: "#d6b24a", finish: "metal" }),
];

const awning: ShapePiece[] = Array.from({ length: 7 }, (_, index) =>
  box([0.86, 0.1, 1.1], {
    at: [-2.6 + index * 0.87, 2.82, half + 0.5],
    rot: [18, 0, 0],
    ...(index % 2 === 0 ? { shade: 0.75 } : { color: "#f4f1ea" }),
  }),
);

const sign: ShapePiece[] = [
  roundedBox([4.2, 0.55, 0.1], 0.03, { at: [0, 3.0, half + 0.06], color: DARK }),
];

const officeEntry: ShapePiece[] = [
  box([3.6, 2.6, 0.08], { at: [0, 1.4, half + 0.01], color: GLASS, finish: "glass" }),
  ...[-1.8, -0.6, 0.6, 1.8].map((x) =>
    box([0.08, 2.6, 0.1], { at: [x, 1.4, half + 0.02], color: "#b9c2cc" }),
  ),
  box([4.6, 0.25, 1.2], { at: [0, 2.85, half + 0.6], shade: 0.75 }),
  ...[-2.2, 2.2].map((x) => cylinder(0.08, 0.08, 2.7, 10, { at: [x, 1.35, half + 1.1], color: METAL })),
];

const parapet: ShapePiece[] = [
  box([BUILDING_WIDTH + 0.1, 0.1, BUILDING_WIDTH + 0.1], { at: [0, 0.05, 0], color: "#55595f" }),
  ...aroundWalls(0, () => [
    box([BUILDING_WIDTH + 0.1, 0.55, 0.2], { at: [0, 0.3, half - 0.05] }),
  ]),
];

const acUnit = (x: number, z: number): ShapePiece[] => [
  box([1.2, 0.7, 0.9], { at: [x, 0.45, z], color: "#b9c2cc" }),
  torus(0.26, 0.03, { at: [x, 0.8, z], rot: [90, 0, 0], color: METAL }),
];

function roof(id: string, name: string, color: string, pieces: ShapePiece[], top = 1): BlockDef {
  return block(`building.${id}`, name, "building", color, compound(pieces), stackSockets(top));
}

const gableOutline = (w: number, h: number): Point[] => [
  [-w / 2 - 0.3, 0],
  [w / 2 + 0.3, 0],
  [0, h],
];

const houseWidth = HOUSE_WIDTH / 2;
const houseWindows = aroundWalls(houseWidth + 0.01, (z) =>
  [-1.5, 1.5].flatMap((x) => framedWindow(x, 1.6, z, 1.05, 1.15)),
);
const houseBody = (color: string, id: string, name: string, door: string): BlockDef =>
  block(
    `building.${id}`,
    name,
    "building",
    color,
    compound(
      box([HOUSE_WIDTH, HOUSE_HEIGHT, HOUSE_WIDTH], { at: [0, HOUSE_HEIGHT / 2, 0] }),
      box([HOUSE_WIDTH + 0.08, 0.3, HOUSE_WIDTH + 0.08], { at: [0, 0.15, 0], shade: 0.75 }),
      houseWindows.filter((piece) => {
        const [x, , z] = piece.at ?? [0, 0, 0];
        return !(Math.abs(z - (houseWidth + 0.01)) < 0.2 && x > 0);
      }),
      box([1.15, 2.2, 0.1], { at: [1.5, 1.1, houseWidth + 0.02], color: door }),
      sphere(0.05, { at: [1.15, 1.1, houseWidth + 0.09], color: "#d6b24a" }),
      box([1.5, 0.15, 0.9], { at: [1.5, 0.08, houseWidth + 0.45], color: "#b9bdc4" }),
    ),
    stackSockets(HOUSE_HEIGHT),
  );

function prop(
  id: string,
  name: string,
  color: string,
  pieces: ShapePiece[],
  top = 1,
): BlockDef {
  return block(`city.${id}`, name, "city", color, compound(pieces), stackSockets(top));
}

const trafficHead: ShapePiece[] = [
  roundedBox([0.32, 0.86, 0.26], 0.05, { at: [0, 4.15, 1.1], color: DARK }),
  sphere(0.095, { at: [0, 4.42, 1.24], scale: [1, 1, 0.5], color: "#ff3a44", finish: "glow" }),
  sphere(0.095, { at: [0, 4.15, 1.24], scale: [1, 1, 0.5], color: "#ffc93a", finish: "glow" }),
  sphere(0.095, { at: [0, 3.88, 1.24], scale: [1, 1, 0.5], color: "#44e07a", finish: "glow" }),
];

const benchSlats = [0.04, 0.2, 0.36].map((z) =>
  box([1.7, 0.05, 0.13], { at: [0, 0.46, z - 0.2], color: WOOD }),
);

const fenceSlats = Array.from({ length: 9 }, (_, index) =>
  box([0.13, 1.0, 0.04], { at: [-1.8 + index * 0.45, 0.5, 0] }),
);

export const cityBlocks: BlockDef[] = [
  floorModule("floor_windows", "Andar com janelas", "#b8876a", windows3),
  floorModule("floor_narrow", "Andar clássico", "#c9b89a", narrowWindows),
  floorModule("floor_ribbon", "Andar com faixa", "#d6d8dc", ribbon),
  floorModule("floor_curtain", "Andar de vidro", "#8d98a6", curtain),
  floorModule("floor_balcony", "Andar com sacadas", "#a8c0b0", balconies),
  floorModule("ground_shop", "Térreo com loja", "#c96a4a", [...shopFront, ...awning, ...sign]),
  floorModule("ground_cafe", "Térreo com café", "#5a7f73", [...shopFront, ...sign, box([6, 0.35, 0.02], { at: [0, 0.2, half + 0.02], shade: 0.7 })]),
  floorModule("ground_office", "Térreo comercial", "#d6d8dc", officeEntry),
  roof("roof_flat", "Laje com muretas", "#d6d8dc", [...parapet, ...acUnit(1.5, -1.2)], 0.6),
  roof(
    "roof_tank",
    "Laje com caixa d'água",
    "#d6d8dc",
    [
      ...parapet,
      ...[-0.7, 0.7].flatMap((x) => [-0.7, 0.7].map((z) => cylinder(0.06, 0.06, 1.4, 8, { at: [x - 1, 0.7, z + 1], color: METAL }))),
      cylinder(1.05, 1.05, 1.6, 16, { at: [-1, 2.1, 1], color: WOOD }),
      cylinder(0, 1.15, 0.6, 16, { at: [-1, 3.2, 1], color: "#55595f" }),
    ],
    0.6,
  ),
  roof(
    "roof_antenna",
    "Laje com antena",
    "#d6d8dc",
    [
      ...parapet,
      ...acUnit(-1.8, 1.2),
      cylinder(0.04, 0.12, 6, 8, { at: [1.2, 3, -1.2], color: METAL }),
      ...[4, 5].map((y) => box([0.9, 0.04, 0.04], { at: [1.2, y, -1.2], color: METAL })),
    ],
    0.6,
  ),
  roof(
    "roof_helipad",
    "Heliponto",
    "#55595f",
    [
      ...parapet,
      cylinder(2.6, 2.6, 0.06, 28, { at: [0, 0.2, 0], color: "#3a3d44" }),
      torus(2.3, 0.05, { at: [0, 0.24, 0], rot: [90, 0, 0], color: "#f0c94a" }),
      box([0.28, 0.03, 1.6], { at: [-0.5, 0.245, 0], color: "#f4f1ea" }),
      box([0.28, 0.03, 1.6], { at: [0.5, 0.245, 0], color: "#f4f1ea" }),
      box([1.0, 0.03, 0.26], { at: [0, 0.245, 0], color: "#f4f1ea" }),
    ],
    0.6,
  ),
  roof("roof_hip", "Telhado de quatro águas", "#a64b35", [
    { shape: { kind: "frustum", bottom: [BUILDING_WIDTH + 0.7, BUILDING_WIDTH + 0.7], top: [1.5, 1.5], height: 2.2 }, at: [0, 1.1, 0] },
  ], 2.2),

  houseBody("#e8d6b0", "house_body", "Casa", "#7a3b2e"),
  houseBody("#b7cfc0", "house_body_green", "Casa verde", "#2d4a60"),
  roof(
    "house_gable",
    "Telhado de casa",
    "#a64b35",
    [
      extrude(gableOutline(HOUSE_WIDTH, 2.1), HOUSE_WIDTH + 0.6, 0.02),
      extrude(gableOutline(HOUSE_WIDTH - 0.3, 1.82), HOUSE_WIDTH + 0.62, 0, { color: "#e8e4d8", at: [0, 0.02, 0] }),
      box([0.9, 1.5, 0.9], { at: [1.3, 1.9, -1.2], color: "#8c5a44" }),
      box([1.05, 0.15, 1.05], { at: [1.3, 2.68, -1.2], color: "#55595f" }),
    ],
    2.1,
  ),

  prop("lamp", "Poste de luz", METAL, [
    cylinder(0.14, 0.2, 0.3, 10, { at: [0, 0.15, 0] }),
    cylinder(0.05, 0.08, 5, 10, { at: [0, 2.5, 0] }),
    capsule(0.05, 1.1, { at: [0, 5.05, 0.5], rot: [90, 0, 0] }),
    roundedBox([0.28, 0.1, 0.6], 0.03, { at: [0, 4.98, 1.05], color: "#2b2f38" }),
    box([0.2, 0.02, 0.48], { at: [0, 4.92, 1.05], color: "#fff3c4", finish: "glow" }),
  ], 5.1),
  prop("traffic_light", "Semáforo", DARK, [
    cylinder(0.06, 0.09, 4.6, 10, { at: [0, 2.3, 0] }),
    box([0.1, 0.1, 1.15], { at: [0, 4.55, 0.55] }),
    ...trafficHead,
  ], 4.6),
  prop("bench", "Banco", METAL, [
    ...benchSlats,
    box([1.7, 0.13, 0.05], { at: [0, 0.68, -0.32], rot: [-12, 0, 0], color: WOOD }),
    box([1.7, 0.13, 0.05], { at: [0, 0.86, -0.36], rot: [-12, 0, 0], color: WOOD }),
    ...[0.7, -0.7].flatMap((x) => [
      box([0.06, 0.46, 0.5], { at: [x, 0.23, 0] }),
      box([0.06, 0.5, 0.05], { at: [x, 0.7, -0.33], rot: [-12, 0, 0] }),
    ]),
  ], 0.95),
  prop("trash", "Lixeira", "#3f7d5a", [
    cylinder(0.27, 0.23, 0.85, 16, { at: [0, 0.425, 0] }),
    cylinder(0.3, 0.3, 0.1, 16, { at: [0, 0.9, 0], shade: 0.7 }),
  ], 0.95),
  prop("hydrant", "Hidrante", "#d62f3a", [
    cylinder(0.14, 0.17, 0.08, 12, { at: [0, 0.04, 0], shade: 0.8 }),
    cylinder(0.11, 0.12, 0.55, 12, { at: [0, 0.35, 0] }),
    sphere(0.12, { at: [0, 0.62, 0], scale: [1, 0.7, 1] }),
    ...[1, -1].map((side) =>
      cylinder(0.05, 0.05, 0.3, 8, { at: [side * 0.13, 0.4, 0], rot: [0, 0, 90], shade: 0.8 }),
    ),
  ], 0.72),
  prop("stop_sign", "Placa de pare", METAL, [
    cylinder(0.035, 0.035, 2.6, 8, { at: [0, 1.3, 0] }),
    cylinder(0.42, 0.42, 0.04, 8, { at: [0, 2.6, 0.06], rot: [90, 22.5, 0], color: "#d62f3a" }),
    cylinder(0.34, 0.34, 0.045, 8, { at: [0, 2.6, 0.07], rot: [90, 22.5, 0], color: "#f4f1ea" }),
    cylinder(0.3, 0.3, 0.05, 8, { at: [0, 2.6, 0.075], rot: [90, 22.5, 0], color: "#d62f3a" }),
  ], 3),
  prop("bus_stop", "Ponto de ônibus", METAL, [
    ...[-1.7, 1.7].flatMap((x) => [box([0.08, 2.5, 0.08], { at: [x, 1.25, -0.5] })]),
    box([3.8, 0.1, 1.5], { at: [0, 2.55, 0], rot: [4, 0, 0], color: "#d9dde3" }),
    box([3.4, 1.9, 0.04], { at: [0, 1.35, -0.5], color: GLASS_LIGHT }),
    box([2, 0.06, 0.4], { at: [0, 0.48, -0.25], color: WOOD }),
    ...[-0.8, 0.8].map((x) => box([0.06, 0.48, 0.3], { at: [x, 0.24, -0.25] })),
  ], 2.6),
  prop("mailbox", "Caixa de correio", "#d8a12b", [
    box([0.1, 1, 0.1], { at: [0, 0.5, 0], color: METAL }),
    extrude(
      [
        [-0.24, 0],
        [0.24, 0],
        [0.24, 0.22],
        [0, 0.34],
        [-0.24, 0.22],
      ],
      0.42,
      0.015,
      { at: [0, 1, 0] },
    ),
  ], 1.35),
  prop("fence", "Cerca", "#efece4", [
    ...fenceSlats,
    box([3.9, 0.08, 0.03], { at: [0, 0.3, -0.03] }),
    box([3.9, 0.08, 0.03], { at: [0, 0.75, -0.03] }),
  ], 1),
  prop("planter", "Floreira", "#a06a3a", [
    box([2, 0.5, 0.6], { at: [0, 0.25, 0] }),
    box([1.85, 0.08, 0.45], { at: [0, 0.48, 0], color: "#3a2a1e" }),
    ...[-0.65, -0.3, 0.05, 0.42, 0.72].map((x, index) =>
      sphere(0.18, { at: [x, 0.62, index % 2 ? 0.05 : -0.05], color: index % 2 ? "#e93d82" : "#3fae5a" }),
    ),
  ], 0.8),
  prop("crate", "Caixote", "#b98a55", [
    box([1, 1, 1], { at: [0, 0.5, 0] }),
    ...[0.05, 0.5, 0.95].map((y) => box([1.03, 0.1, 1.03], { at: [0, y, 0], shade: 0.8 })),
    box([1.02, 1.2, 0.05], { at: [0, 0.5, 0.5], rot: [0, 0, 45], shade: 0.8 }),
  ], 1),
  prop("barrel", "Barril", "#a06a3a", [
    { shape: { kind: "lathe", profile: [[0, 0], [0.24, 0], [0.3, 0.2], [0.32, 0.45], [0.3, 0.7], [0.24, 0.9], [0, 0.9]], segments: 16 } },
    ...[0.16, 0.74].map((y) => cylinder(0.31, 0.31, 0.05, 16, { at: [0, y, 0], color: METAL })),
  ], 0.9),
];
