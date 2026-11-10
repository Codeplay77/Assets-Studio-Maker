import { layersOf } from "../blocks/catalog";
import { useEffect, useRef } from "react";
import { useEditor } from "../core/store";
import type { Quat } from "../core/types";
import { setActiveViewport } from "../viewport/active";
import { EditorViewport } from "../viewport/EditorViewport";
import { commitVertices } from "./modeling";

export function ViewportHost() {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<EditorViewport | null>(null);

  const project = useEditor((state) => state.snapshot?.project);
  const selection = useEditor((state) => state.selection);
  const placingBlock = useEditor((state) => state.placingBlock);
  const placementColor = useEditor((state) => state.placementColor);
  const placementYaw = useEditor((state) => state.placementYaw);
  const tool = useEditor((state) => state.tool);
  const focusRequest = useEditor((state) => state.focusRequest);
  const snap = useEditor((state) => state.snap);
  const modeling = useEditor((state) => state.modeling);
  const meshMode = useEditor((state) => state.meshMode);
  const meshFaces = useEditor((state) => state.meshFaces);
  const meshVertices = useEditor((state) => state.meshVertices);
  const softRadius = useEditor((state) => state.softRadius);
  const brushKind = useEditor((state) => state.brushKind);
  const brushRadius = useEditor((state) => state.brushRadius);
  const brushStrength = useEditor((state) => state.brushStrength);
  const brushSymmetry = useEditor((state) => state.brushSymmetry);

  useEffect(() => {
    const viewport = new EditorViewport(containerRef.current!, {
      onPlace(block, { position, quaternion }) {
        const { dispatch, placementColor: color } = useEditor.getState();
        const where = { position: position.toArray(), rotation: quaternion.toArray() as Quat };
        const layers = layersOf(block);
        if (layers.length > 0) {
          void dispatch({
            type: "addParts",
            parts: [{ block, ...where, ...(color ? { color } : {}) }, ...layers.map((layer) => ({ block: layer, ...where }))],
            replace: false,
            group: true,
          });
          return;
        }
        void dispatch({ type: "addPart", block, ...where, ...(color ? { color } : {}) });
      },
      onPick: (id, mode) => useEditor.getState().pick(id, mode),
      onMeshPick: (hit, additive) => useEditor.getState().pickMesh(hit, additive),
      onMeshBox: (hit, additive) => useEditor.getState().selectMeshBox(hit, additive),
      onMeshTransform(vertices) {
        void commitVertices(vertices).then((saved) => {
          const current = useEditor.getState().snapshot;
          if (!saved && current) viewport.setProject(current.project);
        });
      },
      onTransformCommit(updates) {
        void useEditor
          .getState()
          .dispatch({ type: "updateParts", updates })
          .then((result) => {
            // A rejected change must not stay on screen.
            const current = useEditor.getState().snapshot;
            if (!result && current) viewport.setProject(current.project);
          });
      },
    });
    viewportRef.current = viewport;
    setActiveViewport(viewport);

    // Without this, a remount (StrictMode) would start empty until the next change.
    const current = useEditor.getState();
    if (current.snapshot) viewport.setProject(current.snapshot.project);
    return () => {
      viewportRef.current = null;
      setActiveViewport(null);
      viewport.dispose();
    };
  }, []);

  useEffect(() => {
    if (project) viewportRef.current?.setProject(project);
  }, [project]);
  useEffect(() => viewportRef.current?.setSelection(selection), [selection]);
  useEffect(
    () => viewportRef.current?.setPlacing(placingBlock, placementColor),
    [placingBlock, placementColor],
  );
  useEffect(() => viewportRef.current?.setYawSteps(placementYaw), [placementYaw]);
  useEffect(() => viewportRef.current?.setTool(tool), [tool]);
  useEffect(() => viewportRef.current?.setSnap(snap), [snap]);
  useEffect(() => {
    viewportRef.current?.setModeling(
      modeling,
      { mode: meshMode, faces: meshFaces, vertices: meshVertices },
      softRadius,
      { kind: brushKind, radius: brushRadius, strength: brushStrength, symmetry: brushSymmetry },
    );
  }, [modeling, meshMode, meshFaces, meshVertices, softRadius, project, brushKind, brushRadius, brushStrength, brushSymmetry]);
  // Runs after the effect above, so framing knows when a shape is being edited.
  useEffect(() => {
    if (focusRequest > 0) viewportRef.current?.focus();
  }, [focusRequest]);

  return <div className="viewport-canvas" ref={containerRef} />;
}
