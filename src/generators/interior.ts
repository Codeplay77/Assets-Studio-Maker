import { blockBounds } from "../blocks/bounds";
import { getBlock, hasBlock, type BlockDef } from "../blocks/catalog";
import { FLOOR_TOP, ROOM_HEIGHT, SHELL_PREFIX, SHELL_THICKNESS, type FloorKind } from "../blocks/definitions/interior.ts";
import type { ArtStyle } from "../blocks/styles";
import type { Vec3 } from "../core/types";
import type { AssembledPart, Assembler } from "./assembler";
import { PAINT_PALETTE } from "./kart";
import type { Rng } from "./rng";

// Interiors: a floor plan split into rooms on a 1 m grid, walls with doors and windows, and the
// furniture each room needs, placed against walls the way people really arrange them.

export type InteriorKind = "house" | "apartment" | "office" | "shop" | "restaurant" | "room";
export type RoomType =
  | "living"
  | "kitchen"
  | "dining"
  | "bedroom"
  | "kids"
  | "bathroom"
  | "study"
  | "laundry"
  | "storage"
  | "office"
  | "meeting"
  | "manager"
  | "reception"
  | "pantry"
  | "sales"
  | "hall"
  | "cookery";

export const ROOM_NAMES: Record<RoomType, string> = {
  living: "Sala",
  kitchen: "Cozinha",
  dining: "Sala de jantar",
  bedroom: "Quarto",
  kids: "Quarto infantil",
  bathroom: "Banheiro",
  study: "Escritório em casa",
  laundry: "Lavanderia",
  storage: "Depósito",
  office: "Escritório",
  meeting: "Sala de reunião",
  manager: "Sala do gerente",
  reception: "Recepção",
  pantry: "Copa",
  sales: "Salão de vendas",
  hall: "Salão",
  cookery: "Cozinha industrial",
};

/** The rooms someone can ask for on their own. */
export const SINGLE_ROOMS: RoomType[] = ["living", "bedroom", "kids", "kitchen", "bathroom", "dining", "study", "laundry", "office", "meeting"];

export interface InteriorOptions {
  style?: ArtStyle;
  kind?: string;
  room?: string;
  size?: string;
  floor?: string;
  wall?: string;
  furniture?: string;
  ceiling?: string;
  doors?: string;
}

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

// --- the furniture of each style -----------------------------------------------------------

export type Item =
  | "bed_double" | "bed_single" | "nightstand" | "wardrobe" | "dresser" | "sofa" | "armchair" | "coffee_table"
  | "tv_stand" | "tv" | "rug" | "floor_lamp" | "table_lamp" | "plant" | "bookcase" | "side_table" | "dining_table"
  | "chair" | "counter" | "sink_counter" | "stove" | "fridge" | "upper_cabinet" | "microwave" | "toilet" | "bath_sink"
  | "bathtub" | "shower" | "mirror" | "desk" | "office_chair" | "monitor" | "keyboard" | "washer" | "shop_shelf"
  | "shop_counter" | "register" | "bar_stool" | "ceiling_lamp" | "trash" | "boxes" | "towel" | "kitchen_table" | "cafe_table";

export type Catalog = Partial<Record<Item, string[]>>;

const kenney = (prefix: string): Catalog => {
  const k = (...names: string[]) => names.map((name) => `${prefix}.${name}`);
  return {
    bed_double: k("bedDouble"),
    bed_single: k("bedSingle"),
    nightstand: k("cabinetBedDrawerTable", "cabinetBedDrawer"),
    wardrobe: k("bookcaseClosedDoors"),
    dresser: k("sideTableDrawers"),
    sofa: k("loungeSofa"),
    armchair: k("loungeChair"),
    coffee_table: k("tableCoffee", "tableCoffeeGlass"),
    tv_stand: k("cabinetTelevision", "cabinetTelevisionDoors"),
    tv: k("televisionModern"),
    rug: k("rugRectangle", "rugRounded"),
    floor_lamp: k("lampRoundFloor", "lampSquareFloor"),
    table_lamp: k("lampSquareTable", "lampRoundTable"),
    plant: k("pottedPlant"),
    bookcase: k("bookcaseOpen", "bookcaseClosed"),
    side_table: k("cabinetBed"),
    dining_table: k("table", "tableCloth"),
    kitchen_table: k("tableRound", "table"),
    cafe_table: k("tableRound"),
    chair: k("chair", "chairCushion"),
    counter: k("kitchenCabinetDrawer-1", "kitchenCabinet"),
    sink_counter: k("kitchenSink"),
    stove: k("kitchenStove", "kitchenStoveElectric"),
    fridge: k("kitchenFridge"),
    upper_cabinet: k("kitchenCabinetUpper", "kitchenCabinetUpperDouble"),
    microwave: k("kitchenMicrowave"),
    toilet: k("toilet"),
    bath_sink: k("bathroomSink"),
    bathtub: k("bathtub"),
    shower: k("shower"),
    mirror: k("bathroomMirror"),
    desk: k("desk"),
    office_chair: k("chairDesk"),
    monitor: k("computerScreen"),
    keyboard: k("computerKeyboard"),
    washer: k("washer", "dryer"),
    shop_shelf: k("bookcaseOpen"),
    shop_counter: k("kitchenBar"),
    register: k("computerScreen"),
    bar_stool: k("stoolBar", "stoolBarSquare"),
    ceiling_lamp: k("lampSquareCeiling"),
    trash: k("trashcan"),
    boxes: k("cardboardBoxClosed", "cardboardBoxOpen"),
  };
};

const q = (name: string) => `rz.quaternius.${name}`;
const qc = (name: string) => `rz.quaternius-classic.${name}`;
const ph = (name: string) => `rz.polyhaven.${name}`;

const REALISTIC: Catalog = {
  bed_double: [q("Bed_King"), qc("Bed_Double")],
  bed_single: [q("Bed_Single"), qc("Bed_Twin")],
  nightstand: [q("Night_Stand"), q("Night_Stand_2"), q("Night_Stand_3"), qc("Night_Stand")],
  wardrobe: [qc("Closet")],
  dresser: [q("Drawer"), q("Drawer_5")],
  sofa: [ph("Sofa_01"), ph("sofa_02"), q("Couch_Medium"), q("Couch_Medium_2"), qc("Sofa_3")],
  armchair: [ph("modern_arm_chair_01"), ph("mid_century_lounge_chair"), ph("GreenChair_01")],
  coffee_table: [ph("coffee_table_round_01"), ph("CoffeeTable_01")],
  tv_stand: [q("Shelf_Small")],
  tv: ["rz.mob_tv"],
  rug: [q("Rug"), "rz.mob_rug"],
  floor_lamp: [q("Light_Stand")],
  table_lamp: [q("Table_Lamp"), q("Lamp")],
  plant: [ph("potted_plant_02"), q("Houseplant_3"), q("Houseplant_5")],
  bookcase: [ph("wooden_bookshelf_worn"), qc("Bookcase_with_Books"), q("Shelf_Large")],
  side_table: [ph("side_table_01"), ph("side_table_tall_01")],
  dining_table: [qc("Table_2"), qc("Table")],
  kitchen_table: [q("Table_Round_Small"), q("Table_Round_Small_2")],
  cafe_table: [q("Table_Round_Small"), q("Table_Round_Small_2")],
  chair: [ph("dining_chair_02"), q("Chair"), q("Chair_2")],
  counter: ["rz.mob_counter"],
  sink_counter: ["rz.mob_sink_counter"],
  stove: [q("Oven"), ph("electric_stove")],
  fridge: [q("Kitchen_Fridge")],
  upper_cabinet: ["rz.mob_upper_cabinet"],
  microwave: ["rz.mob_microwave"],
  toilet: [q("Toilet")],
  bath_sink: [q("Bathroom_Sink")],
  bathtub: [q("Bathtub")],
  shower: ["rz.mob_shower"],
  mirror: [ph("ornate_mirror_01")],
  desk: [qc("Desk")],
  office_chair: [qc("Office_Chair")],
  monitor: ["rz.mob_monitor"],
  keyboard: ["rz.mob_keyboard"],
  washer: [q("Washing_Machine")],
  shop_shelf: [ph("steel_frame_shelves_01")],
  shop_counter: ["rz.mob_shop_counter"],
  register: [ph("CashRegister_01")],
  bar_stool: [ph("bar_chair_round_01"), ph("metal_stool_01")],
  ceiling_lamp: [q("Light_Ceiling"), ph("modern_ceiling_lamp_01")],
  trash: [q("Trashcan_Small"), q("Trashcan_Small_2")],
  boxes: [ph("cardboard_box_01")],
  towel: [q("Towel_Rack")],
};

const ARCADE: Catalog = Object.fromEntries(
  (
    [
      "bed_double", "bed_single", "nightstand", "wardrobe", "dresser", "sofa", "armchair", "coffee_table", "tv_stand", "tv", "rug",
      "floor_lamp", "table_lamp", "plant", "bookcase", "side_table", "dining_table", "chair", "counter", "sink_counter", "stove",
      "fridge", "upper_cabinet", "microwave", "toilet", "bath_sink", "bathtub", "shower", "mirror", "desk", "office_chair",
      "monitor", "washer", "shop_shelf", "shop_counter", "register", "bar_stool", "ceiling_lamp", "trash", "cafe_table",
    ] as Item[]
  ).map((item) => [item, [`ar.mob_${item}`]]),
);
ARCADE.kitchen_table = ["ar.mob_cafe_table"];
ARCADE.cafe_table = ["ar.mob_cafe_table"];

export const INTERIOR_CATALOGS: Record<ArtStyle, Catalog> = {
  lowpoly: kenney("kit.furniture"),
  blocks: kenney("vx.mobilia"),
  realistic: REALISTIC,
  arcade: ARCADE,
};

/** Arcade furniture is painted, so each piece gets a bright color of its own. */
const ARCADE_PAINTS = PAINT_PALETTE.filter((color) => !["#f4f4f4", "#9aa0a8", "#3a3f47", "#121316", "#7a4a26"].includes(color));
const ARCADE_KEEP_COLOR = new Set<Item>(["toilet", "bathtub", "stove", "washer", "tv", "monitor", "office_chair", "shop_shelf", "keyboard"]);

export const WALL_COLORS: Record<ArtStyle, string[]> = {
  realistic: ["#ece6dc", "#e3e1dc", "#e8dccb", "#d5ddd2", "#d8e0e6", "#efe4d6"],
  lowpoly: ["#eadfcc", "#d9e4d6", "#e6d3c3", "#d6e0ea", "#efe6c8"],
  blocks: ["#e6dccb", "#d2dccd", "#e2cfbd", "#cfdae4", "#eadfb8"],
  arcade: ["#ffe3b0", "#c9f0e0", "#ffd0c4", "#d4e4ff", "#fff4d6", "#e8d4ff"],
};

// --- floor plans ---------------------------------------------------------------------------

interface RoomSpec {
  type: RoomType;
  weight: number;
  /** Narrowest width, in modules. */
  min: number;
}

interface Program {
  width: [number, number];
  depth: [number, number];
  /** Share of the depth that goes to the rooms along the front. */
  front: number;
  frontRooms: RoomSpec[];
  backRooms: RoomSpec[];
}

const spec = (type: RoomType, weight: number, min = 2): RoomSpec => ({ type, weight, min });

const PROGRAMS: Record<Exclude<InteriorKind, "room">, Record<"small" | "medium" | "large", Program>> = {
  house: {
    small: { width: [7, 8], depth: [6, 7], front: 0.55, frontRooms: [spec("living", 0.6, 3), spec("kitchen", 0.4, 2)], backRooms: [spec("bedroom", 0.62, 3), spec("bathroom", 0.38, 2)] },
    medium: { width: [9, 11], depth: [7, 9], front: 0.55, frontRooms: [spec("living", 0.6, 4), spec("kitchen", 0.4, 3)], backRooms: [spec("bedroom", 0.38, 3), spec("kids", 0.34, 3), spec("bathroom", 0.28, 2)] },
    large: {
      width: [13, 14],
      depth: [9, 10],
      front: 0.52,
      frontRooms: [spec("living", 0.45, 4), spec("dining", 0.25, 3), spec("kitchen", 0.3, 3)],
      backRooms: [spec("bedroom", 0.28, 3), spec("kids", 0.24, 3), spec("study", 0.2, 3), spec("bathroom", 0.14, 2), spec("laundry", 0.14, 2)],
    },
  },
  apartment: {
    small: { width: [6, 7], depth: [6, 6], front: 0.55, frontRooms: [spec("living", 0.62, 3), spec("kitchen", 0.38, 2)], backRooms: [spec("bedroom", 0.6, 3), spec("bathroom", 0.4, 2)] },
    medium: { width: [8, 9], depth: [7, 8], front: 0.55, frontRooms: [spec("living", 0.62, 4), spec("kitchen", 0.38, 2)], backRooms: [spec("bedroom", 0.4, 3), spec("kids", 0.35, 3), spec("bathroom", 0.25, 2)] },
    large: {
      width: [11, 12],
      depth: [8, 9],
      front: 0.55,
      frontRooms: [spec("living", 0.62, 4), spec("kitchen", 0.38, 3)],
      backRooms: [spec("bedroom", 0.32, 3), spec("kids", 0.27, 3), spec("bathroom", 0.18, 2), spec("study", 0.23, 3)],
    },
  },
  office: {
    small: { width: [8, 10], depth: [6, 7], front: 0.6, frontRooms: [spec("office", 1, 4)], backRooms: [spec("meeting", 0.55, 3), spec("pantry", 0.25, 2), spec("bathroom", 0.2, 2)] },
    medium: {
      width: [11, 13],
      depth: [8, 9],
      front: 0.6,
      frontRooms: [spec("reception", 0.3, 3), spec("office", 0.7, 5)],
      backRooms: [spec("meeting", 0.35, 3), spec("manager", 0.3, 3), spec("pantry", 0.2, 2), spec("bathroom", 0.15, 2)],
    },
    large: {
      width: [14, 16],
      depth: [10, 11],
      front: 0.62,
      frontRooms: [spec("reception", 0.25, 3), spec("office", 0.75, 6)],
      backRooms: [spec("meeting", 0.3, 4), spec("manager", 0.22, 3), spec("manager", 0.2, 3), spec("pantry", 0.15, 2), spec("bathroom", 0.13, 2)],
    },
  },
  shop: {
    small: { width: [6, 8], depth: [6, 8], front: 0.68, frontRooms: [spec("sales", 1, 5)], backRooms: [spec("storage", 0.62, 3), spec("bathroom", 0.38, 2)] },
    medium: { width: [9, 11], depth: [9, 10], front: 0.7, frontRooms: [spec("sales", 1, 6)], backRooms: [spec("storage", 0.62, 4), spec("bathroom", 0.38, 2)] },
    large: { width: [12, 14], depth: [11, 12], front: 0.72, frontRooms: [spec("sales", 1, 8)], backRooms: [spec("storage", 0.5, 4), spec("manager", 0.3, 3), spec("bathroom", 0.2, 2)] },
  },
  restaurant: {
    small: { width: [8, 9], depth: [7, 8], front: 0.62, frontRooms: [spec("hall", 1, 5)], backRooms: [spec("cookery", 0.65, 4), spec("bathroom", 0.35, 2)] },
    medium: { width: [10, 12], depth: [9, 10], front: 0.62, frontRooms: [spec("hall", 1, 6)], backRooms: [spec("cookery", 0.56, 4), spec("bathroom", 0.22, 2), spec("bathroom", 0.22, 2)] },
    large: {
      width: [13, 15],
      depth: [11, 12],
      front: 0.62,
      frontRooms: [spec("hall", 1, 8)],
      backRooms: [spec("cookery", 0.48, 5), spec("storage", 0.2, 2), spec("bathroom", 0.16, 2), spec("bathroom", 0.16, 2)],
    },
  },
};

const SINGLE_SIZES: Record<"small" | "medium" | "large", [number, number][]> = {
  small: [[3, 3], [4, 3]],
  medium: [[4, 4], [5, 4]],
  large: [[5, 5], [6, 5]],
};
const SMALL_ROOMS = new Set<RoomType>(["bathroom", "laundry", "pantry", "storage"]);

export interface Room {
  type: RoomType;
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

export type Opening = "wall" | "door" | "entrance" | "window" | "high" | "glass" | "open";

export interface Plan {
  width: number;
  depth: number;
  rooms: Room[];
  /** Openings by edge: `h:x:z` runs along X on line z, `v:x:z` along Z on line x. */
  openings: Map<string, Opening>;
}

/** Splits `total` modules by weight, giving every part at least its minimum. */
function split(total: number, specs: RoomSpec[]): number[] {
  const weight = specs.reduce((sum, item) => sum + item.weight, 0);
  const sizes = specs.map((item) => Math.max(item.min, Math.round((item.weight / weight) * total)));
  let diff = total - sizes.reduce((a, b) => a + b, 0);
  const indices = specs.map((_, index) => index);
  while (diff !== 0) {
    // A missing module goes to the room furthest below its share; an extra one leaves the room
    // with the most to spare.
    const index =
      diff > 0
        ? indices.reduce((best, i) => (sizes[i] / specs[i].weight < sizes[best] / specs[best].weight ? i : best))
        : indices.filter((i) => sizes[i] > specs[i].min).reduce((best, i) => (sizes[i] - specs[i].min > sizes[best] - specs[best].min ? i : best), indices.find((i) => sizes[i] > specs[i].min) ?? 0);
    sizes[index] += diff > 0 ? 1 : -1;
    diff += diff > 0 ? -1 : 1;
  }
  return sizes;
}

const HUBS: RoomType[] = ["living", "office", "sales", "hall", "reception", "dining", "kitchen"];
const WET: RoomType[] = ["bathroom", "laundry", "pantry", "storage", "cookery"];

function shared(a: Room, b: Room): { horizontal: boolean; line: number; from: number; to: number } | null {
  if (a.z1 === b.z0 || b.z1 === a.z0) {
    const from = Math.max(a.x0, b.x0);
    const to = Math.min(a.x1, b.x1);
    if (to - from >= 1) return { horizontal: true, line: a.z1 === b.z0 ? a.z1 : a.z0, from, to };
  }
  if (a.x1 === b.x0 || b.x1 === a.x0) {
    const from = Math.max(a.z0, b.z0);
    const to = Math.min(a.z1, b.z1);
    if (to - from >= 1) return { horizontal: false, line: a.x1 === b.x0 ? a.x1 : a.x0, from, to };
  }
  return null;
}

export const edgeKey = (horizontal: boolean, line: number, cell: number) => (horizontal ? `h:${cell}:${line}` : `v:${line}:${cell}`);

/** A cell along a run of edges for a door: off the corners when the run is long enough. */
function doorCell(rng: Rng, from: number, to: number): number {
  if (to - from >= 3) return rng.int(from + 1, to - 2);
  return rng.int(from, to - 1);
}

function makePlan(rng: Rng, kind: InteriorKind, size: "small" | "medium" | "large", single: RoomType): Plan {
  const openings = new Map<string, Opening>();
  if (kind === "room") {
    const [w, d] = SMALL_ROOMS.has(single)
      ? ({ small: [2, 2], medium: [3, 2], large: [3, 3] } as const)[size]
      : rng.fork("room size").pick(SINGLE_SIZES[size]);
    const room: Room = { type: single, x0: 0, z0: 0, x1: w, z1: d };
    const plan = { width: w, depth: d, rooms: [room], openings };
    openings.set(edgeKey(true, d, doorCell(rng.fork("entrance"), 0, w)), "door");
    addWindows(rng, plan);
    return plan;
  }

  const program = PROGRAMS[kind][size];
  const width = rng.fork("width").int(...program.width);
  const depth = rng.fork("depth").int(...program.depth);
  const backDepth = Math.max(3, Math.min(depth - 3, Math.round(depth * (1 - program.front))));
  const rooms: Room[] = [];

  // Bedrooms sit behind the living room and wet rooms behind the kitchen, on one side or the other.
  const mirror = rng.fork("mirror").chance(0.5);
  const lay = (specs: RoomSpec[], z0: number, z1: number) => {
    const sizes = split(width, specs);
    let x = 0;
    specs.forEach((item, index) => {
      const x0 = mirror ? width - x - sizes[index] : x;
      rooms.push({ type: item.type, x0, z0, x1: x0 + sizes[index], z1 });
      x += sizes[index];
    });
  };
  lay(program.backRooms, 0, backDepth);
  lay(program.frontRooms, backDepth, depth);
  const plan: Plan = { width, depth, rooms, openings };

  const front = rooms.filter((room) => room.z1 === depth);
  const back = rooms.filter((room) => room.z1 !== depth);

  // Between front rooms: open plan in apartments and from a living room into a dining room.
  for (let i = 0; i + 1 < front.length; i++) {
    const [a, b] = [front[i], front[i + 1]].sort((m, n) => m.x0 - n.x0);
    const edge = shared(a, b)!;
    const open = kind === "apartment" || (a.type === "living" && b.type === "dining") || (a.type === "dining" && b.type === "living");
    if (open) {
      for (let cell = edge.from + 1; cell < edge.to - (edge.to - edge.from > 3 ? 1 : 0); cell++) openings.set(edgeKey(edge.horizontal, edge.line, cell), "open");
    } else {
      openings.set(edgeKey(edge.horizontal, edge.line, doorCell(rng.fork(`door ${i}`), edge.from, edge.to)), "door");
    }
  }

  // Each back room opens into the front room it touches most, preferring the main rooms.
  back.forEach((room, index) => {
    const options = front
      .map((other) => ({ other, edge: shared(room, other) }))
      .filter((item): item is { other: Room; edge: NonNullable<ReturnType<typeof shared>> } => item.edge !== null)
      .sort((a, b) => {
        const rank = (r: Room) => (WET.includes(room.type) ? 0 : HUBS.indexOf(r.type) < 0 ? 9 : HUBS.indexOf(r.type));
        return rank(a.other) - rank(b.other) || (b.edge.to - b.edge.from) - (a.edge.to - a.edge.from);
      });
    const target = options[0];
    if (!target) return;
    openings.set(edgeKey(true, target.edge.line, doorCell(rng.fork(`back door ${index}`), target.edge.from, target.edge.to)), "door");
  });

  // The way in, on the front of the main room.
  const hub = [...front].sort((a, b) => HUBS.indexOf(a.type) - HUBS.indexOf(b.type))[0];
  const entrance = doorCell(rng.fork("entrance"), hub.x0, hub.x1);
  openings.set(edgeKey(true, depth, entrance), "entrance");
  if (kind === "shop" || kind === "restaurant") {
    for (let x = hub.x0 + 1; x < hub.x1 - 1; x++) if (x !== entrance) openings.set(edgeKey(true, depth, x), "glass");
  }
  addWindows(rng, plan);
  return plan;
}

/** Windows on outside walls: evenly spread, never next to a corner, small and high in bathrooms. */
function addWindows(rng: Rng, plan: Plan): void {
  plan.rooms.forEach((room, index) => {
    const sides: { horizontal: boolean; line: number; from: number; to: number }[] = [];
    if (room.z0 === 0) sides.push({ horizontal: true, line: 0, from: room.x0, to: room.x1 });
    if (room.z1 === plan.depth) sides.push({ horizontal: true, line: plan.depth, from: room.x0, to: room.x1 });
    // A shop or a restaurant shows itself on the street; its sides are blind walls for shelves.
    const blindSides = room.type === "sales" || room.type === "hall";
    if (room.x0 === 0 && !blindSides) sides.push({ horizontal: false, line: 0, from: room.z0, to: room.z1 });
    if (room.x1 === plan.width && !blindSides) sides.push({ horizontal: false, line: plan.width, from: room.z0, to: room.z1 });
    const free = (side: (typeof sides)[number], cell: number) => !plan.openings.has(edgeKey(side.horizontal, side.line, cell));
    if (room.type === "bathroom" || room.type === "storage" || room.type === "laundry") {
      const side = rng.fork(`high ${index}`).pick(sides);
      const cell = Math.floor((side.from + side.to - 1) / 2);
      if (free(side, cell)) plan.openings.set(edgeKey(side.horizontal, side.line, cell), "high");
      return;
    }
    for (const side of sides) {
      const length = side.to - side.from;
      const cells: number[] = [];
      if (room.type === "office" || room.type === "hall" || room.type === "sales") {
        for (let c = side.from + 1; c < side.to - 1; c++) cells.push(c);
      } else {
        const count = Math.max(1, Math.floor((length - 1) / 2.5));
        for (let i = 0; i < count; i++) cells.push(Math.floor(side.from + ((i + 1) * length) / (count + 1) - 0.5 + 0.0001));
      }
      for (const cell of cells) {
        if (cell < side.from || cell >= side.to || !free(side, cell)) continue;
        if (length >= 3 && (cell === side.from || cell === side.to - 1)) continue;
        plan.openings.set(edgeKey(side.horizontal, side.line, cell), "window");
      }
    }
  });
}

// --- building the shell --------------------------------------------------------------------

const WET_FLOORS: RoomType[] = ["bathroom", "kitchen", "laundry", "pantry", "cookery"];

function defaultFloor(type: RoomType): FloorKind {
  if (WET_FLOORS.includes(type)) return type === "cookery" ? "checker" : "tile";
  if (type === "office" || type === "meeting" || type === "manager" || type === "reception") return "carpet";
  if (type === "sales" || type === "storage" || type === "hall") return type === "hall" ? "wood" : "concrete";
  return "wood";
}

class Builder {
  constructor(
    private asm: Assembler,
    readonly plan: Plan,
    readonly style: ArtStyle,
  ) {}

  /** Plan coordinates have the outside corner at 0; the model is centered on the origin. */
  world(x: number, y: number, z: number): Vec3 {
    return [x - this.plan.width / 2, y, z - this.plan.depth / 2];
  }

  add(block: string, x: number, y: number, z: number, yawSteps = 0, color?: string) {
    return this.asm.add(block, this.world(x, y, z), { yawSteps, ...(color ? { color } : {}) });
  }

  /** Takes back a part, when a room tries another arrangement. */
  remove(part: AssembledPart): void {
    const index = this.asm.parts.indexOf(part);
    if (index >= 0) this.asm.parts.splice(index, 1);
  }
}

function roomAt(plan: Plan, x: number, z: number): number {
  if (x < 0 || z < 0 || x >= plan.width || z >= plan.depth) return -1;
  return plan.rooms.findIndex((room) => x >= room.x0 && x < room.x1 && z >= room.z0 && z < room.z1);
}

/** Every wall edge of the plan, with what fills it. */
function walls(plan: Plan): { key: string; horizontal: boolean; line: number; cell: number; kind: Opening }[] {
  const out: { key: string; horizontal: boolean; line: number; cell: number; kind: Opening }[] = [];
  for (let z = 0; z <= plan.depth; z++) {
    for (let x = 0; x < plan.width; x++) {
      if (roomAt(plan, x, z - 1) === roomAt(plan, x, z)) continue;
      const key = edgeKey(true, z, x);
      out.push({ key, horizontal: true, line: z, cell: x, kind: plan.openings.get(key) ?? "wall" });
    }
  }
  for (let x = 0; x <= plan.width; x++) {
    for (let z = 0; z < plan.depth; z++) {
      if (roomAt(plan, x - 1, z) === roomAt(plan, x, z)) continue;
      const key = edgeKey(false, x, z);
      out.push({ key, horizontal: false, line: x, cell: z, kind: plan.openings.get(key) ?? "wall" });
    }
  }
  return out;
}

function buildShell(builder: Builder, options: { wall: string; floor?: FloorKind; ceiling: boolean; doors: boolean; kind: InteriorKind }): void {
  const { plan, style } = builder;
  const p = SHELL_PREFIX[style];

  for (const room of plan.rooms) {
    const kind = options.floor && !WET_FLOORS.includes(room.type) ? options.floor : defaultFloor(room.type);
    for (let x = room.x0; x < room.x1; x++) {
      for (let z = room.z0; z < room.z1; z++) builder.add(`${p}.int_floor_${kind}`, x + 0.5, 0, z + 0.5);
    }
  }

  const edges = walls(plan);
  const solid = new Set(edges.filter((edge) => edge.kind !== "open").map((edge) => edge.key));
  const glassDoor = options.kind === "shop" || options.kind === "restaurant" || options.kind === "office";
  for (const edge of edges) {
    if (edge.kind === "open") continue;
    const block = {
      wall: "int_wall",
      door: "int_wall_door",
      entrance: "int_wall_door",
      window: "int_wall_window",
      high: "int_wall_window_high",
      glass: "int_wall_glass",
    }[edge.kind];
    const [x, z] = edge.horizontal ? [edge.cell + 0.5, edge.line] : [edge.line, edge.cell + 0.5];
    const yaw = edge.horizontal ? 0 : 1;
    builder.add(`${p}.${block}`, x, 0, z, yaw, options.wall);
    if (options.doors && (edge.kind === "door" || edge.kind === "entrance")) {
      builder.add(`${p}.${edge.kind === "entrance" && glassDoor ? "int_door_glass" : "int_door"}`, x, 0, z, yaw);
    }
  }

  // Posts fill the corners where walls meet or end; a straight run needs none.
  for (let x = 0; x <= plan.width; x++) {
    for (let z = 0; z <= plan.depth; z++) {
      const left = solid.has(edgeKey(true, z, x - 1));
      const right = solid.has(edgeKey(true, z, x));
      const down = solid.has(edgeKey(false, x, z - 1));
      const up = solid.has(edgeKey(false, x, z));
      const count = [left, right, down, up].filter(Boolean).length;
      if (count === 0 || (count === 2 && ((left && right) || (up && down)))) continue;
      builder.add(`${p}.int_post`, x, 0, z, 0, options.wall);
    }
  }

  if (options.ceiling) {
    for (let x = 0; x < plan.width; x++) for (let z = 0; z < plan.depth; z++) builder.add(`${p}.int_ceiling`, x + 0.5, ROOM_HEIGHT, z + 0.5);
  }
}

// --- furnishing ----------------------------------------------------------------------------

interface Rect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

type Side = "N" | "S" | "W" | "E";
/** Quarter turns that make a piece face into the room from each wall. */
const SIDE_YAW: Record<Side, number> = { N: 0, S: 2, W: 1, E: 3 };

interface Placed {
  block: string;
  rect: Rect;
  yaw: number;
  /** Heights of the bottom and the top. */
  bottom: number;
  top: number;
  side?: Side;
  part?: AssembledPart;
}

interface Bounds {
  min: Vec3;
  max: Vec3;
}

/**
 * Imported furniture carries its bounds in the catalog, so it is measured without decoding its
 * mesh: the generator then works before (and without) the model packs being loaded.
 */
function storedBounds(def: BlockDef): Bounds | null {
  const pieces = def.shape.kind === "compound" ? def.shape.pieces : [{ shape: def.shape }];
  if (!pieces.every((piece) => piece.shape.kind === "model" && !("at" in piece) && !("rot" in piece) && !("scale" in piece))) return null;
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const { shape } of pieces) {
    if (shape.kind !== "model") continue;
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], shape.min[axis]);
      max[axis] = Math.max(max[axis], shape.max[axis]);
    }
  }
  return { min, max };
}

const boundsCache = new Map<string, Bounds>();
function boundsOf(block: string): Bounds {
  let bounds = boundsCache.get(block);
  if (!bounds) {
    const def = getBlock(block);
    const box = storedBounds(def) ? null : blockBounds(def);
    bounds = storedBounds(def) ?? { min: box!.min.toArray(), max: box!.max.toArray() };
    boundsCache.set(block, bounds);
  }
  return bounds;
}

/** The footprint of a block turned by quarter turns, relative to its origin. */
function turned(bounds: Bounds, yaw: number): Rect {
  const [x0, , z0] = bounds.min;
  const [x1, , z1] = bounds.max;
  switch (((yaw % 4) + 4) % 4) {
    case 1:
      return { x0: z0, x1: z1, z0: -x1, z1: -x0 };
    case 2:
      return { x0: -x1, x1: -x0, z0: -z1, z1: -z0 };
    case 3:
      return { x0: -z1, x1: -z0, z0: x0, z1: x1 };
    default:
      return { x0, x1, z0, z1 };
  }
}

const overlaps = (a: Rect, b: Rect, margin = 0.005) => a.x0 < b.x1 - margin && b.x0 < a.x1 - margin && a.z0 < b.z1 - margin && b.z0 < a.z1 - margin;

interface WallOptions {
  y?: number;
  gap?: number;
  hanging?: boolean;
  colored?: boolean;
  from?: number;
  within?: [number, number];
}

interface AtOptions {
  y?: number;
  ignore?: Placed[];
  check?: boolean;
  colored?: boolean;
}

interface SideInfo {
  side: Side;
  /** Along-wall run of the inner face, in plan coordinates. */
  from: number;
  to: number;
  /** Plan coordinate of the inner face. */
  face: number;
  horizontal: boolean;
  cells: { cell: number; kind: Opening }[];
}

class RoomFurnisher {
  readonly placed: Placed[] = [];
  readonly clear: Rect[] = [];
  private calls = 0;
  readonly sides: SideInfo[];
  readonly inner: Rect;

  constructor(
    private builder: Builder,
    readonly rng: Rng,
    readonly room: Room,
    private catalog: Catalog,
    thickness: number,
    private paint: (block: string) => string | undefined,
  ) {
    const t = thickness / 2 + 0.01;
    this.inner = { x0: room.x0 + t, z0: room.z0 + t, x1: room.x1 - t, z1: room.z1 - t };
    const plan = builder.plan;
    const cellsOf = (horizontal: boolean, line: number, from: number, to: number) => {
      const cells: { cell: number; kind: Opening }[] = [];
      for (let c = from; c < to; c++) cells.push({ cell: c, kind: plan.openings.get(edgeKey(horizontal, line, c)) ?? "wall" });
      return cells;
    };
    this.sides = [
      { side: "N", from: this.inner.x0, to: this.inner.x1, face: this.inner.z0, horizontal: true, cells: cellsOf(true, room.z0, room.x0, room.x1) },
      { side: "S", from: this.inner.x0, to: this.inner.x1, face: this.inner.z1, horizontal: true, cells: cellsOf(true, room.z1, room.x0, room.x1) },
      { side: "W", from: this.inner.z0, to: this.inner.z1, face: this.inner.x0, horizontal: false, cells: cellsOf(false, room.x0, room.z0, room.z1) },
      { side: "E", from: this.inner.z0, to: this.inner.z1, face: this.inner.x1, horizontal: false, cells: cellsOf(false, room.x1, room.z0, room.z1) },
    ];
    // Keep the way through every door clear on this side.
    for (const info of this.sides) {
      for (const { cell, kind } of info.cells) {
        if (kind !== "door" && kind !== "entrance" && kind !== "open") continue;
        this.clear.push(this.wallRect(info, cell + 0.04, cell + 0.96, 0.85));
      }
    }
  }

  /** A rectangle against a wall, from `a` to `b` along it and `depth` into the room. */
  private wallRect(info: SideInfo, a: number, b: number, depth: number, gap = 0): Rect {
    const inward = info.side === "N" || info.side === "W" ? 1 : -1;
    const near = info.face + inward * gap;
    const far = near + inward * depth;
    const [c0, c1] = [Math.min(near, far), Math.max(near, far)];
    return info.horizontal ? { x0: a, x1: b, z0: c0, z1: c1 } : { x0: c0, x1: c1, z0: a, z1: b };
  }

  pick(item: Item): string | null {
    return this.candidates(item)[0] ?? null;
  }

  /** The block drawn for an item, then the other models of it, for when the first one doesn't fit. */
  candidates(item: Item | string): string[] {
    if (item.includes(".")) return [item];
    const list = (this.catalog[item as Item] ?? []).filter((id) => hasBlock(id));
    if (list.length === 0) return [];
    const first = this.rng.fork(item).pick(list);
    return [first, ...list.filter((id) => id !== first)];
  }

  /** Whether a footprint is inside the room and clear of doors and of pieces at the same height. */
  private free(rect: Rect, bottom: number, top: number, ignore: Placed[] = []): boolean {
    const r = this.inner;
    if (rect.x0 < r.x0 - 0.001 || rect.z0 < r.z0 - 0.001 || rect.x1 > r.x1 + 0.001 || rect.z1 > r.z1 + 0.001) return false;
    if (bottom < 2.1 && this.clear.some((zone) => overlaps(zone, rect))) return false;
    return !this.placed.some((item) => !ignore.includes(item) && item.bottom < top - 0.01 && bottom < item.top - 0.01 && overlaps(item.rect, rect));
  }

  /** Whether a piece this tall would cover a window or door along a wall. */
  private blocksOpening(info: SideInfo, a: number, b: number, height: number, hanging = false): boolean {
    return info.cells.some(({ cell, kind }) => {
      const covered = a < cell + 0.92 && b > cell + 0.08;
      if (!covered) return false;
      // A sofa's back may reach the sill; anything taller would cover the glass.
      if (kind === "window") return hanging || height > 1.0;
      if (kind === "high") return hanging || height > 1.7;
      if (kind === "glass") return height > 0.1;
      return kind !== "wall";
    });
  }

  /** Puts the piece in the room at a footprint, turned by quarter turns. */
  private put(block: string, rect: Rect, yaw: number, y: number, side?: Side, colored = true): Placed {
    const bounds = boundsOf(block);
    const local = turned(bounds, yaw);
    const x = rect.x0 - local.x0;
    const z = rect.z0 - local.z0;
    const part = this.builder.add(block, x, y - bounds.min[1], z, yaw, colored ? this.paint(block) : undefined);
    const placed = { block, rect, yaw, bottom: y, top: y + bounds.max[1] - bounds.min[1], side, part };
    this.placed.push(placed);
    return placed;
  }

  remove(placed: Placed): void {
    if (placed.part) this.builder.remove(placed.part);
    this.placed.splice(this.placed.indexOf(placed), 1);
  }

  /**
   * Stands a piece against a wall, facing into the room. `prefer` picks between the spots
   * that fit: the middle of the wall, one of its ends, or the spot nearest to `near`.
   */
  againstWall(
    item: Item | string,
    sides: Side[],
    prefer: "center" | "start" | "end" | "random" | { near: number } = "random",
    options: WallOptions = {},
  ): Placed | null {
    for (const block of this.candidates(item)) {
      const placed = this.blockAgainstWall(block, sides, prefer, options);
      if (placed) return placed;
    }
    return null;
  }

  private blockAgainstWall(block: string, sides: Side[], prefer: "center" | "start" | "end" | "random" | { near: number }, options: WallOptions): Placed | null {
    const bounds = boundsOf(block);
    const width = bounds.max[0] - bounds.min[0];
    const depth = bounds.max[2] - bounds.min[2];
    const height = bounds.max[1] - bounds.min[1];
    const y = options.y ?? FLOOR_TOP;
    const gap = options.gap ?? 0.01;
    for (const side of sides) {
      const info = this.sides.find((candidate) => candidate.side === side)!;
      const start = Math.max(info.from, options.from ?? -Infinity);
      const candidates: number[] = [];
      for (let a = start; a + width <= info.to + 0.0001; a += 0.05) candidates.push(a);
      // The exact spot asked for, which the 5 cm steps may miss.
      if (typeof prefer === "object") candidates.push(Math.min(Math.max(prefer.near - width / 2, start), info.to - width));
      const spots: number[] = [];
      for (const a of candidates) {
        const center = a + width / 2;
        if (options.within && (center < options.within[0] || center > options.within[1])) continue;
        const rect = this.wallRect(info, a, a + width, depth, gap);
        if (!this.free(rect, y, y + height)) continue;
        if (this.blocksOpening(info, a, a + width, y - FLOOR_TOP + height, options.hanging)) continue;
        spots.push(a);
      }
      if (spots.length === 0) continue;
      const middle = (info.from + info.to - width) / 2;
      let a: number;
      if (prefer === "center") a = spots.reduce((best, s) => (Math.abs(s - middle) < Math.abs(best - middle) ? s : best));
      else if (prefer === "start") a = spots[0];
      else if (prefer === "end") a = spots[spots.length - 1];
      else if (prefer === "random") a = this.rng.fork(`${block} ${side}`).pick(spots);
      else {
        const target = prefer.near - width / 2;
        a = spots.reduce((best, s) => (Math.abs(s - target) < Math.abs(best - target) ? s : best));
      }
      return this.put(block, this.wallRect(info, a, a + width, depth, gap), SIDE_YAW[side], y, side, options.colored);
    }
    return null;
  }

  /** A piece standing free, centered on a point, turned by quarter turns. */
  at(item: Item | string, x: number, z: number, yaw: number, options: AtOptions = {}): Placed | null {
    for (const block of this.candidates(item)) {
      const placed = this.blockAt(block, x, z, yaw, options);
      if (placed) return placed;
    }
    return null;
  }

  private blockAt(block: string, x: number, z: number, yaw: number, options: AtOptions): Placed | null {
    const local = turned(boundsOf(block), yaw);
    const w = local.x1 - local.x0;
    const d = local.z1 - local.z0;
    const rect = { x0: x - w / 2, x1: x + w / 2, z0: z - d / 2, z1: z + d / 2 };
    const bounds = boundsOf(block);
    const y = options.y ?? FLOOR_TOP;
    if (options.check !== false && !this.free(rect, y, y + bounds.max[1] - bounds.min[1], options.ignore)) return null;
    return this.put(block, rect, yaw, y, undefined, options.colored);
  }

  /** On top of another piece, in its middle, facing the same way. */
  onTop(host: Placed | null, item: Item, shift = 0): Placed | null {
    if (!host) return null;
    const block = this.pick(item);
    if (!block) return null;
    const local = turned(boundsOf(block), host.yaw);
    const w = local.x1 - local.x0;
    const d = local.z1 - local.z0;
    const cx = (host.rect.x0 + host.rect.x1) / 2 + (host.yaw % 2 === 0 ? shift : 0);
    const cz = (host.rect.z0 + host.rect.z1) / 2 + (host.yaw % 2 === 1 ? shift : 0);
    const rect = { x0: cx - w / 2, x1: cx + w / 2, z0: cz - d / 2, z1: cz + d / 2 };
    const bounds = boundsOf(block);
    this.builder.add(block, rect.x0 - local.x0, host.top - bounds.min[1], rect.z0 - local.z0, host.yaw, this.paint(block));
    const placed = { block, rect, yaw: host.yaw, bottom: host.top, top: host.top + bounds.max[1] - bounds.min[1], side: host.side };
    this.placed.push(placed);
    return placed;
  }

  /** A point in front of a piece standing against a wall, `distance` from its front. */
  inFront(host: Placed, distance: number): [number, number] {
    const cx = (host.rect.x0 + host.rect.x1) / 2;
    const cz = (host.rect.z0 + host.rect.z1) / 2;
    switch (host.side) {
      case "N":
        return [cx, host.rect.z1 + distance];
      case "S":
        return [cx, host.rect.z0 - distance];
      case "W":
        return [host.rect.x1 + distance, cz];
      default:
        return [host.rect.x0 - distance, cz];
    }
  }

  /** The wall facing a side. */
  static opposite(side: Side): Side {
    return ({ N: "S", S: "N", W: "E", E: "W" } as const)[side];
  }

  /** Sides ordered from the longest stretch of plain wall to the shortest. */
  wallsByRun(): Side[] {
    const run = (info: SideInfo) => {
      let best = 0;
      let current = 0;
      for (const { kind } of info.cells) {
        current = kind === "wall" ? current + 1 : 0;
        best = Math.max(best, current);
      }
      return best;
    };
    return [...this.sides].sort((a, b) => run(b) - run(a) || this.rng.fork(a.side).next() - 0.5).map(({ side }) => side);
  }

  /** Free corners of the room, for plants and lamps. */
  corner(item: Item): Placed | null {
    // Each call draws again, and only a spot right in a corner counts, so two plants end up in
    // different corners instead of side by side.
    const draw = this.rng.fork(`${item} corner ${this.calls++}`);
    const sides = [...(["N", "S", "W", "E"] as Side[])].sort(() => draw.next() - 0.5);
    for (const side of sides) {
      const info = this.sides.find((candidate) => candidate.side === side)!;
      for (const end of draw.chance(0.5) ? (["start", "end"] as const) : (["end", "start"] as const)) {
        const within: [number, number] = end === "start" ? [info.from, info.from + 0.6] : [info.to - 0.6, info.to];
        const placed = this.againstWall(item, [side], end, { colored: true, within });
        if (placed) return placed;
      }
    }
    return null;
  }

  /** A table in the middle of the free floor with chairs around it. */
  diningSet(chairs: number, around?: Rect, item: Item = "dining_table"): Placed | null {
    const area = around ?? this.inner;
    const cx = (area.x0 + area.x1) / 2;
    const cz = (area.z0 + area.z1) / 2;
    const long = area.x1 - area.x0 >= area.z1 - area.z0;
    const block = this.pick(item) ?? this.pick("dining_table");
    if (!block) return null;
    const b = boundsOf(block);
    const alongX = b.max[0] - b.min[0] >= b.max[2] - b.min[2];
    const yaw = alongX === long ? 0 : 1;
    const table = this.atNear(block, cx, cz, yaw, 1.6);
    if (!table) return null;
    this.chairsAround(table, chairs);
    return table;
  }

  /**
   * Chairs facing a table, half tucked under it: along the long sides of a long table, one on
   * each side of a round or square one.
   */
  chairsAround(table: Placed, chairs: number): void {
    const chair = this.pick("chair");
    if (!chair) return;
    const cb = boundsOf(chair);
    const chairDepth = cb.max[2] - cb.min[2];
    const w = table.rect.x1 - table.rect.x0;
    const d = table.rect.z1 - table.rect.z0;
    const cx = (table.rect.x0 + table.rect.x1) / 2;
    const cz = (table.rect.z0 + table.rect.z1) / 2;
    const tuck = chairDepth * 0.25;
    if (Math.max(w, d) / Math.min(w, d) < 1.3) {
      this.at(chair, cx, table.rect.z0 - tuck, 0, { ignore: [table] });
      this.at(chair, cx, table.rect.z1 + tuck, 2, { ignore: [table] });
      if (chairs > 2) {
        this.at(chair, table.rect.x0 - tuck, cz, 1, { ignore: [table] });
        this.at(chair, table.rect.x1 + tuck, cz, 3, { ignore: [table] });
      }
      return;
    }
    const long = w >= d;
    const length = long ? w : d;
    const perSide = Math.max(1, Math.min(3, Math.floor(length / 0.62), Math.ceil(chairs / 2)));
    for (let side = 0; side < 2; side++) {
      for (let i = 0; i < perSide; i++) {
        const along = ((i + 0.5) / perSide - 0.5) * length;
        if (long) this.at(chair, cx + along, side === 0 ? table.rect.z0 - tuck : table.rect.z1 + tuck, side === 0 ? 0 : 2, { ignore: [table] });
        else this.at(chair, side === 0 ? table.rect.x0 - tuck : table.rect.x1 + tuck, cz + along, side === 0 ? 1 : 3, { ignore: [table] });
      }
    }
  }

  /** Like `at`, but moves the piece around the point until it finds free floor. */
  atNear(item: Item | string, x: number, z: number, yaw: number, reach: number): Placed | null {
    for (let ring = 0; ring <= reach + 0.001; ring += 0.1) {
      const steps = ring === 0 ? 1 : Math.ceil((ring * Math.PI * 2) / 0.1);
      for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const placed = this.at(item, x + Math.cos(angle) * ring, z + Math.sin(angle) * ring, yaw);
        if (placed) return placed;
      }
    }
    return null;
  }

  rug(x: number, z: number, yaw: number): void {
    const block = this.pick("rug");
    if (!block) return;
    const local = turned(boundsOf(block), yaw);
    const w = local.x1 - local.x0;
    const d = local.z1 - local.z0;
    const r = this.inner;
    if (x - w / 2 < r.x0 || x + w / 2 > r.x1 || z - d / 2 < r.z0 || z + d / 2 > r.z1) return;
    const bounds = boundsOf(block);
    // Rugs lie under everything, so they don't take up floor space.
    this.builder.add(block, x - w / 2 - local.x0, FLOOR_TOP - bounds.min[1], z - d / 2 - local.z0, yaw, this.paint(block));
  }

  ceilingLamp(): void {
    const block = this.pick("ceiling_lamp");
    if (!block) return;
    const bounds = boundsOf(block);
    const x = (this.inner.x0 + this.inner.x1) / 2;
    const z = (this.inner.z0 + this.inner.z1) / 2;
    this.builder.add(block, x - (bounds.min[0] + bounds.max[0]) / 2, ROOM_HEIGHT - bounds.max[1], z - (bounds.min[2] + bounds.max[2]) / 2, 0, this.paint(block));
  }

  /** Hangs a piece on the wall above another, like a mirror over a sink. */
  above(host: Placed | null, item: Item, bottom: number): void {
    if (!host?.side) return;
    const info = this.sides.find(({ side }) => side === host.side)!;
    const center = info.horizontal ? (host.rect.x0 + host.rect.x1) / 2 : (host.rect.z0 + host.rect.z1) / 2;
    // Right above the piece or nowhere: a cabinet that slides over the stove looks wrong.
    this.againstWall(item, [host.side], { near: center }, { y: FLOOR_TOP + bottom, hanging: true, within: [center - 0.08, center + 0.08] });
  }
}

type Amount = "basic" | "full";

/** Homes get a shower or a bathtub; shops, offices and restaurants only a toilet and a sink. */
const HOMES: InteriorKind[] = ["house", "apartment", "room"];

const FURNISH: Record<RoomType, (f: RoomFurnisher, amount: Amount, kind: InteriorKind) => void> = {
  living(f, amount) {
    const sides = f.wallsByRun();
    // The sofa goes on the first wall that leaves room for the TV on the wall it faces.
    let sofa: Placed | null = null;
    let stand: Placed | null = null;
    for (const side of sides) {
      sofa = f.againstWall("sofa", [side], "center");
      if (!sofa) continue;
      const center = side === "N" || side === "S" ? (sofa.rect.x0 + sofa.rect.x1) / 2 : (sofa.rect.z0 + sofa.rect.z1) / 2;
      stand = f.againstWall("tv_stand", [RoomFurnisher.opposite(side)], { near: center });
      if (stand) break;
      f.remove(sofa);
      sofa = null;
    }
    sofa ??= f.againstWall("sofa", sides, "center");
    if (sofa?.side) {
      const center = sofa.side === "N" || sofa.side === "S" ? (sofa.rect.x0 + sofa.rect.x1) / 2 : (sofa.rect.z0 + sofa.rect.z1) / 2;
      f.onTop(stand, "tv");
      const [x, z] = f.inFront(sofa, 0.62);
      f.rug(...f.inFront(sofa, 0.75), SIDE_YAW[sofa.side]);
      f.atNear("coffee_table", x, z, SIDE_YAW[sofa.side] % 2, 0.3);
      const side = f.againstWall("side_table", [sofa.side], { near: center + 1.4 });
      f.onTop(side, "table_lamp");
    }
    f.againstWall("armchair", sides.slice(1), "random");
    f.corner("plant");
    if (amount === "full") {
      f.corner("floor_lamp");
      f.againstWall("bookcase", sides.slice(1), "random");
      f.corner("plant");
    }
  },
  bedroom(f, amount) {
    const sides = f.wallsByRun();
    const bed = f.againstWall("bed_double", sides, "center");
    if (bed?.side) {
      const center = bed.side === "N" || bed.side === "S" ? (bed.rect.x0 + bed.rect.x1) / 2 : (bed.rect.z0 + bed.rect.z1) / 2;
      const half = (bed.side === "N" || bed.side === "S" ? bed.rect.x1 - bed.rect.x0 : bed.rect.z1 - bed.rect.z0) / 2;
      for (const s of [-1, 1]) {
        const stand = f.againstWall("nightstand", [bed.side], { near: center + s * (half + 0.3) });
        f.onTop(stand, "table_lamp");
      }
    }
    f.againstWall("wardrobe", sides.slice(1), "start");
    if (amount === "full") {
      f.againstWall("dresser", sides.slice(1), "random");
      f.corner("plant");
      if (bed) f.rug(...f.inFront(bed, -0.4), SIDE_YAW[bed.side!] % 2);
    }
  },
  kids(f, amount) {
    const sides = f.wallsByRun();
    f.againstWall("bed_single", sides, "start");
    const desk = f.againstWall("desk", sides.slice(1), "random");
    if (desk) f.at("chair", ...f.inFront(desk, 0.12), (SIDE_YAW[desk.side!] + 2) % 4, { ignore: [desk] });
    f.againstWall("wardrobe", sides, "end");
    if (amount === "full") {
      f.againstWall("bookcase", sides.slice(1), "random");
      const r = f.inner;
      f.rug((r.x0 + r.x1) / 2, (r.z0 + r.z1) / 2, 0);
    }
  },
  kitchen(f, amount) {
    const sides = f.wallsByRun();
    const run: Item[] = ["fridge", "counter", "sink_counter", "counter", "stove", "counter", "counter"];
    let side = sides[0];
    let from = -Infinity;
    for (const item of run) {
      let placed = f.againstWall(item, [side], "start", { from, colored: item !== "fridge" && item !== "stove" });
      if (!placed && item !== "counter") placed = f.againstWall(item, sides.filter((s) => s !== side), "start");
      if (!placed) continue;
      if (placed.side === side) from = side === "N" || side === "S" ? placed.rect.x1 : placed.rect.z1;
      else side = placed.side!;
      if (item === "counter" || item === "sink_counter") f.above(placed, "upper_cabinet", 1.45);
      if (item === "counter" && amount === "full" && f.rng.chance(0.4)) f.onTop(placed, "microwave");
    }
    const r = f.inner;
    if (r.x1 - r.x0 >= 2.6 && r.z1 - r.z0 >= 2.6) f.diningSet(4, undefined, "kitchen_table");
    if (amount === "full") f.corner("trash");
  },
  dining(f, amount) {
    f.diningSet(6);
    f.againstWall("dresser", f.wallsByRun(), "center");
    if (amount === "full") {
      f.corner("plant");
      f.corner("plant");
    }
  },
  bathroom(f, _amount, kind) {
    const sides = f.wallsByRun();
    const r = f.inner;
    const roomy = r.x1 - r.x0 >= 1.8 && r.z1 - r.z0 >= 1.8;
    // A toilet and a sink first, on different walls when there is room; then a shower or a
    // bathtub in a home, whichever fits.
    const toilet = f.againstWall("toilet", sides, "end");
    const others = toilet?.side ? [...sides.filter((side) => side !== toilet.side), toilet.side] : sides;
    const sink = f.againstWall("bath_sink", others, "center");
    f.above(sink, "mirror", 1.15);
    if (HOMES.includes(kind)) {
      const order: Item[] = roomy && f.rng.chance(0.5) ? ["bathtub", "shower"] : ["shower", "bathtub"];
      for (const item of order) if (f.againstWall(item, sides, "start") ?? f.againstWall(item, sides, "end")) break;
    } else {
      f.againstWall("trash", sides, "start");
    }
  },
  study(f, amount) {
    const sides = f.wallsByRun();
    const desk = f.againstWall("desk", sides, "center");
    f.onTop(desk, "monitor");
    if (desk) f.at("office_chair", ...f.inFront(desk, 0.22), (SIDE_YAW[desk.side!] + 2) % 4, { ignore: [desk] });
    f.againstWall("bookcase", sides.slice(1), "random");
    if (amount === "full") {
      f.againstWall("bookcase", sides.slice(1), "random");
      f.corner("plant");
    }
  },
  laundry(f, amount) {
    const sides = f.wallsByRun();
    const washer = f.againstWall("washer", sides, "start");
    if (washer) f.againstWall("washer", [washer.side!], "start");
    f.againstWall("sink_counter", sides, "random");
    if (amount === "full") f.againstWall("bookcase", sides.slice(1), "random");
  },
  storage(f) {
    const sides = f.wallsByRun();
    for (const side of sides) {
      for (let i = 0; i < 4; i++) if (!f.againstWall("shop_shelf", [side], "start")) break;
    }
    for (let i = 0; i < 4; i++) {
      const r = f.inner;
      f.at("boxes", f.rng.range(r.x0 + 0.4, r.x1 - 0.4), f.rng.range(r.z0 + 0.4, r.z1 - 0.4), f.rng.int(0, 3));
    }
  },
  office(f, amount) {
    // Rows of desks facing each other in the middle, with room to walk around them.
    const r = f.inner;
    const desk = f.pick("desk");
    if (desk) {
      const b = boundsOf(desk);
      const w = b.max[0] - b.min[0];
      const d = b.max[2] - b.min[2];
      const cols = Math.max(1, Math.floor((r.x1 - r.x0 - 1.6) / (w + 0.1)));
      const rows = Math.max(1, Math.floor((r.z1 - r.z0 - 2.2) / (d * 2 + 1.8)));
      for (let row = 0; row < rows; row++) {
        // The first row leaves room for the doors of the rooms behind and for the chairs.
        const cz = r.z0 + 1.6 + d + row * (d * 2 + 1.8);
        for (let col = 0; col < cols; col++) {
          const cx = r.x0 + 0.8 + w / 2 + col * (w + 0.1) + ((r.x1 - r.x0 - 1.6) - cols * (w + 0.1)) / 2;
          // Two desks back to back: one faces +Z, the other -Z, each with its chair in front.
          for (const yaw of [0, 2]) {
            const z = yaw === 0 ? cz + d / 2 : cz - d / 2;
            const placed = f.at(desk, cx, z, yaw);
            if (!placed) continue;
            f.onTop(placed, "monitor");
            const chairZ = yaw === 0 ? placed.rect.z1 + 0.22 : placed.rect.z0 - 0.22;
            f.at("office_chair", cx, chairZ, (yaw + 2) % 4, { ignore: [placed] });
          }
        }
      }
    }
    const sides = f.wallsByRun();
    f.againstWall("bookcase", sides, "start");
    f.corner("plant");
    if (amount === "full") {
      f.againstWall("bookcase", sides, "end");
      f.corner("plant");
    }
  },
  meeting(f, amount) {
    f.diningSet(8);
    const sides = f.wallsByRun();
    const stand = f.againstWall("tv_stand", sides, "center");
    f.onTop(stand, "tv");
    if (amount === "full") f.corner("plant");
  },
  manager(f, amount, kind) {
    FURNISH.study(f, amount, kind);
    f.againstWall("armchair", f.wallsByRun(), "random");
  },
  reception(f, amount) {
    const sides = f.wallsByRun();
    const counter = f.againstWall("shop_counter", sides, "center", { gap: 0.9 });
    f.onTop(counter, "monitor");
    f.againstWall("sofa", sides.slice(1), "random");
    f.corner("plant");
    if (amount === "full") {
      f.againstWall("armchair", sides.slice(1), "random");
      f.corner("plant");
    }
  },
  pantry(f, amount) {
    const sides = f.wallsByRun();
    const sink = f.againstWall("sink_counter", sides, "start");
    f.above(sink, "upper_cabinet", 1.45);
    const counter = f.againstWall("counter", sides, "start");
    f.onTop(counter, "microwave");
    f.againstWall("fridge", sides, "end", { colored: false });
    if (amount === "full") f.corner("trash");
  },
  sales(f, amount) {
    const r = f.inner;
    const sides = f.wallsByRun();
    // Shelves along the walls, rows of shelves in the middle, the till by the door.
    // The till stands on a side wall by the shop window, near the way in.
    const till = f.againstWall("shop_counter", ["W", "E"], "end", { gap: 0.4 });
    f.onTop(till, "register");
    for (const side of sides.filter((s) => s !== "S")) {
      for (let i = 0; i < 8; i++) if (!f.againstWall(amount === "full" ? "shop_shelf" : "bookcase", [side], "start")) break;
    }
    const shelf = f.pick("shop_shelf");
    if (shelf) {
      const b = boundsOf(shelf);
      const w = b.max[0] - b.min[0];
      const d = b.max[2] - b.min[2];
      for (let z = r.z0 + 1.8 + d; z < r.z1 - 1.6; z += d * 2 + 1.3) {
        for (let x = r.x0 + 1.4 + w / 2; x < r.x1 - 1.4 - w / 2 + 0.001; x += w) {
          f.at(shelf, x, z, 0);
          f.at(shelf, x, z + d, 2);
        }
      }
    }
    f.corner("plant");
  },
  hall(f, amount) {
    const r = f.inner;
    // The bar runs along a side wall at the back, with room behind it for whoever serves.
    const bar = f.againstWall("shop_counter", ["W", "E"], "start", { gap: 0.9 });
    if (bar?.side) {
      const [from, to] = [bar.rect.z0, bar.rect.z1];
      for (let i = 0; i < Math.floor((to - from) / 0.55); i++) {
        const [x] = f.inFront(bar, 0.3);
        f.at("bar_stool", x, from + 0.3 + i * 0.55, (SIDE_YAW[bar.side] + 2) % 4, { ignore: [bar] });
      }
    }
    // Tables for four on a grid over the free floor, with room to walk between them.
    const table = f.pick("cafe_table");
    const chair = f.pick("chair");
    if (table && chair) {
      const tb = boundsOf(table);
      const cb = boundsOf(chair);
      const chairDepth = cb.max[2] - cb.min[2];
      const stepX = tb.max[0] - tb.min[0] + chairDepth * 1.5 + 0.6;
      const stepZ = tb.max[2] - tb.min[2] + chairDepth * 1.5 + 0.6;
      const columns = Math.max(1, Math.floor((r.x1 - r.x0) / stepX));
      const rows = Math.max(1, Math.floor((r.z1 - r.z0 - 0.4) / stepZ));
      const left = (r.x0 + r.x1) / 2 - ((columns - 1) * stepX) / 2;
      const top = (r.z0 + r.z1) / 2 - ((rows - 1) * stepZ) / 2;
      for (let row = 0; row < rows; row++) {
        for (let col = 0; col < columns; col++) {
          const placed = f.atNear(table, left + col * stepX, top + row * stepZ, 0, 0.3);
          if (placed) f.chairsAround(placed, 4);
        }
      }
    }
    f.corner("plant");
    if (amount === "full") f.corner("plant");
  },
  cookery(f, amount) {
    const sides = f.wallsByRun();
    const run: Item[] = ["fridge", "fridge", "counter", "stove", "stove", "counter", "sink_counter", "counter", "counter"];
    for (const side of sides.slice(0, 2)) {
      let from = -Infinity;
      for (const item of run) {
        const placed = f.againstWall(item, [side], "start", { from, colored: item === "counter" || item === "sink_counter" });
        if (!placed) continue;
        from = side === "N" || side === "S" ? placed.rect.x1 : placed.rect.z1;
        if (item === "counter" || item === "sink_counter") f.above(placed, "upper_cabinet", 1.45);
      }
    }
    if (amount === "full") f.corner("trash");
  },
};

export function buildInterior(asm: Assembler, rng: Rng, options: InteriorOptions = {}): void {
  const style = options.style ?? "realistic";
  const kind = (chosen(options.kind) ?? rng.fork("kind").pick(["house", "house", "apartment", "office", "shop", "restaurant"])) as InteriorKind;
  const size = (chosen(options.size) ?? rng.fork("size").pick(["small", "medium", "medium", "large"])) as "small" | "medium" | "large";
  const single = (chosen(options.room) ?? rng.fork("room").pick(SINGLE_ROOMS)) as RoomType;
  const plan = makePlan(rng.fork("plan"), kind, size, single);
  const builder = new Builder(asm, plan, style);

  const wall = chosen(options.wall) ?? rng.fork("wall color").pick(WALL_COLORS[style]);
  const ceiling = chosen(options.ceiling) ? options.ceiling === "yes" : rng.fork("ceiling").chance(0.3);
  const doors = chosen(options.doors) ? options.doors === "yes" : rng.fork("doors").chance(0.85);
  const amount = (chosen(options.furniture) ?? rng.fork("furniture").pick(["basic", "full", "full"])) as Amount | "none";
  const floor = chosen(options.floor) as FloorKind | undefined;
  buildShell(builder, { wall, floor, ceiling, doors, kind });

  if (amount === "none") return;
  const catalog = INTERIOR_CATALOGS[style];
  const paints = rng.fork("paints");
  plan.rooms.forEach((room, index) => {
    const roomRng = rng.fork(`room ${index}`);
    const furnisher = new RoomFurnisher(builder, roomRng, room, catalog, SHELL_THICKNESS[style], (block) =>
      style === "arcade" && !ARCADE_KEEP_COLOR.has(block.replace(/^ar\.mob_/, "") as Item) ? paints.pick(ARCADE_PAINTS) : undefined,
    );
    FURNISH[room.type](furnisher, amount, kind);
    if (ceiling || amount === "full") furnisher.ceilingLamp();
  });
}

/** For tests and agents: the plan the generator would build, without building it. */
export function planInterior(seed: Rng, kind: InteriorKind, size: "small" | "medium" | "large", room: RoomType = "living") {
  return makePlan(seed.fork("plan"), kind, size, room);
}
