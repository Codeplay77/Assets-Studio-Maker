import * as THREE from "three";
import { ADDITION, Brush, Evaluator, INTERSECTION, SUBTRACTION } from "three-bvh-csg";
import type { Vec3 } from "../core/types";
import {
  MAX_FACES,
  MAX_VERTICES,
  compact,
  cross,
  dot,
  faceNormal,
  joinMeshes,
  length,
  meshBounds,
  sub,
  type PolyMesh,
} from "./mesh";
import { triangulateFace } from "./triangulate";

export type BooleanMode = "subtract" | "union" | "intersect";

const OPERATIONS = { subtract: SUBTRACTION, union: ADDITION, intersect: INTERSECTION };
const SLOT = "materialSlot";
const WELD_RATIO = 1e-6;
const MIN_WELD = 1e-7;
const COPLANAR = 0.9999;
const MAX_SIDES = 256;
const MIN_TRIANGLE_AREA = 1e-14;

function brushFrom(mesh: PolyMesh, first: number, end: number): Brush {
  const positions: number[] = [];
  const slots: number[] = [];
  for (let id = first; id < end; id++) {
    for (const triangle of triangulateFace(mesh.vertices, mesh.faces[id])) {
      for (const vertex of triangle) {
        positions.push(...mesh.vertices[vertex]);
        slots.push(mesh.faceMaterials[id]);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  geometry.setAttribute(SLOT, new THREE.BufferAttribute(new Float32Array(slots), 1));
  const brush = new Brush(geometry);
  brush.updateMatrixWorld();
  return brush;
}

const pairKey = (a: number, b: number, size: number) => a * size + b;

/** Points that only differ by rounding must become the same point, or the surface has cracks. */
function weldPoints(points: Vec3[], step: number): { vertices: Vec3[]; remap: Int32Array } {
  const cell = (value: number) => Math.round(value / (step * 2));
  const grid = new Map<string, number[]>();
  const vertices: Vec3[] = [];
  const remap = new Int32Array(points.length);

  points.forEach((point, index) => {
    const [cx, cy, cz] = point.map(cell);
    for (let x = cx - 1; x <= cx + 1; x++) {
      for (let y = cy - 1; y <= cy + 1; y++) {
        for (let z = cz - 1; z <= cz + 1; z++) {
          for (const existing of grid.get(`${x}_${y}_${z}`) ?? []) {
            if (length(sub(vertices[existing], point)) <= step) {
              remap[index] = existing;
              return;
            }
          }
        }
      }
    }
    remap[index] = vertices.length;
    vertices.push(point);
    const key = `${cx}_${cy}_${cz}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(remap[index]);
    else grid.set(key, [remap[index]]);
  });
  return { vertices, remap };
}

function isDegenerate(vertices: Vec3[], [a, b, c]: number[]): boolean {
  if (a === b || b === c || a === c) return true;
  return length(cross(sub(vertices[b], vertices[a]), sub(vertices[c], vertices[a]))) < MIN_TRIANGLE_AREA;
}

/**
 * A cut can end an edge in the middle of a neighbor's edge. Adding that point to the neighbor
 * closes the crack, and later edits see one connected surface.
 */
function closeCracks(vertices: Vec3[], faces: number[][], step: number): number[][] {
  const size = vertices.length;
  const directed = new Set<number>();
  for (const face of faces) {
    face.forEach((a, i) => directed.add(pairKey(a, face[(i + 1) % face.length], size)));
  }

  const open: { face: number; index: number; a: number; b: number }[] = [];
  const endpoints = new Set<number>();
  faces.forEach((face, id) => {
    face.forEach((a, index) => {
      const b = face[(index + 1) % face.length];
      if (directed.has(pairKey(b, a, size))) return;
      open.push({ face: id, index, a, b });
      endpoints.add(a);
      endpoints.add(b);
    });
  });
  if (open.length === 0) return faces;

  const candidates = [...endpoints];
  const inserts = new Map<number, Map<number, number[]>>();
  for (const { face, index, a, b } of open) {
    const start = vertices[a];
    const span = sub(vertices[b], start);
    const reach = dot(span, span);
    if (reach === 0) continue;
    const found: { vertex: number; t: number }[] = [];
    for (const vertex of candidates) {
      if (vertex === a || vertex === b) continue;
      const offset = sub(vertices[vertex], start);
      const t = dot(offset, span) / reach;
      if (t <= 0 || t >= 1) continue;
      const nearest: Vec3 = [start[0] + span[0] * t, start[1] + span[1] * t, start[2] + span[2] * t];
      if (length(sub(vertices[vertex], nearest)) <= step * 2) found.push({ vertex, t });
    }
    if (found.length === 0) continue;
    found.sort((x, y) => x.t - y.t);
    const perFace = inserts.get(face) ?? new Map<number, number[]>();
    perFace.set(index, found.map((item) => item.vertex));
    inserts.set(face, perFace);
  }

  return faces.map((face, id) => {
    const perFace = inserts.get(id);
    return perFace ? face.flatMap((vertex, index) => [vertex, ...(perFace.get(index) ?? [])]) : face;
  });
}

/**
 * One polygon can't describe a flat area with a hole in it. Joining its pieces for as long as the
 * outline stays a simple loop leaves two faces wrapped around the hole.
 */
function mergeAroundHoles(vertices: Vec3[], polygons: number[][]): number[][] {
  const size = vertices.length;
  const alive = polygons.map((polygon) => [...polygon]);
  const owner = new Map<number, number>();
  const shared: [number, number][] = [];
  alive.forEach((polygon, id) => {
    polygon.forEach((a, i) => owner.set(pairKey(a, polygon[(i + 1) % polygon.length], size), id));
  });
  for (const key of owner.keys()) {
    const a = Math.floor(key / size);
    const b = key - a * size;
    if (a < b && owner.has(pairKey(b, a, size))) shared.push([a, b]);
  }
  shared.sort((x, y) => length(sub(vertices[y[0]], vertices[y[1]])) - length(sub(vertices[x[0]], vertices[x[1]])));

  const merged: boolean[] = alive.map(() => false);
  for (const [a, b] of shared) {
    const first = owner.get(pairKey(a, b, size));
    const second = owner.get(pairKey(b, a, size));
    if (first === undefined || second === undefined || first === second) continue;
    const from = alive[first];
    const to = alive[second];
    const startFirst = (from.indexOf(a) + 1) % from.length;
    const startSecond = (to.indexOf(b) + 1) % to.length;
    const loopFirst = from.map((_, i) => from[(startFirst + i) % from.length]);
    const loopSecond = to.map((_, i) => to[(startSecond + i) % to.length]);
    const joined = [...loopFirst, ...loopSecond.slice(1, -1)];
    if (joined.length > MAX_SIDES || new Set(joined).size !== joined.length) continue;

    for (const polygon of [from, to]) {
      polygon.forEach((vertex, i) => owner.delete(pairKey(vertex, polygon[(i + 1) % polygon.length], size)));
    }
    alive[first] = joined;
    merged[second] = true;
    joined.forEach((vertex, i) => owner.set(pairKey(vertex, joined[(i + 1) % joined.length], size), first));
  }
  return alive.filter((_, id) => !merged[id]);
}

/** Walks the outline of a flat area. Returns null if it isn't one simple loop. */
function outlineOf(polygons: number[][], size: number): number[] | null {
  const edges = new Set<number>();
  for (const polygon of polygons) {
    polygon.forEach((a, i) => edges.add(pairKey(a, polygon[(i + 1) % polygon.length], size)));
  }
  const next = new Map<number, number>();
  let start = -1;
  let boundary = 0;
  for (const polygon of polygons) {
    for (let i = 0; i < polygon.length; i++) {
      const a = polygon[i];
      const b = polygon[(i + 1) % polygon.length];
      if (edges.has(pairKey(b, a, size))) continue;
      if (next.has(a)) return null;
      next.set(a, b);
      start = a;
      boundary++;
    }
  }
  if (boundary < 3) return null;
  const outline = [start];
  for (let vertex = next.get(start); vertex !== start; vertex = next.get(vertex)) {
    if (vertex === undefined || outline.length > boundary) return null;
    outline.push(vertex);
  }
  return outline.length === boundary ? outline : null;
}

/** A point in the middle of a straight side, that nothing else needs, only adds noise. */
function dropStraightCorners(vertices: Vec3[], outline: number[], usedOutside: Set<number>): number[] {
  const kept = outline.filter((vertex, i) => {
    if (usedOutside.has(vertex)) return true;
    const before = vertices[outline[(i + outline.length - 1) % outline.length]];
    const after = vertices[outline[(i + 1) % outline.length]];
    const side = cross(sub(vertices[vertex], before), sub(after, vertices[vertex]));
    return length(side) > 1e-9 * Math.max(length(sub(after, before)) ** 2, 1e-9);
  });
  return kept.length >= 3 ? kept : outline;
}

/** Turns the triangles of a cut back into a few clean faces, so the result is good to keep editing. */
function mergeFlatAreas(mesh: PolyMesh): PolyMesh {
  const size = mesh.vertices.length;
  const faceAt = new Map<number, number>();
  mesh.faces.forEach((face, id) => {
    face.forEach((a, i) => faceAt.set(pairKey(a, face[(i + 1) % face.length], size), id));
  });
  const normals = mesh.faces.map((face) => faceNormal(mesh, face));

  const region = new Int32Array(mesh.faces.length).fill(-1);
  const regions: number[][] = [];
  mesh.faces.forEach((_, seed) => {
    if (region[seed] >= 0) return;
    const id = regions.length;
    const members = [seed];
    region[seed] = id;
    for (let cursor = 0; cursor < members.length; cursor++) {
      const face = mesh.faces[members[cursor]];
      for (let i = 0; i < face.length; i++) {
        const other = faceAt.get(pairKey(face[(i + 1) % face.length], face[i], size));
        if (
          other !== undefined &&
          region[other] < 0 &&
          mesh.faceMaterials[other] === mesh.faceMaterials[seed] &&
          dot(normals[other], normals[seed]) >= COPLANAR
        ) {
          region[other] = id;
          members.push(other);
        }
      }
    }
    regions.push(members);
  });

  const touchingRegions = new Map<number, Set<number>>();
  mesh.faces.forEach((face, id) => {
    for (const vertex of face) {
      const set = touchingRegions.get(vertex) ?? new Set<number>();
      set.add(region[id]);
      touchingRegions.set(vertex, set);
    }
  });

  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  regions.forEach((members) => {
    const polygons = members.map((face) => mesh.faces[face]);
    const material = mesh.faceMaterials[members[0]];
    if (polygons.length === 1) {
      faces.push(polygons[0]);
      faceMaterials.push(material);
      return;
    }
    const outline = outlineOf(polygons, size);
    if (outline && outline.length <= MAX_SIDES) {
      const usedOutside = new Set(outline.filter((vertex) => touchingRegions.get(vertex)!.size > 1));
      faces.push(dropStraightCorners(mesh.vertices, outline, usedOutside));
      faceMaterials.push(material);
      return;
    }
    for (const polygon of mergeAroundHoles(mesh.vertices, polygons)) {
      faces.push(polygon);
      faceMaterials.push(material);
    }
  });
  return compact({ ...mesh, faces, faceMaterials });
}

function readResult(brush: Brush, base: PolyMesh): PolyMesh {
  const positions = brush.geometry.getAttribute("position");
  const slots = brush.geometry.getAttribute(SLOT);
  const index = brush.geometry.getIndex();
  const count = index ? index.count : positions.count;

  const points: Vec3[] = [];
  const corners: number[] = [];
  const materialOf: number[] = [];
  for (let at = 0; at < count; at++) {
    const vertex = index ? index.getX(at) : at;
    points.push([positions.getX(vertex), positions.getY(vertex), positions.getZ(vertex)]);
    corners.push(at);
    if (at % 3 === 0) materialOf.push(Math.round(slots.getX(vertex)));
  }

  const { min, max } = meshBounds({ ...base, vertices: points });
  const step = Math.max(length(sub(max, min)) * WELD_RATIO, MIN_WELD);
  const { vertices, remap } = weldPoints(points, step);

  const triangles: number[][] = [];
  const materials: number[] = [];
  for (let at = 0; at + 2 < corners.length; at += 3) {
    const triangle = [remap[at], remap[at + 1], remap[at + 2]];
    if (isDegenerate(vertices, triangle)) continue;
    triangles.push(triangle);
    materials.push(materialOf[at / 3]);
  }

  return mergeFlatAreas({
    ...base,
    vertices,
    faces: closeCracks(vertices, triangles, step),
    faceMaterials: materials,
  });
}

/** Cuts, joins or intersects two closed shapes. Cut walls take the material of the tool. */
export function booleanMeshes(base: PolyMesh, tool: PolyMesh, mode: BooleanMode): PolyMesh {
  const joined = joinMeshes([base, tool]);
  const a = brushFrom(joined, 0, base.faces.length);
  const b = brushFrom(joined, base.faces.length, joined.faces.length);

  const evaluator = new Evaluator();
  (evaluator as Evaluator & { useCDTClipping: boolean }).useCDTClipping = true;
  evaluator.useGroups = false;
  evaluator.attributes = ["position", SLOT];
  const output = evaluator.evaluate(a, b, OPERATIONS[mode]);
  const result = readResult(output, { ...joined, smoothAngle: base.smoothAngle });

  for (const brush of [a, b, output]) brush.geometry.dispose();
  if (result.faces.length === 0) {
    throw new Error(mode === "intersect" ? "as duas formas não se encostam" : "o corte não deixou nada da forma");
  }
  if (result.vertices.length > MAX_VERTICES || result.faces.length > MAX_FACES) {
    throw new Error(`a forma passaria do limite de ${MAX_VERTICES} vértices e ${MAX_FACES} faces`);
  }
  return result;
}
