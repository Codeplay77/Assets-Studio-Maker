import type { Vec3 } from "../core/types";
import { add, faceNormal, normalize, sub, times, dot, type PolyMesh } from "./mesh";

export type BrushKind = "raise" | "lower" | "smooth" | "flatten" | "grab";

export const BRUSH_KINDS: BrushKind[] = ["raise", "lower", "smooth", "flatten", "grab"];

export interface BrushSettings {
  kind: BrushKind;
  radius: number;
  /** From 0 to 1. */
  strength: number;
  /** Also applies the brush on the other side of the X axis. */
  symmetry: boolean;
}

/** Each dab moves the surface by at most this fraction of the brush radius. */
const DAB_REACH = 0.12;
const SMOOTH_REACH = 0.6;
const FLATTEN_REACH = 0.35;
const SPACING = 0.2;

const falloff = (distance: number, radius: number) => 0.5 + 0.5 * Math.cos((Math.PI * distance) / radius);

interface Grabbed {
  id: number;
  weight: number;
  mirrored: boolean;
}

/** One press of the brush, held and dragged. Works on its own copy of the points. */
export class SculptStroke {
  readonly vertices: Vec3[];
  private readonly start: readonly Vec3[];
  private readonly normals: Vec3[];
  private readonly neighbors: number[][];
  private grabbed: Grabbed[] = [];
  private last: Vec3 | null = null;

  constructor(
    mesh: PolyMesh,
    private readonly settings: BrushSettings,
  ) {
    this.start = mesh.vertices;
    this.vertices = [...mesh.vertices];

    const normals = mesh.vertices.map((): Vec3 => [0, 0, 0]);
    const neighbors: Set<number>[] = mesh.vertices.map(() => new Set());
    for (const face of mesh.faces) {
      const normal = faceNormal(mesh, face);
      face.forEach((vertex, i) => {
        const after = face[(i + 1) % face.length];
        normals[vertex] = add(normals[vertex], normal);
        neighbors[vertex].add(after);
        neighbors[after].add(vertex);
      });
    }
    this.normals = normals.map(normalize);
    this.neighbors = neighbors.map((set) => [...set]);
  }

  /** Presses the brush here. Moving far since the last press fills the path in between. */
  paint(center: Vec3): void {
    const { radius } = this.settings;
    if (!this.last) {
      this.dab(center);
      this.last = center;
      return;
    }
    const gap = sub(center, this.last);
    const distance = Math.hypot(...gap);
    const step = radius * SPACING;
    if (distance < step) return;
    const count = Math.floor(distance / step);
    for (let i = 1; i <= count; i++) this.dab(add(this.last, times(gap, i / count)));
    this.last = center;
  }

  /** Takes hold of the surface around a point, ready for `drag`. */
  grab(center: Vec3): void {
    this.grabbed = this.around(center, false);
    if (this.settings.symmetry) this.grabbed.push(...this.around([-center[0], center[1], center[2]], true));
  }

  /** Moves what was taken by `grab`, from where it started. */
  drag(offset: Vec3): void {
    const mirroredOffset: Vec3 = [-offset[0], offset[1], offset[2]];
    for (const { id, weight, mirrored } of this.grabbed) {
      this.vertices[id] = add(this.start[id], times(mirrored ? mirroredOffset : offset, weight * this.settings.strength));
    }
  }

  private around(center: Vec3, mirrored: boolean): Grabbed[] {
    const { radius } = this.settings;
    const found: Grabbed[] = [];
    this.vertices.forEach((vertex, id) => {
      const distance = Math.hypot(vertex[0] - center[0], vertex[1] - center[1], vertex[2] - center[2]);
      if (distance < radius) found.push({ id, weight: falloff(distance, radius), mirrored });
    });
    return found;
  }

  private dab(center: Vec3): void {
    this.apply(this.around(center, false));
    if (this.settings.symmetry) this.apply(this.around([-center[0], center[1], center[2]], true));
  }

  private apply(hits: Grabbed[]): void {
    if (hits.length === 0) return;
    const { kind, radius, strength } = this.settings;

    if (kind === "smooth") {
      const source = this.vertices;
      const moved = hits.map(({ id, weight }) => {
        const around = this.neighbors[id];
        if (around.length === 0) return source[id];
        const middle = times(around.reduce((sum, other) => add(sum, source[other]), [0, 0, 0] as Vec3), 1 / around.length);
        return add(source[id], times(sub(middle, source[id]), SMOOTH_REACH * strength * weight));
      });
      hits.forEach(({ id }, index) => (this.vertices[id] = moved[index]));
      return;
    }

    let direction: Vec3 = [0, 0, 0];
    let planePoint: Vec3 = [0, 0, 0];
    let total = 0;
    for (const { id, weight } of hits) {
      direction = add(direction, times(this.normals[id], weight));
      planePoint = add(planePoint, times(this.vertices[id], weight));
      total += weight;
    }
    direction = normalize(direction);
    planePoint = times(planePoint, 1 / total);

    if (kind === "flatten") {
      for (const { id, weight } of hits) {
        const height = dot(sub(this.vertices[id], planePoint), direction);
        this.vertices[id] = sub(this.vertices[id], times(direction, height * FLATTEN_REACH * strength * weight));
      }
      return;
    }

    if (kind === "grab") return;
    const sign = kind === "raise" ? 1 : -1;
    for (const { id, weight } of hits) {
      this.vertices[id] = add(this.vertices[id], times(direction, sign * radius * DAB_REACH * strength * weight));
    }
  }
}

/** Runs a whole stroke at once, for the agent. */
export function sculptPath(mesh: PolyMesh, settings: BrushSettings, path: readonly Vec3[], offset?: Vec3): PolyMesh {
  const stroke = new SculptStroke(mesh, settings);
  if (settings.kind === "grab") {
    stroke.grab(path[0]);
    stroke.drag(offset ?? [0, 0, 0]);
  } else {
    for (const point of path) stroke.paint(point);
  }
  return { ...mesh, vertices: stroke.vertices };
}
