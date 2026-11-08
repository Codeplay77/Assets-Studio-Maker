// Regenerates src/blocks/blocks.json, the catalog read by both the UI and the Rust core.
// Run it with `pnpm catalog` after changing anything in src/blocks/definitions/.
import { writeFileSync } from "node:fs";
import { blocks, categories } from "../src/blocks/definitions/index.ts";

const lines = (items: unknown[]) => items.map((item) => `    ${JSON.stringify(item)}`).join(",\n");
const json = `{\n  "categories": [\n${lines(categories)}\n  ],\n  "blocks": [\n${lines(blocks)}\n  ]\n}\n`;

writeFileSync(new URL("../src/blocks/blocks.json", import.meta.url), json);
console.log(`${blocks.length} blocos em ${categories.length} categorias`);
console.log("Se o `tauri dev` estiver aberto, reinicie: o núcleo em Rust embute este catálogo.");
