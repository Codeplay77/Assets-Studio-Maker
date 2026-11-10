import type { BlockDef, ShapePiece, Vec3 } from "../../types.ts";
import { BUILDING_WIDTH, FLOOR_HEIGHT } from "../city.ts";
import { box, cylinder, extrude, lathe, roundedBox, socket, sphere, torus, tube } from "../helpers.ts";
import { CHROME, DARK_METAL, family, GLASS, LIGHT, sides, STEEL, WHITE, type Options, type Slots } from "./parts.ts";

// Houses and modular towers with the same glossy paint and chunky trim as the vehicles.

const WOOD: Options = { color: "#8a5a34" };
const DOOR: Options = { color: "#6b4226", finish: "gloss" };
const STONE: Options = { color: "#9a9486" };
const FOUNDATION: Options = { color: "#74777f" };
const LEAF: Options = { color: "#3fae5a" };
const FLOWERS = ["#ff3fa4", "#ffc400", "#e8202a"];

export const HOUSE_WALLS = ["#f4d9a6", "#a8d8c8", "#f2b8a8", "#b4cdf0", "#f6efe0", "#ffd76a", "#d8b4f0"];
export const HOUSE_ROOFS = ["#c8452e", "#7a4a26", "#3a5f8a", "#2f7a4e", "#3a3f47", "#8a2be2"];

/** Moves pieces drawn on the plane z = 0 onto a wall that faces `angle` degrees, `depth` from the center. */
export function onWall(angle: number, depth: number, pieces: ShapePiece[]): ShapePiece[] {
  const radians = (angle * Math.PI) / 180;
  const sin = Math.sin(radians);
  const cos = Math.cos(radians);
  return pieces.map((piece) => {
    const [x, y, z] = piece.at ?? [0, 0, 0];
    const [rx, ry, rz] = piece.rot ?? [0, 0, 0];
    const moved = z + depth;
    return {
      ...piece,
      at: [x * cos + moved * sin, y, -x * sin + moved * cos] as Vec3,
      rot: [rx, ry + angle, rz] as Vec3,
    };
  });
}

interface WindowOptions {
  shutters?: boolean;
  lit?: boolean;
}

/** A framed window on the plane z = 0. Frames go in the accent color, shutters in the roof color. */
function windowOn(slots: Required<Slots>, angle: number, depth: number, x: number, y: number, w: number, h: number, options: WindowOptions = {}): void {
  slots.base.push(
    ...onWall(angle, depth, [
      roundedBox([w, h, 0.06], 0.02, { at: [x, y, 0.01], ...(options.lit ? { color: "#ffe9a8", finish: "glow" as const } : GLASS) }),
    ]),
  );
  slots.accent.push(
    ...onWall(angle, depth, [
      roundedBox([w + 0.14, 0.07, 0.1], 0.02, { at: [x, y + h / 2 + 0.035, 0.02] }),
      roundedBox([w + 0.22, 0.09, 0.2], 0.025, { at: [x, y - h / 2 - 0.04, 0.05] }),
      roundedBox([0.07, h, 0.1], 0.02, { at: [x - w / 2 - 0.035, y, 0.02] }),
      roundedBox([0.07, h, 0.1], 0.02, { at: [x + w / 2 + 0.035, y, 0.02] }),
      box([0.04, h, 0.08], { at: [x, y, 0.03] }),
      box([w, 0.04, 0.08], { at: [x, y, 0.03] }),
    ]),
  );
  if (options.shutters) {
    slots.trim.push(...onWall(angle, depth, sides((s) => [roundedBox([w * 0.4, h + 0.06, 0.05], 0.015, { at: [x + s * (w / 2 + 0.26), y, 0.02] })])));
  }
}

function doorOn(slots: Required<Slots>, angle: number, depth: number, x: number, w = 1.05, h = 2.1, base = 0.28): void {
  slots.base.push(
    ...onWall(angle, depth, [
      roundedBox([w, h, 0.08], 0.03, { at: [x, base + h / 2, 0.02], ...DOOR }),
      sphere(0.05, { at: [x + w * 0.34, base + h / 2, 0.08], ...CHROME }),
      roundedBox([w * 0.62, h * 0.24, 0.06], 0.02, { at: [x, base + h * 0.75, 0.05], ...GLASS }),
    ]),
  );
  slots.accent.push(
    ...onWall(angle, depth, [
      roundedBox([w + 0.26, 0.12, 0.14], 0.03, { at: [x, base + h + 0.06, 0.03] }),
      ...sides((s) => [roundedBox([0.1, h, 0.12], 0.025, { at: [x + s * (w / 2 + 0.05), base + h / 2, 0.02] })]),
    ]),
  );
}

const walls = (w: number, h: number, d: number, at: Vec3 = [0, 0, 0]) =>
  roundedBox([w, h, d], 0.07, { at: [at[0], at[1] + h / 2, at[2]] });

const foundation = (w: number, d: number, h = 0.28, at: Vec3 = [0, 0, 0]) =>
  roundedBox([w + 0.14, h, d + 0.14], 0.05, { at: [at[0], at[1] + h / 2, at[2]], ...FOUNDATION });

/** A gabled roof. `ridge` along X when `alongX`, otherwise along Z. Rises from `y`. */
function gable(w: number, d: number, rise: number, y: number, at: [number, number] = [0, 0], alongX = true): ShapePiece {
  const run = (alongX ? d : w) / 2 + 0.34;
  const length = (alongX ? w : d) + 0.62;
  return extrude([[-run, 0], [run, 0], [0, rise]], length, 0.05, { at: [at[0], y, at[1]], rot: [0, alongX ? 0 : 90, 0], bevelSteps: 2 });
}

/** The band under the eaves, in the accent color. */
const eaves = (w: number, d: number, y: number, at: [number, number] = [0, 0]) =>
  roundedBox([w + 0.44, 0.1, d + 0.44], 0.03, { at: [at[0], y, at[1]] });

const chimney = (x: number, y0: number, y1: number, z: number): ShapePiece[] => [
  roundedBox([0.62, y1 - y0, 0.62], 0.04, { at: [x, (y0 + y1) / 2, z], ...STONE }),
  roundedBox([0.76, 0.12, 0.76], 0.03, { at: [x, y1, z], ...DARK_METAL }),
];

const flowerBox = (angle: number, depth: number, x: number, y: number, w: number): ShapePiece[] =>
  onWall(angle, depth, [
    roundedBox([w, 0.16, 0.2], 0.03, { at: [x, y, 0.14], ...WOOD }),
    ...Array.from({ length: 5 }, (_, i) => sphere(0.075, { at: [x - w * 0.4 + (i * w * 0.8) / 4, y + 0.12, 0.14], color: i % 2 ? LEAF.color : FLOWERS[i % 3] })),
  ]);

const steps = (angle: number, depth: number, x: number, width: number): ShapePiece[] =>
  onWall(angle, depth, [
    roundedBox([width, 0.14, 0.34], 0.03, { at: [x, 0.07, 0.2], ...STONE }),
    roundedBox([width, 0.14, 0.2], 0.03, { at: [x, 0.21, 0.1], ...STONE }),
  ]);

const post = (x: number, y0: number, y1: number, z: number, radius = 0.08) => cylinder(radius, radius, y1 - y0, 14, { at: [x, (y0 + y1) / 2, z] });

interface HouseDesign {
  name: string;
  build(slots: Required<Slots>): void;
}

const HOUSES: Record<string, HouseDesign> = {
  casinha: {
    name: "Casinha",
    build(slots) {
      slots.base.push(foundation(5.4, 4.8), ...steps(0, 2.4, 0, 1.4), ...chimney(1.5, 3.4, 5, -0.8), ...flowerBox(0, 2.4, -1.75, 1.08, 1.3), ...flowerBox(0, 2.4, 1.75, 1.08, 1.3));
      slots.paint.push(walls(5.4, 2.7, 4.8, [0, 0.28, 0]));
      slots.trim.push(gable(5.4, 4.8, 1.9, 3.0));
      slots.accent.push(eaves(5.4, 4.8, 3.0));
      doorOn(slots, 0, 2.4, 0);
      windowOn(slots, 0, 2.4, -1.75, 1.72, 1.05, 1.05, { shutters: true });
      windowOn(slots, 0, 2.4, 1.75, 1.72, 1.05, 1.05, { shutters: true });
      for (const a of [90, 270]) windowOn(slots, a, 2.7, 0, 1.72, 1.2, 1.05);
      windowOn(slots, 180, 2.4, 0, 1.72, 1.4, 1.05);
    },
  },
  sobrado: {
    name: "Sobrado",
    build(slots) {
      slots.base.push(foundation(4.6, 5), foundation(2.2, 4.4, 0.2, [3.3, 0, 0.2]), ...steps(0, 2.5, -0.9, 1.5), ...chimney(-1.5, 5.4, 7.2, -1));
      slots.paint.push(walls(4.6, 5.3, 5, [0, 0.28, 0]), walls(2.2, 2.7, 4.4, [3.3, 0.2, 0.2]));
      slots.trim.push(gable(4.6, 5, 1.8, 5.6), roundedBox([2.5, 0.2, 4.7], 0.05, { at: [3.3, 3.0, 0.2] }));
      slots.accent.push(eaves(4.6, 5, 5.6), roundedBox([4.74, 0.1, 5.14], 0.03, { at: [0, 2.94, 0] }));
      doorOn(slots, 0, 2.5, -0.9);
      windowOn(slots, 0, 2.5, 1.05, 1.72, 1.2, 1.1);
      windowOn(slots, 0, 2.5, -1.2, 4.3, 1.1, 1.2, { shutters: true });
      windowOn(slots, 0, 2.5, 1.2, 4.3, 1.1, 1.2, { shutters: true });
      for (const y of [1.72, 4.3]) {
        windowOn(slots, 270, 2.3, 0.8, y, 1, 1.1);
        windowOn(slots, 180, 2.5, 0, y, 1.3, 1.1);
      }
      // Garage door with horizontal panels.
      slots.base.push(
        roundedBox([1.9, 2.1, 0.06], 0.03, { at: [3.3, 1.25, 2.42], ...STEEL }),
        ...[0, 1, 2, 3, 4].map((i) => box([1.86, 0.03, 0.08], { at: [3.3, 0.5 + i * 0.4, 2.44], ...DARK_METAL })),
      );
    },
  },
  moderna: {
    name: "Casa moderna",
    build(slots) {
      slots.base.push(
        foundation(6, 4.6, 0.2),
        roundedBox([3.2, 2.5, 0.06], 0.02, { at: [-1.2, 1.45, 2.32], ...GLASS }),
        ...[-2.4, -1.6, -0.8, 0].map((x) => box([0.05, 2.5, 0.09], { at: [x, 1.45, 2.34], ...DARK_METAL })),
        roundedBox([3, 2, 0.06], 0.02, { at: [0.9, 4.32, 2.62], ...GLASS }),
        ...[-0.3, 0.9, 2.1].map((x) => box([0.05, 2, 0.09], { at: [x, 4.32, 2.64], ...DARK_METAL })),
        // Wooden slats beside the door.
        ...Array.from({ length: 8 }, (_, i) => box([0.12, 2.5, 0.08], { at: [1.0 + i * 0.26, 1.45, 2.34], ...WOOD })),
        ...sides((s) => [cylinder(0.05, 0.05, 2.6, 10, { at: [s * 2.5 + 0.6, 1.5, 2.2], ...CHROME })]),
      );
      slots.paint.push(walls(6, 2.8, 4.6, [0, 0.2, 0]), walls(4.4, 2.6, 5.2, [0.6, 3.0, 0.3]));
      slots.trim.push(
        roundedBox([6.5, 0.2, 5.1], 0.05, { at: [0, 3.05, 0] }),
        roundedBox([4.9, 0.2, 5.7], 0.05, { at: [0.6, 5.66, 0.3] }),
      );
      slots.accent.push(roundedBox([6.56, 0.05, 5.16], 0.015, { at: [0, 2.94, 0] }), roundedBox([4.96, 0.05, 5.76], 0.015, { at: [0.6, 5.55, 0.3] }));
      for (const y of [1.5, 4.3]) windowOn(slots, 180, y < 3 ? 2.3 : 2.3, 0, y, 2.4, 1.1);
    },
  },
  bangalo: {
    name: "Bangalô",
    build(slots) {
      slots.base.push(foundation(6.4, 4.4), roundedBox([6.5, 0.14, 1.5], 0.04, { at: [0, 0.34, 2.8], ...WOOD }), ...steps(0, 3.5, 0, 1.6), ...chimney(2, 3.3, 4.6, -1.2));
      slots.paint.push(walls(6.4, 2.6, 4.4, [0, 0.28, 0]));
      slots.trim.push({ shape: { kind: "frustum", bottom: [7.5, 6.9], top: [3.4, 0.8], height: 1.7 }, at: [0, 3.75, 0.5] });
      slots.accent.push(roundedBox([7.5, 0.12, 6.9], 0.03, { at: [0, 2.94, 0.5] }), ...[-3, -1, 1, 3].map((x) => post(x, 0.4, 2.9, 3.4)), roundedBox([6.5, 0.08, 0.08], 0.02, { at: [0, 1.1, 3.4] }));
      doorOn(slots, 0, 2.2, 0);
      for (const x of [-2.1, 2.1]) windowOn(slots, 0, 2.2, x, 1.72, 1.3, 1.15);
      for (const a of [90, 270]) windowOn(slots, a, 3.2, 0, 1.72, 1.3, 1.15);
      windowOn(slots, 180, 2.2, 0, 1.72, 1.6, 1.15);
    },
  },
  chale: {
    name: "Chalé",
    build(slots) {
      slots.base.push(foundation(5.4, 4.6, 0.3), ...steps(0, 2.4, 0, 1.4));
      slots.paint.push(extrude([[-2.5, 0], [2.5, 0], [0, 5.2]], 4.5, 0.05, { at: [0, 0.3, 0], rot: [0, 90, 0], bevelSteps: 2 }));
      slots.trim.push(...sides((s) => [roundedBox([0.22, 6.6, 5.3], 0.05, { at: [s * 1.62, 2.9, 0], rot: [0, 0, s * 25.7] })]));
      slots.accent.push(...sides((s) => [roundedBox([0.1, 5.7, 0.1], 0.02, { at: [s * 1.36, 2.82, 2.3], rot: [0, 0, s * 25.7] })]));
      slots.base.push(roundedBox([2.5, 2.3, 0.06], 0.02, { at: [0, 3.2, 2.26], ...GLASS }), ...[-0.62, 0, 0.62].map((x) => box([0.05, 2.3, 0.1], { at: [x, 3.2, 2.28], ...DARK_METAL })));
      doorOn(slots, 0, 2.26, 0, 1.05, 1.8, 0.3);
      windowOn(slots, 180, 2.26, 0, 2.2, 1.4, 1.3);
    },
  },
  celeiro: {
    name: "Celeiro",
    build(slots) {
      slots.base.push(foundation(5.4, 6, 0.24));
      slots.paint.push(extrude([[-2.7, 0], [2.7, 0], [2.7, 2.9], [1.5, 4.6], [0, 5.4], [-1.5, 4.6], [-2.7, 2.9]], 6, 0.05, { at: [0, 0.24, 0], rot: [0, 90, 0], bevelSteps: 2 }));
      slots.trim.push(
        extrude([[-3, 2.9], [-2.82, 2.9], [-1.5, 4.72], [0, 5.5], [1.5, 4.72], [2.82, 2.9], [3, 2.9], [1.65, 5.0], [0, 5.82], [-1.65, 5.0]], 6.5, 0.04, { at: [0, 0.24, 0], rot: [0, 90, 0], bevelSteps: 2 }),
      );
      const brace: ShapePiece[] = [
        roundedBox([2.4, 2.5, 0.06], 0.02, { at: [0, 1.5, 0.02], ...WOOD }),
        roundedBox([0.1, 2.5, 0.1], 0.02, { at: [0, 1.5, 0.05] }),
        ...sides((s) => [roundedBox([0.1, 2.5, 0.1], 0.02, { at: [s * 1.2, 1.5, 0.05] })]),
        roundedBox([2.5, 0.1, 0.1], 0.02, { at: [0, 2.75, 0.05] }),
        roundedBox([2.5, 0.1, 0.1], 0.02, { at: [0, 0.3, 0.05] }),
        ...sides((s) => [roundedBox([0.09, 2.9, 0.08], 0.02, { at: [s * 0.6, 1.52, 0.06], rot: [0, 0, s * 42] })]),
      ];
      slots.accent.push(...onWall(0, 3, brace.filter((piece) => !piece.color)));
      slots.base.push(...onWall(0, 3, brace.filter((piece) => piece.color)));
      slots.accent.push(...onWall(0, 3, [roundedBox([1.2, 1.2, 0.1], 0.03, { at: [0, 4.2, 0.04] })]));
      slots.base.push(...onWall(0, 3, [roundedBox([0.98, 0.98, 0.1], 0.03, { at: [0, 4.2, 0.08], ...WOOD })]));
      for (const a of [90, 270]) for (const z of [-1.5, 1.5]) windowOn(slots, a, 2.7, z, 1.8, 0.9, 0.9);
    },
  },
  praia: {
    name: "Casa de praia",
    build(slots) {
      slots.paint.push(walls(5, 2.6, 4.2, [0, 1.8, 0]));
      slots.trim.push(gable(5, 4.2, 1.5, 4.4, [0, 0], false), roundedBox([6, 0.14, 5.6], 0.04, { at: [0, 1.74, 0.5] }));
      slots.accent.push(
        ...[-2.8, -1.4, 0, 1.4, 2.8].map((x) => post(x, 1.8, 2.75, 3.2, 0.05)),
        roundedBox([5.7, 0.1, 0.1], 0.02, { at: [0, 2.78, 3.2] }),
        ...sides((s) => [post(s * 2.8, 1.8, 2.75, 1.9, 0.05), roundedBox([0.1, 0.1, 2.8], 0.02, { at: [s * 2.8, 2.78, 1.85] })]),
      );
      slots.base.push(
        ...[-2.7, 0, 2.7].flatMap((x) => [-1.9, 1.3, 3.1].map((z) => cylinder(0.14, 0.14, 1.72, 12, { at: [x, 0.86, z], ...WOOD }))),
        // Stairs down from the deck.
        ...Array.from({ length: 6 }, (_, i) => roundedBox([1.2, 0.08, 0.34], 0.02, { at: [3.6 + i * 0.3, 1.5 - i * 0.28, 2.3], ...WOOD })),
        ...sides((s) => [tube([[3.4, 1.8, 2.3 + s * 0.6], [5.1, 0.2, 2.3 + s * 0.6]], [0.04, 0.04], { radial: 8, steps: 1, ...WOOD })]),
      );
      slots.base.push(...onWall(0, 2.1, [roundedBox([1.1, 2.2, 0.08], 0.03, { at: [0, 2.9, 0.02], ...DOOR })]));
      slots.accent.push(...onWall(0, 2.1, [roundedBox([1.36, 0.12, 0.14], 0.03, { at: [0, 4.06, 0.03] })]));
      for (const x of [-1.7, 1.7]) windowOn(slots, 0, 2.1, x, 3.1, 1.1, 1.2, { shutters: true });
      for (const a of [90, 270]) windowOn(slots, a, 2.5, 0, 3.1, 1.3, 1.2);
    },
  },
  colonial: {
    name: "Casa colonial",
    build(slots) {
      slots.base.push(foundation(6.4, 4.4, 0.36), ...steps(0, 2.34, 0, 2.2));
      slots.paint.push(walls(6.4, 5, 4.4, [0, 0.36, 0]));
      slots.trim.push(gable(6.4, 4.4, 1.7, 5.4));
      slots.accent.push(
        eaves(6.4, 4.4, 5.42),
        roundedBox([6.56, 0.12, 4.56], 0.03, { at: [0, 2.82, 0] }),
        // Pediment over the door.
        ...sides((s) => [post(s * 0.84, 0.36, 3.1, 2.86, 0.1)]),
        extrude([[-1.2, 0], [1.2, 0], [0, 0.62]], 0.4, 0.02, { at: [0, 3.18, 2.76], rot: [0, 90, 0], bevelSteps: 1 }),
        roundedBox([2.4, 0.14, 0.86], 0.03, { at: [0, 3.14, 2.62] }),
      );
      doorOn(slots, 0, 2.2, 0, 1.15, 2.4, 0.36);
      for (const x of [-2.2, 2.2]) {
        windowOn(slots, 0, 2.2, x, 1.86, 1.05, 1.5, { shutters: true });
        windowOn(slots, 0, 2.2, x, 4.2, 1.05, 1.4, { shutters: true });
      }
      windowOn(slots, 0, 2.2, 0, 4.2, 1.05, 1.4, { shutters: true });
      for (const a of [90, 270]) for (const y of [1.86, 4.2]) windowOn(slots, a, 3.2, 0, y, 1.05, 1.4);
    },
  },
};

export const HOUSE_IDS = Object.keys(HOUSES);
export const HOUSE_NAMES: Record<string, string> = Object.fromEntries(Object.entries(HOUSES).map(([id, { name }]) => [id, name]));

/** Rounded corners are only worth their polygons on the big volumes of a building. */
function lighter(slots: Required<Slots>): void {
  for (const list of [slots.base, slots.paint, slots.trim, slots.accent]) {
    list.forEach((piece, index) => {
      if (piece.shape.kind === "roundedBox" && Math.min(...piece.shape.size) < 0.4) {
        list[index] = { ...piece, shape: { kind: "box", size: piece.shape.size } };
      }
    });
  }
}

function house(id: string, d: HouseDesign): BlockDef[] {
  const slots: Required<Slots> = { base: [], paint: [], trim: [], accent: [] };
  d.build(slots);
  lighter(slots);
  return family(`casa_${id}`, d.name, "building", slots, [socket("ground", [0, 0, 0], [0, -1, 0])], { upright: true }, { paint: HOUSE_WALLS[0], trim: HOUSE_ROOFS[0], accent: "#f4f4f4" });
}

// --- towers ---------------------------------------------------------------------------------

const W = BUILDING_WIDTH;
const HALF = W / 2;
const FH = FLOOR_HEIGHT;
const stack = (height: number) => [socket("bottom", [0, 0, 0], [0, -1, 0]), socket("top", [0, height, 0], [0, 1, 0])];

export const TOWER_WALLS = ["#d8c4a2", "#b98a68", "#8fa8c0", "#c8ccd4", "#a8c0b0", "#e0a890", "#6a7a94"];
export const TOWER_TRIMS = ["#f4f4f4", "#3a3f47", "#d4af37", "#1e7bff"];
export const TOWER_ACCENTS = ["#e8202a", "#ff6a00", "#18c46a", "#00c2c7", "#ffc400", "#ff3fa4"];

function allWalls(slots: Required<Slots>, slot: keyof Slots, build: () => ShapePiece[], depth = HALF): void {
  for (const angle of [0, 90, 180, 270]) (slots[slot] as ShapePiece[]).push(...onWall(angle, depth, build()));
}

function storey(slots: Required<Slots>): void {
  slots.paint.push(roundedBox([W, FH, W], 0.05, { at: [0, FH / 2, 0] }));
  slots.trim.push(roundedBox([W + 0.3, 0.24, W + 0.3], 0.05, { at: [0, FH - 0.12, 0] }));
  for (const [x, z] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    slots.trim.push(roundedBox([0.46, FH, 0.46], 0.04, { at: [x * (HALF - 0.08), FH / 2, z * (HALF - 0.08)] }));
  }
}

function pane(x: number, y: number, w: number, h: number): ShapePiece[] {
  return [roundedBox([w, h, 0.05], 0.02, { at: [x, y, 0.015], ...GLASS })];
}

interface Floor {
  id: string;
  name: string;
  build(slots: Required<Slots>): void;
}

const FLOORS: Floor[] = [
  {
    id: "janelas",
    name: "Andar com janelas",
    build(slots) {
      storey(slots);
      allWalls(slots, "base", () => [-2.25, 0, 2.25].flatMap((x) => [...pane(x - 0.42, 1.65, 0.74, 1.6), ...pane(x + 0.42, 1.65, 0.74, 1.6)]));
      allWalls(slots, "trim", () => [-1.13, 1.13].map((x) => roundedBox([0.3, FH - 0.2, 0.12], 0.03, { at: [x, (FH - 0.2) / 2, 0.03] })));
      allWalls(slots, "accent", () => [-2.25, 0, 2.25].map((x) => roundedBox([1.9, 0.09, 0.24], 0.03, { at: [x, 0.76, 0.08] })));
    },
  },
  {
    id: "altas",
    name: "Andar com janelas altas",
    build(slots) {
      storey(slots);
      allWalls(slots, "base", () => [-2.5, -1.25, 0, 1.25, 2.5].flatMap((x) => pane(x, 1.62, 0.8, 2.3)));
      allWalls(slots, "trim", () => [-2.5, -1.25, 0, 1.25, 2.5].map((x) => roundedBox([1, 0.1, 0.16], 0.03, { at: [x, 2.84, 0.04] })));
      allWalls(slots, "accent", () => [-2.5, -1.25, 0, 1.25, 2.5].map((x) => roundedBox([1, 0.08, 0.2], 0.02, { at: [x, 0.42, 0.06] })));
    },
  },
  {
    id: "fita",
    name: "Andar com faixa de vidro",
    build(slots) {
      storey(slots);
      allWalls(slots, "base", () => [
        roundedBox([W - 0.5, 1.5, 0.06], 0.03, { at: [0, 1.66, 0.02], ...GLASS }),
        ...[-2.4, -1.2, 0, 1.2, 2.4].map((x) => box([0.08, 1.5, 0.1], { at: [x, 1.66, 0.04], ...DARK_METAL })),
      ]);
      allWalls(slots, "accent", () => [roundedBox([W - 0.3, 0.12, 0.14], 0.03, { at: [0, 0.82, 0.06] })]);
    },
  },
  {
    id: "varanda",
    name: "Andar com varandas",
    build(slots) {
      storey(slots);
      allWalls(slots, "base", () => [-1.75, 1.75].flatMap((x) => [...pane(x, 1.65, 2.4, 2.2), box([0.06, 2.2, 0.1], { at: [x, 1.65, 0.04], ...DARK_METAL })]));
      allWalls(slots, "trim", () => [-1.75, 1.75].map((x) => roundedBox([3, 0.16, 0.96], 0.04, { at: [x, 0.5, 0.46] })));
      allWalls(slots, "accent", () =>
        [-1.75, 1.75].flatMap((x) => [
          roundedBox([3, 0.07, 0.07], 0.02, { at: [x, 1.42, 0.92] }),
          ...sides((s) => [roundedBox([0.06, 0.92, 0.06], 0.015, { at: [x + s * 1.46, 0.96, 0.92] })]),
          ...[-1, -0.5, 0, 0.5, 1].map((t) => box([0.03, 0.86, 0.03], { at: [x + t * 1.2, 0.98, 0.92] })),
        ]),
      );
    },
  },
  {
    id: "vidro",
    name: "Andar de vidro",
    build(slots) {
      slots.paint.push(roundedBox([W, 0.5, W], 0.05, { at: [0, 0.25, 0] }), roundedBox([W, 0.3, W], 0.05, { at: [0, FH - 0.15, 0] }));
      slots.base.push(roundedBox([W - 0.14, FH - 0.5, W - 0.14], 0.03, { at: [0, FH / 2 + 0.1, 0], ...GLASS }));
      allWalls(slots, "trim", () => [-2.6, -1.3, 0, 1.3, 2.6].map((x) => roundedBox([0.12, FH - 0.4, 0.14], 0.02, { at: [x, FH / 2 + 0.05, -0.02] })));
      allWalls(slots, "accent", () => [roundedBox([W, 0.08, 0.12], 0.02, { at: [0, 0.54, 0.0] })]);
    },
  },
  {
    id: "arcos",
    name: "Andar com arcos",
    build(slots) {
      storey(slots);
      allWalls(slots, "base", () => [-2.25, 0, 2.25].flatMap((x) => [...pane(x, 1.34, 1.2, 1.5), cylinder(0.6, 0.6, 0.05, 20, { at: [x, 2.09, 0.015], rot: [90, 0, 0], ...GLASS })]));
      allWalls(slots, "accent", () => [-2.25, 0, 2.25].map((x) => torus(0.68, 0.075, { at: [x, 2.09, 0.05], arc: Math.PI })));
      allWalls(slots, "trim", () => [-2.25, 0, 2.25].flatMap((x) => sides((s) => [roundedBox([0.14, 1.5, 0.12], 0.03, { at: [x + s * 0.68, 1.34, 0.05] })])));
    },
  },
];

interface Ground {
  id: string;
  name: string;
  build(slots: Required<Slots>): void;
}

function shopfront(slots: Required<Slots>, angle: number, stripes: boolean): void {
  slots.base.push(
    ...onWall(angle, HALF, [
      roundedBox([W - 1.1, 2.3, 0.06], 0.03, { at: [0, 1.4, 0.02], ...GLASS }),
      box([1.2, 2.3, 0.1], { at: [0, 1.4, 0.04], ...DOOR }),
      ...[-2.4, -1.2, 1.2, 2.4].map((x) => box([0.07, 2.3, 0.1], { at: [x, 1.4, 0.04], ...DARK_METAL })),
    ]),
  );
  // Awning: alternating slats in two colors.
  for (let i = 0; i < 7; i++) {
    const target = i % 2 && stripes ? slots.trim : slots.accent;
    target.push(...onWall(angle, HALF, [roundedBox([0.86, 0.08, 1.05], 0.02, { at: [(i - 3) * 0.86, 2.84, 0.5], rot: [18, 0, 0] })]));
  }
}

const GROUNDS: Ground[] = [
  {
    id: "loja",
    name: "Loja",
    build(slots) {
      slots.paint.push(roundedBox([W, FH, W], 0.05, { at: [0, FH / 2, 0] }));
      slots.trim.push(roundedBox([W + 0.36, 0.3, W + 0.36], 0.05, { at: [0, FH - 0.15, 0] }), roundedBox([W + 0.2, 0.4, W + 0.2], 0.05, { at: [0, 0.2, 0] }));
      for (const angle of [0, 90, 180, 270]) shopfront(slots, angle, true);
    },
  },
  {
    id: "cafe",
    name: "Café",
    build(slots) {
      slots.paint.push(roundedBox([W, FH, W], 0.05, { at: [0, FH / 2, 0] }));
      slots.trim.push(roundedBox([W + 0.36, 0.3, W + 0.36], 0.05, { at: [0, FH - 0.15, 0] }));
      for (const angle of [0, 90, 180, 270]) shopfront(slots, angle, true);
      slots.base.push(
        ...[-1.9, 1.9].flatMap((x) => [
          cylinder(0.42, 0.42, 0.05, 14, { at: [x, 0.82, HALF + 0.9], ...WOOD }),
          cylinder(0.04, 0.04, 0.8, 8, { at: [x, 0.4, HALF + 0.9], ...DARK_METAL }),
          ...sides((s) => [cylinder(0.2, 0.2, 0.05, 12, { at: [x + s * 0.65, 0.5, HALF + 0.9], ...WOOD }), cylinder(0.03, 0.03, 0.5, 6, { at: [x + s * 0.65, 0.25, HALF + 0.9], ...DARK_METAL })]),
        ]),
      );
    },
  },
  {
    id: "escritorio",
    name: "Portaria",
    build(slots) {
      slots.paint.push(roundedBox([W, FH, W], 0.05, { at: [0, FH / 2, 0] }));
      slots.trim.push(roundedBox([W + 0.36, 0.36, W + 0.36], 0.05, { at: [0, FH - 0.18, 0] }));
      allWalls(slots, "base", () => [
        roundedBox([W - 0.7, 2.5, 0.06], 0.03, { at: [0, 1.4, 0.02], ...GLASS }),
        ...[-2.6, -1.3, 1.3, 2.6].map((x) => box([0.09, 2.5, 0.1], { at: [x, 1.4, 0.04], ...CHROME })),
        ...sides((s) => [box([0.05, 2.5, 0.1], { at: [s * 0.6, 1.4, 0.05], ...CHROME })]),
      ]);
      slots.accent.push(...onWall(0, HALF, [roundedBox([3.2, 0.16, 1.7], 0.04, { at: [0, 2.72, 0.85] })]));
      slots.base.push(...onWall(0, HALF, sides((s) => [cylinder(0.05, 0.05, 2.7, 10, { at: [s * 1.45, 1.35, 1.55], ...CHROME })])));
    },
  },
  {
    id: "banco",
    name: "Colunata",
    build(slots) {
      slots.paint.push(roundedBox([W - 0.8, FH, W - 0.8], 0.05, { at: [0, FH / 2, 0] }));
      slots.trim.push(roundedBox([W + 0.3, 0.42, W + 0.3], 0.05, { at: [0, FH - 0.21, 0] }), roundedBox([W + 0.3, 0.36, W + 0.3], 0.05, { at: [0, 0.18, 0] }));
      allWalls(slots, "accent", () => [-2.6, -1.3, 0, 1.3, 2.6].map((x) => cylinder(0.2, 0.24, FH - 0.7, 16, { at: [x, FH / 2 - 0.03, 0.04] })));
      allWalls(slots, "base", () => [roundedBox([1.5, 2.3, 0.06], 0.02, { at: [0, 1.5, -0.38], ...GLASS })]);
    },
  },
];

interface Roof {
  id: string;
  name: string;
  height: number;
  build(slots: Required<Slots>): void;
}

function parapet(slots: Required<Slots>): void {
  slots.paint.push(roundedBox([W + 0.1, 0.16, W + 0.1], 0.04, { at: [0, 0.08, 0] }));
  allWalls(slots, "trim", () => [roundedBox([W + 0.3, 0.5, 0.26], 0.05, { at: [0, 0.35, -0.04] })]);
}

const acUnit = (x: number, z: number): ShapePiece[] => [
  roundedBox([1.1, 0.7, 0.9], 0.05, { at: [x, 0.5, z], ...STEEL }),
  cylinder(0.26, 0.26, 0.05, 14, { at: [x, 0.87, z], ...DARK_METAL }),
];

const ROOFS: Roof[] = [
  {
    id: "plano",
    name: "Telhado plano",
    height: 0.6,
    build(slots) {
      parapet(slots);
      slots.base.push(...acUnit(1.4, -1), ...acUnit(-1.5, 1.2), roundedBox([1.4, 1.1, 1.4], 0.05, { at: [-1.4, 0.7, -1.5], ...FOUNDATION }));
    },
  },
  {
    id: "caixa",
    name: "Telhado com caixa d'água",
    height: 3.4,
    build(slots) {
      parapet(slots);
      slots.base.push(
        ...acUnit(1.8, 1.8),
        ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => cylinder(0.07, 0.07, 1.2, 8, { at: [-1 + x * 0.72, 0.76, -0.8 + z * 0.72], ...DARK_METAL })),
        lathe([[0, 0], [1, 0], [1.05, 0.1], [1.05, 1.5], [0.32, 2.05], [0, 2.1]], { at: [-1, 1.34, -0.8], ...WOOD }, 16),
        ...[0.5, 1.2].map((y) => torus(1.07, 0.02, { at: [-1, 1.34 + y, -0.8], rot: [90, 0, 0], ...DARK_METAL })),
      );
    },
  },
  {
    id: "antena",
    name: "Telhado com antena",
    height: 6.3,
    build(slots) {
      parapet(slots);
      slots.base.push(
        ...acUnit(-1.7, 1.5),
        roundedBox([1.6, 0.6, 1.6], 0.05, { at: [0, 0.5, 0], ...FOUNDATION }),
        cylinder(0.07, 0.14, 5.5, 10, { at: [0, 3.4, 0], ...CHROME }),
        ...[3.8, 4.6, 5.3].map((y, i) => cylinder(0.022, 0.022, 1.6 - i * 0.34, 6, { at: [0, y, 0], rot: [0, 0, 90], ...CHROME })),
        sphere(0.13, { at: [0, 6.2, 0], color: "#ff3030", finish: "glow" }),
      );
    },
  },
  {
    id: "coroa",
    name: "Coroa iluminada",
    height: 2.1,
    build(slots) {
      slots.paint.push(roundedBox([W - 1.3, 1.8, W - 1.3], 0.05, { at: [0, 0.9, 0] }));
      slots.trim.push(roundedBox([W - 0.8, 0.22, W - 0.8], 0.05, { at: [0, 2.0, 0] }), roundedBox([W + 0.2, 0.22, W + 0.2], 0.05, { at: [0, 0.11, 0] }));
      slots.base.push(
        roundedBox([W - 1.1, 0.2, W - 1.1], 0.03, { at: [0, 1.5, 0], ...LIGHT }),
        ...[0.5, 0.74, 0.98].map((y) => roundedBox([W - 1.15, 0.05, W - 1.15], 0.015, { at: [0, y, 0], ...DARK_METAL })),
      );
    },
  },
  {
    id: "heliponto",
    name: "Heliponto",
    height: 1.2,
    build(slots) {
      slots.base.push(
        ...[-1.7, 1.7].flatMap((x) => [-1.7, 1.7].map((z) => cylinder(0.1, 0.1, 0.9, 8, { at: [x, 0.5, z], ...DARK_METAL }))),
        cylinder(2.6, 2.6, 0.14, 32, { at: [0, 1.0, 0], ...FOUNDATION }),
        torus(2.1, 0.06, { at: [0, 1.08, 0], rot: [90, 0, 0], ...WHITE }),
        ...[-0.55, 0.55].map((x) => box([0.26, 0.02, 1.8], { at: [x, 1.08, 0], ...WHITE })),
        box([0.9, 0.02, 0.26], { at: [0, 1.08, 0], ...WHITE }),
      );
      slots.paint.push(roundedBox([W + 0.1, 0.16, W + 0.1], 0.04, { at: [0, 0.08, 0] }));
      slots.trim.push(cylinder(2.68, 2.68, 0.06, 32, { at: [0, 0.93, 0] }));
    },
  },
  {
    id: "jardim",
    name: "Jardim no telhado",
    height: 1.9,
    build(slots) {
      parapet(slots);
      slots.base.push(
        roundedBox([W - 0.6, 0.22, W - 0.6], 0.04, { at: [0, 0.27, 0], color: "#4f9a4a" }),
        ...([[-2, -1.8, 0.82], [1.8, -1.6, 0.68], [-1.4, 1.9, 0.6], [2.2, 1.7, 0.86], [0.3, 0.2, 0.74]] as [number, number, number][]).flatMap(([x, z, r]) => [
          cylinder(0.09, 0.12, 0.7, 8, { at: [x, 0.7, z], ...WOOD }),
          sphere(r, { at: [x, 1.25, z], scale: [1, 0.86, 1], ...LEAF }),
        ]),
      );
    },
  },
];

export const TOWER_GROUNDS = GROUNDS.map(({ id }) => id);
export const TOWER_FLOORS = FLOORS.map(({ id }) => id);
export const TOWER_ROOFS = ROOFS.map(({ id }) => id);
export const TOWER_NAMES: Record<string, string> = Object.fromEntries([...GROUNDS, ...FLOORS, ...ROOFS].map(({ id, name }) => [id, name]));

function module_(prefix: string, id: string, name: string, height: number, build: (slots: Required<Slots>) => void): BlockDef[] {
  const slots: Required<Slots> = { base: [], paint: [], trim: [], accent: [] };
  build(slots);
  lighter(slots);
  // Hidden inside the walls: they keep this layer's stacking points on the layer itself.
  slots.base.push(box([1, 0.02, 1], { at: [0, 0.01, 0], ...DARK_METAL }), box([1, 0.02, 1], { at: [0, height - 0.01, 0], ...DARK_METAL }));
  return family(`torre_${prefix}_${id}`, name, "building", slots, stack(height), {}, { paint: TOWER_WALLS[0], trim: TOWER_TRIMS[0], accent: TOWER_ACCENTS[0] });
}

export const homeBlocks: BlockDef[] = [
  ...Object.entries(HOUSES).flatMap(([id, design]) => house(id, design)),
  ...GROUNDS.flatMap(({ id, name, build }) => module_("terreo", id, name, FH, build)),
  ...FLOORS.flatMap(({ id, name, build }) => module_("andar", id, name, FH, build)),
  ...ROOFS.flatMap(({ id, name, height, build }) => module_("topo", id, name, height, build)),
];
