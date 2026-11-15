// What the model importers share: reading OBJ files as plain data, and rebuilding a model out of
// cubes for the Blocos style. Nothing from a file is ever executed.
import { readFileSync } from "node:fs";
import path from "node:path";
import { Vector3 } from "three";
import pngjs from "pngjs";
import type { Rgb } from "./gltf-read.ts";

const { PNG } = pngjs;

export type Finish = "matte" | "metal" | "glass" | "tint" | "gloss";

export interface Face {
  p: [Vector3, Vector3, Vector3];
  n: [Vector3, Vector3, Vector3];
  c: [Rgb, Rgb, Rgb];
  finish: Finish;
}

export interface ObjOptions {
  /** The file's colors are linear, as Blender writes them, not as they look on screen. */
  linear?: boolean;
  /** A small palette image the faces take their color from, at the middle of their texture coordinates. */
  texture?: string;
  /** The finish of a material, by its name. */
  finishOf?: (material: string) => Finish;
}

const toScreen = (value: number) => (value <= 0.0031308 ? value * 12.92 : 1.055 * value ** (1 / 2.4) - 0.055);

function readMtl(file: string, linear = false): Record<string, Rgb> {
  const colors: Record<string, Rgb> = {};
  let current = "";
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === "newmtl") current = rest.join(" ");
    // Kenney writes the colors as they look on screen, so they are kept as sRGB; Blender writes them linear.
    else if (command === "Kd") {
      colors[current] = rest.slice(0, 3).map((value) => Math.round(Math.min(1, linear ? toScreen(Number(value)) : Number(value)) * 255)) as Rgb;
    }
  }
  return colors;
}

export function readObj(file: string, options: ObjOptions = {}): Face[] {
  const positions: Vector3[] = [];
  const normals: Vector3[] = [];
  const uvs: [number, number][] = [];
  let colors: Record<string, Rgb> = {};
  let color: Rgb = [200, 200, 200];
  let finish: Finish = "matte";
  const palette = options.texture ? PNG.sync.read(readFileSync(options.texture)) : null;
  const sample = (u: number, v: number): Rgb => {
    const x = Math.min(palette!.width - 1, Math.max(0, Math.floor((u - Math.floor(u)) * palette!.width)));
    const y = Math.min(palette!.height - 1, Math.max(0, Math.floor((1 - (v - Math.floor(v))) * palette!.height)));
    const at = (y * palette!.width + x) * 4;
    return [palette!.data[at], palette!.data[at + 1], palette!.data[at + 2]];
  };
  const faces: Face[] = [];
  for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
    const [command, ...rest] = line.trim().split(/\s+/);
    if (command === "v") positions.push(new Vector3(Number(rest[0]), Number(rest[1]), Number(rest[2])));
    else if (command === "vn") normals.push(new Vector3(Number(rest[0]), Number(rest[1]), Number(rest[2])).normalize());
    else if (command === "vt") uvs.push([Number(rest[0]), Number(rest[1])]);
    else if (command === "mtllib") colors = readMtl(path.join(path.dirname(file), rest.join(" ")), options.linear);
    else if (command === "usemtl") {
      color = colors[rest.join(" ")] ?? color;
      finish = options.finishOf?.(rest.join(" ")) ?? "matte";
    }
    else if (command === "f") {
      const refs = rest.map((ref) => ref.split("/").map((value) => (value ? Number(value) : 0)));
      const at = (index: number) => (index < 0 ? positions.length + index : index - 1);
      for (let i = 1; i + 1 < refs.length; i++) {
        const corners = [refs[0], refs[i], refs[i + 1]];
        const p = corners.map(([v]) => positions[at(v)].clone()) as Face["p"];
        const flat = p[1].clone().sub(p[0]).cross(p[2].clone().sub(p[0])).normalize();
        const n = corners.map((ref) => (ref[2] ? normals[ref[2] < 0 ? normals.length + ref[2] : ref[2] - 1].clone() : flat.clone())) as Face["n"];
        let c = color;
        if (palette && corners.every((ref) => ref[1])) {
          const middle = corners.map((ref) => uvs[ref[1] < 0 ? uvs.length + ref[1] : ref[1] - 1]);
          c = sample((middle[0][0] + middle[1][0] + middle[2][0]) / 3, (middle[0][1] + middle[1][1] + middle[2][1]) / 3);
        }
        faces.push({ p, n, c: [c, c, c], finish });
      }
    }
  }
  return faces;
}

export function bounds(faces: Face[]): { min: Vector3; max: Vector3 } {
  const min = new Vector3(Infinity, Infinity, Infinity);
  const max = new Vector3(-Infinity, -Infinity, -Infinity);
  for (const face of faces) for (const p of face.p) {
    min.min(p);
    max.max(p);
  }
  return { min, max };
}

/** Rebuilds a model out of cubes of one size, each with the color most of its surface has. */
export function voxelize(faces: Face[], cell: number): Face[] {
  const { min, max } = bounds(faces);
  const origin = new Vector3(min.x, 0, min.z);
  const size = [0, 1, 2].map((axis) => Math.max(1, Math.ceil((max.getComponent(axis) - origin.getComponent(axis)) / cell - 1e-6)));
  const key = (x: number, y: number, z: number) => (x * size[1] + y) * size[2] + z;
  const votes = new Map<number, Map<number, number>>();

  for (const face of faces) {
    const [a, b, c] = face.p;
    const longest = Math.max(a.distanceTo(b), b.distanceTo(c), c.distanceTo(a));
    const steps = Math.max(1, Math.ceil(longest / (cell * 0.3)));
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps - i; j++) {
        const u = i / steps;
        const v = j / steps;
        const w = 1 - u - v;
        const p = a.clone().multiplyScalar(w).addScaledVector(b, u).addScaledVector(c, v);
        const cellOf = (axis: number) =>
          Math.min(size[axis] - 1, Math.max(0, Math.floor((p.getComponent(axis) - origin.getComponent(axis)) / cell)));
        const k = key(cellOf(0), cellOf(1), cellOf(2));
        const corner = w >= u && w >= v ? 0 : u >= v ? 1 : 2;
        const [r, g, bl] = face.c[corner];
        const color = (r << 16) | (g << 8) | bl;
        let tally = votes.get(k);
        if (!tally) votes.set(k, (tally = new Map()));
        tally.set(color, (tally.get(color) ?? 0) + 1);
      }
    }
  }

  const filled = new Map<number, number>();
  for (const [k, tally] of votes) {
    let best = 0;
    let bestCount = -1;
    for (const [color, count] of tally) if (count > bestCount) [best, bestCount] = [color, count];
    filled.set(k, best);
  }
  const colorAt = (x: number, y: number, z: number) =>
    x < 0 || y < 0 || z < 0 || x >= size[0] || y >= size[1] || z >= size[2] ? undefined : filled.get(key(x, y, z));

  // Greedy meshing: each run of exposed cube faces of one color in a plane becomes one quad.
  const out: Face[] = [];
  for (let axis = 0; axis < 3; axis++) {
    const [u, v] = [(axis + 1) % 3, (axis + 2) % 3];
    for (const sign of [1, -1]) {
      for (let slice = 0; slice < size[axis]; slice++) {
        const mask: (number | undefined)[] = new Array(size[u] * size[v]);
        for (let i = 0; i < size[u]; i++) {
          for (let j = 0; j < size[v]; j++) {
            const at = [0, 0, 0];
            at[axis] = slice;
            at[u] = i;
            at[v] = j;
            const here = colorAt(at[0], at[1], at[2]);
            if (here === undefined) continue;
            at[axis] += sign;
            if (colorAt(at[0], at[1], at[2]) !== undefined) continue;
            mask[i * size[v] + j] = here;
          }
        }
        for (let i = 0; i < size[u]; i++) {
          for (let j = 0; j < size[v]; ) {
            const color = mask[i * size[v] + j];
            if (color === undefined) {
              j++;
              continue;
            }
            let height = 1;
            while (j + height < size[v] && mask[i * size[v] + j + height] === color) height++;
            let width = 1;
            grow: while (i + width < size[u]) {
              for (let k = 0; k < height; k++) if (mask[(i + width) * size[v] + j + k] !== color) break grow;
              width++;
            }
            for (let a = 0; a < width; a++) for (let k = 0; k < height; k++) mask[(i + a) * size[v] + j + k] = undefined;

            const plane = (slice + (sign > 0 ? 1 : 0)) * cell + origin.getComponent(axis);
            const point = (du: number, dv: number) => {
              const p = new Vector3();
              p.setComponent(axis, plane);
              p.setComponent(u, origin.getComponent(u) + du * cell);
              p.setComponent(v, origin.getComponent(v) + dv * cell);
              return p;
            };
            const p00 = point(i, j);
            const p10 = point(i + width, j);
            const p11 = point(i + width, j + height);
            const p01 = point(i, j + height);
            const normal = new Vector3();
            normal.setComponent(axis, sign);
            const rgb: Rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255];
            const tri = (a: Vector3, b: Vector3, c: Vector3): Face => ({
              p: [a.clone(), b.clone(), c.clone()],
              n: [normal.clone(), normal.clone(), normal.clone()],
              c: [rgb, rgb, rgb],
              finish: "matte",
            });
            // (u, v, axis) is right-handed, so u x v points along +axis.
            if (sign > 0) out.push(tri(p00, p10, p11), tri(p00, p11, p01));
            else out.push(tri(p00, p11, p10), tri(p00, p01, p11));
            j += height;
          }
        }
      }
    }
  }
  return out;
}
