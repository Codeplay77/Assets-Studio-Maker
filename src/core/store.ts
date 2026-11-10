import { useMemo } from "react";
import { create } from "zustand";
import { syncCustomBlocks } from "../blocks/catalog";
import { DEFAULT_STYLE, type ArtStyle } from "../blocks/styles";
import type { BrushKind } from "../modeling/sculpt";
import * as api from "./api";
import type { AgentStatus, Command, CustomShape, EditorSnapshot, Part, PartId, PickMode, Tool } from "./types";

export type { AgentStatus };
export type MeshMode = "face" | "edge" | "vertex" | "sculpt";
export type HoleShape = "round" | "square";
export type MeshBox = { faces: number[] } | { vertices: number[] };

/** The part whose shape is being edited polygon by polygon. */
export interface ModelingTarget {
  partId: PartId;
  shapeId: string;
}

export type MeshPick = { face: number } | { vertex: number } | { edge: [number, number] };

/** The choice offered when an action would throw away unsaved work. */
export interface UnsavedPrompt {
  next(): void;
}

interface EditorStore {
  snapshot: EditorSnapshot | null;
  selection: PartId[];
  placingBlock: string | null;
  placementColor: string | null;
  placementYaw: number;
  tool: Tool;
  snap: boolean;
  error: string | null;
  notice: string | null;
  focusRequest: number;
  /** Frames the model as soon as the next snapshot arrives. */
  focusOnNextSnapshot: boolean;
  exportOpen: boolean;
  unsavedPrompt: UnsavedPrompt | null;
  agentOpen: boolean;
  agentStatus: AgentStatus | null;
  /** What the agent is doing right now, shown in the status bar. */
  agentActivity: string | null;
  modeling: ModelingTarget | null;
  meshMode: MeshMode;
  meshFaces: number[];
  meshVertices: number[];
  /** How far around the selection a move reaches, fading out. Zero moves only the selection. */
  softRadius: number;
  pullDistance: number;
  insetAmount: number;
  bevelAmount: number;
  bevelSegments: number;
  holeShape: HoleShape;
  holeSize: number;
  /** Zero goes all the way through. */
  holeDepth: number;
  brushKind: BrushKind;
  brushRadius: number;
  brushStrength: number;
  brushSymmetry: boolean;
  /** The style everything generated in this session follows. */
  artStyle: ArtStyle;
  /** The generator whose options are open on the right. */
  generatorOpen: string | null;
  generatorSeed: number;
  /** True once the panel built a model, so changing an option updates that model. */
  generatorLive: boolean;
  generatorKeep: boolean;
  /** For each generator, the choice made for each option. */
  generatorChoices: Record<string, Record<string, string>>;

  receiveSnapshot(snapshot: EditorSnapshot): void;
  dispatch(command: Command): Promise<PartId[] | null>;
  select(ids: PartId[]): void;
  pick(id: PartId | null, mode: PickMode): void;
  startPlacing(block: string): void;
  stopPlacing(): void;
  setPlacementColor(color: string | null): void;
  rotatePlacement(): void;
  setTool(tool: Tool): void;
  toggleSnap(): void;
  requestFocus(): void;
  setFocusOnNextSnapshot(value: boolean): void;
  undo(): void;
  redo(): void;
  report(error: unknown): void;
  setNotice(notice: string | null): void;
  clearError(): void;
  setExportOpen(open: boolean): void;
  setUnsavedPrompt(prompt: UnsavedPrompt | null): void;
  setAgentOpen(open: boolean): void;
  setAgentStatus(status: AgentStatus): void;
  setAgentActivity(activity: string | null): void;
  enterModeling(partId: PartId): void;
  exitModeling(): void;
  setMeshMode(mode: MeshMode): void;
  setMeshSelection(faces: number[], vertices: number[]): void;
  pickMesh(hit: MeshPick | null, additive: boolean): void;
  setSoftRadius(radius: number): void;
  setPullDistance(distance: number): void;
  setInsetAmount(amount: number): void;
  setBevelAmount(amount: number): void;
  setBevelSegments(segments: number): void;
  setHoleShape(shape: HoleShape): void;
  setHoleSize(size: number): void;
  setHoleDepth(depth: number): void;
  setBrushKind(kind: BrushKind): void;
  setBrushRadius(radius: number): void;
  setBrushStrength(strength: number): void;
  setBrushSymmetry(symmetry: boolean): void;
  selectMeshBox(box: MeshBox, additive: boolean): void;
  setArtStyle(style: ArtStyle): void;
  openGenerator(id: string): void;
  closeGenerator(): void;
  setGeneratorSeed(seed: number): void;
  setGeneratorLive(live: boolean): void;
  setGeneratorKeep(keep: boolean): void;
  setGeneratorChoice(generator: string, option: string, choice: string): void;
}

const MIN_BRUSH_RADIUS = 0.02;
const MAX_BRUSH_RADIUS = 3;

function toggled(selection: number[], ids: number[]): number[] {
  const allChosen = ids.every((id) => selection.includes(id));
  return allChosen ? selection.filter((id) => !ids.includes(id)) : [...new Set([...selection, ...ids])];
}

function sameList(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function verticesOfFaces(shape: CustomShape, faces: number[]): number[] {
  return [...new Set(faces.flatMap((id) => shape.faces[id] ?? []))];
}

function facesOfVertices(shape: CustomShape, vertices: number[]): number[] {
  const chosen = new Set(vertices);
  return shape.faces.flatMap((face, id) => (face.every((vertex) => chosen.has(vertex)) ? [id] : []));
}

export const useEditor = create<EditorStore>((set, get) => {
  const report = (error: unknown) => set({ error: String(error), notice: null });

  return {
    snapshot: null,
    selection: [],
    placingBlock: null,
    placementColor: null,
    placementYaw: 0,
    tool: "translate",
    snap: true,
    error: null,
    notice: null,
    focusRequest: 0,
    focusOnNextSnapshot: false,
    exportOpen: false,
    unsavedPrompt: null,
    agentOpen: false,
    agentStatus: null,
    agentActivity: null,
    modeling: null,
    meshMode: "face",
    meshFaces: [],
    meshVertices: [],
    softRadius: 0,
    pullDistance: 0.25,
    insetAmount: 0.05,
    bevelAmount: 0.05,
    bevelSegments: 1,
    holeShape: "round",
    holeSize: 0.3,
    holeDepth: 0,
    brushKind: "raise",
    brushRadius: 0.3,
    brushStrength: 0.5,
    brushSymmetry: false,
    artStyle: DEFAULT_STYLE,
    generatorOpen: null,
    generatorSeed: 1,
    generatorLive: false,
    generatorKeep: false,
    generatorChoices: {},

    // Events and the initial fetch can arrive out of order; the revision settles it.
    receiveSnapshot(snapshot) {
      const { snapshot: current, selection, focusOnNextSnapshot, focusRequest } = get();
      if (current && snapshot.revision < current.revision) return;
      syncCustomBlocks(snapshot.project.shapes, snapshot.revision);
      const existing = new Set(snapshot.project.parts.map((part) => part.id));
      const kept = selection.filter((id) => existing.has(id));

      // Undo or an agent can remove what is being edited.
      const { modeling, meshFaces, meshVertices } = get();
      const shape = modeling && snapshot.project.shapes.find((candidate) => candidate.id === modeling.shapeId);
      const stillThere = shape && existing.has(modeling.partId);
      const faces = stillThere ? meshFaces.filter((id) => id < shape.faces.length) : [];
      const vertices = stillThere ? meshVertices.filter((id) => id < shape.vertices.length) : [];

      set({
        snapshot,
        selection: kept.length === selection.length ? selection : kept,
        modeling: stillThere ? modeling : null,
        meshFaces: sameList(faces, meshFaces) ? meshFaces : faces,
        meshVertices: sameList(vertices, meshVertices) ? meshVertices : vertices,
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

    pick(id, mode) {
      if (id === null) {
        if (mode !== "toggle") set({ selection: [] });
        return;
      }
      const parts = get().snapshot?.project.parts ?? [];
      const part = parts.find((candidate) => candidate.id === id);
      if (!part) return;

      const members =
        mode === "single" || part.group === undefined
          ? [id]
          : parts.filter((candidate) => candidate.group === part.group).map((candidate) => candidate.id);
      if (mode !== "toggle") {
        set({ selection: members });
        return;
      }
      const { selection } = get();
      const allSelected = members.every((member) => selection.includes(member));
      set({
        selection: allSelected
          ? selection.filter((member) => !members.includes(member))
          : [...new Set([...selection, ...members])],
      });
    },

    startPlacing: (placingBlock) => set({ placingBlock, selection: [], modeling: null }),
    stopPlacing: () => set({ placingBlock: null }),
    setPlacementColor: (placementColor) => set({ placementColor }),
    rotatePlacement: () => set((state) => ({ placementYaw: (state.placementYaw + 1) % 4 })),
    setTool: (tool) => set({ tool }),
    toggleSnap: () => set((state) => ({ snap: !state.snap })),
    requestFocus: () => set((state) => ({ focusRequest: state.focusRequest + 1 })),
    setFocusOnNextSnapshot: (focusOnNextSnapshot) => set({ focusOnNextSnapshot }),
    undo: () => void api.undo().catch(report),
    redo: () => void api.redo().catch(report),
    report,
    setNotice: (notice) => set({ notice, error: null }),
    clearError: () => set({ error: null, notice: null }),
    setExportOpen: (exportOpen) => set({ exportOpen }),
    setUnsavedPrompt: (unsavedPrompt) => set({ unsavedPrompt }),
    setAgentOpen: (agentOpen) => set({ agentOpen }),
    setAgentStatus: (agentStatus) => set({ agentStatus }),
    setAgentActivity: (agentActivity) => set({ agentActivity }),

    enterModeling(partId) {
      const part = get().snapshot?.project.parts.find((candidate) => candidate.id === partId);
      if (!part) return;
      set({
        modeling: { partId, shapeId: part.block },
        selection: [partId],
        placingBlock: null,
        meshFaces: [],
        meshVertices: [],
      });
    },

    exitModeling: () => set({ modeling: null, meshFaces: [], meshVertices: [] }),

    /** Carries the selection over, so switching what you pick doesn't lose your place. */
    setMeshMode(mode) {
      const { meshMode, meshFaces, meshVertices, modeling, snapshot } = get();
      if (mode === meshMode) return;
      const shape = snapshot?.project.shapes.find((candidate) => candidate.id === modeling?.shapeId);
      if (!shape) {
        set({ meshMode: mode });
      } else if (mode === "sculpt" || meshMode === "sculpt") {
        // The brush paints on the surface, so there is nothing selected to carry over.
        set({ meshMode: mode, meshFaces: [], meshVertices: [] });
      } else if (mode === "face") {
        set({ meshMode: mode, meshFaces: facesOfVertices(shape, meshVertices), meshVertices: [] });
      } else if (meshMode === "face") {
        set({ meshMode: mode, meshFaces: [], meshVertices: verticesOfFaces(shape, meshFaces) });
      } else {
        set({ meshMode: mode });
      }
    },

    setMeshSelection: (meshFaces, meshVertices) => set({ meshFaces, meshVertices }),

    pickMesh(hit, additive) {
      const { meshFaces, meshVertices } = get();
      if (hit === null) {
        if (!additive) set({ meshFaces: [], meshVertices: [] });
      } else if ("face" in hit) {
        set({ meshFaces: additive ? toggled(meshFaces, [hit.face]) : [hit.face], meshVertices: [] });
      } else {
        const ids = "vertex" in hit ? [hit.vertex] : hit.edge;
        set({ meshVertices: additive ? toggled(meshVertices, ids) : ids, meshFaces: [] });
      }
    },

    setSoftRadius: (softRadius) => set({ softRadius }),
    setPullDistance: (pullDistance) => set({ pullDistance }),
    setInsetAmount: (insetAmount) => set({ insetAmount }),
    setBevelAmount: (bevelAmount) => set({ bevelAmount }),
    setBevelSegments: (bevelSegments) => set({ bevelSegments }),
    setHoleShape: (holeShape) => set({ holeShape }),
    setHoleSize: (holeSize) => set({ holeSize }),
    setHoleDepth: (holeDepth) => set({ holeDepth }),
    setBrushKind: (brushKind) => set({ brushKind }),
    setBrushRadius: (brushRadius) =>
      set({ brushRadius: Math.min(MAX_BRUSH_RADIUS, Math.max(MIN_BRUSH_RADIUS, brushRadius)) }),
    setBrushStrength: (brushStrength) => set({ brushStrength }),
    setBrushSymmetry: (brushSymmetry) => set({ brushSymmetry }),

    setArtStyle: (artStyle) => set({ artStyle }),
    openGenerator: (generatorOpen) =>
      set((state) => ({
        generatorOpen,
        generatorLive: state.generatorOpen === generatorOpen && state.generatorLive,
        selection: [],
        placingBlock: null,
      })),
    closeGenerator: () => set({ generatorOpen: null, generatorLive: false }),
    setGeneratorSeed: (generatorSeed) => set({ generatorSeed }),
    setGeneratorLive: (generatorLive) => set({ generatorLive }),
    setGeneratorKeep: (generatorKeep) => set({ generatorKeep }),
    setGeneratorChoice: (generator, option, choice) =>
      set((state) => ({
        generatorChoices: {
          ...state.generatorChoices,
          [generator]: { ...state.generatorChoices[generator], [option]: choice },
        },
      })),

    selectMeshBox(box, additive) {
      const { meshFaces, meshVertices } = get();
      if ("faces" in box) {
        set({ meshFaces: additive ? [...new Set([...meshFaces, ...box.faces])] : box.faces, meshVertices: [] });
      } else {
        set({ meshVertices: additive ? [...new Set([...meshVertices, ...box.vertices])] : box.vertices, meshFaces: [] });
      }
    },
  };
});

export function useSelectedParts(): Part[] {
  const parts = useEditor((state) => state.snapshot?.project.parts);
  const selection = useEditor((state) => state.selection);
  return useMemo(() => {
    const chosen = new Set(selection);
    return (parts ?? []).filter((part) => chosen.has(part.id));
  }, [parts, selection]);
}
