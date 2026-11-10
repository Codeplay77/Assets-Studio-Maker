import {
  Building2,
  Car,
  House,
  Landmark,
  Lock,
  Mountain,
  Sofa,
  TreePine,
  User,
  type LucideIcon,
} from "lucide-react";
import { ART_STYLES, styleName } from "../blocks/styles";
import { useEditor } from "../core/store";
import { generators } from "../generators";
import { buildFromPanel, useLockedStyle } from "./generate";

export const GENERATOR_LOOKS: Record<string, { icon: LucideIcon; hint: string; hue: number }> = {
  person: { icon: User, hint: "Adultos e crianças", hue: 262 },
  car: { icon: Car, hint: "Carros, karts, motos, ônibus", hue: 205 },
  building: { icon: Building2, hint: "Lojas e torres", hue: 232 },
  house: { icon: House, hint: "Casas de bairro", hue: 26 },
  interior: { icon: Sofa, hint: "Casas, lojas e escritórios por dentro", hue: 330 },
  tree: { icon: TreePine, hint: "Árvores variadas", hue: 142 },
  city: { icon: Landmark, hint: "Quarteirões inteiros", hue: 186 },
  map: { icon: Mountain, hint: "Florestas, montanhas e rios", hue: 110 },
};

export function GeneratorPanel() {
  const open = useEditor((state) => state.generatorOpen);
  const openGenerator = useEditor((state) => state.openGenerator);
  const artStyle = useEditor((state) => state.artStyle);
  const setArtStyle = useEditor((state) => state.setArtStyle);
  const locked = useLockedStyle();
  const active = locked ?? artStyle;

  return (
    <div className="dock-body">
      <div className="section-head">
        <span className="section-step">01 / DIREÇÃO DE ARTE</span>
        <h2>Escolha seu estilo</h2>
        <p>{ART_STYLES.find(({ id }) => id === active)?.hint}. Tudo o que você gerar segue este estilo.</p>
      </div>

      <div className="style-picker" role="radiogroup" aria-label="Estilo dos modelos">
        {ART_STYLES.map(({ id, name }) => (
          <button
            key={id}
            role="radio"
            aria-checked={active === id}
            className={active === id ? "active" : ""}
            disabled={locked !== null && locked !== id}
            onClick={() => {
              setArtStyle(id);
              if (useEditor.getState().generatorLive) void buildFromPanel();
            }}
          >
            {name}
          </button>
        ))}
      </div>
      {locked && (
        <p className="style-lock">
          <Lock size={12} /> A cena já está em {styleName(locked)}. Para trocar, desligue “Manter o que já está na cena”.
        </p>
      )}

      <div className="section-head">
        <span className="section-step">02 / HORA DE CRIAR</span>
        <h2>O que vamos construir?</h2>
        <p>Escolha um tipo e ajuste as opções no painel da direita.</p>
      </div>

      <div className="generator-grid asset-generators">
        {generators.map(({ id, name }) => {
          const { icon: Icon, hint, hue } = GENERATOR_LOOKS[id];
          return (
            <button
              key={id}
              className={`generator-card ${open === id ? "selected" : ""}`}
              aria-pressed={open === id}
              style={{ "--hue": hue } as React.CSSProperties}
              onClick={() => openGenerator(id)}
            >
              <span className="generator-icon">
                <Icon size={19} strokeWidth={2} />
              </span>
              <strong>{name}</strong>
              <small>{hint}</small>
            </button>
          );
        })}
      </div>
    </div>
  );
}
