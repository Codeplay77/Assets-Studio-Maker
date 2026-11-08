import { useState } from "react";
import { Library, Puzzle, Sparkles, type LucideIcon } from "lucide-react";
import { BlockBrowser } from "./BlockBrowser";
import { GeneratorPanel } from "./GeneratorPanel";

type Tab = "create" | "library" | "parts";

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: "create", label: "Criar", icon: Sparkles },
  { id: "library", label: "Biblioteca", icon: Library },
  { id: "parts", label: "Peças", icon: Puzzle },
];

export function Dock() {
  const [tab, setTab] = useState<Tab>("create");

  return (
    <aside className="dock glass">
      <nav className="segmented">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}>
            <Icon size={15} strokeWidth={2} />
            {label}
          </button>
        ))}
      </nav>
      {tab === "create" && <GeneratorPanel />}
      {tab === "library" && <BlockBrowser key="library" group="library" />}
      {tab === "parts" && <BlockBrowser key="parts" group="parts" />}
    </aside>
  );
}
