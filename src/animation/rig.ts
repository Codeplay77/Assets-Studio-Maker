import * as THREE from "three";
import { partBounds, partMatrix } from "../blocks/bounds";
import { getBlock } from "../blocks/catalog";
import type { Part, PartId, Quat, Vec3 } from "../core/types";
import { SOURCE_REST, type ClipSampler, type SourceBone } from "./clips";

/** The body blocks of the person generator, in every style, and the bone each one is. */
type Kind = "pelvis" | "torso" | "neck" | "head" | "upper" | "fore" | "hand" | "thigh" | "calf" | "foot";

const KINDS: [RegExp, Kind][] = [
  [/^(body|lp|ar|vx)\.hips(_f)?$/, "pelvis"],
  [/^(body|lp|ar|vx)\.torso_/, "torso"],
  [/^(body|lp|ar|vx)\.neck$/, "neck"],
  [/^(body|lp|ar|vx)\.head_/, "head"],
  [/^(body|lp|ar|vx)\.upper_arm$/, "upper"],
  [/^(body|lp|ar|vx)\.forearm$/, "fore"],
  [/^(body|lp|ar|vx)\.hand(_right)?$/, "hand"],
  [/^(body|lp|ar|vx)\.thigh$/, "thigh"],
  [/^(body|lp|ar|vx)\.calf$/, "calf"],
  [/^(body|lp|ar|vx)\.shoe_/, "foot"],
];

const PARENT: Partial<Record<Kind, Kind>> = {
  torso: "pelvis", neck: "torso", head: "neck", upper: "torso", fore: "upper", hand: "fore", thigh: "pelvis", calf: "thigh", foot: "calf",
};
const DEPTH: Record<Kind, number> = { pelvis: 0, torso: 1, thigh: 1, neck: 2, upper: 2, calf: 2, head: 3, fore: 3, foot: 3, hand: 4 };
/** The joint a bone points to at rest, to line it up with the source skeleton. */
const NEXT: Partial<Record<Kind, Kind>> = { upper: "fore", fore: "hand", thigh: "calf", calf: "foot" };

const kindOf = (block: string): Kind | undefined => KINDS.find(([pattern]) => pattern.test(block))?.[1];

function boneName(kind: Kind, side: "l" | "r"): SourceBone {
  switch (kind) {
    case "pelvis": return "pelvis";
    case "torso": return "spine_03";
    case "neck": return "neck_01";
    case "head": return "head";
    case "upper": return `upperarm_${side}`;
    case "fore": return `lowerarm_${side}`;
    case "hand": return `hand_${side}`;
    case "thigh": return `thigh_${side}`;
    case "calf": return `calf_${side}`;
    case "foot": return `foot_${side}`;
  }
}

export interface RigBone {
  name: SourceBone;
  kind: Kind;
  part: PartId;
  /** Index in `bones`; parents always come first. */
  parent: number;
  /** Where the bone turns, in the character's space. */
  joint: THREE.Vector3;
  /**
   * Turns the source skeleton's rest pose into this character's. The source stands in a T pose; a
   * generated person has its arms down, so its arms need this and the rest of the body does not.
   */
  fromRest: THREE.Quaternion;
}

export interface RigPart {
  id: PartId;
  bone: number;
  /** At rest, in the character's space. */
  position: THREE.Vector3;
  rotation: THREE.Quaternion;
}

/** A person ready to animate: its bones, and every part with the bone it follows. */
export interface Rig {
  /** The hips part; animations chosen for the character are kept under its id. */
  root: PartId;
  /** The character's space in the scene: at its hips, facing +Z. */
  frame: THREE.Matrix4;
  bones: RigBone[];
  parts: RigPart[];
  /** How much taller this character's hips are than the source skeleton's. */
  scale: number;
  /** Height of the soles, in the character's space. */
  ground: number;
}

export interface PartPose {
  position: Vec3;
  rotation: Quat;
}

const TOLERANCE = 0.012;
const CELL = 0.05;

interface Mount {
  part: Part;
  at: THREE.Vector3;
}

/** A grid of where parts attach, to find what is fitted on a socket without testing every part. */
class MountGrid {
  private readonly cells = new Map<string, Mount[]>();

  constructor(parts: Part[]) {
    for (const part of parts) {
      const socket = getBlock(part.block).sockets[0];
      if (!socket) continue;
      const at = new THREE.Vector3(...socket.p).applyMatrix4(partMatrix(part));
      const key = this.key(at);
      this.cells.set(key, [...(this.cells.get(key) ?? []), { part, at }]);
    }
  }

  private key(at: THREE.Vector3, dx = 0, dy = 0, dz = 0): string {
    return `${Math.floor(at.x / CELL) + dx},${Math.floor(at.y / CELL) + dy},${Math.floor(at.z / CELL) + dz}`;
  }

  near(at: THREE.Vector3): Mount[] {
    const found: Mount[] = [];
    for (let dx = -1; dx <= 1; dx++)
      for (let dy = -1; dy <= 1; dy++)
        for (let dz = -1; dz <= 1; dz++)
          for (const mount of this.cells.get(this.key(at, dx, dy, dz)) ?? []) if (mount.at.distanceTo(at) < TOLERANCE) found.push(mount);
    return found;
  }
}

function socketsOf(part: Part): THREE.Vector3[] {
  const matrix = partMatrix(part);
  return getBlock(part.block).sockets.map((socket) => new THREE.Vector3(...socket.p).applyMatrix4(matrix));
}

/**
 * Finds the people among the parts and gives each a skeleton. A person is its hips and everything
 * fitted on them, socket by socket: the body blocks become bones and the rest (face, hair, hats,
 * skirt, backpack) follows the bone it is fitted on.
 */
export function findRigs(parts: Part[]): Rig[] {
  const grid = new MountGrid(parts);
  const rigs: Rig[] = [];
  const used = new Set<Part>();

  for (const hips of parts.filter((part) => kindOf(part.block) === "pelvis")) {
    if (used.has(hips)) continue;
    // Walks from the hips along the sockets: whatever is mounted on a socket belongs to the person.
    const parentOf = new Map<Part, Part>();
    const order: Part[] = [hips];
    used.add(hips);
    for (let i = 0; i < order.length; i++) {
      for (const socket of socketsOf(order[i])) {
        for (const { part } of grid.near(socket)) {
          if (used.has(part) || part.group !== hips.group) continue;
          used.add(part);
          parentOf.set(part, order[i]);
          order.push(part);
        }
      }
    }

    const frame = new THREE.Matrix4().compose(new THREE.Vector3(...hips.position), new THREE.Quaternion(...hips.rotation), new THREE.Vector3(1, 1, 1));
    const toLocal = frame.clone().invert();
    const mountOf = (part: Part) => {
      const socket = getBlock(part.block).sockets[0];
      return new THREE.Vector3(...(socket?.p ?? [0, 0, 0])).applyMatrix4(partMatrix(part)).applyMatrix4(toLocal);
    };

    // One bone per body block; a second block of the same bone just follows the first.
    const boneOfPart = new Map<Part, number>();
    const bones: RigBone[] = [];
    const candidates = order
      .map((part) => ({ part, kind: kindOf(part.block) }))
      .filter((entry): entry is { part: Part; kind: Kind } => entry.kind !== undefined)
      .sort((a, b) => DEPTH[a.kind] - DEPTH[b.kind]);
    for (const { part, kind } of candidates) {
      const joint = mountOf(part);
      const name = boneName(kind, joint.x >= 0 ? "l" : "r");
      if (bones.some((bone) => bone.name === name)) continue;
      // The parent bone is the nearest body block up the chain of sockets.
      let up = parentOf.get(part);
      while (up && !boneOfPart.has(up)) up = parentOf.get(up);
      const parent = up ? boneOfPart.get(up)! : -1;
      if (kind !== "pelvis" && (parent < 0 || bones[parent].kind !== PARENT[kind])) continue;
      boneOfPart.set(part, bones.length);
      bones.push({ name, kind, part: part.id, parent, joint, fromRest: new THREE.Quaternion() });
    }
    if (bones.length < 2 || bones[0].kind !== "pelvis") continue;

    // The hips turn between the two hip joints, like the source skeleton's pelvis.
    const thighs = bones.filter((bone) => bone.kind === "thigh");
    if (thighs.length === 2) bones[0].joint = thighs[0].joint.clone().add(thighs[1].joint).multiplyScalar(0.5);

    for (const bone of bones) {
      const next = NEXT[bone.kind];
      const part = order.find((candidate) => candidate.id === bone.part)!;
      let tip: THREE.Vector3 | undefined;
      if (next) tip = bones.find((other) => other.parent === bones.indexOf(bone) && other.kind === next)?.joint;
      if (!tip && (bone.kind === "hand" || next)) {
        // A hand points toward its grip; an arm or leg missing its next block, toward its other socket.
        const sockets = getBlock(part.block).sockets;
        const socket = sockets.find((candidate) => candidate.id === "grip") ?? sockets[1];
        if (socket) tip = new THREE.Vector3(...socket.p).applyMatrix4(partMatrix(part)).applyMatrix4(toLocal);
      }
      if (!tip || tip.distanceTo(bone.joint) < 1e-4) continue;
      const ours = tip.clone().sub(bone.joint).normalize();
      const theirs = new THREE.Vector3(...SOURCE_REST.directions[bone.name]);
      bone.fromRest.setFromUnitVectors(ours, theirs);
    }

    const rigParts: RigPart[] = order.map((part) => {
      let owner: Part | undefined = part;
      while (owner && !boneOfPart.has(owner)) owner = parentOf.get(owner);
      const local = toLocal.clone().multiply(partMatrix(part));
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      local.decompose(position, rotation, new THREE.Vector3());
      return { id: part.id, bone: owner ? boneOfPart.get(owner)! : 0, position, rotation };
    });

    const ground = order.reduce((low, part) => Math.min(low, partBounds(part, toLocal).min.y), Infinity);
    const height = bones[0].joint.y - ground;
    rigs.push({ root: hips.id, frame, bones, parts: rigParts, scale: height > 0.05 ? height / SOURCE_REST.joints.pelvis[1] : 1, ground });
  }
  return rigs;
}

export interface PoseOptions {
  /** Keeps the character where it is in clips that walk somewhere. */
  inPlace?: boolean;
}

/** Where each bone is at a moment of a clip, in the character's space. */
export function poseBones(rig: Rig, clip: ClipSampler, time: number, options: PoseOptions = {}): { turns: THREE.Quaternion[]; joints: THREE.Vector3[] } {
  const turns: THREE.Quaternion[] = [];
  const joints: THREE.Vector3[] = [];
  const move = new THREE.Vector3();
  for (const bone of rig.bones) {
    turns.push(clip.turn(bone.name, time, new THREE.Quaternion()).multiply(bone.fromRest));
    if (bone.parent < 0) {
      clip.hips(time, move).multiplyScalar(rig.scale);
      if (options.inPlace) move.x = move.z = 0;
      joints.push(bone.joint.clone().add(move));
    } else {
      const parent = rig.bones[bone.parent];
      joints.push(bone.joint.clone().sub(parent.joint).applyQuaternion(turns[bone.parent]).add(joints[bone.parent]));
    }
  }
  return { turns, joints };
}

/** Where every part of the character is at a moment of a clip, in the scene. */
export function poseRig(rig: Rig, clip: ClipSampler, time: number, options: PoseOptions = {}): Map<PartId, PartPose> {
  const { turns, joints } = poseBones(rig, clip, time, options);
  const world = new THREE.Quaternion();
  rig.frame.decompose(new THREE.Vector3(), world, new THREE.Vector3());
  const pose = new Map<PartId, PartPose>();
  for (const part of rig.parts) {
    const bone = rig.bones[part.bone];
    const position = part.position.clone().sub(bone.joint).applyQuaternion(turns[part.bone]).add(joints[part.bone]).applyMatrix4(rig.frame);
    const rotation = world.clone().multiply(turns[part.bone]).multiply(part.rotation);
    pose.set(part.id, { position: position.toArray(), rotation: rotation.toArray() as Quat });
  }
  return pose;
}
