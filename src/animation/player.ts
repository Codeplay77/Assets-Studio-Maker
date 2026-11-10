import { create } from "zustand";
import { useEditor } from "../core/store";
import type { PartId } from "../core/types";
import { activeViewport } from "../viewport/active";
import { ClipSampler, getClip, loadAnimationPack } from "./clips";
import { findRigs, poseRig, type Rig } from "./rig";

/** A clip that does not repeat stays on its last pose this long before the preview starts over. */
const HOLD_SECONDS = 0.8;

interface PlayerState {
  status: "idle" | "loading" | "ready" | "error";
  /** The hips of the character being animated. */
  character: PartId | null;
  clip: string | null;
  playing: boolean;
  time: number;
  inPlace: boolean;
}

export const usePlayer = create<PlayerState>(() => ({
  status: "idle",
  character: null,
  clip: null,
  playing: false,
  time: 0,
  inPlace: false,
}));

let sampler: ClipSampler | null = null;
let rig: Rig | null = null;
let rigRevision = -1;
let frame = 0;
let last = 0;

export async function ensureAnimations(): Promise<boolean> {
  const { status } = usePlayer.getState();
  if (status === "ready") return true;
  usePlayer.setState({ status: "loading" });
  try {
    await loadAnimationPack();
    usePlayer.setState({ status: "ready" });
    return true;
  } catch (error) {
    usePlayer.setState({ status: "error" });
    useEditor.getState().report(error);
    return false;
  }
}

/** The character's skeleton, built again whenever the project changes. */
function currentRig(): Rig | null {
  const snapshot = useEditor.getState().snapshot;
  const { character } = usePlayer.getState();
  if (!snapshot || character === null) return null;
  if (rig?.root !== character || rigRevision !== snapshot.revision) {
    rig = findRigs(snapshot.project.parts).find((candidate) => candidate.root === character) ?? null;
    rigRevision = snapshot.revision;
  }
  return rig;
}

function show(): void {
  const viewport = activeViewport();
  const target = currentRig();
  if (!viewport) return;
  if (!target || !sampler) {
    viewport.setPose(null);
    return;
  }
  const { time, inPlace } = usePlayer.getState();
  viewport.setPose(poseRig(target, sampler, Math.min(time, sampler.duration), { inPlace }));
}

function tick(now: number): void {
  const state = usePlayer.getState();
  if (!state.playing || !sampler) return;
  let time = state.time + Math.min(0.1, (now - last) / 1000);
  last = now;
  if (sampler.clip.loop) time %= Math.max(sampler.duration, 1e-3);
  else if (time > sampler.duration + HOLD_SECONDS) time = 0;
  usePlayer.setState({ time });
  show();
  frame = requestAnimationFrame(tick);
}

function run(): void {
  cancelAnimationFrame(frame);
  last = performance.now();
  frame = requestAnimationFrame(tick);
}

export function chooseCharacter(character: PartId | null): void {
  usePlayer.setState({ character, time: 0 });
  show();
}

/** Plays a clip on the chosen character, from the start. */
export async function previewClip(clipId: string): Promise<void> {
  const clip = getClip(clipId);
  if (!clip || !(await ensureAnimations())) return;
  sampler = new ClipSampler(clip);
  usePlayer.setState({ clip: clipId, time: 0, playing: true });
  show();
  run();
}

export function togglePlaying(): void {
  const { playing, clip } = usePlayer.getState();
  if (!clip) return;
  usePlayer.setState({ playing: !playing });
  if (!playing) run();
}

export function seek(time: number): void {
  usePlayer.setState({ time, playing: false });
  show();
}

export function setInPlace(inPlace: boolean): void {
  usePlayer.setState({ inPlace });
  show();
}

/** Puts every part back where the project has it. */
export function stopPreview(): void {
  cancelAnimationFrame(frame);
  sampler = null;
  usePlayer.setState({ clip: null, playing: false, time: 0 });
  activeViewport()?.setPose(null);
}

// A project change can move or delete the character: the pose follows, or goes away with it.
useEditor.subscribe((state, previous) => {
  if (state.snapshot?.revision === previous.snapshot?.revision || !sampler) return;
  if (!currentRig()) stopPreview();
  else show();
});
