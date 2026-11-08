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
}

export interface Project {
  name: string;
  parts: Part[];
  nextId: PartId;
}

export interface EditorSnapshot {
  project: Project;
  canUndo: boolean;
  canRedo: boolean;
  revision: number;
}

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
    }
  | { type: "removeParts"; ids: PartId[] }
  | { type: "duplicateParts"; ids: PartId[]; offset: Vec3 };
