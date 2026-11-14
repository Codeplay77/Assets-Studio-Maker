// Downloads the Kenney furniture kit (CC0) into the folder scripts/import-interior.ts reads.
// Realista furniture comes from scripts/download-realistic.ts.
//
//   node scripts/download-interior.ts <folder>
//
// Files are only saved, never run. Downloads that are already there are skipped, so the script
// can be run again after a failure.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Informe a pasta onde salvar os pacotes.");

const HEADERS = { "User-Agent": "AssetsStudioMaker-import/0.1" };

async function get(url: string): Promise<Buffer> {
  const response = await fetch(url, { headers: HEADERS });
  if (!response.ok) throw new Error(`${response.status} em ${url}`);
  return Buffer.from(await response.arrayBuffer());
}

async function save(url: string, file: string): Promise<void> {
  if (existsSync(file)) return;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, await get(url));
}

// Kenney Furniture Kit, from Kenney's own upload on OpenGameArt.
const kenney = path.join(target, "kenney-furniture");
await save("https://opengameart.org/sites/default/files/kenney_furniturePack.zip", path.join(kenney, "furniture.zip"));
if (!existsSync(path.join(kenney, "x", "License.txt"))) {
  mkdirSync(path.join(kenney, "x"), { recursive: true });
  // Windows 10 and later ship bsdtar, which opens zip files.
  execFileSync("tar", ["-xf", path.join(kenney, "furniture.zip"), "-C", path.join(kenney, "x")]);
}
console.log("Kenney: ok");
