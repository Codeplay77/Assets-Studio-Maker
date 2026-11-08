import { useState } from "react";
import {
  Building2,
  Car,
  Dices,
  Flag,
  House,
  Landmark,
  RotateCcw,
  Smile,
  TreePine,
  User,
  type LucideIcon,
} from "lucide-react";
import { generators } from "../generators";
import { generate } from "./actions";

const MAX_SEED = 999999;
const randomSeed = () => Math.floor(Math.random() * MAX_SEED) + 1;

const LOOKS: Record<string, { icon: LucideIcon; hint: string; hue: number }> = {
  person: { icon: User, hint: "Corpo, rosto e roupas", hue: 262 },
  character: { icon: Smile, hint: "Personagem pronto", hue: 322 },
  car: { icon: Car, hint: "Carros e caminhões", hue: 205 },
  building: { icon: Building2, hint: "Lojas e torres", hue: 232 },
  house: { icon: House, hint: "Casas de bairro", hue: 26 },
  tree: { icon: TreePine, hint: "Árvores variadas", hue: 142 },
  city: { icon: Landmark, hint: "Quarteirões inteiros", hue: 186 },
  track: { icon: Flag, hint: "Circuito completo", hue: 354 },
};

export function GeneratorPanel() {
  const [lastId, setLastId] = useState<string | null>(null);
  const [seed, setSeed] = useState("");
  const [keep, setKeep] = useState(false);

  const roll = (id: string) => {
    const next = randomSeed();
    setLastId(id);
    setSeed(String(next));
    void generate(id, next, keep);
  };

  const parsedSeed = Number(seed);
  const canRepeat = lastId !== null && seed.trim() !== "" && Number.isInteger(parsedSeed);

  return (
    <div className="dock-body">
      <div className="section-head">
        <h2>Criar com um clique</h2>
        <p>Cada clique sorteia um modelo novo.</p>
      </div>

      <div className="generator-grid">
        {generators.map(({ id, name }) => {
          const { icon: Icon, hint, hue } = LOOKS[id];
          return (
            <button
              key={id}
              className={`generator-card ${lastId === id ? "selected" : ""}`}
              style={{ "--hue": hue } as React.CSSProperties}
              onClick={() => roll(id)}
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

      <div className="generator-footer">
        <label className="field-label" htmlFor="generator-seed">
          <Dices size={13} /> Semente
        </label>
        <div className="seed-row">
          <input
            id="generator-seed"
            className="input"
            inputMode="numeric"
            placeholder="Sorteie um modelo"
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          />
          <button
            className="button"
            disabled={!canRepeat}
            onClick={() => void generate(lastId!, parsedSeed, keep)}
            title="Gerar de novo com esta semente"
          >
            <RotateCcw size={14} /> Repetir
          </button>
        </div>

        <label className="switch">
          <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
          <i aria-hidden />
          Manter o que já está na cena
        </label>
      </div>
    </div>
  );
}
