import { useState } from "react";
import { Dices, Plus, Sparkles, X } from "lucide-react";
import { styleName } from "../blocks/styles";
import { useEditor } from "../core/store";
import { ANY, getGenerator, visibleOptions, type GeneratorOption } from "../generators";
import { GENERATOR_LOOKS } from "./GeneratorPanel";
import { buildFromPanel, effectiveStyle, panelSettings, useLockedStyle } from "./generate";

function OptionRow({ option, generatorId }: { option: GeneratorOption; generatorId: string }) {
  const style = useEditor((state) => state.artStyle);
  const value = useEditor((state) => state.generatorChoices[generatorId]?.[option.id] ?? ANY);
  const setChoice = useEditor((state) => state.setGeneratorChoice);
  const locked = useLockedStyle();
  const allChoices = useEditor((state) => state.generatorChoices[generatorId]);
  const choices = option.choices(locked ?? style, allChoices);
  const isSwatch = choices.every((choice) => choice.color);

  const choose = (choice: string) => {
    setChoice(generatorId, option.id, choice);
    if (useEditor.getState().generatorLive) void buildFromPanel();
  };

  return (
    <div className="option-row">
      <span className="field-label">{option.label}</span>
      <div className={isSwatch ? "option-swatches" : "chips"}>
        <button className={`chip ${value === ANY ? "active" : ""}`} onClick={() => choose(ANY)}>
          Sortear
        </button>
        {choices.map((choice) =>
          choice.color ? (
            <button
              key={choice.id}
              className={`swatch ${value === choice.id ? "active" : ""}`}
              style={{ background: choice.color }}
              onClick={() => choose(choice.id)}
              aria-label={`${option.label}: ${choice.label}`}
              title={choice.label}
            />
          ) : (
            <button key={choice.id} className={`chip ${value === choice.id ? "active" : ""}`} onClick={() => choose(choice.id)}>
              {choice.label}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

export function GeneratorOptions() {
  const id = useEditor((state) => state.generatorOpen);
  const idle = useEditor((state) => state.selection.length === 0 && !state.placingBlock && !state.modeling);
  const live = useEditor((state) => state.generatorLive);
  const seed = useEditor((state) => state.generatorSeed);
  const keep = useEditor((state) => state.generatorKeep);
  const setKeep = useEditor((state) => state.setGeneratorKeep);
  const close = useEditor((state) => state.closeGenerator);
  useEditor((state) => state.generatorChoices);
  useEditor((state) => state.artStyle);
  const locked = useLockedStyle();
  const [typedSeed, setTypedSeed] = useState<string | null>(null);

  if (!id || !idle) return null;

  const generator = getGenerator(id);
  const { icon: Icon, hue } = GENERATOR_LOOKS[id];
  const settings = panelSettings(id);
  const options = visibleOptions(generator, settings);
  const shownSeed = typedSeed ?? String(seed);

  const applySeed = () => {
    const parsed = Number(shownSeed);
    setTypedSeed(null);
    if (Number.isInteger(parsed) && parsed > 0) void buildFromPanel({ seed: parsed });
  };

  return (
    <aside className="inspector glass generator-options" aria-label={`Opções de ${generator.name}`}>
      <header className="inspector-head">
        <span className="generator-title">
          <span className="generator-icon small" style={{ "--hue": hue } as React.CSSProperties}>
            <Icon size={15} strokeWidth={2} />
          </span>
          <span>
            <small>Estilo {styleName(locked ?? effectiveStyle())}</small>
            <h2>{generator.name}</h2>
          </span>
        </span>
        <button className="icon-button" onClick={close} aria-label="Fechar opções" title="Fechar (Esc)">
          <X size={15} />
        </button>
      </header>

      <div className="option-list">
        {options.map((option) => (
          <OptionRow key={option.id} option={option} generatorId={id} />
        ))}
      </div>

      <footer className="generator-actions">
        {live ? (
          <>
            <button className="button primary" onClick={() => void buildFromPanel({ newSeed: true })}>
              <Dices size={15} /> Sortear outro
            </button>
            <button className="button" onClick={() => void buildFromPanel({ newSeed: true, addAnother: true })}>
              <Plus size={15} /> Mais um ao lado
            </button>
          </>
        ) : (
          <button className="button primary" onClick={() => void buildFromPanel({ newSeed: true })}>
            <Sparkles size={15} /> Gerar
          </button>
        )}

        <label className="seed-field">
          <span className="field-label">Semente</span>
          <input
            className="input"
            inputMode="numeric"
            value={shownSeed}
            onChange={(event) => setTypedSeed(event.target.value)}
            onBlur={() => typedSeed !== null && applySeed()}
            onKeyDown={(event) => event.key === "Enter" && event.currentTarget.blur()}
          />
        </label>

        <label className="switch">
          <input type="checkbox" checked={keep} onChange={(event) => setKeep(event.target.checked)} />
          <i aria-hidden />
          Manter o que já está na cena
        </label>
      </footer>
    </aside>
  );
}
