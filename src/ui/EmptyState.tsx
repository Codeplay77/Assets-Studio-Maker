import { ArrowRight, Box, Car, FolderOpen, Landmark, Play, User, type LucideIcon } from "lucide-react";
import { useEditor } from "../core/store";
import { openProject } from "./actions";
import { Brand } from "./Brand";

const QUICK: { id: string; label: string; hint: string; icon: LucideIcon }[] = [
  { id: "person", label: "Personagem", hint: "Dê vida às suas ideias", icon: User },
  { id: "car", label: "Veículo", hint: "Pronto para a próxima pista", icon: Car },
  { id: "city", label: "Cidade", hint: "Um mundo para explorar", icon: Landmark },
];

export function EmptyState() {
  const isEmpty = useEditor((state) => state.snapshot?.project.parts.length === 0);
  const placing = useEditor((state) => state.placingBlock !== null);
  const generatorOpen = useEditor((state) => state.generatorOpen !== null);
  const openGenerator = useEditor((state) => state.openGenerator);
  if (!isEmpty || placing || generatorOpen) return null;

  return (
    <>
      <div className="welcome-backdrop" aria-hidden="true" />
      <section className="empty-state" aria-labelledby="welcome-title">
        <div className="welcome-identity"><Brand symbolOnly /><span>PEQUENOS BLOCOS. GRANDES IDEIAS.</span></div>
        <h1 id="welcome-title">Seu próximo jogo<br />começa <em>aqui.</em></h1>
        <p>Crie, combine e anime assets 3D. Do primeiro bloco ao seu próprio universo, com ferramentas livres para criar.</p>
        <div className="welcome-capabilities">
          <span><Box size={14} /> Modelos prontos</span>
          <span><Play size={14} /> Animações incluídas</span>
          <span><span className="studio-indicator" /> 100% gratuito</span>
        </div>
        <div className="welcome-start"><span>ESCOLHA UM PONTO DE PARTIDA</span><span className="welcome-line" /></div>
        <div className="empty-actions">
          {QUICK.map(({ id, label, hint, icon: Icon }) => (
            <button key={id} className={`welcome-card welcome-${id}`} onClick={() => openGenerator(id)}>
              <span className="welcome-card-icon"><Icon size={24} strokeWidth={1.6} /></span>
              <strong>{label}<ArrowRight size={16} /></strong>
              <small>{hint}</small>
            </button>
          ))}
        </div>
        <button className="welcome-open" onClick={openProject}><FolderOpen size={15} />Continuar um projeto<kbd>Ctrl + O</kbd></button>
      </section>
    </>
  );
}
