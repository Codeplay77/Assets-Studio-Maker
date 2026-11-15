import type { BlockDef, LoftRing, ShapePiece, Vec3 } from "../types.ts";
import { bothSides, evenly, fromFace, hairShell, latheSolid, marks, onHair, pointing, solidOf, type ShellSpec, type Solid } from "./hairShell.ts";
import { block, box, compound, cylinder, icosahedron, lathe, loft, socket, tube } from "./helpers.ts";
import { withFinerShape } from "./styleize.ts";

// The low poly person: flat polygons, a few hundred per part. Sockets match the realistic
// body, so one generator assembles both and the same skeleton animates them.

const SKIN = "#e0ac83";
const SHIRT = "#3f8cff";
const PANTS = "#2d3a55";
const HAIR = "#4a2f1d";
const WHITE = "#f4f1ea";
const DARK = "#1b1f2a";
const GOLD = "#d9b24a";

type Options = Omit<ShapePiece, "shape">;

const flat = (rings: LoftRing[], segments: number, options: Options & { axis?: "y" | "z" } = {}) =>
  loft(rings, { segments, steps: 1, faceted: true, ...options });
const chunk = (radius: number, options: Options = {}) => icosahedron(radius, 0, { faceted: true, ...options });
const ball = (radius: number, options: Options = {}) => icosahedron(radius, 1, { faceted: true, ...options });
const hex = (radius: number, options: Options = {}) => cylinder(radius, radius, 0.01, 6, { faceted: true, ...options });
const stick = (path: Vec3[], radii: number[], options: Options & { radial?: number; steps?: number; flat?: number } = {}) =>
  tube(path, radii, { radial: 4, steps: 1, faceted: true, ...options });
const pair = (build: (side: 1 | -1) => ShapePiece[]) => [...build(1), ...build(-1)];

// --- torso --------------------------------------------------------------------------------

interface Build {
  suffix: "" | "_f";
  rings: LoftRing[];
  shoulderX: number;
  shoulderY: number;
  neckY: number;
}

const MALE: Build = {
  suffix: "",
  rings: [
    [0, 0.15, 0.1],
    [0.16, 0.165, 0.11],
    [0.33, 0.208, 0.128],
    [0.43, 0.19, 0.108],
    [0.49, 0.075, 0.062],
  ],
  shoulderX: 0.2,
  shoulderY: 0.415,
  neckY: 0.49,
};

const FEMALE: Build = {
  suffix: "_f",
  rings: [
    [0, 0.135, 0.092],
    [0.09, 0.122, 0.085],
    [0.2, 0.135, 0.095],
    [0.3, 0.164, 0.13, 2, 0.016],
    [0.385, 0.174, 0.104, 2, 0.004],
    [0.45, 0.15, 0.09],
    [0.485, 0.065, 0.06],
  ],
  shoulderX: 0.168,
  shoulderY: 0.395,
  neckY: 0.485,
};

/** The flat front panel of a ten-sided torso at a given height. */
function frontZ({ rings }: Build, y: number): number {
  for (let i = 0; i < rings.length - 1; i++) {
    const [y0, , d0, , o0 = 0] = rings[i];
    const [y1, , d1, , o1 = 0] = rings[i + 1];
    if (y <= y1) {
      const t = (y - y0) / (y1 - y0);
      return (d0 + (d1 - d0) * t) * Math.sin((72 * Math.PI) / 180) + o0 + (o1 - o0) * t;
    }
  }
  return 0;
}

/** The torso's section at a height: half its width and depth, and how far forward its middle is. */
function sectionAt({ rings }: Build, y: number): { half: number; depth: number; middle: number } {
  for (let i = 0; i < rings.length - 1; i++) {
    const [y0, x0, d0, , o0 = 0] = rings[i];
    const [y1, x1, d1, , o1 = 0] = rings[i + 1];
    if (y <= y1) {
      const t = Math.max(0, (y - y0) / (y1 - y0));
      return { half: x0 + (x1 - x0) * t, depth: d0 + (d1 - d0) * t, middle: o0 + (o1 - o0) * t };
    }
  }
  const [, half, depth, , middle = 0] = rings[rings.length - 1];
  return { half, depth, middle };
}

/** The flat back panel of a ten-sided torso at a given height. */
function backZ(build: Build, y: number): number {
  const { depth, middle } = sectionAt(build, y);
  return middle - depth * Math.sin((72 * Math.PI) / 180);
}

/** Where the torso's rounded surface is at x: in front of its middle (1) or behind it (-1). */
function surfaceZ(build: Build, x: number, y: number, side: 1 | -1): number {
  const { half, depth, middle } = sectionAt(build, y);
  return middle + side * depth * Math.sqrt(Math.max(0, 1 - (x / half) ** 2));
}

/** Where a backpack hangs: the middle of the back, on its flat panel. */
const BACK_Y = 0.3;
const backSocket = (build: Build): Vec3 => [0, BACK_Y, Math.round(backZ(build, BACK_Y) * 1e4) / 1e4];

/**
 * A flat panel lying on the chest. Each entry is [height, half width]. It also bends at every
 * ring of the torso between its ends, or the chest would bulge through the middle of it.
 */
function plate(build: Build, widths: [number, number][], lift: number, options: Options): ShapePiece {
  const first = widths[0][0];
  const last = widths[widths.length - 1][0];
  const heights = [...new Set([...widths.map(([y]) => y), ...build.rings.map(([y]) => y).filter((y) => y > first && y < last)])].sort(
    (a, b) => a - b,
  );
  const halfAt = (y: number) => {
    for (let i = 0; i < widths.length - 1; i++) {
      const [y0, h0] = widths[i];
      const [y1, h1] = widths[i + 1];
      if (y <= y1) return h0 + ((h1 - h0) * (y - y0)) / (y1 - y0);
    }
    return widths[widths.length - 1][1];
  };
  return flat(
    heights.map((y): LoftRing => [y, halfAt(y), 0.005, 6, frontZ(build, y) + lift]),
    8,
    options,
  );
}

const sockets = (build: Build) => [
  socket("waist", [0, 0, 0], [0, -1, 0]),
  socket("neck", [0, build.neckY, 0], [0, 1, 0]),
  socket("shoulder_left", [build.shoulderX, build.shoulderY, 0], [0.38, -0.92, 0]),
  socket("shoulder_right", [-build.shoulderX, build.shoulderY, 0], [-0.38, -0.92, 0]),
  socket("back", backSocket(build), [0, 0, -1]),
  socket("chest", [0, 0.33, 0.128], [0, 0, 1]),
];

function torso(build: Build, id: string, name: string, color: string, details: ShapePiece[]): BlockDef {
  const label = build.suffix ? `${name} (fem.)` : name;
  return block(
    `lp.torso${build.suffix}_${id}`,
    label,
    "body",
    color,
    compound(flat(build.rings, 10), details),
    sockets(build),
  );
}

const collar = (build: Build, options: Options = { shade: 0.78 }) =>
  flat(
    [
      [build.neckY - 0.04, 0.078, 0.066],
      [build.neckY - 0.008, 0.066, 0.056],
    ],
    8,
    options,
  );

const buttons = (build: Build, color: string) =>
  [0.1, 0.2, 0.3, 0.39].map((y) => box([0.016, 0.016, 0.008], { at: [0, y, frontZ(build, y) + 0.006], color }));

const collarWings = (build: Build, options: Options = {}) =>
  pair((side) => [
    box([0.05, 0.03, 0.012], {
      at: [side * 0.034, build.neckY - 0.04, frontZ(build, build.neckY - 0.04) + 0.012],
      rot: [0, 0, side * 28],
      ...options,
    }),
  ]);

const lapels = (build: Build, y: number) =>
  pair((side) => [
    box([0.05, 0.2, 0.012], {
      at: [side * 0.048, y, frontZ(build, y) + 0.008],
      rot: [0, 0, side * -12],
      shade: 0.72,
    }),
  ]);

function torsos(build: Build): BlockDef[] {
  const top = build.neckY - 0.03;
  return [
    torso(build, "tshirt", "Camiseta", SHIRT, [collar(build)]),
    torso(build, "hoodie", "Moletom", "#b0413e", [
      collar(build),
      flat(
        [
          [0.4, 0.06, 0.05, 2, -0.1],
          [0.46, 0.13, 0.095, 2, -0.12],
          [0.55, 0.12, 0.1, 2, -0.12],
          [0.6, 0.05, 0.05, 2, -0.11],
        ],
        8,
        { shade: 0.85 },
      ),
      plate(build, [[0.04, 0.095], [0.15, 0.075]], 0.006, { shade: 0.78 }),
      ...pair((side) => [box([0.008, 0.1, 0.008], { at: [side * 0.05, 0.4, frontZ(build, 0.4) + 0.012], color: WHITE })]),
    ]),
    torso(build, "jacket", "Jaqueta", "#5b6b3a", [
      collar(build),
      plate(build, [[0.01, 0.03], [top, 0.05]], 0.003, { color: WHITE }),
      ...lapels(build, 0.33),
    ]),
    torso(build, "shirt", "Camisa social", "#e8e4d8", [
      plate(build, [[0.01, 0.024], [top, 0.024]], 0.003, { shade: 0.88 }),
      ...buttons(build, "#8f8a7e"),
      ...collarWings(build, { shade: 0.92 }),
    ]),
    torso(build, "suit", "Terno", "#2c3142", [
      plate(build, [[0.22, 0.006], [top, 0.058]], 0.003, { color: WHITE }),
      plate(build, [[0.2, 0.004], [0.24, 0.024], [top - 0.02, 0.012]], 0.009, { color: "#b3262e" }),
      ...lapels(build, 0.32),
      ...collarWings(build, { color: WHITE }),
    ]),
    torso(build, "uniform", "Uniforme", "#23405f", [
      plate(build, [[0.01, 0.024], [top, 0.024]], 0.003, { shade: 0.8 }),
      ...buttons(build, GOLD),
      ...collarWings(build),
      ...pair((side) => [
        box([0.09, 0.016, 0.06], {
          at: [side * (build.shoulderX - 0.01), build.shoulderY + 0.03, 0],
          rot: [0, 0, side * -14],
          color: GOLD,
          finish: "metal",
        }),
      ]),
      box([0.04, 0.05, 0.008], { at: [-0.09, 0.33, frontZ(build, 0.33) - 0.012], rot: [0, -18, 0], color: GOLD, finish: "metal" }),
    ]),
  ];
}

// --- head and face ------------------------------------------------------------------------

const headSockets = [
  socket("neck", [0, 0, 0], [0, -1, 0]),
  socket("top", [0, 0.27, 0], [0, 1, 0]),
  socket("eyes", [0, 0.15, 0.112], [0, 0, 1]),
  socket("brows", [0, 0.178, 0.112], [0, 0.15, 1]),
  socket("nose", [0, 0.125, 0.118], [0, 0, 1]),
  socket("mouth", [0, 0.074, 0.106], [0, -0.08, 1]),
  socket("chin", [0, 0.05, 0.092], [0, 0, 1]),
  socket("ear_left", [0.11, 0.14, 0], [1, 0, 0]),
  socket("ear_right", [-0.11, 0.14, 0], [-1, 0, 0]),
];

interface HeadSpec {
  id: string;
  name: string;
  width: number;
  jaw: number;
  chin: number;
}

type HeadShape = Omit<HeadSpec, "id" | "name">;

const headRings = ({ width, jaw, chin }: HeadShape): LoftRing[] => [
  [0, 0.012, 0.018, 2, 0.02],
  [0.012, 0.046 * chin, 0.056, 2, 0.024],
  [0.045, 0.08 * jaw, 0.086, 2, 0.012],
  [0.1, 0.104 * ((jaw + 1) / 2), 0.108, 2, 0.004],
  [0.16, 0.112 * width, 0.12, 2, 0],
  [0.215, 0.1 * width, 0.112, 2, -0.004],
  [0.255, 0.06, 0.072, 2, -0.006],
  [0.27, 0.008, 0.01, 2, -0.006],
];

const HEAD_SEGMENTS = 12;

function head({ id, name, ...shape }: HeadSpec): BlockDef {
  return block(`lp.head_${id}`, name, "body", SKIN, compound(flat(headRings(shape), HEAD_SEGMENTS)), headSockets);
}

/** As wide as any of the heads below and as narrow: hair is drawn over the one and tucked into the other. */
const WIDEST_HEAD: HeadShape = { width: 1.05, jaw: 1.18, chin: 1.55 };
const NARROWEST_HEAD: HeadShape = { width: 0.97, jaw: 0.84, chin: 0.8 };

// The two front facets of the head turn about 15 degrees away from the middle.
const FACET_YAW = 15;
const EYE_X = 0.046;
const EYE_Z = -0.0075;

/** A disc turned to lie on the facet, where `side` says which way it faces. */
const facing = (side: number): Vec3 => [90, 0, -side * FACET_YAW];

function face(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.${id}`, name, "face", color, compound(pieces), [socket("back", [0, 0, 0], [0, 0, -1])]);
}

interface EyeSpec {
  white: number;
  iris: number;
  lash?: boolean;
}

/** Almond shaped: the iris touches both lids, so only the corners show white. */
const eye = ({ white, iris, lash }: EyeSpec) =>
  pair((side) => {
    const x = side * EYE_X;
    const pieces = [
      hex(white, { at: [x, 0, EYE_Z], rot: facing(side), scale: [1, 1, 0.56], color: WHITE }),
      hex(iris, { at: [x, 0, EYE_Z + 0.004], rot: facing(side), scale: [1, 1, 0.92] }),
      hex(iris * 0.52, { at: [x, 0, EYE_Z + 0.007], rot: facing(side), scale: [1, 1, 0.92], color: "#101218" }),
      box([white * 2.1, 0.005, 0.014], {
        at: [x, white * 0.56, EYE_Z + 0.004],
        rot: [0, side * FACET_YAW, 0],
        color: "#14110f",
      }),
    ];
    if (lash) {
      pieces.push(
        box([0.016, 0.006, 0.012], {
          at: [x + side * white * 1.05, white * 0.7, EYE_Z + 0.001],
          rot: [0, side * FACET_YAW, side * 32],
          color: "#14110f",
        }),
      );
    }
    return pieces;
  });

const brow = (lift: number, tilt: number, thick: number) =>
  pair((side) => [
    box([0.05, thick, 0.012], {
      at: [side * 0.048, lift, -0.008],
      rot: [0, side * FACET_YAW, side * tilt],
    }),
  ]);

const curve = (width: number, bend: number, thick: number, options: Options = {}) =>
  stick(
    [
      [-width, bend, -0.01],
      [0, -bend, 0],
      [width, bend, -0.01],
    ],
    [thick * 0.5, thick, thick * 0.5],
    { steps: 2, ...options },
  );

const nose = (width: number, height: number, depth: number) =>
  cylinder(0.004, width, height, 4, { at: [0, 0.006, depth / 2], rot: [-16, 45, 0], scale: [1, 1, 1], faceted: true });

// --- hair ---------------------------------------------------------------------------------
//
// Hair is a layer over the head (see hairShell.ts), drawn over the widest of the heads above and
// tucked into the narrowest, so it fits them all: faceted here, finer for Arcade. Hats sit on the
// same socket at the top of the head, and the hair worn under a hat is the layer below its band.

const TOP = 0.27;
const HAIR_CENTER: Vec3 = [0, 0.15, -0.004];
const headSolids = (segments: number, steps: number) => ({
  head: solidOf({ rings: headRings(WIDEST_HEAD), segments, steps }),
  inner: solidOf({ rings: headRings(NARROWEST_HEAD), segments, steps }),
});
const LOW_HEAD = headSolids(HEAD_SEGMENTS, 1);
/** How Arcade draws the head: see smoothPiece in styleize.ts. */
const FINE_HEAD = headSolids(24, 3);
/** Directions round the head, closer where the hairline turns: by the temples and the ears. */
const LOW_AROUND = bothSides([0, 16, 32, 48, 60, 70, 80, 92, 106, 122, 142, 162, 180]);
const FINE_AROUND = evenly(72);
const CURTAIN_SEGMENTS = 12;

interface Layer {
  hairline: (fromFace: number) => number;
  thickness: (fromFace: number, up: number) => number;
  start?: (fromFace: number) => number;
  /** Hair hanging below the layer, whose top the layer covers: lofts in head space. */
  covers?: LoftRing[][];
  /** Worn under a hat: pressed in to stay inside the cap's crown, the snuggest of the hats. */
  underHat?: boolean;
}

/** How far inside the cap's crown the hair under it stays. */
const UNDER_CAP_GAP = 0.003;
/** The cap's crown as Low poly draws it, and as Arcade does (smoothPiece in styleize.ts). */
const capCrown = (segments: number): [Solid, number] => [latheSolid(CAP_CROWN, segments, [0, TOP, CAP_Z]), UNDER_CAP_GAP];

const lowSpec = ({ covers = [], underHat, ...rest }: Layer): ShellSpec => ({
  ...rest,
  ...LOW_HEAD,
  top: TOP,
  center: HAIR_CENTER,
  around: LOW_AROUND,
  rows: 4,
  covers: covers.map((rings) => solidOf({ rings, segments: CURTAIN_SEGMENTS, steps: 1 })),
  margin: 0.006,
  within: underHat ? capCrown(CAP_SEGMENTS) : undefined,
});

const fineSpec = ({ covers = [], underHat, ...rest }: Layer): ShellSpec => ({
  ...rest,
  ...FINE_HEAD,
  top: TOP,
  center: HAIR_CENTER,
  around: FINE_AROUND,
  rows: 14,
  covers: covers.map((rings) => solidOf({ rings, segments: 24, steps: 3 })),
  margin: 0.003,
  within: underHat ? capCrown(28) : undefined,
});

/** A layer of hair: faceted for Low poly, with a finer twin for Arcade. */
const layer = (spec: Layer, options: Options = {}): ShapePiece =>
  withFinerShape({ shape: hairShell(lowSpec(spec)), faceted: true, ...options }, hairShell(fineSpec(spec)));

/** Hair hanging below the head, from a loft in head space. */
const curtain = (rings: LoftRing[]) => flat(rings.map(([y, ...rest]) => [y - TOP, ...rest] as LoftRing), CURTAIN_SEGMENTS);

/** Where something sits on the hair, `lift` out from its surface, and which way is out there. */
const spot = (spec: Layer, around: number, elevation: number, lift = 0) => onHair(lowSpec(spec), around, elevation, lift);

const plus = ([a, b, c]: Vec3, [x, y, z]: Vec3, scale = 1): Vec3 => [a + x * scale, b + y * scale, c + z * scale];

// Hairlines are head heights by degrees from the face (0) round to the nape (180). The brows are
// at 0.178 and the ears from 0.106 to 0.174, between 78 and 102 degrees.

/** Off the forehead, a short sideburn in front of each ear, over the ears and down to the nape. */
const SHORT_LINE = marks([
  [0, 0.212],
  [16, 0.214],
  [32, 0.207],
  [48, 0.193],
  [60, 0.176],
  [70, 0.132],
  [80, 0.172],
  [92, 0.184],
  [106, 0.13],
  [122, 0.098],
  [142, 0.078],
  [180, 0.07],
]);
/** Pulled back: no sideburns, and a softer line at the nape. */
const TIED_LINE = marks([
  [0, 0.21],
  [20, 0.213],
  [40, 0.2],
  [56, 0.18],
  [68, 0.15],
  [80, 0.17],
  [92, 0.18],
  [106, 0.135],
  [130, 0.1],
  [180, 0.08],
]);
/** Down the sides of the face to where a curtain of hair takes over. */
const CURTAIN_LINE = marks([
  [0, 0.207],
  [20, 0.209],
  [40, 0.198],
  [54, 0.17],
  [64, 0.135],
  [78, 0.12],
  [180, 0.12],
]);
/** A fringe just above the brows, and the sides down to a curtain. */
const FRINGE_LINE = marks([
  [0, 0.19],
  [24, 0.192],
  [44, 0.188],
  [56, 0.165],
  [66, 0.13],
  [78, 0.11],
  [180, 0.11],
]);
/** Round the face, wide open, for hair with a lot of volume. */
const ROUND_LINE = marks([
  [0, 0.212],
  [24, 0.21],
  [44, 0.195],
  [58, 0.165],
  [70, 0.115],
  [90, 0.09],
  [180, 0.075],
]);

/** Thin at the hairline, thickest at the crown. */
const thick = (edge: number, crown: number) => (_face: number, up: number) => edge + (crown - edge) * up ** 0.8;

const SHORT: Layer = { hairline: SHORT_LINE, thickness: thick(0.005, 0.023) };
const TIED: Layer = { hairline: TIED_LINE, thickness: thick(0.004, 0.016) };
const BALD: Layer = { hairline: SHORT_LINE, thickness: () => 0 };

/** Behind the ears and over them, down to the jaw. */
const BOB_CURTAIN: LoftRing[] = [
  [0.03, 0.1, 0.07, 2, -0.03],
  [0.07, 0.132, 0.1, 2, -0.028],
  [0.14, 0.143, 0.112, 2, -0.028],
  [0.2, 0.11, 0.1, 2, -0.025],
];
/** Behind the ears and down the back past the shoulders. */
const LONG_CURTAIN: LoftRing[] = [
  [-0.24, 0.085, 0.05, 2, -0.075],
  [-0.1, 0.13, 0.075, 2, -0.065],
  [0.04, 0.138, 0.098, 2, -0.045],
  [0.14, 0.143, 0.11, 2, -0.032],
  [0.2, 0.11, 0.1, 2, -0.025],
];

/** The cap's crown, [radius, height] in the hat's space, round an axis this far behind the head's. */
const CAP_CROWN: [number, number][] = [[0.128, -0.075], [0.122, -0.02], [0.08, 0.018], [0, 0.03]];
const CAP_Z = -0.012;
const CAP_SEGMENTS = 10;

/** Hats come down to this height of the head at least, so hair worn under one begins here. */
const UNDER_HAT = 0.2;
const underHat = (line: (fromFace: number) => number, covers?: LoftRing[][]): Layer => ({
  hairline: (face) => Math.min(line(face), UNDER_HAT - 0.004),
  start: () => UNDER_HAT,
  thickness: () => 0.007,
  covers,
  underHat: true,
});

/**
 * Curls spread evenly over the hair and never below its hairline: [degrees round, elevation] seen
 * from the middle of the head, along a golden-angle spiral.
 */
const CURLS: [number, number][] = Array.from({ length: 96 }, (_, i): [number, number] => {
  const height = 1 - ((i + 0.5) / 96) * 1.7;
  return [Math.round((i * 137.508) % 360), Math.round((Math.asin(height) * 180) / Math.PI)];
}).filter(([around, elevation]) => elevation > 46 - 0.42 * fromFace(around));

/** Spikes: [degrees round, elevation, length, lean forward]. */
const SPIKES: [number, number, number, number][] = [
  [90, 58, 0.12, 0.5],
  [62, 52, 0.1, 0.3],
  [118, 52, 0.1, 0.3],
  [90, 80, 0.12, 0.2],
  [20, 50, 0.09, 0],
  [160, 50, 0.09, 0],
  [270, 72, 0.11, -0.2],
  [230, 46, 0.09, -0.2],
  [310, 46, 0.09, -0.2],
  [340, 22, 0.07, 0],
  [200, 22, 0.07, 0],
];

/** A spike growing out of the hair, its base sunk into it. */
function spikeOn(base: Layer, [around, elevation, length, lean]: [number, number, number, number], radius = 0.042, options: Options = {}): ShapePiece {
  const { at, out } = spot(base, around, elevation, -0.012);
  const dir = plus(out, [0, 0.35, lean]);
  const size = Math.hypot(...dir);
  const unit: Vec3 = [dir[0] / size, dir[1] / size, dir[2] / size];
  return cylinder(0, radius, length, 5, { at: plus(at, unit, length / 2), rot: pointing(unit), faceted: true, ...options });
}

function hair(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.${id}`, name, "hair", HAIR, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

function hat(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.hat_${id}`, name, "hair", color, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

/** Where the hats' axis is: under the middle of the head. */
const HAT_Z = -0.004;

const bump = (at: number, from: number, to: number) => (at <= from || at >= to ? 0 : Math.sin(((at - from) / (to - from)) * Math.PI));

/** Swept up off the forehead and back. */
const QUIFF: Layer = {
  hairline: SHORT_LINE,
  thickness: (face, up) => thick(0.005, 0.02)(face, up) + 0.03 * (face < 75 ? Math.cos((face / 75) * (Math.PI / 2)) : 0) * bump(up, 0.05, 1),
};
/** Round and full, less of it over the forehead so the face shows. */
const AFRO: Layer = {
  hairline: ROUND_LINE,
  thickness: (face, up) => 0.012 + (0.076 - 0.036 * (1 - Math.min(face / 70, 1)) * (1 - up)) * Math.min(up / 0.6, 1) ** 0.7,
};
const CURLY: Layer = { hairline: TIED_LINE, thickness: thick(0.008, 0.02) };
/** From the tie at the back of the head down past the nape, in the hair's space. */
const PONYTAIL: Vec3[] = [
  [0, -0.068, -0.09],
  [0, -0.078, -0.135],
  [0, -0.09, -0.156],
  [0, -0.14, -0.158],
  [0, -0.23, -0.14],
  [0, -0.33, -0.115],
];
/** Fins along the middle of the head: [degrees round, elevation, length]. */
const MOHAWK: [number, number, number][] = [
  [90, 40, 0.09],
  [90, 62, 0.11],
  [90, 84, 0.12],
  [270, 74, 0.12],
  [270, 52, 0.11],
  [270, 30, 0.09],
];

// --- limbs --------------------------------------------------------------------------------

function limb(id: string, name: string, color: string, rings: LoftRing[], top: string, end: string, length: number): BlockDef {
  return block(`lp.${id}`, name, "body", color, compound(flat(rings, 8)), [
    socket(top, [0, 0, 0], [0, 1, 0]),
    socket(end, [0, -length, 0], [0, -1, 0]),
  ]);
}

/** The thumb sits on `side`: +1 for the left hand and -1 for the right. */
function hand(id: string, name: string, side: 1 | -1): BlockDef {
  return block(
    `lp.${id}`,
    name,
    "body",
    SKIN,
    compound(
      flat(
        [
          [-0.17, 0.018, 0.012],
          [-0.13, 0.04, 0.016],
          [-0.075, 0.047, 0.021],
          [-0.02, 0.042, 0.022],
          [0.014, 0.02, 0.014],
        ],
        6,
      ),
      stick(
        [
          [side * 0.03, -0.035, 0.012],
          [side * 0.056, -0.075, 0.03],
          [side * 0.056, -0.105, 0.04],
        ],
        [0.017, 0.014, 0.009],
      ),
    ),
    // The grip points the thumb's way, a little down and to the back of the hand: what is held
    // there (a weapon's grip, see scripts/import-weapons.ts) then aims along the arm in the clips.
    [socket("wrist", [0, 0, 0], [0, 1, 0]), socket("grip", [0, -0.09, 0.02], [side * 0.89, -0.34, 0.31])],
  );
}

const SOLE = [socket("ankle", [0, 0, 0], [0, 1, 0]), socket("sole", [0, -0.07, 0.05], [0, -1, 0])];

const shoeBody = () =>
  flat(
    [
      [-0.085, 0.03, 0.025, 2, -0.02],
      [-0.06, 0.05, 0.052, 2, -0.012],
      [0.04, 0.052, 0.05, 2, -0.02],
      [0.15, 0.05, 0.03, 2, -0.04],
      [0.205, 0.02, 0.012, 2, -0.05],
    ],
    8,
    { axis: "z" },
  );

const soleSlab = (color: string) => box([0.104, 0.02, 0.295], { at: [0, -0.06, 0.06], color });

function shoe(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.shoe_${id}`, name, "body", color, compound(pieces), SOLE);
}

function hips(id: string, name: string, rings: LoftRing[], hipX: number, belt: number): BlockDef {
  return block(
    `lp.${id}`,
    name,
    "body",
    PANTS,
    compound(
      flat(rings, 10),
      flat(
        [
          [-0.024, belt, 0.106],
          [0.008, belt, 0.106],
        ],
        10,
        { color: "#2a2018" },
      ),
      box([0.044, 0.036, 0.012], { at: [0, -0.008, 0.1], color: GOLD, finish: "metal" }),
    ),
    [
      socket("waist", [0, 0, 0], [0, 1, 0]),
      socket("hip_left", [hipX, -0.14, 0], [0, -1, 0]),
      socket("hip_right", [-hipX, -0.14, 0], [0, -1, 0]),
      socket("belt", [0, 0, 0], [0, -1, 0]),
    ],
  );
}

/**
 * A backpack for a build of torso, in the torso's own measures: the bag sinks a little into the
 * back, so it sits flush however round the back is, and the straps come over the shoulders, down
 * the chest and back under the arms. It hangs from the torso's back socket and takes its scale.
 */
function backpack(build: Build): BlockDef {
  const [, socketY, socketZ] = backSocket(build);
  const local = ([x, y, z]: Vec3): Vec3 => [x, Math.round((y - socketY) * 1e4) / 1e4, Math.round((z - socketZ) * 1e4) / 1e4];
  const shoulder = build.shoulderY;
  const across = build.shoulderX * 0.53;
  /** A narrower torso gets a narrower bag. */
  const wide = build.shoulderX / 0.2;
  /** Where the top of the torso is at x: the height at which it is that wide. */
  let over = shoulder;
  while (over < build.neckY && sectionAt(build, over).half > across) over += 0.002;
  const strap = (side: 1 | -1): Vec3[] => {
    const front = (x: number, y: number) => local([side * x, y, surfaceZ(build, x, y, 1) + 0.013]);
    const under = shoulder - 0.245;
    return [
      local([side * across * 0.8, BACK_Y + 0.09, backZ(build, BACK_Y + 0.09) - 0.02]),
      local([side * across, over + 0.012, sectionAt(build, over).middle - 0.01]),
      front(across, shoulder + 0.02),
      front(across + 0.005, shoulder - 0.085),
      front(across + 0.025, shoulder - 0.195),
      local([side * (sectionAt(build, under).half + 0.01), under, sectionAt(build, under).middle]),
      local([side * (across + 0.02), BACK_Y - 0.15, backZ(build, BACK_Y - 0.15) - 0.03]),
    ];
  };
  return block(
    `lp.backpack${build.suffix}`,
    build.suffix ? "Mochila (fem.)" : "Mochila",
    "hair",
    "#c9772b",
    compound(
      // Deep enough at its front to stay sunk in the back even at its sides, where the back curves away.
      flat(
        [
          [-0.17, 0.11 * wide, 0.07, 3, -0.01],
          [-0.14, 0.13 * wide, 0.085, 3, -0.02],
          [0.06, 0.128 * wide, 0.085, 3, -0.022],
          [0.11, 0.1 * wide, 0.07, 3, -0.02],
          [0.13, 0.04 * wide, 0.03, 2, -0.03],
        ],
        8,
      ),
      box([0.18 * wide, 0.12, 0.04], { at: [0, -0.075, -0.112], shade: 0.8 }),
      ...pair((side) => [stick(strap(side), [0.016, 0.017, 0.017, 0.017, 0.017, 0.016, 0.016], { shade: 0.65, flat: 0.4, steps: 2 })]),
    ),
    [socket("back", [0, 0, 0], [0, 0, 1])],
  );
}

export const lowPolyBlocks: BlockDef[] = [
  hips(
    "hips",
    "Quadril",
    [
      [-0.225, 0.07, 0.055],
      [-0.175, 0.178, 0.112],
      [-0.075, 0.18, 0.112],
      [0.012, 0.152, 0.1],
    ],
    0.085,
    0.158,
  ),
  hips(
    "hips_f",
    "Quadril (fem.)",
    [
      [-0.225, 0.08, 0.06],
      [-0.175, 0.2, 0.12],
      [-0.075, 0.19, 0.112],
      [0.012, 0.138, 0.094],
    ],
    0.098,
    0.142,
  ),

  ...torsos(MALE),
  ...torsos(FEMALE),
  torso(FEMALE, "dress", "Vestido", "#a0335a", [collar(FEMALE)]),

  block(
    "lp.neck",
    "Pescoço",
    "body",
    SKIN,
    compound(
      flat(
        [
          [-0.03, 0.064, 0.062],
          [0.075, 0.052, 0.054],
          [0.082, 0.012, 0.012],
        ],
        8,
      ),
    ),
    [socket("base", [0, 0, 0], [0, -1, 0]), socket("head", [0, 0.055, 0], [0, 1, 0])],
  ),

  head({ id: "oval", name: "Cabeça oval", width: 1, jaw: 0.97, chin: 1 }),
  head({ id: "square", name: "Cabeça de queixo largo", width: 1.02, jaw: 1.18, chin: 1.55 }),
  head({ id: "soft", name: "Cabeça delicada", width: 0.97, jaw: 0.84, chin: 0.8 }),
  head({ id: "round", name: "Cabeça redonda", width: 1.05, jaw: 1.08, chin: 1.2 }),

  limb(
    "upper_arm",
    "Braço",
    SKIN,
    [
      [-0.29, 0.042, 0.042],
      [-0.2, 0.05, 0.052],
      [-0.06, 0.058, 0.06],
      [0.03, 0.05, 0.05],
      [0.055, 0.015, 0.015],
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
      [-0.265, 0.032, 0.03],
      [-0.18, 0.044, 0.042],
      [-0.06, 0.05, 0.047],
      [0.02, 0.036, 0.036],
      [0.034, 0.008, 0.008],
    ],
    "elbow",
    "wrist",
    0.26,
  ),
  hand("hand", "Mão esquerda", 1),
  hand("hand_right", "Mão direita", -1),
  limb(
    "thigh",
    "Coxa",
    PANTS,
    [
      [-0.41, 0.058, 0.06],
      [-0.25, 0.074, 0.08],
      [-0.08, 0.09, 0.095],
      [0.03, 0.09, 0.094],
      [0.07, 0.03, 0.03],
    ],
    "hip",
    "knee",
    0.4,
  ),
  limb(
    "calf",
    "Canela",
    PANTS,
    [
      [-0.385, 0.04, 0.042],
      [-0.24, 0.056, 0.06, 2, -0.008],
      [-0.12, 0.064, 0.07, 2, -0.012],
      [0, 0.052, 0.054],
      [0.034, 0.01, 0.01],
    ],
    "knee",
    "ankle",
    0.38,
  ),

  shoe("sneaker", "Tênis", "#d6dde6", [shoeBody(), soleSlab(WHITE)]),
  shoe("formal", "Sapato", "#2b2320", [shoeBody(), soleSlab("#14110f")]),
  shoe("boot", "Bota", "#5a4632", [
    shoeBody(),
    soleSlab("#191614"),
    flat(
      [
        [-0.01, 0.054, 0.066],
        [0.17, 0.056, 0.072],
        [0.19, 0.012, 0.012],
      ],
      8,
      { at: [0, 0, -0.012], shade: 0.9 },
    ),
  ]),
  shoe("heel", "Salto", "#a0335a", [
    flat(
      [
        [-0.082, 0.024, 0.02, 2, 0.012],
        [-0.05, 0.043, 0.042, 2, 0.01],
        [0.05, 0.046, 0.032, 2, -0.03],
        [0.17, 0.042, 0.018, 2, -0.056],
        [0.195, 0.016, 0.008, 2, -0.058],
      ],
      8,
      { axis: "z" },
    ),
    cylinder(0.014, 0.008, 0.075, 5, { at: [0, -0.034, -0.062], faceted: true }),
  ]),

  block(
    "lp.skirt",
    "Saia",
    "body",
    "#a0335a",
    compound(
      flat(
        [
          [-0.43, 0.012, 0.012],
          [-0.425, 0.26, 0.2],
          [-0.2, 0.2, 0.15],
          [0.02, 0.15, 0.105],
          [0.03, 0.03, 0.03],
        ],
        12,
      ),
      flat(
        [
          [-0.012, 0.16, 0.112],
          [0.024, 0.158, 0.11],
        ],
        12,
        { shade: 0.74 },
      ),
    ),
    [socket("waist", [0, 0, 0], [0, 1, 0])],
  ),

  face("eyes_round", "Olhos redondos", "#5a3a22", eye({ white: 0.026, iris: 0.0145 })),
  face("eyes_big", "Olhos grandes", "#5a3a22", eye({ white: 0.033, iris: 0.0185 })),
  face("eyes_lashes", "Olhos com cílios", "#5a3a22", eye({ white: 0.028, iris: 0.0155, lash: true })),
  face(
    "eyes_dot",
    "Olhos de ponto",
    "#5a3a22",
    pair((side) => [hex(0.017, { at: [side * EYE_X, 0, EYE_Z], rot: facing(side), color: "#101218" })]),
  ),

  face("brows_straight", "Sobrancelhas retas", HAIR, brow(0, 0, 0.011)),
  face("brows_arched", "Sobrancelhas arqueadas", HAIR, brow(0.004, -9, 0.007)),
  face("brows_angry", "Sobrancelhas bravas", HAIR, brow(0, 13, 0.012)),

  face("nose_small", "Nariz pequeno", SKIN, [nose(0.016, 0.045, 0.016)]),
  face("nose_long", "Nariz fino", SKIN, [nose(0.016, 0.06, 0.024)]),
  face("nose_wide", "Nariz largo", SKIN, [nose(0.024, 0.05, 0.02)]),

  face("mouth_smile", "Sorriso", "#a0524d", [curve(0.03, 0.006, 0.006)]),
  face("mouth_flat", "Boca reta", "#a0524d", [box([0.042, 0.006, 0.01], { at: [0, 0, -0.004] })]),
  face("mouth_full", "Lábios cheios", "#b5484f", [
    hex(0.024, { at: [0, 0.003, -0.004], rot: [90, 0, 0], scale: [1, 1, 0.22] }),
    hex(0.024, { at: [0, -0.006, -0.003], rot: [90, 0, 0], scale: [0.86, 1, 0.3] }),
  ]),
  face("mouth_grin", "Sorriso largo", "#a0524d", [curve(0.037, 0.008, 0.007)]),

  block(
    "lp.ear",
    "Orelha",
    "face",
    SKIN,
    compound(chunk(0.034, { at: [-0.004, 0, 0], scale: [0.42, 1, 0.72] })),
    [socket("base", [0, 0, 0], [1, 0, 0])],
  ),

  face("beard_full", "Barba cheia", HAIR, [
    flat(
      [
        [-0.075, 0.03, 0.03, 2, -0.05],
        [-0.04, 0.075, 0.066, 2, -0.058],
        [-0.008, 0.09, 0.08, 2, -0.066],
        [0.002, 0.02, 0.02, 2, -0.066],
      ],
      10,
    ),
  ]),
  face("beard_goatee", "Cavanhaque", HAIR, [
    flat(
      [
        [-0.05, 0.008, 0.008],
        [-0.03, 0.03, 0.014],
        [0.008, 0.026, 0.012],
      ],
      6,
    ),
  ]),
  face(
    "beard_mustache",
    "Bigode",
    HAIR,
    pair((side) => [box([0.05, 0.016, 0.014], { at: [side * 0.024, 0.038, -0.002], rot: [0, 0, side * -16] })]),
  ),

  face("glasses_round", "Óculos redondos", DARK, [
    ...pair((side) => [
      hex(0.032, { at: [side * 0.05, 0, 0.002], rot: facing(side), color: "#b8a26a" }),
      hex(0.026, { at: [side * 0.05, 0, 0.006], rot: facing(side), color: "#a8c4d6", finish: "glass" }),
      box([0.006, 0.006, 0.12], { at: [side * 0.106, 0.004, -0.058], color: "#b8a26a" }),
    ]),
    box([0.03, 0.006, 0.006], { at: [0, 0.008, 0.006], color: "#b8a26a" }),
  ]),
  face("glasses_sun", "Óculos escuros", DARK, [
    ...pair((side) => [
      box([0.062, 0.04, 0.008], { at: [side * 0.05, 0, 0.004], rot: [0, side * FACET_YAW, 0], color: "#10141c", finish: "glass" }),
      box([0.006, 0.006, 0.12], { at: [side * 0.106, 0.006, -0.058], color: DARK }),
    ]),
    box([0.03, 0.006, 0.006], { at: [0, 0.012, 0.01], color: DARK }),
  ]),

  hair("short", "Cabelo curto", [layer(SHORT)]),
  hair("side", "Topete", [layer(QUIFF)]),
  hair("bob", "Chanel", [layer({ hairline: FRINGE_LINE, thickness: thick(0.008, 0.022), covers: [BOB_CURTAIN] }), curtain(BOB_CURTAIN)]),
  hair("long", "Cabelo longo", [layer({ hairline: CURTAIN_LINE, thickness: thick(0.007, 0.02), covers: [LONG_CURTAIN] }), curtain(LONG_CURTAIN)]),
  hair("bun", "Coque", [
    layer(TIED),
    ball(0.06, { at: spot(TIED, 270, 52, 0.032).at }),
    hex(0.048, { at: spot(TIED, 270, 52, 0.002).at, rot: pointing(spot(TIED, 270, 52).out), color: "#c23b3b" }),
  ]),
  hair("ponytail", "Rabo de cavalo", [
    layer(TIED),
    // The tie is a band round the tail where it leaves the head.
    cylinder(0.036, 0.036, 0.018, 6, { at: [0, -0.079, -0.138], rot: [90, 0, 0], color: "#c23b3b", faceted: true }),
    stick(PONYTAIL, [0.022, 0.031, 0.034, 0.034, 0.026, 0.006], { radial: 6, steps: 2 }),
  ]),
  hair("afro", "Black power", [layer(AFRO)]),
  hair("curly", "Cacheado", [layer(CURLY), ...CURLS.map(([around, elevation]) => chunk(0.03, { at: spot(CURLY, around, elevation).at }))]),
  hair("spiky", "Espetado", [layer(SHORT), ...SPIKES.map((placed) => spikeOn(SHORT, placed))]),
  hair(
    "mohawk",
    "Moicano",
    MOHAWK.map(([around, elevation, length]) => spikeOn(BALD, [around, elevation, length, 0], 0.05, { scale: [0.32, 1, 1] })),
  ),
  hair("under_short", "Cabelo sob chapéu", [layer(underHat(SHORT_LINE))]),
  hair("under_long", "Cabelo longo sob chapéu", [layer(underHat(CURTAIN_LINE, [LONG_CURTAIN])), curtain(LONG_CURTAIN)]),

  // Every hat's band is a little wider than the widest head with hair under it, and comes down to
  // just above the brows; the cap keeps its snug crown, and the hair under it is pressed inside.
  hat("cap", "Boné", "#c23b3b", [
    lathe(CAP_CROWN, { at: [0, 0, CAP_Z], faceted: true }, CAP_SEGMENTS),
    flat(
      [
        [0.09, 0.1, 0.008, 3, -0.072],
        [0.2, 0.09, 0.008, 3, -0.07],
        [0.24, 0.05, 0.007, 3, -0.076],
      ],
      8,
      { axis: "z", shade: 0.8 },
    ),
  ]),
  hat("beanie", "Touca", "#3a7d6b", [
    lathe([[0.137, -0.066], [0.133, -0.02], [0.104, 0.03], [0.055, 0.05], [0, 0.054]], { at: [0, 0, HAT_Z], faceted: true }, 10),
    cylinder(0.142, 0.142, 0.048, 10, { at: [0, -0.064, HAT_Z], shade: 0.8, faceted: true }),
  ]),
  hat("top", "Cartola", "#22242c", [
    lathe([[0.135, -0.062], [0.13, 0.03], [0.138, 0.15], [0, 0.158]], { at: [0, 0, HAT_Z], faceted: true, finish: "gloss" }, 10),
    cylinder(0.19, 0.19, 0.014, 10, { at: [0, -0.07, HAT_Z], faceted: true, finish: "gloss" }),
    cylinder(0.139, 0.137, 0.03, 10, { at: [0, -0.046, HAT_Z], color: "#8f2a2e", faceted: true }),
  ]),
  hat("cowboy", "Chapéu de caubói", "#8a5a30", [
    lathe([[0.137, -0.066], [0.126, 0.02], [0.1, 0.075], [0.062, 0.094], [0, 0.092]], { at: [0, 0, HAT_Z], faceted: true }, 10),
    cylinder(0.25, 0.25, 0.016, 10, { at: [0, -0.072, HAT_Z], scale: [0.92, 1, 1.06], faceted: true }),
    cylinder(0.139, 0.137, 0.028, 10, { at: [0, -0.056, HAT_Z], color: "#3a2a1e", faceted: true }),
  ]),

  backpack(MALE),
  backpack(FEMALE),
];
