import { describe, expect, it } from "vitest";
import * as THREE from "three";
import type { SocketDef } from "../blocks/catalog";
import { alignToSurface, findNearestSocket, snapOnPlane, worldSockets } from "./placement";

const bottom: SocketDef = { id: "bottom", p: [0, -0.25, 0], n: [0, -1, 0] };
const shoulder: SocketDef = { id: "shoulder", p: [0, 0.3, 0], n: [0, 1, 0] };

function expectVector(actual: THREE.Vector3, expected: [number, number, number]) {
  expect(actual.x).toBeCloseTo(expected[0], 6);
  expect(actual.y).toBeCloseTo(expected[1], 6);
  expect(actual.z).toBeCloseTo(expected[2], 6);
}

describe("alignToSurface", () => {
  it("rests a block on the ground without rotating it", () => {
    const up = new THREE.Vector3(0, 1, 0);
    const { position, quaternion } = alignToSurface(bottom, new THREE.Vector3(1, 0, 2), up, 0);
    expectVector(position, [1, 0.25, 2]);
    expect(quaternion.angleTo(new THREE.Quaternion())).toBeCloseTo(0, 6);
  });

  it("makes the socket meet the surface point, facing against the normal", () => {
    const point = new THREE.Vector3(-0.2375, 1.2, 0);
    const normal = new THREE.Vector3(-1, 0, 0);
    const { position, quaternion } = alignToSurface(shoulder, point, normal, 0);

    const socketWorld = new THREE.Vector3(...shoulder.p).applyQuaternion(quaternion).add(position);
    expectVector(socketWorld, [-0.2375, 1.2, 0]);
    const socketNormal = new THREE.Vector3(...shoulder.n).applyQuaternion(quaternion);
    expectVector(socketNormal, [1, 0, 0]);
    // An arm attached to the left shoulder extends further to the left.
    expect(position.x).toBeLessThan(point.x);
  });

  it("handles a socket that already faces the surface normal", () => {
    const up = new THREE.Vector3(0, 1, 0);
    const { quaternion } = alignToSurface(shoulder, new THREE.Vector3(), up, 0);
    expectVector(new THREE.Vector3(...shoulder.n).applyQuaternion(quaternion), [0, -1, 0]);
  });

  it("turns in quarter steps around the surface normal", () => {
    const up = new THREE.Vector3(0, 1, 0);
    const { quaternion } = alignToSurface(bottom, new THREE.Vector3(), up, 1);
    expectVector(new THREE.Vector3(1, 0, 0).applyQuaternion(quaternion), [0, 0, -1]);
  });
});

describe("snapOnPlane", () => {
  it("snaps along the ground", () => {
    const snapped = snapOnPlane(new THREE.Vector3(0.3, 0, -0.6), new THREE.Vector3(0, 1, 0), 0.25);
    expectVector(snapped, [0.25, 0, -0.5]);
  });

  it("keeps the point on the surface plane", () => {
    const snapped = snapOnPlane(new THREE.Vector3(0.61, 0.5, 0.13), new THREE.Vector3(0, 1, 0), 0.25);
    expect(snapped.y).toBeCloseTo(0.5, 6);
  });

  it("stays on a tilted plane", () => {
    const normal = new THREE.Vector3(0, 1, 1).normalize();
    const point = new THREE.Vector3(0.1, 0.33, 0.17);
    const snapped = snapOnPlane(point, normal, 0.125);
    expect(snapped.clone().sub(point).dot(normal)).toBeCloseTo(0, 6);
  });
});

describe("sockets in world space", () => {
  const sockets: SocketDef[] = [bottom, { id: "top", p: [0, 0.25, 0], n: [0, 1, 0] }];

  it("follows position and rotation", () => {
    const matrix = new THREE.Matrix4().compose(
      new THREE.Vector3(1, 1, 1),
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2),
      new THREE.Vector3(1, 1, 1),
    );
    const [, top] = worldSockets(sockets, matrix);
    expectVector(top.position, [0.75, 1, 1]);
    expectVector(top.normal, [-1, 0, 0]);
  });

  it("finds the closest socket only within range", () => {
    const world = worldSockets(sockets, new THREE.Matrix4());
    expect(findNearestSocket(world, new THREE.Vector3(0, 0.2, 0), 0.2)?.id).toBe("top");
    expect(findNearestSocket(world, new THREE.Vector3(2, 0, 0), 0.2)).toBeNull();
  });
});
