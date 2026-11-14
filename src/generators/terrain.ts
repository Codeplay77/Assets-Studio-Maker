import type { ArtStyle } from "../blocks/styles";
import type { Finish, GeneratedShape, ShapeMaterial, Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import { buildTree } from "./buildings";
import { KIT_BOULDERS, KIT_BUSHES_ONLY, KIT_CACTI, KIT_FLOWERS, KIT_ROCKS, KIT_STUMPS, KIT_TUFTS } from "./kit";
import { REAL_PROPS, realBlocks } from "./realNature";
import type { Rng } from "./rng";

// Maps for games: one continuous piece of ground, with relief, water and plants, and no buildings.

// The editor's limits for one shape.
const MOST_VERTICES = 19000;
const MOST_FACES = 19000;

interface Palette {
  grass: string;
  forest: string;
  dry: string;
  sand: string;
  dirt: string;
  rock: string;
  snow: string;
  water: string;
  bed: string;
}

const TEMPERATE: Palette = { grass: "#62a142", forest: "#3f7c3a", dry: "#a1ab52", sand: "#dcc78b", dirt: "#80613f", rock: "#808085", snow: "#eff3f6", water: "#3f90cb", bed: "#6d6a58" };
const DESERT: Palette = { grass: "#cfae66", forest: "#b99452", dry: "#ddb872", sand: "#e7cc8e", dirt: "#a67c4a", rock: "#a8714b", snow: "#ecdcbc", water: "#3fa0b2", bed: "#b89a62" };
const FROZEN: Palette = { grass: "#e2e9f0", forest: "#ccd8e1", dry: "#eff3f7", sand: "#bccad5", dirt: "#9ca9b3", rock: "#707b86", snow: "#f8fbfd", water: "#a9d9ed", bed: "#90a6b4" };
const SWAMP: Palette = { grass: "#5c7c3c", forest: "#415c31", dry: "#707c42", sand: "#6c6242", dirt: "#514832", rock: "#61645a", snow: "#d0d9d0", water: "#4c6c4c", bed: "#414131" };
const ASH: Palette = { grass: "#4c4642", forest: "#3c3734", dry: "#59524c", sand: "#312d2c", dirt: "#3c312c", rock: "#312e2e", snow: "#8c8782", water: "#ff6a1a", bed: "#201c1c" };

interface Biome {
  palette: Palette;
  /** Height of the rolling ground and of the mountains, in meters. */
  hills: number;
  mountains: number;
  /** How much of the map the mountains take, from 0 to 1. */
  coverage: number;
  /** Mountains around the border, the way a zone of an online game is closed. */
  edge: number;
  /** Ground level over the water. */
  lift: number;
  forest: number;
  trees: string[];
  snowLine: number;
  /** Chance of rivers and lakes when the person leaves it open. */
  rivers: number;
  lakes: number;
  island?: boolean;
  scattered?: boolean;
  dunes?: boolean;
  mesas?: boolean;
  volcano?: boolean;
  flowers?: boolean;
  cacti?: boolean;
  /** Nothing soft grows here. */
  barren?: boolean;
}

const BIOMES: Record<string, Biome> = {
  floresta: { palette: TEMPERATE, hills: 6, mountains: 15, coverage: 0.22, edge: 0.55, lift: 2.4, forest: 0.72, trees: ["leafy", "leafy", "pine"], snowLine: 40, rivers: 0.8, lakes: 0.6 },
  montanhas: { palette: TEMPERATE, hills: 9, mountains: 46, coverage: 0.62, edge: 0.45, lift: 3, forest: 0.32, trees: ["pine", "pine", "leafy"], snowLine: 41, rivers: 0.5, lakes: 0.4 },
  planicie: { palette: TEMPERATE, hills: 3.4, mountains: 5, coverage: 0.08, edge: 0.15, lift: 2, forest: 0.14, trees: ["leafy"], snowLine: 99, rivers: 0.7, lakes: 0.5, flowers: true },
  vale: { palette: TEMPERATE, hills: 4, mountains: 40, coverage: 0.06, edge: 1, lift: 2.2, forest: 0.46, trees: ["leafy", "pine"], snowLine: 30, rivers: 0.9, lakes: 0.5 },
  ilha: { palette: TEMPERATE, hills: 6, mountains: 14, coverage: 0.2, edge: 0, lift: 4, forest: 0.4, trees: ["palm", "palm", "leafy"], snowLine: 99, rivers: 0.3, lakes: 1, island: true },
  arquipelago: { palette: TEMPERATE, hills: 4, mountains: 6, coverage: 0.14, edge: 0, lift: 1, forest: 0.36, trees: ["palm", "leafy"], snowLine: 99, rivers: 0, lakes: 1, scattered: true },
  deserto: { palette: DESERT, hills: 4, mountains: 20, coverage: 0.18, edge: 0.45, lift: 3, forest: 0.03, trees: ["palm"], snowLine: 99, rivers: 0.1, lakes: 0.25, dunes: true, mesas: true, cacti: true, barren: true },
  neve: { palette: FROZEN, hills: 7, mountains: 32, coverage: 0.4, edge: 0.55, lift: 2.6, forest: 0.34, trees: ["pine"], snowLine: 9, rivers: 0.4, lakes: 0.6 },
  pantano: { palette: SWAMP, hills: 1.5, mountains: 3, coverage: 0.05, edge: 0.1, lift: 0.5, forest: 0.42, trees: ["dead", "leafy"], snowLine: 99, rivers: 0.8, lakes: 1 },
  vulcao: { palette: ASH, hills: 5, mountains: 12, coverage: 0.15, edge: 0.25, lift: 2.5, forest: 0.05, trees: ["dead"], snowLine: 99, rivers: 0.5, lakes: 0.6, volcano: true, barren: true },
};

export const MAP_BIOMES = Object.keys(BIOMES);

const RELIEF: Record<string, number> = { soft: 0.55, medium: 1, rough: 1.6 };
const VEGETATION: Record<string, number> = { none: 0, low: 0.45, medium: 1, dense: 1.8 };

/** How far apart the corners of the ground are, in meters, and how many of them fit. */
const GRIDS: Record<ArtStyle, { cell: number; cells: number }> = {
  lowpoly: { cell: 3.5, cells: 9000 },
  realistic: { cell: 1.6, cells: 17000 },
  arcade: { cell: 2, cells: 17000 },
  blocks: { cell: 2, cells: 9000 },
};

const MOST_TREES: Record<ArtStyle, number> = { lowpoly: 900, realistic: 500, arcade: 500, blocks: 900 };
const MOST_SPOTS = 2600;
const TREE_SPACING = 5.5;

const clamp = (value: number, low = 0, high = 1) => Math.min(high, Math.max(low, value));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function smoothstep(low: number, high: number, value: number): number {
  const t = clamp((value - low) / (high - low));
  return t * t * (3 - 2 * t);
}

/** Gradient noise, so hills and forests have a natural shape and repeat with the seed. */
class Noise {
  private readonly table = new Uint8Array(512);

  constructor(rng: Rng) {
    const values = Array.from({ length: 256 }, (_, index) => index);
    for (let i = 255; i > 0; i--) {
      const j = rng.int(0, i);
      [values[i], values[j]] = [values[j], values[i]];
    }
    for (let i = 0; i < 512; i++) this.table[i] = values[i & 255];
  }

  private gradient(hash: number, x: number, y: number): number {
    const u = hash & 4 ? y : x;
    const v = hash & 4 ? x : y;
    return (hash & 1 ? -u : u) + (hash & 2 ? -2 * v : 2 * v);
  }

  at(x: number, y: number): number {
    const cellX = Math.floor(x);
    const cellY = Math.floor(y);
    const fx = x - cellX;
    const fy = y - cellY;
    const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
    const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
    const { table } = this;
    const a = table[cellX & 255] + (cellY & 255);
    const b = table[(cellX & 255) + 1] + (cellY & 255);
    const low = lerp(this.gradient(table[a], fx, fy), this.gradient(table[b], fx - 1, fy), u);
    const high = lerp(this.gradient(table[a + 1], fx, fy - 1), this.gradient(table[b + 1], fx - 1, fy - 1), u);
    return lerp(low, high, v) * 0.5;
  }

  /** Several sizes of bumps on top of each other, from -1 to 1. */
  layered(x: number, y: number, octaves: number): number {
    let sum = 0;
    let total = 0;
    let amplitude = 1;
    let frequency = 1;
    for (let i = 0; i < octaves; i++) {
      sum += this.at(x * frequency, y * frequency) * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2.03;
    }
    return sum / total;
  }

  /** Sharp crests, for mountain ranges, from 0 to 1. */
  ridged(x: number, y: number, octaves: number): number {
    let sum = 0;
    let total = 0;
    let amplitude = 0.5;
    let frequency = 1;
    let weight = 1;
    for (let i = 0; i < octaves; i++) {
      let crest = 1 - Math.abs(this.at(x * frequency, y * frequency));
      crest *= crest * weight;
      weight = clamp(crest * 2);
      sum += crest * amplitude;
      total += amplitude;
      amplitude *= 0.5;
      frequency *= 2.1;
    }
    return sum / total;
  }
}

export interface MapOptions {
  style?: ArtStyle;
  biome?: string;
  width?: string;
  length?: string;
  relief?: string;
  vegetation?: string;
  water?: string;
  rocks?: string;
  trails?: string;
}

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

/** Everything about the land: where it rises, where the water is and what grows there. */
class Land {
  readonly noise: Record<"hills" | "range" | "crest" | "river" | "islands" | "dunes" | "forest" | "dry" | "trail", Noise>;
  readonly lavaLevel: number;
  /** Taller relief keeps its snow on the peaks. */
  readonly snowLine: number;
  private readonly craterRadius: number;

  constructor(
    rng: Rng,
    readonly biome: Biome,
    readonly width: number,
    readonly length: number,
    readonly relief: number,
    readonly rivers: boolean,
    readonly lakes: boolean,
    readonly trails: boolean,
  ) {
    const make = (label: string) => new Noise(rng.fork(label));
    this.noise = { hills: make("hills"), range: make("range"), crest: make("crest"), river: make("river"), islands: make("islands"), dunes: make("dunes"), forest: make("forest"), dry: make("dry"), trail: make("trail") };
    this.snowLine = biome.snowLine * relief;
    this.craterRadius = 0.12 * Math.min(width, length);
    this.lavaLevel = this.coneHeight(0.12) - 2.5;
  }

  private coneHeight(radius: number): number {
    return this.biome.lift + 46 * this.relief * Math.pow(Math.max(0, 1 - radius / 0.56), 1.7);
  }

  /** From 0 in the open to 1 in the middle of a mountain range. */
  mountainness(x: number, z: number): number {
    const { biome, noise, width, length } = this;
    const range = (noise.range.layered(x / 190, z / 190, 3) + 1) / 2;
    const inner = smoothstep(1 - biome.coverage - 0.1, 1 - biome.coverage + 0.14, range);
    const border = Math.max(Math.abs(x) / (width / 2), Math.abs(z) / (length / 2));
    return Math.max(inner, smoothstep(0.6, 1.02, border) * biome.edge);
  }

  /** Ground height, in meters over the sea. */
  height(x: number, z: number): number {
    const { biome, noise, relief, width, length } = this;
    const mountains = this.mountainness(x, z);
    let h = biome.lift + noise.hills.layered(x / 70, z / 70, 4) * biome.hills * relief;
    h += mountains * noise.crest.ridged(x / 85, z / 85, 5) * biome.mountains * relief;

    if (biome.mesas && mountains > 0.05) {
      const step = 7;
      const level = Math.floor(h / step);
      h = lerp(h, (level + smoothstep(0.3, 0.7, h / step - level)) * step, 0.85);
    }
    if (biome.dunes) h += (noise.dunes.ridged((x + z * 0.3) / 34, z / 80, 2) - 0.45) * 5 * relief * (1 - mountains);

    if (biome.island) {
      const radius = Math.hypot(x / (width / 2), z / (length / 2));
      h += (1 - radius) * 7 - smoothstep(0.55, 0.98, radius) * 16;
    }
    if (biome.scattered) h = (noise.islands.layered(x / 46, z / 46, 3) - 0.04) * 30 + noise.hills.layered(x / 30, z / 30, 3) * 1.5 * relief;

    let lavaBowl = 0;
    const radius = Math.hypot(x, z) / Math.min(width, length);
    if (biome.volcano) {
      h = Math.max(h, 0) + Math.max(0, this.coneHeight(radius) - biome.lift);
      lavaBowl = smoothstep(0.12, 0.07, radius);
      h = lerp(h, this.lavaLevel - 2, lavaBowl);
    }

    // Without lakes nothing may dip under the water. Crater lava has its own level.
    if (!this.lakes && !lavaBowl) h = Math.max(h, 0.7);

    if (this.rivers) {
      const distance = Math.abs(noise.river.layered(x / 150, z / 150, 2));
      const clear = biome.volcano ? smoothstep(0.32, 0.5, radius) : 1;
      const channel = (1 - smoothstep(0.012, 0.075, distance)) * (1 - smoothstep(0.25, 0.7, mountains)) * clear;
      h = lerp(h, Math.min(h, -1.3), channel);
    }
    return h;
  }

  /** The level of the water, or of the lava in a crater. */
  waterLevel(x: number, z: number): number {
    if (this.biome.volcano && Math.hypot(x, z) < this.craterRadius) return this.lavaLevel;
    return 0;
  }

  /** From 0 to 1: the forests are where this is above the threshold. */
  woodland(x: number, z: number): number {
    return clamp(0.5 + this.noise.forest.layered(x / 48, z / 48, 3) * 0.95);
  }

  isForest(x: number, z: number, amount: number): boolean {
    return this.woodland(x, z) > 1 - clamp(amount);
  }

  isTrail(x: number, z: number, slope: number): boolean {
    if (!this.trails || slope < 0.9) return false;
    return Math.abs(this.noise.trail.layered(x / 110, z / 110, 2)) < 0.012;
  }
}

const Zone = { grass: 0, forest: 1, dry: 2, sand: 3, dirt: 4, rock: 5, snow: 6, bed: 7, water: 8, side: 9 } as const;
type ZoneId = (typeof Zone)[keyof typeof Zone];

/** What the ground is made of at a point. `slope` is 1 when flat and falls as it gets steeper. */
function zoneAt(land: Land, x: number, z: number, height: number, slope: number, amount: number, peak = height): ZoneId {
  const level = land.waterLevel(x, z);
  if (height < level - 0.05) return Zone.bed;
  if (land.biome.volcano && level > 0) return Zone.rock;
  // `peak` is the highest corner of a face, so a beach does not climb the bank in spikes.
  if (peak < level + 0.8 && (land.lakes || land.rivers)) return Zone.sand;
  if (slope < 0.72 && height > level + 2) return Zone.rock;
  if (height > land.snowLine + land.noise.dry.at(x / 13, z / 13) * 4) return Zone.snow;
  if (land.isTrail(x, z, slope)) return Zone.dirt;
  if (land.isForest(x, z, amount)) return Zone.forest;
  return land.noise.dry.layered(x / 60, z / 60, 2) > 0.22 ? Zone.dry : Zone.grass;
}

function adjust(hex: string, saturation: number, brightness: number): string {
  const channels = [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  const gray = channels.reduce((sum, value) => sum + value, 0) / 3;
  const parts = channels.map((value) => Math.round(clamp((gray + (value - gray) * saturation) * brightness, 0, 255)));
  return `#${parts.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

const STYLE_COLOR: Record<ArtStyle, [number, number]> = { lowpoly: [1.12, 1.06], realistic: [0.7, 0.9], arcade: [1.12, 1.05], blocks: [1.05, 1] };

type Rgb = [number, number, number];

function toRgb(hex: string): Rgb {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
}

const blend = (a: Rgb, b: Rgb, t: number): Rgb => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];

/** The color of smooth ground at a point: each kind of terrain fades into the next. */
function groundColor(land: Land, palette: Record<keyof Palette, Rgb>, x: number, z: number, height: number, slope: number, amount: number): number {
  const level = land.waterLevel(x, z);
  const { noise } = land;
  let color = blend(palette.grass, palette.dry, smoothstep(0.12, 0.32, noise.dry.layered(x / 60, z / 60, 2)));
  const threshold = 1 - clamp(amount);
  color = blend(color, palette.forest, smoothstep(threshold - 0.05, threshold + 0.07, land.woodland(x, z)));
  if (land.trails) color = blend(color, palette.dirt, (1 - smoothstep(0.008, 0.022, Math.abs(noise.trail.layered(x / 110, z / 110, 2)))) * smoothstep(0.86, 0.95, slope));
  if (land.lakes || land.rivers) color = blend(color, palette.sand, 1 - smoothstep(level + 0.3, level + 1.5, height));
  color = blend(color, palette.rock, smoothstep(0.88, 0.7, slope) * smoothstep(level + 0.8, level + 2.6, height));
  const snowy = smoothstep(land.snowLine - 4, land.snowLine + 4, height + noise.dry.at(x / 13, z / 13) * 4);
  color = blend(color, palette.snow, snowy * smoothstep(0.62, 0.8, slope));
  color = blend(color, palette.bed, smoothstep(level, level - 1.2, height));
  const grain = 1 + noise.dry.at(x / 3.3, z / 3.3) * 0.07;
  const [r, g, b] = color.map((channel) => clamp(Math.round(channel * grain), 0, 255));
  return (r << 16) | (g << 8) | b;
}

function styledPalette(palette: Palette, style: ArtStyle): Record<keyof Palette, Rgb> {
  const [saturation, brightness] = STYLE_COLOR[style];
  const entries = Object.entries(palette).map(([name, hex]) => [name, toRgb(adjust(hex, saturation, brightness))]);
  return Object.fromEntries(entries) as Record<keyof Palette, Rgb>;
}

/** On smooth ground the first material is painted vertex by vertex. */
function materialsFor(biome: Biome, style: ArtStyle, painted: boolean): ShapeMaterial[] {
  const { palette } = biome;
  const [saturation, brightness] = STYLE_COLOR[style];
  const color = (hex: string) => adjust(hex, saturation, brightness);
  const waterFinish: Finish | undefined = biome.volcano ? "glow" : style === "lowpoly" || style === "blocks" ? undefined : "gloss";
  const zones: [string, Finish?][] = [
    [palette.grass], [palette.forest], [palette.dry], [palette.sand], [palette.dirt], [palette.rock], [palette.snow], [palette.bed], [palette.water, waterFinish], [palette.bed],
  ];
  const materials: ShapeMaterial[] = zones.map(([hex, finish]) => (finish ? { color: color(hex), finish } : { color: color(hex) }));
  if (painted) materials[Zone.grass] = { color: "#ffffff", painted: true };
  // Realista: the paint keeps its colors and a gray photo of forest ground under it adds the grain.
  if (painted && style === "realistic") materials[Zone.grass] = { color: "#ffffff", painted: true, texture: "ground_detail" };
  if (style === "realistic") materials[Zone.side] = { color: "#ffffff", texture: biome.palette === TEMPERATE ? "dirt" : "rock" };
  return materials;
}

export class MeshBuilder {
  readonly vertices: Vec3[] = [];
  readonly faces: number[][] = [];
  readonly faceMaterials: number[] = [];
  /** Parallel to `vertices`. */
  readonly colors: number[] = [];
  private readonly known = new Map<string, number>();

  /** Corners at the same spot become one vertex, so the ground has no cracks. */
  vertex(x: number, y: number, z: number, color = 0): number {
    const key = `${Math.round(x * 500)},${Math.round(y * 500)},${Math.round(z * 500)}`;
    let index = this.known.get(key);
    if (index === undefined) {
      index = this.vertices.length;
      this.vertices.push([x, y, z]);
      this.colors.push(color);
      this.known.set(key, index);
    }
    return index;
  }

  face(corners: number[], material: number): void {
    this.faces.push(corners);
    this.faceMaterials.push(material);
  }

  /** A four-sided face turned to look the way `outward` says. */
  wall(a: Vec3, b: Vec3, c: Vec3, d: Vec3, outward: Vec3, material: number): void {
    const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
    const faces = normal[0] * outward[0] + normal[1] * outward[1] + normal[2] * outward[2] >= 0;
    const order = faces ? [a, b, c, d] : [d, c, b, a];
    // Where a wall tapers to nothing, two of its corners are the same point.
    const corners = [...new Set(order.map((p) => this.vertex(p[0], p[1], p[2])))];
    if (corners.length >= 3) this.face(corners, material);
  }

  get fits(): boolean {
    return this.vertices.length <= MOST_VERTICES && this.faces.length <= MOST_FACES;
  }
}

interface Ground {
  mesh: MeshBuilder;
  /** Height of the ground's surface at a point. */
  surface(x: number, z: number): number;
  smooth: boolean;
}

/** How much to raise the land so that its lowest point still has ground under it. */
function baseOffset(heights: Float32Array): number {
  let lowest = 0;
  for (const height of heights) lowest = Math.min(lowest, height);
  return -lowest + 2;
}

function closeBottom(mesh: MeshBuilder, x0: number, z0: number, x1: number, z1: number): void {
  mesh.wall([x0, 0, z0], [x1, 0, z0], [x1, 0, z1], [x0, 0, z1], [0, -1, 0], Zone.side);
}

/** A sheet of quads or triangles over the land, with sides and a bottom that close it. */
function sheetGround(land: Land, style: ArtStyle, amount: number, rng: Rng, requested: number): Ground {
  const faceted = style === "lowpoly";
  const { width, length } = land;
  let cell = requested;
  for (;;) {
    const nx = Math.ceil(width / cell);
    const nz = Math.ceil(length / cell);
    const dx = width / nx;
    const dz = length / nz;
    const mesh = new MeshBuilder();
    const shake = rng.fork("shake");

    // Low poly corners move a little, so the faces do not look like a grid.
    const px = new Float32Array((nx + 1) * (nz + 1));
    const pz = new Float32Array((nx + 1) * (nz + 1));
    const py = new Float32Array((nx + 1) * (nz + 1));
    const at = (i: number, j: number) => i * (nz + 1) + j;
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const inside = i > 0 && j > 0 && i < nx && j < nz;
        const x = i * dx - width / 2 + (faceted && inside ? shake.range(-0.3, 0.3) * dx : 0);
        const z = j * dz - length / 2 + (faceted && inside ? shake.range(-0.3, 0.3) * dz : 0);
        px[at(i, j)] = x;
        pz[at(i, j)] = z;
        py[at(i, j)] = land.height(x, z);
      }
    }
    const lift = baseOffset(py);
    const palette = styledPalette(land.biome.palette, style);
    const paintAt = (i: number, j: number) => {
      const west = py[at(Math.max(i - 1, 0), j)];
      const east = py[at(Math.min(i + 1, nx), j)];
      const south = py[at(i, Math.max(j - 1, 0))];
      const north = py[at(i, Math.min(j + 1, nz))];
      const slope = 1 / Math.hypot(1, (east - west) / (2 * dx), (north - south) / (2 * dz));
      return groundColor(land, palette, px[at(i, j)], pz[at(i, j)], py[at(i, j)], slope, amount);
    };
    const corners = new Int32Array((nx + 1) * (nz + 1)).fill(-1);
    const corner = (i: number, j: number) => {
      const index = at(i, j);
      if (corners[index] < 0) corners[index] = mesh.vertex(px[index], py[index] + lift, pz[index], faceted ? 0 : paintAt(i, j));
      return corners[index];
    };

    const zoneOf = (a: number, b: number, c: number) => {
      const x = (px[a] + px[b] + px[c]) / 3;
      const z = (pz[a] + pz[b] + pz[c]) / 3;
      const ux = px[b] - px[a];
      const uy = py[b] - py[a];
      const uz = pz[b] - pz[a];
      const vx = px[c] - px[a];
      const vy = py[c] - py[a];
      const vz = pz[c] - pz[a];
      const nX = uy * vz - uz * vy;
      const nY = uz * vx - ux * vz;
      const nZ = ux * vy - uy * vx;
      const slope = Math.abs(nY) / (Math.hypot(nX, nY, nZ) || 1);
      return zoneAt(land, x, z, (py[a] + py[b] + py[c]) / 3, slope, amount, Math.max(py[a], py[b], py[c]));
    };

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const a = at(i, j);
        const b = at(i, j + 1);
        const c = at(i + 1, j + 1);
        const d = at(i + 1, j);
        const [ca, cb, cc, cd] = [corner(i, j), corner(i, j + 1), corner(i + 1, j + 1), corner(i + 1, j)];
        if (faceted) {
          if ((i + j) % 2 === 0) {
            mesh.face([ca, cb, cc], zoneOf(a, b, c));
            mesh.face([ca, cc, cd], zoneOf(a, c, d));
          } else {
            mesh.face([ca, cb, cd], zoneOf(a, b, d));
            mesh.face([cb, cc, cd], zoneOf(b, c, d));
          }
        } else {
          mesh.face([ca, cb, cc, cd], Zone.grass);
        }

        // The water is one flat sheet, only where the ground goes under it.
        const x = (px[a] + px[c]) / 2;
        const z = (pz[a] + pz[c]) / 2;
        const level = land.waterLevel(x, z);
        if (Math.min(py[a], py[b], py[c], py[d]) < level) {
          const y = level + lift;
          mesh.face([mesh.vertex(px[a], y, pz[a]), mesh.vertex(px[b], y, pz[b]), mesh.vertex(px[c], y, pz[c]), mesh.vertex(px[d], y, pz[d])], Zone.water);
        }
      }
    }

    // Sides, with water where the sea reaches the border.
    const side = (ia: number, ja: number, ib: number, jb: number, outward: Vec3) => {
      const a = at(ia, ja);
      const b = at(ib, jb);
      const ya = py[a] + lift;
      const yb = py[b] + lift;
      mesh.wall([px[a], ya, pz[a]], [px[b], yb, pz[b]], [px[b], 0, pz[b]], [px[a], 0, pz[a]], outward, Zone.side);
      const level = lift + land.waterLevel(px[a], pz[a]);
      if (ya < level || yb < level) {
        mesh.wall([px[a], level, pz[a]], [px[b], level, pz[b]], [px[b], Math.min(yb, level), pz[b]], [px[a], Math.min(ya, level), pz[a]], outward, Zone.water);
      }
    };
    for (let i = 0; i < nx; i++) {
      side(i, 0, i + 1, 0, [0, 0, -1]);
      side(i, nz, i + 1, nz, [0, 0, 1]);
    }
    for (let j = 0; j < nz; j++) {
      side(0, j, 0, j + 1, [-1, 0, 0]);
      side(nx, j, nx, j + 1, [1, 0, 0]);
    }
    closeBottom(mesh, -width / 2, -length / 2, width / 2, length / 2);

    if (mesh.fits) return { mesh, smooth: !faceted, surface: (x, z) => land.height(x, z) + lift };
    cell *= 1.2;
  }
}

/** Columns of blocks: flat tops at whole steps, with walls between neighbors. */
function blockGround(land: Land, amount: number, requested: number): Ground {
  const { width, length } = land;
  let cell = requested;
  for (;;) {
    const nx = Math.ceil(width / cell);
    const nz = Math.ceil(length / cell);
    const dx = width / nx;
    const dz = length / nz;
    const step = Math.min(dx, dz) / 2;
    const mesh = new MeshBuilder();

    const tops = new Float32Array(nx * nz);
    const zones = new Uint8Array(nx * nz);
    const at = (i: number, j: number) => i * nz + j;
    const heights = new Float32Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) heights[at(i, j)] = land.height((i + 0.5) * dx - width / 2, (j + 0.5) * dz - length / 2);
    }
    const lift = baseOffset(heights);
    const snap = (height: number) => Math.max(step, Math.round((height + lift) / step) * step);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const x = (i + 0.5) * dx - width / 2;
        const z = (j + 0.5) * dz - length / 2;
        const height = heights[at(i, j)];
        const level = land.waterLevel(x, z);
        const across = heights[at(Math.min(i + 1, nx - 1), j)] - height;
        const along = heights[at(i, Math.min(j + 1, nz - 1))] - height;
        const slope = 1 / Math.hypot(1, across / dx, along / dz);
        if (height < level) {
          tops[at(i, j)] = snap(level);
          zones[at(i, j)] = Zone.water;
        } else {
          tops[at(i, j)] = snap(height);
          zones[at(i, j)] = zoneAt(land, x, z, height, slope, amount);
        }
      }
    }

    // Equal neighbors become one big top, which keeps the number of faces down.
    const done = new Uint8Array(nx * nz);
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (done[at(i, j)]) continue;
        const same = (a: number, b: number) => !done[at(a, b)] && tops[at(a, b)] === tops[at(i, j)] && zones[at(a, b)] === zones[at(i, j)];
        let endJ = j + 1;
        while (endJ < nz && same(i, endJ)) endJ++;
        let endI = i + 1;
        while (endI < nx) {
          let all = true;
          for (let k = j; k < endJ && all; k++) all = same(endI, k);
          if (!all) break;
          endI++;
        }
        for (let a = i; a < endI; a++) for (let b = j; b < endJ; b++) done[at(a, b)] = 1;
        const y = tops[at(i, j)];
        const x0 = i * dx - width / 2;
        const x1 = endI * dx - width / 2;
        const z0 = j * dz - length / 2;
        const z1 = endJ * dz - length / 2;
        mesh.wall([x0, y, z0], [x0, y, z1], [x1, y, z1], [x1, y, z0], [0, 1, 0], zones[at(i, j)]);
      }
    }

    const outside = (i: number, j: number) => i < 0 || j < 0 || i >= nx || j >= nz;
    const topOf = (i: number, j: number) => (outside(i, j) ? 0 : tops[at(i, j)]);
    // A low step looks like the ground above it; only a real drop shows bare rock.
    const wallZone = (zone: number, a: number, b: number, y: number) => {
      if (zone === Zone.water) return Zone.water;
      if (outside(a, b)) return Zone.side;
      if (y - topOf(a, b) <= step * 2.01) return zone;
      return zone === Zone.snow ? Zone.snow : Zone.rock;
    };
    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        const y = tops[at(i, j)];
        const zone = zones[at(i, j)];
        const x0 = i * dx - width / 2;
        const x1 = x0 + dx;
        const z0 = j * dz - length / 2;
        const z1 = z0 + dz;
        const below = (a: number, b: number) => topOf(a, b);
        if (below(i - 1, j) < y) mesh.wall([x0, y, z0], [x0, y, z1], [x0, below(i - 1, j), z1], [x0, below(i - 1, j), z0], [-1, 0, 0], wallZone(zone, i - 1, j, y));
        if (below(i + 1, j) < y) mesh.wall([x1, y, z0], [x1, y, z1], [x1, below(i + 1, j), z1], [x1, below(i + 1, j), z0], [1, 0, 0], wallZone(zone, i + 1, j, y));
        if (below(i, j - 1) < y) mesh.wall([x0, y, z0], [x1, y, z0], [x1, below(i, j - 1), z0], [x0, below(i, j - 1), z0], [0, 0, -1], wallZone(zone, i, j - 1, y));
        if (below(i, j + 1) < y) mesh.wall([x0, y, z1], [x1, y, z1], [x1, below(i, j + 1), z1], [x0, below(i, j + 1), z1], [0, 0, 1], wallZone(zone, i, j + 1, y));
      }
    }
    closeBottom(mesh, -width / 2, -length / 2, width / 2, length / 2);

    if (mesh.fits) {
      return {
        mesh,
        smooth: false,
        surface: (x, z) => {
          const i = clamp(Math.floor((x + width / 2) / dx), 0, nx - 1);
          const j = clamp(Math.floor((z + length / 2) / dz), 0, nz - 1);
          return tops[at(i, j)];
        },
      };
    }
    cell *= 1.2;
  }
}

interface PropLists {
  rock: string[];
  boulder: string[];
  bush: string[];
  flower: string[];
  tuft: string[];
  cactus: string[];
}

const PROPS: Record<Exclude<ArtStyle, "realistic">, PropLists> = {
  arcade: { rock: ["ar.nature_rock", "ar.nature_rocks"], boulder: ["ar.nature_boulder"], bush: ["ar.nature_bush"], flower: ["ar.nature_flower_red"], tuft: ["ar.nature_grass"], cactus: ["ar.nature_cactus"] },
  blocks: { rock: ["vx.rock"], boulder: ["vx.boulder"], bush: ["vx.bush"], flower: ["vx.flower_red"], tuft: ["vx.tuft"], cactus: ["vx.cactus"] },
  lowpoly: { rock: KIT_ROCKS, boulder: KIT_BOULDERS, bush: KIT_BUSHES_ONLY, flower: KIT_FLOWERS, tuft: KIT_TUFTS, cactus: KIT_CACTI },
};

/** Trees come in clumps; rocks and small plants are spread over what is left. */
function placeNature(asm: Assembler, rng: Rng, land: Land, ground: Ground, style: ArtStyle, density: number, rocks: boolean): void {
  const { biome, width, length } = land;
  const props: PropLists =
    style === "realistic"
      ? (Object.fromEntries(Object.entries(REAL_PROPS).map(([key, sources]) => [key, realBlocks(sources, true)])) as unknown as PropLists)
      : PROPS[style];
  const amount = biome.forest * density;
  const spacing = Math.max(TREE_SPACING, Math.sqrt((width * length) / MOST_SPOTS));
  const spots = rng.fork("spots");

  const trees: [number, number][] = [];
  const add = (list: string[], x: number, z: number, scale: number, label: string) => {
    if (list.length === 0) return;
    asm.add(spots.pick(list), [x, ground.surface(x, z) - 0.05, z], { scale, yawSteps: rng.fork(label).int(0, 3) });
  };

  for (let x = -width / 2 + spacing / 2; x < width / 2; x += spacing) {
    for (let z = -length / 2 + spacing / 2; z < length / 2; z += spacing) {
      const px = x + spots.range(-0.4, 0.4) * spacing;
      const pz = z + spots.range(-0.4, 0.4) * spacing;
      if (Math.abs(px) > width / 2 - 1.5 || Math.abs(pz) > length / 2 - 1.5) continue;
      const height = land.height(px, pz);
      const delta = 1.2;
      const slope = 1 / Math.hypot(1, (land.height(px + delta, pz) - height) / delta, (land.height(px, pz + delta) - height) / delta);
      const zone = zoneAt(land, px, pz, height, slope, amount);
      const label = `${Math.round(px * 10)} ${Math.round(pz * 10)}`;

      if (zone === Zone.rock) {
        if (rocks && spots.chance(0.1)) add(props.boulder, px, pz, spots.range(0.7, 1.6), label);
        continue;
      }
      if (zone === Zone.bed || zone === Zone.dirt) continue;
      if (zone === Zone.forest && spots.chance(0.92) && density > 0) {
        trees.push([px, pz]);
        continue;
      }
      if (zone === Zone.sand) {
        if (rocks && spots.chance(0.05)) add(props.rock, px, pz, spots.range(0.6, 1.2), label);
        continue;
      }
      if (rocks && spots.chance(0.06)) {
        add(spots.chance(0.25) ? props.boulder : props.rock, px, pz, spots.range(0.6, 1.3), label);
      } else if (density > 0 && biome.cacti && spots.chance(0.08 * density)) {
        add(props.cactus, px, pz, spots.range(0.8, 1.4), label);
      } else if (density > 0 && zone !== Zone.snow && !biome.barren) {
        const roll = spots.next();
        const chance = 0.16 * density;
        if (roll < chance * 0.35) add(props.bush, px, pz, spots.range(0.7, 1.3), label);
        else if (roll < chance * (biome.flowers ? 1 : 0.6)) add(props.flower, px, pz, 1, label);
        else if (roll < chance) add(props.tuft, px, pz, spots.range(0.8, 1.2), label);
        else if (amount > 0 && roll > 1 - amount * 0.05) trees.push([px, pz]);
      }
    }
  }

  // The limit thins the forest evenly instead of cutting one side of the map.
  const chosenTrees = rng.fork("thin");
  const keep = Math.min(1, MOST_TREES[style] / Math.max(1, trees.length));
  const kinds = rng.fork("kinds");
  for (const [x, z] of trees) {
    if (!chosenTrees.chance(keep)) continue;
    const kind = kinds.pick(biome.trees);
    const y = ground.surface(x, z) - 0.05;
    const label = `tree ${Math.round(x * 10)} ${Math.round(z * 10)}`;
    if (kind === "dead" && style === "lowpoly") add(KIT_STUMPS, x, z, kinds.range(1, 1.5), label);
    else buildTree(asm, rng.fork(label), { style, position: [x, y, z], kind, light: true });
  }
}

const SIZES = [100, 150, 200];

export function buildMap(asm: Assembler, rng: Rng, options: MapOptions = {}): void {
  const style = options.style ?? "realistic";
  const biomeName = chosen(options.biome) ?? rng.fork("biome").pick(MAP_BIOMES);
  const biome = BIOMES[biomeName];
  const side = (value: string | undefined, label: string) => Number(chosen(value) ?? rng.fork(label).pick(SIZES));
  const width = side(options.width, "width");
  const length = side(options.length, "length");
  const relief = RELIEF[chosen(options.relief) ?? ""] ?? rng.fork("relief").range(0.8, 1.2);
  const water = chosen(options.water);
  const rivers = water ? water === "all" || water === "rivers" : rng.fork("rivers").chance(biome.rivers);
  const lakes = water ? water === "all" || water === "lakes" : rng.fork("lakes").chance(biome.lakes);
  const trails = chosen(options.trails) ? options.trails === "yes" : rng.fork("trails").chance(0.5);
  const rocks = chosen(options.rocks) ? options.rocks === "yes" : true;
  const density = VEGETATION[chosen(options.vegetation) ?? ""] ?? rng.fork("density").range(0.8, 1.25);

  const land = new Land(rng.fork("land"), biome, width, length, relief, rivers, lakes, trails);
  const amount = biome.forest * density;
  const { cell, cells } = GRIDS[style];
  const requested = Math.max(cell, Math.sqrt((width * length) / cells));
  const ground = style === "blocks" ? blockGround(land, amount, requested) : sheetGround(land, style, amount, rng, requested);

  const shape: GeneratedShape = {
    name: `Terreno (${biomeName})`,
    color: biome.palette.grass,
    vertices: ground.mesh.vertices,
    faces: ground.mesh.faces,
    faceMaterials: ground.mesh.faceMaterials,
    materials: materialsFor(biome, style, ground.smooth),
    smoothAngle: ground.smooth ? 180 : 0,
    sockets: [],
    ...(ground.smooth ? { vertexColors: ground.mesh.colors } : {}),
  };
  asm.add(asm.addShape(shape), [0, 0, 0]);
  placeNature(asm, rng.fork("nature"), land, ground, style, density, rocks);
}
