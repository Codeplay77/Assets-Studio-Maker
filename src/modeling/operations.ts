import * as THREE from "three";
import { hasSurface, TILING_SURFACES } from "../blocks/surfaces";
import type { Finish, ShapeMaterial, Vec3 } from "../core/types";
import { bevel } from "./bevel";
import { booleanMeshes, type BooleanMode } from "./boolean";
import * as build from "./builders";
import {
  allFaces,
  bisect,
  deleteFaces,
  deleteVertices,
  dot,
  extrude,
  faceCenter,
  faceNormal,
  fill,
  flipFaces,
  inset,
  joinMeshes,
  length,
  mirror,
  normalize,
  paintFaces,
  relax,
  roughen,
  roundOff,
  softWeights,
  sub,
  subdivide,
  transformMesh,
  transformVertices,
  uniqueEdges,
  weld,
  weldClose,
  type Axis,
  type PolyMesh,
} from "./mesh";
import { BRUSH_KINDS, sculptPath, type BrushKind } from "./sculpt";

/**
 * The shared vocabulary for creating and changing shapes. The interface and the agent both go
 * through here, so anything one can do the other can too.
 */
type Args = Record<string, unknown>;

const FINISHES: Finish[] = ["matte", "gloss", "metal", "glass", "glow"];
const AXES: Record<string, Axis> = { x: 0, y: 1, z: 2 };
const MIN_SEGMENTS = 3;
const MAX_SEGMENTS = 128;
const MAX_ROWS = 64;
const MAX_STEPS = 16;
const MAX_ROUND_LEVELS = 3;
const MAX_RELAX_STEPS = 50;
const DEFAULT_NORMAL_TOLERANCE = 20;
const MAX_BEVEL_SEGMENTS = 8;
const BOOLEAN_MODES: BooleanMode[] = ["subtract", "union", "intersect"];
const HOLE_SEGMENTS = 32;
/** How far a hole's tool starts outside the face, so curved surfaces are cut cleanly. */
const HOLE_CLEARANCE = 0.5;
const MIN_HOLE_CLEARANCE = 0.05;
const MAX_HOLES = 32;
const UP = new THREE.Vector3(0, 1, 0);
const COLOR = /^#[0-9a-fA-F]{6}$/;

export const PIECE_TYPES = [
  "box",
  "rounded_box",
  "plane",
  "wedge",
  "frustum",
  "cylinder",
  "cone",
  "sphere",
  "dome",
  "capsule",
  "torus",
  "lathe",
  "loft",
  "tube",
  "extrude",
  "polygons",
] as const;

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

const isNumber = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);

function num(args: Args, key: string, fallback?: number, min = -Infinity, max = Infinity): number {
  const value = args[key] ?? fallback;
  if (!isNumber(value)) throw new Error(`"${key}" precisa ser um número`);
  if (value < min || value > max) throw new Error(`"${key}" precisa estar entre ${min} e ${max}`);
  return value;
}

const positive = (args: Args, key: string, fallback?: number) => {
  const value = num(args, key, fallback);
  if (value <= 0) throw new Error(`"${key}" precisa ser maior que zero`);
  return value;
};

function detail(args: Args, key: string, fallback: number, min = MIN_SEGMENTS, max = MAX_SEGMENTS): number {
  return Math.round(Math.min(max, Math.max(min, num(args, key, fallback))));
}

function vec3(value: unknown, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isNumber)) {
    throw new Error(`"${key}" precisa ser uma lista com 3 números`);
  }
  return value as Vec3;
}

function size(args: Args, key = "size", fallback: Vec3 = [1, 1, 1]): Vec3 {
  const value = vec3(args[key] ?? fallback, key);
  if (value.some((item) => item <= 0)) throw new Error(`"${key}" precisa ter valores maiores que zero`);
  return value;
}

function points(args: Args, key: string, minimum: number): [number, number][] {
  const value = args[key];
  if (
    !Array.isArray(value) ||
    value.length < minimum ||
    !value.every((point) => Array.isArray(point) && point.length === 2 && point.every(isNumber))
  ) {
    throw new Error(`"${key}" precisa ser uma lista com pelo menos ${minimum} pares de números`);
  }
  return value as [number, number][];
}

function integerList(value: unknown, key: string): number[] {
  if (!Array.isArray(value) || !value.every(Number.isInteger)) {
    throw new Error(`"${key}" precisa ser uma lista de números inteiros`);
  }
  return value as number[];
}

function polygons(args: Args): PolyMesh {
  const { vertices, faces } = args;
  if (!Array.isArray(vertices) || vertices.length === 0) throw new Error('"vertices" precisa ser uma lista de pontos');
  if (!Array.isArray(faces) || faces.length === 0) throw new Error('"faces" precisa ser uma lista de faces');
  const mesh = joinMeshes([]);
  mesh.vertices = vertices.map((vertex) => vec3(vertex, "vertices"));
  mesh.faces = faces.map((face) => integerList(face, "faces"));
  mesh.faceMaterials = mesh.faces.map(() => 0);
  for (const face of mesh.faces) {
    if (face.length < 3) throw new Error("cada face precisa de pelo menos 3 vértices");
    for (const index of face) {
      if (index < 0 || index >= mesh.vertices.length) throw new Error(`uma face usa o vértice ${index}, que não existe`);
    }
  }
  return mesh;
}

function builtPiece(spec: Args): PolyMesh {
  switch (spec.type) {
    case "box":
      return build.box(size(spec));
    case "rounded_box":
      return build.roundedBox(size(spec), positive(spec, "radius", 0.1), detail(spec, "segments", 3, 1, 8));
    case "plane":
      return build.plane(
        positive(spec, "width", 1),
        positive(spec, "depth", 1),
        detail(spec, "columns", 1, 1),
        detail(spec, "rows", 1, 1),
      );
    case "wedge":
      return build.wedge(size(spec));
    case "frustum":
      return build.frustum(
        points({ p: [spec.bottom ?? [1, 1]] }, "p", 1)[0],
        points({ p: [spec.top ?? [0.5, 0.5]] }, "p", 1)[0],
        positive(spec, "height", 1),
      );
    case "cylinder":
      return build.cylinder(
        num(spec, "radiusTop", (spec.radius as number) ?? 0.5, 0),
        num(spec, "radiusBottom", (spec.radius as number) ?? 0.5, 0),
        positive(spec, "height", 1),
        detail(spec, "segments", 24),
      );
    case "cone":
      return build.cylinder(0, positive(spec, "radius", 0.5), positive(spec, "height", 1), detail(spec, "segments", 24));
    case "sphere":
      return build.sphere(positive(spec, "radius", 0.5), detail(spec, "segments", 24), detail(spec, "rows", 16, 2, MAX_ROWS));
    case "dome":
      return build.dome(positive(spec, "radius", 0.5), detail(spec, "segments", 24), detail(spec, "rows", 8, 1, MAX_ROWS));
    case "capsule":
      return build.capsule(
        positive(spec, "radius", 0.25),
        num(spec, "length", 0.5, 0),
        detail(spec, "segments", 20),
        detail(spec, "rows", 6, 1, MAX_ROWS),
      );
    case "torus":
      return build.torus(
        positive(spec, "radius", 0.4),
        positive(spec, "tube", 0.15),
        detail(spec, "segments", 32),
        detail(spec, "tubeSegments", 12),
      );
    case "lathe":
      return build.lathe(points(spec, "profile", 2), detail(spec, "segments", 32));
    case "loft": {
      const rings = spec.rings;
      if (!Array.isArray(rings) || rings.length < 2) throw new Error('"rings" precisa de pelo menos duas seções');
      if (!rings.every((ring) => Array.isArray(ring) && ring.length >= 3 && ring.every(isNumber))) {
        throw new Error('cada seção em "rings" precisa ser [posição, meia largura, meia profundidade]');
      }
      return build.loft(
        rings as build.LoftRing[],
        spec.axis === "z" ? "z" : "y",
        detail(spec, "segments", 32),
        detail(spec, "steps", 4, 1, MAX_STEPS),
      );
    }
    case "tube": {
      const path = spec.path;
      if (!Array.isArray(path) || path.length < 2) throw new Error('"path" precisa de pelo menos dois pontos');
      const radii = Array.isArray(spec.radius) ? spec.radius : [spec.radius ?? 0.1];
      if (!radii.every((radius) => isNumber(radius) && radius >= 0)) throw new Error('"radius" precisa de valores positivos');
      return build.tube(
        path.map((point) => vec3(point, "path")),
        radii as number[],
        detail(spec, "radial", 10),
        detail(spec, "steps", 6, 1, MAX_STEPS),
        num(spec, "flat", 1, 0.01, 1),
      );
    }
    case "extrude":
      return build.extrudeOutline(points(spec, "outline", 3), positive(spec, "depth", 0.2));
    case "polygons":
      return polygons(spec);
    default:
      throw new Error(`tipo de forma desconhecido: ${String(spec.type)}. Use: ${PIECE_TYPES.join(", ")}`);
  }
}

function matrixFrom(at: Vec3, degrees: Vec3, scale: Vec3): THREE.Matrix4 {
  const [x, y, z] = degrees.map(THREE.MathUtils.degToRad);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...at),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)),
    new THREE.Vector3(...scale),
  );
}

function uniformOrVec3(value: unknown, key: string): Vec3 {
  return isNumber(value) ? [value, value, value] : vec3(value, key);
}

function materialFrom(args: Args): ShapeMaterial {
  const material: ShapeMaterial = {};
  if (args.color !== undefined && args.color !== null) {
    if (typeof args.color !== "string" || !COLOR.test(args.color)) throw new Error('"color" precisa ser no formato #rrggbb');
    material.color = args.color.toLowerCase();
  }
  if (args.finish !== undefined) {
    if (!FINISHES.includes(args.finish as Finish)) throw new Error(`"finish" aceita: ${FINISHES.join(", ")}`);
    material.finish = args.finish as Finish;
  }
  if (args.shade !== undefined) material.shade = num(args, "shade", 1, 0, 1);
  if (args.texture !== undefined && args.texture !== null && args.texture !== "") {
    if (typeof args.texture !== "string" || !hasSurface(args.texture)) {
      throw new Error(`"texture" aceita: ${TILING_SURFACES.map((surface) => surface.id).join(", ")}`);
    }
    material.texture = args.texture;
  }
  return material;
}

/** Builds one piece, placed and with its own material if it asks for one. */
export function buildPiece(spec: unknown): PolyMesh {
  if (!isRecord(spec)) throw new Error("cada peça da forma precisa ser um objeto");
  let mesh = builtPiece(spec);
  const material = materialFrom(spec);
  if (Object.keys(material).length > 0) mesh = paintFaces(mesh, allFaces(mesh), material);

  const at = spec.at === undefined ? ([0, 0, 0] as Vec3) : vec3(spec.at, "at");
  const rotation = spec.rot === undefined ? ([0, 0, 0] as Vec3) : vec3(spec.rot, "rot");
  const scale = spec.scale === undefined ? ([1, 1, 1] as Vec3) : uniformOrVec3(spec.scale, "scale");
  return transformMesh(mesh, matrixFrom(at, rotation, scale));
}

/** The faces and sides made by the last operation, so the next one can continue from them. */
export interface OperationContext {
  caps: number[];
  sides: number[];
  /** Finds another shape of the project, for cutting one shape with another. */
  findShape?: (id: string) => PolyMesh | undefined;
}

export const newContext = (findShape?: OperationContext["findShape"]): OperationContext => ({ caps: [], sides: [], findShape });

function insideBox(point: Vec3, box: Args): boolean {
  const min = vec3(box.min, "inside.min");
  const max = vec3(box.max, "inside.max");
  return point.every((value, axis) => value >= min[axis] && value <= max[axis]);
}

function narrowToNearest(items: number[], position: (item: number) => Vec3, target: Vec3): number[] {
  let best = items[0];
  let distance = Infinity;
  for (const item of items) {
    const current = length(sub(position(item), target));
    if (current < distance) {
      distance = current;
      best = item;
    }
  }
  return items.length > 0 ? [best] : [];
}

/** Agents usually can't know face numbers, so faces can also be described by where they are. */
export function selectFaces(mesh: PolyMesh, selector: unknown, context: OperationContext): number[] {
  if (selector === "all") return allFaces(mesh);
  if (!isRecord(selector)) throw new Error('escolha as faces com "all" ou com um objeto de seleção');

  let chosen = allFaces(mesh);
  if (selector.last !== undefined) {
    if (selector.last !== "caps" && selector.last !== "sides") throw new Error('"last" aceita "caps" ou "sides"');
    chosen = context[selector.last];
  }
  if (selector.ids !== undefined) {
    const ids = integerList(selector.ids, "ids");
    for (const id of ids) {
      if (id < 0 || id >= mesh.faces.length) throw new Error(`face não encontrada: ${id}`);
    }
    const wanted = new Set(ids);
    chosen = chosen.filter((id) => wanted.has(id));
  }
  if (selector.normal !== undefined) {
    const wanted = normalize(vec3(selector.normal, "normal"));
    const limit = Math.cos(THREE.MathUtils.degToRad(num(selector, "tolerance", DEFAULT_NORMAL_TOLERANCE, 0, 180)));
    chosen = chosen.filter((id) => dot(faceNormal(mesh, mesh.faces[id]), wanted) >= limit);
  }
  if (selector.inside !== undefined) {
    if (!isRecord(selector.inside)) throw new Error('"inside" precisa ter "min" e "max"');
    const box = selector.inside;
    chosen = chosen.filter((id) => insideBox(faceCenter(mesh, mesh.faces[id]), box));
  }
  if (selector.material !== undefined) {
    chosen = chosen.filter((id) => mesh.faceMaterials[id] === selector.material);
  }
  if (selector.nearest !== undefined) {
    const target = vec3(selector.nearest, "nearest");
    chosen = narrowToNearest(chosen, (id) => faceCenter(mesh, mesh.faces[id]), target);
  }
  if (chosen.length === 0) throw new Error("nenhuma face corresponde a essa seleção");
  return chosen;
}

export function selectVertices(mesh: PolyMesh, selector: unknown, context: OperationContext): number[] {
  const everything = mesh.vertices.map((_, index) => index);
  if (selector === "all") return everything;
  if (!isRecord(selector)) throw new Error('escolha os vértices com "all" ou com um objeto de seleção');

  let chosen = everything;
  if (selector.faces !== undefined) {
    const faces = selectFaces(mesh, selector.faces, context);
    chosen = [...new Set(faces.flatMap((id) => mesh.faces[id]))];
  }
  if (selector.ids !== undefined) {
    const ids = integerList(selector.ids, "ids");
    for (const id of ids) {
      if (id < 0 || id >= mesh.vertices.length) throw new Error(`vértice não encontrado: ${id}`);
    }
    const wanted = new Set(ids);
    chosen = chosen.filter((id) => wanted.has(id));
  }
  if (selector.inside !== undefined) {
    if (!isRecord(selector.inside)) throw new Error('"inside" precisa ter "min" e "max"');
    const box = selector.inside;
    chosen = chosen.filter((id) => insideBox(mesh.vertices[id], box));
  }
  if (selector.nearest !== undefined) {
    const target = vec3(selector.nearest, "nearest");
    chosen = narrowToNearest(chosen, (id) => mesh.vertices[id], target);
  }
  if (chosen.length === 0) throw new Error("nenhum vértice corresponde a essa seleção");
  return chosen;
}

/** Edges can be listed, or described: the sharp ones, the outline of some faces, or by their points. */
export function selectEdges(mesh: PolyMesh, selector: unknown, context: OperationContext): [number, number][] {
  const everything = uniqueEdges(mesh);
  if (selector === "all") return everything;
  if (!isRecord(selector)) throw new Error('escolha as arestas com "all" ou com um objeto de seleção');

  let chosen = everything;
  const keyOf = (a: number, b: number) => (a < b ? `${a}_${b}` : `${b}_${a}`);
  if (selector.ids !== undefined) {
    if (!Array.isArray(selector.ids)) throw new Error('"ids" precisa ser uma lista de pares de vértices');
    const wanted = new Set(
      selector.ids.map((pair) => {
        const list = integerList(pair, "ids");
        if (list.length !== 2) throw new Error('cada item de "ids" precisa ter dois vértices');
        return keyOf(list[0], list[1]);
      }),
    );
    chosen = chosen.filter(([a, b]) => wanted.has(keyOf(a, b)));
  }
  if (selector.sharp !== undefined) {
    const limit = num(selector, "sharp", 30, 0, 180);
    const normalsAt = new Map<string, Vec3[]>();
    for (const face of mesh.faces) {
      const normal = faceNormal(mesh, face);
      face.forEach((a, i) => {
        const key = keyOf(a, face[(i + 1) % face.length]);
        const list = normalsAt.get(key);
        if (list) list.push(normal);
        else normalsAt.set(key, [normal]);
      });
    }
    const threshold = Math.cos(THREE.MathUtils.degToRad(limit));
    chosen = chosen.filter(([a, b]) => {
      const normals = normalsAt.get(keyOf(a, b)) ?? [];
      return normals.length === 2 && dot(normals[0], normals[1]) <= threshold;
    });
  }
  if (selector.faces !== undefined) {
    const uses = new Map<string, number>();
    for (const id of selectFaces(mesh, selector.faces, context)) {
      const face = mesh.faces[id];
      face.forEach((a, i) => {
        const key = keyOf(a, face[(i + 1) % face.length]);
        uses.set(key, (uses.get(key) ?? 0) + 1);
      });
    }
    chosen = chosen.filter(([a, b]) => uses.get(keyOf(a, b)) === 1);
  }
  if (selector.vertices !== undefined) {
    const wanted = new Set(selectVertices(mesh, selector.vertices, context));
    chosen = chosen.filter(([a, b]) => wanted.has(a) && wanted.has(b));
  }
  if (chosen.length === 0) throw new Error("nenhuma aresta corresponde a essa seleção");
  return chosen;
}

function toolMesh(op: Args, context: OperationContext): PolyMesh {
  if (op.piece !== undefined) return buildPiece(op.piece);
  if (typeof op.shape !== "string") throw new Error('diga com o que cortar: "piece" ou "shape"');
  const found = context.findShape?.(op.shape);
  if (!found) throw new Error(`forma não encontrada: ${op.shape}`);
  const at = op.at === undefined ? ([0, 0, 0] as Vec3) : vec3(op.at, "at");
  const rotation = op.rot === undefined ? ([0, 0, 0] as Vec3) : vec3(op.rot, "rot");
  const scale = op.scale === undefined ? ([1, 1, 1] as Vec3) : uniformOrVec3(op.scale, "scale");
  return transformMesh(found, matrixFrom(at, rotation, scale));
}

/** A straight hole into a face, along its direction. Without depth it goes all the way through. */
function holeTool(mesh: PolyMesh, face: number, op: Args): PolyMesh {
  const size = positive(op, "size", 0.4);
  const center = faceCenter(mesh, mesh.faces[face]);
  const normal = faceNormal(mesh, mesh.faces[face]);

  let span = 0;
  for (const vertex of mesh.vertices) span = Math.max(span, length(sub(vertex, center)));
  const depth = op.depth === undefined || op.depth === null ? span * 2.5 : positive(op, "depth");
  const clearance = Math.max(size * HOLE_CLEARANCE, MIN_HOLE_CLEARANCE);
  const height = depth + clearance;
  const middle = center.map((value, axis) => value + normal[axis] * (clearance - depth) * 0.5) as Vec3;
  const euler = new THREE.Euler().setFromQuaternion(
    new THREE.Quaternion().setFromUnitVectors(UP, new THREE.Vector3(...normal)),
  );
  const rot = [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg);
  const placed = { at: middle, rot };
  return op.shape === "square"
    ? buildPiece({ type: "box", size: [size, height, size], ...placed })
    : buildPiece({ type: "cylinder", radius: size / 2, height, segments: HOLE_SEGMENTS, ...placed });
}

function axisOf(args: Args): Axis {
  const axis = AXES[String(args.axis)];
  if (axis === undefined) throw new Error('"axis" aceita x, y ou z');
  return axis;
}

function sideOf(args: Args): 1 | -1 | undefined {
  if (args.side === undefined) return undefined;
  if (args.side !== 1 && args.side !== -1) throw new Error('"side" aceita 1 ou -1');
  return args.side;
}

function around(pivot: Vec3, matrix: THREE.Matrix4): THREE.Matrix4 {
  return new THREE.Matrix4()
    .makeTranslation(...pivot)
    .multiply(matrix)
    .multiply(new THREE.Matrix4().makeTranslation(-pivot[0], -pivot[1], -pivot[2]));
}

function pivotOf(mesh: PolyMesh, ids: number[], args: Args): Vec3 {
  if (args.pivot !== undefined) return vec3(args.pivot, "pivot");
  const center: Vec3 = [0, 0, 0];
  for (const id of ids) {
    for (let axis = 0; axis < 3; axis++) center[axis] += mesh.vertices[id][axis] / ids.length;
  }
  return center;
}

function setVertices(mesh: PolyMesh, positions: unknown): PolyMesh {
  if (!Array.isArray(positions) || positions.length === 0) throw new Error('"positions" precisa ser uma lista');
  const vertices = [...mesh.vertices];
  for (const entry of positions) {
    if (!isRecord(entry) || !Number.isInteger(entry.id)) throw new Error('cada item de "positions" precisa de "id" e "position"');
    const id = entry.id as number;
    if (id < 0 || id >= vertices.length) throw new Error(`vértice não encontrado: ${id}`);
    vertices[id] = vec3(entry.position, "position");
  }
  return { ...mesh, vertices };
}

function resultOf(context: OperationContext, caps: number[], sides: number[]): void {
  context.caps = caps;
  context.sides = sides;
}

/** Runs one step on a mesh. Shapes never change in place: each step returns a new mesh. */
export function runOperation(mesh: PolyMesh, operation: unknown, context: OperationContext): PolyMesh {
  if (!isRecord(operation)) throw new Error("cada operação precisa ser um objeto");
  const op = operation;
  const faces = () => selectFaces(mesh, op.faces, context);
  const vertices = () => selectVertices(mesh, op.vertices, context);
  const optionalVertices = () => (op.vertices === undefined ? null : vertices());
  const softly = (ids: number[]) => softWeights(mesh, ids, num(op, "softRadius", 0, 0));

  switch (op.op) {
    case "extrude": {
      const result = extrude(mesh, faces(), num(op, "distance"), op.individual === true);
      resultOf(context, result.caps, result.sides);
      return result.mesh;
    }
    case "inset": {
      const result = inset(mesh, faces(), positive(op, "amount"));
      resultOf(context, result.caps, result.sides);
      return result.mesh;
    }
    case "subdivide": {
      const result = subdivide(mesh, op.faces === undefined ? allFaces(mesh) : faces());
      resultOf(context, result.caps, result.sides);
      return result.mesh;
    }
    case "round": {
      let current = mesh;
      const levels = detail(op, "levels", 1, 1, MAX_ROUND_LEVELS);
      for (let level = 0; level < levels; level++) current = roundOff(current);
      resultOf(context, [], []);
      return current;
    }
    case "smooth":
      return relax(
        mesh,
        optionalVertices(),
        num(op, "factor", 0.5, 0, 1),
        detail(op, "iterations", 1, 1, MAX_RELAX_STEPS),
      );
    case "mirror":
      resultOf(context, [], []);
      return mirror(mesh, axisOf(op), sideOf(op));
    case "bisect":
      resultOf(context, [], []);
      return bisect(mesh, axisOf(op), sideOf(op) ?? 1);
    case "delete_faces": {
      const ids = faces();
      resultOf(context, [], []);
      return deleteFaces(mesh, ids);
    }
    case "delete_vertices": {
      const ids = vertices();
      resultOf(context, [], []);
      return deleteVertices(mesh, ids);
    }
    case "weld": {
      const ids = vertices();
      resultOf(context, [], []);
      return weld(mesh, ids);
    }
    case "weld_close":
      resultOf(context, [], []);
      return weldClose(mesh, num(op, "distance", 0.0001, 0));
    case "fill": {
      const result = fill(mesh, vertices());
      resultOf(context, result.caps, result.sides);
      return result.mesh;
    }
    case "move": {
      const offset = vec3(op.offset, "offset");
      return transformVertices(mesh, softly(vertices()), new THREE.Matrix4().makeTranslation(...offset));
    }
    case "rotate": {
      const ids = vertices();
      const matrix = matrixFrom([0, 0, 0], vec3(op.angles, "angles"), [1, 1, 1]);
      return transformVertices(mesh, softly(ids), around(pivotOf(mesh, ids, op), matrix));
    }
    case "scale": {
      const ids = vertices();
      const matrix = matrixFrom([0, 0, 0], [0, 0, 0], uniformOrVec3(op.factor, "factor"));
      return transformVertices(mesh, softly(ids), around(pivotOf(mesh, ids, op), matrix));
    }
    case "set_vertices":
      return setVertices(mesh, op.positions);
    case "paint":
      return paintFaces(mesh, faces(), materialFrom(op));
    case "flip":
      return flipFaces(mesh, op.faces === undefined ? allFaces(mesh) : faces());
    case "roughen":
      return roughen(
        mesh,
        optionalVertices(),
        num(op, "amount", 0.05),
        positive(op, "frequency", 3),
        num(op, "seed", 1),
      );
    case "boolean": {
      if (!BOOLEAN_MODES.includes(op.mode as BooleanMode)) throw new Error(`"mode" aceita: ${BOOLEAN_MODES.join(", ")}`);
      resultOf(context, [], []);
      return booleanMeshes(mesh, toolMesh(op, context), op.mode as BooleanMode);
    }
    case "hole": {
      const ids = faces();
      if (ids.length > MAX_HOLES) throw new Error(`no máximo ${MAX_HOLES} furos por vez`);
      // Every tool is measured first, because each cut renumbers the faces.
      const tools = ids.map((id) => holeTool(mesh, id, op));
      resultOf(context, [], []);
      return tools.reduce((current, tool) => booleanMeshes(current, tool, "subtract"), mesh);
    }
    case "bevel": {
      const result = bevel(
        mesh,
        selectEdges(mesh, op.edges, context),
        positive(op, "amount", 0.05),
        detail(op, "segments", 1, 1, MAX_BEVEL_SEGMENTS),
      );
      resultOf(context, result.caps, result.sides);
      return result.mesh;
    }
    case "sculpt": {
      if (!BRUSH_KINDS.includes(op.brush as BrushKind)) throw new Error(`"brush" aceita: ${BRUSH_KINDS.join(", ")}`);
      if (!Array.isArray(op.path) || op.path.length === 0) throw new Error('"path" precisa de pelo menos um ponto');
      return sculptPath(
        mesh,
        {
          kind: op.brush as BrushKind,
          radius: positive(op, "radius", 0.3),
          strength: num(op, "strength", 0.5, 0, 1),
          symmetry: op.symmetry === true,
        },
        op.path.map((point) => vec3(point, "path")),
        op.offset === undefined ? undefined : vec3(op.offset, "offset"),
      );
    }
    case "add_piece": {
      const count = mesh.faces.length;
      const joined = joinMeshes([mesh, buildPiece(op.piece)]);
      resultOf(context, joined.faces.map((_, index) => index).slice(count), []);
      return joined;
    }
    default:
      throw new Error(
        `operação desconhecida: ${String(op.op)}. Use: extrude, inset, subdivide, round, smooth, mirror, bisect, delete_faces, delete_vertices, weld, weld_close, fill, move, rotate, scale, set_vertices, paint, flip, roughen, add_piece, boolean, hole, bevel, sculpt`,
      );
  }
}
