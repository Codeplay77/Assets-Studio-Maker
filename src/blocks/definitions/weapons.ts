import type { BlockDef, ShapePiece, Vec3 } from "../types.ts";
import { block, box, compound, cylinder, icosahedron, socket, sphere, torus, tube } from "./helpers.ts";

// Staffs and a wand, which the CC0 weapon packs lack, drawn for every style from one design each:
// faceted for Low poly (Arcade smooths and polishes those, see styleize.ts), out of cubes for Blocos
// and with wood, leather and metal surfaces for Realista. Like the imported weapons
// (scripts/import-weapons.ts) they stand upright with their tip up, and their first socket is the
// grip, where a hand holds them.

const CATEGORY = "lib_weapons";
const WOOD = "#7a5230";
const DARK_WOOD = "#4e3420";
const LEATHER = "#5a3a26";
const BRASS = "#c9a24a";
/** Realista's photographed wood and leather keep their own colors, only a little warmed. */
const NATURAL = "#f1e2cf";

type Style = "lowpoly" | "realistic";

interface Staff {
  id: string;
  name: string;
  /** The shaft, bottom to top, and its radius at each point. */
  shaft: Vec3[];
  radius: number[];
  /** Where a hand holds it, as a height. */
  grip: number;
  /** What sits on top: a crystal in claws, an orb on a collar, a hook, or nothing. */
  head: "crystal" | "orb" | "hook" | "plain" | "star";
  /** The color of the crystal, orb or star. */
  magic?: string;
}

const STAFFS: Staff[] = [
  {
    id: "cajado_cristal",
    name: "Cajado de cristal",
    shaft: [[0, 0, 0], [0.012, 0.4, 0.004], [-0.01, 0.8, -0.008], [0.014, 1.2, 0.01], [0, 1.52, 0]],
    radius: [0.014, 0.017, 0.016, 0.017, 0.021],
    grip: 0.8,
    head: "crystal",
    magic: "#8a5cf0",
  },
  {
    id: "cajado_orbe",
    name: "Cajado com orbe",
    shaft: [[0, 0, 0], [0, 0.5, 0], [0, 1.0, 0], [0, 1.45, 0]],
    radius: [0.013, 0.016, 0.016, 0.017],
    grip: 0.78,
    head: "orb",
    magic: "#ff8a2a",
  },
  {
    id: "cajado_madeira",
    name: "Cajado de madeira",
    shaft: [[0, 0, 0], [0.008, 0.45, -0.006], [-0.006, 0.9, 0.006], [0.006, 1.35, -0.004], [0, 1.8, 0]],
    radius: [0.016, 0.019, 0.018, 0.019, 0.022],
    grip: 1.0,
    head: "plain",
  },
  {
    id: "cajado_curvo",
    name: "Cajado curvo",
    shaft: [[0, 0, 0], [0.006, 0.5, 0], [-0.004, 1.0, 0], [0, 1.45, 0]],
    radius: [0.015, 0.017, 0.017, 0.018],
    grip: 0.85,
    head: "hook",
    magic: "#37c871",
  },
  {
    id: "varinha",
    name: "Varinha mágica",
    shaft: [[0, 0, 0], [0, 0.1, 0], [0.002, 0.22, 0], [0, 0.33, 0]],
    radius: [0.009, 0.008, 0.006, 0.004],
    grip: 0.05,
    head: "star",
    magic: "#ffd23a",
  },
];

const top = (staff: Staff) => staff.shaft[staff.shaft.length - 1];

function heldBlock(id: string, name: string, color: string, pieces: ShapePiece[], grip: number, height: number): BlockDef {
  return block(id, name, CATEGORY, color, compound(pieces), [
    socket("grip", [0, grip, 0], [0, -1, 0]),
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", [0, height, 0], [0, 1, 0]),
  ]);
}

/** The head of a staff in shapes; `fine` for Realista, faceted otherwise. */
function head(staff: Staff, style: Style): { pieces: ShapePiece[]; height: number } {
  const fine = style === "realistic";
  const look = fine ? {} : { faceted: true };
  const metal = fine ? { finish: "metal" as const, color: BRASS } : { color: BRASS, ...look };
  const [x, y, z] = top(staff);
  const r = staff.radius[staff.radius.length - 1];
  const magic = staff.magic ?? "#ffffff";
  // The glow of a crystal or an orb, with a glassy shell over it in Realista.
  const gem = (radius: number, at: Vec3, detail: number) => [
    icosahedron(radius, detail, { at, color: magic, finish: "glow", ...look }),
    ...(fine ? [icosahedron(radius * 1.12, detail, { at, color: magic, finish: "tint" })] : []),
  ];
  switch (staff.head) {
    case "crystal": {
      const center: Vec3 = [x, y + 0.075, z];
      // Three claws from the top of the shaft, bending out round the crystal and back in.
      const claws = [0, 120, 240].map((degrees) => {
        const a = (degrees * Math.PI) / 180;
        const out = (d: number): Vec3 => [x + Math.cos(a) * d, 0, z + Math.sin(a) * d];
        const at = (d: number, h: number): Vec3 => [out(d)[0], y + h, out(d)[2]];
        return tube([at(0.01, -0.01), at(0.045, 0.04), at(0.05, 0.1), at(0.022, 0.15)], [r * 0.7, r * 0.6, r * 0.45, r * 0.15], {
          radial: fine ? 8 : 4,
          color: fine ? NATURAL : DARK_WOOD,
          ...(fine ? { surface: "wood_dark" } : look),
        });
      });
      return { pieces: [...claws, ...gem(0.05, center, fine ? 1 : 0)], height: y + 0.15 };
    }
    case "orb": {
      return {
        pieces: [
          cylinder(r * 1.5, r * 1.1, 0.04, fine ? 16 : 6, { at: [x, y, z], ...metal }),
          torus(0.045, r * 0.45, { at: [x, y + 0.075, z], rot: [90, 0, 0], ...metal }),
          ...(fine ? [sphere(0.042, { at: [x, y + 0.075, z], color: staff.magic, finish: "glow" })] : gem(0.042, [x, y + 0.075, z], 1)),
        ],
        height: y + 0.12,
      };
    }
    case "hook": {
      // The top curls back over itself, with a leaf of light hanging in the curl.
      const curl: Vec3[] = [[x, y, z], [x, y + 0.09, z + 0.01], [x, y + 0.16, z + 0.06], [x, y + 0.17, z + 0.13], [x, y + 0.12, z + 0.17], [x, y + 0.07, z + 0.15]];
      return {
        pieces: [
          tube(curl, [r, r * 0.95, r * 0.85, r * 0.75, r * 0.6, r * 0.4], { radial: fine ? 10 : 5, color: fine ? NATURAL : WOOD, ...(fine ? { surface: "wood_oak" } : look) }),
          ...gem(0.022, [x, y + 0.085, z + 0.1], fine ? 1 : 0),
        ],
        height: y + 0.18,
      };
    }
    case "star": {
      return {
        pieces: [
          ...[0, 72, 144, 216, 288].map((degrees) =>
            cylinder(0, 0.012, 0.03, fine ? 8 : 4, {
              at: [x + Math.sin((degrees * Math.PI) / 180) * 0.015, y + 0.012 + Math.cos((degrees * Math.PI) / 180) * 0.015, z],
              rot: [0, 0, -degrees],
              color: staff.magic,
              finish: "glow",
              ...look,
            }),
          ),
          icosahedron(0.012, 0, { at: [x, y + 0.012, z], color: staff.magic, finish: "glow", ...look }),
        ],
        height: y + 0.045,
      };
    }
    default:
      return { pieces: [cylinder(r * 1.1, r * 1.25, 0.03, fine ? 16 : 6, { at: [x, y - 0.015, z], color: fine ? NATURAL : DARK_WOOD, ...(fine ? { surface: "wood_dark" } : look) })], height: y };
  }
}

/** A staff as Low poly or Realista draws it: the shaft, a leather wrap where the hand goes, and its head. */
function drawnStaff(staff: Staff, style: Style, prefix: string): BlockDef {
  const fine = style === "realistic";
  const look = fine ? {} : { faceted: true };
  const shaft = tube(staff.shaft, staff.radius, {
    radial: fine ? 12 : 6,
    steps: fine ? 8 : 3,
    color: fine ? NATURAL : WOOD,
    ...(fine ? { surface: staff.head === "hook" ? "wood_oak" : "bark" } : look),
  });
  // The wrap: a short sleeve round the shaft where the hand holds it.
  const wrapLength = staff.id === "varinha" ? 0.09 : 0.16;
  const wrapAt = staff.id === "varinha" ? wrapLength / 2 : staff.grip;
  const wrap = cylinder(radiusAt(staff, wrapAt) * 1.25, radiusAt(staff, wrapAt) * 1.25, wrapLength, fine ? 16 : 6, {
    at: [xzAt(staff, wrapAt)[0], wrapAt, xzAt(staff, wrapAt)[1]],
    color: fine ? NATURAL : staff.id === "varinha" ? DARK_WOOD : LEATHER,
    ...(fine ? { surface: staff.id === "varinha" ? "wood_dark" : "leather" } : look),
  });
  const { pieces, height } = head(staff, style);
  return heldBlock(`${prefix}.${staff.id}`, staff.name, WOOD, [shaft, wrap, ...pieces], staff.grip, height);
}

/** Where along the shaft a height is: the shaft's points, by height. */
function segmentAt(staff: Staff, y: number): [number, number] {
  const points = staff.shaft;
  for (let i = 0; i < points.length - 1; i++) {
    if (y <= points[i + 1][1]) return [i, (y - points[i][1]) / (points[i + 1][1] - points[i][1])];
  }
  return [points.length - 2, 1];
}

function radiusAt(staff: Staff, y: number): number {
  const [i, t] = segmentAt(staff, y);
  return staff.radius[i] + (staff.radius[i + 1] - staff.radius[i]) * t;
}

function xzAt(staff: Staff, y: number): [number, number] {
  const [i, t] = segmentAt(staff, y);
  const [a, b] = [staff.shaft[i], staff.shaft[i + 1]];
  return [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
}

// --- Blocos ---------------------------------------------------------------------------------------
//
// Out of the cubes the Blocos weapons use (half a cube of the Blocos people), each a cube or a stack.

const CUBE = 0.0275;
const cube = (x: number, y: number, z: number, color: string, size: Vec3 = [1, 1, 1], finish?: "glow"): ShapePiece =>
  box([size[0] * CUBE, size[1] * CUBE, size[2] * CUBE], { at: [x * CUBE, (y + size[1] / 2) * CUBE, z * CUBE], color, ...(finish ? { finish } : {}) });

function cubeStaff(staff: Staff): BlockDef {
  const small = staff.id === "varinha";
  const unit = small ? 0.5 : 1;
  const tall = Math.round(top(staff)[1] / (CUBE * unit));
  const scaled = (pieces: ShapePiece[]) =>
    small ? pieces.map((piece) => ({ ...piece, at: piece.at!.map((value) => value * unit) as Vec3, scale: [unit, unit, unit] as Vec3 })) : pieces;
  const gripCube = Math.round(staff.grip / (CUBE * unit));
  const magic = staff.magic ?? "#ffffff";
  const pieces: ShapePiece[] = [
    // The shaft, a column of cubes with a darker wrap where the hand goes.
    cube(0, 0, 0, WOOD, [1, tall, 1]),
    cube(0, gripCube - 2, 0, LEATHER, [1.4, 5, 1.4]),
  ];
  switch (staff.head) {
    case "crystal":
      pieces.push(
        ...[-1, 1].map((side) => cube(side, tall - 1, 0, DARK_WOOD, [1, 4, 1])),
        cube(0, tall - 1, -1, DARK_WOOD, [1, 4, 1]),
        cube(0, tall, 0, magic, [1, 4, 1], "glow"),
        cube(0, tall + 1, 0, magic, [2, 2, 2], "glow"),
      );
      break;
    case "orb":
      pieces.push(cube(0, tall - 1, 0, BRASS, [1.6, 1, 1.6]), cube(0, tall, 0, magic, [3, 3, 3], "glow"));
      break;
    case "hook":
      pieces.push(cube(0, tall, 0, WOOD, [1, 5, 1]), cube(0, tall + 5, 1.5, WOOD, [1, 1, 4]), cube(0, tall + 2, 3, WOOD, [1, 3, 1]), cube(0, tall + 2, 1.5, magic, [1, 1, 1], "glow"));
      break;
    case "star":
      pieces.push(cube(0, tall, 0, magic, [3, 1, 1], "glow"), cube(0, tall - 1, 0, magic, [1, 3, 1], "glow"));
      break;
    default:
      pieces.push(cube(0, tall - 1, 0, DARK_WOOD, [1.4, 1, 1.4]));
  }
  const all = scaled(pieces);
  const height = Math.max(...all.map((piece) => (piece.at![1] + ((piece.shape as { size: Vec3 }).size[1] * (piece.scale?.[1] ?? 1)) / 2)));
  return heldBlock(`vx.armas.${staff.id}`, staff.name, WOOD, all, staff.grip, Math.round(height * 1000) / 1000);
}

/** Low poly staffs; Arcade makes its own from these (see index.ts). */
export const lowPolyWeaponBlocks: BlockDef[] = STAFFS.map((staff) => drawnStaff(staff, "lowpoly", "lp.armas"));
export const voxelWeaponBlocks: BlockDef[] = STAFFS.map(cubeStaff);
export const realisticWeaponBlocks: BlockDef[] = STAFFS.map((staff) => drawnStaff(staff, "realistic", "rz.armas"));
