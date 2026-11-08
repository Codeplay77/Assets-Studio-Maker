import type { BlockDef, BodyDeform, Point, ShapePiece, Vec3 } from "../types.ts";
import {
  arc,
  block,
  box,
  capsule,
  compound,
  cylinder,
  extrude,
  lathe,
  loft,
  roundedBox,
  smoothLine,
  socket,
  sphere,
  torus,
  tube,
} from "./helpers.ts";

const TIRE = "#17181c";
const GLASS = "#1b2a3a";
const TRIM = "#101217";
const CHROME = "#d9dee5";
const HEADLIGHT = "#fff2c4";
const TAILLIGHT = "#e01f30";
const INDICATOR = "#ffa32b";

interface Cabin {
  frontBase: number;
  frontTop: number;
  rearTop: number;
  rearBase: number;
  base: number;
  roof: number;
}

interface BodySpec {
  id: string;
  name: string;
  color: string;
  length: number;
  width: number;
  clearance: number;
  wheelRadius: number;
  frontAxle: number;
  rearAxle: number;
  /** Upper body outline as [z, y], from the front bumper to the rear bumper. */
  top: Point[];
  cabin: Cabin;
  lightY: number;
  /** Rear doors, for the cars that have them. */
  rearDoor?: boolean;
  extras?: ShapePiece[];
}

function arched(axle: number, radius: number, wheelRadius: number, clearance: number): Point[] {
  const skew = (Math.asin((wheelRadius - clearance) / radius) * 180) / Math.PI;
  return arc(axle, wheelRadius, radius, 180 + skew, -skew, 20);
}

function along(a: Point, b: Point, t: number): Point {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A thin strip following a line of the side profile, pushed outward from `inside`. */
function strip(a: Point, b: Point, inside: Point, thickness: number): Point[] {
  const dz = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dz, dy);
  let nz = -dy / length;
  let ny = dz / length;
  if ((a[0] - inside[0]) * nz + (a[1] - inside[1]) * ny < 0) {
    nz = -nz;
    ny = -ny;
  }
  return [a, b, [b[0] + nz * thickness, b[1] + ny * thickness], [a[0] + nz * thickness, a[1] + ny * thickness]];
}

function carBody(spec: BodySpec): BlockDef {
  const { length, width, clearance: c, wheelRadius: r, cabin } = spec;
  const half = length / 2;
  const archRadius = r + 0.075;
  const { roof } = cabin;
  const lower = (cabin.base + c) / 2;

  const shape: BodyDeform = {
    barrel: 0,
    center: lower + 0.05,
    span: (cabin.base - c) / 2,
    plan: 0.1,
    length: half,
  };
  const cabinShape: BodyDeform = { ...shape, taper: 0.15, taperFrom: cabin.base, taperTo: roof };
  const cabinWidth = width * 0.86;

  const body: Point[] = [
    [-half, c + 0.1],
    [-half + 0.1, c],
    ...arched(spec.rearAxle, archRadius, r, c),
    ...arched(spec.frontAxle, archRadius, r, c),
    [half - 0.1, c],
    [half, c + 0.1],
    ...smoothLine(spec.top, 2),
  ];

  const roofMid = (cabin.frontTop + cabin.rearTop) / 2;
  const frontBase: Point = [cabin.frontBase, cabin.base];
  const frontTop: Point = [cabin.frontTop, roof];
  const rearBase: Point = [cabin.rearBase, cabin.base];
  const rearTop: Point = [cabin.rearTop, roof];
  const cabinOutline: Point[] = [
    rearBase,
    frontBase,
    ...smoothLine([frontBase, frontTop, [roofMid, roof + 0.03], rearTop, rearBase], 3).slice(1, -1),
  ];
  const center: Point = [roofMid, (cabin.base + roof) / 2];

  // Side windows sit in the cabin, split by the pillar between the doors.
  const inset = 0.11;
  const shift = (point: Point, dz: number): Point => [point[0] + dz, point[1]];
  const sillFront = shift(along(frontBase, frontTop, 0.12), -inset);
  const headFront = shift(along(frontBase, frontTop, 0.86), -inset);
  const sillRear = shift(along(rearBase, rearTop, 0.12), inset);
  const headRear = shift(along(rearBase, rearTop, 0.86), inset);
  const pillarSill = along(sillRear, sillFront, 0.5);
  const pillarHead = along(headRear, headFront, 0.5);
  const gap = 0.05;
  const frontWindow: Point[] = [shift(pillarSill, gap), sillFront, headFront, shift(pillarHead, gap)];
  const rearWindow: Point[] = [sillRear, shift(pillarSill, -gap), shift(pillarHead, -gap), headRear];

  const seamZ = (spec.frontAxle + spec.rearAxle) / 2;
  const seamBottom = c + 0.13;
  const seamTop = cabin.base - 0.02;
  const seam = (z: number): ShapePiece =>
    extrude(
      [
        [z - 0.007, seamBottom],
        [z + 0.007, seamBottom],
        [z + 0.007, seamTop],
        [z - 0.007, seamTop],
      ],
      width + 0.012,
      0,
      { color: TRIM, deform: shape },
    );
  const handle = (z: number): ShapePiece =>
    extrude(
      [
        [z - 0.08, cabin.base - 0.13],
        [z + 0.08, cabin.base - 0.13],
        [z + 0.08, cabin.base - 0.095],
        [z - 0.08, cabin.base - 0.095],
      ],
      width + 0.045,
      0.006,
      { color: CHROME, finish: "metal", deform: shape, bevelSteps: 2 },
    );

  const front = half;
  const rear = -half;
  const lightX = width * 0.5 * 0.9 - 0.25;
  const y = spec.lightY;

  const pieces: ShapePiece[] = [
    extrude(body, width, 0.1, { deform: shape, bevelSteps: 3, finish: "gloss" }),
    extrude(cabinOutline, cabinWidth, 0.06, { deform: cabinShape, bevelSteps: 2, finish: "gloss" }),

    extrude(frontWindow, cabinWidth + 0.012, 0, { color: GLASS, finish: "glass", deform: cabinShape }),
    extrude(rearWindow, cabinWidth + 0.012, 0, { color: GLASS, finish: "glass", deform: cabinShape }),
    extrude(strip(along(frontBase, frontTop, 0.08), along(frontBase, frontTop, 0.93), center, 0.014), cabinWidth - 0.13, 0, {
      color: GLASS,
      finish: "glass",
      deform: cabinShape,
    }),
    extrude(strip(along(rearBase, rearTop, 0.08), along(rearBase, rearTop, 0.93), center, 0.014), cabinWidth - 0.13, 0, {
      color: GLASS,
      finish: "glass",
      deform: cabinShape,
    }),

    // Rubber trim around the windows.
    extrude(strip(sillRear, sillFront, center, 0.018), cabinWidth + 0.018, 0, {
      color: TRIM,
      deform: cabinShape,
    }),

    box([width * 0.82, 0.06, length * 0.74], { at: [0, c + 0.005, seamZ], color: TRIM }),

    roundedBox([width * 0.9, 0.2, 0.14], 0.065, { at: [0, c + 0.135, front - 0.03], finish: "gloss" }),
    roundedBox([width * 0.9, 0.2, 0.14], 0.065, { at: [0, c + 0.135, rear + 0.03], finish: "gloss" }),
    roundedBox([width * 0.58, 0.075, 0.03], 0.012, { at: [0, c + 0.1, front + 0.035], color: TRIM }),
    roundedBox([width * 0.58, 0.075, 0.03], 0.012, { at: [0, c + 0.1, rear - 0.035], color: TRIM }),

    box([width * 0.44, 0.15, 0.04], { at: [0, y, front + 0.0], color: TRIM }),
    ...[-0.045, 0, 0.045].map((dy) =>
      box([width * 0.42, 0.016, 0.02], { at: [0, y + dy, front + 0.022], color: CHROME, finish: "metal" }),
    ),
    roundedBox([0.34, 0.11, 0.008], 0.003, { at: [0, c + 0.2, front + 0.044], color: "#eef0f2" }),
    roundedBox([0.34, 0.11, 0.008], 0.003, { at: [0, c + 0.2, rear - 0.044], color: "#eef0f2" }),

    ...[1, -1].flatMap((side): ShapePiece[] => [
      roundedBox([0.37, 0.16, 0.05], 0.03, { at: [side * lightX, y, front - 0.01], color: TRIM }),
      roundedBox([0.3, 0.1, 0.05], 0.03, { at: [side * lightX, y, front + 0.006], color: HEADLIGHT, finish: "glow" }),
      roundedBox([0.1, 0.05, 0.02], 0.01, { at: [side * (lightX + 0.22), y - 0.01, front - 0.04], color: INDICATOR, finish: "glow" }),
      sphere(0.04, { at: [side * (lightX + 0.02), c + 0.12, front + 0.012], scale: [1, 1, 0.45], color: HEADLIGHT, finish: "glow" }),

      roundedBox([0.38, 0.15, 0.05], 0.03, { at: [side * lightX, y, rear + 0.01], color: TRIM }),
      roundedBox([0.32, 0.1, 0.05], 0.03, { at: [side * lightX, y, rear - 0.006], color: TAILLIGHT, finish: "glow" }),

      roundedBox([0.03, 0.15, 0.4], 0.012, { at: [side * (width * 0.455), c + 0.04, seamZ + 0.15], color: TRIM }),

      tube(
        [
          [side * (cabinWidth * 0.46), cabin.base + 0.03, cabin.frontBase - 0.2],
          [side * (cabinWidth * 0.5 + 0.08), cabin.base + 0.05, cabin.frontBase - 0.2],
        ],
        [0.015, 0.015],
        { color: TRIM, radial: 8 },
      ),
      roundedBox([0.17, 0.1, 0.06], 0.025, {
        at: [side * (cabinWidth * 0.5 + 0.13), cabin.base + 0.06, cabin.frontBase - 0.2],
        finish: "gloss",
      }),
      cylinder(0.04, 0.04, 0.01, 16, {
        at: [side * (cabinWidth * 0.5 + 0.13), cabin.base + 0.06, cabin.frontBase - 0.24],
        rot: [90, 0, 0],
        color: CHROME,
        finish: "metal",
      }),
    ]),

    ...[0.3, -0.3].map((x) =>
      tube(
        [
          [x - 0.26, cabin.base + 0.06, cabin.frontBase - 0.03],
          [x + 0.06, cabin.base + 0.09, cabin.frontBase - 0.08],
          [x + 0.26, cabin.base + 0.12, cabin.frontBase - 0.13],
        ],
        [0.006, 0.006, 0.006],
        { color: TRIM, radial: 5, steps: 4 },
      ),
    ),

    cylinder(0.042, 0.048, 0.14, 16, { at: [width * 0.3, c + 0.03, rear - 0.05], rot: [90, 0, 0], color: CHROME, finish: "metal" }),

    seam(cabin.frontBase - 0.04),
    seam(seamZ),
    handle(seamZ + 0.17),
    ...(spec.rearDoor
      ? [seam(cabin.rearBase + 0.32), handle(seamZ - 0.62)]
      : []),
    ...(spec.extras ?? []),
  ];

  const wheelX = width / 2 - 0.2;
  const wheel = (id: string, side: number, z: number) =>
    socket(id, [side * wheelX, r, z], [side, 0, 0]);
  const [trunkZ, trunkY] = spec.top[spec.top.length - 2];

  return block(`vehicle.${spec.id}`, spec.name, "vehicle", spec.color, compound(pieces), [
    socket("ground", [0, 0, 0], [0, -1, 0]),
    wheel("wheel_fl", 1, spec.frontAxle),
    wheel("wheel_fr", -1, spec.frontAxle),
    wheel("wheel_rl", 1, spec.rearAxle),
    wheel("wheel_rr", -1, spec.rearAxle),
    socket("roof", [0, roof + 0.02, roofMid], [0, 1, 0]),
    socket("trunk", [0, trunkY, trunkZ + 0.2], [0, 1, 0]),
    socket("front", [0, c + 0.18, half + 0.03], [0, 0, 1]),
  ]);
}

interface WheelSpec {
  id: string;
  name: string;
  color: string;
  radius: number;
  width: number;
  rim: number;
  spokes: number;
  spokeWidth: number;
  /** Tread blocks stick out of the tire instead of being cut into it. */
  knobby?: boolean;
  whitewall?: boolean;
  pinstripe?: string;
}

function wheelBlock(spec: WheelSpec): BlockDef {
  const { radius: r, width: w, rim, spokes, spokeWidth, color } = spec;
  const shoulder = Math.min(0.05, r * 0.16);

  const tread: [number, number][] = [];
  const grooves = spec.knobby ? 0 : 3;
  for (let i = 0; i <= grooves; i++) {
    const a = -w + shoulder + ((w - shoulder * 2) * i) / (grooves + 1);
    const b = -w + shoulder + ((w - shoulder * 2) * (i + 1)) / (grooves + 1);
    tread.push([r, a + 0.006], [r, b - 0.006]);
    if (i < grooves) tread.push([r - 0.012, b - 0.004], [r - 0.012, b + 0.004]);
  }

  const face = -w;
  const pieces: ShapePiece[] = [
    lathe(
      [
        [0, face + 0.02],
        [rim - 0.002, face + 0.02],
        [rim + 0.012, face],
        [r - shoulder, face],
        [r - shoulder * 0.28, face + shoulder * 0.24],
        ...tread,
        [r - shoulder * 0.28, -shoulder * 0.24],
        [r - shoulder, 0],
        [0, 0],
      ],
      { color: TIRE },
      32,
    ),
    // The rim is dished: its center sits deeper than the lip.
    lathe(
      [
        [0, face + 0.03],
        [rim * 0.34, face + 0.03],
        [rim * 0.4, face + 0.05],
        [rim * 0.88, face + 0.05],
        [rim * 0.97, face + 0.01],
        [rim * 1.03, face - 0.006],
        [rim * 1.09, face + 0.004],
        [rim * 1.06, face + 0.04],
        [0, face + 0.04],
      ],
      { finish: "metal", shade: 0.82 },
      32,
    ),
    torus(rim * 1.03, 0.012, { at: [0, face - 0.002, 0], rot: [90, 0, 0], finish: "metal" }),
    cylinder(rim * 0.8, rim * 0.8, 0.012, 24, { at: [0, face + 0.075, 0], color: "#6a7079", finish: "metal" }),

    ...Array.from({ length: spokes }, (_, index): ShapePiece => {
      const angle = (index * 360) / spokes;
      const radians = (angle * Math.PI) / 180;
      const reach = rim * 0.98;
      return loft(
        [
          [0.02, spokeWidth * 0.9, 0.018, 2.8],
          [reach * 0.45, spokeWidth * 0.62, 0.016, 2.8],
          [reach, spokeWidth * 0.75, 0.014, 2.8],
        ],
        {
          segments: 10,
          steps: 1,
          at: [Math.sin(radians) * 0, face + 0.024, 0],
          rot: [90, angle, 0],
          finish: "metal",
        },
      );
    }),

    cylinder(rim * 0.33, rim * 0.33, 0.03, 32, { at: [0, face + 0.018, 0], finish: "metal" }),
    cylinder(rim * 0.16, rim * 0.18, 0.018, 24, { at: [0, face + 0.0, 0], shade: 0.5, finish: "metal" }),
    ...Array.from({ length: spokes }, (_, index): ShapePiece => {
      const radians = ((index + 0.5) * 2 * Math.PI) / spokes;
      return cylinder(0.011, 0.011, 0.02, 8, {
        at: [Math.sin(radians) * rim * 0.24, face + 0.004, Math.cos(radians) * rim * 0.24],
        color: "#2c3038",
        finish: "metal",
      });
    }),
  ];

  if (spec.whitewall) {
    pieces.push(torus(r * 0.8, 0.02, { at: [0, face + 0.002, 0], rot: [90, 0, 0], scale: [1, 1, 0.3], color: "#f2eee4" }));
  }
  if (spec.pinstripe) {
    pieces.push(torus(r * 0.86, 0.005, { at: [0, face + 0.004, 0], rot: [90, 0, 0], scale: [1, 1, 0.4], color: spec.pinstripe }));
  }
  if (spec.knobby) {
    const count = 22;
    for (let i = 0; i < count; i++) {
      const angle = (i * 360) / count;
      const radians = (angle * Math.PI) / 180;
      pieces.push(
        roundedBox([0.1, w * 0.46, 0.05], 0.012, {
          at: [Math.sin(radians) * r, -w * (i % 2 ? 0.3 : 0.7), Math.cos(radians) * r],
          rot: [0, angle, 0],
          color: TIRE,
        }),
      );
    }
  }

  return block(`wheel.${spec.id}`, spec.name, "wheel", color, compound(pieces), [
    socket("axle", [0, 0, 0], [0, 1, 0]),
    socket("hub", [0, -w, 0], [0, -1, 0]),
  ]);
}

function accessory(
  id: string,
  name: string,
  color: string,
  pieces: ShapePiece[],
  n: Vec3 = [0, -1, 0],
): BlockDef {
  return block(`wheel.${id}`, name, "wheel", color, compound(pieces), [socket("base", [0, 0, 0], n)]);
}

const wingBlade = (width: number, chord: number, y: number, tilt: number) =>
  loft(
    [
      [-chord / 2, width / 2, 0.006, 2.4],
      [-chord * 0.3, width / 2, 0.02, 2.4],
      [chord * 0.1, width / 2, 0.026, 2.4],
      [chord / 2, width / 2, 0.005, 2.4],
    ],
    { axis: "z", at: [0, y, 0], rot: [tilt, 0, 0], segments: 20, steps: 4, finish: "gloss" },
  );

const coilover = (x: number, y: number, z: number, angle: number): ShapePiece =>
  tube(
    [
      [x, y, z],
      [x * 0.5, y + 0.12 * Math.cos(angle), z],
    ],
    [0.025, 0.025],
    { color: "#c9a23f", finish: "metal", radial: 8 },
  );

export const vehicleBlocks: BlockDef[] = [
  carBody({
    id: "sedan",
    name: "Sedã",
    color: "#c23b3b",
    length: 4.4,
    width: 1.8,
    clearance: 0.2,
    wheelRadius: 0.33,
    frontAxle: 1.38,
    rearAxle: -1.38,
    rearDoor: true,
    top: [
      [2.2, 0.72],
      [2.12, 0.86],
      [0.95, 1.01],
      [-1.5, 1.04],
      [-2.12, 0.99],
      [-2.2, 0.76],
    ],
    cabin: { frontBase: 0.98, frontTop: 0.2, rearTop: -0.95, rearBase: -1.55, base: 0.98, roof: 1.46 },
    lightY: 0.74,
  }),
  carBody({
    id: "hatch",
    name: "Hatch",
    color: "#2f7fd1",
    length: 3.8,
    width: 1.72,
    clearance: 0.2,
    wheelRadius: 0.31,
    frontAxle: 1.2,
    rearAxle: -1.18,
    rearDoor: true,
    top: [
      [1.9, 0.72],
      [1.84, 0.87],
      [0.82, 1.01],
      [-1.75, 1.05],
      [-1.9, 0.99],
      [-1.9, 0.76],
    ],
    cabin: { frontBase: 0.85, frontTop: 0.12, rearTop: -1.45, rearBase: -1.82, base: 0.98, roof: 1.5 },
    lightY: 0.76,
  }),
  carBody({
    id: "suv",
    name: "SUV",
    color: "#3b4a3a",
    length: 4.6,
    width: 1.95,
    clearance: 0.34,
    wheelRadius: 0.42,
    frontAxle: 1.45,
    rearAxle: -1.42,
    rearDoor: true,
    top: [
      [2.3, 0.95],
      [2.25, 1.14],
      [1.05, 1.28],
      [-2.15, 1.31],
      [-2.3, 1.23],
      [-2.3, 0.98],
    ],
    cabin: { frontBase: 1.05, frontTop: 0.35, rearTop: -1.9, rearBase: -2.15, base: 1.25, roof: 1.84 },
    lightY: 1.0,
    extras: [
      ...[0.68, -0.68].map((x) =>
        box([0.05, 0.05, 2.2], { at: [x, 1.9, -0.3], color: TRIM }),
      ),
    ],
  }),
  carBody({
    id: "pickup",
    name: "Picape",
    color: "#c9772b",
    length: 5.1,
    width: 1.9,
    clearance: 0.32,
    wheelRadius: 0.4,
    frontAxle: 1.75,
    rearAxle: -1.55,
    top: [
      [2.55, 0.92],
      [2.5, 1.1],
      [1.4, 1.22],
      [-2.5, 1.2],
      [-2.55, 1.12],
      [-2.55, 0.95],
    ],
    cabin: { frontBase: 1.3, frontTop: 0.65, rearTop: -0.65, rearBase: -0.8, base: 1.2, roof: 1.78 },
    lightY: 0.98,
    extras: [
      box([1.6, 0.03, 1.62], { at: [0, 1.207, -1.65], color: TRIM }),
      ...[0, 1, 2, 3, 4].map((index) =>
        box([0.05, 0.02, 1.6], { at: [-0.5 + index * 0.25, 1.226, -1.65], color: "#2a2d33" }),
      ),
    ],
  }),
  carBody({
    id: "sport",
    name: "Esportivo",
    color: "#e0a81f",
    length: 4.4,
    width: 1.92,
    clearance: 0.13,
    wheelRadius: 0.34,
    frontAxle: 1.42,
    rearAxle: -1.36,
    top: [
      [2.2, 0.48],
      [2.02, 0.66],
      [0.75, 0.85],
      [-1.5, 0.91],
      [-2.12, 0.87],
      [-2.2, 0.62],
    ],
    cabin: { frontBase: 0.78, frontTop: -0.08, rearTop: -0.7, rearBase: -1.55, base: 0.82, roof: 1.2 },
    lightY: 0.54,
    extras: [
      ...[0.28, 0.14, 0, -0.14, -0.28].map((x) =>
        box([0.08, 0.012, 0.42], { at: [x, 0.895, -1.0], rot: [-3, 0, 0], color: TRIM }),
      ),
    ],
  }),
  carBody({
    id: "van",
    name: "Van",
    color: "#e8e4d8",
    length: 5.0,
    width: 2.0,
    clearance: 0.26,
    wheelRadius: 0.36,
    frontAxle: 1.75,
    rearAxle: -1.65,
    rearDoor: true,
    top: [
      [2.5, 0.88],
      [2.44, 1.08],
      [1.75, 1.2],
      [-2.42, 1.22],
      [-2.5, 1.16],
      [-2.5, 0.9],
    ],
    cabin: { frontBase: 1.75, frontTop: 1.25, rearTop: -2.35, rearBase: -2.42, base: 1.18, roof: 2.32 },
    lightY: 0.94,
  }),
  carBody({
    id: "bus",
    name: "Ônibus",
    color: "#d6a12b",
    length: 10,
    width: 2.5,
    clearance: 0.32,
    wheelRadius: 0.52,
    frontAxle: 3.1,
    rearAxle: -3.0,
    top: [
      [5, 1.15],
      [4.97, 1.4],
      [4.7, 1.48],
      [-4.9, 1.48],
      [-5, 1.42],
      [-5, 1.15],
    ],
    cabin: { frontBase: 4.85, frontTop: 4.62, rearTop: -4.8, rearBase: -4.9, base: 1.45, roof: 3.05 },
    lightY: 1.07,
    extras: [
      box([2.46, 0.12, 9.5], { at: [0, 1.56, 0], shade: 0.72 }),
      ...[-3.3, -1.1, 1.1, 3.3].map((z) =>
        box([2.4, 1.15, 0.05], { at: [0, 2.3, z], finish: "gloss" }),
      ),
      roundedBox([1.2, 0.26, 2.6], 0.06, { at: [0, 3.15, -1], color: "#d9dde3" }),
      box([1.5, 0.28, 0.03], { at: [0, 2.82, 4.92], color: "#14181f" }),
    ],
  }),
  carBody({
    id: "truck",
    name: "Caminhão",
    color: "#2f6fb0",
    length: 7.2,
    width: 2.3,
    clearance: 0.36,
    wheelRadius: 0.5,
    frontAxle: 2.45,
    rearAxle: -2.4,
    top: [
      [3.6, 1.15],
      [3.56, 1.42],
      [3.4, 1.5],
      [-3.55, 1.45],
      [-3.6, 1.32],
      [-3.6, 1.1],
    ],
    cabin: { frontBase: 3.4, frontTop: 3.12, rearTop: 1.65, rearBase: 1.55, base: 1.42, roof: 2.75 },
    lightY: 1.07,
    extras: [
      roundedBox([2.3, 2.55, 5.05], 0.04, { at: [0, 2.7, -1.05], color: "#e8e4d8" }),
      ...[-3.2, -2.4, -1.6, -0.8, 0, 0.8].map((z) =>
        box([2.32, 2.5, 0.03], { at: [0, 2.7, z], color: "#d3cec0" }),
      ),
      box([2.32, 0.07, 5.06], { at: [0, 1.46, -1.05], color: "#b8b3a5" }),
      roundedBox([1.5, 0.45, 0.8], 0.1, { at: [0, 2.95, 2.4], finish: "gloss", shade: 0.9 }),
    ],
  }),

  block(
    "vehicle.race",
    "Carro de corrida",
    "vehicle",
    "#d62f3a",
    compound(
      loft(
        [
          [-2.2, 0.03, 0.03, 2, 0.44],
          [-2.05, 0.18, 0.12, 2.4, 0.46],
          [-1.5, 0.42, 0.2, 2.8, 0.5],
          [-0.9, 0.56, 0.22, 3, 0.5],
          [-0.1, 0.44, 0.2, 3, 0.48],
          [0.7, 0.3, 0.16, 2.8, 0.44],
          [1.4, 0.24, 0.1, 2.6, 0.36],
          [2.3, 0.16, 0.055, 2.6, 0.28],
          [2.5, 0.05, 0.03, 2.4, 0.26],
        ],
        { axis: "z", segments: 40, steps: 6, finish: "gloss" },
      ),
      loft(
        [
          [-2.0, 0.04, 0.05, 2.2, 0.72],
          [-1.5, 0.14, 0.16, 2.4, 0.8],
          [-1.05, 0.2, 0.22, 2.4, 0.86],
          [-0.75, 0.16, 0.2, 2.4, 0.86],
          [-0.42, 0.04, 0.1, 2.4, 0.84],
        ],
        { axis: "z", segments: 28, steps: 4, finish: "gloss", shade: 0.85 },
      ),
      ...[1, -1].flatMap((side): ShapePiece[] => [
        roundedBox([0.46, 0.24, 1.25], 0.07, { at: [side * 0.56, 0.36, -0.55], finish: "gloss", shade: 0.9 }),
        cylinder(0.14, 0.14, 0.06, 20, { at: [side * 0.56, 0.38, 0.09], rot: [90, 0, 0], color: TRIM }),
        wingEndplate(side * 0.94, 0.27, 2.32, 0.2, 0.62),
        wingEndplate(side * 0.8, 0.86, -2.0, 0.46, 0.52),
        tube(
          [
            [side * 0.16, 0.42, 1.55],
            [side * 0.74, 0.34, 1.58],
          ],
          [0.018, 0.018],
          { color: TRIM, radial: 8 },
        ),
        tube(
          [
            [side * 0.2, 0.28, 1.58],
            [side * 0.74, 0.3, 1.58],
          ],
          [0.018, 0.018],
          { color: TRIM, radial: 8 },
        ),
        tube(
          [
            [side * 0.3, 0.42, -1.48],
            [side * 0.74, 0.36, -1.5],
          ],
          [0.02, 0.02],
          { color: TRIM, radial: 8 },
        ),
        tube(
          [
            [side * 0.3, 0.3, -1.52],
            [side * 0.74, 0.3, -1.5],
          ],
          [0.02, 0.02],
          { color: TRIM, radial: 8 },
        ),
        cylinder(0.05, 0.05, 0.3, 8, { at: [side * 0.08, 0.76, -1.95], rot: [90, 0, 0], color: CHROME, finish: "metal" }),
        coilover(side * 0.5, 0.45, 1.5, 0.5),
      ]),
      wingBlade(1.88, 0.48, 0.22, 2),
      wingBlade(1.88, 0.26, 0.31, -12),
      wingBlade(1.6, 0.42, 1.06, -5),
      wingBlade(1.6, 0.24, 1.16, -22),
      sphere(0.17, { at: [0, 0.8, 0.14], scale: [0.95, 1, 1.15], color: "#f0c94a", finish: "gloss" }),
      roundedBox([0.26, 0.08, 0.04], 0.015, { at: [0, 0.82, 0.32], color: GLASS, finish: "glass" }),
      tube(
        [
          [0, 0.68, -0.32],
          [0, 1.03, -0.08],
          [0, 0.95, 0.56],
          [0, 0.68, 0.76],
        ],
        [0.03, 0.028, 0.028, 0.03],
        { color: TRIM, radial: 8, flat: 0.7, steps: 8 },
      ),
      roundedBox([0.5, 0.05, 0.8], 0.02, { at: [0, 0.685, 0.2], color: TRIM }),
      box([1.45, 0.045, 3.1], { at: [0, 0.1, -0.05], color: "#1b1c22" }),
    ),
    [
      socket("ground", [0, 0, 0], [0, -1, 0]),
      socket("wheel_fl", [0.72, 0.33, 1.58], [1, 0, 0]),
      socket("wheel_fr", [-0.72, 0.33, 1.58], [-1, 0, 0]),
      socket("wheel_rl", [0.72, 0.33, -1.5], [1, 0, 0]),
      socket("wheel_rr", [-0.72, 0.33, -1.5], [-1, 0, 0]),
      socket("seat", [0, 0.6, 0.2], [0, 1, 0]),
    ],
  ),
  block(
    "vehicle.kart",
    "Kart",
    "vehicle",
    "#2bbf7a",
    compound(
      loft(
        [
          [0.12, 0.2, 0.05, 2.4, 0.34],
          [0.4, 0.26, 0.09, 2.6, 0.32],
          [0.72, 0.36, 0.08, 2.6, 0.27],
          [0.98, 0.42, 0.075, 2.6, 0.25],
          [1.12, 0.05, 0.05, 2.2, 0.24],
        ],
        { axis: "z", segments: 32, steps: 5, finish: "gloss" },
      ),
      ...[1, -1].flatMap((side): ShapePiece[] => [
        loft(
          [
            [-0.7, 0.06, 0.05, 2.2, 0.26],
            [-0.5, 0.13, 0.1, 2.6, 0.28],
            [0.35, 0.11, 0.09, 2.6, 0.26],
            [0.5, 0.03, 0.06, 2.2, 0.23],
          ],
          { axis: "z", segments: 24, steps: 4, at: [side * 0.42, 0, 0], finish: "gloss", shade: 0.85 },
        ),
        tube(
          [
            [side * 0.26, 0.16, 0.72],
            [side * 0.42, 0.14, 0.72],
          ],
          [0.018, 0.018],
          { color: TRIM, radial: 8 },
        ),
        tube(
          [
            [side * 0.3, 0.16, -0.72],
            [side * 0.42, 0.14, -0.72],
          ],
          [0.02, 0.02],
          { color: TRIM, radial: 8 },
        ),
      ]),
      box([0.72, 0.025, 1.8], { at: [0, 0.135, 0], color: "#30343c", finish: "metal" }),
      tube(
        [
          [-0.34, 0.15, -0.72],
          [0, 0.15, -0.72],
          [0.34, 0.15, -0.72],
        ],
        [0.022, 0.022, 0.022],
        { color: CHROME, finish: "metal", radial: 8 },
      ),
      roundedBox([0.46, 0.52, 0.09], 0.04, { at: [0, 0.48, -0.36], rot: [-14, 0, 0], color: TRIM }),
      roundedBox([0.46, 0.08, 0.46], 0.035, { at: [0, 0.2, -0.1], color: TRIM }),
      tube(
        [
          [0, 0.16, 0.66],
          [0, 0.36, 0.54],
          [0, 0.58, 0.32],
        ],
        [0.018, 0.018, 0.018],
        { color: TRIM, radial: 8 },
      ),
      torus(0.13, 0.016, { at: [0, 0.62, 0.28], rot: [55, 0, 0], color: TRIM }),
      ...[0, 120, 240].map((angle) =>
        roundedBox([0.018, 0.13, 0.012], 0.004, { at: [0, 0.62, 0.28], rot: [55, 0, angle], color: CHROME, finish: "metal" }),
      ),
      roundedBox([0.18, 0.24, 0.24], 0.04, { at: [0.28, 0.32, -0.62], color: "#2c3038", finish: "metal" }),
      cylinder(0.05, 0.05, 0.44, 12, { at: [0.3, 0.34, -0.9], rot: [90, 0, 0], color: CHROME, finish: "metal" }),
      roundedBox([0.34, 0.26, 0.02], 0.02, { at: [0, 0.4, 0.86], rot: [-16, 0, 0], color: "#f0efe6" }),
    ),
    [
      socket("ground", [0, 0, 0], [0, -1, 0]),
      socket("wheel_fl", [0.42, 0.14, 0.72], [1, 0, 0]),
      socket("wheel_fr", [-0.42, 0.14, 0.72], [-1, 0, 0]),
      socket("wheel_rl", [0.42, 0.14, -0.72], [1, 0, 0]),
      socket("wheel_rr", [-0.42, 0.14, -0.72], [-1, 0, 0]),
    ],
  ),

  wheelBlock({ id: "steel", name: "Roda comum", color: "#b6bdc7", radius: 0.33, width: 0.22, rim: 0.21, spokes: 8, spokeWidth: 0.018 }),
  wheelBlock({ id: "sport", name: "Roda esportiva", color: "#d6dde6", radius: 0.34, width: 0.26, rim: 0.25, spokes: 5, spokeWidth: 0.034 }),
  wheelBlock({ id: "star", name: "Roda estrela", color: "#3a3f4a", radius: 0.33, width: 0.24, rim: 0.24, spokes: 10, spokeWidth: 0.014 }),
  wheelBlock({ id: "offroad", name: "Roda off-road", color: "#c9a23f", radius: 0.42, width: 0.32, rim: 0.25, spokes: 6, spokeWidth: 0.03, knobby: true }),
  wheelBlock({ id: "whitewall", name: "Roda faixa branca", color: "#d6dde6", radius: 0.33, width: 0.22, rim: 0.18, spokes: 12, spokeWidth: 0.01, whitewall: true }),
  wheelBlock({ id: "heavy", name: "Roda de caminhão", color: "#8a939f", radius: 0.52, width: 0.34, rim: 0.3, spokes: 10, spokeWidth: 0.028 }),
  wheelBlock({ id: "kart", name: "Roda de kart", color: "#e3b53a", radius: 0.14, width: 0.17, rim: 0.085, spokes: 5, spokeWidth: 0.014 }),
  wheelBlock({ id: "slick", name: "Pneu de corrida", color: "#d6dde6", radius: 0.33, width: 0.36, rim: 0.23, spokes: 7, spokeWidth: 0.026, pinstripe: "#f0c94a" }),

  accessory("spoiler_low", "Aerofólio baixo", "#2b2f38", [
    wingBlade(1.5, 0.36, 0.18, -6),
    ...[0.5, -0.5].map((x) => roundedBox([0.05, 0.17, 0.16], 0.015, { at: [x, 0.08, 0], finish: "gloss" })),
  ]),
  accessory("spoiler_wing", "Aerofólio alto", "#2b2f38", [
    wingBlade(1.75, 0.44, 0.44, -8),
    ...[0.65, -0.65].flatMap((x) => [
      roundedBox([0.05, 0.42, 0.15], 0.012, { at: [x, 0.21, 0], finish: "gloss" }),
      roundedBox([0.03, 0.22, 0.5], 0.01, { at: [x * 1.34, 0.44, 0], finish: "gloss", shade: 0.8 }),
    ]),
  ]),
  accessory("roof_rack", "Bagageiro", "#3a3f4a", [
    ...[0.5, 0.17, -0.17, -0.5].map((z) =>
      roundedBox([1.45, 0.03, 0.05], 0.01, { at: [0, 0.1, z], finish: "metal" }),
    ),
    ...[0.68, -0.68].flatMap((x) => [
      tube(
        [
          [x, 0.0, 0.82],
          [x, 0.14, 0.72],
          [x, 0.14, -0.72],
          [x, 0.0, -0.82],
        ],
        [0.03, 0.03, 0.03, 0.03],
        { radial: 10, steps: 8, finish: "metal" },
      ),
    ]),
  ]),
  accessory("taxi_sign", "Placa de táxi", "#f0c94a", [
    roundedBox([0.64, 0.2, 0.28], 0.04, { at: [0, 0.1, 0], finish: "gloss" }),
    ...[0.142, -0.142].map((z) => box([0.44, 0.1, 0.008], { at: [0, 0.1, z], color: "#fff3c4", finish: "glow" })),
    ...[-0.14, -0.05, 0.05, 0.14].map((x, index) =>
      box([0.06, 0.03, 0.29], { at: [x, index % 2 ? 0.145 : 0.055, 0], color: "#1c1e24" }),
    ),
  ]),
  accessory("police_bar", "Sirene", "#1c1e24", [
    roundedBox([1.3, 0.05, 0.3], 0.02, { at: [0, 0.03, 0], finish: "gloss" }),
    roundedBox([0.52, 0.13, 0.26], 0.05, { at: [0.36, 0.12, 0], color: "#3266ff", finish: "glow" }),
    roundedBox([0.52, 0.13, 0.26], 0.05, { at: [-0.36, 0.12, 0], color: "#ff2a3a", finish: "glow" }),
    roundedBox([0.18, 0.12, 0.24], 0.04, { at: [0, 0.11, 0], color: "#eef2f7", finish: "glow" }),
  ]),
  accessory(
    "bull_bar",
    "Parachoque de impulsão",
    "#2b2f38",
    [
      tube(
        [
          [-0.66, -0.12, 0.05],
          [-0.66, 0.26, 0.09],
          [-0.5, 0.38, 0.11],
          [0.5, 0.38, 0.11],
          [0.66, 0.26, 0.09],
          [0.66, -0.12, 0.05],
        ],
        [0.03, 0.03, 0.03, 0.03, 0.03, 0.03],
        { radial: 12, steps: 8, finish: "metal" },
      ),
      tube(
        [
          [-0.66, 0.0, 0.08],
          [0, 0.0, 0.13],
          [0.66, 0.0, 0.08],
        ],
        [0.025, 0.025, 0.025],
        { radial: 10, steps: 8, finish: "metal" },
      ),
      ...[-0.2, 0.2].flatMap((x) =>
        tube(
          [
            [x, 0.0, 0.11],
            [x, 0.38, 0.11],
          ],
          [0.02, 0.02],
          { radial: 8, finish: "metal" },
        ),
      ),
    ],
    [0, 0, -1],
  ),
  capsuleAntenna(),
];

function wingEndplate(x: number, y: number, z: number, height: number, length: number): ShapePiece {
  return roundedBox([0.03, height, length], 0.01, { at: [x, y, z], finish: "gloss" });
}

function capsuleAntenna(): BlockDef {
  return accessory("antenna", "Antena", "#1c1e24", [
    capsule(0.035, 0.06, { at: [0, 0.05, 0], rot: [18, 0, 0], scale: [0.5, 1, 1.5], finish: "gloss" }),
    tube(
      [
        [0, 0.05, -0.01],
        [0, 0.4, -0.08],
      ],
      [0.006, 0.003],
      { radial: 5 },
    ),
  ]);
}
