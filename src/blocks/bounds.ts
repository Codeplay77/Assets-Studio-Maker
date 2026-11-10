import * as THREE from "three";
import type { Part } from "../core/types";
import { getBlock, type BlockDef } from "./catalog";
import { buildGeometry } from "./geometry";

const boxes = new WeakMap<BlockDef, THREE.Box3>();

/** The bounds of a block's geometry, in its own space. Built once per block. */
export function blockBounds(def: BlockDef): THREE.Box3 {
  let box = boxes.get(def);
  if (!box) {
    const geometry = buildGeometry(def.shape);
    geometry.computeBoundingBox();
    box = geometry.boundingBox!.clone();
    geometry.dispose();
    boxes.set(def, box);
  }
  return box;
}

export function partMatrix(part: Pick<Part, "position" | "rotation" | "scale">): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...part.position),
    new THREE.Quaternion(...part.rotation),
    new THREE.Vector3(...part.scale),
  );
}

/** The box of a part, in the space `toSpace` takes the scene to. */
export function partBounds(part: Part, toSpace: THREE.Matrix4 = new THREE.Matrix4()): THREE.Box3 {
  return blockBounds(getBlock(part.block)).clone().applyMatrix4(toSpace.clone().multiply(partMatrix(part)));
}
