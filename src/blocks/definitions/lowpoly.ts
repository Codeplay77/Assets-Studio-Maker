import type { BlockDef, LoftRing, ShapePiece, Vec3 } from "../types.ts";
import { block, box, compound, cylinder, icosahedron, lathe, loft, socket, tube } from "./helpers.ts";

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
const spike = (radius: number, height: number, options: Options = {}) =>
  cylinder(0, radius, height, 5, { faceted: true, ...options });
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
  socket("back", [0, 0.3, -0.125], [0, 0, -1]),
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

function head({ id, name, width, jaw, chin }: HeadSpec): BlockDef {
  return block(
    `lp.head_${id}`,
    name,
    "body",
    SKIN,
    compound(
      flat(
        [
          [0, 0.012, 0.018, 2, 0.02],
          [0.012, 0.046 * chin, 0.056, 2, 0.024],
          [0.045, 0.08 * jaw, 0.086, 2, 0.012],
          [0.1, 0.104 * ((jaw + 1) / 2), 0.108, 2, 0.004],
          [0.16, 0.112 * width, 0.12, 2, 0],
          [0.215, 0.1 * width, 0.112, 2, -0.004],
          [0.255, 0.06, 0.072, 2, -0.006],
          [0.27, 0.008, 0.01, 2, -0.006],
        ],
        12,
      ),
    ),
    headSockets,
  );
}

// The two front facets of the head turn about 15 degrees away from the middle.
const FACET_YAW = 15;
const EYE_X = 0.046;
const EYE_Z = -0.0075;

/** A disc turned to lie on the facet, where `yaw` says which way it faces. */
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

const cap = () =>
  flat(
    [
      [-0.115, 0.117, 0.128, 2, -0.012],
      [-0.07, 0.123, 0.132, 2, -0.014],
      [-0.028, 0.104, 0.114, 2, -0.012],
      [0.002, 0.055, 0.062, 2, -0.01],
      [0.016, 0.006, 0.006, 2, -0.01],
    ],
    12,
    // Tilting around the top of the head slides the rim forward, so it is moved back to cover the nape.
    { rot: [-22, 0, 0], at: [0, -0.004, -0.044] },
  );

/** Short tufts in front of the ears, so the edge of the hair does not read as a helmet. */
const temples = () =>
  pair((side) => [
    chunk(0.046, { at: [side * 0.098, -0.092, 0.04], rot: [0, side * 24, side * -6], scale: [0.5, 1.2, 0.86] }),
    chunk(0.038, { at: [side * 0.05, -0.052, 0.112], rot: [-30, 0, 0], scale: [1.5, 0.62, 0.6] }),
  ]);

/** Hair falling behind the ears down to `bottom`. */
const curtain = (bottom: number, narrow = 0.1) =>
  flat(
    [
      [bottom, narrow, 0.05, 2, -0.075],
      [bottom * 0.7, 0.13, 0.08, 2, -0.06],
      [-0.1, 0.13, 0.098, 2, -0.044],
      [-0.02, 0.1, 0.085, 2, -0.04],
    ],
    10,
  );

function hair(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.${id}`, name, "hair", HAIR, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

function hat(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`lp.hat_${id}`, name, "hair", color, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

const CURL_SPOTS: Vec3[] = [
  [0, 0.022, 0.02],
  [0.075, 0, 0.05],
  [-0.075, 0, 0.05],
  [0.11, -0.04, -0.03],
  [-0.11, -0.04, -0.03],
  [0.045, 0.012, -0.06],
  [-0.045, 0.012, -0.06],
  [0.09, -0.06, -0.09],
  [-0.09, -0.06, -0.09],
  [0, -0.04, -0.13],
  [0.03, -0.012, 0.1],
  [-0.03, -0.012, 0.1],
];

const SPIKE_SPOTS: [number, number, number, number][] = [
  [0, 0.05, 0.075, -24],
  [0.06, 0.03, 0.05, -14],
  [-0.06, 0.03, 0.05, -14],
  [0, 0.06, -0.01, -4],
  [0.075, 0.015, -0.03, 8],
  [-0.075, 0.015, -0.03, 8],
  [0, 0.04, -0.085, 20],
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
    [socket("wrist", [0, 0, 0], [0, 1, 0]), socket("grip", [0, -0.09, 0.02], [0, 0, 1])],
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

// ------------------------------------------------------------------------------------------

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

  hair("short", "Cabelo curto", [cap(), ...temples()]),
  hair("side", "Topete", [cap(), ...temples(), chunk(0.105, { at: [0.024, -0.016, 0.07], rot: [-20, 0, -12], scale: [1.15, 0.42, 0.66] })]),
  hair("bob", "Chanel", [cap(), curtain(-0.255, 0.115)]),
  hair("long", "Cabelo longo", [cap(), curtain(-0.5, 0.08)]),
  hair("bun", "Coque", [cap(), ball(0.062, { at: [0, 0.008, -0.1] }), hex(0.05, { at: [0, -0.016, -0.1], rot: [70, 0, 0], color: "#c23b3b" })]),
  hair("ponytail", "Rabo de cavalo", [
    cap(),
    hex(0.032, { at: [0, -0.06, -0.135], rot: [62, 0, 0], color: "#c23b3b" }),
    stick(
      [
        [0, -0.05, -0.14],
        [0, -0.12, -0.2],
        [0, -0.24, -0.21],
        [0, -0.36, -0.18],
      ],
      [0.03, 0.046, 0.036, 0.006],
      { radial: 5 },
    ),
  ]),
  hair("afro", "Black power", [ball(0.19, { at: [0, -0.085, -0.03] })]),
  hair("curly", "Cacheado", [cap(), ...CURL_SPOTS.map((at) => ball(0.05, { at }))]),
  hair("spiky", "Espetado", [
    cap(),
    ...SPIKE_SPOTS.map(([x, y, z, tilt]) =>
      spike(0.044, 0.12, { at: [x, y + 0.04, z], rot: [tilt, 0, Math.sign(x) * -14] }),
    ),
  ]),
  hair("mohawk", "Moicano", [
    ...[-0.14, -0.08, -0.02, 0.04, 0.1].map((z, index) =>
      spike(0.05, 0.13 + (index % 2) * 0.02, {
        at: [0, 0.03 - Math.abs(z) * 0.5, z],
        scale: [0.32, 1, 1],
      }),
    ),
  ]),
  hair("under_short", "Cabelo sob chapéu", [curtain(-0.17, 0.12)]),
  hair("under_long", "Cabelo longo sob chapéu", [curtain(-0.42, 0.09)]),

  hat("cap", "Boné", "#c23b3b", [
    lathe([[0.128, -0.075], [0.122, -0.02], [0.08, 0.018], [0, 0.03]], { at: [0, 0, -0.012], faceted: true }, 10),
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
    lathe([[0.132, -0.075], [0.126, -0.01], [0.08, 0.035], [0, 0.048]], { at: [0, 0, -0.012], faceted: true }, 10),
    cylinder(0.136, 0.136, 0.05, 10, { at: [0, -0.07, -0.012], shade: 0.8, faceted: true }),
  ]),
  hat("top", "Cartola", "#22242c", [
    lathe([[0.102, -0.05], [0.098, 0.03], [0.112, 0.16], [0, 0.17]], { at: [0, 0, -0.012], faceted: true, finish: "gloss" }, 10),
    cylinder(0.175, 0.175, 0.016, 10, { at: [0, -0.068, -0.012], faceted: true, finish: "gloss" }),
    cylinder(0.106, 0.104, 0.035, 10, { at: [0, -0.035, -0.012], color: "#8f2a2e", faceted: true }),
  ]),
  hat("cowboy", "Chapéu de caubói", "#8a5a30", [
    lathe([[0.114, -0.06], [0.1, 0.03], [0.076, 0.09], [0, 0.1]], { at: [0, 0, -0.012], faceted: true }, 10),
    cylinder(0.24, 0.24, 0.018, 10, { at: [0, -0.066, -0.012], scale: [0.92, 1, 1.06], faceted: true }),
    cylinder(0.116, 0.114, 0.024, 10, { at: [0, -0.047, -0.012], color: "#3a2a1e", faceted: true }),
  ]),

  block(
    "lp.backpack",
    "Mochila",
    "hair",
    "#c9772b",
    compound(
      flat(
        [
          [-0.2, 0.06, 0.04, 3, -0.07],
          [-0.17, 0.14, 0.07, 3, -0.07],
          [0.1, 0.135, 0.07, 3, -0.075],
          [0.2, 0.04, 0.03, 2, -0.065],
        ],
        8,
      ),
      box([0.2, 0.14, 0.04], { at: [0, -0.07, -0.145], shade: 0.8 }),
      ...pair((side) => [
        stick(
          [
            [side * 0.085, 0.17, -0.01],
            [side * 0.1, 0.22, 0.05],
            [side * 0.105, 0.1, 0.15],
            [side * 0.11, -0.13, 0.12],
          ],
          [0.018, 0.02, 0.02, 0.016],
          { shade: 0.65, flat: 0.3 },
        ),
      ]),
    ),
    [socket("back", [0, 0, 0], [0, 0, 1])],
  ),
];
