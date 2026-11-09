import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { Part } from "../core/types";
import { addVertexColorHint, blockTriangles, buildExportScene, countTriangles } from "./glb";

function part(id: number, overrides: Partial<Part> = {}): Part {
  return {
    id,
    block: "basic.cube",
    position: [0, 0.25, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    color: "#ff0000",
    ...overrides,
  };
}

const options = { merge: false, center: false, name: "Modelo" };

function meshes(scene: THREE.Scene): THREE.Mesh[] {
  const found: THREE.Mesh[] = [];
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) found.push(object);
  });
  return found;
}

describe("separate parts", () => {
  it("creates one node per part and shares identical geometry", () => {
    const scene = buildExportScene([part(1), part(2, { position: [2, 0.25, 0] })], options);
    const list = meshes(scene);
    expect(list).toHaveLength(2);
    expect(list[0].geometry).toBe(list[1].geometry);
    expect(list[1].position.x).toBe(2);
  });

  it("shares materials between parts of the same color", () => {
    const list = meshes(buildExportScene([part(1), part(2), part(3, { color: "#00ff00" })], options));
    expect(list[0].material).toBe(list[1].material);
    expect(list[0].material).not.toBe(list[2].material);
  });

  it("keeps groups as parent nodes", () => {
    const scene = buildExportScene([part(1, { group: 4 }), part(2, { group: 4 }), part(3)], options);
    const group = scene.getObjectByName("Grupo 4")!;
    expect(group.children).toHaveLength(2);
  });

  it("welds vertices without losing faces", () => {
    const [mesh] = meshes(buildExportScene([part(1)], options));
    expect(mesh.geometry.index!.count / 3).toBe(blockTriangles("basic.cube"));
    expect(mesh.geometry.getAttribute("position").count).toBeLessThan(mesh.geometry.index!.count);
  });
});

describe("merged export", () => {
  const merged = { ...options, merge: true };

  it("produces one mesh per finish, whatever the number of parts", () => {
    const parts = [part(1), part(2, { position: [3, 0.25, 0], color: "#0000ff" })];
    expect(meshes(buildExportScene(parts, merged))).toHaveLength(1);
  });

  it("keeps every triangle and applies each part's transform", () => {
    const parts = [part(1), part(2, { position: [3, 0.25, 0], scale: [2, 2, 2] })];
    const [mesh] = meshes(buildExportScene(parts, merged));
    expect(mesh.geometry.index!.count / 3).toBe(countTriangles(parts));
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.max.x).toBeCloseTo(3.5, 4);
    expect(mesh.geometry.boundingBox!.min.x).toBeCloseTo(-0.25, 4);
  });

  it("bakes the part's color into the vertices", () => {
    const [mesh] = meshes(buildExportScene([part(1, { color: "#ff0000" })], merged));
    const colors = mesh.geometry.getAttribute("color");
    expect(colors.getX(0)).toBeCloseTo(1, 4);
    expect(colors.getY(0)).toBeCloseTo(0, 4);
    expect((mesh.material as THREE.MeshStandardMaterial).color.getHex()).toBe(0xffffff);
  });

  it("does not tint pieces with their own color", () => {
    const list = meshes(buildExportScene([part(1, { block: "nature.oak", color: "#ff0000" })], merged));
    const trunkColors = list[0].geometry.getAttribute("color");
    let hasGreen = false;
    for (let i = 0; i < trunkColors.count; i++) {
      if (trunkColors.getY(i) > 0.01) hasGreen = true;
    }
    expect(hasGreen).toBe(true);
  });
});

describe("vertex color hint", () => {
  it("uses every material after the first primitive, with no visible area", () => {
    const scene = buildExportScene([part(1), part(2, { color: "#00ff00" })], options);
    addVertexColorHint(scene);
    const hint = scene.getObjectByName("_cores_por_vertice") as THREE.Mesh;

    const materials = hint.material as THREE.Material[];
    const used = hint.geometry.groups.slice(1).map((group) => materials[group.materialIndex!]);
    expect(new Set(used).size).toBe(2);

    const position = hint.geometry.getAttribute("position");
    for (let i = 0; i < position.count; i++) {
      expect([position.getX(i), position.getY(i), position.getZ(i)]).toEqual([0, 0, 0]);
    }
  });

  it("adds nothing to an empty scene", () => {
    const scene = buildExportScene([], options);
    addVertexColorHint(scene);
    expect(scene.getObjectByName("_cores_por_vertice")).toBeUndefined();
  });
});

describe("centering", () => {
  it("puts the base of the model at the origin", () => {
    const scene = buildExportScene([part(1, { position: [10, 5, -4] })], { ...options, center: true });
    scene.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(scene);
    expect(box.min.y).toBeCloseTo(0, 5);
    expect((box.min.x + box.max.x) / 2).toBeCloseTo(0, 5);
    expect((box.min.z + box.max.z) / 2).toBeCloseTo(0, 5);
  });
});
