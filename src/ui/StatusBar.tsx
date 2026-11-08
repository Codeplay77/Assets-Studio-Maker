import { Boxes } from "lucide-react";
import { useEditor } from "../core/store";

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
  { keys: "Setas", text: "ajustar" },
  { keys: "Ctrl+D", text: "duplicar" },
  { keys: "Del", text: "apagar" },
];

export function StatusBar() {
  const placing = useEditor((state) => state.placingBlock !== null);
  const hasSelection = useEditor((state) => state.selection !== null);
  const count = useEditor((state) => state.snapshot?.project.parts.length ?? 0);
  const hints = placing ? PLACING : hasSelection ? SELECTED : CAMERA;

  return (
    <footer className="statusbar glass">
      {hints.map(({ keys, text }) => (
        <span key={keys} className="hint">
          <kbd>{keys}</kbd> {text}
        </span>
      ))}
      <i className="divider" />
      <span className="hint count">
        <Boxes size={13} /> {count === 1 ? "1 peça" : `${count} peças`}
      </span>
    </footer>
  );
}
