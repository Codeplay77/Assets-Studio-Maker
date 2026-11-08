import * as THREE from "three";
import type { SocketDef } from "../blocks/catalog";

export interface Placement {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
}

export interface WorldSocket {
  id: string;
  position: THREE.Vector3;
  normal: THREE.Vector3;
}

/** Yaw is counted in quarter turns around the surface normal. */
export function alignToSurface(
  base: SocketDef,
  point: THREE.Vector3,
  normal: THREE.Vector3,
  yawSteps: number,
  scale: THREE.Vector3 = new THREE.Vector3(1, 1, 1),
): Placement {
  const surfaceNormal = normal.clone().normalize();
  const baseNormal = new THREE.Vector3(...base.n).normalize();
  const align = new THREE.Quaternion().setFromUnitVectors(
    baseNormal,
    surfaceNormal.clone().negate(),
  );
  const yaw = new THREE.Quaternion().setFromAxisAngle(surfaceNormal, (yawSteps * Math.PI) / 2);
  const quaternion = yaw.multiply(align);
  const offset = new THREE.Vector3(...base.p).multiply(scale).applyQuaternion(quaternion);
  return { position: point.clone().sub(offset), quaternion };
}

/** Snaps along the surface only, so the block stays exactly on the plane. */
export function snapOnPlane(
  point: THREE.Vector3,
  normal: THREE.Vector3,
  grid: number,
): THREE.Vector3 {
  const unit = normal.clone().normalize();
  const snapped = new THREE.Vector3(
    Math.round(point.x / grid) * grid,
    Math.round(point.y / grid) * grid,
    Math.round(point.z / grid) * grid,
  );
  const drift = snapped.clone().sub(point).dot(unit);
  return snapped.addScaledVector(unit, -drift);
}

export function worldNormal(local: THREE.Vector3, matrix: THREE.Matrix4): THREE.Vector3 {
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  return local.clone().applyMatrix3(normalMatrix).normalize();
}

export function worldSockets(sockets: SocketDef[], matrix: THREE.Matrix4): WorldSocket[] {
  return sockets.map((socket) => ({
    id: socket.id,
    position: new THREE.Vector3(...socket.p).applyMatrix4(matrix),
    normal: worldNormal(new THREE.Vector3(...socket.n), matrix),
  }));
}

export function findNearestSocket(
  sockets: WorldSocket[],
  point: THREE.Vector3,
  maxDistance: number,
): WorldSocket | null {
  let nearest: WorldSocket | null = null;
  let best = maxDistance;
  for (const socket of sockets) {
    const distance = socket.position.distanceTo(point);
    if (distance <= best) {
      best = distance;
      nearest = socket;
    }
  }
  return nearest;
}
