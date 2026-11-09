import * as THREE from "three";
import type { Vec3 } from "../core/types";
import { compact, emptyMesh, orientOutward, type PolyMesh } from "./mesh";

type Point = [number, number];

/** Position along the axis, half width, half depth, squareness (2 = ellipse), sideways offset. */
export type LoftRing = [number, number, number, number?, number?];

const TAU = Math.PI * 2;
const POLE_RADIUS = 1e-5;
const WELD_STEP = 1e-5;

interface RingOptions {
  /** Connects the last ring back to the first, as in a donut. */
  loop?: boolean;
  capStart?: boolean;
  capEnd?: boolean;
}

/**
 * Stitches rings of points into quads. A ring of a single point closes the surface in a tip.
 * Rings go along the shape; inside each one, points turn from +X toward +Z.
 */
function fromRings(rings: Vec3[][], { loop = false, capStart = true, capEnd = true }: RingOptions = {}): PolyMesh {
  const mesh = emptyMesh();
  const starts = rings.map((ring) => {
    const start = mesh.vertices.length;
    mesh.vertices.push(...ring);
    return start;
  });
  const face = (corners: number[]) => {
    mesh.faces.push(corners);
    mesh.faceMaterials.push(0);
  };

  const spans = loop ? rings.length : rings.length - 1;
  for (let r = 0; r < spans; r++) {
    const next = (r + 1) % rings.length;
    const lower = rings[r].length;
    const upper = rings[next].length;
    const count = Math.max(lower, upper);
    for (let j = 0; j < count; j++) {
      const j2 = (j + 1) % count;
      if (lower === 1) face([starts[r], starts[next] + j, starts[next] + j2]);
      else if (upper === 1) face([starts[r] + j, starts[next], starts[r] + j2]);
      else face([starts[r] + j, starts[next] + j, starts[next] + j2, starts[r] + j2]);
    }
  }

  const corners = (ring: number) => Array.from({ length: rings[ring].length }, (_, j) => starts[ring] + j);
  const last = rings.length - 1;
  if (!loop && capStart && rings[0].length > 2) face(corners(0));
  if (!loop && capEnd && rings[last].length > 2) face(corners(last).reverse());
  return mesh;
}

function circle(radius: number, y: number, segments: number): Vec3[] {
  if (radius < POLE_RADIUS) return [[0, y, 0]];
  return Array.from({ length: segments }, (_, j) => {
    const angle = (j / segments) * TAU;
    return [radius * Math.cos(angle), y, radius * Math.sin(angle)] as Vec3;
  });
}

export function box([width, height, depth]: Vec3): PolyMesh {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const ring = (level: number): Vec3[] => [
    [x, level, -z],
    [x, level, z],
    [-x, level, z],
    [-x, level, -z],
  ];
  return orientOutward(fromRings([ring(-y), ring(y)]));
}

export function plane(width: number, depth: number, columns: number, rows: number): PolyMesh {
  const mesh = emptyMesh();
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      mesh.vertices.push([(column / columns - 0.5) * width, 0, (row / rows - 0.5) * depth]);
    }
  }
  const at = (row: number, column: number) => row * (columns + 1) + column;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      mesh.faces.push([at(row, column), at(row + 1, column), at(row + 1, column + 1), at(row, column + 1)]);
      mesh.faceMaterials.push(0);
    }
  }
  return mesh;
}

/** The tall side is at the back (-Z) and the slope faces forward (+Z). */
export function wedge([width, height, depth]: Vec3): PolyMesh {
  const x = width / 2;
  const y = height / 2;
  const z = depth / 2;
  const mesh = emptyMesh();
  mesh.vertices = [
    [-x, -y, -z],
    [x, -y, -z],
    [x, -y, z],
    [-x, -y, z],
    [-x, y, -z],
    [x, y, -z],
  ];
  mesh.faces = [
    [0, 1, 2, 3],
    [1, 0, 4, 5],
    [3, 2, 5, 4],
    [2, 1, 5],
    [0, 3, 4],
  ];
  mesh.faceMaterials = mesh.faces.map(() => 0);
  return orientOutward(mesh);
}

export function frustum(bottom: Point, top: Point, height: number): PolyMesh {
  const y = height / 2;
  const ring = ([width, depth]: Point, level: number): Vec3[] => [
    [width / 2, level, -depth / 2],
    [width / 2, level, depth / 2],
    [-width / 2, level, depth / 2],
    [-width / 2, level, -depth / 2],
  ];
  return orientOutward(fromRings([ring(bottom, -y), ring(top, y)]));
}

export function cylinder(radiusTop: number, radiusBottom: number, height: number, segments: number): PolyMesh {
  const y = height / 2;
  return orientOutward(fromRings([circle(radiusBottom, -y, segments), circle(radiusTop, y, segments)]));
}

export function sphere(radius: number, segments: number, rows: number): PolyMesh {
  const rings = Array.from({ length: rows + 1 }, (_, row) => {
    const angle = (row / rows) * Math.PI;
    return row === 0 || row === rows
      ? ([[0, row === 0 ? -radius : radius, 0]] as Vec3[])
      : circle(radius * Math.sin(angle), -radius * Math.cos(angle), segments);
  });
  return orientOutward(fromRings(rings));
}

/** A half sphere whose flat side sits on the origin. */
export function dome(radius: number, segments: number, rows: number): PolyMesh {
  const rings = Array.from({ length: rows + 1 }, (_, row) => {
    const angle = (row / rows) * (Math.PI / 2);
    return row === rows ? ([[0, radius, 0]] as Vec3[]) : circle(radius * Math.cos(angle), radius * Math.sin(angle), segments);
  });
  return orientOutward(fromRings(rings));
}

export function capsule(radius: number, length: number, segments: number, rows: number): PolyMesh {
  const rings: Vec3[][] = [[[0, -length / 2 - radius, 0]]];
  for (let row = 1; row <= rows; row++) {
    const angle = (row / rows) * (Math.PI / 2);
    rings.push(circle(radius * Math.sin(angle), -length / 2 - radius * Math.cos(angle), segments));
  }
  for (let row = rows; row >= 1; row--) {
    const angle = (row / rows) * (Math.PI / 2);
    rings.push(circle(radius * Math.sin(angle), length / 2 + radius * Math.cos(angle), segments));
  }
  rings.push([[0, length / 2 + radius, 0]]);
  return orientOutward(fromRings(rings));
}

/** A ring lying flat, with its hole along Y. */
export function torus(radius: number, tube: number, segments: number, tubeSegments: number): PolyMesh {
  const rings = Array.from({ length: segments }, (_, i) => {
    const angle = (i / segments) * TAU;
    return Array.from({ length: tubeSegments }, (_, j) => {
      const around = (j / tubeSegments) * TAU;
      const reach = radius + tube * Math.cos(around);
      return [reach * Math.cos(angle), tube * Math.sin(around), reach * Math.sin(angle)] as Vec3;
    });
  });
  return orientOutward(fromRings(rings, { loop: true }));
}

/** Revolves [radius, y] points around Y, like a vase on a potter's wheel. */
export function lathe(profile: Point[], segments: number): PolyMesh {
  return orientOutward(fromRings(profile.map(([radius, y]) => circle(radius, y, segments))));
}

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return (
    0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
  );
}

const signedPower = (value: number, power: number) => Math.sign(value) * Math.abs(value) ** power;

/** A smooth surface through cross-sections placed along Y or Z. */
export function loft(rings: LoftRing[], axis: "y" | "z", segments: number, steps: number): PolyMesh {
  const full = rings.map(([at, width, depth, square = 2, offset = 0]) => [at, width, depth, square, offset]);
  const dense: number[][] = [];
  for (let i = 0; i < full.length - 1; i++) {
    const before = full[Math.max(i - 1, 0)];
    const after = full[Math.min(i + 2, full.length - 1)];
    for (let step = 0; step < steps; step++) {
      const t = step / steps;
      dense.push(full[i].map((_, channel) => catmullRom(before[channel], full[i][channel], full[i + 1][channel], after[channel], t)));
    }
  }
  dense.push(full[full.length - 1]);

  const built = dense.map(([at, width, depth, square, offset]) => {
    if (Math.max(width, depth) < POLE_RADIUS) return [[0, at, offset]] as Vec3[];
    const power = 2 / Math.max(square, 1);
    return Array.from({ length: segments }, (_, j) => {
      const angle = (j / segments) * TAU;
      return [
        Math.max(width, POLE_RADIUS) * signedPower(Math.cos(angle), power),
        at,
        Math.max(depth, POLE_RADIUS) * signedPower(Math.sin(angle), power) + offset,
      ] as Vec3;
    });
  });
  const mesh = fromRings(built);
  if (axis === "z") mesh.vertices = mesh.vertices.map(([x, y, z]) => [x, -z, y] as Vec3);
  return orientOutward(mesh);
}

/** A curved tube along a path, whose radius can change. `flat` below 1 squashes it into a ribbon. */
export function tube(path: Vec3[], radii: number[], radial: number, steps: number, flat: number): PolyMesh {
  const curve = new THREE.CatmullRomCurve3(path.map((point) => new THREE.Vector3(...point)));
  const divisions = (path.length - 1) * steps;
  const points = curve.getSpacedPoints(divisions);
  const { normals, binormals } = curve.computeFrenetFrames(divisions, false);
  const radiusAt = (u: number) => {
    if (radii.length === 1) return radii[0];
    const position = u * (radii.length - 1);
    const index = Math.min(Math.floor(position), radii.length - 2);
    return radii[index] + (radii[index + 1] - radii[index]) * (position - index);
  };

  const rings = points.map((point, i) => {
    const radius = radiusAt(i / divisions);
    if (radius < POLE_RADIUS) return [point.toArray() as Vec3];
    return Array.from({ length: radial }, (_, j) => {
      const angle = (j / radial) * TAU;
      return point
        .clone()
        .addScaledVector(normals[i], Math.cos(angle) * radius)
        .addScaledVector(binormals[i], Math.sin(angle) * radius * flat)
        .toArray() as Vec3;
    });
  });
  return orientOutward(fromRings(rings));
}

/** Gives thickness to an [x, y] outline. The result is centered on Z. */
export function extrudeOutline(outline: Point[], depth: number): PolyMesh {
  const ring = (z: number) => outline.map(([x, y]): Vec3 => [x, y, z]);
  return orientOutward(fromRings([ring(-depth / 2), ring(depth / 2)]));
}

function wrapAround(size: number, radius: number, segments: number): number[] {
  const inner = size / 2 - radius;
  const span = radius / segments;
  const low = Array.from({ length: segments + 1 }, (_, i) => -(inner + radius) + i * span);
  return [...low, ...low.map((value) => -value).reverse()];
}

/** A box with rounded corners and edges, sharing its points so it can be edited as one surface. */
export function roundedBox(size: Vec3, radius: number, segments: number): PolyMesh {
  const safeRadius = Math.max(Math.min(radius, ...size.map((value) => value / 2 - 1e-4)), 1e-4);
  const coordinates = size.map((value) => wrapAround(value, safeRadius, segments));
  const inner = size.map((value) => value / 2 - safeRadius);
  const mesh = emptyMesh();
  const indices = new Map<string, number>();

  const vertexAt = (point: Vec3) => {
    const clamped = point.map((value, axis) => Math.min(inner[axis], Math.max(-inner[axis], value))) as Vec3;
    const offset = point.map((value, axis) => value - clamped[axis]) as Vec3;
    const reach = Math.hypot(...offset) || 1;
    const rounded = clamped.map((value, axis) => value + (offset[axis] / reach) * safeRadius) as Vec3;
    const key = rounded.map((value) => Math.round(value / WELD_STEP)).join("_");
    let index = indices.get(key);
    if (index === undefined) {
      index = mesh.vertices.length;
      mesh.vertices.push(rounded);
      indices.set(key, index);
    }
    return index;
  };

  for (let axis = 0; axis < 3; axis++) {
    for (const sign of [-1, 1]) {
      const u = (axis + 1) % 3;
      const v = (axis + 2) % 3;
      const lineU = coordinates[u];
      const lineV = coordinates[v];
      for (let i = 0; i < lineU.length - 1; i++) {
        for (let j = 0; j < lineV.length - 1; j++) {
          const corner = (a: number, b: number) => {
            const point: Vec3 = [0, 0, 0];
            point[axis] = (sign * size[axis]) / 2;
            point[u] = lineU[a];
            point[v] = lineV[b];
            return vertexAt(point);
          };
          const quad = [corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j + 1)];
          const distinct = quad.filter((vertex, index) => vertex !== quad[(index + 1) % 4]);
          if (distinct.length < 3 || new Set(distinct).size !== distinct.length) continue;
          mesh.faces.push(sign > 0 ? distinct : distinct.reverse());
          mesh.faceMaterials.push(0);
        }
      }
    }
  }
  return orientOutward(compact(mesh));
}
