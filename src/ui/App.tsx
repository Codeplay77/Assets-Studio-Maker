import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { CircleCheck, X } from "lucide-react";
import * as api from "../core/api";
import { useEditor } from "../core/store";
import { AgentDialog } from "./AgentDialog";
import { Dock } from "./Dock";
import { EmptyState } from "./EmptyState";
import { ExportDialog } from "./ExportDialog";
import { Inspector } from "./Inspector";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { UnsavedDialog } from "./UnsavedDialog";
import { ViewportHost } from "./ViewportHost";
import {
  duplicateSelection,
  newProject,
  openProject,
  removeSelection,
  saveProject,
  selectAll,
  setSelectionGrouped,
} from "./actions";
import { bevelSelected, deleteSelected, insetFaces, pullFaces, selectEverything, selectedFaces, startModeling } from "./modeling";

const NOTICE_MS = 5000;
const BRUSH_STEP = 1.2;

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "color", "range"].includes(target.type);
}

/** Returns true when the key belongs to polygon editing. */
function handleModelingKey(event: KeyboardEvent, key: string): boolean {
  const editor = useEditor.getState();
  if (!editor.modeling) return false;

  if (event.ctrlKey || event.metaKey) {
    if (key === "a") {
      event.preventDefault();
      selectEverything();
      return true;
    }
    return key === "d" || key === "g";
  }

  const hasSelection = editor.meshFaces.length > 0 || editor.meshVertices.length > 0;
  switch (key) {
    case "escape":
      if (hasSelection) editor.setMeshSelection([], []);
      else editor.exitModeling();
      return true;
    case "tab":
      event.preventDefault();
      editor.exitModeling();
      return true;
    case "1":
      editor.setMeshMode("face");
      return true;
    case "2":
      editor.setMeshMode("edge");
      return true;
    case "3":
      editor.setMeshMode("vertex");
      return true;
    case "4":
      editor.setMeshMode("sculpt");
      return true;
    case "b":
      if (editor.meshMode !== "sculpt") void bevelSelected();
      return true;
    case "[":
      editor.setBrushRadius(editor.brushRadius / BRUSH_STEP);
      return true;
    case "]":
      editor.setBrushRadius(editor.brushRadius * BRUSH_STEP);
      return true;
    case "p":
      if (selectedFaces().length > 0) void pullFaces(editor.pullDistance);
      return true;
    case "i":
      if (selectedFaces().length > 0) void insetFaces(editor.insetAmount);
      return true;
    case "delete":
    case "backspace":
      if (hasSelection) void deleteSelected();
      return true;
    default:
      return false;
  }
}

function handleCommandKey(event: KeyboardEvent, key: string): void {
  const editor = useEditor.getState();
  const actions: Record<string, () => void> = {
    z: () => (event.shiftKey ? editor.redo() : editor.undo()),
    y: () => editor.redo(),
    d: () => void duplicateSelection(),
    a: selectAll,
    g: () => void setSelectionGrouped(!event.shiftKey),
    s: () => void saveProject(event.shiftKey),
    o: openProject,
    n: newProject,
    e: () => editor.setExportOpen(true),
  };
  const action = actions[key];
  if (action) {
    event.preventDefault();
    action();
  }
}

function handleShortcut(event: KeyboardEvent): void {
  const editor = useEditor.getState();
  const key = event.key.toLowerCase();

  // Dialogs own the keyboard while open.
  if (editor.exportOpen || editor.unsavedPrompt || editor.agentOpen) {
    if (key === "escape") {
      editor.setExportOpen(false);
      editor.setUnsavedPrompt(null);
      editor.setAgentOpen(false);
    }
    return;
  }
  if (isTyping(event.target)) return;
  if (handleModelingKey(event, key)) return;

  if (event.ctrlKey || event.metaKey) {
    handleCommandKey(event, key);
    return;
  }

  switch (key) {
    case "escape":
      if (editor.placingBlock) editor.stopPlacing();
      else editor.select([]);
      break;
    case "delete":
    case "backspace":
      void removeSelection();
      break;
    case "r":
      if (editor.placingBlock) editor.rotatePlacement();
      break;
    case "w":
      editor.setTool("translate");
      break;
    case "e":
      editor.setTool("rotate");
      break;
    case "t":
      editor.setTool("scale");
      break;
    case "f":
      editor.requestFocus();
      break;
    case "tab": {
      const parts = editor.snapshot?.project.parts ?? [];
      const part = editor.selection.length === 1 ? parts.find((item) => item.id === editor.selection[0]) : undefined;
      if (part) {
        event.preventDefault();
        startModeling(part);
      }
      break;
    }
  }
}

export function App() {
  const error = useEditor((state) => state.error);
  const notice = useEditor((state) => state.notice);
  const clearError = useEditor((state) => state.clearError);
  const exportOpen = useEditor((state) => state.exportOpen);
  const agentOpen = useEditor((state) => state.agentOpen);
  const projectName = useEditor((state) => state.snapshot?.project.name);
  const dirty = useEditor((state) => state.snapshot?.dirty ?? false);

  useEffect(() => {
    const { receiveSnapshot } = useEditor.getState();
    const subscription = api.onStateChanged(receiveSnapshot);
    void api.getState().then(receiveSnapshot);
    return () => void subscription.then((unlisten) => unlisten());
  }, []);

  useEffect(() => {
    const preventMenu = (event: MouseEvent) => event.preventDefault();
    window.addEventListener("keydown", handleShortcut);
    window.addEventListener("contextmenu", preventMenu);
    return () => {
      window.removeEventListener("keydown", handleShortcut);
      window.removeEventListener("contextmenu", preventMenu);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(clearError, NOTICE_MS);
    return () => window.clearTimeout(timer);
  }, [notice, clearError]);

  useEffect(() => {
    if (projectName) document.title = `${dirty ? "• " : ""}${projectName} — Assets Studio Maker`;
  }, [projectName, dirty]);

  // Covers every way of closing, including Alt+F4 and the taskbar.
  useEffect(() => {
    const appWindow = getCurrentWindow();
    const subscription = appWindow.onCloseRequested((event) => {
      const { snapshot, setUnsavedPrompt } = useEditor.getState();
      if (snapshot?.dirty) {
        event.preventDefault();
        setUnsavedPrompt({ next: () => void appWindow.destroy() });
      }
    });
    return () => void subscription.then((unlisten) => unlisten());
  }, []);

  return (
    <div className="app">
      <ViewportHost />
      <TitleBar />
      <Dock />
      <Inspector />
      <EmptyState />
      <StatusBar />
      {exportOpen && <ExportDialog />}
      {agentOpen && <AgentDialog />}
      <UnsavedDialog />
      {(error || notice) && (
        <div className={`toast ${error ? "" : "success"}`} role={error ? "alert" : "status"}>
          {!error && <CircleCheck size={16} />}
          <span>{error ?? notice}</span>
          <button className="icon-button" onClick={clearError} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
