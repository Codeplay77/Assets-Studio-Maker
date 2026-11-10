import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { getBlock } from "../blocks/catalog";
import { setVehiclePack } from "../blocks/modelPack";
import type { ArtStyle } from "../blocks/styles";
import type { Part } from "../core/types";
import { runGenerator } from "../generators";
import { buildExportScene, countTriangles, exportGlb } from "./glb";
import { findVehicles } from "./vehicles";

const pack = readFileSync(new URL("../../public/models/vehicles.bin", import.meta.url));
setVehiclePack(pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength) as ArrayBuffer);

function vehicle(style: ArtStyle, options: Record<string, string>, group?: number): Part[] {
  return runGenerator("car", 7, { style, options }).map((part, i) => ({ ...part, id: i + 1, color: part.color ?? getBlock(part.block).color, group }));
}

const STYLES: ArtStyle[] = ["realistic", "arcade", "lowpoly", "blocks"];

function meshes(object: THREE.Object3D): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) found.push(child);
  });
  return found;
}

describe("finding vehicles", () => {
  it.each(STYLES)("names the four wheels of a car and puts them on the ground in the %s style", (style) => {
    const { bodies, rest } = findVehicles(vehicle(style, { kind: "car", model: "sedan" }));
    expect(rest).toHaveLength(0);
    expect(bodies).toHaveLength(1);
    const [car] = bodies;
    expect(car.wheels.map((wheel) => wheel.name).sort()).toEqual(
      ["roda_dianteira_direita", "roda_dianteira_esquerda", "roda_traseira_direita", "roda_traseira_esquerda"],
    );
    for (const wheel of car.wheels) {
      // On the ground, on its own side, steering only at the front.
      expect(Math.abs(wheel.center.y - wheel.radius), wheel.name).toBeLessThan(0.02);
      expect(Math.sign(wheel.center.x), wheel.name).toBe(wheel.name.endsWith("esquerda") ? 1 : -1);
      expect(wheel.front).toBe(wheel.name.includes("dianteira"));
      expect(Math.sign(wheel.center.z)).toBe(wheel.front ? 1 : -1);
      expect(wheel.width).toBeGreaterThan(0.1);
    }
    // The frame sits between the axles, so the wheels are as far ahead as behind.
    const zs = car.wheels.map((wheel) => wheel.center.z);
    expect(Math.max(...zs) + Math.min(...zs)).toBeCloseTo(0, 2);
    expect(car.box.min.y).toBeGreaterThanOrEqual(-0.01);
  });

  it("keeps both tires of a dual wheel on one node and splits off the trailer", () => {
    const { bodies, rest } = findVehicles(vehicle("realistic", { kind: "semi", model: "carreta_bau" }));
    expect(rest).toHaveLength(0);
    const tractor = bodies.find((body) => !body.trailer)!;
    const trailer = bodies.find((body) => body.trailer)!;
    expect(tractor.wheels).toHaveLength(6);
    expect(trailer.wheels).toHaveLength(6);
    expect(tractor.wheels.filter((wheel) => wheel.dual)).toHaveLength(4);
    expect(tractor.wheels.find((wheel) => wheel.name === "roda_traseira_1_esquerda")?.dual).toBe(true);
    expect(trailer.wheels.map((wheel) => wheel.name)).toContain("roda_carreta_3_direita");
    expect(trailer.wheels.every((wheel) => wheel.name.startsWith("roda_carreta_") && !wheel.front)).toBe(true);
    // The king pin of the trailer is on the fifth wheel of the tractor.
    const hitch = tractor.hitch!.clone().applyMatrix4(tractor.frame);
    const king = trailer.hitch!.clone().applyMatrix4(trailer.frame);
    expect(hitch.distanceTo(king)).toBeLessThan(0.01);
  });

  it("takes the driver and the wing of a kart and the sign of a taxi along with the body", () => {
    expect(findVehicles(vehicle("arcade", { kind: "kart", spoiler: "asa" })).rest).toHaveLength(0);
    const taxi = vehicle("realistic", { kind: "taxi", model: "sedan" });
    const { bodies } = findVehicles(taxi);
    expect(bodies[0].parts.some((part) => part.block.endsWith("taxi_sign"))).toBe(true);
  });

  it("leaves out what is only in the same group", () => {
    const car = vehicle("realistic", { kind: "car", model: "sedan" }, 3);
    const house: Part = { id: 900, block: "basic.cube", position: [20, 0.5, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], color: "#ffffff", group: 3 };
    const { bodies, rest } = findVehicles([...car, house]);
    expect(rest).toEqual([house]);
    expect(bodies[0].parts).not.toContain(house);
  });
});

describe("exporting vehicles", () => {
  const options = { merge: false, center: true, name: "Carro", vehicles: true, godot: true };

  it("exports a lone vehicle at the origin, facing +Z, whatever its place in the scene", () => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), 1.1);
    const parts = vehicle("realistic", { kind: "car", model: "sedan" }).map((part) => {
      const position = new THREE.Vector3(...part.position).applyQuaternion(yaw).add(new THREE.Vector3(30, 0, -12));
      const rotation = yaw.clone().multiply(new THREE.Quaternion(...part.rotation));
      return { ...part, position: position.toArray(), rotation: rotation.toArray() as Part["rotation"] };
    });
    const scene = buildExportScene(parts, options);
    const car = scene.getObjectByName("Sedã")!;
    expect(car.position.length()).toBeLessThan(1e-6);
    expect(car.quaternion.angleTo(new THREE.Quaternion())).toBeLessThan(1e-6);
    const front = scene.getObjectByName("roda_dianteira_esquerda-wheel")!;
    expect(front.position.z).toBeGreaterThan(1);
    expect(front.position.x).toBeGreaterThan(0.4);
  });

  it("centers each wheel's mesh on its node, so it spins in place", () => {
    const scene = buildExportScene(vehicle("realistic", { kind: "car", model: "sedan" }), options);
    const wheel = scene.getObjectByName("roda_traseira_direita-wheel")!;
    scene.updateMatrixWorld(true);
    const center = wheel.worldToLocal(new THREE.Box3().setFromObject(wheel).getCenter(new THREE.Vector3()));
    // Along the axle the brake parts shift it a little; around the axle it must be exact.
    expect(Math.abs(center.y)).toBeLessThan(0.005);
    expect(Math.abs(center.z)).toBeLessThan(0.005);
    expect(Math.abs(center.x)).toBeLessThan(0.05);
  });

  it("keeps every triangle when it joins the meshes", () => {
    const parts = vehicle("realistic", { kind: "semi", model: "carreta_bau" });
    const scene = buildExportScene(parts, { ...options, merge: true });
    const triangles = meshes(scene).reduce((total, mesh) => total + mesh.geometry.index!.count / 3, 0);
    expect(triangles).toBe(countTriangles(parts));
    expect(scene.getObjectByName("Carreta baú")).toBeDefined();
    expect(scene.getObjectByName("roda_traseira_2_esquerda_metal")).toBeDefined();
    expect(scene.getObjectByName("colisao_carreta")).toBeDefined();
    // No two nodes share a name, or Godot would number them.
    const names: string[] = [];
    scene.traverse((object) => names.push(object.name));
    expect(names.length).toBe(new Set(names).size);
  });

  it("writes the vehicle body and its box for Godot into the file", async () => {
    // GLTFExporter reads its blobs with FileReader, which Node does not have.
    class NodeFileReader {
      result: ArrayBuffer | null = null;
      onloadend: (() => void) | null = null;
      readAsArrayBuffer(blob: Blob) {
        void blob.arrayBuffer().then((buffer) => {
          this.result = buffer;
          this.onloadend?.();
        });
      }
    }
    const global = globalThis as { FileReader?: unknown };
    const original = global.FileReader;
    global.FileReader = NodeFileReader;
    try {
      const bytes = await exportGlb(vehicle("realistic", { kind: "car", model: "sedan" }), { ...options, merge: true });
      const view = new DataView(bytes);
      const json = JSON.parse(new TextDecoder().decode(new Uint8Array(bytes, 20, view.getUint32(12, true))));
      expect(json.extensionsUsed).toEqual(expect.arrayContaining(["OMI_physics_body", "OMI_physics_shape"]));
      const car = json.nodes.find((node: { name: string }) => node.name === "Sedã");
      expect(car.extensions.OMI_physics_body).toEqual({ type: "vehicle" });
      const collider = json.nodes.find((node: { name: string }) => node.name === "colisao");
      const shape = json.extensions.OMI_physics_shape.shapes[collider.extensions.OMI_physics_body.collider.shape];
      expect(shape.type).toBe("box");
      expect(shape.box.size[0]).toBeLessThan(2);
      const wheel = json.nodes.find((node: { name: string }) => node.name === "roda_dianteira_esquerda-wheel");
      expect(wheel.extras).toMatchObject({ raio: 0.35, direcao: true });
    } finally {
      global.FileReader = original;
    }
  });

  it("uses plain names for other engines", () => {
    const scene = buildExportScene(vehicle("arcade", { kind: "car", model: "sedan" }), { ...options, godot: false });
    expect(scene.getObjectByName("roda_dianteira_direita")).toBeDefined();
    expect(scene.getObjectByName("colisao")).toBeUndefined();
    expect(scene.getObjectByName("Sedã")!.userData.colisao.tamanho[2]).toBeGreaterThan(3);
  });
});
