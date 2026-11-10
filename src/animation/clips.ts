import * as THREE from "three";
import { ANIMATION_FPS, CLIPS, SOURCE_BONES, type ClipInfo, type SourceBone } from "./library.generated";

export { ANIMATION_CATEGORIES, ANIMATION_FPS, CLIPS, SOURCE_BONES, SOURCE_REST, type ClipInfo, type SourceBone } from "./library.generated";

const BONE_COUNT = SOURCE_BONES.length;
const boneIndex = new Map<SourceBone, number>(SOURCE_BONES.map((bone, index) => [bone, index]));

let pack: ArrayBuffer | null = null;
let loading: Promise<void> | null = null;

export function setAnimationPack(buffer: ArrayBuffer): void {
  pack = buffer;
}

export function hasAnimationPack(): boolean {
  return pack !== null;
}

/** The pack is only fetched the first time someone animates, not when the editor opens. */
export function loadAnimationPack(): Promise<void> {
  if (pack) return Promise.resolve();
  loading ??= fetch("/animations/human.bin")
    .then((response) => {
      if (!response.ok) throw new Error(`Falha ao carregar as animações: ${response.status}`);
      return response.arrayBuffer();
    })
    .then(setAnimationPack)
    .catch((error: unknown) => {
      loading = null;
      throw error;
    });
  return loading;
}

const byId = new Map(CLIPS.map((clip) => [clip.id, clip]));

export function getClip(id: string): ClipInfo | undefined {
  return byId.get(id);
}

export function clipDuration(clip: ClipInfo): number {
  return (clip.frames - 1) / ANIMATION_FPS;
}

/**
 * The clip's name in an exported file, which game code refers to: its Portuguese name in plain
 * letters, like `andar` or `pistola_atirar`. Engines reject some symbols in animation names.
 */
export function clipFileName(clip: ClipInfo): string {
  return clip.label
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
}

/**
 * Reads one clip of the pack. For each bone it gives how far the bone turned from the rest pose,
 * and for the hips how far they moved, both in the space of the character: Y up, facing +Z.
 */
export class ClipSampler {
  readonly duration: number;
  private readonly rotations: Int16Array;
  private readonly moves: Float32Array;
  private readonly a = new THREE.Quaternion();
  private readonly b = new THREE.Quaternion();

  constructor(readonly clip: ClipInfo) {
    if (!pack) throw new Error("As animações ainda não foram carregadas");
    this.duration = clipDuration(clip);
    this.rotations = new Int16Array(pack, clip.offset, clip.frames * BONE_COUNT * 4);
    this.moves = new Float32Array(pack, clip.offset + clip.frames * BONE_COUNT * 8, clip.frames * 3);
  }

  /** Looping clips wrap around; the others stop on their last frame. */
  private frameAt(time: number): [number, number, number] {
    const last = this.clip.frames - 1;
    let t = time;
    if (this.clip.loop && this.duration > 0) t = ((t % this.duration) + this.duration) % this.duration;
    const exact = Math.min(last, Math.max(0, t * ANIMATION_FPS));
    const frame = Math.min(last - 1, Math.floor(exact));
    return [frame, frame + 1, exact - frame];
  }

  private read(frame: number, bone: number, out: THREE.Quaternion): THREE.Quaternion {
    const at = (frame * BONE_COUNT + bone) * 4;
    const r = this.rotations;
    return out.set(r[at] / 32767, r[at + 1] / 32767, r[at + 2] / 32767, r[at + 3] / 32767).normalize();
  }

  turn(bone: SourceBone, time: number, out: THREE.Quaternion): THREE.Quaternion {
    const index = boneIndex.get(bone)!;
    const [frame, next, t] = this.frameAt(time);
    return out.copy(this.read(frame, index, this.a)).slerp(this.read(next, index, this.b), t);
  }

  hips(time: number, out: THREE.Vector3): THREE.Vector3 {
    const [frame, next, t] = this.frameAt(time);
    const m = this.moves;
    return out.set(
      m[frame * 3] * (1 - t) + m[next * 3] * t,
      m[frame * 3 + 1] * (1 - t) + m[next * 3 + 1] * t,
      m[frame * 3 + 2] * (1 - t) + m[next * 3 + 2] * t,
    );
  }
}
