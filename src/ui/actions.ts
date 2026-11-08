import { getBlock } from "../blocks/catalog";
import { buildGeometry } from "../blocks/geometry";
import { useEditor } from "../core/store";
import type { Vec3 } from "../core/types";
import { runGenerator } from "../generators";

const DUPLICATE_OFFSET: Vec3 = [0.25, 0, 0.25];
const KEEP_MARGIN = 1;

const blockRadii = new Map<string, number>();

/** How far a part reaches from its origin, to place new models without overlapping. */
function partReach(block: string, scale: Vec3): number {
  let radius = blockRadii.get(block);
  if (radius === undefined) {
    const geometry = buildGeometry(getBlock(block).shape);
    radius = geometry.boundingSphere!.center.length() + geometry.boundingSphere!.radius;
    geometry.dispose();
    blockRadii.set(block, radius);
  }
  return radius * Math.max(...scale);
}

export async function removeSelection(): Promise<void> {
  const { selection, dispatch } = useEditor.getState();
  if (selection !== null) await dispatch({ type: "removeParts", ids: [selection] });
}

export async function duplicateSelection(): Promise<void> {
  const { selection, dispatch, select } = useEditor.getState();
  if (selection === null) return;
  const created = await dispatch({
    type: "duplicateParts",
    ids: [selection],
    offset: DUPLICATE_OFFSET,
  });
  if (created) select(created[0]);
}

/** Builds a random model. Unless `keep` is set, it replaces the scene (Ctrl+Z brings it back). */
export async function generate(id: string, seed: number, keep: boolean): Promise<void> {
  const editor = useEditor.getState();
  const parts = runGenerator(id, seed);

  const existing = editor.snapshot?.project.parts ?? [];
  if (keep && existing.length > 0) {
    const edge = Math.max(
      ...existing.map((part) => part.position[0] + partReach(part.block, part.scale)),
    );
    const start = Math.min(
      ...parts.map((part) => part.position[0] - partReach(part.block, part.scale)),
    );
    for (const part of parts) part.position[0] += edge - start + KEEP_MARGIN;
  }

  editor.select(null);
  editor.stopPlacing();
  editor.setFocusOnNextSnapshot(true);
  const created = await editor.dispatch({ type: "addParts", parts, replace: !keep });
  if (!created) editor.setFocusOnNextSnapshot(false);
}
