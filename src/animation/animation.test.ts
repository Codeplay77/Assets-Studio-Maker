import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { readFileSync } from "node:fs";
import { partBounds, partMatrix } from "../blocks/bounds";
import { getBlock } from "../blocks/catalog";
import { buildGeometry } from "../blocks/geometry";
import type { ArtStyle } from "../blocks/styles";
import type { Part, PartId } from "../core/types";
import { runGenerator } from "../generators";
import { buildExportScene } from "../export/glb";
import { ClipSampler, clipFileName, CLIPS, getClip, setAnimationPack } from "./clips";
import { findRigs, poseRig, type PartPose } from "./rig";

const pack = readFileSync(new URL("../../public/animations/human.bin", import.meta.url));
setAnimationPack(pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength) as ArrayBuffer);

const STYLES: ArtStyle[] = ["realistic", "lowpoly", "arcade", "blocks"];

function person(style: ArtStyle, options: Record<string, string> = {}, first = 1, group?: number): Part[] {
  return runGenerator("person", 11, { style, options: { age: "adult", sex: "male", ...options } }).map((part, i) => ({
    ...part,
    id: first + i,
    color: part.color ?? getBlock(part.block).color,
    group,
  }));
}

const clip = (id: string) => new ClipSampler(getClip(id)!);

function posed(parts: Part[], pose: Map<PartId, PartPose>): Part[] {
  return parts.map((part) => {
    const at = pose.get(part.id);
    return at ? { ...part, position: at.position, rotation: at.rotation } : part;
  });
}

const byBlock = (parts: Part[], pattern: RegExp) => parts.filter((part) => pattern.test(part.block));

describe("the animation pack", () => {
  it("has every human clip of Mesh2Motion, named in Portuguese", () => {
    expect(CLIPS).toHaveLength(162);
    expect(getClip("Walk")?.label).toBe("Andar");
    expect(getClip("Walk")?.loop).toBe(true);
    expect(getClip("Death_A")?.loop).toBe(false);
    expect(getClip("Roll_RM")?.moves).toBe(true);
    expect(pack.byteLength).toBe(Math.max(...CLIPS.map((c) => c.offset + c.frames * (22 * 8 + 12))));
  });
});

describe("exporting an animated character", () => {
  const options = { merge: false, center: true, name: "Pessoa", godot: true };

  it("gives each clip a plain name game code can use", () => {
    const names = CLIPS.map(clipFileName);
    expect(new Set(names).size).toBe(CLIPS.length);
    expect(clipFileName(getClip("Pistol_Shoot")!)).toBe("pistola_atirar");
    expect(names.every((name) => /^[a-z0-9_]+$/.test(name))).toBe(true);
  });

  it("exports one skinned mesh, the skeleton with Unreal names and the chosen clips", () => {
    const parts = person("realistic", { hat: "yes" });
    const [rig] = findRigs(parts);
    const scene = buildExportScene(parts, { ...options, animations: { [rig.root]: ["Walk", "Death_A"] } });
    const meshes: THREE.SkinnedMesh[] = [];
    scene.traverse((object) => object instanceof THREE.SkinnedMesh && meshes.push(object));
    expect(meshes).toHaveLength(1);
    expect(meshes[0].skeleton.bones.map((bone) => bone.name)).toContain("upperarm_l");
    expect(scene.animations.map((clip) => clip.name)).toEqual(["andar-loop", "morrer_1"]);
    // Every vertex follows exactly one bone.
    const weights = meshes[0].geometry.getAttribute("skinWeight");
    for (let i = 0; i < weights.count; i += 97) expect(weights.getX(i)).toBe(1);
  });

  it("plays in a game the way the editor previews it", () => {
    const parts = person("arcade");
    const [rig] = findRigs(parts);
    const scene = buildExportScene(parts, { ...options, center: false, animations: { [rig.root]: ["Walk"] } });
    let mesh!: THREE.SkinnedMesh;
    scene.traverse((object) => {
      if (object instanceof THREE.SkinnedMesh) mesh = object;
    });
    const mixer = new THREE.AnimationMixer(scene);
    mixer.clipAction(scene.animations[0]).play();
    mixer.setTime(0.5);
    scene.updateMatrixWorld(true);
    mesh.skeleton.update();
    const played = new THREE.Box3();
    const vertex = new THREE.Vector3();
    // A skinned mesh gives its vertices already moved by the bones.
    for (let i = 0; i < mesh.geometry.getAttribute("position").count; i++) played.expandByPoint(mesh.getVertexPosition(i, vertex).applyMatrix4(mesh.matrixWorld));
    // The vertices themselves: a turned box's bounds would be larger than what it holds.
    const previewed = new THREE.Box3();
    for (const part of posed(parts, poseRig(rig, clip("Walk"), 0.5))) {
      const geometry = buildGeometry(getBlock(part.block).shape).applyMatrix4(partMatrix(part));
      geometry.computeBoundingBox();
      previewed.union(geometry.boundingBox!);
      geometry.dispose();
    }
    for (const axis of ["x", "y", "z"] as const) {
      expect(played.min[axis]).toBeCloseTo(previewed.min[axis], 3);
      expect(played.max[axis]).toBeCloseTo(previewed.max[axis], 3);
    }
  });
});

describe("rigging a person", () => {
  it.each(STYLES)("finds every bone and takes every part along in the %s style", (style) => {
    const parts = person(style, { hat: "yes", backpack: "yes" });
    const [rig, ...others] = findRigs(parts);
    expect(others).toHaveLength(0);
    expect(rig.bones.map((bone) => bone.name).sort()).toEqual(
      ["calf_l", "calf_r", "foot_l", "foot_r", "hand_l", "hand_r", "head", "lowerarm_l", "lowerarm_r", "neck_01", "pelvis", "spine_03", "thigh_l", "thigh_r", "upperarm_l", "upperarm_r"],
    );
    expect(rig.parts).toHaveLength(parts.length);
    // The hat follows the head.
    const hat = rig.parts.find((part) => /\.hat_/.test(parts.find((p) => p.id === part.id)!.block));
    expect(rig.bones[hat!.bone].name).toBe("head");
  });

  it("gives each person in the scene a skeleton of its own", () => {
    const a = person("realistic", {}, 1, 1);
    const b = person("realistic", {}, 500, 2).map((part) => ({ ...part, position: [part.position[0] + 3, part.position[1], part.position[2]] as Part["position"] }));
    expect(findRigs([...a, ...b])).toHaveLength(2);
  });
});

describe("posing", () => {
  it.each(STYLES)("opens the arms at shoulder height in the T pose, in the %s style", (style) => {
    const parts = person(style);
    const [rig] = findRigs(parts);
    const now = posed(parts, poseRig(rig, clip("Rest Pose"), 0));
    const [left] = byBlock(now, /\.hand$/);
    const shoulder = rig.bones.find((bone) => bone.name === "upperarm_l")!.joint.clone().applyMatrix4(rig.frame);
    const hand = partBounds(left).getCenter(new THREE.Vector3());
    expect(hand.x - shoulder.x).toBeGreaterThan(0.4);
    expect(Math.abs(hand.y - shoulder.y)).toBeLessThan(0.1);
  });

  it.each(STYLES)("keeps the arms down and the feet on the ground when standing, in the %s style", (style) => {
    const parts = person(style);
    const [rig] = findRigs(parts);
    const ground = Math.min(...parts.map((part) => partBounds(part).min.y));
    const now = posed(parts, poseRig(rig, clip("Idle_A"), 1));
    for (const shoe of byBlock(now, /\.shoe_/)) expect(Math.abs(partBounds(shoe).min.y - ground)).toBeLessThan(0.05);
    const shoulderY = rig.bones.find((bone) => bone.name === "upperarm_l")!.joint.clone().applyMatrix4(rig.frame).y;
    for (const hand of byBlock(now, /\.hand(_right)?$/)) expect(shoulderY - partBounds(hand).getCenter(new THREE.Vector3()).y).toBeGreaterThan(0.3);
  });

  it("moves the parts as rigid blocks", () => {
    const parts = person("realistic");
    const [rig] = findRigs(parts);
    const now = posed(parts, poseRig(rig, clip("Walk"), 0.4));
    const distance = (list: Part[]) => {
      const [upper] = byBlock(list, /\.upper_arm$/);
      const [fore] = byBlock(list, /\.forearm$/).filter((part) => Math.sign(part.position[0]) === Math.sign(upper.position[0]));
      return new THREE.Vector3(...upper.position).distanceTo(new THREE.Vector3(...fore.position));
    };
    expect(distance(now)).toBeCloseTo(distance(parts), 6);
  });

  it("swings the legs one after the other while walking", () => {
    const parts = person("realistic");
    const [rig] = findRigs(parts);
    const ahead = (time: number) => {
      const shoes = byBlock(posed(parts, poseRig(rig, clip("Walk"), time)), /\.shoe_/).sort((a, b) => b.position[0] - a.position[0]);
      return shoes[0].position[2] - shoes[1].position[2];
    };
    const samples = Array.from({ length: 12 }, (_, i) => ahead((i / 12) * 1.7));
    expect(Math.max(...samples)).toBeGreaterThan(0.15);
    expect(Math.min(...samples)).toBeLessThan(-0.15);
  });

  it("travels toward where the character faces", () => {
    const yaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2);
    const parts = person("realistic").map((part) => ({
      ...part,
      position: new THREE.Vector3(...part.position).applyQuaternion(yaw).toArray(),
      rotation: yaw.clone().multiply(new THREE.Quaternion(...part.rotation)).toArray() as Part["rotation"],
    }));
    const [rig] = findRigs(parts);
    const roll = clip("Roll_RM");
    const hips = (time: number, inPlace = false) => new THREE.Vector3(...poseRig(rig, roll, time, { inPlace }).get(rig.root)!.position);
    const travel = hips(roll.duration).sub(hips(0));
    // Facing +Z turned a quarter to the left is facing +X.
    expect(travel.x).toBeGreaterThan(2);
    expect(Math.abs(travel.z)).toBeLessThan(0.5);
    expect(Math.abs(hips(roll.duration, true).sub(hips(0, true)).x)).toBeLessThan(0.3);
  });
});
