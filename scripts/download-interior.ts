// Downloads the CC0 furniture packs into the folders scripts/import-interior.ts reads.
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

// Quaternius, from the author's own bundles on Poly Pizza.
interface BundleModel {
  title: string;
  previewUrl: string;
  licence: string;
}

/** The models of a bundle, read from the data the page embeds for its own viewer. */
async function bundle(url: string): Promise<BundleModel[]> {
  const html = (await get(url)).toString("utf8");
  const start = html.indexOf("window.__SERVER_APP_STATE__ =");
  const end = html.indexOf("</script>", start);
  const state = JSON.parse(html.slice(start + "window.__SERVER_APP_STATE__ =".length, end).trim().replace(/;$/, ""));
  return state.initialData.list.Models as BundleModel[];
}

/** File names from titles; repeated titles get _2, _3 in the bundle's order. */
function fileNames(models: BundleModel[]): string[] {
  const seen = new Map<string, number>();
  return models.map(({ title }) => {
    const base = title.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return count === 1 ? base : `${base}_${count}`;
  });
}

const BUNDLES: [string, string][] = [
  ["quaternius-uhip", "https://poly.pizza/bundle/Ultimate-House-Interior-Pack-2SXnFbwFzm"],
  ["quaternius-furniture", "https://poly.pizza/bundle/Furniture-Pack-pgvx8Zkq8v"],
];

for (const [folder, url] of BUNDLES) {
  const models = await bundle(url);
  const names = fileNames(models);
  for (const [index, model] of models.entries()) {
    if (model.licence !== "CC0 1.0") throw new Error(`${model.title} não é CC0: ${model.licence}`);
    // The model file sits next to its preview image, with the same name.
    const file = model.previewUrl.replace(/\.[a-z]+$/, ".glb");
    await save(file, path.join(target, folder, `${names[index]}.glb`));
  }
  console.log(`${folder}: ${models.length} modelos`);
}

// Poly Haven, through its public API.
const POLYHAVEN = [
  "alarm_clock_01", "ArmChair_01", "bar_chair_round_01", "boombox", "cardboard_box_01", "CashRegister_01", "ceiling_fan",
  "ceramic_vase_01", "ceramic_vase_02", "ceramic_vase_03", "Chandelier_01", "chinese_screen_panels", "ClassicConsole_01",
  "ClassicNightstand_01", "classic_laptop", "CoffeeTable_01", "coffee_table_round_01", "desk_lamp_arm_01", "dining_chair_02",
  "drawer_cabinet", "electric_stove", "fancy_picture_frame_01", "fire_alarm", "gaming_console", "GothicBed_01",
  "GothicCommode_01", "GreenChair_01", "hanging_industrial_lamp", "industrial_wall_lamp", "metal_office_desk", "metal_stool_01",
  "mid_century_lounge_chair", "modern_arm_chair_01", "modern_ceiling_lamp_01", "modern_coffee_table_01", "modern_wooden_cabinet",
  "ornate_mirror_01", "Ottoman_01", "painted_wooden_cabinet", "painted_wooden_chair_02", "painted_wooden_nightstand",
  "planter_pot_clay", "plastic_monobloc_chair_01", "potted_plant_02", "potted_plant_04", "projector_screen", "Rockingchair_01",
  "round_wooden_table_01", "rubber_duck_toy", "SchoolChair_01", "SchoolDesk_01", "Shelf_01", "side_table_01", "side_table_tall_01",
  "small_wooden_table_01", "Sofa_01", "sofa_02", "sofa_03", "standing_chalkboard_01", "standing_picture_frame_01",
  "steel_frame_shelves_01", "Television_01", "television_02", "throw_pillows_01", "vintage_day_bed", "vintage_microwave",
  "vintage_suitcase", "vintage_wooden_drawer_01", "wall_clock", "WetFloorSign_01", "wicker_basket_02", "WoodenChair_01",
  "WoodenTable_01", "WoodenTable_02", "wooden_bookshelf_worn", "wooden_display_shelves_01", "wooden_picnic_table", "wooden_stool_01",
];

interface PolyHavenFile {
  url: string;
  include?: Record<string, { url: string }>;
}

const assets = JSON.parse((await get("https://api.polyhaven.com/assets?t=models")).toString("utf8"));
for (const id of POLYHAVEN) {
  const folder = path.join(target, "polyhaven", id);
  if (existsSync(path.join(folder, "done"))) continue;
  const files = JSON.parse((await get(`https://api.polyhaven.com/files/${id}`)).toString("utf8"));
  const gltf: PolyHavenFile = files.gltf["1k"].gltf;
  await save(gltf.url, path.join(folder, path.basename(gltf.url)));
  for (const [relative, include] of Object.entries(gltf.include ?? {})) await save(include.url, path.join(folder, ...relative.split("/")));
  const info = assets[id];
  writeFileSync(
    path.join(folder, "info.json"),
    JSON.stringify({ id, name: info.name, authors: info.authors, categories: info.categories, license: "CC0 1.0", source: `https://polyhaven.com/a/${id}` }, null, 1),
  );
  writeFileSync(path.join(folder, "done"), "ok");
}
console.log(`Poly Haven: ${POLYHAVEN.length} modelos`);
