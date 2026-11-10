import * as THREE from "three";
import { ANIMATION_FPS, type ClipSampler } from "./clips";
import { poseBones, type PoseOptions, type Rig } from "./rig";

/**
 * The character's skeleton as bones for a file. At rest every bone has no rotation of its own, so
 * a bone's turn in a clip is the turn of its blocks, the same the preview shows. Positions are from
 * the character's feet: the node holding the skeleton stands on the ground.
 */
export function buildSkeleton(rig: Rig): THREE.Bone[] {
  const bones = rig.bones.map((source) => {
    const bone = new THREE.Bone();
    bone.name = source.name;
    return bone;
  });
  rig.bones.forEach((source, index) => {
    if (source.parent < 0) {
      bones[index].position.copy(source.joint).setY(source.joint.y - rig.ground);
    } else {
      bones[index].position.copy(source.joint).sub(rig.bones[source.parent].joint);
      bones[source.parent].add(bones[index]);
    }
  });
  return bones;
}

/** Samples a clip on the character's skeleton, frame by frame, as tracks a file can carry. */
export function bakeClip(rig: Rig, clip: ClipSampler, bones: THREE.Bone[], name: string, options: PoseOptions = {}): THREE.AnimationClip {
  const frames = clip.clip.frames;
  const times = new Float32Array(frames);
  const turns = bones.map(() => new Float32Array(frames * 4));
  const hips = new Float32Array(frames * 3);
  const local = new THREE.Quaternion();
  const previous = bones.map(() => new THREE.Quaternion());

  for (let frame = 0; frame < frames; frame++) {
    const time = frame / ANIMATION_FPS;
    times[frame] = time;
    const pose = poseBones(rig, clip, time, options);
    rig.bones.forEach((bone, index) => {
      // Each bone keeps only its turn relative to its parent, as files store them.
      local.copy(pose.turns[index]);
      if (bone.parent >= 0) local.premultiply(pose.turns[bone.parent].clone().invert());
      // Neighboring keys on the same side of the sphere, so engines blend the short way.
      if (frame > 0 && local.dot(previous[index]) < 0) local.set(-local.x, -local.y, -local.z, -local.w);
      previous[index].copy(local);
      local.toArray(turns[index], frame * 4);
    });
    pose.joints[0].toArray(hips, frame * 3);
    hips[frame * 3 + 1] -= rig.ground;
  }

  // Tracks point at bones by uuid: several characters in one file all have a bone named pelvis.
  const tracks: THREE.KeyframeTrack[] = bones.map((bone, index) => new THREE.QuaternionKeyframeTrack(`${bone.uuid}.quaternion`, times, turns[index]));
  tracks.push(new THREE.VectorKeyframeTrack(`${bones[0].uuid}.position`, times, hips));
  return new THREE.AnimationClip(name, (frames - 1) / ANIMATION_FPS, tracks);
}
