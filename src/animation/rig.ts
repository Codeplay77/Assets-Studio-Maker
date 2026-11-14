import * as THREE from "three";
import { partBounds, partMatrix } from "../blocks/bounds";
import { getBlock } from "../blocks/catalog";
import type { Part, PartId, Quat, Vec3 } from "../core/types";
import { SOURCE_BONES, SOURCE_REST, type ClipSampler, type SourceBone } from "./clips";

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

/** Where each bone of the source skeleton hangs. Parents come first in SOURCE_BONES; the fingers are added below. */
const SOURCE_PARENT: Partial<Record<SourceBone, SourceBone | null>> = {
  pelvis: null,
  spine_01: "pelvis",
  spine_02: "spine_01",
  spine_03: "spine_02",
  neck_01: "spine_03",
  head: "neck_01",
  clavicle_l: "spine_03",
  upperarm_l: "clavicle_l",
  lowerarm_l: "upperarm_l",
  hand_l: "lowerarm_l",
  clavicle_r: "spine_03",
  upperarm_r: "clavicle_r",
  lowerarm_r: "upperarm_r",
  hand_r: "lowerarm_r",
  thigh_l: "pelvis",
  calf_l: "thigh_l",
  foot_l: "calf_l",
  ball_l: "foot_l",
  thigh_r: "pelvis",
  calf_r: "thigh_r",
  foot_r: "calf_r",
  ball_r: "foot_r",
};

const FINGER = /^(thumb|index|middle|ring|pinky)_0([123])_([lr])$/;
for (const name of SOURCE_BONES) {
  const finger = FINGER.exec(name);
  if (finger) SOURCE_PARENT[name] = (finger[2] === "1" ? `hand_${finger[3]}` : `${finger[1]}_0${Number(finger[2]) - 1}_${finger[3]}`) as SourceBone;
}

/** The source skeleton's feet, the bones that touch the ground when standing. */
const FEET: SourceBone[] = ["foot_l", "ball_l", "foot_r", "ball_r"];

/**
 * Bones a Realista body keeps as they are at rest: its own hips, back, neck, head, shoulders and
 * feet stand as a person stands, like the source skeleton's, even where the two place their joints
 * differently. Lining these up with the source's would tilt the hips and pull the shoulders back.
 */
const OWN_STANCE = new Set<SourceBone>(["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "clavicle_r", ...FEET]);

/** The joint a bone points to, the same in the source skeleton and in a Realista body. */
const TIP: Partial<Record<SourceBone, SourceBone>> = {
  upperarm_l: "lowerarm_l", lowerarm_l: "hand_l", hand_l: "middle_01_l",
  upperarm_r: "lowerarm_r", lowerarm_r: "hand_r", hand_r: "middle_01_r",
  thigh_l: "calf_l", calf_l: "foot_l", thigh_r: "calf_r", calf_r: "foot_r",
};
for (const name of SOURCE_BONES) {
  const finger = FINGER.exec(name);
  if (finger && finger[2] !== "3") TIP[name] = `${finger[1]}_0${Number(finger[2]) + 1}_${finger[3]}` as SourceBone;
}

function kindOfBone(name: SourceBone): Kind {
  if (FINGER.test(name)) return "hand";
  if (name === "pelvis" || name === "head") return name;
  if (name.startsWith("spine") || name.startsWith("clavicle")) return "torso";
  if (name === "neck_01") return "neck";
  if (name.startsWith("upperarm")) return "upper";
  if (name.startsWith("lowerarm")) return "fore";
  if (name.startsWith("hand")) return "hand";
  if (name.startsWith("thigh")) return "thigh";
  if (name.startsWith("calf")) return "calf";
  return "foot";
}

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
  /**
   * For a skinned part (a Realista body, its clothes and hair), which bends with every bone instead
   * of following one: its own space taken into the character's, scale included. Its vertices name
   * the bones by their place in SOURCE_BONES, which is also their place in the rig.
   */
  skin?: THREE.Matrix4;
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
  /** For a skinned part: 16 numbers per bone, each moving its vertices from rest, in the part's own space. */
  bones?: Float32Array;
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
  const used = new Set<Part>();
  const rigs: Rig[] = findSkinnedRigs(parts, grid, used);

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

const sameSpot = (a: Part, b: Part) =>
  a.position.every((value, axis) => Math.abs(value - b.position[axis]) < 1e-4) &&
  Math.abs(new THREE.Quaternion(...a.rotation).dot(new THREE.Quaternion(...b.rotation))) > 0.99999 &&
  a.scale.every((value, axis) => Math.abs(value - b.scale[axis]) < 1e-4);

/**
 * The Realista people: a body made of skinned pieces and, on the same spot, the clothes and hair
 * that bend with it. Their skeleton comes with the body block, bone for bone the source skeleton's.
 * Whatever is fitted on the body's other sockets (something held, or a hat of another style)
 * follows the nearest bone, and whatever is fitted on that, the same bone.
 */
function findSkinnedRigs(parts: Part[], grid: MountGrid, used: Set<Part>): Rig[] {
  const rigs: Rig[] = [];
  for (const body of parts) {
    const skeleton = getBlock(body.block).skeleton;
    if (!skeleton?.body || used.has(body)) continue;
    used.add(body);
    const frame = new THREE.Matrix4().compose(new THREE.Vector3(...body.position), new THREE.Quaternion(...body.rotation), new THREE.Vector3(1, 1, 1));
    const toLocal = frame.clone().invert();
    const bodySpace = toLocal.clone().multiply(partMatrix(body));

    // A body made before the fingers had bones has only the first ones.
    const names = SOURCE_BONES.slice(0, skeleton.joints.length);
    const joints = names.map((_, index) => new THREE.Vector3(...skeleton.joints[index]).applyMatrix4(bodySpace));
    const bones: RigBone[] = [];
    names.forEach((name, index) => {
      const parentName = SOURCE_PARENT[name];
      const parent = parentName ? names.indexOf(parentName) : -1;
      const fromRest = new THREE.Quaternion();
      if (!OWN_STANCE.has(name)) {
        // Arms, fingers and legs are lined up with the source's one bone after the other, each from
        // where its parent took it, so that a forearm keeps its upper arm's twist and the palm faces
        // where the source's does. Lined up each on its own, a bent forearm would twist.
        const tip = TIP[name] ? names.indexOf(TIP[name]!) : -1;
        const ours = tip >= 0 ? joints[tip].clone().sub(joints[index]).normalize() : new THREE.Vector3(...skeleton.directions[index]).transformDirection(bodySpace);
        if (parent >= 0) {
          fromRest.copy(bones[parent].fromRest);
          ours.applyQuaternion(fromRest);
        }
        fromRest.premultiply(new THREE.Quaternion().setFromUnitVectors(ours, new THREE.Vector3(...SOURCE_REST.directions[name]).normalize()));
      }
      bones.push({ name, kind: kindOfBone(name), part: body.id, parent, joint: joints[index], fromRest });
    });
    const nearestBone = (point: THREE.Vector3) => {
      let best = 0;
      bones.forEach((bone, index) => {
        if (bone.joint.distanceToSquared(point) < bones[best].joint.distanceToSquared(point)) best = index;
      });
      return best;
    };

    const rigParts: RigPart[] = [];
    const add = (part: Part, bone: number, skinned: boolean) => {
      const local = toLocal.clone().multiply(partMatrix(part));
      const position = new THREE.Vector3();
      const rotation = new THREE.Quaternion();
      local.decompose(position, rotation, new THREE.Vector3());
      rigParts.push({ id: part.id, bone, position, rotation, ...(skinned ? { skin: local } : {}) });
    };
    add(body, 0, true);
    // Its clothes and hair stand exactly where it stands.
    for (const part of parts) {
      if (used.has(part) || part.group !== body.group || !getBlock(part.block).skeleton || !sameSpot(part, body)) continue;
      used.add(part);
      add(part, 0, true);
    }
    const followers: { part: Part; bone: number }[] = [];
    // The first socket is where the body stands: what is there is the ground, not the person.
    socketsOf(body)
      .slice(1)
      .forEach((socket) => {
        for (const { part } of grid.near(socket)) {
          if (used.has(part) || part.group !== body.group || getBlock(part.block).skeleton) continue;
          used.add(part);
          followers.push({ part, bone: nearestBone(socket.clone().applyMatrix4(toLocal)) });
        }
      });
    for (let i = 0; i < followers.length; i++) {
      const { part, bone } = followers[i];
      add(part, bone, false);
      for (const socket of socketsOf(part)) {
        for (const mount of grid.near(socket)) {
          if (used.has(mount.part) || mount.part.group !== body.group) continue;
          used.add(mount.part);
          followers.push({ part: mount.part, bone });
        }
      }
    }

    const owned = parts.filter((part) => rigParts.some((entry) => entry.id === part.id));
    const ground = owned.reduce((low, part) => Math.min(low, partBounds(part, toLocal).min.y), Infinity);
    const height = bones[0].joint.y - ground;
    rigs.push({ root: body.id, frame, bones, parts: rigParts, scale: height > 0.05 ? height / SOURCE_REST.joints.pelvis[1] : 1, ground });
  }
  return rigs;
}

export interface PoseOptions {
  /** Keeps the character where it is in clips that walk somewhere. */
  inPlace?: boolean;
}

const SOURCE_PARENT_INDEX = SOURCE_BONES.map((name) => (SOURCE_PARENT[name] ? SOURCE_BONES.indexOf(SOURCE_PARENT[name]!) : -1));
/** The source's bones down to its feet; the fingers come after them. */
const TO_FEET = SOURCE_BONES.slice(0, Math.max(...FEET.map((name) => SOURCE_BONES.indexOf(name))) + 1);
const sourceMove = new THREE.Vector3();

/**
 * How high the source skeleton's lowest foot is over where it stands at rest, at a moment of a
 * clip. A foot that is planted gives 0, a jump gives how high it went.
 */
function sourceFeetLift(clip: ClipSampler, time: number): number {
  const turns: THREE.Quaternion[] = [];
  const joints: THREE.Vector3[] = [];
  TO_FEET.forEach((name, index) => {
    turns.push(clip.turn(name, time, new THREE.Quaternion()));
    const rest = new THREE.Vector3(...SOURCE_REST.joints[name]);
    const parent = SOURCE_PARENT_INDEX[index];
    if (parent < 0) joints.push(rest.add(clip.hips(time, sourceMove)));
    else joints.push(rest.sub(new THREE.Vector3(...SOURCE_REST.joints[SOURCE_BONES[parent]])).applyQuaternion(turns[parent]).add(joints[parent]));
  });
  return Math.min(...FEET.map((name) => joints[SOURCE_BONES.indexOf(name)].y - SOURCE_REST.joints[name][1]));
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
  // Legs of other proportions bend to other heights: lifting the whole body keeps this character's
  // lowest foot as high over the ground as the source's, so planted feet stay on it and jumps go
  // as high, in this character's scale.
  const feet = rig.bones.flatMap((bone, index) => (FEET.includes(bone.name) ? [index] : []));
  if (feet.length > 0) {
    const ours = Math.min(...feet.map((index) => joints[index].y - rig.bones[index].joint.y));
    const lift = sourceFeetLift(clip, time) * rig.scale - ours;
    for (const joint of joints) joint.y += lift;
  }
  return { turns, joints };
}

/** Where every part of the character is at a moment of a clip, in the scene. */
export function poseRig(rig: Rig, clip: ClipSampler, time: number, options: PoseOptions = {}): Map<PartId, PartPose> {
  const { turns, joints } = poseBones(rig, clip, time, options);
  const world = new THREE.Quaternion();
  rig.frame.decompose(new THREE.Vector3(), world, new THREE.Vector3());
  const pose = new Map<PartId, PartPose>();
  const move = new THREE.Matrix4();
  const step = new THREE.Matrix4();
  for (const part of rig.parts) {
    if (part.skin) {
      // A skinned part stays where it is; its bones bend it. Each bone's move, from the part's own
      // space: into the character's, around the bone's joint at rest, to where the joint is now.
      const fromPart = part.skin;
      const toPart = fromPart.clone().invert();
      const bones = new Float32Array(rig.bones.length * 16);
      rig.bones.forEach((bone, index) => {
        move.makeTranslation(joints[index].x, joints[index].y, joints[index].z);
        move.multiply(step.makeRotationFromQuaternion(turns[index]));
        move.multiply(step.makeTranslation(-bone.joint.x, -bone.joint.y, -bone.joint.z));
        move.premultiply(toPart).multiply(fromPart);
        move.toArray(bones, index * 16);
      });
      const position = part.position.clone().applyMatrix4(rig.frame);
      const rotation = world.clone().multiply(part.rotation);
      pose.set(part.id, { position: position.toArray(), rotation: rotation.toArray() as Quat, bones });
      continue;
    }
    const bone = rig.bones[part.bone];
    const position = part.position.clone().sub(bone.joint).applyQuaternion(turns[part.bone]).add(joints[part.bone]).applyMatrix4(rig.frame);
    const rotation = world.clone().multiply(turns[part.bone]).multiply(part.rotation);
    pose.set(part.id, { position: position.toArray(), rotation: rotation.toArray() as Quat });
  }
  return pose;
}
