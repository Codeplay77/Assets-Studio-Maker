import { useState } from "react";
import { Heart, Library, PencilRuler, PersonStanding, Puzzle, Sparkles, type LucideIcon } from "lucide-react";
import { AnimationPanel } from "./AnimationPanel";
import { BlockBrowser } from "./BlockBrowser";
import { GeneratorPanel } from "./GeneratorPanel";
import { ShapePanel } from "./ShapePanel";
import { useEditor } from "../core/store";

type Tab = "create" | "model" | "animate" | "library" | "parts";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "create", label: "Criar", icon: Sparkles },
  { id: "model", label: "Modelar", icon: PencilRuler },
  { id: "animate", label: "Animar", icon: PersonStanding },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "parts", label: "Peças", icon: Puzzle },
];

export function Dock() {
  const [tab, setTab] = useState<Tab>("create");
  const closeGenerator = useEditor((state) => state.closeGenerator);
  const changeTab = (next: Tab) => {
    if (next !== "create") closeGenerator();
    setTab(next);
  };

  return (
    <aside className="dock glass" aria-label="Painel de criação">
      <div className="dock-heading"><span>SEU ESTÚDIO CRIATIVO</span><span className="studio-indicator" /></div>
      <nav className="segmented" aria-label="Áreas do estúdio">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} aria-current={tab === id ? "page" : undefined} className={tab === id ? "active" : ""} onClick={() => changeTab(id)}>
            <Icon size={15} strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>
      {tab === "create" && <GeneratorPanel />}
      {tab === "model" && <ShapePanel />}
      {tab === "animate" && <AnimationPanel />}
      {tab === "library" && <BlockBrowser key="library" group="library" />}
      {tab === "parts" && <BlockBrowser key="parts" group="parts" />}
      <div className="dock-footer"><Heart size={13} /><span>Da comunidade para o seu próximo jogo.</span></div>
    </aside>
  );
}
