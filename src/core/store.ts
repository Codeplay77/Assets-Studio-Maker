import { create } from "zustand";
import * as api from "./api";
import type { Command, EditorSnapshot, Part, PartId, Tool } from "./types";

interface EditorStore {
  snapshot: EditorSnapshot | null;
  selection: PartId | null;
  placingBlock: string | null;
  placementColor: string | null;
  placementYaw: number;
  tool: Tool;
  error: string | null;
  focusRequest: number;
  /** Frames the model as soon as the next snapshot arrives. */
  focusOnNextSnapshot: boolean;

  receiveSnapshot(snapshot: EditorSnapshot): void;
  dispatch(command: Command): Promise<PartId[] | null>;
  select(id: PartId | null): void;
  startPlacing(block: string): void;
  stopPlacing(): void;
  setPlacementColor(color: string | null): void;
  rotatePlacement(): void;
  setTool(tool: Tool): void;
  requestFocus(): void;
  setFocusOnNextSnapshot(value: boolean): void;
  undo(): void;
  redo(): void;
  clearError(): void;
}

export const useEditor = create<EditorStore>((set, get) => {
  const report = (error: unknown) => set({ error: String(error) });

  return {
    snapshot: null,
    selection: null,
    placingBlock: null,
    placementColor: null,
    placementYaw: 0,
    tool: "translate",
    error: null,
    focusRequest: 0,
    focusOnNextSnapshot: false,

    // Events and the initial fetch can arrive out of order; the revision settles it.
    receiveSnapshot(snapshot) {
      const { snapshot: current, selection, focusOnNextSnapshot, focusRequest } = get();
      if (current && snapshot.revision < current.revision) return;
      const stillExists = snapshot.project.parts.some((part) => part.id === selection);
      set({
        snapshot,
        selection: stillExists ? selection : null,
        focusOnNextSnapshot: false,
        focusRequest: focusOnNextSnapshot ? focusRequest + 1 : focusRequest,
      });
    },

    async dispatch(command) {
      try {
        const ids = await api.applyCommand(command);
        set({ error: null });
        return ids;
      } catch (error) {
        report(error);
        return null;
      }
    },

    select: (selection) => set({ selection }),
    startPlacing: (placingBlock) => set({ placingBlock, selection: null }),
    stopPlacing: () => set({ placingBlock: null }),
    setPlacementColor: (placementColor) => set({ placementColor }),
    rotatePlacement: () => set((state) => ({ placementYaw: (state.placementYaw + 1) % 4 })),
    setTool: (tool) => set({ tool }),
    requestFocus: () => set((state) => ({ focusRequest: state.focusRequest + 1 })),
    setFocusOnNextSnapshot: (focusOnNextSnapshot) => set({ focusOnNextSnapshot }),
    undo: () => void api.undo().catch(report),
    redo: () => void api.redo().catch(report),
    clearError: () => set({ error: null }),
  };
});

export function selectedPart(state: EditorStore): Part | null {
  if (state.selection === null) return null;
  return state.snapshot?.project.parts.find((part) => part.id === state.selection) ?? null;
}
