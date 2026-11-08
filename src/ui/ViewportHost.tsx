import { useEffect, useRef } from "react";
import { useEditor } from "../core/store";
import type { Quat } from "../core/types";
import { EditorViewport } from "../viewport/EditorViewport";

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

  useEffect(() => {
    const viewport = new EditorViewport(containerRef.current!, {
      onPlace(block, { position, quaternion }) {
        const { dispatch, placementColor: color } = useEditor.getState();
        void dispatch({
          type: "addPart",
          block,
          position: position.toArray(),
          rotation: quaternion.toArray() as Quat,
          ...(color ? { color } : {}),
        });
      },
      onSelect: (id) => useEditor.getState().select(id),
      onTransformCommit(id, values) {
        void useEditor
          .getState()
          .dispatch({ type: "updatePart", id, ...values })
          .then((result) => {
            // A rejected change must not stay on screen.
            const current = useEditor.getState().snapshot;
            if (!result && current) viewport.setProject(current.project);
          });
      },
    });
    viewportRef.current = viewport;

    // Without this, a remount (StrictMode) would start empty until the next change.
    const current = useEditor.getState();
    if (current.snapshot) viewport.setProject(current.snapshot.project);
    return () => {
      viewportRef.current = null;
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
  useEffect(() => {
    if (focusRequest > 0) viewportRef.current?.focus();
  }, [focusRequest]);

  return <div className="viewport-canvas" ref={containerRef} />;
}
