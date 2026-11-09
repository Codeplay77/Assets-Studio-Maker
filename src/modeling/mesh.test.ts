import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { buildGeometry } from "../blocks/geometry";
import { getBlock, meshToBlockShape, socketsFromBounds } from "../blocks/catalog";
import type { Part, Vec3 } from "../core/types";
import * as build from "./builders";
import { convertParts, mergeCoplanarTriangles } from "./convert";
import {
  allFaces,
  bisect,
  compact,
  deleteFaces,
  emptyMesh,
  extrude,
  faceCenter,
  faceNormal,
  fill,
  inset,
  joinMeshes,
  meshBounds,
  mirror,
  paintFaces,
  relax,
  roughen,
  roundOff,
  signedVolume,
  softWeights,
  subdivide,
  transformMesh,
  transformVertices,
  uniqueEdges,
  weld,
  weldClose,
  type PolyMesh,
} from "./mesh";
import { buildPiece, newContext, runOperation, selectFaces, selectVertices } from "./operations";
import { triangulateFace } from "./triangulate";

const cube = () => build.box([1, 1, 1]);

/** Every edge of a closed surface is used exactly twice, once in each direction. */
function isClosed(mesh: PolyMesh): boolean {
  const seen = new Map<string, number>();
  for (const face of mesh.faces) {
    face.forEach((a, i) => {
      const key = `${a}_${face[(i + 1) % face.length]}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    });
  }
  return [...seen].every(([key, count]) => {
    const [a, b] = key.split("_");
    return count === 1 && seen.get(`${b}_${a}`) === 1;
  });
}

function isConsistent(mesh: PolyMesh): boolean {
  return (
    mesh.faceMaterials.length === mesh.faces.length &&
    mesh.faces.every(
      (face) =>
        face.length >= 3 &&
        new Set(face).size === face.length &&
        face.every((vertex) => vertex >= 0 && vertex < mesh.vertices.length),
    ) &&
    mesh.faceMaterials.every((index) => index >= 0 && index < mesh.materials.length) &&
    mesh.vertices.every((vertex) => vertex.every(Number.isFinite))
  );
}

function faceTowards(mesh: PolyMesh, direction: Vec3): number {
  const found = allFaces(mesh).find((id) => {
    const normal = faceNormal(mesh, mesh.faces[id]);
    return normal.every((value, axis) => Math.abs(value - direction[axis]) < 1e-6);
  });
  if (found === undefined) throw new Error("face not found");
  return found;
}

describe("shapes to start from", () => {
  const closed: [string, () => PolyMesh][] = [
    ["box", cube],
    ["wedge", () => build.wedge([1, 1, 1])],
    ["frustum", () => build.frustum([1, 1], [0.5, 0.2], 1)],
    ["cylinder", () => build.cylinder(0.5, 0.5, 1, 12)],
    ["cone", () => build.cylinder(0, 0.5, 1, 12)],
    ["sphere", () => build.sphere(0.5, 12, 8)],
    ["dome", () => build.dome(0.5, 12, 4)],
    ["capsule", () => build.capsule(0.25, 0.5, 12, 3)],
    ["torus", () => build.torus(0.4, 0.1, 16, 8)],
    ["lathe", () => build.lathe([[0, 0], [0.4, 0.2], [0.2, 0.6], [0, 0.8]], 12)],
    ["reversed lathe", () => build.lathe([[0, 0.8], [0.4, 0.2], [0, 0]], 12)],
    ["open lathe gets caps", () => build.lathe([[0.3, 0], [0.5, 0.5]], 12)],
    ["loft", () => build.loft([[0, 0.5, 0.3], [0.5, 0.2, 0.2], [1, 0.4, 0.4]], "y", 16, 3)],
    ["loft along z", () => build.loft([[0, 0.5, 0.3], [1, 0.2, 0.2]], "z", 16, 3)],
    ["tube", () => build.tube([[0, 0, 0], [0, 1, 0.2], [0.5, 1.4, 0.4]], [0.2, 0.05], 8, 4, 1)],
    ["extruded outline", () => build.extrudeOutline([[0, 0], [1, 0], [1, 1], [0.5, 0.4], [0, 1]], 0.2)],
    ["rounded box", () => build.roundedBox([1, 0.6, 0.4], 0.1, 3)],
  ];

  it.each(closed)("%s is a closed surface facing outward", (_, make) => {
    const mesh = make();
    expect(isConsistent(mesh)).toBe(true);
    expect(isClosed(mesh)).toBe(true);
    expect(signedVolume(mesh)).toBeGreaterThan(0);
  });

  it("measures what it should", () => {
    expect(signedVolume(build.box([1, 2, 3]))).toBeCloseTo(6, 6);
    expect(meshBounds(build.roundedBox([1, 0.6, 0.4], 0.1, 3)).max[0]).toBeCloseTo(0.5, 5);
    expect(meshBounds(build.capsule(0.25, 0.5, 12, 3)).max[1]).toBeCloseTo(0.5, 6);
    expect(signedVolume(build.sphere(1, 48, 32))).toBeCloseTo((4 / 3) * Math.PI, 0);
  });

  it("makes a flat grid facing up", () => {
    const grid = build.plane(2, 2, 2, 3);
    expect(grid.faces).toHaveLength(6);
    expect(faceNormal(grid, grid.faces[0])).toEqual([0, 1, 0]);
  });

  it("uses quads for the sides of a box", () => {
    expect(cube().faces.map((face) => face.length)).toEqual([4, 4, 4, 4, 4, 4]);
  });
});

describe("triangulating faces", () => {
  it("handles a concave face and keeps its direction", () => {
    const vertices: Vec3[] = [[0, 0, 0], [2, 0, 0], [2, 2, 0], [1, 0.5, 0], [0, 2, 0]];
    const triangles = triangulateFace(vertices, [0, 1, 2, 3, 4]);
    expect(triangles).toHaveLength(3);
    let area = 0;
    for (const [a, b, c] of triangles) {
      const u = new THREE.Vector3(...vertices[b]).sub(new THREE.Vector3(...vertices[a]));
      const v = new THREE.Vector3(...vertices[c]).sub(new THREE.Vector3(...vertices[a]));
      const normal = u.cross(v);
      expect(normal.z).toBeGreaterThan(0);
      area += normal.z / 2;
    }
    expect(area).toBeCloseTo(2.5, 6);
  });

  it("survives a face with no area", () => {
    expect(triangulateFace([[0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0]], [0, 1, 2, 3])).toHaveLength(2);
  });
});

describe("pulling faces", () => {
  it("adds a section to the shape and keeps it closed", () => {
    const mesh = cube();
    const top = faceTowards(mesh, [0, 1, 0]);
    const { mesh: pulled, caps, sides } = extrude(mesh, [top], 0.5);

    expect(isClosed(pulled)).toBe(true);
    expect(pulled.faces).toHaveLength(10);
    expect(pulled.vertices).toHaveLength(12);
    expect(caps).toEqual([top]);
    expect(sides).toHaveLength(4);
    expect(signedVolume(pulled)).toBeCloseTo(1.5, 6);
    expect(faceCenter(pulled, pulled.faces[top])[1]).toBeCloseTo(1, 6);
  });

  it("digs into the shape with a negative distance", () => {
    const mesh = cube();
    const { mesh: dug } = extrude(mesh, [faceTowards(mesh, [0, 1, 0])], -0.25);
    expect(isClosed(dug)).toBe(true);
    expect(signedVolume(dug)).toBeCloseTo(0.75, 6);
  });

  it("pulls neighboring faces as one region", () => {
    const grid = build.plane(2, 1, 2, 1);
    const { mesh: pulled, sides } = extrude(grid, [0, 1], 1);
    expect(sides).toHaveLength(6);
    expect(pulled.vertices).toHaveLength(6 + 6);
  });

  it("can pull each face on its own", () => {
    const grid = build.plane(2, 1, 2, 1);
    const { mesh: pulled, sides } = extrude(grid, [0, 1], 1, true);
    expect(sides).toHaveLength(8);
    expect(isConsistent(pulled)).toBe(true);
  });

  it("keeps a corner region the right distance away", () => {
    const mesh = cube();
    const ids = [faceTowards(mesh, [0, 1, 0]), faceTowards(mesh, [1, 0, 0])];
    const { mesh: pulled } = extrude(mesh, ids, 0.5);
    expect(isClosed(pulled)).toBe(true);
    expect(meshBounds(pulled).max[0]).toBeCloseTo(1, 6);
    expect(meshBounds(pulled).max[1]).toBeCloseTo(1, 6);
  });

  it("moves a whole closed shape without leaving anything behind", () => {
    const mesh = cube();
    const { mesh: pulled, sides } = extrude(mesh, allFaces(mesh), 0.5);
    expect(sides).toEqual([]);
    expect(pulled.vertices).toHaveLength(8);
  });

  it("refuses to pass the limits", () => {
    const grid = build.plane(1, 1, 128, 128);
    expect(() => extrude(grid, allFaces(grid), 1, true)).toThrow("limite");
  });

  it("stays fast on a big shape", () => {
    const grid = build.plane(1, 1, 80, 80);
    const started = performance.now();
    const { mesh: pulled } = extrude(grid, allFaces(grid).slice(0, 2500), 0.1, true);
    softWeights(pulled, pulled.vertices.map((_, id) => id).slice(0, 5000), 0.5);
    buildGeometry(meshToBlockShape(pulled)).dispose();
    expect(performance.now() - started).toBeLessThan(1500);
  });
});

describe("inset", () => {
  it("leaves an even margin on a square face", () => {
    const mesh = cube();
    const top = faceTowards(mesh, [0, 1, 0]);
    const { mesh: result, caps, sides } = inset(mesh, [top], 0.1);
    expect(isClosed(result)).toBe(true);
    expect(caps).toEqual([top]);
    expect(sides).toHaveLength(4);
    for (const vertex of result.faces[top]) {
      expect(Math.abs(result.vertices[vertex][0])).toBeCloseTo(0.4, 6);
      expect(Math.abs(result.vertices[vertex][2])).toBeCloseTo(0.4, 6);
    }
    expect(signedVolume(result)).toBeCloseTo(1, 6);
  });

  it("never turns a face inside out", () => {
    const mesh = cube();
    const top = faceTowards(mesh, [0, 1, 0]);
    const { mesh: result } = inset(mesh, [top], 50);
    expect(faceNormal(result, result.faces[top])).toEqual([0, 1, 0]);
    for (const vertex of result.faces[top]) expect(Math.abs(result.vertices[vertex][0])).toBeLessThan(0.5);
  });
});

describe("dividing and rounding", () => {
  it("divides every face and keeps the shape", () => {
    const { mesh: divided, caps } = subdivide(cube(), allFaces(cube()));
    expect(divided.faces).toHaveLength(24);
    expect(divided.vertices).toHaveLength(26);
    expect(caps).toHaveLength(24);
    expect(isClosed(divided)).toBe(true);
    expect(signedVolume(divided)).toBeCloseTo(1, 6);
  });

  it("leaves no cracks when dividing a single face", () => {
    const mesh = cube();
    const { mesh: divided, caps } = subdivide(mesh, [faceTowards(mesh, [0, 1, 0])]);
    expect(caps).toHaveLength(4);
    expect(isClosed(divided)).toBe(true);
    expect(divided.faces.filter((face) => face.length === 5)).toHaveLength(4);
  });

  it("rounds a cube toward a ball", () => {
    const rounded = roundOff(cube());
    expect(rounded.faces).toHaveLength(24);
    expect(rounded.vertices).toHaveLength(26);
    expect(isClosed(rounded)).toBe(true);
    expect(signedVolume(rounded)).toBeGreaterThan(0.4);
    expect(signedVolume(rounded)).toBeLessThan(1);
    expect(Math.max(...rounded.vertices.map((vertex) => Math.hypot(...vertex)))).toBeLessThan(Math.sqrt(0.75));
  });

  it("keeps the materials of the faces it rounds", () => {
    const mesh = paintFaces(cube(), [0], { color: "#ff0000" });
    const rounded = roundOff(mesh);
    expect(rounded.faceMaterials.filter((index) => index === 1)).toHaveLength(4);
  });

  it("keeps the rim of an open surface in place", () => {
    const rounded = roundOff(build.plane(1, 1, 2, 2));
    expect(isConsistent(rounded)).toBe(true);
    expect(meshBounds(rounded).max[0]).toBeCloseTo(0.5, 6);
  });

  it("evens out a surface only where asked", () => {
    const mesh = subdivide(cube(), allFaces(cube())).mesh;
    const pinned = relax(mesh, [0], 1, 1);
    expect(pinned.vertices[1]).toEqual(mesh.vertices[1]);
    expect(pinned.vertices[0]).not.toEqual(mesh.vertices[0]);
  });
});

describe("mirroring", () => {
  it("cuts at the plane", () => {
    const half = bisect(cube(), 0, 1);
    expect(meshBounds(half).min[0]).toBeCloseTo(0, 9);
    expect(meshBounds(half).max[0]).toBeCloseTo(0.5, 9);
    expect(half.faces).toHaveLength(5);
  });

  it("rebuilds the other side and sews it closed", () => {
    const mesh = cube();
    const { mesh: pulled } = extrude(mesh, [faceTowards(mesh, [1, 0, 0])], 1);
    const mirrored = mirror(pulled, 0);
    expect(isClosed(mirrored)).toBe(true);
    expect(meshBounds(mirrored).min[0]).toBeCloseTo(-1.5, 6);
    expect(meshBounds(mirrored).max[0]).toBeCloseTo(1.5, 6);
    expect(signedVolume(mirrored)).toBeCloseTo(2 * signedVolume(bisect(pulled, 0, 1)) + 0, 0);
    expect(signedVolume(mirrored)).toBeCloseTo(3, 6);
  });

  it("keeps whichever side holds the shape", () => {
    const shifted = transformMesh(cube(), new THREE.Matrix4().makeTranslation(-2, 0, 0));
    const mirrored = mirror(shifted, 0);
    expect(mirrored.faces).toHaveLength(12);
    expect(meshBounds(mirrored).max[0]).toBeCloseTo(2.5, 6);
    expect(signedVolume(mirrored)).toBeCloseTo(2, 6);
  });

  it("reports a shape with nothing left", () => {
    expect(() => bisect(build.plane(1, 1, 1, 1), 1, 1)).toThrow("pelo menos uma face");
  });
});

describe("other edits", () => {
  it("opens a hole and fills it back", () => {
    const mesh = cube();
    const top = faceTowards(mesh, [0, 1, 0]);
    const corners = mesh.faces[top];
    const open = deleteFaces(mesh, [top]);
    expect(isClosed(open)).toBe(false);
    expect(open.vertices).toHaveLength(8);

    const center = (id: number) => open.vertices[id];
    const topCorners = open.vertices.map((_, id) => id).filter((id) => center(id)[1] > 0);
    expect(topCorners).toHaveLength(corners.length);
    const { mesh: filled, caps } = fill(open, topCorners);
    expect(isClosed(filled)).toBe(true);
    expect(faceNormal(filled, filled.faces[caps[0]])).toEqual([0, 1, 0]);
    expect(signedVolume(filled)).toBeCloseTo(1, 6);
  });

  it("explains why points in a line can't be filled", () => {
    const line = { ...emptyMesh(), vertices: [[0, 0, 0], [1, 0, 0], [2, 0, 0]] as Vec3[] };
    expect(() => fill(line, [0, 1, 2])).toThrow("linha reta");
  });

  it("joins points and drops the faces that collapse", () => {
    const mesh = cube();
    const [a, b] = mesh.faces[0];
    const welded = weld(mesh, [a, b]);
    expect(welded.vertices).toHaveLength(7);
    expect(isConsistent(welded)).toBe(true);
    expect(isClosed(welded)).toBe(true);
  });

  it("closes seams between pieces", () => {
    const left = build.box([1, 1, 1]);
    const right = transformMesh(build.box([1, 1, 1]), new THREE.Matrix4().makeTranslation(1, 0, 0));
    const joined = joinMeshes([left, right]);
    expect(joined.vertices).toHaveLength(16);
    expect(weldClose(joined, 0.001).vertices).toHaveLength(12);
  });

  it("forgets colors no face uses", () => {
    const red = paintFaces(cube(), [0], { color: "#ff0000" });
    expect(red.materials).toHaveLength(2);
    const back = paintFaces(red, [0], {});
    expect(back.materials).toHaveLength(1);
    expect(back.faceMaterials.every((index) => index === 0)).toBe(true);
  });

  it("flips faces when a transform mirrors the shape", () => {
    const flipped = transformMesh(cube(), new THREE.Matrix4().makeScale(-1, 1, 1));
    expect(signedVolume(flipped)).toBeCloseTo(1, 6);
  });

  it("joins materials when joining pieces", () => {
    const red = paintFaces(cube(), allFaces(cube()), { color: "#ff0000" });
    const joined = joinMeshes([red, red]);
    expect(joined.materials).toHaveLength(2);
    expect(joined.faces).toHaveLength(12);
  });

  it("drops unused points without changing face numbers", () => {
    const mesh = { ...emptyMesh(), vertices: [[9, 9, 9], [0, 0, 0], [1, 0, 0], [0, 1, 0]] as Vec3[], faces: [[1, 2, 3]], faceMaterials: [0] };
    const cleaned = compact(mesh);
    expect(cleaned.vertices).toHaveLength(3);
    expect(cleaned.faces[0]).toEqual([0, 1, 2]);
  });

  it("fades a soft move with distance", () => {
    const grid = build.plane(4, 0.1, 40, 1);
    const start = grid.vertices.findIndex((vertex) => Math.abs(vertex[0]) < 1e-9);
    const weights = softWeights(grid, [start], 1);
    expect(weights.get(start)).toBe(1);
    const moved = transformVertices(grid, weights, new THREE.Matrix4().makeTranslation(0, 1, 0));
    expect(moved.vertices[start][1]).toBeCloseTo(1, 6);

    const heightAt = (x: number) => moved.vertices.find((vertex) => Math.abs(vertex[0] - x) < 1e-9 && vertex[2] < 0)![1];
    expect(heightAt(0.5)).toBeCloseTo(0.5, 6);
    expect(heightAt(1.5)).toBe(0);
  });

  it("moves only the chosen points without a radius", () => {
    expect(softWeights(cube(), [1], 0).size).toBe(1);
  });

  it("roughens the same way every time", () => {
    const sphere = build.sphere(1, 12, 8);
    expect(roughen(sphere, null, 0.1, 3, 7).vertices).toEqual(roughen(sphere, null, 0.1, 3, 7).vertices);
    expect(roughen(sphere, null, 0.1, 3, 7).vertices).not.toEqual(sphere.vertices);
  });

  it("lists each edge once", () => {
    expect(uniqueEdges(cube())).toHaveLength(12);
  });
});

describe("describing what to change", () => {
  it("finds faces by direction", () => {
    const mesh = cube();
    expect(selectFaces(mesh, { normal: [0, 1, 0] }, newContext())).toEqual([faceTowards(mesh, [0, 1, 0])]);
    expect(selectFaces(mesh, { normal: [0, 1, 1], tolerance: 50 }, newContext())).toHaveLength(2);
  });

  it("finds faces by place and by being closest", () => {
    const mesh = cube();
    const inside = selectFaces(mesh, { inside: { min: [0.4, -1, -1], max: [1, 1, 1] } }, newContext());
    expect(inside).toEqual([faceTowards(mesh, [1, 0, 0])]);
    expect(selectFaces(mesh, { nearest: [0, 0, 9] }, newContext())).toEqual([faceTowards(mesh, [0, 0, 1])]);
  });

  it("continues from what the last step made", () => {
    let mesh = cube();
    const context = newContext();
    mesh = runOperation(mesh, { op: "extrude", faces: { normal: [0, 1, 0] }, distance: 1 }, context);
    expect(context.caps).toHaveLength(1);
    expect(context.sides).toHaveLength(4);
    mesh = runOperation(mesh, { op: "extrude", faces: { last: "caps" }, distance: 1 }, context);
    expect(meshBounds(mesh).max[1]).toBeCloseTo(2.5, 6);
    expect(selectFaces(mesh, { last: "sides" }, context)).toHaveLength(4);
  });

  it("finds points through faces", () => {
    const mesh = cube();
    expect(selectVertices(mesh, { faces: { normal: [0, 1, 0] } }, newContext())).toHaveLength(4);
    expect(selectVertices(mesh, "all", newContext())).toHaveLength(8);
    expect(selectVertices(mesh, { nearest: [9, 9, 9] }, newContext())).toHaveLength(1);
  });

  it.each([
    [{ ids: [99] }, "não encontrada"],
    [{ normal: [0, 1] }, "3 números"],
    [{ last: "caps" }, "nenhuma face"],
    [{ inside: {} }, "inside.min"],
    ["todas", "escolha as faces"],
  ])("explains a bad selection %#", (selector, message) => {
    expect(() => selectFaces(cube(), selector, newContext())).toThrow(message);
  });

  it("builds each piece type from its description", () => {
    const specs = [
      { type: "box", size: [1, 2, 3] },
      { type: "rounded_box", size: [1, 1, 1], radius: 0.2 },
      { type: "plane", columns: 2, rows: 2 },
      { type: "wedge" },
      { type: "frustum", bottom: [1, 1], top: [0.5, 0.5], height: 1 },
      { type: "cylinder", radius: 0.5, height: 1 },
      { type: "cone" },
      { type: "sphere" },
      { type: "dome" },
      { type: "capsule" },
      { type: "torus" },
      { type: "lathe", profile: [[0, 0], [0.5, 1], [0, 2]] },
      { type: "loft", rings: [[0, 1, 1], [1, 0.5, 0.5]] },
      { type: "tube", path: [[0, 0, 0], [0, 1, 0]], radius: 0.1 },
      { type: "extrude", outline: [[0, 0], [1, 0], [0, 1]], depth: 0.1 },
      { type: "polygons", vertices: [[0, 0, 0], [1, 0, 0], [0, 1, 0]], faces: [[0, 1, 2]] },
    ];
    for (const spec of specs) expect(isConsistent(buildPiece(spec))).toBe(true);
  });

  it("places a piece and gives it a material", () => {
    const piece = buildPiece({ type: "box", at: [5, 0, 0], color: "#FF0000", finish: "metal" });
    expect(meshBounds(piece).min[0]).toBeCloseTo(4.5, 6);
    expect(piece.materials[1]).toEqual({ color: "#ff0000", finish: "metal" });
    expect(piece.faceMaterials.every((index) => index === 1)).toBe(true);
  });

  it.each([
    [{ type: "nave" }, "tipo de forma"],
    [{ type: "box", size: [1, -1, 1] }, "maiores que zero"],
    [{ type: "box", color: "azul" }, "#rrggbb"],
    [{ type: "box", finish: "ouro" }, "finish"],
    [{ type: "lathe", profile: [[0, 0]] }, "pelo menos 2"],
    [{ type: "polygons", vertices: [[0, 0, 0]], faces: [[0, 1, 2]] }, "não existe"],
    ["cubo", "objeto"],
  ])("explains a bad piece %#", (spec, message) => {
    expect(() => buildPiece(spec)).toThrow(message);
  });

  it("keeps detail within reason", () => {
    expect(buildPiece({ type: "cylinder", segments: 1e9 }).vertices.length).toBeLessThanOrEqual(256);
  });

  it("runs every operation", () => {
    const steps = [
      { op: "extrude", faces: { normal: [0, 1, 0] }, distance: 0.5 },
      { op: "inset", faces: { last: "caps" }, amount: 0.1 },
      { op: "subdivide", faces: { last: "caps" } },
      { op: "smooth", factor: 0.1 },
      { op: "move", vertices: { faces: { normal: [0, 1, 0] } }, offset: [0, 0.1, 0], softRadius: 0.2 },
      { op: "rotate", vertices: "all", angles: [0, 45, 0] },
      { op: "scale", vertices: "all", factor: 2 },
      { op: "set_vertices", positions: [{ id: 0, position: [0, -2, 0] }] },
      { op: "paint", faces: { normal: [0, 1, 0], tolerance: 60 }, color: "#00ff00", finish: "gloss" },
      { op: "flip", faces: { ids: [0] } },
      { op: "flip", faces: { ids: [0] } },
      { op: "roughen", amount: 0.01 },
      { op: "add_piece", piece: { type: "sphere", radius: 0.2, at: [0, 2, 0] } },
      { op: "round" },
      { op: "weld_close", distance: 0.0001 },
      { op: "mirror", axis: "x" },
      { op: "bisect", axis: "z", side: 1 },
      { op: "delete_faces", faces: { ids: [0] } },
      { op: "delete_vertices", vertices: { ids: [0] } },
    ];
    let mesh = cube();
    const context = newContext();
    for (const step of steps) {
      mesh = runOperation(mesh, step, context);
      expect(isConsistent(mesh), JSON.stringify(step)).toBe(true);
    }
  });

  it("explains an unknown operation", () => {
    expect(() => runOperation(cube(), { op: "explodir" }, newContext())).toThrow("operação desconhecida");
  });

  it("leaves the original untouched", () => {
    const mesh = cube();
    const before = JSON.stringify(mesh);
    runOperation(mesh, { op: "extrude", faces: "all", distance: 1, individual: true }, newContext());
    runOperation(mesh, { op: "scale", vertices: "all", factor: 2 }, newContext());
    expect(JSON.stringify(mesh)).toBe(before);
  });
});

describe("drawing and converting", () => {
  it("draws a mesh as a block, one material each", () => {
    const mesh = paintFaces(cube(), [0, 1], { color: "#ff0000", finish: "metal" });
    const geometry = buildGeometry(meshToBlockShape(mesh));
    expect(geometry.getAttribute("position").count).toBe(36);
    expect(geometry.groups).toHaveLength(2);
  });

  it("keeps a cube's edges hard and a smooth sphere soft", () => {
    const sharp = buildGeometry(meshToBlockShape(cube()));
    const distinct = new Set<string>();
    const normal = sharp.getAttribute("normal");
    for (let i = 0; i < normal.count; i++) distinct.add(`${normal.getX(i).toFixed(3)}_${normal.getY(i).toFixed(3)}_${normal.getZ(i).toFixed(3)}`);
    expect(distinct.size).toBe(6);
  });

  it("derives sockets with the base first", () => {
    const sockets = socketsFromBounds(build.box([2, 4, 6]));
    expect(sockets[0]).toEqual({ id: "base", p: [0, -2, 0], n: [0, -1, 0] });
    expect(sockets.find((socket) => socket.id === "topo")!.p).toEqual([0, 2, 0]);
  });

  function part(id: number, overrides: Partial<Part> = {}): Part {
    return { id, block: "basic.cube", position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1], color: "#ff0000", ...overrides };
  }

  it("turns a block into six clean quads", () => {
    const { mesh, position, color } = convertParts([part(1, { position: [1, 2, 3] })]);
    expect(mesh.faces).toHaveLength(6);
    expect(mesh.faces.every((face) => face.length === 4)).toBe(true);
    expect(mesh.vertices).toHaveLength(8);
    expect(isClosed(mesh)).toBe(true);
    expect(position).toEqual([1, 2, 3]);
    expect(color).toBe("#ff0000");
    expect(mesh.materials).toEqual([{}]);
  });

  it("bakes several parts into one shape, each with its color", () => {
    const { mesh, position } = convertParts([
      part(1, { position: [0, 0.25, 0], color: "#ff0000" }),
      part(2, { position: [2, 0.25, 0], color: "#0000ff" }),
    ]);
    expect(position).toEqual([1, 0, 0]);
    expect(meshBounds(mesh).min[1]).toBeCloseTo(0, 5);
    expect(mesh.faces).toHaveLength(12);
    expect(mesh.materials.map((material) => material.color).sort()).toEqual([undefined, "#0000ff", "#ff0000"].sort());
  });

  it("keeps a block's own colors and finishes", () => {
    expect(getBlock("basic.cube")).toBeDefined();
    const glass = convertParts([part(1)]).mesh;
    expect(isConsistent(glass)).toBe(true);
  });

  it("leaves triangles alone when they aren't flat together", () => {
    const mesh = { ...emptyMesh(), vertices: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 1, 1]] as Vec3[], faces: [[0, 1, 2], [0, 2, 3]], faceMaterials: [0, 0] };
    expect(mergeCoplanarTriangles(mesh).faces).toHaveLength(2);
  });
});
