import type { BlockDef, ShapePiece, Vec3 } from "../types.ts";
import { BUILDING_WIDTH, FLOOR_HEIGHT, HOUSE_HEIGHT, HOUSE_WIDTH } from "./city.ts";
import { block, box, compound, socket } from "./helpers.ts";
import { ROAD_TILE, SIDEWALK_HEIGHT } from "./roads.ts";

// Everything in the blocks style is made of boxes.

const WHITE = "#f4f1ea";
const DARK = "#1b1f2a";
const GOLD = "#d9b24a";
const GLASS = "#2a4258";
const SKIN = "#e0ac83";
const SHIRT = "#3f8cff";
const PANTS = "#2d3a55";
const HAIR = "#4a2f1d";

type Options = Omit<ShapePiece, "shape">;

const pair = (build: (side: 1 | -1) => ShapePiece[]) => [...build(1), ...build(-1)];

// --- person -------------------------------------------------------------------------------

/** One person unit: a grown adult is about 32 of them tall. */
const U = 0.055;

/** Size and center, in person units. */
const u = (size: Vec3, at: Vec3, options: Options = {}) =>
  box([size[0] * U, size[1] * U, size[2] * U], { at: [at[0] * U, at[1] * U, at[2] * U], ...options });

const p = (x: number, y: number, z: number): Vec3 => [x * U, y * U, z * U];

function body(id: string, name: string, color: string, pieces: ShapePiece[], sockets: BlockDef["sockets"]): BlockDef {
  return block(`vx.${id}`, name, "body", color, compound(pieces), sockets);
}

function hips(id: string, name: string, width: number, hipX: number): BlockDef {
  return body(
    id,
    name,
    PANTS,
    [u([width, 2, 4], [0, -1, 0]), u([width + 0.25, 0.7, 4.25], [0, -0.35, 0], { color: "#2a2018" }), u([1.2, 0.8, 0.3], [0, -0.35, 2.15], { color: GOLD, finish: "metal" })],
    [
      socket("waist", [0, 0, 0], [0, 1, 0]),
      socket("hip_left", p(hipX, -2, 0), [0, -1, 0]),
      socket("hip_right", p(-hipX, -2, 0), [0, -1, 0]),
      socket("belt", [0, 0, 0], [0, -1, 0]),
    ],
  );
}

interface Build {
  suffix: "" | "_f";
  shoulderX: number;
  /** Boxes of the bare torso. */
  base: () => ShapePiece[];
  front: number;
}

const MALE: Build = { suffix: "", shoulderX: 6, base: () => [u([8, 10, 4], [0, 5, 0])], front: 2 };
const FEMALE: Build = {
  suffix: "_f",
  shoulderX: 5.05,
  base: () => [u([6.3, 4.4, 3.6], [0, 2.2, 0]), u([7, 5.6, 4], [0, 7.2, 0]), u([5.4, 2, 0.8], [0, 6.9, 2.2])],
  front: 2.6,
};

const torsoSockets = (build: Build) => [
  socket("waist", [0, 0, 0], [0, -1, 0]),
  socket("neck", p(0, 10, 0), [0, 1, 0]),
  socket("shoulder_left", p(build.shoulderX, 10, 0), [0, -1, 0]),
  socket("shoulder_right", p(-build.shoulderX, 10, 0), [0, -1, 0]),
  socket("back", p(0, 5.5, -2), [0, 0, -1]),
  socket("chest", p(0, 6, build.front), [0, 0, 1]),
];

function torso(build: Build, id: string, name: string, color: string, details: ShapePiece[]): BlockDef {
  const label = build.suffix ? `${name} (fem.)` : name;
  // The yoke covers the top of each arm, so sleeve and shirt read as one piece of cloth.
  const yoke = pair((side) => [u([build.suffix ? 3.3 : 4.2, 0.5, 4.2], [side * build.shoulderX, 9.85, 0])]);
  return body(`torso${build.suffix}_${id}`, label, color, [...build.base(), ...yoke, ...details], torsoSockets(build));
}

const collarBand = () => u([3.6, 0.7, 4.2], [0, 9.7, 0], { shade: 0.75 });
const hemBand = (build: Build) => u([build.suffix ? 6.5 : 8.25, 0.8, build.suffix ? 3.85 : 4.25], [0, 0.4, 0], { shade: 0.8 });

function torsos(build: Build): BlockDef[] {
  const z = build.front + 0.1;
  const hem = hemBand(build);
  return [
    torso(build, "tshirt", "Camiseta", SHIRT, [collarBand(), hem]),
    torso(build, "hoodie", "Moletom", "#b0413e", [
      collarBand(),
      hem,
      u([6, 3.4, 2.4], [0, 10.4, -2], { shade: 0.85 }),
      u([4.4, 2.4, 0.4], [0, 2.2, 2.1], { shade: 0.78 }),
      ...pair((side) => [u([0.4, 2.4, 0.3], [side * 1, 8.2, z], { color: WHITE })]),
    ]),
    torso(build, "jacket", "Jaqueta", "#5b6b3a", [
      collarBand(),
      hem,
      u([2, 9.2, 0.3], [0, 4.8, z], { color: WHITE }),
      ...pair((side) => [u([0.7, 9.4, 0.4], [side * 1.4, 4.8, z + 0.1], { shade: 0.74 })]),
    ]),
    torso(build, "shirt", "Camisa social", "#e8e4d8", [
      hem,
      u([0.9, 8.8, 0.3], [0, 4.8, z], { shade: 0.86 }),
      ...[2, 4, 6, 8].map((y) => u([0.5, 0.5, 0.4], [0, y, z + 0.1], { color: "#8f8a7e" })),
      ...pair((side) => [u([1.6, 0.9, 0.4], [side * 0.9, 9.5, z], { shade: 0.9 })]),
    ]),
    torso(build, "suit", "Terno", "#2c3142", [
      hem,
      u([2.4, 5, 0.3], [0, 7.5, z], { color: WHITE }),
      u([0.8, 4.6, 0.4], [0, 7.3, z + 0.1], { color: "#b3262e" }),
      ...pair((side) => [u([0.9, 6, 0.4], [side * 1.5, 7, z + 0.1], { shade: 0.72 })]),
    ]),
    torso(build, "uniform", "Uniforme", "#23405f", [
      hem,
      u([0.9, 8.8, 0.3], [0, 4.8, z], { shade: 0.8 }),
      ...[2, 4, 6, 8].map((y) => u([0.5, 0.5, 0.4], [0, y, z + 0.1], { color: GOLD })),
      ...pair((side) => [u([1.7, 0.4, 2.6], [side * (build.shoulderX - 1.2), 10.15, 0], { color: GOLD, finish: "metal" })]),
      u([1, 1.2, 0.3], [-2.2, 6.6, z], { color: GOLD, finish: "metal" }),
    ]),
  ];
}

const HEAD_SOCKETS = [
  socket("neck", [0, 0, 0], [0, -1, 0]),
  socket("top", p(0, 8, 0), [0, 1, 0]),
  socket("eyes", p(0, 4.2, 4), [0, 0, 1]),
  socket("brows", p(0, 5.5, 4), [0, 0, 1]),
  socket("nose", p(0, 3.2, 4), [0, 0, 1]),
  socket("mouth", p(0, 2.1, 4), [0, 0, 1]),
  socket("chin", p(0, 2, 4), [0, 0, 1]),
  socket("ear_left", p(4, 3.8, 0), [1, 0, 0]),
  socket("ear_right", p(-4, 3.8, 0), [-1, 0, 0]),
];

function face(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`vx.${id}`, name, "face", color, compound(pieces), [socket("back", [0, 0, 0], [0, 0, -1])]);
}

const EYE_X = 1.75;
const round = (width: number, height: number) =>
  pair((side) => [
    u([width, height, 0.2], [side * EYE_X, 0, 0.1], { color: WHITE }),
    u([width * 0.62, height * 0.86, 0.3], [side * (EYE_X - width * 0.12), -0.05, 0.15]),
    u([width * 0.3, height * 0.44, 0.4], [side * (EYE_X - width * 0.12), -0.05, 0.2], { color: "#101218" }),
  ]);

function hair(id: string, name: string, pieces: ShapePiece[]): BlockDef {
  return block(`vx.${id}`, name, "hair", HAIR, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

function hat(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`vx.hat_${id}`, name, "hair", color, compound(pieces), [socket("base", [0, 0, 0], [0, -1, 0])]);
}

const hairTop = () => u([8.7, 1.5, 8.7], [0, 0.3, 0]);
const hairBack = (height: number) => u([8.7, height, 1], [0, 0.4 - height / 2, -3.85]);
const hairSides = (height: number, depth = 8.7, z = 0) =>
  pair((side) => [u([0.8, height, depth], [side * 4.05, 0.4 - height / 2, z])]);
const fringe = () => u([8.7, 1.1, 0.6], [0, -0.85, 4.05]);

const HAND_SOCKETS = [socket("wrist", [0, 0, 0], [0, 1, 0]), socket("grip", p(0, -1, 1.8), [0, 0, 1])];
const hand = (id: string, name: string, side: 1 | -1) =>
  body(id, name, SKIN, [u([3.6, 1.8, 3.6], [0, -0.9, 0]), u([1, 1.1, 1.3], [side * 2.2, -0.9, 0.2])], HAND_SOCKETS);

const SOLE = [socket("ankle", [0, 0, 0], [0, 1, 0]), socket("sole", p(0, -1.8, 0.8), [0, -1, 0])];

export const voxelPersonBlocks: BlockDef[] = [
  hips("hips", "Quadril", 8, 2),
  hips("hips_f", "Quadril (fem.)", 8.4, 2.1),
  ...torsos(MALE),
  ...torsos(FEMALE),
  torso(FEMALE, "dress", "Vestido", "#a0335a", [collarBand(), u([6.5, 0.9, 3.85], [0, 1.4, 0], { shade: 0.72 })]),

  body("neck", "Pescoço", SKIN, [u([3, 0.8, 3], [0, 0.3, 0])], [socket("base", [0, 0, 0], [0, -1, 0]), socket("head", p(0, 0.7, 0), [0, 1, 0])]),
  body("head_block", "Cabeça", SKIN, [u([8, 8, 8], [0, 4, 0])], HEAD_SOCKETS),

  body("upper_arm", "Braço", SKIN, [u([4, 6, 4], [0, -3, 0])], [socket("shoulder", [0, 0, 0], [0, 1, 0]), socket("elbow", p(0, -6, 0), [0, -1, 0])]),
  body("forearm", "Antebraço", SKIN, [u([3.8, 5, 3.8], [0, -2.5, 0])], [socket("elbow", [0, 0, 0], [0, 1, 0]), socket("wrist", p(0, -5, 0), [0, -1, 0])]),
  hand("hand", "Mão esquerda", 1),
  hand("hand_right", "Mão direita", -1),
  body("thigh", "Coxa", PANTS, [u([3.95, 6, 3.95], [0, -3, 0])], [socket("hip", [0, 0, 0], [0, 1, 0]), socket("knee", p(0, -6, 0), [0, -1, 0])]),
  body("calf", "Canela", PANTS, [u([3.9, 6, 3.9], [0, -3, 0])], [socket("knee", [0, 0, 0], [0, 1, 0]), socket("ankle", p(0, -6, 0), [0, -1, 0])]),

  body("shoe_sneaker", "Tênis", "#d6dde6", [u([4.3, 1.3, 6], [0, -0.65, 0.8]), u([4.5, 0.5, 6.2], [0, -1.55, 0.8], { color: WHITE })], SOLE),
  body("shoe_formal", "Sapato", "#2b2320", [u([4.2, 1.3, 6], [0, -0.65, 0.8], { finish: "gloss" }), u([4.4, 0.5, 6.2], [0, -1.55, 0.8], { color: "#14110f" })], SOLE),
  body("shoe_boot", "Bota", "#5a4632", [u([4.3, 1.4, 6], [0, -0.7, 0.8]), u([4.4, 3.4, 4.4], [0, 1.6, 0], { shade: 0.88 }), u([4.5, 0.5, 6.2], [0, -1.55, 0.8], { color: "#191614" })], SOLE),
  body("shoe_heel", "Salto", "#a0335a", [u([3.9, 1.1, 5.2], [0, -0.55, 1.1], { finish: "gloss" }), u([1.2, 1.6, 1.2], [0, -1, -1.2], { finish: "gloss" }), u([3.9, 0.5, 2.6], [0, -1.55, 2.6], { finish: "gloss" })], SOLE),

  body(
    "skirt",
    "Saia",
    "#a0335a",
    [u([8.7, 2, 4.5], [0, -0.8, 0], { shade: 0.74 }), u([9.4, 3.2, 5.2], [0, -3.2, 0]), u([10.2, 3.2, 6], [0, -6.4, 0])],
    [socket("waist", [0, 0, 0], [0, 1, 0])],
  ),

  face("eyes_round", "Olhos redondos", "#5a3a22", round(1.8, 1.8)),
  face("eyes_big", "Olhos grandes", "#5a3a22", round(2.3, 2.5)),
  face("eyes_lashes", "Olhos com cílios", "#5a3a22", [
    ...round(2, 2),
    ...pair((side) => [
      u([2.5, 0.4, 0.3], [side * EYE_X, 1.15, 0.15], { color: "#14110f" }),
      u([0.5, 0.5, 0.3], [side * (EYE_X + 1.3), 0.8, 0.15], { color: "#14110f" }),
    ]),
  ]),
  face("eyes_dot", "Olhos de ponto", "#5a3a22", pair((side) => [u([1, 1.5, 0.3], [side * EYE_X, 0, 0.15], { color: "#101218" })])),

  face("brows_straight", "Sobrancelhas retas", HAIR, pair((side) => [u([2.5, 0.55, 0.3], [side * EYE_X, 0, 0.15])])),
  face("brows_arched", "Sobrancelhas arqueadas", HAIR, pair((side) => [u([1.6, 0.35, 0.3], [side * (EYE_X - 0.4), 0.2, 0.15]), u([1.1, 0.35, 0.3], [side * (EYE_X + 0.75), -0.1, 0.15])])),
  face("brows_angry", "Sobrancelhas bravas", HAIR, pair((side) => [u([1.5, 0.6, 0.3], [side * (EYE_X - 0.6), -0.35, 0.15]), u([1.3, 0.6, 0.3], [side * (EYE_X + 0.6), 0.2, 0.15])])),

  face("nose_small", "Nariz pequeno", SKIN, [u([1.2, 0.9, 0.6], [0, 0, 0.3], { shade: 0.86 })]),
  face("nose_long", "Nariz fino", SKIN, [u([1, 1.6, 0.8], [0, 0.2, 0.4], { shade: 0.86 })]),
  face("nose_wide", "Nariz largo", SKIN, [u([2, 1, 0.7], [0, 0, 0.35], { shade: 0.86 })]),

  face("mouth_smile", "Sorriso", "#a0524d", [u([2.6, 0.5, 0.25], [0, 0, 0.12]), ...pair((side) => [u([0.6, 0.5, 0.25], [side * 1.6, 0.45, 0.12])])]),
  face("mouth_flat", "Boca reta", "#a0524d", [u([2.8, 0.5, 0.25], [0, 0, 0.12])]),
  face("mouth_full", "Lábios cheios", "#b5484f", [u([3, 0.6, 0.25], [0, 0.25, 0.12]), u([2.3, 0.7, 0.25], [0, -0.35, 0.12])]),
  face("mouth_grin", "Sorriso largo", "#a0524d", [u([3, 0.8, 0.2], [0, 0.1, 0.1], { color: WHITE }), u([3, 0.4, 0.3], [0, -0.5, 0.15]), ...pair((side) => [u([0.5, 0.9, 0.3], [side * 1.75, 0.15, 0.15])])]),

  block("vx.ear", "Orelha", "face", SKIN, compound(u([0.6, 2, 1.4], [-0.3, 0, 0])), [socket("base", [0, 0, 0], [1, 0, 0])]),

  face("beard_full", "Barba cheia", HAIR, [
    u([8.3, 1.8, 0.5], [0, -1.1, -0.05]),
    u([3.6, 0.7, 0.5], [0, 1.05, -0.05]),
    ...pair((side) => [u([1.5, 1.4, 0.5], [side * 3.4, 0.5, -0.05]), u([0.5, 3, 4], [side * 4.15, -0.2, -2.2])]),
  ]),
  face("beard_goatee", "Cavanhaque", HAIR, [u([2.6, 1.8, 0.4], [0, -0.4, 0])]),
  face("beard_mustache", "Bigode", HAIR, [u([4, 0.7, 0.4], [0, 1.1, 0.05])]),

  face("glasses_round", "Óculos redondos", DARK, [
    ...pair((side) => [
      u([2.8, 2.6, 0.2], [side * EYE_X, 0, 0.3], { color: "#b8a26a" }),
      u([2.2, 2, 0.3], [side * EYE_X, 0, 0.35], { color: "#a8c4d6", finish: "glass" }),
      u([0.3, 0.3, 8], [side * 4.05, 0.3, -3.9], { color: "#b8a26a" }),
    ]),
  ]),
  face("glasses_sun", "Óculos escuros", DARK, [
    ...pair((side) => [
      u([3, 2, 0.4], [side * EYE_X, 0, 0.35], { color: "#10141c", finish: "glass" }),
      u([0.3, 0.3, 8], [side * 4.05, 0.3, -3.9], { color: DARK }),
    ]),
    u([1, 0.4, 0.4], [0, 0.4, 0.35], { color: DARK }),
  ]),

  hair("short", "Cabelo curto", [hairTop(), hairBack(4), ...hairSides(2.8), fringe()]),
  hair("side", "Topete", [hairTop(), hairBack(4), ...hairSides(2.8), fringe(), u([5, 1.3, 1.2], [-1.8, -1.7, 4.1])]),
  hair("bob", "Chanel", [hairTop(), hairBack(8), ...hairSides(7.2), fringe()]),
  hair("long", "Cabelo longo", [hairTop(), hairBack(15), ...hairSides(13, 6, -1.4), ...pair((side) => [u([0.8, 7, 2.7], [side * 4.05, -3.1, 2.7])]), fringe()]),
  hair("ponytail", "Rabo de cavalo", [
    hairTop(),
    hairBack(4),
    ...hairSides(2.8),
    fringe(),
    u([2.6, 1, 2.6], [0, -2, -4.8], { color: "#c23b3b" }),
    u([2.4, 5, 2.4], [0, -5, -4.9]),
    u([1.6, 3, 1.6], [0, -9, -4.7]),
  ]),
  hair("bun", "Coque", [hairTop(), hairBack(4), ...hairSides(2.8), fringe(), u([3.4, 2.6, 3.4], [0, 1.1, -5.1]), u([3.7, 0.6, 3.7], [0, -0.3, -5.1], { color: "#c23b3b" })]),
  hair("afro", "Black power", [u([12, 5, 12.4], [0, 1.1, -0.9]), u([13, 3, 11], [0, 2, -1.2]), ...pair((side) => [u([2, 6, 8.5], [side * 5, -4, -1.2])]), u([12, 7, 2.5], [0, -4.5, -5.3])]),
  hair("curly", "Cacheado", [
    hairTop(),
    hairBack(4.4),
    ...hairSides(3.4),
    ...[
      [-3, 1.2, 3], [0, 1.6, 3.4], [3, 1.2, 3], [-3.4, 1.6, 0], [0, 2, 0], [3.4, 1.6, 0], [-3, 1.2, -3.2], [0, 1.6, -3.4], [3, 1.2, -3.2],
      [-4.6, -2.2, 1.6], [4.6, -2.2, 1.6], [-4.6, -2.8, -2.2], [4.6, -2.8, -2.2], [-1.8, -3.6, -4.8], [1.8, -3.6, -4.8],
    ].map(([x, y, z]) => u([2.4, 2.2, 2.4], [x, y, z])),
  ]),
  hair("spiky", "Espetado", [
    hairTop(),
    hairBack(3.4),
    ...hairSides(2.4),
    ...[
      [-3, 3], [0, 3.4], [3, 3], [-3, 0], [0, 0], [3, 0], [-3, -3], [0, -3.2], [3, -3],
    ].flatMap(([x, z], index) => [u([2.1, 1.6, 2.1], [x, 1.6, z]), u([1.1, 1.3 + (index % 2) * 0.6, 1.1], [x, 3 + (index % 2) * 0.3, z])]),
  ]),
  hair("mohawk", "Moicano", [u([1.9, 2.4, 9.4], [0, 1, -0.2]), u([1.4, 1.6, 9], [0, 2.8, -0.2]), u([1.9, 4, 1.2], [0, -2, -4.5])]),
  hair("under_short", "Cabelo sob chapéu", [hairBack(4), ...hairSides(2.8)]),
  hair("under_long", "Cabelo longo sob chapéu", [hairBack(14), ...hairSides(12, 6, -1.4)]),

  hat("cap", "Boné", "#c23b3b", [u([8.9, 2.8, 8.9], [0, 0.9, 0]), u([8.9, 0.6, 4.2], [0, -0.3, 6.1], { shade: 0.8 })]),
  hat("beanie", "Touca", "#3a7d6b", [u([8.9, 3.4, 8.9], [0, 1.4, 0]), u([9.3, 1.5, 9.3], [0, -1, 0], { shade: 0.8 })]),
  hat("top", "Cartola", "#22242c", [u([7, 6.4, 7], [0, 3.6, 0], { finish: "gloss" }), u([11.4, 0.7, 11.4], [0, 0.2, 0], { finish: "gloss" }), u([7.3, 1, 7.3], [0, 1.2, 0], { color: "#8f2a2e" })]),
  hat("cowboy", "Chapéu de caubói", "#8a5a30", [u([7.6, 3.2, 8.4], [0, 2, 0]), u([14, 0.7, 13.4], [0, 0.2, 0]), u([7.9, 0.9, 8.7], [0, 0.9, 0], { color: "#3a2a1e" })]),

  block(
    "vx.backpack",
    "Mochila",
    "hair",
    "#c9772b",
    compound(
      u([6.8, 8.4, 2.8], [0, -0.6, -1.4]),
      u([5, 3.4, 0.8], [0, -2.4, -3.2], { shade: 0.8 }),
      ...pair((side) => [u([0.9, 7, 0.4], [side * 2.2, 0.2, 4.2], { shade: 0.65 }), u([0.9, 0.5, 4.6], [side * 2.2, 3.5, 2])]),
    ),
    [socket("back", [0, 0, 0], [0, 0, 1])],
  ),
];

// --- buildings ----------------------------------------------------------------------------

const HALF = BUILDING_WIDTH / 2;

const stack = (height: number) => [socket("bottom", [0, 0, 0], [0, -1, 0]), socket("top", [0, height, 0], [0, 1, 0])];

/** Repeats details on all four walls. `build` describes the front wall, at z = `depth`. */
function aroundWalls(depth: number, build: (z: number) => ShapePiece[]): ShapePiece[] {
  return [0, 90, 180, 270].flatMap((angle) => {
    const radians = (angle * Math.PI) / 180;
    return build(depth).map((piece) => {
      const [x, y, z] = piece.at ?? [0, 0, 0];
      return {
        ...piece,
        at: [x * Math.cos(radians) + z * Math.sin(radians), y, -x * Math.sin(radians) + z * Math.cos(radians)] as Vec3,
        rot: [0, angle, 0] as Vec3,
      };
    });
  });
}

const windowAt = (x: number, y: number, z: number, w: number, h: number): ShapePiece[] => [
  box([w + 0.2, h + 0.2, 0.08], { at: [x, y, z], color: WHITE }),
  box([w, h, 0.12], { at: [x, y, z + 0.01], color: GLASS, finish: "glass" }),
  box([0.08, h, 0.16], { at: [x, y, z + 0.01], color: WHITE }),
  box([w + 0.36, 0.14, 0.26], { at: [x, y - h / 2 - 0.16, z + 0.06], color: WHITE }),
];

const floorY = FLOOR_HEIGHT / 2;

function floor(id: string, name: string, color: string, windows: (z: number) => ShapePiece[]): BlockDef {
  return block(
    `vx.${id}`,
    name,
    "building",
    color,
    compound(
      box([BUILDING_WIDTH, FLOOR_HEIGHT, BUILDING_WIDTH], { at: [0, floorY, 0] }),
      box([BUILDING_WIDTH + 0.16, 0.24, BUILDING_WIDTH + 0.16], { at: [0, FLOOR_HEIGHT - 0.12, 0], shade: 0.82 }),
      ...aroundWalls(HALF, windows),
    ),
    stack(FLOOR_HEIGHT),
  );
}

function groundFloor(id: string, name: string, color: string, awning: string, details: ShapePiece[]): BlockDef {
  return block(
    `vx.${id}`,
    name,
    "building",
    color,
    compound(
      box([BUILDING_WIDTH, FLOOR_HEIGHT, BUILDING_WIDTH], { at: [0, floorY, 0] }),
      box([BUILDING_WIDTH + 0.2, 0.3, BUILDING_WIDTH + 0.2], { at: [0, FLOOR_HEIGHT - 0.15, 0], shade: 0.8 }),
      box([5.6, 1.9, 0.1], { at: [0, 1.15, HALF], color: DARK }),
      box([5.3, 1.7, 0.14], { at: [0, 1.15, HALF + 0.02], color: "#7fb4d4", finish: "glass" }),
      box([1.1, 2.1, 0.2], { at: [0, 1.05, HALF + 0.03], color: DARK }),
      ...[-1, 0, 1, 2, -2, 3, -3].map((step) =>
        box([0.82, 0.16, 1], { at: [step * 0.82, 2.5, HALF + 0.48], color: step % 2 === 0 ? awning : WHITE }),
      ),
      ...details,
    ),
    stack(FLOOR_HEIGHT),
  );
}

const roofBase = (): ShapePiece[] => [
  box([BUILDING_WIDTH + 0.2, 0.2, BUILDING_WIDTH + 0.2], { at: [0, 0.1, 0], shade: 0.7 }),
  ...[1, -1].flatMap((side) => [
    box([BUILDING_WIDTH + 0.2, 0.4, 0.3], { at: [0, 0.4, side * (HALF - 0.05)] }),
    box([0.3, 0.4, BUILDING_WIDTH + 0.2], { at: [side * (HALF - 0.05), 0.4, 0] }),
  ]),
];

function roof(id: string, name: string, color: string, height: number, details: ShapePiece[]): BlockDef {
  return block(`vx.${id}`, name, "building", color, compound(...roofBase(), details), stack(height));
}

export const voxelBuildingBlocks: BlockDef[] = [
  groundFloor("ground_shop", "Loja", "#c9b89a", "#c23b3b", []),
  groundFloor("ground_cafe", "Café", "#b8876a", "#3a7d6b", [box([1.1, 0.5, 0.5], { at: [2.4, 0.25, HALF + 1], color: "#7a5230" })]),
  groundFloor("ground_office", "Escritório", "#8d98a6", "#3f8cff", []),
  floor("floor_windows", "Andar com janelas", "#b8876a", (z) => [-2.2, 0, 2.2].flatMap((x) => windowAt(x, 1.7, z, 1.2, 1.5))),
  floor("floor_narrow", "Andar com janelas altas", "#c9b89a", (z) => [-2.6, -1.3, 0, 1.3, 2.6].flatMap((x) => windowAt(x, 1.65, z, 0.7, 1.9))),
  floor("floor_ribbon", "Andar com faixa de vidro", "#d6d8dc", (z) => [
    box([BUILDING_WIDTH - 0.3, 1.5, 0.08], { at: [0, 1.7, z], color: DARK }),
    box([BUILDING_WIDTH - 0.5, 1.3, 0.12], { at: [0, 1.7, z + 0.01], color: GLASS, finish: "glass" }),
    ...[-2.4, -1.2, 0, 1.2, 2.4].map((x) => box([0.1, 1.3, 0.16], { at: [x, 1.7, z + 0.01], color: DARK })),
  ]),
  roof("roof_flat", "Telhado plano", "#8d98a6", 0.6, [box([1.2, 0.5, 1.4], { at: [1.2, 0.45, -1], color: "#a7aeb8" }), box([0.8, 0.3, 0.8], { at: [-1.5, 0.35, 1.3], color: "#7d8591" })]),
  roof("roof_tank", "Telhado com caixa d'água", "#8d98a6", 2.75, [
    box([1.6, 1.3, 1.6], { at: [0.8, 1.9, -0.8], color: "#7a5230" }),
    box([1.8, 0.2, 1.8], { at: [0.8, 2.65, -0.8], color: "#5e3c22" }),
    ...[[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, z]) => box([0.16, 1.2, 0.16], { at: [0.8 + x * 0.6, 0.8, -0.8 + z * 0.6], color: DARK })),
  ]),
  roof("roof_antenna", "Telhado com antena", "#8d98a6", 6, [
    box([0.3, 5.6, 0.3], { at: [0, 3, 0], color: "#c8ccd4" }),
    box([1.4, 0.12, 0.12], { at: [0, 4.4, 0], color: "#c8ccd4" }),
    box([1, 0.12, 0.12], { at: [0, 5, 0], color: "#c8ccd4" }),
    box([0.3, 0.3, 0.3], { at: [0, 5.85, 0], color: "#e02f3a", finish: "glow" }),
  ]),
  (() => {
    const halfHouse = HOUSE_WIDTH / 2;
    return block(
      "vx.house_body",
      "Casa",
      "building",
      "#e8d6b0",
      compound(
        box([HOUSE_WIDTH, HOUSE_HEIGHT, HOUSE_WIDTH], { at: [0, HOUSE_HEIGHT / 2, 0] }),
        box([HOUSE_WIDTH + 0.14, 0.34, HOUSE_WIDTH + 0.14], { at: [0, 0.17, 0], color: "#8b8f97" }),
        box([1.1, 2.1, 0.12], { at: [0, 1.05 + 0.1, halfHouse + 0.02], color: "#7a5230" }),
        box([0.14, 0.14, 0.1], { at: [0.34, 1.15, halfHouse + 0.09], color: GOLD, finish: "metal" }),
        box([1.5, 0.14, 0.7], { at: [0, 2.35, halfHouse + 0.32], color: "#6d4c41" }),
        ...windowAt(-1.9, 1.75, halfHouse, 1, 1),
        ...windowAt(1.9, 1.75, halfHouse, 1, 1),
        ...[1, -1].flatMap((side) =>
          [-1.4, 1.4].flatMap((z) =>
            windowAt(0, 1.75, 0, 1, 1).map((piece) => ({
              ...piece,
              at: [side * (halfHouse + (piece.at![2])), piece.at![1], z + piece.at![0]] as Vec3,
              rot: [0, side * 90, 0] as Vec3,
            })),
          ),
        ),
      ),
      stack(HOUSE_HEIGHT),
    );
  })(),
  block(
    "vx.house_roof",
    "Telhado de casa",
    "building",
    "#a64b35",
    compound(
      ...[0, 1, 2, 3, 4].map((step) =>
        box([HOUSE_WIDTH + 0.7, 0.5, HOUSE_WIDTH + 0.7 - step * 1.45], { at: [0, 0.25 + step * 0.5, 0] }),
      ),
      box([0.7, 1.9, 0.7], { at: [1.6, 1.6, 1.3], color: "#8d5b4a" }),
      box([0.86, 0.2, 0.86], { at: [1.6, 2.6, 1.3], color: "#6d4c41" }),
    ),
    stack(2.5),
  ),
];

// --- nature -------------------------------------------------------------------------------

const TRUNK = "#6e4a2c";

function tree(id: string, name: string, color: string, pieces: ShapePiece[]): BlockDef {
  return block(`vx.${id}`, name, "nature", color, compound(pieces), [socket("ground", [0, 0, 0], [0, -1, 0])], { upright: true });
}

const cubeAt = (size: number, x: number, y: number, z: number, options: Options = {}) => box([size, size, size], { at: [x, y, z], ...options });

export const voxelNatureBlocks: BlockDef[] = [
  tree("oak", "Carvalho", "#3fae5a", [
    box([0.55, 2.4, 0.55], { at: [0, 1.2, 0], color: TRUNK }),
    box([3.2, 1.6, 3.2], { at: [0, 3, 0] }),
    box([2.4, 1, 2.4], { at: [0, 4.3, 0], shade: 1.05 }),
    box([1.4, 0.7, 1.4], { at: [0.3, 5.1, -0.2], shade: 0.92 }),
    cubeAt(1, 1.7, 2.7, 0.7, { shade: 0.88 }),
    cubeAt(1, -1.6, 3, -0.8, { shade: 0.9 }),
    cubeAt(0.9, -0.6, 2.8, 1.7, { shade: 0.85 }),
  ]),
  tree("birch", "Bétula", "#7fb04a", [
    box([0.36, 3.6, 0.36], { at: [0, 1.8, 0], color: "#e8e4d8" }),
    ...[0.6, 1.3, 2.2, 3].map((y, index) => box([0.38, 0.14, 0.38], { at: [0, y, 0], color: index % 2 ? "#23252c" : "#3a3d44" })),
    box([2.2, 1.5, 2.2], { at: [0, 3.9, 0] }),
    box([1.5, 1.1, 1.5], { at: [0, 5.1, 0], shade: 1.05 }),
    cubeAt(0.8, 1.2, 3.5, 0.5, { shade: 0.86 }),
  ]),
  tree("pine", "Pinheiro", "#2f7a4e", [
    box([0.45, 1.2, 0.45], { at: [0, 0.6, 0], color: TRUNK }),
    ...[0, 1, 2, 3, 4].map((step) => box([3.2 - step * 0.6, 0.8, 3.2 - step * 0.6], { at: [0, 1.5 + step * 0.8, 0], shade: 1 - (step % 2) * 0.12 })),
  ]),
  tree("pine_slim", "Pinheiro fino", "#2f7a4e", [
    box([0.3, 1.2, 0.3], { at: [0, 0.6, 0], color: TRUNK }),
    ...[0, 1, 2, 3, 4, 5, 6].map((step) => box([1.7 - step * 0.2, 0.7, 1.7 - step * 0.2], { at: [0, 1.4 + step * 0.7, 0], shade: 1 - (step % 2) * 0.12 })),
  ]),
  tree("palm", "Palmeira", "#4c9e55", [
    ...[0, 1, 2, 3, 4, 5, 6].map((step) => box([0.42, 0.72, 0.42], { at: [step * 0.08, 0.36 + step * 0.72, 0], color: step % 2 ? "#8a6a42" : "#7a5a36" })),
    ...[[1, 0], [-1, 0], [0, 1], [0, -1]].flatMap(([x, z]) => [
      box([x ? 1.5 : 0.5, 0.18, z ? 1.5 : 0.5], { at: [0.5 + x * 0.75, 5.3, z * 0.75] }),
      box([x ? 1.3 : 0.44, 0.18, z ? 1.3 : 0.44], { at: [0.5 + x * 1.85, 4.98, z * 1.85], shade: 0.9 }),
    ]),
    box([0.7, 0.4, 0.7], { at: [0.5, 5.4, 0], shade: 0.82 }),
  ]),
  tree("dead_tree", "Árvore seca", "#6e4a2c", [
    box([0.5, 2.8, 0.5], { at: [0, 1.4, 0] }),
    box([1.2, 0.3, 0.3], { at: [0.65, 2.2, 0] }),
    box([0.3, 0.9, 0.3], { at: [1.15, 2.7, 0] }),
    box([0.3, 0.3, 1], { at: [0, 2.7, 0.5] }),
    box([0.26, 0.8, 0.26], { at: [0, 3.2, 0.9] }),
    box([1, 0.26, 0.26], { at: [-0.55, 3, 0] }),
    box([0.26, 0.7, 0.26], { at: [-0.95, 3.4, 0] }),
  ]),
];

// --- roads ---------------------------------------------------------------------------------

interface Surface {
  top: number;
  color: string;
}

/** Paints a square tile cell by cell and joins equal cells into as few boxes as it can. */
function tilePieces(size: number, cell: number, at: (x: number, z: number) => Surface): ShapePiece[] {
  const count = Math.round(size / cell);
  const start = -size / 2;
  const open = new Map<string, { x0: number; x1: number; z0: number; z1: number; surface: Surface }>();
  const done: { x0: number; x1: number; z0: number; z1: number; surface: Surface }[] = [];

  for (let row = 0; row < count; row++) {
    const z = start + (row + 0.5) * cell;
    const runs: { x0: number; x1: number; surface: Surface }[] = [];
    for (let column = 0; column < count; column++) {
      const surface = at(start + (column + 0.5) * cell, z);
      const last = runs[runs.length - 1];
      if (last && last.surface === surface) last.x1 = column + 1;
      else runs.push({ x0: column, x1: column + 1, surface });
    }
    const next = new Map<string, { x0: number; x1: number; z0: number; z1: number; surface: Surface }>();
    for (const run of runs) {
      const key = `${run.x0}:${run.x1}:${run.surface.color}:${run.surface.top}`;
      const growing = open.get(key);
      if (growing) {
        growing.z1 = row + 1;
        next.set(key, growing);
        open.delete(key);
      } else next.set(key, { x0: run.x0, x1: run.x1, z0: row, z1: row + 1, surface: run.surface });
    }
    done.push(...open.values());
    open.clear();
    for (const [key, value] of next) open.set(key, value);
  }
  done.push(...open.values());

  const lowest = Math.min(...done.map(({ surface }) => surface.top));
  return [
    // Boxes side by side can leave pinholes where their edges meet; this hides what is below.
    box([size, lowest * 0.6, size], { at: [0, lowest * 0.3, 0], color: at(start + cell / 2, 0).color }),
    ...done.map(({ x0, x1, z0, z1, surface }) =>
      box([(x1 - x0) * cell, surface.top, (z1 - z0) * cell], {
        at: [start + ((x0 + x1) / 2) * cell, surface.top / 2, start + ((z0 + z1) / 2) * cell],
        color: surface.color,
      }),
    ),
  ];
}

const ground = (top: number) => [socket("bottom", [0, 0, 0], [0, -1, 0]), socket("top", [0, top, 0], [0, 1, 0])];

const ROAD_HALF = ROAD_TILE / 2;
const LANE = ROAD_HALF - 1;
const ROAD: Surface = { top: 0.04, color: "#3a3d44" };
const LINE: Surface = { top: 0.05, color: "#f0efe6" };
const WALK: Surface = { top: SIDEWALK_HEIGHT, color: "#aeb3ba" };
const GRASS: Surface = { top: 0.1, color: "#4f9a4a" };

function roadTile(id: string, name: string, at: (x: number, z: number) => Surface): BlockDef {
  return block(`vx.road_${id}`, name, "road", ROAD.color, compound(tilePieces(ROAD_TILE, 0.25, at)), ground(ROAD.top), {
    ground: true,
    snap: ROAD_TILE,
  });
}

const dashedZ = (x: number, z: number) => Math.abs(x) < 0.125 && Math.abs(((z + 8) % 2) - 1) > 0.5;
const dashedX = (x: number, z: number) => Math.abs(z) < 0.125 && Math.abs(((x + 8) % 2) - 1) > 0.5;

function prop(id: string, name: string, category: string, color: string, pieces: ShapePiece[], top = 1): BlockDef {
  return block(`vx.${id}`, name, category, color, compound(pieces), [socket("bottom", [0, 0, 0], [0, -1, 0]), socket("top", [0, top, 0], [0, 1, 0])], { upright: true });
}

export const voxelRoadBlocks: BlockDef[] = [
  roadTile("straight", "Rua reta", (x, z) => (Math.abs(x) > LANE ? WALK : dashedZ(x, z) ? LINE : ROAD)),
  roadTile("crosswalk", "Faixa de pedestres", (x, z) => {
    if (Math.abs(x) > LANE) return WALK;
    if (Math.abs(z) < 1.2 && Math.abs(((x + 8) % 1) - 0.5) > 0.25) return LINE;
    return ROAD;
  }),
  roadTile("curve", "Curva", (x, z) => {
    const distance = Math.hypot(x - ROAD_HALF, z - ROAD_HALF);
    if (distance < 1 || distance > 7) return WALK;
    if (distance > 3.87 && distance < 4.13 && Math.floor(Math.atan2(z - ROAD_HALF, x - ROAD_HALF) * 7) % 2 === 0) return LINE;
    return ROAD;
  }),
  roadTile("t", "Cruzamento em T", (x, z) => {
    if (Math.abs(x) <= LANE) return ROAD;
    return x > 0 && Math.abs(z) <= LANE ? (dashedX(x, z) && x > LANE + 0.5 ? LINE : ROAD) : WALK;
  }),
  roadTile("cross", "Cruzamento", (x, z) => (Math.abs(x) <= LANE || Math.abs(z) <= LANE ? ROAD : WALK)),
  block("vx.sidewalk", "Calçada", "road", WALK.color, compound(box([ROAD_TILE, SIDEWALK_HEIGHT, ROAD_TILE], { at: [0, SIDEWALK_HEIGHT / 2, 0] })), ground(SIDEWALK_HEIGHT), { ground: true, snap: ROAD_TILE }),
  block("vx.grass", "Grama", "road", GRASS.color, compound(box([ROAD_TILE, GRASS.top, ROAD_TILE], { at: [0, GRASS.top / 2, 0] })), ground(GRASS.top), { ground: true, snap: ROAD_TILE }),

  prop("lamp", "Poste", "city", "#6d7480", [
    box([0.3, 0.3, 0.3], { at: [0, 0.15, 0] }),
    box([0.16, 4.6, 0.16], { at: [0, 2.6, 0] }),
    box([1.3, 0.14, 0.2], { at: [0.6, 4.85, 0] }),
    box([0.5, 0.12, 0.28], { at: [1.05, 4.72, 0], color: "#fff2b8", finish: "glow" }),
  ], 4.92),
  prop("bench", "Banco", "city", "#7a5230", [
    box([1.6, 0.1, 0.5], { at: [0, 0.5, 0] }),
    box([1.6, 0.4, 0.08], { at: [0, 0.8, -0.22] }),
    ...[1, -1].map((side) => box([0.12, 0.5, 0.42], { at: [side * 0.68, 0.25, 0], color: DARK })),
  ], 1),
];

const voxelGroundProps: BlockDef[] = [
  prop("rock", "Pedra", "nature", "#8b8f96", [box([0.8, 0.4, 0.7], { at: [0, 0.2, 0] }), box([0.45, 0.25, 0.4], { at: [0.08, 0.52, -0.05], shade: 0.9 })], 0.65),
  prop("boulder", "Rochedo", "nature", "#7b7f86", [box([2.2, 1.2, 1.9], { at: [0, 0.6, 0] }), box([1.4, 0.8, 1.2], { at: [-0.2, 1.6, 0.1], shade: 0.9 }), box([0.8, 0.5, 0.7], { at: [0.9, 0.25, 1.2], shade: 0.8 })], 2),
  prop("bush", "Arbusto", "nature", "#3f8a46", [box([1, 0.7, 1], { at: [0, 0.35, 0] }), box([0.6, 0.4, 0.6], { at: [0.05, 0.9, -0.05], shade: 0.88 })], 1.1),
  prop("flower_red", "Flor", "nature", "#3f8a46", [box([0.08, 0.5, 0.08], { at: [0, 0.25, 0] }), box([0.3, 0.2, 0.3], { at: [0, 0.6, 0], color: "#d9303e" }), box([0.12, 0.12, 0.12], { at: [0, 0.74, 0], color: "#f2c230" })], 0.8),
  prop("tuft", "Tufo de grama", "nature", "#5aa14a", [box([0.1, 0.42, 0.1], { at: [0, 0.21, 0] }), box([0.1, 0.32, 0.1], { at: [0.18, 0.16, 0.05] }), box([0.1, 0.26, 0.1], { at: [-0.16, 0.13, -0.08] })], 0.45),
  prop("cactus", "Cacto", "nature", "#4f8a4a", [box([0.34, 1.9, 0.34], { at: [0, 0.95, 0] }), box([0.5, 0.24, 0.24], { at: [0.36, 0.8, 0] }), box([0.24, 0.6, 0.24], { at: [0.5, 1.2, 0] }), box([0.46, 0.22, 0.22], { at: [-0.34, 1.1, 0] }), box([0.22, 0.46, 0.22], { at: [-0.46, 1.4, 0] })], 1.95),
];

export const voxelBlocks: BlockDef[] = [
  ...voxelGroundProps,
  ...voxelPersonBlocks,
  ...voxelBuildingBlocks,
  ...voxelNatureBlocks,
  ...voxelRoadBlocks,
];
