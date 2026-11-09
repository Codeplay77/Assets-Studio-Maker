import * as THREE from "three";
import type { ShapeMaterial, Vec3 } from "../core/types";
import { triangulateFace } from "./triangulate";

export const MAX_VERTICES = 20_000;
export const MAX_FACES = 20_000;
export const DEFAULT_SMOOTH_ANGLE = 35;

const ON_PLANE = 1e-6;
const MIN_MITER = 0.35;
const MIN_INSET_MITER = 0.2;
const MAX_INSET_REACH = 0.95;
const MIN_SIDES = 3;

/** Every shape is one of these, whether it started as a cube, a profile or a list of points. */
export interface PolyMesh {
  vertices: Vec3[];
  faces: number[][];
  /** Parallel to `faces`. */
  faceMaterials: number[];
  /** The first one has no color, so those faces follow the color of the part. */
  materials: ShapeMaterial[];
  smoothAngle: number;
}

export type Axis = 0 | 1 | 2;

/** What an operation produced, so the next step can act on it. */
export interface FaceResult {
  mesh: PolyMesh;
  caps: number[];
  sides: number[];
}

export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const times = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
export const dot = (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export const length = (a: Vec3): number => Math.hypot(a[0], a[1], a[2]);

export function normalize(a: Vec3): Vec3 {
  const size = length(a);
  return size < 1e-12 ? [0, 0, 0] : times(a, 1 / size);
}

function average(points: Vec3[]): Vec3 {
  return times(points.reduce(add, [0, 0, 0] as Vec3), 1 / points.length);
}

const edgeKey = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
const directedKey = (a: number, b: number) => `${a}_${b}`;

export function emptyMesh(): PolyMesh {
  return { vertices: [], faces: [], faceMaterials: [], materials: [{}], smoothAngle: DEFAULT_SMOOTH_ANGLE };
}

export function cloneMesh(mesh: PolyMesh): PolyMesh {
  return {
    vertices: mesh.vertices.map((vertex) => [...vertex] as Vec3),
    faces: mesh.faces.map((face) => [...face]),
    faceMaterials: [...mesh.faceMaterials],
    materials: mesh.materials.map((material) => ({ ...material })),
    smoothAngle: mesh.smoothAngle,
  };
}

export function allFaces(mesh: PolyMesh): number[] {
  return mesh.faces.map((_, index) => index);
}

export function faceNormal(mesh: PolyMesh, face: readonly number[]): Vec3 {
  let x = 0;
  let y = 0;
  let z = 0;
  for (let i = 0; i < face.length; i++) {
    const a = mesh.vertices[face[i]];
    const b = mesh.vertices[face[(i + 1) % face.length]];
    x += (a[1] - b[1]) * (a[2] + b[2]);
    y += (a[2] - b[2]) * (a[0] + b[0]);
    z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normalize([x, y, z]);
}

export function faceCenter(mesh: PolyMesh, face: readonly number[]): Vec3 {
  return average(face.map((index) => mesh.vertices[index]));
}

export function meshBounds(mesh: PolyMesh): { min: Vec3; max: Vec3 } {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const vertex of mesh.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return { min, max };
}

function assertWithinLimits(vertices: number, faces: number): void {
  if (vertices > MAX_VERTICES || faces > MAX_FACES) {
    throw new Error(`a forma passaria do limite de ${MAX_VERTICES} vértices e ${MAX_FACES} faces`);
  }
}

function assertNotEmpty(mesh: PolyMesh): PolyMesh {
  if (mesh.faces.length === 0) throw new Error("a forma precisa continuar com pelo menos uma face");
  return mesh;
}

/** Drops unused vertices. Face indices don't change. */
export function compact(mesh: PolyMesh): PolyMesh {
  const remap = new Int32Array(mesh.vertices.length).fill(-1);
  const vertices: Vec3[] = [];
  const faces = mesh.faces.map((face) =>
    face.map((index) => {
      if (remap[index] < 0) {
        remap[index] = vertices.length;
        vertices.push(mesh.vertices[index]);
      }
      return remap[index];
    }),
  );
  return { ...mesh, vertices, faces };
}

/** Removes repeated corners and the faces that collapse because of them. */
function removeCollapsedFaces(mesh: PolyMesh): PolyMesh {
  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  mesh.faces.forEach((face, index) => {
    const corners = face.filter((vertex, i) => vertex !== face[(i + 1) % face.length]);
    if (corners.length >= MIN_SIDES && new Set(corners).size === corners.length) {
      faces.push(corners);
      faceMaterials.push(mesh.faceMaterials[index]);
    }
  });
  return compact({ ...mesh, faces, faceMaterials });
}

export function signedVolume(mesh: PolyMesh): number {
  let volume = 0;
  for (const face of mesh.faces) {
    const a = mesh.vertices[face[0]];
    for (let i = 1; i < face.length - 1; i++) {
      volume += dot(a, cross(mesh.vertices[face[i]], mesh.vertices[face[i + 1]])) / 6;
    }
  }
  return volume;
}

export function flipFaces(mesh: PolyMesh, ids: readonly number[]): PolyMesh {
  const chosen = new Set(ids);
  return { ...mesh, faces: mesh.faces.map((face, index) => (chosen.has(index) ? [...face].reverse() : face)) };
}

/** A closed shape built inside out would look black and export wrong. */
export function orientOutward(mesh: PolyMesh): PolyMesh {
  return signedVolume(mesh) < 0 ? flipFaces(mesh, allFaces(mesh)) : mesh;
}

function sameMaterial(a: ShapeMaterial, b: ShapeMaterial): boolean {
  return a.color === b.color && a.shade === b.shade && a.finish === b.finish;
}

function materialIndex(materials: ShapeMaterial[], wanted: ShapeMaterial): number {
  const found = materials.findIndex((material) => sameMaterial(material, wanted));
  if (found >= 0) return found;
  materials.push(wanted);
  return materials.length - 1;
}

/** Forgets materials no face uses anymore. The first one always stays. */
function pruneMaterials(mesh: PolyMesh): PolyMesh {
  const used = new Set([0, ...mesh.faceMaterials]);
  const remap = new Map<number, number>();
  const materials: ShapeMaterial[] = [];
  mesh.materials.forEach((material, index) => {
    if (!used.has(index)) return;
    remap.set(index, materials.length);
    materials.push(material);
  });
  return { ...mesh, materials, faceMaterials: mesh.faceMaterials.map((index) => remap.get(index)!) };
}

export function joinMeshes(meshes: readonly PolyMesh[]): PolyMesh {
  const joined = emptyMesh();
  joined.smoothAngle = meshes[0]?.smoothAngle ?? DEFAULT_SMOOTH_ANGLE;
  for (const mesh of meshes) {
    const start = joined.vertices.length;
    const remap = mesh.materials.map((material) => materialIndex(joined.materials, material));
    joined.vertices.push(...mesh.vertices);
    mesh.faces.forEach((face, index) => {
      joined.faces.push(face.map((vertex) => vertex + start));
      joined.faceMaterials.push(remap[mesh.faceMaterials[index]]);
    });
  }
  assertWithinLimits(joined.vertices.length, joined.faces.length);
  return joined;
}

export function transformMesh(mesh: PolyMesh, matrix: THREE.Matrix4): PolyMesh {
  const point = new THREE.Vector3();
  const vertices = mesh.vertices.map((vertex) => point.set(...vertex).applyMatrix4(matrix).toArray() as Vec3);
  const moved = { ...mesh, vertices };
  // A mirroring transform turns every face inside out.
  return matrix.determinant() < 0 ? flipFaces(moved, allFaces(moved)) : moved;
}

/** How much each vertex follows a move: 1 for the chosen ones, fading out to `radius` around them. */
export function softWeights(mesh: PolyMesh, ids: readonly number[], radius: number): Map<number, number> {
  const weights = new Map(ids.map((id) => [id, 1]));
  if (radius <= 0) return weights;

  const cell = (value: number) => Math.floor(value / radius);
  const grid = new Map<string, Vec3[]>();
  for (const id of ids) {
    const point = mesh.vertices[id];
    const key = `${cell(point[0])}_${cell(point[1])}_${cell(point[2])}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(point);
    else grid.set(key, [point]);
  }

  mesh.vertices.forEach((point, index) => {
    if (weights.has(index)) return;
    let nearest = radius * radius;
    for (let x = -1; x <= 1; x++) {
      for (let y = -1; y <= 1; y++) {
        for (let z = -1; z <= 1; z++) {
          const bucket = grid.get(`${cell(point[0]) + x}_${cell(point[1]) + y}_${cell(point[2]) + z}`);
          if (!bucket) continue;
          // Runs once per point per selected point, so it avoids creating vectors.
          for (const other of bucket) {
            const dx = point[0] - other[0];
            const dy = point[1] - other[1];
            const dz = point[2] - other[2];
            nearest = Math.min(nearest, dx * dx + dy * dy + dz * dz);
          }
        }
      }
    }
    if (nearest < radius * radius) weights.set(index, 0.5 + 0.5 * Math.cos((Math.PI * Math.sqrt(nearest)) / radius));
  });
  return weights;
}

export function transformVertices(
  mesh: PolyMesh,
  weights: ReadonlyMap<number, number>,
  matrix: THREE.Matrix4,
): PolyMesh {
  const point = new THREE.Vector3();
  const vertices = mesh.vertices.map((vertex, index) => {
    const weight = weights.get(index);
    if (weight === undefined) return vertex;
    const moved = point.set(...vertex).applyMatrix4(matrix);
    return add(vertex, times(sub(moved.toArray() as Vec3, vertex), weight));
  });
  return { ...mesh, vertices };
}

/** Pulls every face along its own direction, each with walls all around. */
function extrudeEach(mesh: PolyMesh, ids: readonly number[], distance: number): FaceResult {
  const vertices = [...mesh.vertices];
  const faces = [...mesh.faces];
  const faceMaterials = [...mesh.faceMaterials];
  const sides: number[] = [];
  for (const id of ids) {
    const face = mesh.faces[id];
    const offset = times(faceNormal(mesh, face), distance);
    const copies = face.map((vertex) => {
      vertices.push(add(mesh.vertices[vertex], offset));
      return vertices.length - 1;
    });
    faces[id] = copies;
    face.forEach((a, i) => {
      const next = (i + 1) % face.length;
      sides.push(faces.length);
      faces.push([a, face[next], copies[next], copies[i]]);
      faceMaterials.push(mesh.faceMaterials[id]);
    });
    assertWithinLimits(vertices.length, faces.length);
  }
  return { mesh: compact({ ...mesh, vertices, faces, faceMaterials }), caps: [...ids], sides };
}

/** Pulls faces out as one region. Faces keep their index, so `caps` are the same ids as `ids`. */
export function extrude(mesh: PolyMesh, ids: readonly number[], distance: number, individual = false): FaceResult {
  if (individual && ids.length > 1) return extrudeEach(mesh, ids, distance);

  const directed = new Set<string>();
  const summed = new Map<number, Vec3>();
  const touching = new Map<number, Vec3[]>();
  for (const id of ids) {
    const face = mesh.faces[id];
    const normal = faceNormal(mesh, face);
    face.forEach((vertex, i) => {
      directed.add(directedKey(vertex, face[(i + 1) % face.length]));
      summed.set(vertex, add(summed.get(vertex) ?? [0, 0, 0], normal));
      touching.set(vertex, [...(touching.get(vertex) ?? []), normal]);
    });
  }

  const vertices = [...mesh.vertices];
  const copyOf = new Map<number, number>();
  for (const [vertex, sum] of summed) {
    const direction = normalize(sum);
    // At a corner the region's faces must each move by the full distance.
    const miter = Math.max(Math.min(...touching.get(vertex)!.map((normal) => dot(normal, direction))), MIN_MITER);
    copyOf.set(vertex, vertices.length);
    vertices.push(add(mesh.vertices[vertex], times(direction, distance / miter)));
  }

  const faces = [...mesh.faces];
  const faceMaterials = [...mesh.faceMaterials];
  const sides: number[] = [];
  for (const id of ids) {
    const face = mesh.faces[id];
    faces[id] = face.map((vertex) => copyOf.get(vertex)!);
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      if (directed.has(directedKey(b, a))) return;
      sides.push(faces.length);
      faces.push([a, b, copyOf.get(b)!, copyOf.get(a)!]);
      faceMaterials.push(mesh.faceMaterials[id]);
    });
  }

  assertWithinLimits(vertices.length, faces.length);
  return { mesh: compact({ ...mesh, vertices, faces, faceMaterials }), caps: [...ids], sides };
}

/** Shrinks each face inside its own outline, leaving a ring of new faces around it. */
export function inset(mesh: PolyMesh, ids: readonly number[], amount: number): FaceResult {
  const vertices = [...mesh.vertices];
  const faces = [...mesh.faces];
  const faceMaterials = [...mesh.faceMaterials];
  const sides: number[] = [];

  for (const id of ids) {
    const face = mesh.faces[id];
    const normal = faceNormal(mesh, face);
    const center = faceCenter(mesh, face);
    const inner = face.map((vertex, i) => {
      const point = mesh.vertices[vertex];
      const before = mesh.vertices[face[(i + face.length - 1) % face.length]];
      const after = mesh.vertices[face[(i + 1) % face.length]];
      const inwardBefore = normalize(cross(normal, sub(point, before)));
      const inwardAfter = normalize(cross(normal, sub(after, point)));
      const direction = normalize(add(inwardBefore, inwardAfter));
      const reach = amount / Math.max(dot(direction, inwardBefore), MIN_INSET_MITER);
      const limit = length(sub(center, point)) * MAX_INSET_REACH;
      vertices.push(add(point, times(direction, Math.min(reach, limit))));
      return vertices.length - 1;
    });

    faces[id] = inner;
    face.forEach((vertex, i) => {
      const next = (i + 1) % face.length;
      sides.push(faces.length);
      faces.push([vertex, face[next], inner[next], inner[i]]);
      faceMaterials.push(mesh.faceMaterials[id]);
    });
  }

  assertWithinLimits(vertices.length, faces.length);
  return { mesh: { ...mesh, vertices, faces, faceMaterials }, caps: [...ids], sides };
}

/** Cuts faces into smaller ones without changing the surface. Neighbors stay connected. */
export function subdivide(mesh: PolyMesh, ids: readonly number[]): FaceResult {
  const chosen = new Set(ids);
  const vertices = [...mesh.vertices];
  const middles = new Map<string, number>();
  const middle = (a: number, b: number) => {
    const key = edgeKey(a, b);
    let index = middles.get(key);
    if (index === undefined) {
      index = vertices.length;
      vertices.push(times(add(mesh.vertices[a], mesh.vertices[b]), 0.5));
      middles.set(key, index);
    }
    return index;
  };
  for (const id of ids) {
    const face = mesh.faces[id];
    face.forEach((a, i) => middle(a, face[(i + 1) % face.length]));
  }

  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  const caps: number[] = [];
  mesh.faces.forEach((face, index) => {
    if (!chosen.has(index)) {
      // A neighbor gets the new points on its shared edges, so no crack opens between them.
      const widened = face.flatMap((a, i) => {
        const split = middles.get(edgeKey(a, face[(i + 1) % face.length]));
        return split === undefined ? [a] : [a, split];
      });
      faces.push(widened);
      faceMaterials.push(mesh.faceMaterials[index]);
      return;
    }
    const center = vertices.length;
    vertices.push(faceCenter(mesh, face));
    face.forEach((corner, i) => {
      const next = face[(i + 1) % face.length];
      const previous = face[(i + face.length - 1) % face.length];
      caps.push(faces.length);
      faces.push([corner, middle(corner, next), center, middle(previous, corner)]);
      faceMaterials.push(mesh.faceMaterials[index]);
    });
  });

  assertWithinLimits(vertices.length, faces.length);
  return { mesh: { ...mesh, vertices, faces, faceMaterials }, caps, sides: [] };
}

/** Catmull-Clark: every level turns corners into curves and multiplies the faces by about four. */
export function roundOff(mesh: PolyMesh): PolyMesh {
  const outcome = mesh.faces.reduce((total, face) => total + face.length, 0);
  assertWithinLimits(mesh.vertices.length + mesh.faces.length + outcome, outcome);

  interface Edge {
    a: number;
    b: number;
    faces: number[];
    index: number;
  }
  const facePoints = mesh.faces.map((face) => faceCenter(mesh, face));
  const edges = new Map<string, Edge>();
  mesh.faces.forEach((face, index) => {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      const edge = edges.get(key) ?? { a, b, faces: [], index: 0 };
      edge.faces.push(index);
      edges.set(key, edge);
    });
  });

  const vertexCount = mesh.vertices.length;
  const faceStart = vertexCount;
  const edgeStart = faceStart + mesh.faces.length;
  const vertices: Vec3[] = new Array(vertexCount);
  vertices.push(...facePoints);

  const edgesAt: Edge[][] = mesh.vertices.map(() => []);
  const facesAt: number[][] = mesh.vertices.map(() => []);
  mesh.faces.forEach((face, index) => face.forEach((vertex) => facesAt[vertex].push(index)));

  let nextEdge = edgeStart;
  for (const edge of edges.values()) {
    edge.index = nextEdge++;
    edgesAt[edge.a].push(edge);
    edgesAt[edge.b].push(edge);
    const midpoint = times(add(mesh.vertices[edge.a], mesh.vertices[edge.b]), 0.5);
    vertices.push(
      edge.faces.length === 2
        ? times(add(midpoint, times(add(facePoints[edge.faces[0]], facePoints[edge.faces[1]]), 0.5)), 0.5)
        : midpoint,
    );
  }

  mesh.vertices.forEach((point, index) => {
    const around = edgesAt[index];
    const open = around.filter((edge) => edge.faces.length !== 2);
    const other = (edge: Edge) => mesh.vertices[edge.a === index ? edge.b : edge.a];
    if (open.length === 2) {
      vertices[index] = times(add(add(times(point, 6), other(open[0])), other(open[1])), 1 / 8);
    } else if (open.length > 0) {
      vertices[index] = point;
    } else {
      const count = facesAt[index].length;
      const faceAverage = average(facesAt[index].map((face) => facePoints[face]));
      const edgeAverage = average(around.map((edge) => times(add(point, other(edge)), 0.5)));
      vertices[index] = times(add(add(faceAverage, times(edgeAverage, 2)), times(point, count - 3)), 1 / count);
    }
  });

  const edgePoint = (a: number, b: number) => edges.get(edgeKey(a, b))!.index;
  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  mesh.faces.forEach((face, index) => {
    face.forEach((corner, i) => {
      const next = face[(i + 1) % face.length];
      const previous = face[(i + face.length - 1) % face.length];
      faces.push([corner, edgePoint(corner, next), faceStart + index, edgePoint(previous, corner)]);
      faceMaterials.push(mesh.faceMaterials[index]);
    });
  });
  return { ...mesh, vertices, faces, faceMaterials };
}

/** Evens out the surface by moving points toward their neighbors. */
export function relax(mesh: PolyMesh, ids: readonly number[] | null, factor: number, iterations: number): PolyMesh {
  const neighbors: Set<number>[] = mesh.vertices.map(() => new Set());
  for (const face of mesh.faces) {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      neighbors[a].add(b);
      neighbors[b].add(a);
    });
  }
  const chosen = ids ? new Set(ids) : null;
  let vertices = mesh.vertices;
  for (let step = 0; step < iterations; step++) {
    const source = vertices;
    vertices = source.map((point, index) => {
      if ((chosen && !chosen.has(index)) || neighbors[index].size === 0) return point;
      const center = average([...neighbors[index]].map((neighbor) => source[neighbor]));
      return add(point, times(sub(center, point), factor));
    });
  }
  return { ...mesh, vertices };
}

/** Cuts the shape at a coordinate plane and keeps one side. */
export function bisect(mesh: PolyMesh, axis: Axis, side: 1 | -1): PolyMesh {
  const vertices = mesh.vertices.map((vertex) => {
    if (Math.abs(vertex[axis]) >= ON_PLANE) return vertex;
    const flattened: Vec3 = [...vertex];
    flattened[axis] = 0;
    return flattened;
  });
  const signed = (index: number) => vertices[index][axis] * side;

  const cuts = new Map<string, number>();
  const cut = (a: number, b: number) => {
    const key = edgeKey(a, b);
    let index = cuts.get(key);
    if (index === undefined) {
      const t = signed(a) / (signed(a) - signed(b));
      const point = add(vertices[a], times(sub(vertices[b], vertices[a]), t));
      point[axis] = 0;
      index = vertices.length;
      vertices.push(point);
      cuts.set(key, index);
    }
    return index;
  };

  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  mesh.faces.forEach((face, index) => {
    if (face.every((vertex) => signed(vertex) === 0) || face.every((vertex) => signed(vertex) <= 0)) return;
    const clipped: number[] = [];
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      if (signed(a) >= 0) clipped.push(a);
      if (signed(a) * signed(b) < 0) clipped.push(cut(a, b));
    });
    if (clipped.length >= MIN_SIDES) {
      faces.push(clipped);
      faceMaterials.push(mesh.faceMaterials[index]);
    }
  });
  return assertNotEmpty(compact({ ...mesh, vertices, faces, faceMaterials }));
}

/** Rebuilds one side of the shape as the reflection of the other, sewn along the plane. */
export function mirror(mesh: PolyMesh, axis: Axis, side?: 1 | -1): PolyMesh {
  const keep = side ?? (mesh.vertices.reduce((sum, vertex) => sum + vertex[axis], 0) >= 0 ? 1 : -1);
  const half = bisect(mesh, axis, keep);

  const vertices = [...half.vertices];
  const reflected = half.vertices.map((vertex, index) => {
    if (vertex[axis] === 0) return index;
    const copy: Vec3 = [...vertex];
    copy[axis] = -copy[axis];
    vertices.push(copy);
    return vertices.length - 1;
  });
  const faces = [...half.faces, ...half.faces.map((face) => face.map((vertex) => reflected[vertex]).reverse())];
  assertWithinLimits(vertices.length, faces.length);
  return { ...half, vertices, faces, faceMaterials: [...half.faceMaterials, ...half.faceMaterials] };
}

export function deleteFaces(mesh: PolyMesh, ids: readonly number[]): PolyMesh {
  const chosen = new Set(ids);
  const keep = (_: unknown, index: number) => !chosen.has(index);
  return assertNotEmpty(
    compact({ ...mesh, faces: mesh.faces.filter(keep), faceMaterials: mesh.faceMaterials.filter(keep) }),
  );
}

export function deleteVertices(mesh: PolyMesh, ids: readonly number[]): PolyMesh {
  const chosen = new Set(ids);
  return deleteFaces(mesh, allFaces(mesh).filter((index) => mesh.faces[index].some((vertex) => chosen.has(vertex))));
}

/** Collapses the chosen vertices into one point at their center. */
export function weld(mesh: PolyMesh, ids: readonly number[]): PolyMesh {
  if (ids.length < 2) throw new Error("escolha pelo menos dois vértices para juntar");
  const target = ids[0];
  const chosen = new Set(ids);
  const vertices = [...mesh.vertices];
  vertices[target] = average(ids.map((id) => mesh.vertices[id]));
  const faces = mesh.faces.map((face) => face.map((vertex) => (chosen.has(vertex) ? target : vertex)));
  return assertNotEmpty(removeCollapsedFaces({ ...mesh, vertices, faces }));
}

/** Joins vertices that sit in the same place, closing seams left by separate pieces. */
export function weldClose(mesh: PolyMesh, distance: number): PolyMesh {
  const step = Math.max(distance, 1e-6);
  const seen = new Map<string, number>();
  const remap = mesh.vertices.map((vertex, index) => {
    const key = vertex.map((value) => Math.round(value / step)).join("_");
    const existing = seen.get(key);
    if (existing !== undefined) return existing;
    seen.set(key, index);
    return index;
  });
  return assertNotEmpty(
    removeCollapsedFaces({ ...mesh, faces: mesh.faces.map((face) => face.map((vertex) => remap[vertex])) }),
  );
}

/** Makes a new face through the chosen vertices, in order around their center. */
export function fill(mesh: PolyMesh, ids: readonly number[]): FaceResult {
  if (ids.length < MIN_SIDES) throw new Error("escolha pelo menos três vértices para criar uma face");
  const points = ids.map((id) => mesh.vertices[id]);
  const origin = average(points);
  const farthest = points.reduce((best, point) =>
    length(sub(point, origin)) > length(sub(best, origin)) ? point : best,
  );
  const u = normalize(sub(farthest, origin));
  const planeNormal = normalize(
    points.reduce((best, point) => {
      const candidate = cross(u, sub(point, origin));
      return length(candidate) > length(best) ? candidate : best;
    }, [0, 0, 0] as Vec3),
  );
  if (length(planeNormal) === 0) throw new Error("esses vértices estão em linha reta e não formam uma face");
  const v = cross(planeNormal, u);

  const ordered = [...ids].sort((a, b) => {
    const angle = (id: number) => {
      const offset = sub(mesh.vertices[id], origin);
      return Math.atan2(dot(offset, v), dot(offset, u));
    };
    return angle(a) - angle(b);
  });

  // A closed gap should face away from the rest of the shape.
  const center = average(mesh.vertices);
  const outward = dot(faceNormal(mesh, ordered), sub(origin, center)) >= 0;
  const face = outward ? ordered : [...ordered].reverse();
  const id = mesh.faces.length;
  return {
    mesh: { ...mesh, faces: [...mesh.faces, face], faceMaterials: [...mesh.faceMaterials, 0] },
    caps: [id],
    sides: [],
  };
}

export function paintFaces(mesh: PolyMesh, ids: readonly number[], material: ShapeMaterial): PolyMesh {
  const materials = [...mesh.materials];
  const index = materialIndex(materials, material);
  const chosen = new Set(ids);
  return pruneMaterials({
    ...mesh,
    materials,
    faceMaterials: mesh.faceMaterials.map((current, face) => (chosen.has(face) ? index : current)),
  });
}

function vertexNormals(mesh: PolyMesh): Vec3[] {
  const normals = mesh.vertices.map((): Vec3 => [0, 0, 0]);
  for (const face of mesh.faces) {
    const normal = faceNormal(mesh, face);
    for (const vertex of face) normals[vertex] = add(normals[vertex], normal);
  }
  return normals.map(normalize);
}

function layeredNoise(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 - seed * 0.7) +
    0.55 * Math.sin(y * 3.1 + seed * 1.3) * Math.cos(z * 2.7 + seed) +
    0.3 * Math.sin(z * 6.1 - seed) * Math.cos(x * 5.3 + seed * 0.4)
  );
}

/** Pushes the surface in and out irregularly, for rocks, bark and rough ground. */
export function roughen(
  mesh: PolyMesh,
  ids: readonly number[] | null,
  amount: number,
  frequency: number,
  seed: number,
): PolyMesh {
  const chosen = ids ? new Set(ids) : null;
  const normals = vertexNormals(mesh);
  const vertices = mesh.vertices.map((point, index) => {
    if (chosen && !chosen.has(index)) return point;
    const push = amount * layeredNoise(point[0] * frequency, point[1] * frequency, point[2] * frequency, seed);
    return add(point, times(normals[index], push));
  });
  return { ...mesh, vertices };
}

export interface TriangulatedMesh {
  positions: Float32Array;
  /** The polygon each triangle belongs to. */
  owners: Int32Array;
}

export function triangulateMesh(mesh: PolyMesh, faces: readonly number[] = allFaces(mesh)): TriangulatedMesh {
  const positions: number[] = [];
  const owners: number[] = [];
  for (const id of faces) {
    for (const triangle of triangulateFace(mesh.vertices, mesh.faces[id])) {
      for (const vertex of triangle) positions.push(...mesh.vertices[vertex]);
      owners.push(id);
    }
  }
  return { positions: new Float32Array(positions), owners: new Int32Array(owners) };
}

export function uniqueEdges(mesh: PolyMesh): [number, number][] {
  const seen = new Set<string>();
  const edges: [number, number][] = [];
  for (const face of mesh.faces) {
    face.forEach((a, i) => {
      const b = face[(i + 1) % face.length];
      const key = edgeKey(a, b);
      if (seen.has(key)) return;
      seen.add(key);
      edges.push([a, b]);
    });
  }
  return edges;
}
