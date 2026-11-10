import type { BlockDef, BlockFinish, Primitive, ShapePiece, SocketDef, Vec3 } from "../../types.ts";
import { BAKED_ASSETS } from "./baked.generated.ts";

// Vehicles modeled in Blender (tools/blender/build_vehicles.py). Each comes in four bakes: the full
// Realista model, the toy Arcade one (shorter, rounder, bigger wheels), a low poly one with flat
// faces and one made of blocks. A model is split into zones: some have a fixed look, like chrome or
// tires, and the others become layers the person can paint.

export const WHEEL_RADIUS = 0.28;
export const WHEEL_WIDTH = 0.24;

export interface Axle {
  /** Position along the length. */
  z: number;
  radius: number;
  /** Half of the distance between the two wheels. */
  x: number;
  /** Two tires on each side, as behind the cab of a truck. */
  dual?: boolean;
}

export interface VehicleSpec {
  name: string;
  group: "car" | "truck" | "bus" | "semi" | "moto";
  axles: Axle[];
  /** The Arcade version is shorter and has bigger wheels, so its axles are elsewhere. */
  arcadeAxles?: Axle[];
  arcadeTrailerAxles?: Axle[];
  /** The wheel that suits the model. */
  wheel?: string;
  /** Semis: what is pulled and what pulls it. */
  trailer?: string;
  tractor?: string;
  trailerAxles?: Axle[];
}

interface Variant {
  /** Zone name to [byte offset, vertices, indices] in the pack. */
  zones: Record<string, [number, number, number]>;
  min: Vec3;
  max: Vec3;
  /** A bake with its own proportions brings its own axles and sockets. */
  axles?: Axle[];
  sockets?: SocketDef[];
  king?: SocketDef;
  /** Wheels: how wide the tire is, in the units of the wheel. */
  width?: number;
}

export interface BakedAsset extends Variant {
  id: string;
  name: string;
  group: "wheel" | "car" | "truck" | "bus" | "tractor" | "trailer" | "moto" | "kart" | "part";
  wheel?: string | null;
  axles: Axle[];
  sockets: SocketDef[];
  /** Trailers hang from this socket instead of standing on the ground. */
  king?: SocketDef;
  /** Karts: scale of the front and rear wheels. */
  kart?: { front: number; rear: number };
  /** Parts whose main block has no `_base` in the name. */
  plain?: boolean;
  /** Zones that take the color of the main block. */
  tint?: string[];
  /** The accent zone is called a stripe on this part. */
  stripe?: boolean;
  lp: Variant;
  vx: Variant;
  /** The toy version used by the Arcade style. Karts and their parts already are one. */
  ar?: Variant;
}

const FIXED: Record<string, { color: string; finish?: BlockFinish }> = {
  chrome: { color: "#dfe3e8", finish: "metal" },
  steel: { color: "#8d939c", finish: "metal" },
  dark_metal: { color: "#2a2d33", finish: "metal" },
  carbon: { color: "#14161a", finish: "gloss" },
  rubber: { color: "#1b1c1f" },
  plastic: { color: "#25272c" },
  seat: { color: "#23252b" },
  cabin: { color: "#34363c" },
  glass: { color: "#10202c", finish: "gloss" },
  visor: { color: "#0b0f16", finish: "glass" },
  glove: { color: "#23252b" },
  light: { color: "#fff4d0", finish: "glow" },
  tail: { color: "#e22636", finish: "glow" },
  amber: { color: "#ffa61a", finish: "glow" },
  red: { color: "#e02f3a", finish: "glow" },
  blue: { color: "#2f6fe0", finish: "glow" },
  white: { color: "#f1f0ea" },
  plate: { color: "#f4f4ee" },
  wood: { color: "#8a5a34" },
  dirt: { color: "#7c5f40" },
};

interface Layer {
  zone: string;
  suffix: string;
  label: string;
  color: string;
}

const LAYERS: Layer[] = [
  { zone: "paint", suffix: "paint", label: "pintura", color: "#e8202a" },
  { zone: "trim", suffix: "trim", label: "faixas", color: "#f4f4f4" },
  { zone: "accent", suffix: "accent", label: "detalhes", color: "#ffc400" },
  { zone: "rim", suffix: "rim", label: "aros", color: "#9aa0a8" },
];

const GROUND: SocketDef[] = [{ id: "ground", p: [0, 0, 0], n: [0, -1, 0] }];

type Look = { color?: string; finish?: BlockFinish };

/** How one art style uses the bakes. */
interface Bake {
  prefix: string;
  variant(asset: BakedAsset): Variant;
  /** Colors only, with no shine: the simpler styles read better this way. */
  flat: boolean;
  paint?: BlockFinish;
  /** Fixed zones that look different in this style. */
  looks?: Record<string, Look>;
}

/** In Realista the lamps are off, as in daylight, and the tinted glass lets the cabin show. */
const REAL_LOOKS: Record<string, Look> = {
  glass: { finish: "tint" },
  light: { color: "#d9dee4", finish: "metal" },
  tail: { color: "#9c1522", finish: "gloss" },
  amber: { color: "#d97c16", finish: "gloss" },
  red: { color: "#b3151f", finish: "gloss" },
  blue: { color: "#1d4fb8", finish: "gloss" },
};

const BAKES: Bake[] = [
  { prefix: "ar", variant: (asset) => asset.ar ?? asset, flat: false, paint: "gloss" },
  { prefix: "rz", variant: (asset) => asset, flat: false, paint: "paint", looks: REAL_LOOKS },
  { prefix: "lp", variant: (asset) => asset.lp, flat: true },
  { prefix: "vx", variant: (asset) => asset.vx, flat: true },
];

function piece(variant: Variant, zone: string, look: Pick<ShapePiece, "color" | "finish">): ShapePiece {
  const [offset, vertices, indices] = variant.zones[zone];
  const shape: Primitive = { kind: "baked", offset, vertices, indices, min: variant.min, max: variant.max };
  return { shape, ...look };
}

const compound = (pieces: ShapePiece[]) => ({ kind: "compound" as const, pieces });

function fixedPieces(variant: Variant, bake: Bake): ShapePiece[] {
  return Object.keys(variant.zones)
    .filter((zone) => FIXED[zone])
    .map((zone) => {
      const { color, finish } = { ...FIXED[zone], ...bake.looks?.[zone] };
      return piece(variant, zone, { color, finish: bake.flat && finish !== "glow" ? undefined : finish });
    });
}

function layerBlocks(id: string, name: string, variant: Variant, bake: Bake, skip: string[] = [], rename: Record<string, string> = {}): BlockDef[] {
  return LAYERS.filter(({ zone }) => variant.zones[zone] && !skip.includes(zone)).map(
    (layer): BlockDef => ({
      id: `${id}_${rename[layer.zone] ?? layer.suffix}`,
      name: `${name}: ${layer.label}`,
      category: "vehicle",
      color: layer.color,
      shape: compound([piece(variant, layer.zone, { finish: layer.zone === "rim" && !bake.flat ? "metal" : bake.paint })]),
      sockets: GROUND,
      upright: true,
    }),
  );
}

function axleSockets(axles: Axle[]): SocketDef[] {
  return axles.flatMap((axle, index) => {
    const halfWidth = (WHEEL_WIDTH * axle.radius) / WHEEL_RADIUS / 2;
    return ([["l", 1], ["r", -1]] as const).map(([side, sign]) => ({
      id: `wheel_${index}_${side}`,
      p: [sign * (axle.x - halfWidth), axle.radius, axle.z] as Vec3,
      n: [sign, 0, 0] as Vec3,
    }));
  });
}

function vehicleBlocks(asset: BakedAsset, bake: Bake): BlockDef[] {
  const variant = bake.variant(asset);
  const id = `${bake.prefix}.${asset.group === "kart" ? "kart" : "veh"}_${asset.id}`;
  const king = variant.king ?? asset.king;
  const sockets = variant.sockets ?? asset.sockets;
  const base: BlockDef = {
    id: `${id}_base`,
    name: asset.name,
    category: "vehicle",
    color: "#2a2d33",
    shape: compound(fixedPieces(variant, bake)),
    sockets: asset.group === "kart" ? asset.sockets : [...(king ? [king] : GROUND), ...axleSockets(variant.axles ?? asset.axles), ...sockets],
    upright: true,
  };
  return [base, ...layerBlocks(id, asset.name, variant, bake)];
}

function partBlocks(asset: BakedAsset, bake: Bake): BlockDef[] {
  const variant = bake.variant(asset);
  const id = `${bake.prefix}.${asset.id}`;
  const tint = (asset.tint ?? []).filter((zone) => variant.zones[zone]);
  const base: BlockDef = {
    id: asset.plain ? id : `${id}_base`,
    name: asset.name,
    category: "vehicle",
    color: "#f4f4f4",
    shape: compound([...fixedPieces(variant, bake), ...tint.map((zone) => piece(variant, zone, { finish: bake.paint }))]),
    sockets: asset.sockets,
  };
  return [base, ...layerBlocks(id, asset.name, variant, bake, tint, asset.stripe ? { accent: "stripe" } : {})];
}

function wheelBlocks(asset: BakedAsset, bake: Bake): BlockDef[] {
  const variant = bake.variant(asset);
  const id = `${bake.prefix}.wheel_${asset.id}`;
  const rimLook: Pick<ShapePiece, "finish"> = { finish: bake.flat ? undefined : "metal" };
  const rim: BlockDef = {
    id: `${id}_rim`,
    name: `Roda ${asset.name}`,
    category: "wheel",
    color: "#9aa0a8",
    shape: compound([...fixedPieces(variant, bake), ...(variant.zones.rim ? [piece(variant, "rim", rimLook)] : [])]),
    sockets: [
      { id: "axle", p: [0, 0, 0], n: [0, 1, 0] },
      { id: "hub", p: [0, -WHEEL_WIDTH, 0], n: [0, -1, 0] },
    ],
  };
  if (!variant.zones.band) return [rim];
  const band: BlockDef = {
    id: `${id}_band`,
    name: `Roda ${asset.name}: filete`,
    category: "wheel",
    color: "#ffc400",
    shape: compound([piece(variant, "band", { finish: bake.paint })]),
    sockets: GROUND,
  };
  return [rim, band];
}

function blocksOf(asset: BakedAsset, bake: Bake): BlockDef[] {
  if (asset.group === "wheel") return wheelBlocks(asset, bake);
  return asset.group === "part" ? partBlocks(asset, bake) : vehicleBlocks(asset, bake);
}

export const bakedBlocks: BlockDef[] = BAKES.flatMap((bake) => BAKED_ASSETS.flatMap((asset) => blocksOf(asset, bake)));

const ofGroup = (group: BakedAsset["group"]) => BAKED_ASSETS.filter((asset) => asset.group === group);
const named = (assets: BakedAsset[], prefix = "") => Object.fromEntries(assets.map(({ id, name }) => [id.slice(prefix.length), name]));

export const BAKED_WHEEL_IDS = ofGroup("wheel").map(({ id }) => id);
/** Tire width of each Realista wheel, in the units of the wheel, for the space between dual tires. */
export const BAKED_WHEEL_WIDTH: Record<string, number> = Object.fromEntries(ofGroup("wheel").map(({ id, width }) => [id, width ?? WHEEL_WIDTH]));
export const BAKED_WHEEL_NAMES: Record<string, string> = named(ofGroup("wheel"));

export const KART_IDS = ofGroup("kart").map(({ id }) => id);
export const KART_NAMES: Record<string, string> = named(ofGroup("kart"));
export const KART_SCALES: Record<string, { front: number; rear: number }> = Object.fromEntries(ofGroup("kart").map(({ id, kart }) => [id, kart!]));

const parts = (prefix: string) => ofGroup("part").filter(({ id }) => id.startsWith(prefix));
export const KART_SPOILERS: Record<string, string> = named(parts("kart_spoiler_"), "kart_spoiler_");
export const KART_HELMETS: Record<string, string> = named(parts("kart_helmet_"), "kart_helmet_");

/** Every model a person can pick, by the id used in the generator options. */
export const BAKED_SPECS: Record<string, VehicleSpec> = {};

for (const asset of [...ofGroup("car"), ...ofGroup("truck"), ...ofGroup("bus"), ...ofGroup("moto")]) {
  BAKED_SPECS[asset.id] = { name: asset.name, group: asset.group as VehicleSpec["group"], axles: asset.axles, arcadeAxles: asset.ar?.axles, wheel: asset.wheel ?? undefined };
}

const TRACTOR_LABELS: Record<string, string> = { cavalo: "", cavalo_bicudo: " com cavalo bicudo" };

for (const trailer of ofGroup("trailer")) {
  for (const tractor of ofGroup("tractor")) {
    BAKED_SPECS[tractor.id === "cavalo" ? trailer.id : `${trailer.id}_bicudo`] = {
      name: `${trailer.name}${TRACTOR_LABELS[tractor.id]}`,
      group: "semi",
      axles: tractor.axles,
      arcadeAxles: tractor.ar?.axles,
      wheel: tractor.wheel ?? undefined,
      trailer: trailer.id,
      tractor: tractor.id,
      trailerAxles: trailer.axles,
      arcadeTrailerAxles: trailer.ar?.axles,
    };
  }
}

export const bakedModels = (group: VehicleSpec["group"]) => Object.keys(BAKED_SPECS).filter((id) => BAKED_SPECS[id].group === group);
