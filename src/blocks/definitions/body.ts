import type { BlockDef, Bump, LoftRing, ShapePiece, Vec3 } from "../types.ts";
import {
  block,
  compound,
  cylinder,
  loft,
  lumpy,
  lathe,
  roundedBox,
  socket,
  sphere,
  torus,
  tube,
} from "./helpers.ts";

const SKIN = "#e0ac83";
const SHIRT = "#3f8cff";
const PANTS = "#2d3a55";
const HAIR = "#4a2f1d";
const WHITE = "#f4f1ea";
const DARK = "#1b1f2a";
const GOLD = "#d9b24a";
const RAD = Math.PI / 180;

// Character's left is +X, facing +Z. Limbs start at their top joint and extend downward.
// Each block matches one animation bone, so a character made of them can be animated later.

const both = (x: number, y: number, z: number, radius: number, height: number, stretch?: Vec3): Bump[] => [
  { at: [x, y, z], radius, height, stretch },
  { at: [-x, y, z], radius, height, stretch },
];

function limb(
  id: string,
  name: string,
  color: string,
  rings: LoftRing[],
  top: string,
  end: string,
  length: number,
  bumps: Bump[] = [],
): BlockDef {
  return block(`body.${id}`, name, "body", color, compound(loft(rings, { bumps, segments: 20, steps: 3 })), [
    socket(top, [0, 0, 0], [0, 1, 0]),
    socket(end, [0, -length, 0], [0, -1, 0]),
  ]);
}

// --- torso -------------------------------------------------------------------------------

const hipsRings: LoftRing[] = [
  [-0.235, 0.05, 0.05, 2],
  [-0.225, 0.13, 0.09, 3],
  [-0.18, 0.164, 0.105, 2.7],
  [-0.125, 0.17, 0.112, 2.4],
  [-0.055, 0.166, 0.11, 2.4],
  [-0.01, 0.152, 0.102, 2.4],
  [0.012, 0.11, 0.075, 2.2],
  [0.018, 0.02, 0.02, 2],
];

const torsoRings: LoftRing[] = [
  [-0.01, 0.1, 0.07, 2.2],
  [0, 0.15, 0.1, 2.4],
  [0.07, 0.152, 0.1, 2.4],
  [0.18, 0.165, 0.11, 2.3],
  [0.3, 0.198, 0.127, 2.3],
  [0.39, 0.21, 0.128, 2.4],
  [0.45, 0.188, 0.105, 2.3],
  [0.485, 0.11, 0.075, 2],
  [0.502, 0.04, 0.04, 2],
];

const chestShape: Bump[] = [
  ...both(0.085, 0.33, 0.125, 0.075, 0.012),
  ...both(0.09, 0.34, -0.125, 0.07, 0.008),
  { at: [0, 0.3, -0.13], radius: 0.05, height: -0.007, stretch: [0.5, 3, 1] },
  { at: [0, 0.16, 0.108], radius: 0.05, height: 0.004 },
  // Soft folds so fabric doesn't read as one smooth balloon.
  ...both(0.11, 0.1, 0.09, 0.05, -0.0045, [1.6, 0.4, 1]),
  ...both(0.075, 0.2, 0.11, 0.05, -0.0035, [1.4, 0.35, 1]),
];

const torsoBase = (extra: Omit<ShapePiece, "shape"> = {}) =>
  loft(torsoRings, { bumps: chestShape, segments: 36, steps: 4, ...extra });

const torsoSockets = [
  socket("waist", [0, 0, 0], [0, -1, 0]),
  socket("neck", [0, 0.49, 0], [0, 1, 0]),
  socket("shoulder_left", [0.2, 0.415, 0], [0.38, -0.92, 0]),
  socket("shoulder_right", [-0.2, 0.415, 0], [-0.38, -0.92, 0]),
  socket("back", [0, 0.3, -0.125], [0, 0, -1]),
  socket("chest", [0, 0.33, 0.128], [0, 0, 1]),
];

function torso(id: string, name: string, color: string, details: ShapePiece[] = []): BlockDef {
  return block(`body.torso_${id}`, name, "body", color, compound(torsoBase(), details), torsoSockets);
}

const hem = (options: Omit<ShapePiece, "shape"> = {}) =>
  loft(
    [
      [0, 0.1, 0.07, 2.2],
      [0.002, 0.156, 0.106, 2.4],
      [0.035, 0.156, 0.106, 2.4],
      [0.037, 0.1, 0.07, 2.2],
    ],
    { shade: 0.82, segments: 48, steps: 2, ...options },
  );

const collarRing = (radius: number, y: number, color?: string) =>
  torus(radius, 0.013, {
    at: [0, y, 0],
    rot: [90, 0, 0],
    scale: [1.05, 0.9, 1],
    ...(color ? { color } : { shade: 0.8 }),
  });

/** How far forward the chest reaches at a given height, so details lie on the fabric. */
const FRONT: [number, number][] = [
  [0, 0.102],
  [0.07, 0.104],
  [0.18, 0.117],
  [0.3, 0.13],
  [0.39, 0.13],
  [0.44, 0.11],
  [0.47, 0.088],
];

function frontZ(y: number): number {
  for (let i = 0; i < FRONT.length - 1; i++) {
    const [y0, z0] = FRONT[i];
    const [y1, z1] = FRONT[i + 1];
    if (y <= y1) return z0 + ((z1 - z0) * (y - y0)) / (y1 - y0);
  }
  return FRONT[FRONT.length - 1][1];
}

/** A thin plate that follows the chest, for shirt fronts and ties. */
function chestPlate(
  widths: [number, number][],
  thickness: number,
  lift: number,
  options: Omit<ShapePiece, "shape">,
): ShapePiece {
  return loft(
    widths.map(([y, halfWidth]): LoftRing => [y, halfWidth, thickness, 6, frontZ(y) + lift]),
    { segments: 24, steps: 4, ...options },
  );
}

const placketStrip = (color: string): ShapePiece =>
  chestPlate(
    [
      [0.02, 0.03],
      [0.18, 0.03],
      [0.3, 0.032],
      [0.39, 0.032],
      [0.465, 0.03],
    ],
    0.005,
    0.002,
    { color },
  );

function collarFlap(side: number, color?: string): ShapePiece {
  return loft(
    [
      [-0.04, 0.003, 0.003, 2, 0.132],
      [-0.03, 0.017, 0.0035, 4, 0.128],
      [0.012, 0.024, 0.0035, 4, 0.112],
      [0.034, 0.016, 0.003, 3, 0.098],
    ],
    {
      at: [side * 0.032, 0.438, 0],
      rot: [0, 0, side * 22],
      segments: 20,
      steps: 3,
      ...(color ? { color } : { shade: 0.9 }),
    },
  );
}

const lapels = (): ShapePiece[] =>
  [1, -1].map((side) =>
    loft(
      [
        [-0.13, 0.003, 0.003, 2, 0.116],
        [-0.1, 0.018, 0.004, 4, 0.12],
        [0, 0.03, 0.004, 4, 0.136],
        [0.075, 0.03, 0.004, 4, 0.132],
        [0.125, 0.018, 0.0035, 3, 0.112],
      ],
      { at: [side * 0.056, 0.32, 0], rot: [0, side * 14, side * -9], segments: 20, steps: 4, shade: 0.72 },
    ),
  );

const buttonRow = (ys: number[], color = DARK, lift = 0.013) =>
  ys.map((y) =>
    cylinder(0.009, 0.009, 0.005, 16, { at: [0, y, frontZ(y) + lift], rot: [90, 0, 0], color }),
  );

const chestPocket = (shade: number): ShapePiece =>
  roundedBox([0.075, 0.08, 0.006], 0.002, { at: [0.09, 0.3, 0.13], rot: [0, 18, 0], shade });

const necktie = (color: string): ShapePiece[] => [
  chestPlate(
    [
      [0.17, 0.002],
      [0.19, 0.03],
      [0.3, 0.026],
      [0.42, 0.014],
      [0.45, 0.016],
    ],
    0.004,
    0.008,
    { color, finish: "gloss" },
  ),
  sphere(0.019, { at: [0, 0.455, 0.104], scale: [1, 0.9, 0.7], color, finish: "gloss" }),
];

const hood: ShapePiece = loft(
  [
    [0.4, 0.05, 0.05, 2, -0.1],
    [0.44, 0.13, 0.095, 2.2, -0.12],
    [0.5, 0.135, 0.11, 2.2, -0.125],
    [0.56, 0.11, 0.1, 2.2, -0.12],
    [0.6, 0.05, 0.05, 2, -0.11],
  ],
  { shade: 0.88, segments: 28 },
);

const drawstring = (side: number): ShapePiece =>
  tube(
    [
      [side * 0.05, 0.46, 0.098],
      [side * 0.052, 0.4, 0.14],
      [side * 0.05, 0.33, 0.15],
    ],
    [0.0045, 0.0045, 0.0055],
    { color: WHITE, radial: 6 },
  );

// --- head ---------------------------------------------------------------------------------

const eyeSockets = {
  neck: socket("neck", [0, 0, 0], [0, -1, 0]),
  top: socket("top", [0, 0.27, 0], [0, 1, 0]),
  eyes: socket("eyes", [0, 0.15, 0.112], [0, 0, 1]),
  brows: socket("brows", [0, 0.178, 0.112], [0, 0.15, 1]),
  nose: socket("nose", [0, 0.125, 0.118], [0, 0, 1]),
  mouth: socket("mouth", [0, 0.074, 0.106], [0, -0.08, 1]),
  chin: socket("chin", [0, 0.05, 0.092], [0, 0, 1]),
  earLeft: socket("ear_left", [0.11, 0.14, 0], [1, 0, 0]),
  earRight: socket("ear_right", [-0.11, 0.14, 0], [-1, 0, 0]),
};
const headSockets = Object.values(eyeSockets);

interface HeadSpec {
  id: string;
  name: string;
  width: number;
  jaw: number;
  chin: number;
  depth: number;
}

const faceSculpt: Bump[] = [
  ...both(0.05, 0.149, 0.112, 0.024, -0.011, [1.2, 0.8, 1]),
  ...both(0.046, 0.181, 0.116, 0.03, 0.004, [1.3, 0.5, 1]),
  ...both(0.078, 0.112, 0.09, 0.03, 0.006),
  { at: [0, 0.15, 0.122], radius: 0.016, height: 0.006, stretch: [0.8, 1.6, 1] },
  { at: [0, 0.095, 0.112], radius: 0.014, height: -0.002, stretch: [0.7, 0.8, 1] },
  { at: [0, 0.07, 0.106], radius: 0.03, height: 0.003, stretch: [1.2, 0.7, 1] },
  { at: [0, 0.036, 0.086], radius: 0.022, height: 0.006 },
  ...both(0.108, 0.17, 0.03, 0.03, -0.003),
];

function head({ id, name, width, jaw, chin, depth }: HeadSpec): BlockDef {
  const rings: LoftRing[] = [
    [0, 0.01, 0.015, 2, 0.02],
    [0.01, 0.042 * chin, 0.055, 2.2, 0.024],
    [0.038, 0.072 * jaw, 0.08 * depth, 2.3, 0.012],
    [0.075, 0.094 * jaw, 0.099 * depth, 2.3, 0.004],
    [0.115, 0.106 * width, 0.112 * depth, 2.2, 0],
    [0.155, 0.111 * width, 0.12 * depth, 2.2, -0.002],
    [0.2, 0.106 * width, 0.118 * depth, 2.1, -0.006],
    [0.24, 0.085 * width, 0.096 * depth, 2, -0.008],
    [0.262, 0.045, 0.05, 2, -0.008],
    [0.27, 0.006, 0.008, 2, -0.008],
  ];
  return block(
    `body.head_${id}`,
    name,
    "body",
    SKIN,
    compound(loft(rings, { bumps: faceSculpt, segments: 52, steps: 5 })),
    headSockets,
  );
}

// --- face ---------------------------------------------------------------------------------

const pair = (build: (side: number) => ShapePiece[]) => [...build(1), ...build(-1)];
const EYE_DEPTH = -0.02;

interface EyeSpec {
  x?: number;
  ball?: number;
  iris?: number;
  squash?: number;
  lidDrop?: number;
}

function eyeball(side: number, spec: EyeSpec = {}): ShapePiece[] {
  const { x = 0.05, ball = 0.026, iris = 0.0145, squash = 1, lidDrop = 0 } = spec;
  const front = EYE_DEPTH + Math.sqrt(ball * ball - iris * iris) + 0.0009;
  const px = side * x;
  const lashY = ball * squash * 0.72 - lidDrop;
  return [
    sphere(ball, { at: [px, 0, EYE_DEPTH], scale: [1, squash, 1], color: WHITE, finish: "gloss" }),
    sphere(iris, { at: [px, 0, front], scale: [1, Math.min(squash * 1.05, 1), 0.3], finish: "gloss" }),
    sphere(iris * 0.46, { at: [px, 0, front + 0.003], scale: [1, Math.min(squash * 1.05, 1), 0.3], color: "#07080c", finish: "gloss" }),
    sphere(iris * 0.2, { at: [px - 0.004, 0.005 * squash, front + 0.0052], scale: [1, 1, 0.35], color: "#ffffff" }),
    tube(
      [
        [px - ball * 0.98, lashY * 0.35, EYE_DEPTH + ball * 0.42],
        [px - ball * 0.5, lashY * 0.92, EYE_DEPTH + ball * 0.84],
        [px, lashY * 1.08, EYE_DEPTH + ball * 0.97],
        [px + ball * 0.5, lashY * 0.92, EYE_DEPTH + ball * 0.84],
        [px + ball * 0.98, lashY * 0.35, EYE_DEPTH + ball * 0.42],
      ],
      [0.0009, 0.0032, 0.0038, 0.0032, 0.0009],
      { color: "#16110e", radial: 6, steps: 5 },
    ),
  ];
}

function eyes(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`face.eyes_${id}`, name, "face", "#5a3a22", compound(pieces), [
    socket("back", [0, 0, 0], [0, 0, -1]),
  ]);
}

function faceBlock(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`face.${id}`, name, "face", color, compound(pieces), [
    socket("back", [0, 0, 0], [0, 0, -1]),
  ]);
}

/** Sits on the curved face: points further from the center fall back. */
const faceZ = (x: number, curve = 5.5) => -x * x * curve;

function brow(side: number, height: number, tilt: number, thickness: number): ShapePiece[] {
  const point = (t: number): Vec3 => {
    const x = side * (0.022 + t * 0.06);
    return [x, Math.sin(t * Math.PI) * height + tilt * (t - 0.5), faceZ(x)];
  };
  return [
    tube(
      [point(0), point(0.3), point(0.6), point(1)],
      [thickness * 0.8, thickness, thickness * 0.8, thickness * 0.15],
      { radial: 6, flat: 0.6 },
    ),
  ];
}

function lipLine(width: number, curve: number, y: number): Vec3[] {
  return [-1, -0.5, 0, 0.5, 1].map((t): Vec3 => {
    const x = t * width;
    return [x, y + curve * t * t, faceZ(x, 6)];
  });
}

function lips(width: number, curve: number, fullness = 1): ShapePiece[] {
  return [
    tube(lipLine(width, curve, 0.005), [0.001, 0.0048 * fullness, 0.0058 * fullness, 0.0048 * fullness, 0.001], { radial: 8 }),
    tube(lipLine(width * 0.92, curve * 0.9, -0.0065), [0.001, 0.0062 * fullness, 0.0075 * fullness, 0.0062 * fullness, 0.001], { radial: 8 }),
    tube(lipLine(width * 0.98, curve, -0.0005), [0.0004, 0.0012, 0.0012, 0.0012, 0.0004], { color: "#3a1a1c", radial: 5 }),
  ];
}

const earSockets = [socket("base", [0, 0, 0], [1, 0, 0])];

// --- hair ---------------------------------------------------------------------------------

/** The scalp as an ellipsoid, measured from the top of the head (which is the block's origin). */
function scalp(theta: number, phi: number, lift: number): Vec3 {
  const t = theta * RAD;
  const p = phi * RAD;
  return [
    (0.118 + lift) * Math.sin(t) * Math.sin(p),
    -0.135 + (0.142 + lift) * Math.cos(t),
    (0.124 + lift) * Math.sin(t) * Math.cos(p) - 0.006,
  ];
}

/** Where hair stops by angle around the head: forehead, then temples, then nape. */
function hairline(phi: number): number {
  const a = Math.abs(phi);
  if (a < 70) return 46 + (a / 70) * 44;
  return 90 + ((a - 70) / 110) * 28;
}

interface StrandOptions {
  width?: number;
  lift?: number;
  sway?: number;
  from?: number;
  /** Extra length hanging straight down after the scalp ends. */
  drop?: number;
  curl?: number;
}

function strand(phi: number, to: number, options: StrandOptions = {}): ShapePiece {
  const { width = 0.024, lift = 0.008, sway = 0, from = 4, drop = 0, curl = 0 } = options;
  const steps = 5;
  const path: Vec3[] = [];
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    path.push(scalp(from + (to - from) * t, phi + sway * t, lift * (0.6 + t * 0.6)));
  }
  if (drop > 0) {
    const [x, y, z] = path[path.length - 1];
    const out = (phiFactor: number) => Math.sin(phiFactor * RAD);
    path.push([x * 1.03 + curl * out(phi + 90), y - drop * 0.5, z * 1.03 + curl * Math.cos((phi + 90) * RAD)]);
    path.push([x * 1.0 - curl * out(phi + 90), y - drop, z * 1.0 - curl * Math.cos((phi + 90) * RAD)]);
  }
  return tube(path, [width * 0.55, width, width * 0.95, width * 0.6, width * 0.08], {
    radial: 5,
    steps: 3,
    flat: 0.5,
  });
}

function strands(
  count: number,
  build: (phi: number, index: number) => ShapePiece | ShapePiece[],
): ShapePiece[] {
  return Array.from({ length: count }, (_, index) => build(-180 + (index / count) * 360, index)).flat();
}

const scalpCap = (): ShapePiece =>
  loft(
    [
      [-0.125, 0.09, 0.09, 2],
      [-0.1, 0.122, 0.128, 2.1],
      [-0.06, 0.122, 0.13, 2.1],
      [-0.02, 0.096, 0.104, 2],
      [0.008, 0.05, 0.056, 2],
      [0.016, 0.006, 0.006, 2],
    ],
    { at: [0, 0, -0.032], rot: [-20, 0, 0], segments: 36, steps: 3 },
  );

const layered = (count: number, to: (phi: number) => number, options: StrandOptions = {}) =>
  strands(count, (phi, index) => strand(phi, to(phi), { sway: index % 2 ? 7 : -7, ...options }));

function hair(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`hair.${id}`, name, "hair", HAIR, compound(pieces), [
    socket("base", [0, 0, 0], [0, -1, 0]),
  ]);
}

function hat(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`hair.hat_${id}`, name, "hair", color, compound(pieces), [
    socket("base", [0, 0, 0], [0, -1, 0]),
  ]);
}

const crownProfile = (radius: number, top: number, bottom = -0.075): [number, number][] => [
  [0, bottom],
  [radius, bottom],
  [radius * 1.005, bottom * 0.6],
  [radius * 0.93, bottom * 0.1],
  [radius * 0.68, top * 0.65],
  [radius * 0.34, top * 0.95],
  [0, top],
];

const hatBand = (radius: number, y: number, height: number, color: string) =>
  cylinder(radius, radius, height, 48, { at: [0, y, -0.012], color });

const curls = (seedStart: number): ShapePiece[] => {
  const spots: Vec3[] = [];
  for (let ring = 0; ring < 5; ring++) {
    const theta = 8 + ring * 22;
    const count = ring === 0 ? 3 : 7 + ring * 2;
    for (let i = 0; i < count; i++) {
      const phi = -180 + (i / count) * 360 + ring * 13;
      if (theta > hairline(phi) + 6) continue;
      spots.push(scalp(theta, phi, 0.018));
    }
  }
  return spots.map((at, index) =>
    lumpy(0.031, seedStart + index, { at, detail: 2, amount: 0.12, frequency: 4 }),
  );
};

export const bodyBlocks: BlockDef[] = [
  block(
    "body.hips",
    "Quadril",
    "body",
    PANTS,
    compound(
      loft(hipsRings, { segments: 44, steps: 5, bumps: both(0.08, -0.1, -0.11, 0.075, 0.012) }),
      loft(
        [
          [-0.025, 0.11, 0.075, 2.2],
          [-0.023, 0.158, 0.107, 2.4],
          [0.006, 0.156, 0.106, 2.4],
          [0.008, 0.11, 0.075, 2.2],
        ],
        { color: "#2a2018", segments: 44, steps: 2 },
      ),
      roundedBox([0.044, 0.036, 0.012], 0.004, { at: [0, -0.009, 0.108], color: GOLD, finish: "metal" }),
      ...pair((side) => [
        tube(
          [
            [side * 0.1, -0.03, 0.095],
            [side * 0.13, -0.075, 0.075],
            [side * 0.155, -0.1, 0.03],
          ],
          [0.002, 0.0025, 0.002],
          { shade: 0.55, radial: 5 },
        ),
      ]),
    ),
    [
      socket("waist", [0, 0, 0], [0, 1, 0]),
      socket("hip_left", [0.085, -0.14, 0], [0, -1, 0]),
      socket("hip_right", [-0.085, -0.14, 0], [0, -1, 0]),
      socket("belt", [0, 0, 0], [0, -1, 0]),
    ],
  ),

  torso("tshirt", "Camiseta", SHIRT, [hem(), collarRing(0.082, 0.468)]),
  torso("jacket", "Jaqueta", "#5b6b3a", [
    hem(),
    placketStrip(WHITE),
    ...lapels(),
    collarRing(0.085, 0.47),
    ...pair((side) => [
      roundedBox([0.09, 0.07, 0.006], 0.002, { at: [side * 0.1, 0.1, 0.099], rot: [0, side * 18, 0], shade: 0.8 }),
    ]),
  ]),
  torso("suit", "Terno", "#2c3142", [
    hem(),
    placketStrip(WHITE),
    ...necktie("#b3262e"),
    ...lapels(),
    collarRing(0.082, 0.47, WHITE),
    chestPocket(0.8),
    ...buttonRow([0.125], "#0f1118", 0.006),
  ]),
  torso("hoodie", "Moletom", "#b0413e", [
    hem(),
    hood,
    collarRing(0.09, 0.47),
    drawstring(1),
    drawstring(-1),
    roundedBox([0.22, 0.1, 0.018], 0.008, { at: [0, 0.1, 0.11], shade: 0.8 }),
  ]),
  torso("shirt", "Camisa social", "#e8e4d8", [
    hem({ shade: 0.9 }),
    chestPlate(
      [
        [0.02, 0.03],
        [0.3, 0.032],
        [0.465, 0.03],
      ],
      0.005,
      0.002,
      { shade: 0.9 },
    ),
    ...buttonRow([0.11, 0.2, 0.29, 0.38], "#8f8a7e"),
    collarFlap(1),
    collarFlap(-1),
    chestPocket(0.92),
  ]),
  torso("uniform", "Uniforme", "#23405f", [
    hem(),
    chestPlate(
      [
        [0.02, 0.03],
        [0.3, 0.032],
        [0.465, 0.03],
      ],
      0.005,
      0.002,
      { shade: 0.82 },
    ),
    ...buttonRow([0.11, 0.2, 0.29, 0.38], GOLD),
    collarFlap(1),
    collarFlap(-1),
    ...pair((side) => [
      roundedBox([0.1, 0.018, 0.06], 0.006, { at: [side * 0.19, 0.452, 0], rot: [0, 0, side * -14], color: GOLD, finish: "metal" }),
    ]),
    roundedBox([0.05, 0.06, 0.008], 0.003, { at: [-0.09, 0.335, 0.132], rot: [0, -18, 0], color: GOLD, finish: "metal" }),
    chestPocket(0.85),
  ]),

  block(
    "body.neck",
    "Pescoço",
    "body",
    SKIN,
    compound(
      loft(
        [
          [-0.03, 0.062, 0.062, 2],
          [0.0, 0.054, 0.056, 2],
          [0.04, 0.05, 0.053, 2],
          [0.075, 0.052, 0.054, 2],
          [0.082, 0.01, 0.01, 2],
        ],
        { segments: 28, steps: 4, bumps: [{ at: [0, 0.03, 0.052], radius: 0.014, height: 0.003 }] },
      ),
    ),
    [socket("base", [0, 0, 0], [0, -1, 0]), socket("head", [0, 0.055, 0], [0, 1, 0])],
  ),

  head({ id: "oval", name: "Cabeça oval", width: 1, jaw: 0.97, chin: 1, depth: 1 }),
  head({ id: "round", name: "Cabeça redonda", width: 1.07, jaw: 1.14, chin: 1.3, depth: 0.98 }),
  head({ id: "square", name: "Cabeça de queixo largo", width: 1.02, jaw: 1.2, chin: 1.65, depth: 1 }),
  head({ id: "long", name: "Cabeça fina", width: 0.93, jaw: 0.86, chin: 0.85, depth: 1.05 }),

  limb(
    "upper_arm",
    "Braço",
    SKIN,
    [
      [-0.3, 0.034, 0.034],
      [-0.27, 0.04, 0.04],
      [-0.2, 0.046, 0.048],
      [-0.12, 0.052, 0.055],
      [-0.04, 0.058, 0.059],
      [0.01, 0.056, 0.056],
      [0.04, 0.04, 0.04],
      [0.056, 0.018, 0.018],
      [0.06, 0.003, 0.003],
    ],
    "shoulder",
    "elbow",
    0.28,
  ),
  limb(
    "forearm",
    "Antebraço",
    SKIN,
    [
      [-0.27, 0.03, 0.026],
      [-0.24, 0.033, 0.03],
      [-0.16, 0.043, 0.04],
      [-0.08, 0.048, 0.045],
      [-0.02, 0.043, 0.042],
      [0.02, 0.035, 0.035],
      [0.034, 0.003, 0.003],
    ],
    "elbow",
    "wrist",
    0.26,
  ),
  block(
    "body.hand",
    "Mão",
    "body",
    SKIN,
    compound(
      loft(
        [
          [-0.1, 0.026, 0.012, 2.6],
          [-0.088, 0.043, 0.017, 2.6],
          [-0.06, 0.045, 0.019, 2.6],
          [-0.025, 0.04, 0.02, 2.4],
          [0.0, 0.031, 0.022, 2.2],
          [0.016, 0.008, 0.008, 2],
        ],
        { segments: 24, steps: 4 },
      ),
      ...[0.031, 0.0105, -0.0105, -0.031].map((x, index) => {
        const reach = [0.052, 0.066, 0.068, 0.058][index];
        return tube(
          [
            [x, -0.088, 0.002],
            [x * 1.04, -0.09 - reach * 0.45, 0.005],
            [x * 1.06, -0.09 - reach * 0.8, 0.012],
            [x * 1.07, -0.09 - reach, 0.022],
          ],
          [0.0118, 0.0108, 0.0098, 0.0078],
          { radial: 6, steps: 3 },
        );
      }),
      tube(
        [
          [0.024, -0.03, 0.012],
          [0.04, -0.055, 0.03],
          [0.044, -0.08, 0.044],
          [0.04, -0.1, 0.05],
        ],
        [0.016, 0.0135, 0.0115, 0.0088],
        { radial: 6, steps: 3 },
      ),
    ),
    [socket("wrist", [0, 0, 0], [0, 1, 0]), socket("grip", [0, -0.09, 0.02], [0, 0, 1])],
  ),

  limb(
    "thigh",
    "Coxa",
    PANTS,
    [
      [-0.41, 0.056, 0.058],
      [-0.37, 0.06, 0.064],
      [-0.25, 0.073, 0.08],
      [-0.12, 0.085, 0.092],
      [-0.03, 0.09, 0.095],
      [0.03, 0.092, 0.096],
      [0.06, 0.07, 0.074],
      [0.074, 0.02, 0.02],
      [0.078, 0.003, 0.003],
    ],
    "hip",
    "knee",
    0.4,
    [{ at: [0, -0.39, 0.06], radius: 0.036, height: 0.008 }],
  ),
  limb(
    "calf",
    "Canela",
    PANTS,
    [
      [-0.39, 0.038, 0.04],
      [-0.35, 0.042, 0.044],
      [-0.24, 0.056, 0.06, 2, -0.008],
      [-0.14, 0.064, 0.07, 2, -0.012],
      [-0.05, 0.058, 0.06, 2, -0.004],
      [0, 0.052, 0.054],
      [0.03, 0.03, 0.03],
      [0.036, 0.003, 0.003],
    ],
    "knee",
    "ankle",
    0.38,
  ),

  block(
    "body.shoe_sneaker",
    "Tênis",
    "body",
    "#d6dde6",
    compound(
      loft(
        [
          [-0.082, 0.02, 0.03, 2, -0.012],
          [-0.07, 0.042, 0.058, 2.4, -0.006],
          [-0.03, 0.05, 0.068, 2.4, -0.003],
          [0.03, 0.052, 0.054, 2.4, -0.012],
          [0.1, 0.054, 0.036, 2.4, -0.03],
          [0.17, 0.05, 0.024, 2.4, -0.04],
          [0.2, 0.03, 0.016, 2.2, -0.044],
          [0.206, 0.006, 0.004, 2, -0.046],
        ],
        { axis: "z", segments: 32, steps: 5 },
      ),
      loft(
        [
          [-0.085, 0.02, 0.008, 3, -0.062],
          [-0.075, 0.046, 0.012, 3, -0.062],
          [0.05, 0.056, 0.012, 3, -0.062],
          [0.17, 0.056, 0.012, 3, -0.06],
          [0.208, 0.03, 0.012, 3, -0.058],
          [0.214, 0.006, 0.006, 2, -0.057],
        ],
        { axis: "z", segments: 32, steps: 4, color: WHITE },
      ),
      ...[0.025, 0.05, 0.075, 0.1].map((z, index) =>
        tube(
          [
            [-0.026, 0.024 - index * 0.012, z],
            [0, 0.03 - index * 0.012, z + 0.002],
            [0.026, 0.024 - index * 0.012, z],
          ],
          [0.0035, 0.004, 0.0035],
          { color: WHITE, radial: 6, steps: 4 },
        ),
      ),
      torus(0.044, 0.008, { at: [0, 0.052, -0.022], rot: [90, 0, 0], scale: [1.05, 1.22, 1], shade: 0.75 }),
    ),
    [socket("ankle", [0, 0, 0], [0, 1, 0]), socket("sole", [0, -0.07, 0.05], [0, -1, 0])],
  ),
  block(
    "body.shoe_boot",
    "Bota",
    "body",
    "#5a4632",
    compound(
      loft(
        [
          [-0.082, 0.02, 0.03, 2, -0.012],
          [-0.07, 0.044, 0.056, 2.4, -0.006],
          [-0.02, 0.05, 0.062, 2.4, -0.008],
          [0.05, 0.052, 0.05, 2.4, -0.022],
          [0.14, 0.054, 0.034, 2.4, -0.036],
          [0.19, 0.04, 0.024, 2.2, -0.042],
          [0.202, 0.006, 0.004, 2, -0.044],
        ],
        { axis: "z", segments: 32, steps: 5 },
      ),
      loft(
        [
          [-0.01, 0.052, 0.065, 2.3, -0.012],
          [0.08, 0.05, 0.064, 2.3, -0.015],
          [0.17, 0.056, 0.07, 2.3, -0.012],
          [0.19, 0.06, 0.075, 2.3, -0.012],
          [0.195, 0.01, 0.01, 2, -0.012],
        ],
        { segments: 32, steps: 4, shade: 0.92 },
      ),
      loft(
        [
          [-0.085, 0.02, 0.012, 3, -0.064],
          [-0.075, 0.048, 0.016, 3, -0.064],
          [0.04, 0.056, 0.016, 3, -0.064],
          [0.17, 0.056, 0.014, 3, -0.062],
          [0.208, 0.03, 0.014, 3, -0.06],
          [0.214, 0.006, 0.006, 2, -0.059],
        ],
        { axis: "z", segments: 32, steps: 4, color: "#191614" },
      ),
      ...[0.045, 0.085, 0.125, 0.165].map((y) =>
        tube(
          [
            [-0.03, y, 0.058],
            [0, y + 0.004, 0.072],
            [0.03, y, 0.058],
          ],
          [0.0028, 0.0034, 0.0028],
          { color: "#c9a875", radial: 6, steps: 4 },
        ),
      ),
    ),
    [socket("ankle", [0, 0, 0], [0, 1, 0]), socket("sole", [0, -0.07, 0.05], [0, -1, 0])],
  ),
  block(
    "body.shoe_formal",
    "Sapato",
    "body",
    "#2b2320",
    compound(
      loft(
        [
          [-0.082, 0.02, 0.028, 2, -0.018],
          [-0.07, 0.04, 0.05, 2.3, -0.012],
          [-0.03, 0.046, 0.058, 2.3, -0.012],
          [0.03, 0.048, 0.046, 2.3, -0.022],
          [0.1, 0.048, 0.03, 2.2, -0.036],
          [0.17, 0.04, 0.024, 2.2, -0.044],
          [0.205, 0.016, 0.014, 2, -0.05],
          [0.212, 0.004, 0.003, 2, -0.052],
        ],
        { axis: "z", segments: 32, steps: 5, finish: "gloss" },
      ),
      loft(
        [
          [-0.08, 0.02, 0.006, 3, -0.066],
          [-0.07, 0.044, 0.009, 3, -0.066],
          [0.05, 0.05, 0.009, 3, -0.066],
          [0.18, 0.046, 0.009, 3, -0.064],
          [0.215, 0.018, 0.009, 3, -0.062],
          [0.218, 0.004, 0.004, 2, -0.062],
        ],
        { axis: "z", segments: 32, steps: 4, color: "#14110f" },
      ),
    ),
    [socket("ankle", [0, 0, 0], [0, 1, 0]), socket("sole", [0, -0.07, 0.05], [0, -1, 0])],
  ),
  block(
    "body.skirt",
    "Saia",
    "body",
    "#a0335a",
    compound(
      loft(
        [
          [-0.43, 0.01, 0.01, 2],
          [-0.425, 0.25, 0.2, 2.1],
          [-0.3, 0.21, 0.165, 2.1],
          [-0.15, 0.178, 0.135, 2.2],
          [-0.03, 0.158, 0.11, 2.3],
          [0.02, 0.152, 0.104, 2.3],
          [0.03, 0.03, 0.03, 2],
        ],
        {
          segments: 56,
          steps: 4,
          bumps: Array.from({ length: 12 }, (_, index): Bump => {
            const angle = (index / 12) * Math.PI * 2;
            return {
              at: [Math.cos(angle) * 0.25, -0.4, Math.sin(angle) * 0.2],
              radius: 0.08,
              height: 0.014,
              stretch: [0.35, 2.2, 0.35],
            };
          }),
        },
      ),
      loft(
        [
          [-0.012, 0.11, 0.08, 2.2],
          [-0.01, 0.16, 0.112, 2.3],
          [0.022, 0.156, 0.108, 2.3],
          [0.024, 0.11, 0.08, 2.2],
        ],
        { segments: 44, steps: 2, shade: 0.75 },
      ),
    ),
    [socket("waist", [0, 0, 0], [0, 1, 0])],
  ),

  eyes("round", "Olhos redondos", pair((side) => eyeball(side))),
  eyes("big", "Olhos grandes", pair((side) => eyeball(side, { x: 0.053, ball: 0.032, iris: 0.021 }))),
  eyes("dot", "Olhos de ponto", pair((side) => [
    sphere(0.016, { at: [side * 0.05, 0, -0.006], scale: [0.9, 1.2, 0.5], color: "#100f12", finish: "gloss" }),
    sphere(0.004, { at: [side * 0.046, 0.007, 0.0005], scale: [1, 1, 0.4], color: "#ffffff" }),
  ])),
  eyes("sleepy", "Olhos sonolentos", pair((side) => eyeball(side, { lidDrop: 0.013, iris: 0.013 }))),
  eyes("narrow", "Olhos puxados", pair((side) => eyeball(side, { x: 0.052, squash: 0.62, ball: 0.027, iris: 0.012 }))),

  faceBlock("brows_straight", "Sobrancelhas retas", HAIR, pair((side) => brow(side, 0.003, 0, 0.0062))),
  faceBlock("brows_arched", "Sobrancelhas arqueadas", HAIR, pair((side) => brow(side, 0.012, -0.003, 0.0052))),
  faceBlock("brows_angry", "Sobrancelhas bravas", HAIR, pair((side) => brow(side, 0.002, 0.018, 0.0072))),

  faceBlock("nose_small", "Nariz pequeno", SKIN, [
    tube(
      [
        [0, 0.03, -0.012],
        [0, 0.012, 0.0],
        [0, -0.008, 0.012],
      ],
      [0.006, 0.0095, 0.0145],
      { radial: 14, steps: 6 },
    ),
    ...pair((side) => [sphere(0.0092, { at: [side * 0.0125, -0.012, 0.002], scale: [1, 0.8, 1] })]),
  ]),
  faceBlock("nose_long", "Nariz fino", SKIN, [
    tube(
      [
        [0, 0.04, -0.012],
        [0, 0.015, 0.004],
        [0, -0.012, 0.022],
      ],
      [0.006, 0.009, 0.0135],
      { radial: 14, steps: 6 },
    ),
    ...pair((side) => [sphere(0.0085, { at: [side * 0.0115, -0.017, 0.006], scale: [1, 0.8, 1] })]),
  ]),
  faceBlock("nose_wide", "Nariz largo", SKIN, [
    tube(
      [
        [0, 0.03, -0.012],
        [0, 0.01, -0.001],
        [0, -0.01, 0.01],
      ],
      [0.008, 0.012, 0.018],
      { radial: 14, steps: 6 },
    ),
    ...pair((side) => [sphere(0.0125, { at: [side * 0.0175, -0.013, 0.0], scale: [1, 0.78, 1] })]),
  ]),

  faceBlock("mouth_smile", "Sorriso", "#a0524d", lips(0.031, 0.009)),
  faceBlock("mouth_flat", "Boca reta", "#a0524d", lips(0.026, 0)),
  faceBlock("mouth_open", "Boca aberta", "#a0524d", [
    sphere(0.024, { at: [0, -0.006, -0.008], scale: [1.15, 0.85, 0.4], color: "#2c0f12" }),
    sphere(0.016, { at: [0, 0.006, -0.0005], scale: [1.35, 0.3, 0.3], color: WHITE }),
    ...tubeLipsOpen(),
  ]),
  faceBlock("mouth_grin", "Sorriso largo", "#a0524d", [
    tube(lipLine(0.034, 0.009, -0.002), [0.0006, 0.0078, 0.0078, 0.0078, 0.0006], { color: WHITE, radial: 7, flat: 0.4 }),
    ...lips(0.041, 0.012, 0.9),
  ]),

  faceBlock("beard_full", "Barba cheia", HAIR, [
    // The base stops below the lower lip, so the mouth stays visible.
    loft(
      [
        [-0.078, 0.02, 0.02, 2, -0.05],
        [-0.064, 0.056, 0.056, 2.2, -0.054],
        [-0.04, 0.072, 0.066, 2.2, -0.06],
        [-0.016, 0.092, 0.084, 2.3, -0.068],
        [-0.006, 0.086, 0.08, 2.3, -0.07],
        [-0.003, 0.01, 0.01, 2, -0.07],
      ],
      { segments: 44, steps: 4 },
    ),
    ...beardStrands(),
  ]),
  faceBlock("beard_goatee", "Cavanhaque", HAIR, [
    loft(
      [
        [-0.05, 0.006, 0.006, 2],
        [-0.042, 0.022, 0.012, 2.2],
        [-0.015, 0.03, 0.013, 2.2],
        [0.006, 0.024, 0.011, 2.2],
        [0.012, 0.004, 0.004, 2],
      ],
      { segments: 24, steps: 4, at: [0, 0, -0.002] },
    ),
  ]),
  faceBlock("beard_mustache", "Bigode", HAIR, pair((side) => [
    tube(
      [
        [side * 0.002, 0.043, 0.005],
        [side * 0.018, 0.043, 0.0025],
        [side * 0.034, 0.034, -0.004],
        [side * 0.044, 0.024, -0.01],
      ],
      [0.006, 0.009, 0.007, 0.0012],
      { radial: 7, steps: 5 },
    ),
  ])),

  faceBlock("glasses_round", "Óculos redondos", DARK, [
    ...pair((side) => [
      torus(0.03, 0.0028, { at: [side * 0.05, 0, 0.012], color: "#b8a26a", finish: "metal" }),
      cylinder(0.029, 0.029, 0.001, 32, { at: [side * 0.05, 0, 0.012], rot: [90, 0, 0], color: "#a8c4d6", finish: "glass" }),
      tube(
        [
          [side * 0.08, 0.004, 0.01],
          [side * 0.112, 0.008, -0.03],
          [side * 0.116, 0.004, -0.1],
        ],
        [0.0022, 0.0022, 0.0022],
        { color: "#b8a26a", finish: "metal", radial: 5 },
      ),
    ]),
    tube(
      [
        [-0.022, 0.006, 0.012],
        [0, 0.012, 0.016],
        [0.022, 0.006, 0.012],
      ],
      [0.0024, 0.0024, 0.0024],
      { color: "#b8a26a", finish: "metal", radial: 5 },
    ),
  ]),
  faceBlock("glasses_sun", "Óculos escuros", DARK, [
    ...pair((side) => [
      roundedBox([0.06, 0.038, 0.006], 0.003, { at: [side * 0.05, 0, 0.012], color: "#10141c", finish: "glass" }),
      tube(
        [
          [side * 0.08, 0.008, 0.01],
          [side * 0.112, 0.01, -0.03],
          [side * 0.116, 0.004, -0.1],
        ],
        [0.0034, 0.0034, 0.0034],
        { color: DARK, finish: "gloss", radial: 6 },
      ),
    ]),
    tube(
      [
        [-0.022, 0.012, 0.013],
        [0, 0.016, 0.016],
        [0.022, 0.012, 0.013],
      ],
      [0.003, 0.003, 0.003],
      { color: DARK, finish: "gloss", radial: 6 },
    ),
  ]),

  block(
    "face.ear",
    "Orelha",
    "face",
    SKIN,
    compound(
      loft(
        [
          [-0.035, 0.004, 0.006, 2, 0],
          [-0.03, 0.01, 0.016, 2, 0.002],
          [-0.01, 0.012, 0.026, 2, -0.002],
          [0.018, 0.012, 0.03, 2, -0.006],
          [0.034, 0.01, 0.022, 2, -0.008],
          [0.04, 0.003, 0.006, 2, -0.008],
        ],
        { at: [-0.006, 0, 0], segments: 24, steps: 4 },
      ),
      torus(0.019, 0.0035, {
        at: [-0.014, 0.003, -0.006],
        rot: [0, 90, 0],
        arc: Math.PI * 1.25,
        shade: 0.84,
      }),
    ),
    earSockets,
  ),
  block(
    "face.ear_elf",
    "Orelha de elfo",
    "face",
    SKIN,
    compound(
      tube(
        [
          [-0.002, -0.022, 0.0],
          [-0.012, 0.012, -0.012],
          [-0.02, 0.05, -0.034],
          [-0.03, 0.1, -0.06],
        ],
        [0.018, 0.022, 0.012, 0.0008],
        { flat: 0.35, radial: 12, steps: 6 },
      ),
    ),
    earSockets,
  ),

  hair("short", "Cabelo curto", [scalpCap(), ...layered(42, hairline)]),
  hair("side", "Topete", [
    scalpCap(),
    ...layered(32, (phi) => hairline(phi) * 0.96, { from: 18 }),
    ...strands(16, (_phi, index) => {
      const phi = -70 + (index / 15) * 110;
      return tube(
        [scalp(6, phi - 40, 0.012), scalp(30, phi, 0.024), scalp(56, phi + 26, 0.018), scalp(70, phi + 44, 0.006)],
        [0.014, 0.03, 0.022, 0.002],
        { radial: 7, steps: 5, flat: 0.5 },
      );
    }),
  ]),
  hair("bob", "Chanel", [
    scalpCap(),
    ...layered(54, (phi) => Math.abs(phi) < 52 ? hairline(phi) : 118, { width: 0.03, lift: 0.014, drop: 0.012 }),
  ]),
  hair("long", "Cabelo longo", [
    scalpCap(),
    ...layered(62, (phi) => (Math.abs(phi) < 56 ? hairline(phi) : 112), { width: 0.032, lift: 0.014 }),
    ...strands(46, (phi, index) => {
      if (Math.abs(phi) < 74) return [];
      return strand(phi, 112, { width: 0.034, lift: 0.016, drop: 0.23 + (index % 5) * 0.022, curl: index % 2 ? 0.012 : -0.012 });
    }),
  ]),
  hair("bun", "Coque", [
    scalpCap(),
    ...layered(44, (phi) => hairline(phi) * 0.98),
    lumpy(0.056, 11, { at: [0, 0.008, -0.098], detail: 8, amount: 0.05, frequency: 3 }),
    torus(0.046, 0.009, { at: [0, -0.005, -0.1], rot: [75, 0, 0], color: "#c23b3b" }),
  ]),
  hair("ponytail", "Rabo de cavalo", [
    scalpCap(),
    ...layered(44, (phi) => hairline(phi) * 0.98),
    torus(0.026, 0.0075, { at: [0, -0.052, -0.136], rot: [70, 0, 0], color: "#c23b3b" }),
    ...Array.from({ length: 22 }, (_, index) => {
      const a = (index / 22) * Math.PI * 2;
      const spread = 0.022 + (index % 3) * 0.006;
      const x = Math.cos(a) * spread;
      const z = Math.sin(a) * spread;
      return tube(
        [
          [x * 0.6, -0.05, -0.138 + z * 0.6],
          [x * 1.2, -0.11, -0.195 + z * 1.2],
          [x * 1.15, -0.2, -0.21 + z * 1.15],
          [x * 0.6, -0.3, -0.195 + z * 0.6],
        ],
        [0.008, 0.015, 0.012, 0.0008],
        { radial: 7, steps: 5 },
      );
    }),
  ]),
  hair("under_short", "Cabelo sob chapéu", [
    ...strands(38, (phi, index) =>
      Math.abs(phi) < 60
        ? []
        : strand(phi, hairline(phi) + 4, { from: 62, width: 0.028, lift: 0.012, sway: index % 2 ? 6 : -6 }),
    ),
  ]),
  hair("under_long", "Cabelo longo sob chapéu", [
    ...strands(46, (phi, index) =>
      Math.abs(phi) < 66
        ? []
        : strand(phi, 112, {
            from: 62,
            width: 0.032,
            lift: 0.014,
            drop: 0.13 + (index % 5) * 0.03,
            curl: index % 2 ? 0.01 : -0.01,
          }),
    ),
  ]),
  hair("afro", "Black power", [
    lumpy(0.17, 21, { at: [0, -0.095, -0.066], detail: 11, amount: 0.04, frequency: 12 }),
  ]),
  hair("curly", "Cacheado", [scalpCap(), ...curls(31)]),
  hair("spiky", "Espetado", [
    scalpCap(),
    ...strands(26, (phi, index) => {
      const theta = 12 + (index % 4) * 17;
      if (theta > hairline(phi)) return [];
      const [x, y, z] = scalp(theta, phi, 0);
      const [ox, oy, oz] = scalp(theta + 8, phi, 0.09);
      return tube(
        [
          [x, y, z],
          [(x + ox) / 2, (y + oy) / 2 + 0.018, (z + oz) / 2],
          [ox, oy + 0.036, oz],
        ],
        [0.03, 0.022, 0.0008],
        { radial: 7, steps: 4 },
      );
    }),
  ]),
  hair("mohawk", "Moicano", [
    ...Array.from({ length: 13 }, (_, index) => {
      const theta = -92 + index * 10;
      const [x, y, z] = scalp(Math.abs(theta), theta < 0 ? 180 : 0, 0);
      const [ox, oy, oz] = scalp(Math.abs(theta), theta < 0 ? 180 : 0, 0.13);
      return tube(
        [
          [x, y - 0.01, z],
          [(x + ox) / 2, (y + oy) / 2 + 0.012, (z + oz) / 2],
          [ox, oy + 0.02, oz],
        ],
        [0.036, 0.027, 0.0012],
        { flat: 0.32, radial: 8, steps: 4 },
      );
    }),
  ]),

  hat("cap", "Boné", "#c23b3b", [
    lathe(crownProfile(0.126, 0.02), { at: [0, 0, -0.012] }, 48),
    sphere(0.009, { at: [0, 0.022, -0.012], shade: 0.75 }),
    loft(
      [
        [0.08, 0.1, 0.008, 3, -0.072],
        [0.13, 0.095, 0.008, 3, -0.068],
        [0.19, 0.085, 0.008, 3, -0.07],
        [0.235, 0.05, 0.007, 3, -0.076],
        [0.24, 0.006, 0.003, 2, -0.077],
      ],
      { axis: "z", segments: 32, steps: 5, shade: 0.8 },
    ),
  ]),
  hat("beanie", "Touca", "#3a7d6b", [
    lathe(crownProfile(0.128, 0.03, -0.085), { at: [0, 0, -0.012] }, 48),
    cylinder(0.134, 0.134, 0.052, 48, { at: [0, -0.066, -0.012], shade: 0.8 }),
    lumpy(0.036, 5, { at: [0, 0.045, -0.012], detail: 6, amount: 0.1, frequency: 7, shade: 0.9 }),
  ]),
  hat("top", "Cartola", "#22242c", [
    lathe(
      [
        [0, -0.05],
        [0.102, -0.05],
        [0.098, 0.03],
        [0.104, 0.12],
        [0.112, 0.16],
        [0.11, 0.165],
        [0, 0.17],
      ],
      { at: [0, 0, -0.012], finish: "gloss" },
      48,
    ),
    lathe(
      [
        [0, -0.077],
        [0.165, -0.077],
        [0.178, -0.066],
        [0.165, -0.06],
        [0, -0.06],
      ],
      { at: [0, 0, -0.012], finish: "gloss" },
      48,
    ),
    hatBand(0.104, -0.035, 0.035, "#8f2a2e"),
  ]),
  hat("cowboy", "Chapéu de caubói", "#8a5a30", [
    loft(
      [
        [-0.06, 0.112, 0.128, 2.1],
        [-0.02, 0.102, 0.122, 2.1],
        [0.04, 0.09, 0.11, 2.1],
        [0.08, 0.076, 0.096, 2.2],
        [0.098, 0.04, 0.06, 2],
        [0.103, 0.005, 0.005, 2],
      ],
      {
        segments: 44,
        steps: 4,
        at: [0, 0, -0.012],
        bumps: [{ at: [0, 0.1, 0], radius: 0.05, height: -0.018, stretch: [0.5, 1, 2] }],
      },
    ),
    loft(
      [
        [-0.074, 0.008, 0.008, 2],
        [-0.072, 0.21, 0.25, 2.1],
        [-0.062, 0.215, 0.255, 2.1],
        [-0.058, 0.02, 0.02, 2],
      ],
      {
        segments: 56,
        steps: 2,
        at: [0, 0, -0.012],
        bumps: [
          { at: [0.21, -0.06, 0], radius: 0.09, height: 0.05 },
          { at: [-0.21, -0.06, 0], radius: 0.09, height: 0.05 },
        ],
      },
    ),
    cylinder(0.11, 0.112, 0.022, 48, { at: [0, -0.05, -0.012], color: "#3a2a1e" }),
  ]),
  hat("wizard", "Chapéu de mago", "#5a35a8", [
    tube(
      [
        [0, -0.06, -0.015],
        [0, 0.08, -0.025],
        [0.012, 0.22, -0.075],
        [0.05, 0.31, -0.12],
      ],
      [0.125, 0.082, 0.038, 0.0012],
      { radial: 24, steps: 8 },
    ),
    lathe(
      [
        [0, -0.078],
        [0.205, -0.078],
        [0.215, -0.07],
        [0.205, -0.064],
        [0, -0.064],
      ],
      { at: [0, 0, -0.012] },
      48,
    ),
    hatBand(0.128, -0.05, 0.03, GOLD),
    sphere(0.016, { at: [0.05, 0.312, -0.12], color: GOLD, finish: "metal" }),
  ]),
  hat("helmet", "Capacete", "#d8dbe2", [
    lathe(crownProfile(0.14, 0.032, -0.1), { at: [0, 0, -0.012], finish: "gloss" }, 48),
    loft(
      [
        [-0.088, 0.128, 0.012, 2.4, 0.13],
        [-0.074, 0.13, 0.016, 2.4, 0.13],
        [-0.04, 0.128, 0.012, 2.4, 0.13],
      ],
      { color: "#20354a", finish: "glass", segments: 24, steps: 3, at: [0, 0, -0.012] },
    ),
    ...[1, -1].map((side) =>
      roundedBox([0.02, 0.04, 0.05], 0.008, { at: [side * 0.135, -0.05, -0.012], shade: 0.65 }),
    ),
  ]),
  hat("crown", "Coroa", "#e3b53a", [
    lathe(
      [
        [0, -0.05],
        [0.098, -0.05],
        [0.104, -0.02],
        [0.11, 0.022],
        [0.104, 0.022],
        [0.094, -0.04],
        [0, -0.04],
      ],
      { at: [0, 0, -0.012], finish: "metal" },
      48,
    ),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      const x = Math.sin(angle) * 0.106;
      const z = Math.cos(angle) * 0.106 - 0.012;
      return [
        cylinder(0, 0.024, 0.075, 12, { at: [x, 0.055, z], finish: "metal" as const }),
        sphere(0.0085, { at: [x, 0.096, z], finish: "metal" as const }),
        sphere(0.009, {
          at: [x * 1.04, -0.018, z * 1.04],
          color: index % 2 ? "#c23b3b" : "#2f7fd1",
          finish: "gloss" as const,
        }),
      ];
    }).flat(),
  ]),

  block(
    "hair.backpack",
    "Mochila",
    "hair",
    "#c9772b",
    compound(
      loft(
        [
          [-0.2, 0.05, 0.03, 2.8, -0.07],
          [-0.185, 0.135, 0.065, 3, -0.07],
          [-0.05, 0.145, 0.078, 3, -0.075],
          [0.1, 0.135, 0.07, 3, -0.075],
          [0.18, 0.1, 0.05, 2.6, -0.068],
          [0.2, 0.03, 0.02, 2.2, -0.065],
        ],
        { segments: 36, steps: 4 },
      ),
      roundedBox([0.2, 0.15, 0.045], 0.018, { at: [0, -0.07, -0.145], shade: 0.8 }),
      tube(
        [
          [-0.095, 0.0, -0.17],
          [0, -0.003, -0.172],
          [0.095, 0, -0.17],
        ],
        [0.0025, 0.0025, 0.0025],
        { color: DARK, radial: 5 },
      ),
      torus(0.035, 0.009, { at: [0, 0.205, -0.07], arc: Math.PI, shade: 0.7 }),
      ...pair((side) => [
        tube(
          [
            [side * 0.085, 0.17, -0.01],
            [side * 0.1, 0.23, 0.045],
            [side * 0.105, 0.1, 0.15],
            [side * 0.11, -0.13, 0.12],
          ],
          [0.018, 0.02, 0.02, 0.016],
          { flat: 0.25, shade: 0.65, radial: 8 },
        ),
      ]),
    ),
    [socket("back", [0, 0, 0], [0, 0, 1])],
  ),
];

/** Rooted along the jaw: low under the lip, rising into sideburns at the sides. */
function beardStrands(): ShapePiece[] {
  const count = 46;
  return Array.from({ length: count }, (_, index) => {
    const angle = ((index / (count - 1)) * 170 - 85) * RAD;
    const sin = Math.sin(angle);
    const rise = sin * sin * 0.078;
    const x = sin * (0.09 + rise * 0.22);
    const z = Math.cos(angle) * (0.097 + (index % 3) * 0.002) - 0.086;
    const y = -0.01 + rise;
    const length = 0.05 + ((index * 7) % 5) * 0.009 - sin * sin * 0.018;
    return tube(
      [
        [x, y, z],
        [x * 1.05, y - length * 0.5, z + Math.cos(angle) * 0.006],
        [x * 0.94, y - length, z - 0.002],
      ],
      [0.0115, 0.0085, 0.0008],
      { radial: 5, steps: 2 },
    );
  });
}

function tubeLipsOpen(): ShapePiece[] {
  const point = (t: number, sign: number, height: number): Vec3 => {
    const x = t * 0.03;
    return [x, -0.004 + sign * height * (1 - t * t), faceZ(x, 6)];
  };
  const ts = [-1, -0.5, 0, 0.5, 1];
  return [
    tube(ts.map((t) => point(t, 1, 0.017)), [0.0012, 0.0052, 0.0055, 0.0052, 0.0012], { radial: 8 }),
    tube(ts.map((t) => point(t, -1, 0.02)), [0.0012, 0.0066, 0.0072, 0.0066, 0.0012], { radial: 8 }),
  ];
}
