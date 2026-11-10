import type { BlockDef, LoftRing, ShapePiece, Vec3 } from "../types.ts";
import { block, compound, cylinder, loft, lumpy, socket, sphere, tube } from "./helpers.ts";

const BARK = "#6e4a2c";
const LEAF = "#3fae5a";

const standSockets = (top: number) => [
  socket("bottom", [0, 0, 0], [0, -1, 0]),
  socket("top", [0, top, 0], [0, 1, 0]),
];

function plant(id: string, name: string, color: string, pieces: ShapePiece[], top: number): BlockDef {
  return block(`nature.${id}`, name, "nature", color, compound(pieces), standSockets(top));
}

/** A tapered trunk that flares into roots at the base. */
function trunk(radiusTop: number, radiusBottom: number, height: number, color = BARK): ShapePiece {
  const rings: LoftRing[] = [
    [0, radiusBottom * 1.45, radiusBottom * 1.45],
    [height * 0.04, radiusBottom * 1.12, radiusBottom * 1.12],
    [height * 0.14, radiusBottom * 0.96, radiusBottom * 0.96],
    [height * 0.5, (radiusBottom + radiusTop) * 0.5, (radiusBottom + radiusTop) * 0.5],
    [height, radiusTop, radiusTop],
  ];
  const bumps = Array.from({ length: 7 }, (_, index) => {
    const angle = (index / 7) * Math.PI * 2;
    return {
      at: [Math.cos(angle) * radiusBottom * 1.4, 0, Math.sin(angle) * radiusBottom * 1.4] as Vec3,
      radius: radiusBottom * 0.55,
      height: radiusBottom * 0.4,
      stretch: [1, 1.1, 1] as Vec3,
    };
  });
  return loft(rings, { color, bumps, segments: 28, steps: 4 });
}

function branch(from: Vec3, to: Vec3, radius: number, color = BARK): ShapePiece {
  const middle: Vec3 = [
    (from[0] + to[0]) / 2 + (to[0] - from[0]) * 0.08,
    (from[1] + to[1]) / 2 + Math.abs(to[0] - from[0]) * 0.06,
    (from[2] + to[2]) / 2,
  ];
  return tube([from, middle, to], [radius, radius * 0.72, radius * 0.4], { color, radial: 10 });
}

const clusters = (spots: [number, number, number, number][], seed: number) =>
  spots.map(([x, y, z, radius], index) =>
    lumpy(radius, seed + index * 2.3, { at: [x, y, z], detail: 4, amount: 0.075, frequency: 2.6 }),
  );

function pineTier(y: number, radius: number, height: number, seed: number, droop: number): ShapePiece {
  const teeth = 14;
  return loft(
    [
      [0, radius * 0.62, radius * 0.62, 2],
      [0.02, radius, radius, 2],
      [height * 0.22, radius * 0.76, radius * 0.76, 2],
      [height * 0.62, radius * 0.36, radius * 0.36, 2],
      [height, 0.012, 0.012, 2],
    ],
    {
      at: [0, y, 0],
      segments: 42,
      steps: 2,
      bumps: Array.from({ length: teeth }, (_, index) => {
        const angle = ((index + seed) / teeth) * Math.PI * 2;
        return {
          at: [Math.cos(angle) * radius, 0, Math.sin(angle) * radius] as Vec3,
          radius: radius * 0.22,
          height: -droop,
          stretch: [0.9, 1.4, 0.9] as Vec3,
        };
      }),
    },
  );
}

const pineTiers = (bottom: number, count: number, radius: number, height: number) =>
  Array.from({ length: count }, (_, index) => {
    const scale = 1 - index * (0.72 / count);
    return pineTier(bottom + index * height * 0.56, radius * scale, height * (1 - index * 0.06), index * 1.4, radius * scale * 0.12);
  });

/** A palm frond: a curved spine with leaflets on both sides. */
function frond(angle: number, length: number, topY: number, x: number): ShapePiece[] {
  const radians = (angle * Math.PI) / 180;
  const out = (distance: number): [number, number] => [
    Math.sin(radians) * distance,
    Math.cos(radians) * distance,
  ];
  const point = (t: number): Vec3 => {
    const [ox, oz] = out(t * length);
    return [x + ox, topY + Math.sin(t * Math.PI * 0.65) * 0.75 - t * t * 1.25, oz];
  };
  const leaflets: ShapePiece[] = [];
  const count = 14;
  for (let i = 1; i <= count; i++) {
    const t = i / (count + 1);
    const [px, py, pz] = point(t);
    const reach = (1 - t * 0.55) * 0.5;
    for (const side of [1, -1]) {
      const tipX = px + Math.cos(radians) * side * reach;
      const tipZ = pz - Math.sin(radians) * side * reach;
      leaflets.push(
        tube(
          [
            [px, py, pz],
            [(px + tipX) / 2, py - reach * 0.05, (pz + tipZ) / 2],
            [tipX + Math.sin(radians) * 0.1, py - reach * 0.32, tipZ + Math.cos(radians) * 0.1],
          ],
          [0.018, 0.04, 0.002],
          { flat: 0.2, radial: 4, steps: 2 },
        ),
      );
    }
  }
  return [
    tube(
      [point(0), point(0.25), point(0.5), point(0.75), point(1)],
      [0.035, 0.026, 0.018, 0.012, 0.003],
      { radial: 7, steps: 4, color: "#7c8a3a" },
    ),
    ...leaflets,
  ];
}

const rock = (radius: number, seed: number, options: Parameters<typeof lumpy>[2] = {}) =>
  lumpy(radius, seed, { detail: 3, amount: 0.15, frequency: 2.4, ...options });

export const natureBlocks: BlockDef[] = [
  plant("oak", "Árvore", LEAF, [
    trunk(0.16, 0.3, 2.5),
    branch([0, 1.7, 0], [1.0, 2.8, 0.3], 0.11),
    branch([0, 1.9, 0], [-1.0, 3.0, -0.2], 0.1),
    branch([0, 2.1, 0], [0.1, 3.1, 1.0], 0.09),
    branch([0, 2.0, 0], [-0.2, 3.0, -1.0], 0.09),
    ...clusters(
      [
        [0, 3.6, 0, 1.5],
        [1.15, 3.0, 0.35, 1.08],
        [-1.15, 3.05, -0.2, 1.12],
        [0.15, 2.9, 1.15, 1.02],
        [-0.25, 3.0, -1.15, 1.02],
        [0.65, 4.2, -0.45, 0.82],
        [-0.6, 4.25, 0.45, 0.8],
      ],
      3,
    ),
  ], 4.9),
  plant("birch", "Bétula", "#8fc25a", [
    trunk(0.07, 0.14, 3.6, "#e6e2d6"),
    ...[0.5, 0.95, 1.5, 2.1, 2.7, 3.1].flatMap((y, index) => [
      cylinder(0.12 - y * 0.018, 0.13 - y * 0.018, 0.035, 12, {
        at: [0, y, 0],
        scale: [1.05, 1, index % 2 ? 0.55 : 1.05],
        color: "#3a3a3a",
      }),
    ]),
    branch([0, 2.8, 0], [0.55, 3.55, 0.2], 0.04, "#d9d4c6"),
    branch([0, 2.9, 0], [-0.5, 3.6, -0.2], 0.04, "#d9d4c6"),
    ...clusters(
      [
        [0, 4.3, 0, 1.05],
        [0.62, 3.6, 0.22, 0.72],
        [-0.56, 3.7, -0.22, 0.74],
        [0.1, 3.65, 0.65, 0.6],
      ],
      9,
    ),
  ], 5.3),
  plant("pine", "Pinheiro", "#2f7a4e", [trunk(0.13, 0.24, 1.5), ...pineTiers(0.85, 5, 1.65, 2.1)], 6.2),
  plant("pine_slim", "Pinheiro fino", "#3a8a64", [trunk(0.1, 0.18, 1.2), ...pineTiers(0.7, 6, 1.0, 1.8)], 6.4),
  plant("palm", "Palmeira", "#58b04a", [
    tube(
      [
        [0, 0, 0],
        [0.05, 1.5, 0],
        [0.22, 3.2, 0],
        [0.48, 5.0, 0],
      ],
      [0.2, 0.15, 0.13, 0.11],
      { color: "#8d6b47", radial: 16, steps: 8 },
    ),
    ...Array.from({ length: 11 }, (_, index) => {
      const t = index / 11;
      const y = 0.25 + t * 4.6;
      return cylinder(0.17 - t * 0.05, 0.19 - t * 0.05, 0.05, 16, {
        at: [(y / 5) ** 2 * 0.48, y, 0],
        color: "#6f5336",
      });
    }),
    sphere(0.17, { at: [0.48, 5.02, 0], color: "#6e4a2c" }),
    ...[0.32, 0.64].map((x, index) =>
      sphere(0.09, { at: [0.48 + x * (index ? -0.3 : 0.3), 4.88, index ? 0.13 : -0.13], color: "#6a4726" }),
    ),
    ...Array.from({ length: 9 }, (_, index) => frond((index * 360) / 9 + 20, index % 2 ? 2.35 : 2.0, 5.05, 0.48)).flat(),
  ], 5.4),
  plant("dead_tree", "Árvore seca", "#6e4a2c", [
    loft(
      [
        [0, 0.36, 0.36],
        [0.15, 0.24, 0.24],
        [1.3, 0.17, 0.17],
        [2.6, 0.08, 0.08],
      ],
      { segments: 20, steps: 4 },
    ),
    tube(
      [
        [0, 1.7, 0],
        [0.42, 2.25, 0.05],
        [0.82, 2.75, -0.1],
        [1.1, 3.4, 0],
      ],
      [0.1, 0.07, 0.04, 0.005],
      { radial: 9, steps: 5 },
    ),
    tube(
      [
        [0, 2.0, 0],
        [-0.3, 2.5, 0.12],
        [-0.72, 2.9, 0.18],
        [-1.0, 3.5, 0.1],
      ],
      [0.08, 0.055, 0.03, 0.004],
      { radial: 9, steps: 5 },
    ),
    tube(
      [
        [0, 2.5, 0],
        [0.05, 3.0, -0.2],
        [-0.05, 3.5, -0.4],
      ],
      [0.05, 0.03, 0.004],
      { radial: 8, steps: 5 },
    ),
    tube(
      [
        [0.6, 2.5, 0],
        [0.95, 2.6, 0.32],
        [1.15, 2.85, 0.52],
      ],
      [0.04, 0.025, 0.003],
      { radial: 7, steps: 5 },
    ),
  ], 3.5),
  plant("bush", "Arbusto", "#4c9e55", [
    ...clusters(
      [
        [0, 0.48, 0, 0.5],
        [0.45, 0.34, 0.12, 0.38],
        [-0.42, 0.36, -0.1, 0.4],
        [0.05, 0.32, -0.42, 0.34],
        [-0.08, 0.32, 0.44, 0.34],
      ],
      17,
    ),
  ], 0.95),
  plant("flower_red", "Flor", "#e8486b", [
    tube(
      [
        [0, 0, 0],
        [0.015, 0.18, 0.01],
        [0, 0.36, 0],
      ],
      [0.008, 0.007, 0.006],
      { color: "#4f9a4a", radial: 6 },
    ),
    ...[1, -1].map((side) =>
      tube(
        [
          [0, 0.1, 0],
          [side * 0.05, 0.17, 0],
          [side * 0.12, 0.2, 0],
        ],
        [0.004, 0.022, 0.002],
        { color: "#4f9a4a", flat: 0.2, radial: 6, steps: 4 },
      ),
    ),
    sphere(0.026, { at: [0, 0.385, 0], scale: [1, 0.7, 1], color: "#f0c94a" }),
    ...Array.from({ length: 8 }, (_, index) => {
      const angle = (index / 8) * Math.PI * 2;
      const tipX = Math.sin(angle) * 0.1;
      const tipZ = Math.cos(angle) * 0.1;
      return tube(
        [
          [tipX * 0.2, 0.385, tipZ * 0.2],
          [tipX * 0.6, 0.402, tipZ * 0.6],
          [tipX, 0.384, tipZ],
        ],
        [0.012, 0.03, 0.006],
        { flat: 0.2, radial: 7, steps: 4 },
      );
    }),
  ], 0.42),
  plant(
    "grass",
    "Tufo de grama",
    "#5eb04f",
    Array.from({ length: 18 }, (_, index) => {
      const angle = index * 2.399;
      const spread = 0.03 + (index % 5) * 0.022;
      const x = Math.cos(angle) * spread;
      const z = Math.sin(angle) * spread;
      const height = 0.24 + ((index * 7) % 5) * 0.045;
      return tube(
        [
          [x, 0, z],
          [x * 1.5, height * 0.6, z * 1.5],
          [x * 3.1, height, z * 3.1],
        ],
        [0.016, 0.012, 0.0008],
        { flat: 0.3, radial: 5, steps: 4 },
      );
    }),
    0.45,
  ),
  plant("cactus", "Cacto", "#4f8a4a", [
    cylinder(0.16, 0.2, 1.7, 12, { at: [0, 0.85, 0] }),
    sphere(0.16, { at: [0, 1.7, 0] }),
    tube([[0.16, 0.7, 0], [0.5, 0.72, 0], [0.52, 1.25, 0]], [0.1, 0.1, 0.09], { radial: 10, steps: 4 }),
    sphere(0.09, { at: [0.52, 1.25, 0] }),
    tube([[-0.16, 1, 0], [-0.44, 1.02, 0], [-0.46, 1.45, 0]], [0.085, 0.085, 0.075], { radial: 10, steps: 4 }),
    sphere(0.075, { at: [-0.46, 1.45, 0] }),
  ], 1.85),
  plant("rock", "Pedra", "#7d8590", [rock(0.42, 4, { at: [0, 0.27, 0], scale: [1.15, 0.75, 1] })], 0.55),
  plant("rocks", "Pedras pequenas", "#868e98", [
    rock(0.26, 7, { at: [0, 0.16, 0], scale: [1.1, 0.75, 1] }),
    rock(0.18, 8, { at: [0.28, 0.1, 0.1], scale: [1, 0.7, 0.9] }),
    rock(0.12, 9, { at: [-0.26, 0.07, 0.2], scale: [1.1, 0.7, 1] }),
  ], 0.35),
  plant("boulder", "Rochedo", "#6e757f", [
    rock(1.2, 13, { at: [0, 0.8, 0], scale: [1.2, 0.8, 1], detail: 6 }),
    rock(0.6, 14, { at: [1.1, 0.35, 0.5], scale: [1, 0.75, 1], detail: 4 }),
  ], 1.6),
];
