import { beforeAll, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import * as THREE from "three";
import { blocks, categories, isColorLayer, layersOf } from "./catalog";
import * as definitions from "./definitions/index.ts";
import { buildGeometry, FIXED_GROUP, TINTED_GROUP } from "./geometry";
import { setModelPack, setVehiclePack } from "./modelPack";
import type { BlockShape } from "./types";

beforeAll(() => {
  const file = readFileSync(new URL("../../public/models/pack.bin", import.meta.url));
  setModelPack(file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength) as ArrayBuffer);
  const interior = readFileSync(new URL("../../public/models/interior.bin", import.meta.url));
  setModelPack(interior.buffer.slice(interior.byteOffset, interior.byteOffset + interior.byteLength) as ArrayBuffer, "interior");
  const vehicles = readFileSync(new URL("../../public/models/vehicles.bin", import.meta.url));
  setVehiclePack(vehicles.buffer.slice(vehicles.byteOffset, vehicles.byteOffset + vehicles.byteLength) as ArrayBuffer);
});

function signedVolume(geometry: THREE.BufferGeometry): number {
  const position = geometry.getAttribute("position");
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < position.count; i += 3) {
    a.fromBufferAttribute(position, i);
    b.fromBufferAttribute(position, i + 1);
    c.fromBufferAttribute(position, i + 2);
    volume += a.dot(b.clone().cross(c)) / 6;
  }
  return volume;
}

const piecesOf = (shape: BlockShape) => (shape.kind === "compound" ? shape.pieces : [{ shape }]);

describe("block catalog", () => {
  it("matches the definitions (run `pnpm catalog` after editing them)", () => {
    expect(blocks).toEqual(JSON.parse(JSON.stringify(definitions.blocks)));
    expect(categories).toEqual(definitions.categories);
  });

  it("places a model with all its color layers and hides them from the lists", () => {
    expect(layersOf("ar.veh_sedan_base")).toEqual(["ar.veh_sedan_paint", "ar.veh_sedan_trim", "ar.veh_sedan_accent"].filter((id) => blocks.some((block) => block.id === id)));
    expect(layersOf("ar.veh_moto_naked_base")).toContain("ar.veh_moto_naked_rim");
    expect(layersOf("ar.wheel_liga_rim")).toEqual(["ar.wheel_liga_band"]);
    expect(layersOf("basic.cube")).toEqual([]);
    for (const id of ["ar.veh_sedan_paint", "ar.wheel_liga_band", "ar.veh_moto_naked_rim"]) expect(isColorLayer(id), id).toBe(true);
    for (const id of ["ar.veh_sedan_base", "ar.wheel_liga_rim", "basic.cube"]) expect(isColorLayer(id), id).toBe(false);
  });

  it("has unique ids and valid categories", () => {
    const ids = blocks.map((block) => block.id);
    expect(new Set(ids).size).toBe(ids.length);
    const categoryIds = new Set(categories.map((category) => category.id));
    for (const block of blocks) expect(categoryIds, block.id).toContain(block.category);
  });

  it("fills every category", () => {
    for (const category of categories) {
      expect(blocks.some((block) => block.category === category.id), category.id).toBe(true);
    }
  });

  it("gives every block a base socket and no repeated socket ids", () => {
    for (const block of blocks) {
      expect(block.sockets.length, block.id).toBeGreaterThan(0);
      const ids = block.sockets.map((socket) => socket.id);
      expect(new Set(ids).size, block.id).toBe(ids.length);
    }
  });

  it("uses unit socket normals", () => {
    for (const block of blocks) {
      for (const socket of block.sockets) {
        const length = new THREE.Vector3(...socket.n).length();
        expect(length, `${block.id}/${socket.id}`).toBeCloseTo(1, 2);
      }
    }
  });

  it.each(blocks.map((block) => [block.id, block] as const))(
    "%s builds a mesh with finite normals and outward faces",
    (_id, block) => {
      for (const piece of piecesOf(block.shape)) {
        // Imported models may be open surfaces, like a flat road tile.
        if (piece.shape.kind === "model" || piece.shape.kind === "baked") continue;
        const geometry = buildGeometry({ kind: "compound", pieces: [piece] });
        expect(signedVolume(geometry), `${block.id} ${piece.shape.kind}`).toBeGreaterThan(0);
        geometry.dispose();
      }

      const geometry = buildGeometry(block.shape);
      const position = geometry.getAttribute("position");
      const normal = geometry.getAttribute("normal");
      expect(position.count % 3).toBe(0);
      expect(normal.count).toBe(position.count);
      expect(geometry.getAttribute("color").count).toBe(position.count);
      for (let i = 0; i < normal.count; i++) {
        expect(Number.isFinite(normal.getX(i) + normal.getY(i) + normal.getZ(i))).toBe(true);
      }
      expect(geometry.groups.reduce((total, group) => total + group.count, 0)).toBe(position.count);
      geometry.dispose();
    },
  );

  it("keeps sockets close to the block", () => {
    for (const block of blocks) {
      const geometry = buildGeometry(block.shape);
      geometry.computeBoundingBox();
      const box = geometry.boundingBox!.clone().expandByScalar(0.06);
      // A vehicle's `ground` socket is on the road, below the body it belongs to.
      for (const socket of block.sockets.filter(({ id }) => id !== "ground")) {
        const point = new THREE.Vector3(...socket.p);
        expect(box.containsPoint(point), `${block.id}/${socket.id}`).toBe(true);
      }
      geometry.dispose();
    }
  });
});

describe("mixed-color blocks", () => {
  it("separates tinted and fixed pieces", () => {
    const geometry = buildGeometry({
      kind: "compound",
      pieces: [
        { shape: { kind: "box", size: [1, 1, 1] }, color: "#ff0000" },
        { shape: { kind: "box", size: [1, 1, 1] } },
      ],
    });
    expect(geometry.groups.map((group) => group.materialIndex)).toEqual([TINTED_GROUP, FIXED_GROUP]);
    const color = geometry.getAttribute("color");
    expect(color.getX(0)).toBeCloseTo(1);
    expect(color.getX(color.count - 1)).toBeCloseTo(1);
    expect(color.getY(color.count - 1)).toBeCloseTo(0);
    geometry.dispose();
  });
});
