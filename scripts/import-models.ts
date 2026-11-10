// Converts CC0 model packs into the editor's model pack and block definitions.
//
//   node scripts/import-models.ts <folder with one subfolder per kit>
//
// Textures are baked into per-triangle colors, so imported models behave like every other
// block. Each input file is only parsed as data; nothing from it is ever executed.
import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import { extract } from "./gltf-read.ts";
import { translateName } from "./model-names.ts";

interface Kit {
  id: string;
  folder: string;
  category: string;
  /** Multiplies the model's units to reach meters. */
  scale: number;
  /** Tiles placed on the ground and snapped to this grid. */
  grid?: number;
  gridMatch?: RegExp;
  /** Keeps the file's origin, for kits whose tiles are authored around it. */
  keepOrigin?: boolean;
  /** For textures with real drawings (faces, banners), not smooth color ramps. */
  detailedTexture?: boolean;
  /** Replaces a material's color, by name. Values are linear RGB. */
  recolor?: Record<string, [number, number, number]>;
  skip?: RegExp;
}

/** The kit's foliage is turquoise; these greens read as plants to a first-time user. */
const NATURE_GREENS: Record<string, [number, number, number]> = {
  grass: [0.2, 0.56, 0.11],
  leafsGreen: [0.14, 0.48, 0.1],
  leafsDark: [0.06, 0.28, 0.08],
};

const KITS: Kit[] = [
  { id: "car-kit", folder: "car-kit/x/Models/GLB format", category: "lib_vehicles", scale: 1.6, skip: /^debris-|^wheel-/ },
  { id: "commercial", folder: "city-kit-commercial/x/Models/GLB format", category: "lib_city", scale: 6.5, skip: /^low-detail-/ },
  { id: "suburban", folder: "city-kit-suburban/x/Models/GLB format", category: "lib_city", scale: 4 },
  { id: "roads", folder: "city-kit-roads/x/Models/GLB format", category: "lib_roads", scale: 8, grid: 8, gridMatch: /^(road-|tile-|bridge-)/, keepOrigin: true },
  { id: "racing", folder: "racing-kit/x/Models/glTF format", category: "lib_race", scale: 8, grid: 4, gridMatch: /^(road|grass)/, detailedTexture: true },
  { id: "nature", folder: "nature-kit/x/Models/GLTF format", category: "lib_nature", scale: 3.2, recolor: NATURE_GREENS },
  { id: "blocky", folder: "blocky-characters/x/Models/GLB format", category: "lib_people", scale: 0.66, detailedTexture: true },
];

const BYTES_PER_VERTEX = 12;

const repo = path.resolve(import.meta.dirname, "..");
const source = process.argv[2];
if (!source) throw new Error("Informe a pasta com os pacotes baixados.");

const round = (value: number) => Math.round(value * 1000) / 1000;
const roundAll = (values: number[]) => values.map(round);

function chunks(items: string[]): string {
  return items.map((item) => `  ${item},`).join("\n");
}

const packParts: Buffer[] = [];
let packSize = 0;
const blockSources: string[] = [];
const stats: string[] = [];

for (const kit of KITS) {
  const folder = path.join(source, kit.folder);
  const files = readdirSync(folder)
    .filter((name) => /\.(glb|gltf)$/i.test(name) && statSync(path.join(folder, name)).isFile())
    .sort();

  let total = 0;
  let triangles = 0;
  let sample = "";
  for (const fileName of files) {
    const name = fileName.replace(/\.(glb|gltf)$/i, "");
    if (kit.skip?.test(name)) continue;

    const baked = extract(path.join(folder, fileName), kit);
    if (baked.length === 0) continue;

    const isTile = kit.grid !== undefined && (kit.gridMatch?.test(name) ?? true);
    const keepsOrigin = isTile && kit.keepOrigin === true;
    const min = new Vector3(Infinity, Infinity, Infinity);
    const max = new Vector3(-Infinity, -Infinity, -Infinity);
    for (const { corners } of baked) {
      for (const { p } of corners) {
        p.multiplyScalar(kit.scale);
        min.min(p);
        max.max(p);
      }
    }

    // Everything rests on y = 0. Free-standing models are also centered on their footprint.
    const shift = new Vector3(
      keepsOrigin ? 0 : -(min.x + max.x) / 2,
      -min.y,
      keepsOrigin ? 0 : -(min.z + max.z) / 2,
    );
    min.add(shift);
    max.add(shift);
    const span = max.clone().sub(min);
    const safeSpan = [span.x || 1, span.y || 1, span.z || 1];

    const vertices = baked.length * 3;
    const buffer = Buffer.alloc(vertices * BYTES_PER_VERTEX);
    let at = 0;
    for (const { corners, colors } of baked) {
      for (let c = 0; c < 3; c++) {
        const { p, n } = corners[c];
        const color = colors[c];
        p.add(shift);
        buffer.writeInt16LE(Math.round(((p.x - min.x) / safeSpan[0]) * 65534 - 32767), at);
        buffer.writeInt16LE(Math.round(((p.y - min.y) / safeSpan[1]) * 65534 - 32767), at + 2);
        buffer.writeInt16LE(Math.round(((p.z - min.z) / safeSpan[2]) * 65534 - 32767), at + 4);
        buffer.writeInt8(Math.round(n.x * 127), at + 6);
        buffer.writeInt8(Math.round(n.y * 127), at + 7);
        buffer.writeInt8(Math.round(n.z * 127), at + 8);
        buffer.writeUInt8(color[0], at + 9);
        buffer.writeUInt8(color[1], at + 10);
        buffer.writeUInt8(color[2], at + 11);
        at += BYTES_PER_VERTEX;
      }
    }

    const offset = packSize;
    packParts.push(buffer);
    packSize += buffer.length;

    const center = [round((min.x + max.x) / 2), round((min.y + max.y) / 2), round((min.z + max.z) / 2)];
    const sockets = [
      ["bottom", [center[0], round(min.y), center[2]], [0, -1, 0]],
      ["top", [center[0], round(max.y), center[2]], [0, 1, 0]],
      ["left", [round(min.x), center[1], center[2]], [-1, 0, 0]],
      ["right", [round(max.x), center[1], center[2]], [1, 0, 0]],
      ["front", [center[0], center[1], round(max.z)], [0, 0, 1]],
      ["back", [center[0], center[1], round(min.z)], [0, 0, -1]],
    ].map(([id, p, n]) => ({ id, p, n }));

    const extra = isTile ? { ground: true, snap: kit.grid } : { upright: true };
    blockSources.push(
      JSON.stringify({
        id: `kit.${kit.id}.${name}`,
        name: translateName(name),
        category: kit.category,
        color: "#ffffff",
        shape: {
          kind: "model",
          model: `${kit.id}/${name}`,
          offset,
          vertices,
          min: roundAll(min.toArray()),
          max: roundAll(max.toArray()),
        },
        sockets,
        ...extra,
      }),
    );

    total++;
    triangles += baked.length;
    if (!sample) sample = `${name}: ${roundAll(span.toArray()).join(" x ")} m`;
  }
  stats.push(`${kit.id}: ${total} modelos, média ${Math.round(triangles / Math.max(total, 1))} triângulos (${sample})`);
}

mkdirSync(path.join(repo, "public/models"), { recursive: true });
writeFileSync(path.join(repo, "public/models/pack.bin"), Buffer.concat(packParts));
writeFileSync(
  path.join(repo, "src/blocks/definitions/models.generated.ts"),
  `// Generated by scripts/import-models.ts. Do not edit by hand.\nimport type { BlockDef } from "../types.ts";\n\nexport const modelBlocks: BlockDef[] = [\n${chunks(blockSources)}\n];\n`,
);

console.log(stats.join("\n"));
console.log(`Total: ${blockSources.length} modelos, ${(packSize / 1048576).toFixed(1)} MB`);
