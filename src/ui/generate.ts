import { blocksStyle, DEFAULT_STYLE, type ArtStyle } from "../blocks/styles";
import { useEditor } from "../core/store";
import type { GeneratedShape, PartId, Vec3 } from "../core/types";
import { generateModel, settingsForStyle, type GeneratorSettings } from "../generators";
import { partReach } from "./actions";

const MAX_SEED = 999999;
const KEEP_MARGIN = 1;
/** Reframes the camera when a rebuilt model changes size by more than this. */
const REFRAME_RATIO = 1.15;

export const randomSeed = () => Math.floor(Math.random() * MAX_SEED) + 1;

/** The model the options panel is editing, and where its first part was when it was built. */
let live: { ids: PartId[]; origin: Vec3 } | null = null;

/** How far a mesh made for a model reaches from its center. */
function shapeReach(shape: GeneratedShape): number {
  return Math.max(...shape.vertices.map(([x, , z]) => Math.hypot(x, z)));
}

function liveIds(): PartId[] {
  if (!live) return [];
  const present = new Set((useEditor.getState().snapshot?.project.parts ?? []).map((part) => part.id));
  return live.ids.filter((id) => present.has(id));
}

function partsOutside(ids: readonly PartId[]) {
  const excluded = new Set(ids);
  return (useEditor.getState().snapshot?.project.parts ?? []).filter((part) => !excluded.has(part.id));
}

/** The style of everything in the scene except `ids`, or null when it does not have one. */
export function sceneStyle(ids: readonly PartId[] = []): ArtStyle | null {
  return blocksStyle(partsOutside(ids).map((part) => part.block));
}

/**
 * Builds a model. Unless `keep` is set, it replaces the scene (Ctrl+Z brings it back). Parts in
 * `replacing` go away in the same undo step, and a replacement stays where the old model was moved.
 * Resolves to the new parts, or null if it failed.
 */
export async function generate(
  id: string,
  seed: number,
  keep: boolean,
  settings?: GeneratorSettings,
  replacing: readonly PartId[] = [],
): Promise<PartId[] | null> {
  const editor = useEditor.getState();
  const { parts, shapes } = generateModel(id, seed, settings ?? { style: (keep ? sceneStyle() : null) ?? DEFAULT_STYLE, options: {} });

  const others = partsOutside(replacing);
  if (keep && others.length > 0) {
    const reach = (block: string, scale: Vec3) => (block.startsWith("@") ? shapeReach(shapes[Number(block.slice(1))]) * Math.max(...scale) : partReach(block, scale));
    const edge = Math.max(...others.map((part) => part.position[0] + partReach(part.block, part.scale)));
    const start = Math.min(...parts.map((part) => part.position[0] - reach(part.block, part.scale)));
    for (const part of parts) part.position[0] += edge - start + KEEP_MARGIN;
  }
  const origin: Vec3 = [...parts[0].position];

  if (live && replacing.length > 0) {
    const moved = editor.snapshot?.project.parts.find((part) => part.id === replacing[0]);
    if (moved) {
      const delta = moved.position.map((value, axis) => value - live!.origin[axis]);
      for (const part of parts) part.position = part.position.map((value, axis) => value + delta[axis]) as Vec3;
      origin.forEach((value, axis) => (origin[axis] = value + delta[axis]));
    }
  }

  editor.select([]);
  editor.stopPlacing();
  // Rebuilding keeps the camera where the person put it, unless the model no longer fits.
  const previous = (editor.snapshot?.project.parts ?? []).filter((part) => replacing.includes(part.id));
  const ratio = previous.length > 0 ? modelSize(parts) / modelSize(previous) : Infinity;
  if (replacing.length === 0 || ratio > REFRAME_RATIO || ratio < 1 / REFRAME_RATIO) editor.setFocusOnNextSnapshot(true);
  const created = await editor.dispatch({ type: "addParts", parts, shapes, replace: !keep, group: true, remove: [...replacing] });
  if (!created) editor.setFocusOnNextSnapshot(false);
  else live = { ids: created, origin };
  return created;
}

function modelSize(parts: readonly { position: Vec3 }[]): number {
  const spread = [0, 1, 2].map((axis) => {
    const values = parts.map((part) => part.position[axis]);
    return Math.max(...values) - Math.min(...values);
  });
  return Math.max(0.01, ...spread);
}

/** The style the scene forces on the panel, because models of two styles must not be mixed. */
export function lockedStyle(): ArtStyle | null {
  const { generatorKeep } = useEditor.getState();
  return generatorKeep ? sceneStyle(useEditor.getState().generatorLive ? liveIds() : []) : null;
}

export function useLockedStyle(): ArtStyle | null {
  useEditor((state) => state.snapshot?.revision);
  useEditor((state) => state.generatorKeep);
  useEditor((state) => state.generatorLive);
  return lockedStyle();
}

export const effectiveStyle = (): ArtStyle => lockedStyle() ?? useEditor.getState().artStyle;

export function panelSettings(id: string): GeneratorSettings {
  return settingsForStyle(id, effectiveStyle(), useEditor.getState().generatorChoices[id] ?? {});
}

/**
 * Builds or rebuilds the panel's model. Without `addAnother`, the model already made here is
 * replaced, so trying options never piles up copies.
 */
export async function buildFromPanel(request: { seed?: number; newSeed?: boolean; addAnother?: boolean } = {}): Promise<void> {
  const editor = useEditor.getState();
  const id = editor.generatorOpen;
  if (!id) return;

  const seed = request.seed ?? (request.newSeed ? randomSeed() : editor.generatorSeed);
  const keep = editor.generatorKeep || Boolean(request.addAnother);
  const replacing = editor.generatorLive && !request.addAnother ? liveIds() : [];
  const style = (request.addAnother ? sceneStyle() : null) ?? effectiveStyle();
  const settings = settingsForStyle(id, style, editor.generatorChoices[id] ?? {});

  editor.setGeneratorSeed(seed);
  try {
    const created = await generate(id, seed, keep, settings, replacing);
    if (created) editor.setGeneratorLive(true);
  } catch (error) {
    editor.report(error);
  }
}
