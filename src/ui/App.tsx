import { useEffect } from "react";
import { X } from "lucide-react";
import * as api from "../core/api";
import { useEditor } from "../core/store";
import { Dock } from "./Dock";
import { EmptyState } from "./EmptyState";
import { Inspector } from "./Inspector";
import { StatusBar } from "./StatusBar";
import { TitleBar } from "./TitleBar";
import { ViewportHost } from "./ViewportHost";
import { duplicateSelection, removeSelection } from "./actions";

function isTyping(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement) return true;
  return target instanceof HTMLInputElement && target.type !== "checkbox" && target.type !== "color";
}

function handleShortcut(event: KeyboardEvent): void {
  if (isTyping(event.target)) return;
  const editor = useEditor.getState();
  const key = event.key.toLowerCase();

  if (event.ctrlKey || event.metaKey) {
    if (key === "z") {
      event.preventDefault();
      if (event.shiftKey) editor.redo();
      else editor.undo();
    } else if (key === "y") {
      event.preventDefault();
      editor.redo();
    } else if (key === "d") {
      event.preventDefault();
      void duplicateSelection();
    }
    return;
  }

  switch (key) {
    case "escape":
      if (editor.placingBlock) editor.stopPlacing();
      else editor.select(null);
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
  }
}

export function App() {
  const error = useEditor((state) => state.error);
  const clearError = useEditor((state) => state.clearError);

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

  return (
    <div className="app">
      <ViewportHost />
      <TitleBar />
      <Dock />
      <Inspector />
      <EmptyState />
      <StatusBar />
      {error && (
        <div className="toast" role="alert">
          <span>{error}</span>
          <button className="icon-button" onClick={clearError} aria-label="Fechar aviso">
            <X size={15} />
          </button>
        </div>
      )}
    </div>
  );
}
