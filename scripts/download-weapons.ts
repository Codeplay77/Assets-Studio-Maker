// Downloads the CC0 weapon packs into the folder scripts/import-weapons.ts reads, from the uploads
// their own authors made to OpenGameArt. The Realista weapons come from Poly Haven with the rest of
// that style (scripts/download-realistic.ts).
//
//   node scripts/download-weapons.ts <folder>
//
// Files are only saved and unpacked, never run. Downloads that are already there are skipped, so the
// script can be run again after a failure. The packs are unpacked with today's date on every file:
// some cleaners empty temporary folders of files with old dates, and these are from 2016 to 2019.
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const target = process.argv[2];
if (!target) throw new Error("Informe a pasta onde salvar os pacotes.");

const HEADERS = { "User-Agent": "AssetsStudioMaker-import/0.1" };
// Windows 10 and later ship bsdtar, which opens zip files; a GNU tar earlier on the PATH (Git Bash)
// does not, so Windows' own is called by its full path.
const TAR = process.platform === "win32" ? path.join(process.env.SystemRoot ?? "C:/Windows", "System32", "tar.exe") : "tar";

const PACKS: { folder: string; file: string; marker: string }[] = [
  // Kenney, Blaster Kit 2.1.
  { folder: "kenney-blaster", file: "kenney_blaster-kit_2.1.zip", marker: "License.txt" },
  // Quaternius, Low Poly Guns Pack (the Ultimate Gun Pack, July 2019).
  { folder: "quaternius-guns", file: "ultimate_gun_pack_by_quaternius.zip", marker: "Ultimate Gun Pack - July 2019" },
  // Quaternius, Low poly medieval weapons.
  { folder: "quaternius-medieval", file: "MedievalPack.zip", marker: "MedievalPack" },
  // Quaternius, Low Poly RPG Pack (the Ultimate RPG Items Pack, August 2019).
  { folder: "quaternius-rpg", file: "ultimate_rpg_items_pack_by_quaternius_0.zip", marker: "Ultimate RPG Items Pack - Aug 2019" },
];

for (const pack of PACKS) {
  const folder = path.join(target, pack.folder);
  const zip = path.join(folder, pack.file);
  if (!existsSync(zip)) {
    mkdirSync(folder, { recursive: true });
    const response = await fetch(`https://opengameart.org/sites/default/files/${pack.file}`, { headers: HEADERS });
    if (!response.ok) throw new Error(`${response.status} em ${pack.file}`);
    writeFileSync(zip, Buffer.from(await response.arrayBuffer()));
  }
  if (!existsSync(path.join(folder, "x", pack.marker))) {
    mkdirSync(path.join(folder, "x"), { recursive: true });
    // -m dates the files today.
    execFileSync(TAR, ["-xmf", zip, "-C", path.join(folder, "x")]);
  }
  console.log(`${pack.folder}: ok`);
}
