import * as THREE from "three";
import type { Vec3 } from "../core/types";

function newellNormal(vertices: readonly Vec3[], face: readonly number[]): THREE.Vector3 {
  const normal = new THREE.Vector3();
  for (let i = 0; i < face.length; i++) {
    const a = vertices[face[i]];
    const b = vertices[face[(i + 1) % face.length]];
    normal.x += (a[1] - b[1]) * (a[2] + b[2]);
    normal.y += (a[2] - b[2]) * (a[0] + b[0]);
    normal.z += (a[0] - b[0]) * (a[1] + b[1]);
  }
  return normal;
}

function fan(face: readonly number[]): number[][] {
  const triangles: number[][] = [];
  for (let i = 1; i < face.length - 1; i++) triangles.push([face[0], face[i], face[i + 1]]);
  return triangles;
}

/** Splits a polygon, even a concave one, into triangles that keep its winding. */
export function triangulateFace(vertices: readonly Vec3[], face: readonly number[]): number[][] {
  if (face.length === 3) return [[face[0], face[1], face[2]]];
  const normal = newellNormal(vertices, face);
  if (normal.lengthSq() < 1e-20) return fan(face);
  normal.normalize();

  const u = new THREE.Vector3()
    .crossVectors(normal, Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0))
    .normalize();
  const v = new THREE.Vector3().crossVectors(normal, u);
  const contour = face.map((index) => {
    const point = new THREE.Vector3(...vertices[index]);
    return new THREE.Vector2(point.dot(u), point.dot(v));
  });

  const triangles = THREE.ShapeUtils.triangulateShape(contour, []);
  if (triangles.length !== face.length - 2) return fan(face);
  return triangles.map(([a, b, c]) => {
    const area =
      (contour[b].x - contour[a].x) * (contour[c].y - contour[a].y) -
      (contour[b].y - contour[a].y) * (contour[c].x - contour[a].x);
    return area > 0 ? [face[a], face[b], face[c]] : [face[a], face[c], face[b]];
  });
}
