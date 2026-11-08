import * as THREE from "three";
import { getBlock } from "../blocks/catalog";
import type { Quat, Vec3 } from "../core/types";
import { alignToSurface, worldSockets, type WorldSocket } from "../viewport/placement";

export interface GeneratedPart {
  block: string;
  position: Vec3;
  rotation: Quat;
  scale: Vec3;
  color?: string;
}

export interface PartOptions {
  color?: string;
  /** A number scales evenly on all axes. */
  scale?: number | Vec3;
  /** Quarter turns around the attachment normal. */
  yawSteps?: number;
}

export interface AssembledPart {
  block: string;
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  scale: THREE.Vector3;
  color?: string;
}

const UP = new THREE.Vector3(0, 1, 0);

function toScale(scale: PartOptions["scale"]): THREE.Vector3 {
  if (Array.isArray(scale)) return new THREE.Vector3(...scale);
  return new THREE.Vector3().setScalar(scale ?? 1);
}

/** Builds a model part by part, using the same sockets a person clicks in the editor. */
export class Assembler {
  readonly parts: AssembledPart[] = [];

  add(block: string, position: Vec3, options: PartOptions = {}): AssembledPart {
    return this.push({
      block,
      position: new THREE.Vector3(...position),
      quaternion: new THREE.Quaternion().setFromAxisAngle(
        UP,
        ((options.yawSteps ?? 0) * Math.PI) / 2,
      ),
      scale: toScale(options.scale),
      color: options.color,
    });
  }

  attach(
    parent: AssembledPart,
    socket: string,
    block: string,
    options: PartOptions = {},
  ): AssembledPart {
    const target = this.socketOf(parent, socket);
    const scale = toScale(options.scale);
    const base = getBlock(block).sockets[0];
    const { position, quaternion } = alignToSurface(
      base,
      target.position,
      target.normal,
      options.yawSteps ?? 0,
      scale,
    );
    return this.push({ block, position, quaternion, scale, color: options.color });
  }

  socketOf(part: AssembledPart, id: string): WorldSocket {
    const socket = getBlock(part.block).sockets.find((candidate) => candidate.id === id);
    if (!socket) throw new Error(`O bloco ${part.block} não tem o encaixe ${id}`);
    const matrix = new THREE.Matrix4().compose(part.position, part.quaternion, part.scale);
    return worldSockets([socket], matrix)[0];
  }

  /** Moves the whole model so a socket ends up at the given height. */
  dropTo(part: AssembledPart, socket: string, y = 0): void {
    const offset = y - this.socketOf(part, socket).position.y;
    for (const item of this.parts) item.position.y += offset;
  }

  result(): GeneratedPart[] {
    return this.parts.map((part) => ({
      block: part.block,
      position: part.position.toArray(),
      rotation: part.quaternion.toArray() as Quat,
      scale: part.scale.toArray(),
      ...(part.color ? { color: part.color } : {}),
    }));
  }

  private push(part: AssembledPart): AssembledPart {
    this.parts.push(part);
    return part;
  }
}
