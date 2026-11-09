import * as THREE from "three";
import { describe, expect, it } from "vitest";
import * as build from "../modeling/builders";
import { MeshOverlay, type ScreenRect } from "./MeshOverlay";

const WIDTH = 800;
const HEIGHT = 600;
const EVERYTHING: ScreenRect = { left: 0, top: 0, right: WIDTH, bottom: HEIGHT };

function setup(mode: "face" | "edge" | "vertex", mesh = build.box([1, 1, 1])) {
  const camera = new THREE.PerspectiveCamera(40, WIDTH / HEIGHT, 0.05, 2000);
  camera.position.set(0, 0, 5);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  const overlay = new MeshOverlay();
  overlay.update(mesh, new THREE.Matrix4(), { mode, faces: [], vertices: [] });
  return { overlay, camera, mesh };
}

describe("selecting with a rectangle", () => {
  it("takes only the face that can be seen", () => {
    const { overlay, camera, mesh } = setup("face");
    const hit = overlay.boxSelect(EVERYTHING, WIDTH, HEIGHT, camera, "face");
    expect("faces" in hit && hit.faces.map((id) => mesh.faces[id])).toHaveLength(1);
  });

  it("does not take the points behind the shape", () => {
    const { overlay, camera, mesh } = setup("vertex");
    const hit = overlay.boxSelect(EVERYTHING, WIDTH, HEIGHT, camera, "vertex");
    expect("vertices" in hit && hit.vertices.every((id) => mesh.vertices[id][2] > 0)).toBe(true);
    expect("vertices" in hit && hit.vertices).toHaveLength(4);
  });

  it("takes only what is inside the rectangle", () => {
    const { overlay, camera, mesh } = setup("vertex");
    const rightHalf: ScreenRect = { left: WIDTH / 2, top: 0, right: WIDTH, bottom: HEIGHT };
    const hit = overlay.boxSelect(rightHalf, WIDTH, HEIGHT, camera, "vertex");
    expect("vertices" in hit && hit.vertices).toHaveLength(2);
    expect("vertices" in hit && hit.vertices.every((id) => mesh.vertices[id][0] > 0)).toBe(true);
  });

  it("needs both ends of an edge inside", () => {
    const { overlay, camera } = setup("edge");
    const hit = overlay.boxSelect({ left: WIDTH / 2, top: 0, right: WIDTH, bottom: HEIGHT / 2 }, WIDTH, HEIGHT, camera, "edge");
    expect("vertices" in hit && hit.vertices).toHaveLength(0);
  });

  it("finds nothing in an empty corner", () => {
    const { overlay, camera } = setup("face");
    expect(overlay.boxSelect({ left: 0, top: 0, right: 20, bottom: 20 }, WIDTH, HEIGHT, camera, "face")).toEqual({ faces: [] });
  });

  it("is quick on a detailed shape", () => {
    const { overlay, camera } = setup("vertex", build.plane(2, 2, 130, 130));
    const started = performance.now();
    overlay.boxSelect(EVERYTHING, WIDTH, HEIGHT, camera, "vertex");
    expect(performance.now() - started).toBeLessThan(500);
  });
});

describe("reading the surface for the brush", () => {
  it("finds the point and its direction", () => {
    const { overlay, camera } = setup("face");
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(0, 0), camera);
    const hit = overlay.pickSurfacePoint(raycaster);
    expect(hit?.point.z).toBeCloseTo(0.5, 5);
    expect(hit?.normal.z).toBeCloseTo(1, 5);
  });
});
