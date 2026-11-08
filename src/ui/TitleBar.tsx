import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Copy,
  Focus,
  Minus,
  Move3d,
  Redo2,
  Rotate3d,
  Scale3d,
  Square,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEditor } from "../core/store";
import type { Tool } from "../core/types";

const TOOLS: { id: Tool; label: string; key: string; icon: LucideIcon }[] = [
  { id: "translate", label: "Mover", key: "W", icon: Move3d },
  { id: "rotate", label: "Girar", key: "E", icon: Rotate3d },
  { id: "scale", label: "Esticar", key: "T", icon: Scale3d },
];

function WindowControls() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    const appWindow = getCurrentWindow();
    const refresh = () => void appWindow.isMaximized().then(setMaximized);
    refresh();
    const subscription = appWindow.onResized(refresh);
    return () => void subscription.then((unlisten) => unlisten());
  }, []);

  const appWindow = getCurrentWindow();
  return (
    <div className="window-controls">
      <button onClick={() => void appWindow.minimize()} aria-label="Minimizar">
        <Minus size={15} />
      </button>
      <button onClick={() => void appWindow.toggleMaximize()} aria-label={maximized ? "Restaurar" : "Maximizar"}>
        {maximized ? <Copy size={12} /> : <Square size={12} />}
      </button>
      <button className="close" onClick={() => void appWindow.close()} aria-label="Fechar">
        <X size={16} />
      </button>
    </div>
  );
}

export function TitleBar() {
  const tool = useEditor((state) => state.tool);
  const setTool = useEditor((state) => state.setTool);
  const canUndo = useEditor((state) => state.snapshot?.canUndo ?? false);
  const canRedo = useEditor((state) => state.snapshot?.canRedo ?? false);
  const undo = useEditor((state) => state.undo);
  const redo = useEditor((state) => state.redo);
  const requestFocus = useEditor((state) => state.requestFocus);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="brand" data-tauri-drag-region>
        <span className="brand-mark" aria-hidden />
        <span data-tauri-drag-region>
          Assets <b>Studio</b> Maker
        </span>
      </div>

      <div className="toolbar glass">
        {TOOLS.map(({ id, label, key, icon: Icon }) => (
          <button
            key={id}
            className={`tool ${tool === id ? "active" : ""}`}
            onClick={() => setTool(id)}
            title={`${label} (${key})`}
          >
            <Icon size={17} strokeWidth={1.9} />
            <span>{label}</span>
          </button>
        ))}
        <i className="divider" />
        <button className="tool square" onClick={undo} disabled={!canUndo} title="Desfazer (Ctrl+Z)" aria-label="Desfazer">
          <Undo2 size={17} strokeWidth={1.9} />
        </button>
        <button className="tool square" onClick={redo} disabled={!canRedo} title="Refazer (Ctrl+Y)" aria-label="Refazer">
          <Redo2 size={17} strokeWidth={1.9} />
        </button>
        <i className="divider" />
        <button className="tool square" onClick={requestFocus} title="Enquadrar (F)" aria-label="Enquadrar">
          <Focus size={17} strokeWidth={1.9} />
        </button>
      </div>

      <WindowControls />
    </header>
  );
}
