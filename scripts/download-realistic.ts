// Downloads what the Realista style is built from, all CC0 from Poly Haven's public API:
//
//   node scripts/download-realistic.ts <folder>
//
//   <folder>/textures/<source>/   the 1k color, normal and arm images of each tiling surface
//   <folder>/models/<id>/         the 1k glTF of each model in scripts/realistic-names.ts
//   <folder>/sky/                 the sky that lights Realista scenes in the editor (1k HDR)
//
// Files are only saved, never run. Downloads that are already there are skipped, so the script can
// be run again after a failure. Next: tools/blender/prepare_polyhaven.py, then
// scripts/import-realistic.ts.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { TILING_SURFACES } from "../src/blocks/surfaces.ts";
import { REALISTIC_MODELS } from "./realistic-names.ts";

const target = process.argv[2];
if (!target) throw new Error("Informe a pasta onde salvar os arquivos.");

const HEADERS = { "User-Agent": "AssetsStudioMaker-import/0.1" };

async function get(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status} em ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

const getJson = async (url: string) => JSON.parse((await get(url)).toString("utf8"));

async function save(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, await get(url));
}

interface PolyHavenFile {
  url: string;
  include?: Record<string, { url: string }>;
}

interface PolyHavenInfo {
  name: string;
  authors: Record<string, string>;
  categories: string[];
  dimensions?: number[];
}

function writeInfo(folder: string, id: string, info: PolyHavenInfo): void {
  writeFileSync(
    path.join(folder, "info.json"),
    JSON.stringify({ id, name: info.name, authors: info.authors, categories: info.categories, dimensions: info.dimensions, license: "CC0 1.0", source: `https://polyhaven.com/a/${id}` }, null, 1),
  );
}

// Two surfaces can share a photo (one of them a gray detail copy), so each file is checked on its own.
for (const surface of TILING_SURFACES) {
  const folder = path.join(target, "textures", surface.source);
  const files = await getJson(`https://api.polyhaven.com/files/${surface.source}`);
  // A detail texture is turned gray by scripts/import-realistic.ts, which reads PNG.
  if (surface.detail) await save(files.Diffuse["1k"].png.url, path.join(folder, "color.png"));
  else await save(files.Diffuse["1k"].jpg.url, path.join(folder, "color.jpg"));
  await save(files.nor_gl["1k"].jpg.url, path.join(folder, "normal.jpg"));
  await save(files.arm["1k"].jpg.url, path.join(folder, "arm.jpg"));
  writeInfo(folder, surface.source, await getJson(`https://api.polyhaven.com/info/${surface.source}`));
  writeFileSync(path.join(folder, "done"), "ok");
}
console.log(`Texturas: ${TILING_SURFACES.length}`);

const SKY = "kloofendal_48d_partly_cloudy_puresky";
const sky = path.join(target, "sky");
await save((await getJson(`https://api.polyhaven.com/files/${SKY}`)).hdri["1k"].hdr.url, path.join(sky, "sky.hdr"));
writeInfo(sky, SKY, await getJson(`https://api.polyhaven.com/info/${SKY}`));
console.log("Céu: ok");

for (const id of Object.keys(REALISTIC_MODELS)) {
  const folder = path.join(target, "models", id);
  if (existsSync(path.join(folder, "done"))) continue;
  const files = await getJson(`https://api.polyhaven.com/files/${id}`);
  const gltf: PolyHavenFile = files.gltf["1k"].gltf;
  await save(gltf.url, path.join(folder, path.basename(gltf.url)));
  for (const [relative, include] of Object.entries(gltf.include ?? {})) await save(include.url, path.join(folder, ...relative.split("/")));
  writeInfo(folder, id, await getJson(`https://api.polyhaven.com/info/${id}`));
  writeFileSync(path.join(folder, "done"), "ok");
  process.stdout.write(".");
}
console.log(`\nModelos: ${Object.keys(REALISTIC_MODELS).length}`);
