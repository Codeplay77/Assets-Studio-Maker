import { useMemo } from "react";
import { Bot, Boxes, Triangle } from "lucide-react";
import { useEditor } from "../core/store";
import { countTriangles } from "../export/glb";

interface Hint {
  keys: string;
  text: string;
}

const CAMERA: Hint[] = [
  { keys: "Botão direito", text: "girar" },
  { keys: "Botão do meio", text: "arrastar" },
  { keys: "Roda", text: "zoom" },
];
const PLACING: Hint[] = [
  { keys: "Clique", text: "colocar" },
  { keys: "R", text: "girar" },
  { keys: "Esc", text: "terminar" },
];
const SELECTED: Hint[] = [
  { keys: "Clique duplo", text: "só a peça" },
  { keys: "Shift", text: "somar" },
  { keys: "Ctrl+D", text: "duplicar" },
  { keys: "Del", text: "apagar" },
];

const MODELING: Hint[] = [
  { keys: "Clique", text: "selecionar" },
  { keys: "Arrastar", text: "retângulo" },
  { keys: "Shift", text: "somar" },
  { keys: "1 2 3 4", text: "faces, arestas, pontos, esculpir" },
  { keys: "P", text: "puxar" },
  { keys: "B", text: "chanfrar" },
  { keys: "Tab", text: "concluir" },
];

const SCULPTING: Hint[] = [
  { keys: "Arrastar", text: "esculpir" },
  { keys: "Ctrl", text: "inverter" },
  { keys: "Shift", text: "alisar" },
  { keys: "[ ]", text: "tamanho" },
  { keys: "Tab", text: "concluir" },
];

function compact(value: number): string {
  return value >= 1000 ? `${(value / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : String(value);
}

export function StatusBar() {
  const placing = useEditor((state) => state.placingBlock !== null);
  const hasSelection = useEditor((state) => state.selection.length > 0);
  const parts = useEditor((state) => state.snapshot?.project.parts);
  const agentRunning = useEditor((state) => state.agentStatus?.running ?? false);
  const agentActivity = useEditor((state) => state.agentActivity);
  const modeling = useEditor((state) => state.modeling !== null);
  const sculpting = useEditor((state) => state.meshMode === "sculpt");
  const hints = modeling ? (sculpting ? SCULPTING : MODELING) : placing ? PLACING : hasSelection ? SELECTED : CAMERA;
  const count = parts?.length ?? 0;
  const triangles = useMemo(() => countTriangles(parts ?? []), [parts]);

  return (
    <footer className="statusbar glass">
      {hints.map(({ keys, text }) => (
        <span key={keys} className="hint">
          <kbd>{keys}</kbd> {text}
        </span>
      ))}
      <i className="divider" />
      {agentRunning && (
        <span className={`hint count agent-status ${agentActivity ? "busy" : ""}`}>
          <Bot size={13} /> {agentActivity ? `${agentActivity}…` : "Agente ligado"}
        </span>
      )}
      <span className="hint count">
        <Boxes size={13} /> {count === 1 ? "1 peça" : `${count} peças`}
      </span>
      <span className="hint count" title="Triângulos na cena">
        <Triangle size={12} /> {compact(triangles)}
      </span>
    </footer>
  );
}
