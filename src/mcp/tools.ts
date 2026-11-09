import * as THREE from "three";
import {
  CUSTOM_CATEGORY,
  blocks,
  categories,
  customBlocks,
  getBlock,
  syncCustomBlocks,
  type BlockDef,
} from "../blocks/catalog";
import { buildGeometry } from "../blocks/geometry";
import type {
  Command,
  CustomShape,
  EditorSnapshot,
  Part,
  PartId,
  PartUpdate,
  Quat,
  ShapeSocket,
  Vec3,
} from "../core/types";
import { blockTriangles, countTriangles, type ExportOptions } from "../export/glb";
import { generators } from "../generators";
import { convertParts } from "../modeling/convert";
import {
  DEFAULT_SMOOTH_ANGLE,
  faceCenter,
  faceNormal,
  joinMeshes,
  meshBounds,
  transformMesh,
  type PolyMesh,
} from "../modeling/mesh";
import { PIECE_TYPES, buildPiece, newContext, runOperation } from "../modeling/operations";
import type { CaptureView } from "../viewport/EditorViewport";
import { alignToSurface, worldSockets } from "../viewport/placement";

const CAPTURE_VIEWS: CaptureView[] = ["iso", "front", "back", "left", "right", "top", "current"];
const MAX_CAPTURE_VIEWS = 6;
const MIN_CAPTURE_SIZE = 256;
const MAX_CAPTURE_SIZE = 1600;
const DEFAULT_CAPTURE_WIDTH = 960;
const DEFAULT_CAPTURE_HEIGHT = 720;
const MAX_PARTS_PER_CALL = 2000;
const DEFAULT_SEARCH_LIMIT = 30;
const MAX_SEARCH_LIMIT = 100;
const DEFAULT_SCENE_LIMIT = 500;
const QUARTER_TURNS = 4;
const SEED_RANGE = 1_000_000;
const MAX_PIECES = 500;
const MAX_OPERATIONS = 200;
const MAX_LISTED_FACES = 3000;
const DEFAULT_SHAPE_COLOR = "#8a9bb0";

const FACE_SELECTOR =
  'Choose faces with "all" or an object combining: ids, normal (faces pointing that way, with optional tolerance in degrees), inside {min,max} (face centers in a box), material, nearest (the face closest to a point), last ("caps" or "sides" from the previous operation).';
const VERTEX_SELECTOR =
  'Choose vertices with "all" or an object combining: faces (any face selector), ids, inside {min,max}, nearest.';
const PIECE_HELP = `Each piece has "type" and optional at, rot (degrees), scale, color (#rrggbb, otherwise it follows the part's color), finish (matte, gloss, metal, glass, glow). Types and their parameters, in meters:
box size[3]; rounded_box size[3] radius segments; plane width depth columns rows; wedge size[3] (tall at -Z); frustum bottom[w,d] top[w,d] height; cylinder radius (or radiusTop, radiusBottom) height segments; cone radius height segments; sphere radius segments rows; dome radius segments rows; capsule radius length segments rows; torus radius tube segments tubeSegments (hole along Y);
lathe profile[[radius,y],...] segments (revolved around Y, for vases, wheels, bottles);
loft rings[[position,halfWidth,halfDepth,squareness?,offset?],...] axis(y|z) segments steps (a smooth body through cross-sections, for torsos, heads, fuselages; squareness 2 is an ellipse, higher is boxier);
tube path[[x,y,z],...] radius(number or list along the path) radial steps flat (limbs, cables, horns, tails);
extrude outline[[x,y],...] depth (any flat silhouette given thickness, centered on Z, for blades, signs, letters);
polygons vertices[[x,y,z],...] faces[[indices],...] (any mesh you compute yourself; list each face counterclockwise seen from outside).`;
const OPERATION_HELP = `Each operation has "op". ${FACE_SELECTOR} ${VERTEX_SELECTOR}
extrude faces distance individual? (pull faces out, negative digs in; last.caps are the moved faces, last.sides the new walls); inset faces amount (a smaller face inside each face); subdivide faces? (cut faces into quads); round levels? (Catmull-Clark smoothing of the whole shape, turns boxy shapes organic; each level multiplies faces by four); smooth vertices? factor iterations (relaxes the surface);
move vertices offset softRadius?; rotate vertices angles pivot? softRadius?; scale vertices factor pivot? softRadius? (softRadius makes nearby vertices follow, fading with distance, for organic pulls); set_vertices positions[{id,position}];
mirror axis side? (replaces one side with the reflection of the other, sewn at the plane: model half, then mirror); bisect axis side (cuts at a plane through the origin);
delete_faces faces; delete_vertices vertices; weld vertices; weld_close distance; fill vertices (makes a face through them); flip faces?;
paint faces color? finish? shade? (no color makes faces follow the part's color again); roughen vertices? amount frequency seed (rocks, bark); add_piece piece (adds another piece to the shape);
boolean mode(subtract|union|intersect) and piece (any piece, placed with at/rot/scale) or shape (id of another shape, with optional at, rot, scale) (real cuts between closed shapes: windows, doors, pipes, keyholes; walls of a cut take the tool's color);
hole faces size shape(round|square) depth? (a straight hole from the center of each face along its direction; without depth it goes all the way through);
bevel edges amount segments? (cuts the chosen edges; segments above 1 makes them round, for a finished, less blocky look). Choose edges with "all" or an object combining: ids[[a,b],...], sharp (minimum angle between the two faces in degrees, usually 30), faces (any face selector: the outline of those faces), vertices (any vertex selector: edges with both ends chosen). Last.caps are the new faces;
sculpt brush(raise|lower|smooth|flatten|grab) path[[x,y,z],...] radius strength(0 to 1) symmetry? offset? (organic detail as a brush stroke along points on the surface, needs a shape with many points; symmetry repeats it across X; grab moves what is around path[0] by offset).`;

export type ToolContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export interface ToolResult {
  content: ToolContent[];
  isError?: boolean;
}

/** Everything the tools need from the editor, kept apart so tests can stand in for it. */
export interface ToolDeps {
  getState(): Promise<EditorSnapshot>;
  apply(command: Command): Promise<PartId[]>;
  undo(): Promise<void>;
  redo(): Promise<void>;
  generate(generator: string, seed: number, keep: boolean): Promise<PartId[]>;
  /** Returns a base64 JPEG. */
  capture(view: CaptureView, width: number, height: number, ids?: PartId[]): Promise<string>;
  frame(): Promise<void>;
  exportGlb(parts: Part[], options: ExportOptions): Promise<ArrayBuffer>;
  saveExport(name: string, bytes: Uint8Array): Promise<string>;
}

type Args = Record<string, unknown>;

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: object;
  readOnly?: boolean;
  /** Shown to the person while the agent works. Tools without one don't change the scene. */
  activity?: string;
  run(args: Args, deps: ToolDeps): Promise<ToolResult>;
}

const NUMBER = { type: "number" };
const VEC3 = { type: "array", items: NUMBER, minItems: 3, maxItems: 3 };
const IDS = { type: "array", items: { type: "integer" }, minItems: 1 };
const COLOR = { type: "string", pattern: "^#[0-9a-fA-F]{6}$", description: "Hex color such as #ff8800." };
const POSITION = { ...VEC3, description: "World position of the block's origin, in meters." };
const ROTATION = { ...VEC3, description: "XYZ Euler angles in degrees." };
const SCALE = { ...VEC3, description: "Scale on each axis. 1 is the original size." };

function object(properties: object, required: string[] = []): object {
  return { type: "object", properties, required, additionalProperties: false };
}

function text(value: unknown): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function round(value: number): number {
  // Adding zero turns -0 into 0.
  return Math.round(value * 10000) / 10000 + 0;
}

function roundAll(values: readonly number[]): number[] {
  return values.map(round);
}

function isRecord(value: unknown): value is Args {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readString(args: Args, key: string): string {
  const value = args[key];
  if (typeof value !== "string" || value === "") throw new Error(`"${key}" precisa ser um texto`);
  return value;
}

function readOptionalString(args: Args, key: string): string | undefined {
  return args[key] === undefined ? undefined : readString(args, key);
}

function readVec3(value: unknown, key: string): Vec3 {
  if (!Array.isArray(value) || value.length !== 3 || !value.every(isNumber)) {
    throw new Error(`"${key}" precisa ser uma lista com 3 números`);
  }
  return value as Vec3;
}

function readOptionalVec3(args: Args, key: string): Vec3 | undefined {
  return args[key] === undefined ? undefined : readVec3(args[key], key);
}

function readNumber(args: Args, key: string, fallback: number): number {
  const value = args[key];
  if (value === undefined) return fallback;
  if (!isNumber(value)) throw new Error(`"${key}" precisa ser um número`);
  return value;
}

function readBoolean(args: Args, key: string, fallback: boolean): boolean {
  const value = args[key];
  if (value === undefined) return fallback;
  if (typeof value !== "boolean") throw new Error(`"${key}" precisa ser verdadeiro ou falso`);
  return value;
}

function readId(args: Args, key: string): PartId {
  const value = args[key];
  if (!Number.isInteger(value)) throw new Error(`"${key}" precisa ser o número de uma peça`);
  return value as PartId;
}

function readIds(args: Args, key: string): PartId[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every(Number.isInteger)) {
    throw new Error(`"${key}" precisa ser uma lista com os números das peças`);
  }
  return value as PartId[];
}

function readOptionalIds(args: Args, key: string): PartId[] | undefined {
  return args[key] === undefined ? undefined : readIds(args, key);
}

function readRecords(args: Args, key: string): Args[] {
  const value = args[key];
  if (!Array.isArray(value) || value.length === 0 || !value.every(isRecord)) {
    throw new Error(`"${key}" precisa ser uma lista de objetos`);
  }
  if (value.length > MAX_PARTS_PER_CALL) {
    throw new Error(`no máximo ${MAX_PARTS_PER_CALL} itens por chamada`);
  }
  return value;
}

function clampSize(value: number): number {
  return Math.round(Math.min(MAX_CAPTURE_SIZE, Math.max(MIN_CAPTURE_SIZE, value)));
}

function eulerToQuat(degrees: Vec3): Quat {
  const euler = new THREE.Euler(...(degrees.map(THREE.MathUtils.degToRad) as Vec3), "XYZ");
  return new THREE.Quaternion().setFromEuler(euler).toArray() as Quat;
}

function quatToEuler(rotation: Quat): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...rotation), "XYZ");
  return [euler.x, euler.y, euler.z].map((angle) => round(THREE.MathUtils.radToDeg(angle))) as Vec3;
}

const boundsCache = new WeakMap<BlockDef, THREE.Box3>();

function blockBounds(block: string): THREE.Box3 {
  const def = getBlock(block);
  let bounds = boundsCache.get(def);
  if (!bounds) {
    const geometry = buildGeometry(def.shape);
    geometry.computeBoundingBox();
    bounds = geometry.boundingBox!.clone();
    geometry.dispose();
    boundsCache.set(def, bounds);
  }
  return bounds;
}

function transform(position: Vec3, rotation: Quat, scale: Vec3): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...position),
    new THREE.Quaternion(...rotation),
    new THREE.Vector3(...scale),
  );
}

function partMatrix(part: Part): THREE.Matrix4 {
  return transform(part.position, part.rotation, part.scale);
}

function describeBox(box: THREE.Box3): { min: number[]; max: number[]; size: number[] } {
  return {
    min: roundAll(box.min.toArray()),
    max: roundAll(box.max.toArray()),
    size: roundAll(box.getSize(new THREE.Vector3()).toArray()),
  };
}

function describePart(part: Part) {
  return {
    id: part.id,
    block: part.block,
    position: roundAll(part.position),
    rotation: quatToEuler(part.rotation),
    scale: roundAll(part.scale),
    color: part.color,
    ...(part.group === undefined ? {} : { group: part.group }),
  };
}

function describeWorldSockets(block: BlockDef, matrix: THREE.Matrix4) {
  return worldSockets(block.sockets, matrix).map((socket) => ({
    id: socket.id,
    position: roundAll(socket.position.toArray()),
    normal: roundAll(socket.normal.toArray()),
  }));
}

function findPart(snapshot: EditorSnapshot, id: PartId): Part {
  const part = snapshot.project.parts.find((candidate) => candidate.id === id);
  if (!part) throw new Error(`peça não encontrada: ${id}`);
  return part;
}

function withoutAccents(value: string): string {
  return value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

function categoryName(id: string): string {
  return categories.find((category) => category.id === id)?.name ?? id;
}

function matchesQuery(block: BlockDef, terms: string[]): boolean {
  const haystack = withoutAccents(`${block.id} ${block.name} ${categoryName(block.category)}`);
  return terms.every((term) => haystack.includes(term));
}

function readNewPart(raw: Args) {
  const block = readString(raw, "block");
  getBlock(block);
  const position = readVec3(raw.position, "position");
  const rotation = raw.rotation === undefined ? ([0, 0, 0, 1] as Quat) : eulerToQuat(readVec3(raw.rotation, "rotation"));
  const scale = readOptionalVec3(raw, "scale") ?? ([1, 1, 1] as Vec3);
  const color = readOptionalString(raw, "color");

  if (readBoolean(raw, "onGround", false)) {
    const box = blockBounds(block).clone().applyMatrix4(transform(position, rotation, scale));
    position[1] -= box.min.y;
  }
  return { block, position, rotation, scale, ...(color ? { color } : {}) };
}

function readUpdate(raw: Args): PartUpdate {
  const rotation = readOptionalVec3(raw, "rotation");
  const position = readOptionalVec3(raw, "position");
  const scale = readOptionalVec3(raw, "scale");
  const color = readOptionalString(raw, "color");
  return {
    id: readId(raw, "id"),
    ...(position ? { position } : {}),
    ...(rotation ? { rotation: eulerToQuat(rotation) } : {}),
    ...(scale ? { scale } : {}),
    ...(color ? { color } : {}),
  };
}

function historyState(snapshot: EditorSnapshot) {
  return { canUndo: snapshot.canUndo, canRedo: snapshot.canRedo, parts: snapshot.project.parts.length };
}

function findShape(snapshot: EditorSnapshot, id: string): CustomShape {
  const shape = snapshot.project.shapes.find((candidate) => candidate.id === id);
  if (!shape) throw new Error(`forma não encontrada: ${id}`);
  return shape;
}

/** Blocks made in the project must be known before the next step uses them. */
async function refreshShapes(deps: ToolDeps): Promise<EditorSnapshot> {
  const snapshot = await deps.getState();
  syncCustomBlocks(snapshot.project.shapes, snapshot.revision);
  return snapshot;
}

function describeShape(shape: CustomShape) {
  const { min, max } = meshBounds(shape);
  return {
    id: shape.id,
    name: shape.name,
    color: shape.color,
    vertices: shape.vertices.length,
    faces: shape.faces.length,
    smoothAngle: shape.smoothAngle,
    materials: shape.materials,
    bounds: { min: roundAll(min), max: roundAll(max), size: roundAll(max.map((value, axis) => value - min[axis])) },
    sockets: getBlock(shape.id).sockets.map((socket) => ({ id: socket.id, position: socket.p, normal: socket.n })),
  };
}

function readSockets(value: unknown): ShapeSocket[] {
  if (!Array.isArray(value) || !value.every(isRecord)) throw new Error('"sockets" precisa ser uma lista de objetos');
  return value.map((socket) => ({
    id: readString(socket, "id"),
    p: readVec3(socket.position, "position"),
    n: readVec3(socket.normal, "normal"),
  }));
}

function runOperations(mesh: PolyMesh, operations: Args[], snapshot: EditorSnapshot) {
  const context = newContext((id) => snapshot.project.shapes.find((shape) => shape.id === id));
  let current = mesh;
  operations.forEach((operation, index) => {
    try {
      current = runOperation(current, operation, context);
    } catch (error) {
      throw new Error(`operação ${index + 1} (${String(operation.op)}): ${errorText(error)}`, { cause: error });
    }
  });
  return { mesh: current, context };
}

function readOperations(args: Args): Args[] {
  const operations = readRecords(args, "operations");
  if (operations.length > MAX_OPERATIONS) throw new Error(`no máximo ${MAX_OPERATIONS} operações por chamada`);
  return operations;
}

function shapeFields(mesh: PolyMesh) {
  const { vertices, faces, faceMaterials, materials, smoothAngle } = mesh;
  return { vertices, faces, faceMaterials, materials, smoothAngle };
}

const NO_PLACEMENT = false;

const tools: Tool[] = [
  {
    name: "get_scene",
    title: "Read the scene",
    description:
      "Lists the parts in the scene with their id, block, transform and color, plus the bounds of the whole scene. Rotations are XYZ Euler degrees.",
    readOnly: true,
    inputSchema: object({
      limit: { type: "integer", minimum: 1, description: "How many parts to list. Defaults to 500." },
      offset: { type: "integer", minimum: 0, description: "How many parts to skip." },
    }),
    async run(args, deps) {
      const snapshot = await deps.getState();
      const { parts, name } = snapshot.project;
      const offset = readNumber(args, "offset", 0);
      const limit = readNumber(args, "limit", DEFAULT_SCENE_LIMIT);
      const box = new THREE.Box3();
      for (const part of parts) box.union(blockBounds(part.block).clone().applyMatrix4(partMatrix(part)));
      return text({
        name,
        partCount: parts.length,
        triangles: countTriangles(parts),
        unsaved: snapshot.dirty,
        canUndo: snapshot.canUndo,
        canRedo: snapshot.canRedo,
        bounds: box.isEmpty() ? null : describeBox(box),
        parts: parts.slice(offset, offset + limit).map(describePart),
      });
    },
  },
  {
    name: "get_part",
    title: "Read one part",
    description: "Returns one part with its world bounds and the world position of each socket.",
    readOnly: true,
    inputSchema: object({ id: { type: "integer" } }, ["id"]),
    async run(args, deps) {
      const part = findPart(await deps.getState(), readId(args, "id"));
      const matrix = partMatrix(part);
      return text({
        ...describePart(part),
        bounds: describeBox(blockBounds(part.block).clone().applyMatrix4(matrix)),
        sockets: describeWorldSockets(getBlock(part.block), matrix),
      });
    },
  },
  {
    name: "search_blocks",
    title: "Search blocks",
    description:
      "Searches the block catalog by words in Portuguese or by block id. Names are in Portuguese, for example carro, cabeça, braço, roda, prédio, árvore. Without a query or category it also returns the list of categories.",
    readOnly: true,
    inputSchema: object({
      query: { type: "string" },
      category: { type: "string", description: "A category id." },
      limit: { type: "integer", minimum: 1, maximum: MAX_SEARCH_LIMIT, description: "Defaults to 30." },
      offset: { type: "integer", minimum: 0 },
    }),
    async run(args) {
      const query = typeof args.query === "string" ? args.query : "";
      const category = readOptionalString(args, "category");
      if (category && category !== CUSTOM_CATEGORY && !categories.some((candidate) => candidate.id === category)) {
        throw new Error(`categoria desconhecida: ${category}`);
      }
      const terms = withoutAccents(query).split(/\s+/).filter(Boolean);
      const found = [...customBlocks(), ...blocks].filter(
        (block) => (!category || block.category === category) && matchesQuery(block, terms),
      );
      const offset = readNumber(args, "offset", 0);
      const limit = Math.min(MAX_SEARCH_LIMIT, readNumber(args, "limit", DEFAULT_SEARCH_LIMIT));
      return text({
        total: found.length,
        blocks: found.slice(offset, offset + limit).map((block) => ({
          id: block.id,
          name: block.name,
          category: block.category,
          size: roundAll(blockBounds(block.id).getSize(new THREE.Vector3()).toArray()),
          sockets: block.sockets.map((socket) => socket.id),
        })),
        ...(terms.length === 0 && !category
          ? {
              categories: categories.map(({ id, name, group }) => ({
                id,
                name,
                group,
                blocks: blocks.filter((block) => block.category === id).length,
              })),
            }
          : {}),
      });
    },
  },
  {
    name: "get_block",
    title: "Read a block",
    description:
      "Returns a block's size, bounds relative to its origin, triangle count and sockets. The first socket is the one the block normally attaches with.",
    readOnly: true,
    inputSchema: object({ id: { type: "string" } }, ["id"]),
    async run(args) {
      const block = getBlock(readString(args, "id"));
      return text({
        id: block.id,
        name: block.name,
        category: block.category,
        defaultColor: block.color,
        triangles: blockTriangles(block.id),
        ...describeBox(blockBounds(block.id)),
        sockets: block.sockets.map((socket) => ({ id: socket.id, position: socket.p, normal: socket.n })),
      });
    },
  },
  {
    name: "capture_view",
    title: "See the model",
    description:
      "Renders pictures of the model so you can check your work. The user's camera doesn't move. Views are framed on the whole scene, or on the given parts. 'current' shows what the user is looking at.",
    readOnly: true,
    inputSchema: object({
      views: {
        type: "array",
        items: { type: "string", enum: CAPTURE_VIEWS },
        minItems: 1,
        maxItems: MAX_CAPTURE_VIEWS,
        description: "Defaults to ['iso'].",
      },
      width: { type: "integer", minimum: MIN_CAPTURE_SIZE, maximum: MAX_CAPTURE_SIZE },
      height: { type: "integer", minimum: MIN_CAPTURE_SIZE, maximum: MAX_CAPTURE_SIZE },
      ids: { ...IDS, description: "Frames only these parts." },
    }),
    async run(args, deps) {
      const views = (args.views ?? ["iso"]) as CaptureView[];
      if (
        !Array.isArray(views) ||
        views.length === 0 ||
        views.length > MAX_CAPTURE_VIEWS ||
        !views.every((view) => CAPTURE_VIEWS.includes(view))
      ) {
        throw new Error(`"views" aceita até ${MAX_CAPTURE_VIEWS} de: ${CAPTURE_VIEWS.join(", ")}`);
      }
      const width = clampSize(readNumber(args, "width", DEFAULT_CAPTURE_WIDTH));
      const height = clampSize(readNumber(args, "height", DEFAULT_CAPTURE_HEIGHT));
      const ids = readOptionalIds(args, "ids");

      const content: ToolContent[] = [];
      for (const view of views) {
        const data = await deps.capture(view, width, height, ids);
        content.push({ type: "text", text: `Vista: ${view}` });
        content.push({ type: "image", data, mimeType: "image/jpeg" });
      }
      return { content };
    },
  },
  {
    name: "create_shape",
    title: "Create a new shape",
    description: `Creates a brand-new editable shape from nothing, so you are never limited to the catalog. The shape is a polygon mesh stored in the project; its id (shape.N) works anywhere a block id does, including add_parts and attach_part. Pieces are joined into one shape, and operations then refine it. By default one part is placed on the floor at the origin.\n${PIECE_HELP}\nOPERATIONS (optional): ${OPERATION_HELP}`,
    activity: "Criando forma",
    inputSchema: object(
      {
        name: { type: "string", description: "A short name, in Portuguese, shown to the user." },
        color: { ...COLOR, description: "The part's color, used by faces without their own." },
        pieces: {
          type: "array",
          minItems: 1,
          maxItems: MAX_PIECES,
          items: {
            type: "object",
            properties: { type: { type: "string", enum: PIECE_TYPES } },
            required: ["type"],
            additionalProperties: true,
          },
        },
        operations: { type: "array", items: { type: "object", additionalProperties: true } },
        smoothAngle: {
          type: "number",
          minimum: 0,
          maximum: 180,
          description: "Edges sharper than this stay hard. 0 is faceted, 180 fully smooth. Defaults to 35.",
        },
        sockets: {
          type: "array",
          description: "Custom attachment points [{id, position, normal}]. Defaults to one at the middle of each side, base first.",
          items: { type: "object", additionalProperties: true },
        },
        place: {
          description: "False creates the shape without placing it. Otherwise {position?, rotation?, scale?, onGround?}.",
          oneOf: [
            { type: "boolean" },
            {
              type: "object",
              properties: { position: POSITION, rotation: ROTATION, scale: SCALE, onGround: { type: "boolean" } },
              additionalProperties: false,
            },
          ],
        },
      },
      ["name", "pieces"],
    ),
    async run(args, deps) {
      const pieces = readRecords(args, "pieces");
      if (pieces.length > MAX_PIECES) throw new Error(`no máximo ${MAX_PIECES} peças por forma`);
      let mesh = joinMeshes(pieces.map((piece) => buildPiece(piece)));
      mesh = { ...mesh, smoothAngle: readNumber(args, "smoothAngle", DEFAULT_SMOOTH_ANGLE) };
      if (args.operations !== undefined) mesh = runOperations(mesh, readOperations(args), await deps.getState()).mesh;

      const placement: Args | typeof NO_PLACEMENT =
        args.place === false ? NO_PLACEMENT : isRecord(args.place) ? args.place : {};
      const parts: Extract<Command, { type: "addShape" }>["parts"] = [];
      if (placement !== NO_PLACEMENT) {
        const position = readOptionalVec3(placement, "position") ?? ([0, 0, 0] as Vec3);
        const rotation =
          placement.rotation === undefined
            ? ([0, 0, 0, 1] as Quat)
            : eulerToQuat(readVec3(placement.rotation, "rotation"));
        const scale = readOptionalVec3(placement, "scale") ?? ([1, 1, 1] as Vec3);
        if (readBoolean(placement, "onGround", placement.position === undefined)) {
          position[1] -= meshBounds(transformMesh(mesh, transform(position, rotation, scale))).min[1];
        }
        parts.push({ position, rotation, scale });
      }

      const [number, partId] = await deps.apply({
        type: "addShape",
        shape: {
          name: readString(args, "name"),
          color: readOptionalString(args, "color") ?? DEFAULT_SHAPE_COLOR,
          sockets: args.sockets === undefined ? [] : readSockets(args.sockets),
          ...shapeFields(mesh),
        },
        parts,
      });
      const shape = findShape(await refreshShapes(deps), `shape.${number}`);
      return text({ ...describeShape(shape), ...(partId === undefined ? {} : { partId }) });
    },
  },
  {
    name: "edit_shape",
    title: "Edit a shape",
    description: `Changes the polygons of a shape you or the user made, as one undo step. Every part using the shape changes with it. If one operation fails, nothing changes.\n${OPERATION_HELP}`,
    activity: "Modelando forma",
    inputSchema: object(
      {
        id: { type: "string", description: "A shape id such as shape.1." },
        operations: { type: "array", minItems: 1, items: { type: "object", additionalProperties: true } },
      },
      ["id", "operations"],
    ),
    async run(args, deps) {
      const id = readString(args, "id");
      const snapshot = await deps.getState();
      const shape = findShape(snapshot, id);
      const { mesh, context } = runOperations(shape, readOperations(args), snapshot);
      await deps.apply({ type: "updateShape", shape: { ...shape, ...shapeFields(mesh) } });
      const updated = findShape(await refreshShapes(deps), id);
      return text({ ...describeShape(updated), lastCaps: context.caps, lastSides: context.sides });
    },
  },
  {
    name: "get_shape",
    title: "Read a shape",
    description:
      "Returns a shape's size, materials and sockets. With includeGeometry it also lists every vertex and every face with its center and normal, for choosing what to edit.",
    readOnly: true,
    inputSchema: object({ id: { type: "string" }, includeGeometry: { type: "boolean" } }, ["id"]),
    async run(args, deps) {
      const shape = findShape(await deps.getState(), readString(args, "id"));
      if (!readBoolean(args, "includeGeometry", false)) return text(describeShape(shape));
      if (shape.faces.length > MAX_LISTED_FACES) {
        throw new Error(`esta forma tem ${shape.faces.length} faces; use seletores em edit_shape em vez de listá-las`);
      }
      return text({
        ...describeShape(shape),
        vertexList: shape.vertices.map(roundAll),
        faceList: shape.faces.map((face, id) => ({
          id,
          vertices: face,
          center: roundAll(faceCenter(shape, face)),
          normal: roundAll(faceNormal(shape, face)),
          material: shape.faceMaterials[id],
        })),
      });
    },
  },
  {
    name: "list_shapes",
    title: "List shapes",
    description: "Lists the shapes made in this project and how many parts use each one.",
    readOnly: true,
    inputSchema: object({}),
    async run(_args, deps) {
      const { project } = await deps.getState();
      return text({
        shapes: project.shapes.map((shape) => ({
          id: shape.id,
          name: shape.name,
          vertices: shape.vertices.length,
          faces: shape.faces.length,
          parts: project.parts.filter((part) => part.block === shape.id).length,
        })),
      });
    },
  },
  {
    name: "update_shape",
    title: "Change a shape's settings",
    description: "Renames a shape or changes its default color, smoothing or attachment points.",
    activity: "Ajustando forma",
    inputSchema: object(
      {
        id: { type: "string" },
        name: { type: "string" },
        color: COLOR,
        smoothAngle: { type: "number", minimum: 0, maximum: 180 },
        sockets: { type: "array", items: { type: "object", additionalProperties: true } },
      },
      ["id"],
    ),
    async run(args, deps) {
      const id = readString(args, "id");
      const shape = findShape(await deps.getState(), id);
      const color = readOptionalString(args, "color");
      const name = readOptionalString(args, "name");
      await deps.apply({
        type: "updateShape",
        shape: {
          ...shape,
          ...(name ? { name } : {}),
          ...(color ? { color } : {}),
          smoothAngle: readNumber(args, "smoothAngle", shape.smoothAngle),
          sockets: args.sockets === undefined ? shape.sockets : readSockets(args.sockets),
        },
      });
      return text(describeShape(findShape(await refreshShapes(deps), id)));
    },
  },
  {
    name: "duplicate_shape",
    title: "Copy a shape",
    description:
      "Makes an independent copy of a shape, for a variation that shouldn't change the original. Editing a shape changes every part using it; editing a copy doesn't.",
    activity: "Copiando forma",
    inputSchema: object({ id: { type: "string" }, name: { type: "string" } }, ["id"]),
    async run(args, deps) {
      const shape = findShape(await deps.getState(), readString(args, "id"));
      const [number] = await deps.apply({
        type: "addShape",
        shape: { ...shape, name: readOptionalString(args, "name") ?? `${shape.name} (cópia)` },
      });
      return text(describeShape(findShape(await refreshShapes(deps), `shape.${number}`)));
    },
  },
  {
    name: "delete_shape",
    title: "Delete a shape",
    description: "Deletes a shape and every part using it. The user can bring them back with undo.",
    activity: "Removendo forma",
    inputSchema: object({ id: { type: "string" } }, ["id"]),
    async run(args, deps) {
      const removedParts = await deps.apply({ type: "removeShape", id: readString(args, "id") });
      await refreshShapes(deps);
      return text({ removedParts });
    },
  },
  {
    name: "convert_to_shape",
    title: "Make parts editable",
    description:
      "Turns catalog parts into one editable shape and replaces them with it, so a ready-made model can be reshaped with edit_shape. One part keeps its place and scale; several are joined and centered on their base.",
    activity: "Convertendo em forma",
    inputSchema: object({ ids: IDS, name: { type: "string" } }, ["ids"]),
    async run(args, deps) {
      const snapshot = await deps.getState();
      const ids = readIds(args, "ids");
      const parts = ids.map((id) => findPart(snapshot, id));
      const { mesh, position, rotation, scale, color } = convertParts(parts);
      const name = readOptionalString(args, "name") ?? getBlock(parts[0].block).name;
      const [number, partId] = await deps.apply({
        type: "addShape",
        shape: { name, color, sockets: [], ...shapeFields(mesh) },
        parts: [{ position, rotation, scale, color }],
        removeParts: ids,
      });
      const shape = findShape(await refreshShapes(deps), `shape.${number}`);
      return text({ ...describeShape(shape), partId });
    },
  },
  {
    name: "add_parts",
    title: "Add parts",
    description:
      "Places blocks at free positions, as one undo step. Use onGround to rest a block on the floor; its height is then computed for you.",
    activity: "Colocando peças",
    inputSchema: object(
      {
        parts: {
          type: "array",
          minItems: 1,
          maxItems: MAX_PARTS_PER_CALL,
          items: object(
            {
              block: { type: "string", description: "A block id from search_blocks." },
              position: POSITION,
              rotation: ROTATION,
              scale: SCALE,
              color: COLOR,
              onGround: { type: "boolean", description: "Ignores position[1] and rests the block on the floor." },
            },
            ["block", "position"],
          ),
        },
        group: { type: "boolean", description: "Makes the new parts one group, so they move together." },
      },
      ["parts"],
    ),
    async run(args, deps) {
      const parts = readRecords(args, "parts").map(readNewPart);
      const group = readBoolean(args, "group", false);
      return text({ created: await deps.apply({ type: "addParts", parts, replace: false, group }) });
    },
  },
  {
    name: "attach_part",
    title: "Attach to a socket",
    description:
      "Attaches a new block to a socket of an existing part, the way the user does with the green points. Returns the new part with its world sockets, ready for the next attachment.",
    activity: "Encaixando peça",
    inputSchema: object(
      {
        block: { type: "string", description: "The block to add." },
        parentId: { type: "integer", description: "The part to attach to." },
        parentSocket: { type: "string", description: "A socket id of the parent's block." },
        socket: { type: "string", description: "Which socket of the new block touches the parent. Defaults to its first." },
        quarterTurns: { type: "integer", minimum: 0, maximum: 3, description: "Spins the block around the socket, in steps of 90 degrees." },
        scale: SCALE,
        color: COLOR,
      },
      ["block", "parentId", "parentSocket"],
    ),
    async run(args, deps) {
      const parent = findPart(await deps.getState(), readId(args, "parentId"));
      const parentBlock = getBlock(parent.block);
      const parentSocket = readString(args, "parentSocket");
      const target = worldSockets(parentBlock.sockets, partMatrix(parent)).find(
        (socket) => socket.id === parentSocket,
      );
      if (!target) {
        throw new Error(
          `o bloco ${parent.block} não tem o encaixe "${parentSocket}". Encaixes: ${parentBlock.sockets.map((socket) => socket.id).join(", ")}`,
        );
      }

      const blockId = readString(args, "block");
      const block = getBlock(blockId);
      const socketId = readOptionalString(args, "socket");
      const base = socketId ? block.sockets.find((socket) => socket.id === socketId) : block.sockets[0];
      if (!base) {
        throw new Error(
          `o bloco ${blockId} não tem o encaixe "${socketId}". Encaixes: ${block.sockets.map((socket) => socket.id).join(", ")}`,
        );
      }

      const scale = readOptionalVec3(args, "scale") ?? ([1, 1, 1] as Vec3);
      const color = readOptionalString(args, "color");
      const turns = ((readNumber(args, "quarterTurns", 0) % QUARTER_TURNS) + QUARTER_TURNS) % QUARTER_TURNS;
      const placement = alignToSurface(base, target.position, target.normal, turns, new THREE.Vector3(...scale));
      const position = placement.position.toArray() as Vec3;
      const rotation = placement.quaternion.toArray() as Quat;

      const [id] = await deps.apply({
        type: "addPart",
        block: blockId,
        position,
        rotation,
        scale,
        ...(color ? { color } : {}),
      });
      return text({
        id,
        position: roundAll(position),
        rotation: quatToEuler(rotation),
        sockets: describeWorldSockets(block, transform(position, rotation, scale)),
      });
    },
  },
  {
    name: "update_parts",
    title: "Change parts",
    description: "Changes the position, rotation, scale or color of parts, as one undo step.",
    activity: "Ajustando peças",
    inputSchema: object(
      {
        updates: {
          type: "array",
          minItems: 1,
          items: object(
            { id: { type: "integer" }, position: POSITION, rotation: ROTATION, scale: SCALE, color: COLOR },
            ["id"],
          ),
        },
      },
      ["updates"],
    ),
    async run(args, deps) {
      const updates = readRecords(args, "updates").map(readUpdate);
      return text({ updated: await deps.apply({ type: "updateParts", updates }) });
    },
  },
  {
    name: "move_parts",
    title: "Move parts",
    description: "Moves parts by an offset, keeping their relative positions. Useful for a whole model.",
    activity: "Movendo peças",
    inputSchema: object(
      { ids: IDS, offset: { ...VEC3, description: "How far to move on each axis, in meters." } },
      ["ids", "offset"],
    ),
    async run(args, deps) {
      const snapshot = await deps.getState();
      const offset = readVec3(args.offset, "offset");
      const updates = readIds(args, "ids").map((id) => {
        const { position } = findPart(snapshot, id);
        return { id, position: position.map((value, axis) => value + offset[axis]) as Vec3 };
      });
      return text({ moved: await deps.apply({ type: "updateParts", updates }) });
    },
  },
  {
    name: "duplicate_parts",
    title: "Duplicate parts",
    description: "Copies parts, moving the copies by an offset. Copies of a group form a new group.",
    activity: "Duplicando peças",
    inputSchema: object({ ids: IDS, offset: VEC3 }, ["ids", "offset"]),
    async run(args, deps) {
      const created = await deps.apply({
        type: "duplicateParts",
        ids: readIds(args, "ids"),
        offset: readVec3(args.offset, "offset"),
      });
      return text({ created });
    },
  },
  {
    name: "remove_parts",
    title: "Remove parts",
    description: "Deletes parts. The user can bring them back with undo.",
    activity: "Removendo peças",
    inputSchema: object({ ids: IDS }, ["ids"]),
    async run(args, deps) {
      return text({ removed: await deps.apply({ type: "removeParts", ids: readIds(args, "ids") }) });
    },
  },
  {
    name: "group_parts",
    title: "Group parts",
    description: "Joins parts into one group, so the user selects and moves them together, or ungroups them.",
    activity: "Agrupando peças",
    inputSchema: object(
      { ids: IDS, grouped: { type: "boolean", description: "False ungroups. Defaults to true." } },
      ["ids"],
    ),
    async run(args, deps) {
      const ids = readIds(args, "ids");
      const grouped = readBoolean(args, "grouped", true);
      return text({ changed: await deps.apply({ type: "setGrouped", ids, grouped }) });
    },
  },
  {
    name: "clear_scene",
    title: "Clear the scene",
    description: "Removes every part. The user can bring them back with undo.",
    activity: "Limpando a cena",
    inputSchema: object({}),
    async run(_args, deps) {
      await deps.apply({ type: "addParts", parts: [], replace: true });
      return text(historyState(await deps.getState()));
    },
  },
  {
    name: "generate",
    title: "Generate a model",
    description:
      "Builds a complete random model with one of the editor's generators. The same seed gives the same model. By default it goes beside what's already in the scene.",
    activity: "Gerando modelo",
    inputSchema: object(
      {
        generator: { type: "string", enum: generators.map((generator) => generator.id) },
        seed: { type: "integer", description: "Defaults to a random number." },
        keep: { type: "boolean", description: "False replaces the whole scene. Defaults to true." },
      },
      ["generator"],
    ),
    async run(args, deps) {
      const generator = readString(args, "generator");
      if (!generators.some((candidate) => candidate.id === generator)) {
        throw new Error(`gerador desconhecido: ${generator}`);
      }
      const seed = readNumber(args, "seed", Math.floor(Math.random() * SEED_RANGE));
      const created = await deps.generate(generator, seed, readBoolean(args, "keep", true));
      return text({ seed, created });
    },
  },
  {
    name: "undo",
    title: "Undo",
    description: "Undoes the last change, whether it came from you or from the user.",
    activity: "Desfazendo",
    inputSchema: object({}),
    async run(_args, deps) {
      await deps.undo();
      return text(historyState(await deps.getState()));
    },
  },
  {
    name: "redo",
    title: "Redo",
    description: "Redoes the last undone change.",
    activity: "Refazendo",
    inputSchema: object({}),
    async run(_args, deps) {
      await deps.redo();
      return text(historyState(await deps.getState()));
    },
  },
  {
    name: "frame_view",
    title: "Show the model",
    description: "Moves the user's camera to frame the whole scene. Call it when you finish.",
    inputSchema: object({}),
    async run(_args, deps) {
      await deps.frame();
      return text({ framed: true });
    },
  },
  {
    name: "export_glb",
    title: "Export GLB",
    description:
      "Exports the scene, or only the given parts, to a new GLB file in the user's Documents folder and returns its path. It never replaces an existing file.",
    inputSchema: object({
      name: { type: "string", description: "File name without extension. Defaults to the project's name." },
      ids: { ...IDS, description: "Exports only these parts." },
      merge: { type: "boolean", description: "Joins everything into one mesh. Defaults to false." },
      center: { type: "boolean", description: "Puts the base of the model at the origin. Defaults to true." },
    }),
    async run(args, deps) {
      const { project } = await deps.getState();
      const ids = readOptionalIds(args, "ids");
      const chosen = ids ? new Set(ids) : null;
      const parts = chosen ? project.parts.filter((part) => chosen.has(part.id)) : project.parts;
      if (parts.length === 0) throw new Error("não há peças para exportar");

      const name = readOptionalString(args, "name") ?? project.name;
      const options = {
        name,
        merge: readBoolean(args, "merge", false),
        center: readBoolean(args, "center", true),
      };
      const bytes = new Uint8Array(await deps.exportGlb(parts, options));
      const path = await deps.saveExport(name, bytes);
      return text({ path, parts: parts.length, triangles: countTriangles(parts), bytes: bytes.length });
    },
  },
];

export function listTools() {
  return {
    tools: tools.map(({ name, title, description, inputSchema, readOnly }) => ({
      name,
      title,
      description,
      inputSchema,
      annotations: { title, readOnlyHint: Boolean(readOnly) },
    })),
  };
}

/** What to show the person while a tool runs, if it changes anything. */
export function toolActivity(name: unknown): string | undefined {
  return tools.find((tool) => tool.name === name)?.activity;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Failures come back as results, so the agent can read them and try something else. */
export async function callTool(name: unknown, args: unknown, deps: ToolDeps): Promise<ToolResult> {
  try {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error(`ferramenta desconhecida: ${String(name)}`);
    await refreshShapes(deps);
    return await tool.run(isRecord(args) ? args : {}, deps);
  } catch (error) {
    return { content: [{ type: "text", text: errorText(error) }], isError: true };
  }
}
