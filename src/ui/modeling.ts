import * as THREE from "three";
import { getBlock } from "../blocks/catalog";
import * as api from "../core/api";
import { useEditor } from "../core/store";
import type { CustomShape, Part, PartId, Vec3 } from "../core/types";
import type { BooleanMode } from "../modeling/boolean";
import { combineParts as combine, convertParts } from "../modeling/convert";
import { DEFAULT_SMOOTH_ANGLE, meshBounds, transformMesh, type PolyMesh } from "../modeling/mesh";
import { buildPiece, newContext, runOperation, type OperationContext } from "../modeling/operations";
import { freeSpotBeside } from "./actions";

export interface BaseShape {
  id: string;
  name: string;
  piece: Record<string, unknown>;
}

export const BASE_SHAPES: BaseShape[] = [
  { id: "box", name: "Cubo", piece: { type: "box", size: [1, 1, 1] } },
  { id: "rounded", name: "Caixa redonda", piece: { type: "rounded_box", size: [1, 1, 1], radius: 0.18, segments: 3 } },
  { id: "sphere", name: "Esfera", piece: { type: "sphere", radius: 0.5, segments: 24, rows: 16 } },
  { id: "cylinder", name: "Cilindro", piece: { type: "cylinder", radius: 0.5, height: 1, segments: 24 } },
  { id: "cone", name: "Cone", piece: { type: "cone", radius: 0.5, height: 1, segments: 24 } },
  { id: "capsule", name: "Cápsula", piece: { type: "capsule", radius: 0.3, length: 0.5 } },
  { id: "torus", name: "Rosca", piece: { type: "torus", radius: 0.4, tube: 0.15 } },
  { id: "wedge", name: "Rampa", piece: { type: "wedge", size: [1, 1, 1] } },
  { id: "plane", name: "Plano", piece: { type: "plane", width: 1, depth: 1, columns: 4, rows: 4 } },
];

const SHAPE_COLOR = "#8a9bb0";

function shapeFields({ vertices, faces, faceMaterials, materials, smoothAngle }: PolyMesh) {
  return { vertices, faces, faceMaterials, materials, smoothAngle };
}

/** Waits until this window has the state a command just produced. */
async function catchUp(): Promise<void> {
  useEditor.getState().receiveSnapshot(await api.getState());
}

function modelingTarget(): { shape: CustomShape; part: Part } | null {
  const { modeling, snapshot } = useEditor.getState();
  if (!modeling || !snapshot) return null;
  const shape = snapshot.project.shapes.find((candidate) => candidate.id === modeling.shapeId);
  const part = snapshot.project.parts.find((candidate) => candidate.id === modeling.partId);
  return shape && part ? { shape, part } : null;
}

export function editedShape(): CustomShape | null {
  return modelingTarget()?.shape ?? null;
}

async function saveMesh(shape: CustomShape, mesh: PolyMesh): Promise<boolean> {
  const result = await useEditor.getState().dispatch({ type: "updateShape", shape: { ...shape, ...shapeFields(mesh) } });
  if (result) await catchUp();
  return result !== null;
}

export async function commitVertices(vertices: Vec3[]): Promise<boolean> {
  const shape = editedShape();
  return shape ? saveMesh(shape, { ...shape, vertices }) : false;
}

/** The faces whose every corner is selected, which is how faces are chosen outside face mode. */
export function facesFromVertices(shape: CustomShape, vertices: readonly number[]): number[] {
  const chosen = new Set(vertices);
  return shape.faces.flatMap((face, id) => (face.every((vertex) => chosen.has(vertex)) ? [id] : []));
}

export function selectedFaces(): number[] {
  const { meshMode, meshFaces, meshVertices } = useEditor.getState();
  if (meshMode === "face") return meshFaces;
  const shape = editedShape();
  return shape ? facesFromVertices(shape, meshVertices) : [];
}

export function selectedVertices(): number[] {
  const { meshMode, meshFaces, meshVertices } = useEditor.getState();
  if (meshMode !== "face") return meshVertices;
  const shape = editedShape();
  return shape ? [...new Set(meshFaces.flatMap((id) => shape.faces[id] ?? []))] : [];
}

/**
 * Runs one step of the shared operations on the shape being edited. `after` picks what stays
 * selected, once the new shape has arrived.
 */
export async function runOnShape(
  operation: Record<string, unknown>,
  after?: (context: OperationContext) => void,
): Promise<void> {
  const editor = useEditor.getState();
  const shape = editedShape();
  if (!shape) return;
  const context = newContext();
  let mesh: PolyMesh;
  try {
    mesh = runOperation(shape, operation, context);
  } catch (error) {
    editor.report(error instanceof Error ? error.message : error);
    return;
  }
  if ((await saveMesh(shape, mesh)) && after) after(context);
}

function keepCaps(context: OperationContext): void {
  const editor = useEditor.getState();
  editor.setMeshMode("face");
  editor.setMeshSelection(context.caps, []);
}

const clearAfter = () => useEditor.getState().setMeshSelection([], []);

export function pullFaces(distance: number): Promise<void> {
  return runOnShape({ op: "extrude", faces: { ids: selectedFaces() }, distance }, keepCaps);
}

export function insetFaces(amount: number): Promise<void> {
  return runOnShape({ op: "inset", faces: { ids: selectedFaces() }, amount }, keepCaps);
}

export function divideFaces(): Promise<void> {
  const faces = selectedFaces();
  return runOnShape({ op: "subdivide", ...(faces.length > 0 ? { faces: { ids: faces } } : {}) }, clearAfter);
}

export function deleteSelected(): Promise<void> {
  const { meshMode } = useEditor.getState();
  return meshMode === "face"
    ? runOnShape({ op: "delete_faces", faces: { ids: selectedFaces() } }, clearAfter)
    : runOnShape({ op: "delete_vertices", vertices: { ids: selectedVertices() } }, clearAfter);
}

export function weldSelected(): Promise<void> {
  return runOnShape({ op: "weld", vertices: { ids: selectedVertices() } }, clearAfter);
}

export function fillSelected(): Promise<void> {
  return runOnShape({ op: "fill", vertices: { ids: selectedVertices() } }, keepCaps);
}

/** With faces, their outline. With points or edges, what they connect. With nothing, every sharp edge. */
export function bevelSelected(): Promise<void> {
  const { meshMode, meshFaces, meshVertices, bevelAmount, bevelSegments } = useEditor.getState();
  let edges: Record<string, unknown> = { sharp: 30 };
  if (meshMode === "face" && meshFaces.length > 0) edges = { faces: { ids: meshFaces } };
  else if (meshMode !== "face" && meshVertices.length > 0) edges = { vertices: { ids: meshVertices } };
  return runOnShape({ op: "bevel", edges, amount: bevelAmount, segments: bevelSegments }, clearAfter);
}

export function drillSelected(): Promise<void> {
  const { holeShape, holeSize, holeDepth } = useEditor.getState();
  return runOnShape(
    {
      op: "hole",
      faces: { ids: selectedFaces() },
      shape: holeShape,
      size: holeSize,
      ...(holeDepth > 0 ? { depth: holeDepth } : {}),
    },
    clearAfter,
  );
}

/** A low-detail shape has too few points for the brush to move, so this adds more. */
export function addDetail(): Promise<void> {
  return runOnShape({ op: "subdivide" }, clearAfter);
}

export function roundShape(): Promise<void> {
  return runOnShape({ op: "round" }, clearAfter);
}

export function smoothShape(): Promise<void> {
  const vertices = selectedVertices();
  return runOnShape({ op: "smooth", factor: 0.5, ...(vertices.length > 0 ? { vertices: { ids: vertices } } : {}) });
}

export function mirrorShape(axis: "x" | "y" | "z"): Promise<void> {
  return runOnShape({ op: "mirror", axis }, clearAfter);
}

export function paintSelected(material: { color?: string; finish?: string }): Promise<void> {
  return runOnShape({ op: "paint", faces: { ids: selectedFaces() }, ...material });
}

export async function updateShapeSettings(changes: Partial<Pick<CustomShape, "name" | "smoothAngle" | "color">>): Promise<void> {
  const shape = editedShape();
  if (shape) await useEditor.getState().dispatch({ type: "updateShape", shape: { ...shape, ...changes } });
}

export function selectEverything(): void {
  const editor = useEditor.getState();
  const shape = editedShape();
  if (!shape) return;
  if (editor.meshMode === "face") editor.setMeshSelection(shape.faces.map((_, id) => id), []);
  else editor.setMeshSelection([], shape.vertices.map((_, id) => id));
}

async function startEditing(partId: PartId | undefined): Promise<void> {
  if (partId === undefined) return;
  await catchUp();
  const editor = useEditor.getState();
  editor.select([partId]);
  editor.enterModeling(partId);
  editor.requestFocus();
}

/** Starts a new shape from a basic form, resting on the floor beside whatever is in the scene. */
export async function createBaseShape(base: BaseShape): Promise<void> {
  const editor = useEditor.getState();
  const mesh = buildPiece(base.piece);
  const x = freeSpotBeside();
  const position: Vec3 = [x, -meshBounds(transformMesh(mesh, new THREE.Matrix4())).min[1], 0];
  const created = await editor.dispatch({
    type: "addShape",
    shape: {
      name: base.name,
      color: SHAPE_COLOR,
      sockets: [],
      ...shapeFields({ ...mesh, smoothAngle: DEFAULT_SMOOTH_ANGLE }),
    },
    parts: [{ position }],
  });
  if (created) await startEditing(created[1]);
}

/** Makes ready-made parts editable, replacing them with one shape, and starts editing it. */
export async function convertToShape(parts: Part[]): Promise<void> {
  const editor = useEditor.getState();
  try {
    const { mesh, position, rotation, scale, color } = convertParts(parts);
    const created = await editor.dispatch({
      type: "addShape",
      shape: { name: getBlock(parts[0].block).name, color, sockets: [], ...shapeFields(mesh) },
      parts: [{ position, rotation, scale, color }],
      removeParts: parts.map((part) => part.id),
    });
    if (created) await startEditing(created[1]);
  } catch (error) {
    editor.report(error instanceof Error ? error.message : error);
  }
}

/** Cuts the part selected first with the others, or joins them, replacing them with one shape. */
export async function combineSelected(parts: Part[], mode: BooleanMode): Promise<void> {
  const editor = useEditor.getState();
  const order = new Map(editor.selection.map((id, index) => [id, index]));
  const ordered = [...parts].sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
  try {
    const { mesh, position, rotation, scale, color } = combine(ordered, mode);
    const created = await editor.dispatch({
      type: "addShape",
      shape: { name: getBlock(ordered[0].block).name, color, sockets: [], ...shapeFields(mesh) },
      parts: [{ position, rotation, scale, color }],
      removeParts: ordered.map((part) => part.id),
    });
    if (created) {
      await catchUp();
      editor.select([created[1]]);
    }
  } catch (error) {
    editor.report(error instanceof Error ? error.message : error);
  }
}

export function isShapePart(part: Part): boolean {
  return part.block.startsWith("shape.");
}

export function startModeling(part: Part): void {
  if (isShapePart(part)) useEditor.getState().enterModeling(part.id);
  else void convertToShape([part]);
}

export async function duplicateShape(shape: CustomShape): Promise<void> {
  await useEditor.getState().dispatch({ type: "addShape", shape: { ...shape, name: `${shape.name} (cópia)` } });
}

export async function removeShape(id: string): Promise<void> {
  await useEditor.getState().dispatch({ type: "removeShape", id });
}
