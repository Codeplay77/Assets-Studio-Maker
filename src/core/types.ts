import type { Finish } from "../blocks/types";

export type { Finish };
export type PartId = number;
export type Vec3 = [number, number, number];
export type Quat = [number, number, number, number];
export type Tool = "translate" | "rotate" | "scale";

export interface Part {
  id: PartId;
  block: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  color: string;
  /** Parts sharing a group are selected and moved together. */
  group?: number;
}

/** A face without `color` follows the color of the part using the shape. */
export interface ShapeMaterial {
  color?: string;
  shade?: number;
  finish?: Finish;
  /** A photographed material (see src/blocks/surfaces.ts), laid on the faces at its real size. */
  texture?: string;
  /** Takes its colors from the shape's `vertexColors`, so they blend across the faces. */
  painted?: boolean;
}

export interface ShapeSocket {
  id: string;
  p: Vec3;
  n: Vec3;
}

/** A polygon mesh that belongs to the project. Parts use it through its id, `shape.N`. */
export interface CustomShape {
  id: string;
  name: string;
  color: string;
  vertices: Vec3[];
  faces: number[][];
  faceMaterials: number[];
  materials: ShapeMaterial[];
  smoothAngle: number;
  /** Left empty, the editor derives attachment points from the shape's bounds. */
  sockets: ShapeSocket[];
  /** One 0xRRGGBB color per vertex, for materials that are painted. */
  vertexColors?: number[];
  /** Made by a generator: it goes away together with the model that uses it. */
  generated?: boolean;
}

export type GeneratedShape = Omit<CustomShape, "id" | "generated">;

export interface Project {
  name: string;
  parts: Part[];
  nextId: PartId;
  nextGroup: number;
  shapes: CustomShape[];
  nextShape: number;
  /** The animations each character carries into an export, under the id of its hips part. */
  animations?: Record<string, string[]>;
}

export interface EditorSnapshot {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
  /** True when the scene differs from what was last saved. */
  dirty: boolean;
  path: string | null;
}

export interface PartUpdate {
  id: PartId;
  position?: Vec3;
  rotation?: Quat;
  scale?: Vec3;
  color?: string;
}

export interface AgentStatus {
  enabled: boolean;
  running: boolean;
  url: string;
  key: string;
  error: string | null;
}

/** `group` selects the whole group, `single` one part, `toggle` adds to the selection. */
export type PickMode = "group" | "single" | "toggle";

export type Command =
  | {
      type: "addPart";
      block: string;
      position: Vec3;
      rotation?: Quat;
      scale?: Vec3;
      color?: string;
    }
  | {
      type: "updatePart";
      id: PartId;
      position?: Vec3;
      rotation?: Quat;
      scale?: Vec3;
      color?: string;
    }
  | {
      type: "addParts";
      parts: { block: string; position: Vec3; rotation?: Quat; scale?: Vec3; color?: string }[];
      /** Clears the scene first, in the same undo step. */
      replace: boolean;
      /** Makes the new parts one group, so they move as a single model. */
      group?: boolean;
      /** Parts that go away in the same undo step. */
      remove?: PartId[];
      /** Shapes made for this model. A part uses one through the block id `@index`. */
      shapes?: GeneratedShape[];
    }
  | { type: "updateParts"; updates: PartUpdate[] }
  | { type: "setGrouped"; ids: PartId[]; grouped: boolean }
  | { type: "removeParts"; ids: PartId[] }
  | { type: "duplicateParts"; ids: PartId[]; offset: Vec3 }
  /** Resolves to the shape's number followed by the new part ids. */
  | {
      type: "addShape";
      shape: Omit<CustomShape, "id"> & { id?: string };
      parts?: { position: Vec3; rotation?: Quat; scale?: Vec3; color?: string }[];
      removeParts?: PartId[];
    }
  | { type: "updateShape"; shape: CustomShape }
  | { type: "removeShape"; id: string }
  /** `part` is the character's hips; an empty list takes its animations away. */
  | { type: "setAnimations"; part: PartId; clips: string[] };
