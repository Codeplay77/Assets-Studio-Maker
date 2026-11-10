import { useEffect, useMemo, useState } from "react";
import { Check, LoaderCircle, Pause, Play, Search, Square, X } from "lucide-react";
import { ANIMATION_CATEGORIES, clipDuration, CLIPS, getClip } from "../animation/clips";
import { chooseCharacter, ensureAnimations, previewClip, seek, setInPlace, stopPreview, togglePlaying, usePlayer } from "../animation/player";
import { findRigs } from "../animation/rig";
import { useEditor } from "../core/store";

const seconds = (value: number) => `${value.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} s`;

export function AnimationPanel() {
  const project = useEditor((state) => state.snapshot?.project);
  const dispatch = useEditor((state) => state.dispatch);
  const { status, character, clip, playing, time, inPlace } = usePlayer();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<string>(ANIMATION_CATEGORIES[0]);

  const rigs = useMemo(() => (project ? findRigs(project.parts) : []), [project]);
  const current = rigs.find((rig) => rig.root === character) ?? null;

  useEffect(() => {
    void ensureAnimations();
    return stopPreview;
  }, []);
  // The first character is chosen on its own, and another one when it is deleted.
  useEffect(() => {
    if (!current) chooseCharacter(rigs[0]?.root ?? null);
  }, [current, rigs]);

  const chosen = (character !== null && project?.animations?.[String(character)]) || [];
  const toggleChosen = (id: string) => {
    if (character === null) return;
    const clips = chosen.includes(id) ? chosen.filter((item) => item !== id) : [...chosen, id];
    void dispatch({ type: "setAnimations", part: character, clips });
  };

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () => (term ? CLIPS.filter((item) => item.label.toLowerCase().includes(term) || item.id.toLowerCase().includes(term)) : CLIPS.filter((item) => item.category === category)),
    [category, term],
  );
  const playingClip = clip ? getClip(clip) : undefined;

  if (rigs.length === 0) {
    return (
      <div className="dock-body">
        <div className="section-head">
          <h2>Animar personagens</h2>
          <p>Não há personagens na cena. Gere uma pessoa na aba Criar, em qualquer estilo, e volte aqui para dar vida a ela.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="dock-body browser">
      <div className="section-head">
        <h2>Animar personagens</h2>
        <p>Clique numa animação para ver. As marcadas vão junto quando você exportar.</p>
      </div>

      {rigs.length > 1 && (
        <div className="chips">
          {rigs.map((rig, index) => {
            const count = project?.animations?.[String(rig.root)]?.length ?? 0;
            return (
              <button key={rig.root} className={`chip ${rig.root === character ? "active" : ""}`} onClick={() => chooseCharacter(rig.root)}>
                Personagem {index + 1}
                {count > 0 && ` · ${count}`}
              </button>
            );
          })}
        </div>
      )}

      <div className="player-bar">
        <button className="icon-button" onClick={togglePlaying} disabled={!playingClip} aria-label={playing ? "Pausar" : "Tocar"}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <div className="player-track">
          <span>{playingClip?.label ?? (status === "loading" ? "Carregando animações…" : "Escolha uma animação")}</span>
          <input
            type="range"
            min={0}
            max={playingClip ? clipDuration(playingClip) : 1}
            step={0.01}
            value={playingClip ? Math.min(time, clipDuration(playingClip)) : 0}
            disabled={!playingClip}
            onChange={(event) => seek(Number(event.target.value))}
            aria-label="Momento da animação"
          />
        </div>
        <button className="icon-button" onClick={stopPreview} disabled={!playingClip} aria-label="Parar e voltar à pose original">
          <Square size={13} />
        </button>
      </div>
      {playingClip?.moves && (
        <label className="switch">
          <input type="checkbox" checked={inPlace} onChange={(event) => setInPlace(event.target.checked)} />
          <i aria-hidden />
          Sem sair do lugar
        </label>
      )}

      <div className="search">
        <Search size={15} />
        <input placeholder={`Buscar em ${CLIPS.length} animações…`} value={search} onChange={(event) => setSearch(event.target.value)} />
        {search && (
          <button className="icon-button" onClick={() => setSearch("")} aria-label="Limpar busca">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="chips">
        {ANIMATION_CATEGORIES.map((name) => (
          <button
            key={name}
            className={`chip ${!term && category === name ? "active" : ""}`}
            onClick={() => {
              setCategory(name);
              setSearch("");
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="block-scroll">
        <ul className="clip-list">
          {visible.map((item) => {
            const marked = chosen.includes(item.id);
            return (
              <li key={item.id} className={`clip-row ${clip === item.id ? "active" : ""}`}>
                <button className="clip-play" onClick={() => void previewClip(item.id)} disabled={status === "loading"}>
                  {status === "loading" && clip === null ? <LoaderCircle size={13} className="spin" /> : <Play size={13} />}
                  <span>{item.label}</span>
                  <small>{seconds(clipDuration(item))}</small>
                </button>
                <button
                  className={`clip-mark ${marked ? "on" : ""}`}
                  onClick={() => toggleChosen(item.id)}
                  title={marked ? "Tirar do arquivo exportado" : "Levar no arquivo exportado"}
                  aria-pressed={marked}
                >
                  <Check size={13} />
                </button>
              </li>
            );
          })}
        </ul>
        {visible.length === 0 && <p className="empty">Nada encontrado para “{search}”.</p>}
      </div>

      <p className="credit">
        {chosen.length > 0 ? `${chosen.length} ${chosen.length === 1 ? "animação marcada" : "animações marcadas"} · ` : ""}
        Animações CC0 do Mesh2Motion
      </p>
    </div>
  );
}
