import type { ArtStyle, BlockDef, ShapePiece, SocketDef, Vec3 } from "../types.ts";
import { block, box, boxSockets, capsule, compound, cylinder, lathe, roundedBox, socket, sphere, torus } from "./helpers.ts";

// Rooms: walls, floors, doors and windows on a 1 m grid, in every style, plus the furniture the
// downloaded packs don't have. Arcade furniture is all drawn here: chunky toys with glossy paint.

export const INTERIOR_CATEGORY = "interior";
/** Floor to ceiling. */
export const ROOM_HEIGHT = 2.8;
/** Floor tiles are this thick; furniture stands on top of them. */
export const FLOOR_TOP = 0.04;
/** Every wall piece is one module long. */
export const WALL_MODULE = 1;

export const DOOR_WIDTH = 0.84;
export const DOOR_HEIGHT = 2.1;

type Options = Omit<ShapePiece, "shape">;
type Shell = "realistic" | "lowpoly" | "blocks" | "arcade";

export const SHELL_PREFIX: Record<ArtStyle, string> = { realistic: "rz", lowpoly: "lp", blocks: "vx", arcade: "ar" };

interface ShellLook {
  thickness: number;
  wall: string;
  board: Options;
  boardHeight: number;
  frame: Options;
  glass: Options;
  door: string;
  handle: Options;
  /** A wall slab: always a plain box, so pieces of one wall meet without seams. */
  slab(size: Vec3, at: Vec3, options?: Options): ShapePiece;
  /** Trim, frames and small parts, rounded where the style is. */
  trim(size: Vec3, at: Vec3, options?: Options): ShapePiece;
  /** Thin bars and panels: plain boxes in every style, since rounding them costs triangles nobody sees. */
  bar(size: Vec3, at: Vec3, options?: Options): ShapePiece;
}

const rounded = (radius: number, finish?: Options["finish"]) => (size: Vec3, at: Vec3, options: Options = {}) =>
  roundedBox(size, Math.min(radius, Math.min(...size) / 2.2), { at, ...(finish && !options.finish ? { finish } : {}), ...options });
const plain = (faceted: boolean) => (size: Vec3, at: Vec3, options: Options = {}) => box(size, { at, ...(faceted ? { faceted } : {}), ...options });

const LOOKS: Record<Shell, ShellLook> = {
  realistic: {
    thickness: 0.15,
    wall: "#ece6dc",
    board: { color: "#f6f4ef" },
    boardHeight: 0.1,
    frame: { color: "#f3f1eb" },
    glass: { color: "#9fc3d6", finish: "tint" },
    door: "#9a6b43",
    handle: { color: "#c9ccd2", finish: "metal" },
    slab: plain(false),
    // A 6 mm bevel can't be seen at room scale and costs ten times the triangles.
    trim: plain(false),
    bar: plain(false),
  },
  lowpoly: {
    thickness: 0.15,
    wall: "#eadfcc",
    board: { color: "#a8774f" },
    boardHeight: 0.1,
    frame: { color: "#b98552" },
    glass: { color: "#8fd0e8", finish: "glass" },
    door: "#c08a55",
    handle: { color: "#5a5f69" },
    slab: plain(true),
    trim: plain(true),
    bar: plain(true),
  },
  blocks: {
    thickness: 0.165,
    wall: "#e6dccb",
    board: { color: "#8a6142" },
    boardHeight: 0.11,
    frame: { color: "#9a6b47" },
    glass: { color: "#a6dcf0", finish: "glass" },
    door: "#b07a4c",
    handle: { color: "#3b3f47" },
    slab: plain(false),
    trim: plain(false),
    bar: plain(false),
  },
  arcade: {
    thickness: 0.2,
    wall: "#ffe3b0",
    board: { color: "#2f7de1", finish: "gloss" },
    boardHeight: 0.14,
    frame: { color: "#ffffff", finish: "gloss" },
    glass: { color: "#5fc8ff", finish: "glass" },
    door: "#ff5a3c",
    handle: { color: "#ffd23a", finish: "gloss" },
    slab: plain(false),
    trim: rounded(0.035, "gloss"),
    bar: (size, at, options = {}) => box(size, { at, finish: "gloss", ...options }),
  },
};

/** How thick each style builds its walls. */
export const SHELL_THICKNESS: Record<ArtStyle, number> = {
  realistic: LOOKS.realistic.thickness,
  lowpoly: LOOKS.lowpoly.thickness,
  blocks: LOOKS.blocks.thickness,
  arcade: LOOKS.arcade.thickness,
};

const HALF = WALL_MODULE / 2;
const H = ROOM_HEIGHT;
/**
 * Wall pieces reach this far past their module on each side, so neighbors overlap a little: two
 * boxes that only touch leave a hairline gap that shows the sky through the wall.
 */
const OVERLAP = 0.0015;
const END = HALF + OVERLAP;

/** Wall slabs around a rectangular hole [x0, x1] x [y0, y1]. */
function slabsAround(look: ShellLook, x0: number, x1: number, y0: number, y1: number): ShapePiece[] {
  const t = look.thickness;
  const pieces: ShapePiece[] = [];
  if (x0 > -HALF) pieces.push(look.slab([x0 + END, H, t], [(x0 - END) / 2, H / 2, 0]));
  if (x1 < HALF) pieces.push(look.slab([END - x1, H, t], [(x1 + END) / 2, H / 2, 0]));
  if (y0 > 0) pieces.push(look.slab([x1 - x0, y0, t], [(x0 + x1) / 2, y0 / 2, 0]));
  if (y1 < H) pieces.push(look.slab([x1 - x0, H - y1, t], [(x0 + x1) / 2, (y1 + H) / 2, 0]));
  return pieces;
}

/** Baseboards on both faces, skipping the [gap0, gap1] range of a doorway. */
function boards(look: ShellLook, gap?: [number, number]): ShapePiece[] {
  const t = look.thickness;
  const depth = 0.014;
  const ranges: [number, number][] = gap ? [[-END, gap[0]], [gap[1], END]] : [[-END, END]];
  return ranges
    .filter(([a, b]) => b - a > 0.01)
    .flatMap(([a, b]) =>
      [1, -1].map((side) =>
        look.trim([b - a, look.boardHeight, depth], [(a + b) / 2, look.boardHeight / 2, side * (t / 2 + depth / 2)], look.board),
      ),
    );
}

/** A frame around an opening, on both faces: two sides and a top, and a bottom when `sill`. */
function casing(look: ShellLook, x0: number, x1: number, y0: number, y1: number, width: number, sill: boolean): ShapePiece[] {
  const t = look.thickness;
  const depth = 0.016;
  const pieces: ShapePiece[] = [];
  for (const side of [1, -1]) {
    const z = side * (t / 2 + depth / 2);
    pieces.push(
      look.trim([width, y1 - y0 + (sill ? width * 2 : width), depth], [x0 - width / 2, (y0 + y1) / 2 + (sill ? 0 : width / 2), z], look.frame),
      look.trim([width, y1 - y0 + (sill ? width * 2 : width), depth], [x1 + width / 2, (y0 + y1) / 2 + (sill ? 0 : width / 2), z], look.frame),
      look.trim([x1 - x0 + width * 2, width, depth], [(x0 + x1) / 2, y1 + width / 2, z], look.frame),
    );
  }
  // The lining inside the opening hides the cut through the wall.
  pieces.push(
    look.bar([0.02, y1 - y0, t + 0.004], [x0 + 0.01, (y0 + y1) / 2, 0], look.frame),
    look.bar([0.02, y1 - y0, t + 0.004], [x1 - 0.01, (y0 + y1) / 2, 0], look.frame),
    look.bar([x1 - x0, 0.02, t + 0.004], [(x0 + x1) / 2, y1 - 0.01, 0], look.frame),
  );
  if (sill) {
    pieces.push(look.trim([x1 - x0 + 0.1, 0.035, t + 0.09], [(x0 + x1) / 2, y0 - 0.0175, 0], look.frame));
  }
  return pieces;
}

/** A window pane with its frame and a mullion, centered in the wall's thickness. */
function pane(look: ShellLook, x0: number, x1: number, y0: number, y1: number, bars: number): ShapePiece[] {
  const bar = 0.045;
  const depth = 0.06;
  const pieces: ShapePiece[] = [look.bar([x1 - x0 - 0.02, y1 - y0 - 0.02, 0.012], [(x0 + x1) / 2, (y0 + y1) / 2, 0], look.glass)];
  pieces.push(
    look.bar([x1 - x0, bar, depth], [(x0 + x1) / 2, y0 + bar / 2, 0], look.frame),
    look.bar([x1 - x0, bar, depth], [(x0 + x1) / 2, y1 - bar / 2, 0], look.frame),
    look.bar([bar, y1 - y0, depth], [x0 + bar / 2, (y0 + y1) / 2, 0], look.frame),
    look.bar([bar, y1 - y0, depth], [x1 - bar / 2, (y0 + y1) / 2, 0], look.frame),
  );
  for (let i = 1; i < bars; i++) {
    pieces.push(look.bar([bar * 0.8, y1 - y0, depth * 0.9], [x0 + ((x1 - x0) * i) / bars, (y0 + y1) / 2, 0], look.frame));
  }
  return pieces;
}

/** Sockets at the ends of a wall piece, so pieces snap one after the other. */
function wallSockets(look: ShellLook): SocketDef[] {
  const t = look.thickness;
  return [
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", [0, H, 0], [0, 1, 0]),
    socket("left", [-HALF, H / 2, 0], [-1, 0, 0]),
    socket("right", [HALF, H / 2, 0], [1, 0, 0]),
    socket("front", [0, H / 2, t / 2], [0, 0, 1]),
    socket("back", [0, H / 2, -t / 2], [0, 0, -1]),
  ];
}

export type FloorKind = "wood" | "tile" | "carpet" | "concrete" | "checker";

export const FLOOR_KINDS: Record<FloorKind, { name: string; color: string }> = {
  wood: { name: "Piso de madeira", color: "#b5834f" },
  tile: { name: "Piso de cerâmica", color: "#ddd8cf" },
  carpet: { name: "Carpete", color: "#7d8b99" },
  concrete: { name: "Piso de cimento", color: "#a9a8a2" },
  checker: { name: "Piso xadrez", color: "#2d2f36" },
};

function floorPieces(look: ShellLook, kind: FloorKind, shell: Shell): ShapePiece[] {
  const top = FLOOR_TOP;
  // Plain boxes even in Arcade: a floor is made of hundreds of tiles, and rounded edges cost triangles.
  const flat = (size: Vec3, at: Vec3, options: Options = {}) =>
    look.slab(size, at, shell === "arcade" && !options.finish ? { finish: "gloss", ...options } : options);
  switch (kind) {
    case "wood": {
      // Planks of slightly different shades over a darker bed that shows in the joints.
      const pieces: ShapePiece[] = [look.slab([END * 2, top - 0.006, END * 2], [0, (top - 0.006) / 2, 0], { shade: 0.62 })];
      const shades = [1, 0.92, 0.97, 0.88, 0.95];
      const plank = 1 / shades.length;
      shades.forEach((shade, i) => {
        const x = -HALF + plank * (i + 0.5);
        const cut = [0.3, 0.7, 0.45, 0.15, 0.6][i];
        for (const [a, b] of [[-HALF, -HALF + cut], [-HALF + cut, HALF]]) {
          pieces.push(flat([plank - 0.006, 0.008, b - a - 0.006], [x, top - 0.004, (a + b) / 2], { shade: (a < -0.4 ? shade : shade * 0.96) }));
        }
      });
      return pieces;
    }
    case "tile":
    case "checker": {
      const pieces: ShapePiece[] = [look.slab([END * 2, top - 0.005, END * 2], [0, (top - 0.005) / 2, 0], { color: kind === "tile" ? "#b9b4ab" : "#d9d6cf" })];
      const n = 2;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) {
          const light = kind === "checker" && (i + j) % 2 === 1;
          pieces.push(
            flat([1 / n - 0.008, 0.008, 1 / n - 0.008], [-HALF + (i + 0.5) / n, top - 0.004, -HALF + (j + 0.5) / n], light ? { color: "#f1eee7" } : {}),
          );
        }
      }
      return pieces;
    }
    case "carpet":
      return [flat([END * 2, top, END * 2], [0, top / 2, 0])];
    case "concrete":
      return [flat([END * 2, top, END * 2], [0, top / 2, 0]), flat([0.004, 0.002, 1], [HALF - 0.002, top, 0], { shade: 0.8 })];
  }
}

const SHELL_NAMES: Record<Shell, string> = { realistic: "realista", lowpoly: "low poly", blocks: "blocos", arcade: "arcade" };

function shellBlocks(shell: Shell): BlockDef[] {
  const look = LOOKS[shell];
  const p = SHELL_PREFIX[shell];
  const t = look.thickness;
  const make = (id: string, name: string, color: string, pieces: ShapePiece[], sockets: SocketDef[], extra: Pick<BlockDef, "upright" | "snap"> = {}) =>
    block(`${p}.int_${id}`, name, INTERIOR_CATEGORY, color, compound(pieces), sockets, extra);

  const doorX = DOOR_WIDTH / 2;
  const window = { x: 0.4, y0: 0.95, y1: 2.15 };
  const high = { x: 0.3, y0: 1.75, y1: 2.2 };
  const shop = { y0: 0.12, y1: 2.5 };
  const leafWidth = DOOR_WIDTH - 0.05;
  const leafHeight = DOOR_HEIGHT - 0.025;

  const metalBar: Options = shell === "lowpoly" || shell === "blocks" ? { color: "#3a3f47" } : { color: "#3a3f47", finish: "metal" };

  const doorLeaf = (glass: boolean): ShapePiece[] => {
    const thick = shell === "arcade" ? 0.06 : 0.04;
    const pieces: ShapePiece[] = glass
      ? [
          look.trim([leafWidth, leafHeight, thick], [0, leafHeight / 2 + 0.005, 0], metalBar),
          look.trim([leafWidth - 0.14, leafHeight - 0.24, thick + 0.004], [0, leafHeight / 2 + 0.03, 0], look.glass),
        ]
      : [look.trim([leafWidth, leafHeight, thick], [0, leafHeight / 2 + 0.005, 0], shell === "arcade" ? { finish: "gloss" } : {})];
    if (!glass && shell !== "lowpoly" && shell !== "blocks") {
      // Two raised panels on each face.
      for (const side of [1, -1]) {
        for (const [y, h] of [[1.45, 0.95], [0.5, 0.7]] as const) {
          pieces.push(look.bar([leafWidth - 0.2, h, 0.01], [0, y, side * (thick / 2 + 0.004)], { shade: 0.9 }));
        }
      }
    }
    for (const side of [1, -1]) {
      const z = side * (thick / 2 + 0.03);
      if (shell === "realistic" || shell === "arcade") {
        pieces.push(
          look.trim([0.12, 0.022, 0.022], [leafWidth / 2 - 0.12, 1.02, z], look.handle),
          look.trim([0.04, 0.02, 0.05], [leafWidth / 2 - 0.07, 1.02, z - side * 0.015], look.handle),
        );
      } else {
        pieces.push(look.trim([0.08, 0.04, 0.04], [leafWidth / 2 - 0.1, 1.02, z - side * 0.01], look.handle));
      }
    }
    return pieces;
  };

  const blocks: BlockDef[] = [
    make("wall", `Parede (${SHELL_NAMES[shell]})`, look.wall, [look.slab([END * 2, H, t], [0, H / 2, 0]), ...boards(look)], wallSockets(look), { snap: WALL_MODULE }),
    make(
      "wall_door",
      `Parede com vão de porta (${SHELL_NAMES[shell]})`,
      look.wall,
      [...slabsAround(look, -doorX, doorX, 0, DOOR_HEIGHT), ...boards(look, [-doorX - 0.07, doorX + 0.07]), ...casing(look, -doorX, doorX, 0, DOOR_HEIGHT, 0.07, false)],
      wallSockets(look),
      { snap: WALL_MODULE },
    ),
    make(
      "wall_window",
      `Parede com janela (${SHELL_NAMES[shell]})`,
      look.wall,
      [...slabsAround(look, -window.x, window.x, window.y0, window.y1), ...boards(look), ...casing(look, -window.x, window.x, window.y0, window.y1, 0.06, true), ...pane(look, -window.x, window.x, window.y0, window.y1, 2)],
      wallSockets(look),
      { snap: WALL_MODULE },
    ),
    make(
      "wall_window_high",
      `Parede com basculante (${SHELL_NAMES[shell]})`,
      look.wall,
      [...slabsAround(look, -high.x, high.x, high.y0, high.y1), ...boards(look), ...casing(look, -high.x, high.x, high.y0, high.y1, 0.05, true), ...pane(look, -high.x, high.x, high.y0, high.y1, 1)],
      wallSockets(look),
      { snap: WALL_MODULE },
    ),
    make(
      "wall_glass",
      `Vitrine (${SHELL_NAMES[shell]})`,
      look.wall,
      [
        look.slab([END * 2, shop.y0, t], [0, shop.y0 / 2, 0]),
        look.slab([END * 2, H - shop.y1, t], [0, (shop.y1 + H) / 2, 0]),
        look.bar([1 - 0.02, shop.y1 - shop.y0, 0.014], [0, (shop.y0 + shop.y1) / 2, 0], look.glass),
        ...[-HALF + 0.02, HALF - 0.02].map((x) => look.bar([0.04, shop.y1 - shop.y0, 0.08], [x, (shop.y0 + shop.y1) / 2, 0], metalBar)),
        look.bar([1, 0.05, 0.08], [0, shop.y1 - 0.025, 0], metalBar),
        look.bar([1, 0.05, 0.08], [0, shop.y0 + 0.025, 0], metalBar),
      ],
      wallSockets(look),
      { snap: WALL_MODULE },
    ),
    make(
      "post",
      `Pilar de canto (${SHELL_NAMES[shell]})`,
      look.wall,
      [
        look.slab([t + 0.004, H, t + 0.004], [0, H / 2, 0]),
        look.trim([t + 0.032, look.boardHeight, t + 0.032], [0, look.boardHeight / 2, 0], look.board),
      ],
      boxSockets([t, H, t], [0, H / 2, 0]),
    ),
    make("door", `Porta (${SHELL_NAMES[shell]})`, look.door, doorLeaf(false), boxSockets([leafWidth, leafHeight, 0.04], [0, leafHeight / 2, 0]), { upright: true }),
    make("door_glass", `Porta de vidro (${SHELL_NAMES[shell]})`, "#3a3f47", doorLeaf(true), boxSockets([leafWidth, leafHeight, 0.04], [0, leafHeight / 2, 0]), { upright: true }),
    make(
      "ceiling",
      `Forro (${SHELL_NAMES[shell]})`,
      "#f7f6f2",
      [look.slab([END * 2, FLOOR_TOP, END * 2], [0, FLOOR_TOP / 2, 0])],
      boxSockets([1, FLOOR_TOP, 1], [0, FLOOR_TOP / 2, 0]),
      { snap: WALL_MODULE },
    ),
  ];
  for (const [kind, { name, color }] of Object.entries(FLOOR_KINDS) as [FloorKind, { name: string; color: string }][]) {
    blocks.push(make(`floor_${kind}`, `${name} (${SHELL_NAMES[shell]})`, color, floorPieces(look, kind, shell), boxSockets([1, FLOOR_TOP, 1], [0, FLOOR_TOP / 2, 0]), { upright: true, snap: WALL_MODULE }));
  }
  return blocks;
}

// --- furniture -----------------------------------------------------------------------------

/** Sockets for a piece standing on the floor, from its size; `wall` pieces hang by their back. */
function furnitureSockets([w, h, d]: Vec3, mount: "floor" | "wall" | "ceiling" = "floor"): SocketDef[] {
  const sockets = boxSockets([w, h, d], [0, h / 2, 0]);
  const first = mount === "wall" ? "back" : mount === "ceiling" ? "top" : "bottom";
  return [sockets.find(({ id }) => id === first)!, ...sockets.filter(({ id }) => id !== first)];
}

interface Furniture {
  id: string;
  name: string;
  color: string;
  size: Vec3;
  mount?: "floor" | "wall" | "ceiling";
  pieces: ShapePiece[];
}

const furnitureBlock = (prefix: string, item: Furniture): BlockDef =>
  block(`${prefix}.mob_${item.id}`, item.name, INTERIOR_CATEGORY, item.color, compound(item.pieces), furnitureSockets(item.size, item.mount), item.mount && item.mount !== "floor" ? {} : { upright: true });

// Arcade: thick rounded shapes, glossy paint that follows the part color, a bright fixed palette.
const G: Options = { finish: "gloss" };
const A_WHITE: Options = { color: "#fbf8f1", finish: "gloss" };
const A_WOOD: Options = { color: "#d99a55", finish: "gloss" };
const A_DARK: Options = { color: "#2c303a", finish: "gloss" };
const A_CHROME: Options = { color: "#e3e7ee", finish: "metal" };
const A_SCREEN: Options = { color: "#1b2433", finish: "glass" };
const A_GLOW: Options = { color: "#fff1b8", finish: "glow" };
const A_LEAF: Options = { color: "#38c172", finish: "gloss" };
const A_WATER: Options = { color: "#7fd8ff", finish: "glass" };

/** A rounded box resting at height `y` (its bottom), centered on x and z. */
const rb = (w: number, h: number, d: number, x: number, y: number, z: number, options: Options = G, radius = 0.05) =>
  roundedBox([w, h, d], Math.min(radius, Math.min(w, h, d) / 2.2), { at: [x, y + h / 2, z], ...options });
const foot = (x: number, z: number, h: number, options: Options = A_DARK, r = 0.05) => cylinder(r * 0.8, r, h, 16, { at: [x, h / 2, z], ...options });
const knob = (x: number, y: number, z: number, options: Options = A_CHROME, r = 0.028) => sphere(r, { at: [x, y, z], ...options });
const corners = (w: number, d: number, inset: number) =>
  [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([sx, sz]) => [sx * (w / 2 - inset), sz * (d / 2 - inset)] as const);

/** Where the pillows of a bed go: two side by side on a double bed, one in the middle otherwise. */
const pillows = (w: number) => (w > 1.2 ? [-w / 4, w / 4] : [0]);

function arcadeBed(id: string, name: string, w: number): Furniture {
  const d = 2.15;
  return {
    id,
    name,
    color: "#ff6b6b",
    size: [w + 0.1, 1.05, d],
    pieces: [
      ...corners(w, d, 0.1).map(([x, z]) => foot(x, z, 0.12, A_WOOD, 0.06)),
      rb(w, 0.24, d, 0, 0.1, 0, A_WOOD, 0.07),
      rb(w + 0.1, 0.95, 0.14, 0, 0.1, -d / 2 + 0.07, G, 0.07),
      rb(w + 0.1, 0.5, 0.12, 0, 0.1, d / 2 - 0.06, G, 0.06),
      rb(w - 0.08, 0.2, d - 0.3, 0, 0.32, 0.02, A_WHITE, 0.08),
      rb(w - 0.02, 0.1, d * 0.58, 0, 0.47, 0.32, { color: "#7cc6ff", finish: "gloss" }, 0.05),
      ...pillows(w).map((x) => rb(w > 1.2 ? w / 2 - 0.14 : w - 0.3, 0.13, 0.34, x, 0.5, -d / 2 + 0.38, A_WHITE, 0.06)),
    ],
  };
}

function arcadeSofa(id: string, name: string, w: number): Furniture {
  const d = 0.92;
  const seats = w > 1.2 ? 2 : 1;
  return {
    id,
    name,
    color: "#3d8bfd",
    size: [w, 0.88, d],
    pieces: [
      ...corners(w, d, 0.12).map(([x, z]) => foot(x, z, 0.1, A_WOOD, 0.045)),
      rb(w, 0.32, d, 0, 0.08, 0, G, 0.08),
      rb(w, 0.5, 0.26, 0, 0.36, -d / 2 + 0.13, G, 0.1),
      ...[-1, 1].map((s) => rb(0.24, 0.32, d, s * (w / 2 - 0.12), 0.36, 0, G, 0.1)),
      ...Array.from({ length: seats }, (_, i) => rb((w - 0.5) / seats - 0.02, 0.16, d - 0.3, -((w - 0.5) / 2) + ((w - 0.5) / seats) * (i + 0.5), 0.38, 0.12, { shade: 0.93, finish: "gloss" }, 0.07)),
    ],
  };
}

const ARCADE_FURNITURE: Furniture[] = [
  arcadeBed("bed_double", "Cama de casal", 1.6),
  arcadeBed("bed_single", "Cama de solteiro", 1.0),
  {
    id: "nightstand",
    name: "Criado-mudo",
    color: "#ffb347",
    size: [0.5, 0.56, 0.44],
    pieces: [
      ...corners(0.5, 0.44, 0.07).map(([x, z]) => foot(x, z, 0.08, A_DARK, 0.035)),
      rb(0.5, 0.48, 0.44, 0, 0.08, 0, G, 0.06),
      rb(0.4, 0.16, 0.04, 0, 0.32, 0.22, A_WHITE, 0.02),
      knob(0, 0.4, 0.26),
    ],
  },
  {
    id: "wardrobe",
    name: "Guarda-roupa",
    color: "#a66cff",
    size: [1.2, 2.0, 0.6],
    pieces: [
      rb(1.2, 0.1, 0.56, 0, 0, 0, A_DARK, 0.03),
      rb(1.2, 1.9, 0.6, 0, 0.1, 0, G, 0.07),
      ...[-1, 1].map((s) => rb(0.56, 1.72, 0.05, s * 0.29, 0.18, 0.3, A_WHITE, 0.03)),
      ...[-1, 1].map((s) => capsule(0.025, 0.3, { at: [s * 0.06, 1.05, 0.35], ...A_CHROME })),
    ],
  },
  {
    id: "dresser",
    name: "Cômoda",
    color: "#ff8fab",
    size: [1.1, 0.9, 0.5],
    pieces: [
      ...corners(1.1, 0.5, 0.08).map(([x, z]) => foot(x, z, 0.1, A_DARK, 0.04)),
      rb(1.1, 0.8, 0.5, 0, 0.1, 0, G, 0.07),
      ...[0.18, 0.42, 0.66].map((y) => rb(0.96, 0.2, 0.04, 0, y, 0.25, A_WHITE, 0.025)),
      ...[0.28, 0.52, 0.76].flatMap((y) => [knob(-0.25, y, 0.29), knob(0.25, y, 0.29)]),
    ],
  },
  arcadeSofa("sofa", "Sofá", 2.0),
  arcadeSofa("armchair", "Poltrona", 0.95),
  {
    id: "coffee_table",
    name: "Mesa de centro",
    color: "#ffd23a",
    size: [1.1, 0.42, 0.62],
    pieces: [...corners(1.1, 0.62, 0.1).map(([x, z]) => foot(x, z, 0.34, A_WOOD, 0.05)), rb(1.1, 0.09, 0.62, 0, 0.33, 0, G, 0.045)],
  },
  {
    id: "tv_stand",
    name: "Rack de TV",
    color: "#2f7de1",
    size: [1.6, 0.5, 0.45],
    pieces: [
      ...corners(1.6, 0.45, 0.1).map(([x, z]) => foot(x, z, 0.08, A_DARK, 0.035)),
      rb(1.6, 0.42, 0.45, 0, 0.08, 0, G, 0.06),
      ...[-1, 1].map((s) => rb(0.5, 0.32, 0.04, s * 0.52, 0.13, 0.22, A_WHITE, 0.025)),
      rb(0.48, 0.3, 0.05, 0, 0.14, 0.2, A_DARK, 0.02),
    ],
  },
  {
    id: "tv",
    name: "TV",
    color: "#2c303a",
    size: [1.2, 0.8, 0.26],
    pieces: [
      rb(0.4, 0.04, 0.24, 0, 0, 0, A_DARK, 0.02),
      rb(0.08, 0.12, 0.06, 0, 0.04, -0.02, A_DARK, 0.02),
      rb(1.2, 0.68, 0.08, 0, 0.12, -0.02, G, 0.04),
      rb(1.08, 0.57, 0.02, 0, 0.175, 0.025, A_SCREEN, 0.01),
    ],
  },
  {
    id: "rug",
    name: "Tapete",
    color: "#ff7a59",
    size: [2.0, 0.025, 1.4],
    pieces: [rb(2.0, 0.015, 1.4, 0, 0, 0, { finish: "matte" }, 0.02), rb(1.6, 0.01, 1.0, 0, 0.012, 0, { color: "#ffd23a" }, 0.02), rb(1.3, 0.01, 0.7, 0, 0.015, 0, {}, 0.02)],
  },
  {
    id: "floor_lamp",
    name: "Luminária de chão",
    color: "#ff5a3c",
    size: [0.44, 1.65, 0.44],
    pieces: [
      cylinder(0.18, 0.2, 0.06, 24, { at: [0, 0.03, 0], ...G }),
      cylinder(0.025, 0.025, 1.25, 12, { at: [0, 0.68, 0], ...A_CHROME }),
      cylinder(0.14, 0.22, 0.32, 24, { at: [0, 1.48, 0], ...A_WHITE }),
      sphere(0.08, { at: [0, 1.38, 0], ...A_GLOW }),
    ],
  },
  {
    id: "table_lamp",
    name: "Abajur",
    color: "#38c172",
    size: [0.3, 0.45, 0.3],
    pieces: [sphere(0.1, { at: [0, 0.1, 0], scale: [1, 1, 1], ...G }), cylinder(0.02, 0.02, 0.14, 10, { at: [0, 0.24, 0], ...A_CHROME }), cylinder(0.09, 0.15, 0.16, 24, { at: [0, 0.37, 0], ...A_WHITE })],
  },
  {
    id: "plant",
    name: "Planta no vaso",
    color: "#ff8f3a",
    size: [0.5, 0.95, 0.5],
    pieces: [
      lathe([[0.001, 0], [0.16, 0], [0.2, 0.34], [0.22, 0.38], [0.18, 0.38], [0.001, 0.38]], G, 28),
      cylinder(0.17, 0.17, 0.02, 20, { at: [0, 0.37, 0], color: "#5a3a22" }),
      // Small spheres scaled up: the same round leaves with a third of the triangles.
      sphere(0.06, { at: [0, 0.62, 0], scale: [3.3, 3.3, 3.3], ...A_LEAF }),
      sphere(0.06, { at: [0.12, 0.76, 0.05], scale: [2.5, 2.5, 2.5], ...A_LEAF }),
      sphere(0.06, { at: [-0.1, 0.8, -0.06], scale: [2.3, 2.3, 2.3], color: "#2fa35f", finish: "gloss" }),
      sphere(0.06, { at: [0.02, 0.86, 0.1], scale: [2, 2, 2], color: "#4fd88a", finish: "gloss" }),
    ],
  },
  {
    id: "bookcase",
    name: "Estante",
    color: "#ff6b6b",
    size: [0.9, 1.8, 0.36],
    pieces: [
      rb(0.9, 0.06, 0.36, 0, 0, 0, G, 0.025),
      rb(0.9, 0.06, 0.36, 0, 1.74, 0, G, 0.025),
      ...[-1, 1].map((s) => rb(0.06, 1.8, 0.36, s * 0.42, 0, 0, G, 0.025)),
      rb(0.82, 1.7, 0.03, 0, 0.05, -0.165, A_WHITE, 0.01),
      ...[0.48, 0.92, 1.34].map((y) => rb(0.8, 0.04, 0.32, 0, y, 0, G, 0.015)),
      ...[0.06, 0.52, 0.96, 1.38].flatMap((y, row) =>
        [0, 1, 2, 3, 4].map((i) =>
          box([0.1, 0.26 + ((i * 7 + row * 3) % 4) * 0.03, 0.22], { at: [-0.3 + i * 0.13 + (row % 2) * 0.03, y + (0.26 + ((i * 7 + row * 3) % 4) * 0.03) / 2, 0.02], color: ["#3d8bfd", "#ffd23a", "#38c172", "#ff8fab", "#a66cff"][(i + row) % 5], finish: "gloss" }),
        ),
      ),
    ],
  },
  {
    id: "dining_table",
    name: "Mesa de jantar",
    color: "#d99a55",
    size: [1.6, 0.76, 0.9],
    pieces: [...corners(1.6, 0.9, 0.12).map(([x, z]) => foot(x, z, 0.68, G, 0.06)), rb(1.6, 0.1, 0.9, 0, 0.66, 0, G, 0.05)],
  },
  {
    id: "chair",
    name: "Cadeira",
    color: "#ff5a3c",
    size: [0.46, 0.92, 0.48],
    pieces: [
      ...corners(0.44, 0.44, 0.06).map(([x, z]) => foot(x, z, 0.44, A_WOOD, 0.03)),
      rb(0.46, 0.08, 0.46, 0, 0.42, 0, G, 0.035),
      rb(0.44, 0.38, 0.07, 0, 0.5, -0.2, G, 0.035),
    ],
  },
  {
    id: "counter",
    name: "Armário de cozinha",
    color: "#38c172",
    size: [0.6, 0.92, 0.62],
    pieces: [
      rb(0.56, 0.1, 0.52, 0, 0, -0.02, A_DARK, 0.02),
      rb(0.6, 0.76, 0.58, 0, 0.1, -0.02, G, 0.04),
      rb(0.52, 0.64, 0.04, 0, 0.15, 0.27, A_WHITE, 0.025),
      capsule(0.02, 0.18, { at: [0, 0.72, 0.31], rot: [0, 0, 90], ...A_CHROME }),
      rb(0.62, 0.07, 0.62, 0, 0.85, 0, { color: "#f2efe8", finish: "gloss" }, 0.03),
    ],
  },
  {
    id: "sink_counter",
    name: "Pia de cozinha",
    color: "#38c172",
    size: [0.6, 1.15, 0.62],
    pieces: [
      rb(0.56, 0.1, 0.52, 0, 0, -0.02, A_DARK, 0.02),
      rb(0.6, 0.76, 0.58, 0, 0.1, -0.02, G, 0.04),
      ...[-1, 1].map((s) => rb(0.25, 0.64, 0.04, s * 0.135, 0.15, 0.27, A_WHITE, 0.025)),
      rb(0.62, 0.07, 0.62, 0, 0.85, 0, { color: "#f2efe8", finish: "gloss" }, 0.03),
      rb(0.42, 0.02, 0.36, 0, 0.905, 0.04, A_CHROME, 0.04),
      rb(0.36, 0.02, 0.3, 0, 0.912, 0.04, { color: "#9aa4b2", finish: "metal" }, 0.03),
      cylinder(0.02, 0.02, 0.2, 12, { at: [0, 1.02, -0.2], ...A_CHROME }),
      capsule(0.018, 0.12, { at: [0, 1.11, -0.14], rot: [90, 0, 0], ...A_CHROME }),
    ],
  },
  {
    id: "stove",
    name: "Fogão",
    color: "#fbf8f1",
    size: [0.6, 0.95, 0.62],
    pieces: [
      rb(0.6, 0.9, 0.6, 0, 0, 0, G, 0.04),
      rb(0.46, 0.4, 0.03, 0, 0.18, 0.3, A_SCREEN, 0.02),
      capsule(0.018, 0.36, { at: [0, 0.64, 0.33], rot: [0, 0, 90], ...A_CHROME }),
      rb(0.58, 0.03, 0.58, 0, 0.9, 0, A_DARK, 0.02),
      ...corners(0.4, 0.4, 0).map(([x, z]) => cylinder(0.07, 0.08, 0.03, 20, { at: [x, 0.94, z], ...A_DARK })),
      ...[-0.2, -0.07, 0.07, 0.2].map((x) => cylinder(0.022, 0.022, 0.03, 12, { at: [x, 0.8, 0.31], rot: [90, 0, 0], ...A_DARK })),
    ],
  },
  {
    id: "fridge",
    name: "Geladeira",
    color: "#7cc6ff",
    size: [0.72, 1.8, 0.7],
    pieces: [
      rb(0.72, 1.8, 0.66, 0, 0, -0.02, G, 0.08),
      rb(0.66, 0.012, 0.02, 0, 1.18, 0.31, A_DARK, 0.005),
      ...[0.85, 1.45].map((y) => capsule(0.022, y > 1 ? 0.3 : 0.5, { at: [0.26, y, 0.34], ...A_CHROME })),
    ],
  },
  {
    id: "upper_cabinet",
    name: "Armário aéreo",
    color: "#38c172",
    size: [0.6, 0.7, 0.36],
    mount: "wall",
    pieces: [
      rb(0.6, 0.7, 0.34, 0, 0, -0.01, G, 0.04),
      rb(0.52, 0.6, 0.04, 0, 0.05, 0.16, A_WHITE, 0.025),
      capsule(0.018, 0.14, { at: [0, 0.14, 0.19], rot: [0, 0, 90], ...A_CHROME }),
    ],
  },
  {
    id: "microwave",
    name: "Micro-ondas",
    color: "#ff5a3c",
    size: [0.5, 0.3, 0.38],
    pieces: [rb(0.5, 0.3, 0.38, 0, 0, 0, G, 0.04), rb(0.32, 0.2, 0.02, -0.06, 0.05, 0.19, A_SCREEN, 0.015), ...[0.1, 0.2].map((y) => knob(0.17, y, 0.2, A_DARK, 0.022))],
  },
  {
    id: "toilet",
    name: "Vaso sanitário",
    color: "#fbf8f1",
    size: [0.42, 0.82, 0.66],
    pieces: [
      lathe([[0.001, 0], [0.13, 0], [0.12, 0.2], [0.17, 0.38], [0.001, 0.38]], G, 28),
      rb(0.4, 0.06, 0.52, 0, 0.38, 0.03, G, 0.03),
      rb(0.4, 0.4, 0.18, 0, 0.42, -0.25, G, 0.05),
      rb(0.42, 0.04, 0.2, 0, 0.82 - 0.04, -0.25, G, 0.02),
      knob(0.13, 0.76, -0.17, A_CHROME, 0.02),
    ],
  },
  {
    id: "bath_sink",
    name: "Pia de banheiro",
    color: "#a66cff",
    size: [0.62, 1.05, 0.46],
    pieces: [
      rb(0.5, 0.1, 0.36, 0, 0, -0.02, A_DARK, 0.02),
      rb(0.6, 0.72, 0.44, 0, 0.1, 0, G, 0.05),
      rb(0.5, 0.58, 0.03, 0, 0.16, 0.22, A_WHITE, 0.02),
      rb(0.62, 0.06, 0.46, 0, 0.82, 0, A_WHITE, 0.03),
      cylinder(0.17, 0.12, 0.06, 28, { at: [0, 0.86, 0.03], ...A_WATER }),
      cylinder(0.018, 0.018, 0.16, 12, { at: [0, 0.96, -0.17], ...A_CHROME }),
      capsule(0.016, 0.08, { at: [0, 1.03, -0.12], rot: [90, 0, 0], ...A_CHROME }),
    ],
  },
  {
    id: "bathtub",
    name: "Banheira",
    color: "#fbf8f1",
    size: [0.8, 0.62, 1.7],
    pieces: [
      rb(0.8, 0.56, 1.7, 0, 0, 0, G, 0.12),
      rb(0.62, 0.02, 1.5, 0, 0.5, 0.02, A_WATER, 0.1),
      cylinder(0.022, 0.022, 0.12, 12, { at: [0, 0.6, -0.78], ...A_CHROME }),
      capsule(0.02, 0.1, { at: [0, 0.65, -0.72], rot: [90, 0, 0], ...A_CHROME }),
    ],
  },
  {
    id: "shower",
    name: "Box de chuveiro",
    color: "#7fd8ff",
    size: [0.9, 2.0, 0.9],
    pieces: [
      rb(0.9, 0.1, 0.9, 0, 0, 0, A_WHITE, 0.04),
      rb(0.88, 1.85, 0.02, 0, 0.1, 0.44, { finish: "glass" }, 0.01),
      rb(0.02, 1.85, 0.88, 0.44, 0.1, 0, { finish: "glass" }, 0.01),
      rb(0.04, 1.9, 0.04, 0.44, 0.1, 0.44, A_CHROME, 0.015),
      cylinder(0.02, 0.02, 0.2, 10, { at: [-0.3, 1.9, -0.35], rot: [90, 0, 0], ...A_CHROME }),
      cylinder(0.1, 0.08, 0.04, 20, { at: [-0.3, 1.86, -0.25], ...A_CHROME }),
    ],
  },
  {
    id: "mirror",
    name: "Espelho",
    color: "#ffd23a",
    size: [0.6, 0.8, 0.05],
    mount: "wall",
    pieces: [rb(0.6, 0.8, 0.04, 0, 0, 0, G, 0.08), rb(0.5, 0.7, 0.02, 0, 0.05, 0.015, { color: "#cfe9f7", finish: "glass" }, 0.06)],
  },
  {
    id: "desk",
    name: "Escrivaninha",
    color: "#3d8bfd",
    size: [1.2, 0.76, 0.6],
    pieces: [
      rb(0.4, 0.68, 0.56, 0.38, 0, 0, G, 0.04),
      ...[0.12, 0.34, 0.54].map((y) => rb(0.34, 0.16, 0.03, 0.38, y, 0.28, A_WHITE, 0.02)),
      rb(0.06, 0.68, 0.56, -0.56, 0, 0, G, 0.025),
      rb(1.2, 0.08, 0.6, 0, 0.68, 0, A_WOOD, 0.035),
    ],
  },
  {
    id: "office_chair",
    name: "Cadeira de escritório",
    color: "#2c303a",
    size: [0.62, 1.05, 0.62],
    pieces: [
      ...[0, 72, 144, 216, 288].flatMap((angle) => {
        const r = (angle * Math.PI) / 180;
        return [
          box([0.05, 0.04, 0.3], { at: [Math.sin(r) * 0.14, 0.07, Math.cos(r) * 0.14], ...A_DARK }),
          sphere(0.035, { at: [Math.sin(r) * 0.28, 0.035, Math.cos(r) * 0.28], ...A_DARK }),
        ].map((piece) => ({ ...piece, rot: [0, angle, 0] as Vec3, at: piece.at }));
      }),
      cylinder(0.03, 0.03, 0.34, 12, { at: [0, 0.26, 0], ...A_CHROME }),
      rb(0.5, 0.09, 0.48, 0, 0.42, 0.02, { color: "#ff5a3c", finish: "gloss" }, 0.045),
      rb(0.46, 0.46, 0.08, 0, 0.56, -0.22, { color: "#ff5a3c", finish: "gloss" }, 0.045),
      ...[-1, 1].map((s) => rb(0.05, 0.16, 0.3, s * 0.26, 0.5, 0, A_DARK, 0.02)),
    ],
  },
  {
    id: "monitor",
    name: "Monitor",
    color: "#2c303a",
    size: [0.56, 0.44, 0.2],
    pieces: [rb(0.22, 0.02, 0.18, 0, 0, 0, G, 0.01), rb(0.05, 0.14, 0.04, 0, 0.02, -0.04, G, 0.015), rb(0.56, 0.32, 0.04, 0, 0.12, -0.02, G, 0.025), rb(0.5, 0.26, 0.01, 0, 0.15, 0.002, A_SCREEN, 0.008)],
  },
  {
    id: "washer",
    name: "Máquina de lavar",
    color: "#fbf8f1",
    size: [0.6, 0.86, 0.6],
    pieces: [
      rb(0.6, 0.86, 0.6, 0, 0, 0, G, 0.05),
      rb(0.56, 0.12, 0.02, 0, 0.7, 0.3, { color: "#3d8bfd", finish: "gloss" }, 0.01),
      torus(0.17, 0.035, { at: [0, 0.38, 0.31], ...A_CHROME }),
      cylinder(0.15, 0.15, 0.02, 28, { at: [0, 0.38, 0.305], rot: [90, 0, 0], ...A_SCREEN }),
    ],
  },
  {
    id: "shop_shelf",
    name: "Gôndola",
    color: "#ffffff",
    size: [1.0, 1.5, 0.62],
    pieces: [
      rb(1.0, 0.1, 0.62, 0, 0, 0, A_DARK, 0.03),
      rb(1.0, 1.4, 0.06, 0, 0.1, 0, G, 0.02),
      ...[0.1, 0.55, 1.0].flatMap((y) => [-1, 1].map((s) => rb(1.0, 0.03, 0.26, 0, y + 0.02, s * 0.17, G, 0.01))),
      ...[0.15, 0.6, 1.05].flatMap((y, row) =>
        [-1, 1].flatMap((s) =>
          [0, 1, 2, 3].map((i) =>
            box([0.18, 0.18 + ((i + row) % 3) * 0.05, 0.18], { at: [-0.33 + i * 0.22, y + (0.18 + ((i + row) % 3) * 0.05) / 2, s * 0.17], color: ["#ff5a3c", "#ffd23a", "#38c172", "#3d8bfd"][(i + row + (s > 0 ? 1 : 0)) % 4], finish: "gloss" }),
          ),
        ),
      ),
    ],
  },
  {
    id: "shop_counter",
    name: "Balcão",
    color: "#ff5a3c",
    size: [1.4, 1.0, 0.62],
    pieces: [rb(1.36, 0.92, 0.56, 0, 0, -0.02, G, 0.05), rb(1.2, 0.5, 0.02, 0, 0.25, 0.27, A_WHITE, 0.02), rb(1.4, 0.08, 0.62, 0, 0.92, 0, A_WOOD, 0.035)],
  },
  {
    id: "register",
    name: "Caixa registradora",
    color: "#3d8bfd",
    size: [0.42, 0.34, 0.4],
    pieces: [rb(0.42, 0.12, 0.4, 0, 0, 0, G, 0.03), rb(0.3, 0.06, 0.2, 0, 0.12, 0.06, A_DARK, 0.02), rb(0.28, 0.16, 0.04, 0, 0.16, -0.12, A_SCREEN, 0.015)],
  },
  {
    id: "bar_stool",
    name: "Banqueta",
    color: "#ff5a3c",
    size: [0.4, 0.75, 0.4],
    pieces: [
      cylinder(0.16, 0.18, 0.03, 24, { at: [0, 0.015, 0], ...A_CHROME }),
      cylinder(0.025, 0.025, 0.66, 12, { at: [0, 0.36, 0], ...A_CHROME }),
      torus(0.13, 0.015, { at: [0, 0.3, 0], rot: [90, 0, 0], ...A_CHROME }),
      cylinder(0.19, 0.18, 0.09, 28, { at: [0, 0.705, 0], ...G }),
    ],
  },
  {
    id: "ceiling_lamp",
    name: "Luminária de teto",
    color: "#ffd23a",
    size: [0.46, 0.5, 0.46],
    mount: "ceiling",
    pieces: [
      cylinder(0.06, 0.06, 0.03, 16, { at: [0, 0.485, 0], ...A_WHITE }),
      cylinder(0.008, 0.008, 0.3, 6, { at: [0, 0.32, 0], ...A_DARK }),
      lathe([[0.03, 0.14], [0.11, 0.12], [0.2, 0], [0.23, 0], [0.21, 0.04], [0.12, 0.15], [0.03, 0.17]], G, 32),
      sphere(0.06, { at: [0, 0.06, 0], ...A_GLOW }),
    ],
  },
  {
    id: "trash",
    name: "Lixeira",
    color: "#38c172",
    size: [0.32, 0.5, 0.32],
    pieces: [cylinder(0.16, 0.13, 0.44, 24, { at: [0, 0.22, 0], ...G }), cylinder(0.165, 0.165, 0.05, 24, { at: [0, 0.465, 0], ...A_DARK }), sphere(0.03, { at: [0, 0.5, 0], ...A_CHROME })],
  },
  {
    id: "cafe_table",
    name: "Mesa redonda",
    color: "#ff8fab",
    size: [0.9, 0.76, 0.9],
    pieces: [
      cylinder(0.26, 0.3, 0.05, 28, { at: [0, 0.025, 0], ...A_DARK }),
      cylinder(0.05, 0.05, 0.64, 14, { at: [0, 0.37, 0], ...A_CHROME }),
      cylinder(0.45, 0.45, 0.07, 40, { at: [0, 0.725, 0], ...G }),
    ],
  },
  {
    id: "side_table",
    name: "Mesa lateral",
    color: "#ffd23a",
    size: [0.46, 0.55, 0.46],
    pieces: [cylinder(0.12, 0.16, 0.03, 24, { at: [0, 0.015, 0], ...A_DARK }), cylinder(0.035, 0.035, 0.48, 12, { at: [0, 0.26, 0], ...A_CHROME }), cylinder(0.23, 0.23, 0.05, 32, { at: [0, 0.525, 0], ...G })],
  },
];

// Realista: the pieces the downloaded packs lack, at real sizes, with thin edges and real finishes.
const R_BLACK: Options = { color: "#16181c", finish: "gloss" };
const R_SCREEN: Options = { color: "#0b0f15", finish: "glass" };
const R_STEEL: Options = { color: "#b9bec6", finish: "metal" };
const R_STONE: Options = { color: "#e4e1db", finish: "gloss" };
const R_WHITE: Options = { color: "#f4f3ef" };
const r = (w: number, h: number, d: number, x: number, y: number, z: number, options: Options = {}, radius = 0.006) =>
  roundedBox([w, h, d], Math.min(radius, Math.min(w, h, d) / 2.2), { at: [x, y + h / 2, z], ...options });

const REALISTIC_FURNITURE: Furniture[] = [
  {
    id: "tv",
    name: "TV de tela plana",
    color: "#16181c",
    size: [1.24, 0.78, 0.24],
    pieces: [
      r(0.36, 0.012, 0.22, 0, 0, 0.0, R_BLACK, 0.004),
      r(0.06, 0.07, 0.04, 0, 0.012, -0.03, R_BLACK, 0.006),
      r(1.24, 0.72, 0.035, 0, 0.06, -0.03, {}, 0.008),
      r(1.21, 0.69, 0.004, 0, 0.075, -0.011, R_SCREEN, 0.002),
      r(1.0, 0.5, 0.03, 0, 0.17, -0.06, R_BLACK, 0.02),
    ],
  },
  {
    id: "monitor",
    name: "Monitor",
    color: "#1d1f24",
    size: [0.55, 0.45, 0.2],
    pieces: [
      r(0.24, 0.01, 0.18, 0, 0, 0, R_STEEL, 0.004),
      r(0.04, 0.2, 0.025, 0, 0.01, -0.06, R_STEEL, 0.006),
      r(0.55, 0.33, 0.02, 0, 0.11, -0.03, {}, 0.005),
      r(0.53, 0.3, 0.003, 0, 0.125, -0.019, R_SCREEN, 0.002),
    ],
  },
  {
    id: "keyboard",
    name: "Teclado",
    color: "#2a2c31",
    size: [0.44, 0.03, 0.14],
    pieces: [r(0.44, 0.018, 0.14, 0, 0, 0, {}, 0.004), ...Array.from({ length: 4 }, (_, row) => r(0.4, 0.008, 0.026, 0, 0.018, -0.045 + row * 0.03, { color: "#3a3d44" }, 0.002))],
  },
  {
    id: "counter",
    name: "Armário de cozinha com tampo",
    color: "#f4f3ef",
    size: [0.6, 0.92, 0.62],
    pieces: [
      r(0.56, 0.1, 0.5, 0, 0, -0.04, { color: "#2a2b2e" }, 0.002),
      r(0.6, 0.78, 0.56, 0, 0.1, -0.03, {}, 0.003),
      r(0.296, 0.6, 0.018, -0.15, 0.13, 0.255, {}, 0.003),
      r(0.296, 0.6, 0.018, 0.15, 0.13, 0.255, {}, 0.003),
      r(0.592, 0.15, 0.018, 0, 0.74, 0.255, {}, 0.003),
      r(0.16, 0.012, 0.02, 0, 0.8, 0.275, R_STEEL, 0.004),
      ...[-1, 1].map((s) => r(0.012, 0.12, 0.02, s * 0.03, 0.55, 0.275, R_STEEL, 0.004)),
      r(0.62, 0.03, 0.62, 0, 0.88, 0, R_STONE, 0.004),
      r(0.6, 0.08, 0.01, 0, 0.91, -0.305, R_STONE, 0.003),
    ],
  },
  {
    id: "sink_counter",
    name: "Pia de cozinha com gabinete",
    color: "#f4f3ef",
    size: [0.8, 1.2, 0.62],
    pieces: [
      r(0.76, 0.1, 0.5, 0, 0, -0.04, { color: "#2a2b2e" }, 0.002),
      r(0.8, 0.78, 0.56, 0, 0.1, -0.03, {}, 0.003),
      ...[-1, 1].map((s) => r(0.396, 0.75, 0.018, s * 0.2, 0.13, 0.255, {}, 0.003)),
      ...[-1, 1].map((s) => r(0.012, 0.14, 0.02, s * 0.03, 0.7, 0.275, R_STEEL, 0.004)),
      r(0.82, 0.03, 0.62, 0, 0.88, 0, R_STONE, 0.004),
      r(0.56, 0.006, 0.4, 0, 0.91, 0.03, R_STEEL, 0.01),
      r(0.52, 0.006, 0.36, 0, 0.904, 0.03, { color: "#8e949c", finish: "metal" }, 0.01),
      cylinder(0.016, 0.02, 0.26, 16, { at: [0, 1.04, -0.2], ...R_STEEL }),
      torus(0.08, 0.012, { at: [0, 1.17, -0.12], rot: [0, 90, 0], arc: Math.PI, ...R_STEEL }),
      r(0.6, 0.08, 0.01, 0, 0.91, -0.305, R_STONE, 0.003),
    ],
  },
  {
    id: "upper_cabinet",
    name: "Armário aéreo",
    color: "#f4f3ef",
    size: [0.6, 0.7, 0.34],
    mount: "wall",
    pieces: [
      r(0.6, 0.7, 0.32, 0, 0, -0.01, {}, 0.003),
      ...[-1, 1].map((s) => r(0.296, 0.69, 0.018, s * 0.15, 0.005, 0.159, {}, 0.003)),
      ...[-1, 1].map((s) => r(0.012, 0.1, 0.02, s * 0.03, 0.04, 0.178, R_STEEL, 0.004)),
    ],
  },
  {
    id: "microwave",
    name: "Micro-ondas",
    color: "#24262b",
    size: [0.5, 0.3, 0.4],
    pieces: [r(0.5, 0.3, 0.38, 0, 0, -0.01, {}, 0.01), r(0.36, 0.24, 0.006, -0.06, 0.03, 0.18, R_SCREEN, 0.006), r(0.1, 0.24, 0.006, 0.19, 0.03, 0.18, { color: "#3a3d44" }, 0.004), r(0.02, 0.18, 0.02, 0.115, 0.06, 0.195, R_STEEL, 0.004)],
  },
  {
    id: "shower",
    name: "Box de vidro",
    color: "#f4f3ef",
    size: [0.9, 2.05, 0.9],
    pieces: [
      r(0.9, 0.05, 0.9, 0, 0, 0, R_WHITE, 0.01),
      r(0.06, 0.003, 0.06, 0.25, 0.05, 0.25, R_STEEL, 0.001),
      r(0.88, 1.9, 0.008, 0, 0.06, 0.445, { color: "#cfe3ea", finish: "tint" }, 0.002),
      r(0.008, 1.9, 0.88, 0.445, 0.06, 0, { color: "#cfe3ea", finish: "tint" }, 0.002),
      r(0.02, 1.92, 0.02, 0.44, 0.05, 0.44, R_STEEL, 0.004),
      r(0.88, 0.02, 0.02, 0, 1.96, 0.44, R_STEEL, 0.004),
      r(0.02, 0.02, 0.88, 0.44, 1.96, 0, R_STEEL, 0.004),
      cylinder(0.012, 0.012, 0.32, 12, { at: [-0.3, 1.98, -0.29], rot: [90, 0, 0], ...R_STEEL }),
      cylinder(0.11, 0.11, 0.012, 32, { at: [-0.3, 1.97, -0.13], ...R_STEEL }),
      cylinder(0.025, 0.025, 0.06, 16, { at: [-0.3, 1.1, -0.42], rot: [90, 0, 0], ...R_STEEL }),
    ],
  },
  {
    id: "shop_counter",
    name: "Balcão de loja",
    color: "#2f3238",
    size: [1.5, 1.02, 0.62],
    pieces: [r(1.46, 0.96, 0.56, 0, 0, -0.02, {}, 0.004), r(1.46, 0.06, 0.02, 0, 0.1, 0.27, R_STEEL, 0.004), r(1.5, 0.04, 0.62, 0, 0.96, 0, { color: "#c9a77c" }, 0.004)],
  },
  {
    id: "rug",
    name: "Tapete",
    color: "#8a7f72",
    size: [2.0, 0.015, 1.4],
    pieces: [r(2.0, 0.012, 1.4, 0, 0, 0, {}, 0.004), r(1.8, 0.003, 1.2, 0, 0.012, 0, { shade: 0.85 }, 0.002), r(1.7, 0.003, 1.1, 0, 0.013, 0, {}, 0.002)],
  },
];

/** The same rooms for Low poly and Blocos come from the Kenney kit; only the walls are drawn here. */
export const interiorBlocks: BlockDef[] = [
  ...(["realistic", "lowpoly", "blocks", "arcade"] as Shell[]).flatMap(shellBlocks),
  ...ARCADE_FURNITURE.map((item) => furnitureBlock("ar", item)),
  ...REALISTIC_FURNITURE.map((item) => furnitureBlock("rz", item)),
];

export const ARCADE_FURNITURE_IDS = ARCADE_FURNITURE.map(({ id }) => `ar.mob_${id}`);
export const REALISTIC_FURNITURE_IDS = REALISTIC_FURNITURE.map(({ id }) => `rz.mob_${id}`);
