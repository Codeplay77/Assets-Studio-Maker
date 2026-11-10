import { Car, Landmark, Sparkles, User, type LucideIcon } from "lucide-react";
import { useEditor } from "../core/store";

const QUICK: { id: string; label: string; icon: LucideIcon }[] = [
  { id: "person", label: "Personagem", icon: User },
  { id: "car", label: "Veículo", icon: Car },
  { id: "city", label: "Cidade", icon: Landmark },
];

export function EmptyState() {
  const isEmpty = useEditor((state) => state.snapshot?.project.parts.length === 0);
  const placing = useEditor((state) => state.placingBlock !== null);
  const openGenerator = useEditor((state) => state.openGenerator);
  if (!isEmpty || placing) return null;

  return (
    <section className="empty-state">
      <span className="empty-mark">
        <Sparkles size={22} />
      </span>
      <h1>O que vamos criar hoje?</h1>
      <p>Comece por um modelo pronto e ajuste as opções, ou escolha peças na biblioteca e encaixe do seu jeito.</p>
      <div className="empty-actions">
        {QUICK.map(({ id, label, icon: Icon }) => (
          <button key={id} className="button primary" onClick={() => openGenerator(id)}>
            <Icon size={16} /> {label}
          </button>
        ))}
      </div>
    </section>
  );
}
