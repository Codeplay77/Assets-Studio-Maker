import { describe, expect, it } from "vitest";
import type { Vec3 } from "../core/types";
import { bevel } from "./bevel";
import { booleanMeshes } from "./boolean";
import * as build from "./builders";
import { extrude, joinMeshes, length, meshBounds, roundOff, signedVolume, sub, type PolyMesh } from "./mesh";
import { buildPiece, newContext, runOperation, selectEdges } from "./operations";
import { SculptStroke, sculptPath } from "./sculpt";

/** Every edge used exactly once in each direction: no cracks, nothing inside out. */
function openEdges(mesh: PolyMesh): number {
  const count = new Map<string, number>();
  for (const face of mesh.faces) {
    face.forEach((a, i) => {
      const key = `${a}_${face[(i + 1) % face.length]}`;
      count.set(key, (count.get(key) ?? 0) + 1);
    });
  }
  let open = 0;
  for (const [key, uses] of count) {
    const [a, b] = key.split("_");
    if (uses !== 1 || count.get(`${b}_${a}`) !== 1) open++;
  }
  return open;
}

function validFaces(mesh: PolyMesh): boolean {
  return mesh.faces.every(
    (face) => face.length >= 3 && face.length <= 256 && new Set(face).size === face.length && face.every((id) => id < mesh.vertices.length),
  );
}

const cube = () => build.box([1, 1, 1]);
const cylinderThrough = (radius = 0.2) => buildPiece({ type: "cylinder", radius, height: 3, segments: 16 });
const edgeNear = (mesh: PolyMesh, a: Vec3, b: Vec3): [number, number] => {
  const closest = (target: Vec3) => mesh.vertices.findIndex((vertex) => length(sub(vertex, target)) < 1e-6);
  return [closest(a), closest(b)];
};

describe("cutting and joining shapes", () => {
  it("drills a hole with no cracks and the right volume", () => {
    const result = booleanMeshes(cube(), cylinderThrough(0.2), "subtract");
    expect(validFaces(result)).toBe(true);
    expect(openEdges(result)).toBe(0);
    // A 16-sided polygon of radius r has area 8 r² sin(22.5°).
    const expected = 1 - 8 * 0.2 ** 2 * Math.sin(Math.PI / 8);
    expect(signedVolume(result)).toBeCloseTo(expected, 3);
  });

  it("leaves flat areas as a few clean faces", () => {
    const result = booleanMeshes(cube(), cylinderThrough(0.2), "subtract");
    // 4 sides, 16 walls, and two faces wrapped around the hole on the top and on the bottom.
    expect(result.faces.length).toBeLessThanOrEqual(24);
  });

  it("joins overlapping shapes into one surface", () => {
    const other = buildPiece({ type: "box", size: [1, 1, 1], at: [0.5, 0, 0] });
    const result = booleanMeshes(cube(), other, "union");
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeCloseTo(1.5, 4);
    // The two touching halves merge into plain box sides.
    expect(result.faces.length).toBeLessThanOrEqual(14);
  });

  it("keeps only what is common", () => {
    const other = buildPiece({ type: "box", size: [1, 1, 1], at: [0.5, 0.5, 0.5] });
    const result = booleanMeshes(cube(), other, "intersect");
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeCloseTo(0.125, 4);
  });

  it("says so when two shapes have nothing in common", () => {
    const far = buildPiece({ type: "box", size: [1, 1, 1], at: [5, 0, 0] });
    expect(() => booleanMeshes(cube(), far, "intersect")).toThrow("não se encostam");
  });

  it("gives the walls of the cut the color of the tool", () => {
    const tool = buildPiece({ type: "cylinder", radius: 0.2, height: 3, segments: 16, color: "#ff0000" });
    const result = booleanMeshes(cube(), tool, "subtract");
    const red = result.materials.findIndex((material) => material.color === "#ff0000");
    expect(red).toBeGreaterThan(0);
    expect(result.faceMaterials.filter((material) => material === red)).toHaveLength(16);
  });

  it("can keep being edited afterwards", () => {
    const result = booleanMeshes(cube(), cylinderThrough(0.2), "subtract");
    const rounded = roundOff(result);
    expect(openEdges(rounded)).toBe(0);
    const pulled = extrude(result, [0], 0.2);
    expect(openEdges(pulled.mesh)).toBe(0);
  });

  it("cuts curved shapes too", () => {
    const sphere = buildPiece({ type: "sphere", radius: 0.5, segments: 24, rows: 16 });
    const result = booleanMeshes(sphere, cylinderThrough(0.15), "subtract");
    expect(validFaces(result)).toBe(true);
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeLessThan(signedVolume(sphere));
  });

  it("is fast on detailed shapes", () => {
    const sphere = buildPiece({ type: "sphere", radius: 0.5, segments: 96, rows: 48 });
    const started = performance.now();
    booleanMeshes(sphere, cylinderThrough(0.15), "subtract");
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe("the boolean and hole operations", () => {
  it("cuts with a piece", () => {
    const result = runOperation(cube(), { op: "boolean", mode: "subtract", piece: { type: "sphere", radius: 0.3, at: [0, 0.5, 0] } }, newContext());
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeLessThan(1);
  });

  it("cuts with another shape of the project", () => {
    const tool = buildPiece({ type: "box", size: [0.4, 2, 0.4] });
    const context = newContext((id) => (id === "shape.2" ? tool : undefined));
    const result = runOperation(cube(), { op: "boolean", mode: "subtract", shape: "shape.2", at: [0.1, 0, 0] }, context);
    expect(signedVolume(result)).toBeCloseTo(1 - 0.16, 4);
    expect(() => runOperation(cube(), { op: "boolean", mode: "subtract", shape: "shape.9" }, context)).toThrow("não encontrada");
  });

  it("refuses an unknown mode", () => {
    expect(() => runOperation(cube(), { op: "boolean", mode: "melt", piece: { type: "box" } }, newContext())).toThrow("mode");
  });

  it("drills through a face when no depth is given", () => {
    const result = runOperation(cube(), { op: "hole", faces: { normal: [0, 1, 0] }, size: 0.3, shape: "square" }, newContext());
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeCloseTo(1 - 0.09, 4);
  });

  it("stops at the depth asked for", () => {
    const result = runOperation(cube(), { op: "hole", faces: { normal: [0, 1, 0] }, size: 0.4, shape: "square", depth: 0.25 }, newContext());
    expect(signedVolume(result)).toBeCloseTo(1 - 0.16 * 0.25, 4);
  });

  it("follows the direction of a slanted face", () => {
    const wedge = buildPiece({ type: "wedge", size: [1, 1, 1] });
    const result = runOperation(wedge, { op: "hole", faces: { normal: [0, 1, 1], tolerance: 30 }, size: 0.2, depth: 0.1 }, newContext());
    expect(openEdges(result)).toBe(0);
    expect(signedVolume(result)).toBeLessThan(signedVolume(wedge));
  });
});

describe("beveling edges", () => {
  const top: [Vec3, Vec3] = [
    [0.5, 0.5, 0.5],
    [0.5, 0.5, -0.5],
  ];

  it("cuts one edge of a cube", () => {
    const mesh = cube();
    const result = bevel(mesh, [edgeNear(mesh, ...top)], 0.1);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
    expect(result.mesh.vertices).toHaveLength(10);
    expect(result.mesh.faces).toHaveLength(7);
    expect(result.caps).toHaveLength(1);
    expect(signedVolume(result.mesh)).toBeCloseTo(1 - 0.1 * 0.1 * 0.5, 6);
  });

  it("makes a curve with more segments", () => {
    const mesh = cube();
    const result = bevel(mesh, [edgeNear(mesh, ...top)], 0.2, 5);
    expect(openEdges(result.mesh)).toBe(0);
    expect(result.caps).toHaveLength(5);
    expect(signedVolume(result.mesh)).toBeLessThan(1);
    expect(signedVolume(result.mesh)).toBeGreaterThan(1 - 0.2 * 0.2 * 0.5);
  });

  it("cuts every edge of a cube", () => {
    const mesh = cube();
    const edges = selectEdges(mesh, "all", newContext());
    const result = bevel(mesh, edges, 0.1);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
    expect(result.mesh.faces).toHaveLength(6 + 12 + 8);
    expect(result.mesh.vertices).toHaveLength(24);
  });

  it("rounds every edge of a cube", () => {
    const mesh = cube();
    const result = bevel(mesh, selectEdges(mesh, "all", newContext()), 0.15, 4);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
    expect(signedVolume(result.mesh)).toBeGreaterThan(0.85);
  });

  it("cuts around a whole loop, like the rim of a cylinder", () => {
    const mesh = buildPiece({ type: "cylinder", radius: 0.5, height: 1, segments: 16 });
    const edges = selectEdges(mesh, { faces: { normal: [0, 1, 0] } }, newContext());
    expect(edges).toHaveLength(16);
    const result = bevel(mesh, edges, 0.05, 3);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
    expect(result.caps).toHaveLength(48);
  });

  it("never lets a wide cut pass through the shape", () => {
    const mesh = cube();
    const result = bevel(mesh, [edgeNear(mesh, ...top)], 5);
    expect(openEdges(result.mesh)).toBe(0);
    expect(signedVolume(result.mesh)).toBeGreaterThan(0.8);
  });

  it("cuts two edges that meet", () => {
    const mesh = cube();
    const result = bevel(mesh, [edgeNear(mesh, ...top), edgeNear(mesh, [0.5, 0.5, 0.5], [-0.5, 0.5, 0.5])], 0.1, 2);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
  });

  it("works on an edge of an open surface's inside", () => {
    const plane = build.plane(1, 1, 2, 2);
    const inner = selectEdges(plane, { sharp: 0 }, newContext());
    const result = bevel(plane, inner.slice(0, 1), 0.05);
    expect(validFaces(result.mesh)).toBe(true);
  });

  it("refuses edges with only one face", () => {
    const plane = build.plane(1, 1, 1, 1);
    expect(() => bevel(plane, [[plane.faces[0][0], plane.faces[0][1]]], 0.1)).toThrow("entre duas faces");
  });

  it("finds sharp edges and leaves curved ones alone", () => {
    const mesh = buildPiece({ type: "cylinder", radius: 0.5, height: 1, segments: 32 });
    expect(selectEdges(mesh, { sharp: 40 }, newContext())).toHaveLength(64);
  });

  it("is available as an operation", () => {
    const context = newContext();
    const result = runOperation(cube(), { op: "bevel", edges: { sharp: 30 }, amount: 0.1 }, context);
    expect(openEdges(result)).toBe(0);
    expect(context.caps).toHaveLength(12);
  });

  it("cuts a surface that touches another at a single point", () => {
    const first = cube();
    const second = buildPiece({ type: "box", size: [1, 1, 1], at: [1, 1, 1] });
    const joined = joinMeshes([first, second]);
    const shared = joined.vertices.findIndex((vertex) => length(sub(vertex, [0.5, 0.5, 0.5])) < 1e-6);
    const other = joined.vertices.map((vertex) => length(sub(vertex, [0.5, 0.5, 0.5])) < 1e-6).lastIndexOf(true);
    const pinched = { ...joined, faces: joined.faces.map((face) => face.map((vertex) => (vertex === other ? shared : vertex))) };
    const result = bevel(pinched, selectEdges(pinched, "all", newContext()), 0.05);
    expect(validFaces(result.mesh)).toBe(true);
    expect(openEdges(result.mesh)).toBe(0);
  });

  it("stays valid after a cut made by a boolean", () => {
    const cut = booleanMeshes(cube(), cylinderThrough(0.2), "subtract");
    const result = runOperation(cut, { op: "bevel", edges: { sharp: 60 }, amount: 0.02 }, newContext());
    expect(validFaces(result)).toBe(true);
    expect(openEdges(result)).toBe(0);
  });
});

describe("the sculpting brush", () => {
  const grid = () => build.plane(4, 4, 40, 40);
  const heightAt = (mesh: PolyMesh, x: number, z: number) => {
    const found = mesh.vertices.reduce((best, vertex) =>
      Math.hypot(vertex[0] - x, vertex[2] - z) < Math.hypot(best[0] - x, best[2] - z) ? vertex : best,
    );
    return found[1];
  };
  const settings = { radius: 0.8, strength: 1, symmetry: false };

  it("raises the surface under the brush and leaves the rest", () => {
    const result = sculptPath(grid(), { ...settings, kind: "raise" }, [[0, 0, 0]]);
    expect(heightAt(result, 0, 0)).toBeGreaterThan(0.05);
    expect(heightAt(result, 1.8, 1.8)).toBe(0);
  });

  it("lowers it", () => {
    const result = sculptPath(grid(), { ...settings, kind: "lower" }, [[0, 0, 0]]);
    expect(heightAt(result, 0, 0)).toBeLessThan(-0.05);
  });

  it("fills in the path between far points", () => {
    const result = sculptPath(grid(), { ...settings, kind: "raise" }, [[-1, 0, 0], [1, 0, 0]]);
    expect(heightAt(result, 0, 0)).toBeGreaterThan(0.05);
  });

  it("mirrors across X when symmetry is on", () => {
    const result = sculptPath(grid(), { ...settings, kind: "raise", symmetry: true }, [[1, 0, 0]]);
    expect(heightAt(result, -1, 0)).toBeCloseTo(heightAt(result, 1, 0), 5);
  });

  it("smooths a bump", () => {
    const raised = sculptPath(grid(), { ...settings, radius: 0.3, kind: "raise" }, [[0, 0, 0]]);
    const smoothed = sculptPath(raised, { ...settings, kind: "smooth" }, [[0, 0, 0]]);
    expect(heightAt(smoothed, 0, 0)).toBeLessThan(heightAt(raised, 0, 0));
  });

  it("flattens a bump", () => {
    const raised = sculptPath(grid(), { ...settings, radius: 0.5, kind: "raise" }, [[0, 0, 0]]);
    const flat = sculptPath(raised, { ...settings, kind: "flatten" }, [[0, 0, 0]]);
    expect(heightAt(flat, 0, 0)).toBeLessThan(heightAt(raised, 0, 0));
  });

  it("grabs and carries the surface", () => {
    const result = sculptPath(grid(), { ...settings, kind: "grab" }, [[0, 0, 0]], [0, 0.5, 0]);
    expect(heightAt(result, 0, 0)).toBeCloseTo(0.5, 2);
    expect(heightAt(result, 1.5, 0)).toBe(0);
  });

  it("does not change the original", () => {
    const mesh = grid();
    const before = meshBounds(mesh);
    new SculptStroke(mesh, { ...settings, kind: "raise" }).paint([0, 0, 0]);
    expect(meshBounds(mesh)).toEqual(before);
  });

  it("is available as an operation, and checks its input", () => {
    const result = runOperation(grid(), { op: "sculpt", brush: "raise", path: [[0, 0, 0]], radius: 0.8, strength: 1 }, newContext());
    expect(heightAt(result, 0, 0)).toBeGreaterThan(0.05);
    expect(() => runOperation(grid(), { op: "sculpt", brush: "melt", path: [[0, 0, 0]] }, newContext())).toThrow("brush");
    expect(() => runOperation(grid(), { op: "sculpt", brush: "raise", path: [] }, newContext())).toThrow("path");
  });

  it("is fast enough to follow the mouse", () => {
    const big = build.plane(4, 4, 120, 120);
    const stroke = new SculptStroke(big, { ...settings, kind: "raise" });
    const started = performance.now();
    for (let i = 0; i < 60; i++) stroke.paint([-1.5 + i * 0.05, 0, 0]);
    expect(performance.now() - started).toBeLessThan(1000);
  });
});
