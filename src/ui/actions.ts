import { getBlock, type BlockDef } from "../blocks/catalog";
import { buildGeometry } from "../blocks/geometry";
import * as api from "../core/api";
import { useEditor } from "../core/store";
import type { Part, Vec3 } from "../core/types";
import { exportGlb, type ExportOptions } from "../export/glb";

const DUPLICATE_OFFSET: Vec3 = [0.25, 0, 0.25];
const KEEP_MARGIN = 1;

const blockRadii = new WeakMap<BlockDef, number>();

/** How far a part reaches from its origin, to place new models without overlapping. */
export function partReach(block: string, scale: Vec3): number {
  const def = getBlock(block);
  let radius = blockRadii.get(def);
  if (radius === undefined) {
    const geometry = buildGeometry(def.shape);
    radius = geometry.boundingSphere!.center.length() + geometry.boundingSphere!.radius;
    geometry.dispose();
    blockRadii.set(def, radius);
  }
  return radius * Math.max(...scale);
}

function selectedParts(): Part[] {
  const { selection, snapshot } = useEditor.getState();
  const chosen = new Set(selection);
  return (snapshot?.project.parts ?? []).filter((part) => chosen.has(part.id));
}

export async function removeSelection(): Promise<void> {
  const { selection, dispatch } = useEditor.getState();
  if (selection.length > 0) await dispatch({ type: "removeParts", ids: selection });
}

export async function duplicateSelection(): Promise<void> {
  const { selection, dispatch, select } = useEditor.getState();
  if (selection.length === 0) return;

  const parts = selectedParts();
  // A copy of a whole model goes beside it instead of overlapping the original.
  const offset: Vec3 =
    parts.length === 1
      ? DUPLICATE_OFFSET
      : [
          Math.max(...parts.map((part) => part.position[0] + partReach(part.block, part.scale))) -
            Math.min(...parts.map((part) => part.position[0] - partReach(part.block, part.scale))),
          0,
          0,
        ];
  const created = await dispatch({ type: "duplicateParts", ids: selection, offset });
  if (created) select(created);
}

export async function setSelectionGrouped(grouped: boolean): Promise<void> {
  const { selection, dispatch } = useEditor.getState();
  if (selection.length > 0) await dispatch({ type: "setGrouped", ids: selection, grouped });
}

export function selectAll(): void {
  const { snapshot, select } = useEditor.getState();
  select((snapshot?.project.parts ?? []).map((part) => part.id));
}

export async function recolorSelection(color: string): Promise<void> {
  const { selection, dispatch } = useEditor.getState();
  await dispatch({ type: "updateParts", updates: selection.map((id) => ({ id, color })) });
}

/** An X position clear of everything in the scene, or the origin when it is empty. */
export function freeSpotBeside(): number {
  const parts = useEditor.getState().snapshot?.project.parts ?? [];
  if (parts.length === 0) return 0;
  return Math.max(...parts.map((part) => part.position[0] + partReach(part.block, part.scale))) + KEEP_MARGIN;
}

/** Runs `next` right away, or asks first if it would lose unsaved work. */
export function guardUnsaved(next: () => void): void {
  const { snapshot, setUnsavedPrompt } = useEditor.getState();
  if (snapshot?.dirty) setUnsavedPrompt({ next });
  else next();
}

export async function saveProject(saveAs = false): Promise<boolean> {
  const { report, setNotice } = useEditor.getState();
  try {
    const saved = await api.saveProject(saveAs);
    if (saved) setNotice("Projeto salvo.");
    return saved;
  } catch (error) {
    report(error);
    return false;
  }
}

export function openProject(): void {
  guardUnsaved(() => {
    const { report, select, setFocusOnNextSnapshot } = useEditor.getState();
    setFocusOnNextSnapshot(true);
    api
      .openProject()
      .then((opened) => {
        if (opened) select([]);
        else setFocusOnNextSnapshot(false);
      })
      .catch((error: unknown) => {
        setFocusOnNextSnapshot(false);
        report(error);
      });
  });
}

export function newProject(): void {
  guardUnsaved(() => {
    const { report, select } = useEditor.getState();
    select([]);
    api.newProject().catch(report);
  });
}

export async function exportParts(parts: Part[], options: ExportOptions): Promise<boolean> {
  const { report, setNotice } = useEditor.getState();
  try {
    const bytes = await exportGlb(parts, options);
    const path = await api.saveGlb(new Uint8Array(bytes));
    if (path) setNotice(`Exportado: ${path}`);
    return path !== null;
  } catch (error) {
    report(error);
    return false;
  }
}
