import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Bot,
  Copy,
  Download,
  FilePlus2,
  Focus,
  FolderOpen,
  Magnet,
  Minus,
  Move3d,
  Redo2,
  Rotate3d,
  Save,
  Scale3d,
  Square,
  Undo2,
  X,
  type LucideIcon,
} from "lucide-react";
import { useEditor } from "../core/store";
import type { Tool } from "../core/types";
import { newProject, openProject, saveProject } from "./actions";
import { Brand } from "./Brand";

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
  const snap = useEditor((state) => state.snap);
  const toggleSnap = useEditor((state) => state.toggleSnap);
  const projectName = useEditor((state) => state.snapshot?.project.name ?? "");
  const dirty = useEditor((state) => state.snapshot?.dirty ?? false);
  const partCount = useEditor((state) => state.snapshot?.project.parts.length ?? 0);
  const setExportOpen = useEditor((state) => state.setExportOpen);
  const setAgentOpen = useEditor((state) => state.setAgentOpen);
  const agentRunning = useEditor((state) => state.agentStatus?.running ?? false);

  return (
    <header className="titlebar" data-tauri-drag-region>
      <div className="titlebar-left" data-tauri-drag-region>
        <Brand />
        <i className="divider brand-divider" />
        <div className="file-actions">
          <button className="tool square" onClick={newProject} title="Novo (Ctrl+N)" aria-label="Novo projeto">
            <FilePlus2 size={16} strokeWidth={1.9} />
          </button>
          <button className="tool square" onClick={openProject} title="Abrir (Ctrl+O)" aria-label="Abrir projeto">
            <FolderOpen size={16} strokeWidth={1.9} />
          </button>
          <button className="tool square" onClick={() => void saveProject()} title="Salvar (Ctrl+S)" aria-label="Salvar projeto">
            <Save size={16} strokeWidth={1.9} />
          </button>
        </div>
        <span className="project-name" data-tauri-drag-region title={projectName}>
          {projectName}
          {dirty && <i className="dirty-dot" title="Alterações não salvas" />}
        </span>
      </div>

      <div className="toolbar glass" role="group" aria-label="Ferramentas da cena">
        {TOOLS.map(({ id, label, key, icon: Icon }) => (
          <button
            key={id}
            className={`tool ${tool === id ? "active" : ""}`}
            onClick={() => setTool(id)}
            title={`${label} (${key})`}
            aria-label={label}
            aria-pressed={tool === id}
          >
            <Icon size={17} strokeWidth={1.9} />
            <span>{label}</span><kbd>{key}</kbd>
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
        <button
          className={`tool square ${snap ? "on" : ""}`}
          onClick={toggleSnap}
          title={snap ? "Alinhar à grade: ligado" : "Alinhar à grade: desligado"}
          aria-label="Alinhar à grade"
          aria-pressed={snap}
        >
          <Magnet size={17} strokeWidth={1.9} />
        </button>
        <button className="tool square" onClick={requestFocus} title="Enquadrar (F)" aria-label="Enquadrar">
          <Focus size={17} strokeWidth={1.9} />
        </button>
      </div>

      <div className="titlebar-right" data-tauri-drag-region>
        <span className="community-badge">Gratuito e open source</span>
        <button
          className={`tool square agent-button ${agentRunning ? "on" : ""}`}
          onClick={() => setAgentOpen(true)}
          title={agentRunning ? "Agente de IA: ligado" : "Agente de IA"}
          aria-label="Agente de IA"
        >
          <Bot size={17} strokeWidth={1.9} />
        </button>
        <button
          className="button primary export-button"
          onClick={() => setExportOpen(true)}
          disabled={partCount === 0}
          title="Exportar GLB (Ctrl+E)"
        >
          <Download size={15} /> Exportar
        </button>
        <WindowControls />
      </div>
    </header>
  );
}
