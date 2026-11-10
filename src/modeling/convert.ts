import * as THREE from "three";
import { getBlock } from "../blocks/catalog";
import { BLOCK_FINISHES, buildGeometry } from "../blocks/geometry";
import type { BlockFinish } from "../blocks/types";
import type { Finish, Part, ShapeMaterial, Vec3 } from "../core/types";
import { booleanMeshes, type BooleanMode } from "./boolean";
import {
  DEFAULT_SMOOTH_ANGLE,
  MAX_FACES,
  MAX_VERTICES,
  compact,
  cross,
  dot,
  emptyMesh,
  faceNormal,
  length,
  sub,
  type PolyMesh,
} from "./mesh";

/** A shape keeps the closest finish a person can pick for it. */
const EDITABLE: Record<BlockFinish, Finish> = { matte: "matte", gloss: "gloss", metal: "metal", glass: "glass", glow: "glow", paint: "gloss", tint: "glass" };
const FINISHES: Finish[] = BLOCK_FINISHES.map((finish) => EDITABLE[finish]);
const WELD_STEP = 1e-4;
const MAX_MATERIALS = 256;
const COPLANAR = 0.9999;

function partMatrix(part: Part): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...part.position),
    new THREE.Quaternion(...part.rotation),
    new THREE.Vector3(...part.scale),
  );
}

/** Whether a merged quad would still be a convex polygon. */
function isConvex(vertices: Vec3[], quad: number[], normal: Vec3): boolean {
  return quad.every((vertex, i) => {
    const next = quad[(i + 1) % quad.length];
    const after = quad[(i + 2) % quad.length];
    return dot(cross(sub(vertices[next], vertices[vertex]), sub(vertices[after], vertices[next])), normal) > 1e-10;
  });
}

/** Turns pairs of flat triangles back into quads, so the sides of a box are one face each. */
export function mergeCoplanarTriangles(mesh: PolyMesh): PolyMesh {
  const owners = new Map<string, number[]>();
  mesh.faces.forEach((face, index) => {
    if (face.length !== 3) return;
    face.forEach((a, i) => {
      const b = face[(i + 1) % 3];
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      owners.set(key, [...(owners.get(key) ?? []), index]);
    });
  });

  const distance = (key: string) => {
    const [a, b] = key.split("_").map(Number);
    return length(sub(mesh.vertices[a], mesh.vertices[b]));
  };
  // The longest shared edge of a rectangle's two triangles is its diagonal.
  const edges = [...owners.entries()].filter(([, faces]) => faces.length === 2).sort((x, y) => distance(y[0]) - distance(x[0]));

  const merged = new Set<number>();
  const quads = new Map<number, number[]>();
  for (const [key, [first, second]] of edges) {
    if (merged.has(first) || merged.has(second) || mesh.faceMaterials[first] !== mesh.faceMaterials[second]) continue;
    const normal = faceNormal(mesh, mesh.faces[first]);
    if (dot(normal, faceNormal(mesh, mesh.faces[second])) < COPLANAR) continue;

    const [a, b] = key.split("_").map(Number);
    const face = mesh.faces[first];
    const start = face.findIndex((vertex) => vertex !== a && vertex !== b);
    const opposite = mesh.faces[second].find((vertex) => vertex !== a && vertex !== b)!;
    const quad = [face[start], face[(start + 1) % 3], opposite, face[(start + 2) % 3]];
    if (!isConvex(mesh.vertices, quad, normal)) continue;
    merged.add(first);
    merged.add(second);
    quads.set(first, quad);
  }

  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  mesh.faces.forEach((face, index) => {
    if (merged.has(index) && !quads.has(index)) return;
    faces.push(quads.get(index) ?? face);
    faceMaterials.push(mesh.faceMaterials[index]);
  });
  return { ...mesh, faces, faceMaterials };
}

function collect(parts: Part[], bake: THREE.Matrix4 | null): PolyMesh {
  const mesh = emptyMesh();
  const indices = new Map<string, number>();
  const materialIds = new Map<string, number>([["{}", 0]]);
  const point = new THREE.Vector3();
  const color = new THREE.Color();
  const tint = new THREE.Color();

  const vertexAt = (value: THREE.Vector3) => {
    const key = `${Math.round(value.x / WELD_STEP)}_${Math.round(value.y / WELD_STEP)}_${Math.round(value.z / WELD_STEP)}`;
    let index = indices.get(key);
    if (index === undefined) {
      if (mesh.vertices.length >= MAX_VERTICES) {
        throw new Error(`este modelo é detalhado demais para editar: passa de ${MAX_VERTICES} vértices`);
      }
      index = mesh.vertices.length;
      mesh.vertices.push(value.toArray() as Vec3);
      indices.set(key, index);
    }
    return index;
  };

  const materialFor = (material: ShapeMaterial) => {
    const key = JSON.stringify(material);
    let index = materialIds.get(key);
    if (index === undefined) {
      if (mesh.materials.length >= MAX_MATERIALS) throw new Error("este modelo tem cores demais para editar");
      index = mesh.materials.length;
      mesh.materials.push(material);
      materialIds.set(key, index);
    }
    return index;
  };

  for (const part of parts) {
    const geometry = buildGeometry(getBlock(part.block).shape);
    const positions = geometry.getAttribute("position");
    const colors = geometry.getAttribute("color");
    const matrix = bake ? bake.clone().multiply(partMatrix(part)) : new THREE.Matrix4();
    tint.set(part.color);

    for (const { start, count, materialIndex = 0 } of geometry.groups) {
      const finish = FINISHES[Math.floor(materialIndex / 2)];
      const follows = materialIndex % 2 === 0;
      for (let at = start; at < start + count; at += 3) {
        const corners = [0, 1, 2].map((offset) =>
          vertexAt(point.fromBufferAttribute(positions, at + offset).applyMatrix4(matrix)),
        );
        if (new Set(corners).size < 3) continue;
        if (mesh.faces.length >= MAX_FACES) {
          throw new Error(`este modelo é detalhado demais para editar: passa de ${MAX_FACES} faces`);
        }

        color.fromBufferAttribute(colors, at);
        const material: ShapeMaterial = {};
        if (follows && bake) {
          // Baked into a new shape, each original part keeps the color it had.
          material.color = `#${color.clone().multiply(tint).getHexString()}`;
        } else if (follows) {
          if (color.r < 0.999) material.shade = Math.round(color.r * 1000) / 1000;
        } else {
          material.color = `#${color.getHexString()}`;
        }
        if (finish !== "matte") material.finish = finish;

        mesh.faces.push(corners);
        mesh.faceMaterials.push(materialFor(material));
      }
    }
    geometry.dispose();
  }
  return mesh;
}

export interface ConvertedParts {
  mesh: PolyMesh;
  position: Vec3;
  rotation: Part["rotation"];
  scale: Vec3;
  color: string;
}

/**
 * Turns ready-made parts into one editable mesh. A single part keeps its place and scale, and
 * still follows its color; several become one shape centered on their base.
 */
export function convertParts(parts: Part[]): ConvertedParts {
  if (parts.length === 0) throw new Error("nenhuma peça para transformar em forma");

  const finish = (mesh: PolyMesh) => ({ ...compact(mergeCoplanarTriangles(mesh)), smoothAngle: DEFAULT_SMOOTH_ANGLE });
  if (parts.length === 1) {
    const [part] = parts;
    return {
      mesh: finish(collect(parts, null)),
      position: part.position,
      rotation: part.rotation,
      scale: part.scale,
      color: part.color,
    };
  }

  return centeredOnBase(finish(collect(parts, new THREE.Matrix4())), parts[0].color);
}

function centeredOnBase(world: PolyMesh, color: string): ConvertedParts {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const vertex of world.vertices) {
    for (let axis = 0; axis < 3; axis++) {
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  const origin: Vec3 = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  return {
    mesh: { ...world, vertices: world.vertices.map((vertex) => sub(vertex, origin)) },
    position: origin,
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    color,
  };
}

/** Cuts the first part with the others, or joins them, and returns the result as one shape. */
export function combineParts(parts: Part[], mode: BooleanMode): ConvertedParts {
  if (parts.length < 2) throw new Error("selecione pelo menos duas peças");
  const meshes = parts.map((part) => compact(mergeCoplanarTriangles(collect([part], new THREE.Matrix4()))));
  const combined = meshes.slice(1).reduce((current, tool) => booleanMeshes(current, tool, mode), meshes[0]);
  return centeredOnBase({ ...combined, smoothAngle: DEFAULT_SMOOTH_ANGLE }, parts[0].color);
}
