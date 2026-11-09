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
}

export interface Project {
  name: string;
  parts: Part[];
  nextId: PartId;
  nextGroup: number;
  shapes: CustomShape[];
  nextShape: number;
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
  | { type: "removeShape"; id: string };
