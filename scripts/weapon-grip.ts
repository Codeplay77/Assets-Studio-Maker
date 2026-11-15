// Where a hand holds a weapon that stands as the library keeps it (see scripts/weapon-names.ts),
// shared by the importers of the weapons and of the Realista models.
import { Vector3 } from "three";
import type { WeaponName } from "./weapon-names.ts";

/** A triangle of a model, in meters. */
export interface Triangle {
  p: [Vector3, Vector3, Vector3];
}

type Held = Pick<WeaponName, "hold" | "grip" | "front">;

function bounds(faces: Triangle[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const face of faces) for (const p of face.p) {
    min.min(p);
    max.max(p);
  }
  return { min, max };
}

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/**
 * Where the model's surface is near a plane across one axis: the corners close to it and where its
 * edges cross it (a long face can cross it with no corner near), widening until it finds some.
 */
function slab(faces: Triangle[], axis: "y" | "z", at: number, thickness: number): Vector3[] {
  const crossings: Vector3[] = [];
  for (const { p } of faces) {
    for (let k = 0; k < 3; k++) {
      const a = p[k];
      const b = p[(k + 1) % 3];
      if ((a[axis] - at) * (b[axis] - at) < 0) crossings.push(a.clone().lerp(b, (at - a[axis]) / (b[axis] - a[axis])));
    }
  }
  const corners = faces.flatMap((face) => face.p);
  for (let half = thickness / 2; half < 0.2; half *= 1.6) {
    const found = [...crossings, ...corners.filter((p) => Math.abs(p[axis] - at) <= half)];
    if (found.length >= 3) return found;
  }
  return corners;
}

/** Where the hand holds a model that stands as the library keeps it. */
export function gripOf(faces: Triangle[], name: Held): Vector3 {
  const { min, max } = bounds(faces);
  const size = max.clone().sub(min);
  if (name.hold === "gun") {
    // Across the grip, from its bottom to the top of the gun: the hand is in the lower part.
    const z = min.z + (name.grip ?? 0.3) * size.z;
    const cut = slab(faces, "z", z, 0.012);
    const low = Math.min(...cut.map((p) => p.y));
    const high = Math.max(...cut.map((p) => p.y));
    return new Vector3(median(cut.map((p) => p.x)), low + 0.4 * (high - low), z);
  }
  if (name.hold === "pole") {
    const y = min.y + (name.grip ?? 0.4) * size.y;
    let cut = slab(faces, "y", y, 0.012);
    if (name.front) {
      const most = Math.max(...cut.map((p) => p.z));
      cut = cut.filter((p) => p.z > most - 0.03);
    }
    return new Vector3(median(cut.map((p) => p.x)), y, median(cut.map((p) => p.z)));
  }
  if (name.hold === "blade") {
    // The guard is the widest part of the lower half; the hand is on the handle under it.
    const steps = 40;
    let guard = min.y + size.y * 0.2;
    let widest = -1;
    for (let i = 1; i < steps; i++) {
      const y = min.y + (size.y * 0.45 * i) / steps;
      const cut = slab(faces, "y", y, (size.y * 0.45) / steps);
      const width = Math.max(...cut.map((p) => p.z)) - Math.min(...cut.map((p) => p.z));
      if (width > widest * 1.05) [guard, widest] = [y, width];
    }
    const y = min.y + (guard - min.y) * 0.5;
    const cut = slab(faces, "y", y, 0.01);
    return new Vector3(median(cut.map((p) => p.x)), y, median(cut.map((p) => p.z)));
  }
  return min.clone().add(max).multiplyScalar(0.5);
}
