import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpFromLine,
  Blend,
  Brush,
  Circle,
  CircleDot,
  Eraser,
  FlipHorizontal2,
  Grid2x2,
  Hand,
  Merge,
  Minus,
  PenLine,
  Scan,
  Spline,
  Square,
  SquareDashed,
  Trash2,
  Waves,
} from "lucide-react";
import { useEditor, type MeshMode } from "../core/store";
import type { CustomShape, Finish } from "../core/types";
import type { BrushKind } from "../modeling/sculpt";
import { Palette } from "./Palette";
import {
  addDetail,
  bevelSelected,
  deleteSelected,
  divideFaces,
  drillSelected,
  facesFromVertices,
  fillSelected,
  insetFaces,
  mirrorShape,
  paintSelected,
  pullFaces,
  roundShape,
  smoothShape,
  updateShapeSettings,
  weldSelected,
} from "./modeling";

const MODES: { id: MeshMode; label: string; icon: typeof Square }[] = [
  { id: "face", label: "Faces", icon: Square },
  { id: "edge", label: "Arestas", icon: Spline },
  { id: "vertex", label: "Pontos", icon: Circle },
  { id: "sculpt", label: "Esculpir", icon: Brush },
];

const BRUSHES: { id: BrushKind; label: string; hint: string; icon: typeof Square }[] = [
  { id: "raise", label: "Levantar", hint: "Faz a superfície crescer onde você passa", icon: ArrowUp },
  { id: "lower", label: "Afundar", hint: "Faz a superfície afundar onde você passa", icon: ArrowDown },
  { id: "smooth", label: "Alisar", hint: "Tira as irregularidades", icon: Eraser },
  { id: "flatten", label: "Achatar", hint: "Deixa a região reta", icon: Minus },
  { id: "grab", label: "Agarrar", hint: "Segura a superfície e arrasta", icon: Hand },
];

/** Below this, the brush moves so few points that strokes look broken. */
const LOW_DETAIL_POINTS = 800;
const MAX_BRUSH_RADIUS = 3;
const MAX_BEVEL_SEGMENTS = 8;

const FINISHES: { id: Finish; label: string }[] = [
  { id: "matte", label: "Fosco" },
  { id: "gloss", label: "Brilhante" },
  { id: "metal", label: "Metal" },
  { id: "glass", label: "Vidro" },
  { id: "glow", label: "Luz" },
];

const MAX_SOFT_RADIUS = 3;
const MAX_SMOOTH_ANGLE = 180;

function ToolButton({
  icon,
  label,
  keys,
  disabled,
  title,
  onClick,
}: {
  icon: ReactNode;
  label: string;
  keys?: string;
  disabled?: boolean;
  title: string;
  onClick(): void;
}) {
  return (
    <button className="button tool" disabled={disabled} title={title} onClick={onClick}>
      {icon}
      <span>{label}</span>
      {keys && <kbd>{keys}</kbd>}
    </button>
  );
}

function AmountField({ label, value, onChange }: { label: string; value: number; onChange(next: number): void }) {
  const [draft, setDraft] = useState(String(value));
  useEffect(() => setDraft(String(value)), [value]);
  return (
    <label className="amount-field">
      <span>{label}</span>
      <input
        className="input"
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => {
          const parsed = Number(draft.replace(",", "."));
          if (draft.trim() !== "" && Number.isFinite(parsed)) onChange(parsed);
          else setDraft(String(value));
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function selectionText(mode: MeshMode, faces: number, vertices: number): string {
  if (mode === "sculpt") return "Arraste sobre a forma para esculpir";
  if (mode === "face") {
    return faces === 0 ? "Clique em uma face para começar" : faces === 1 ? "1 face selecionada" : `${faces} faces selecionadas`;
  }
  if (vertices === 0) return mode === "edge" ? "Clique em uma aresta para começar" : "Clique em um ponto para começar";
  return vertices === 1 ? "1 ponto selecionado" : `${vertices} pontos selecionados`;
}

function NameField({ shape }: { shape: CustomShape }) {
  const [draft, setDraft] = useState(shape.name);
  useEffect(() => setDraft(shape.name), [shape.name]);
  return (
    <input
      className="shape-name"
      aria-label="Nome da forma"
      value={draft}
      maxLength={80}
      onChange={(event) => setDraft(event.target.value)}
      onBlur={() => {
        if (draft.trim() && draft.trim() !== shape.name) void updateShapeSettings({ name: draft.trim() });
        else setDraft(shape.name);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") event.currentTarget.blur();
      }}
    />
  );
}

/** Keeps the slider responsive and saves one undo step when the mouse is released. */
function SmoothingSlider({ shape }: { shape: CustomShape }) {
  const [draft, setDraft] = useState(shape.smoothAngle);
  useEffect(() => setDraft(shape.smoothAngle), [shape.smoothAngle]);
  const commit = () => {
    if (draft !== shape.smoothAngle) void updateShapeSettings({ smoothAngle: draft });
  };
  return (
    <label className="slider-field">
      <span className="slider-labels">
        <small>Bordas retas</small>
        <small>Tudo suave</small>
      </span>
      <input
        type="range"
        aria-label="Suavização das bordas"
        min={0}
        max={MAX_SMOOTH_ANGLE}
        step={5}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
      />
    </label>
  );
}

function SculptTools({ shape }: { shape: CustomShape }) {
  const kind = useEditor((state) => state.brushKind);
  const radius = useEditor((state) => state.brushRadius);
  const strength = useEditor((state) => state.brushStrength);
  const symmetry = useEditor((state) => state.brushSymmetry);
  const setKind = useEditor((state) => state.setBrushKind);
  const setRadius = useEditor((state) => state.setBrushRadius);
  const setStrength = useEditor((state) => state.setBrushStrength);
  const setSymmetry = useEditor((state) => state.setBrushSymmetry);

  return (
    <section className="tool-section">
      <div className="field-label">Pincel</div>
      <div className="tool-grid">
        {BRUSHES.map(({ id, label, hint, icon: Icon }) => (
          <button key={id} className={`button tool ${kind === id ? "active" : ""}`} title={hint} onClick={() => setKind(id)}>
            <Icon size={15} />
            <span>{label}</span>
          </button>
        ))}
      </div>
      <label className="slider-field">
        <span className="slider-labels">
          <small>Tamanho</small>
          <small>{radius.toFixed(2)} m</small>
        </span>
        <input
          type="range"
          aria-label="Tamanho do pincel"
          min={0.02}
          max={MAX_BRUSH_RADIUS}
          step={0.01}
          value={radius}
          onChange={(event) => setRadius(Number(event.target.value))}
        />
      </label>
      <label className="slider-field">
        <span className="slider-labels">
          <small>Força</small>
          <small>{Math.round(strength * 100)}%</small>
        </span>
        <input
          type="range"
          aria-label="Força do pincel"
          min={0.05}
          max={1}
          step={0.05}
          value={strength}
          onChange={(event) => setStrength(Number(event.target.value))}
        />
      </label>
      <label className="check-field">
        <input type="checkbox" checked={symmetry} onChange={(event) => setSymmetry(event.target.checked)} />
        Esculpir dos dois lados (simetria em X)
      </label>
      {shape.vertices.length < LOW_DETAIL_POINTS && (
        <div className="sculpt-tip">
          <p className="inspector-tip">Esta forma tem poucos pontos. Com mais detalhe, o pincel fica mais preciso.</p>
          <button className="button" onClick={() => void addDetail()}>
            <Grid2x2 size={15} /> Aumentar detalhe
          </button>
        </div>
      )}
    </section>
  );
}

function CutTools({ chosenFaces }: { chosenFaces: number }) {
  const holeShape = useEditor((state) => state.holeShape);
  const holeSize = useEditor((state) => state.holeSize);
  const holeDepth = useEditor((state) => state.holeDepth);
  const bevelAmount = useEditor((state) => state.bevelAmount);
  const bevelSegments = useEditor((state) => state.bevelSegments);
  const setHoleShape = useEditor((state) => state.setHoleShape);
  const setHoleSize = useEditor((state) => state.setHoleSize);
  const setHoleDepth = useEditor((state) => state.setHoleDepth);
  const setBevelAmount = useEditor((state) => state.setBevelAmount);
  const setBevelSegments = useEditor((state) => state.setBevelSegments);

  return (
    <section className="tool-section">
      <div className="field-label">Cortar e chanfrar</div>
      <div className="tool-with-amount">
        <ToolButton
          icon={<PenLine size={15} />}
          label="Chanfrar"
          keys="B"
          title="Corta as arestas selecionadas. Sem seleção, corta todas as quinas vivas"
          onClick={() => void bevelSelected()}
        />
        <AmountField label="Largura" value={bevelAmount} onChange={setBevelAmount} />
      </div>
      <label className="slider-field">
        <span className="slider-labels">
          <small>Corte reto</small>
          <small>{bevelSegments === 1 ? "Reto" : `Curva com ${bevelSegments} partes`}</small>
        </span>
        <input
          type="range"
          aria-label="Curvatura do chanfro"
          min={1}
          max={MAX_BEVEL_SEGMENTS}
          step={1}
          value={bevelSegments}
          onChange={(event) => setBevelSegments(Number(event.target.value))}
        />
      </label>
      <div className="hole-row">
        <ToolButton
          icon={<CircleDot size={15} />}
          label="Furar"
          disabled={chosenFaces === 0}
          title={chosenFaces === 0 ? "Selecione a face onde o furo vai começar" : "Abre um furo no meio de cada face selecionada"}
          onClick={() => void drillSelected()}
        />
        <AmountField label="Tamanho" value={holeSize} onChange={(value) => setHoleSize(Math.max(0.005, value))} />
        <AmountField label="Fundo (0 vaza)" value={holeDepth} onChange={(value) => setHoleDepth(Math.max(0, value))} />
      </div>
      <nav className="segmented compact" aria-label="Formato do furo">
        <button className={holeShape === "round" ? "active" : ""} onClick={() => setHoleShape("round")}>
          <Circle size={13} /> Redondo
        </button>
        <button className={holeShape === "square" ? "active" : ""} onClick={() => setHoleShape("square")}>
          <Square size={13} /> Quadrado
        </button>
      </nav>
    </section>
  );
}

export function ModelingPanel({ shape }: { shape: CustomShape }) {
  const mode = useEditor((state) => state.meshMode);
  const faces = useEditor((state) => state.meshFaces);
  const vertices = useEditor((state) => state.meshVertices);
  const softRadius = useEditor((state) => state.softRadius);
  const pullDistance = useEditor((state) => state.pullDistance);
  const insetAmount = useEditor((state) => state.insetAmount);
  const setMeshMode = useEditor((state) => state.setMeshMode);
  const setSoftRadius = useEditor((state) => state.setSoftRadius);
  const setPullDistance = useEditor((state) => state.setPullDistance);
  const setInsetAmount = useEditor((state) => state.setInsetAmount);
  const exitModeling = useEditor((state) => state.exitModeling);

  const chosenFaces = mode === "face" ? faces.length : facesFromVertices(shape, vertices).length;
  const chosenVertices = mode === "face" ? new Set(faces.flatMap((id) => shape.faces[id] ?? [])).size : vertices.length;
  const nothing = mode === "face" ? faces.length === 0 : vertices.length === 0;
  const needFaces = "Selecione pelo menos uma face";
  const firstMaterial = mode === "face" && faces[0] !== undefined ? shape.materials[shape.faceMaterials[faces[0]]] : undefined;

  return (
    <>
      <header className="inspector-head modeling-head">
        <div>
          <small>Modelando</small>
          <NameField shape={shape} />
        </div>
        <button className="button primary small" onClick={exitModeling} title="Voltar a mover as peças (Tab)">
          Concluir
        </button>
      </header>

      <nav className="segmented compact mesh-modes" aria-label="O que selecionar">
        {MODES.map(({ id, label, icon: Icon }, index) => (
          <button key={id} className={mode === id ? "active" : ""} onClick={() => setMeshMode(id)} title={`${label} (${index + 1})`}>
            <Icon size={13} strokeWidth={2.2} /> {label}
          </button>
        ))}
      </nav>
      <p className="selection-count">{selectionText(mode, faces.length, vertices.length)}</p>

      {mode === "sculpt" && <SculptTools shape={shape} />}

      {mode !== "sculpt" && (
      <section className="tool-section">
        <div className="field-label">Moldar a seleção</div>
        <div className="tool-with-amount">
          <ToolButton
            icon={<ArrowUpFromLine size={15} />}
            label="Puxar"
            keys="P"
            disabled={chosenFaces === 0}
            title={chosenFaces === 0 ? needFaces : "Puxa as faces para fora, criando novas paredes"}
            onClick={() => void pullFaces(pullDistance)}
          />
          <AmountField label="Metros" value={pullDistance} onChange={setPullDistance} />
        </div>
        <div className="tool-with-amount">
          <ToolButton
            icon={<SquareDashed size={15} />}
            label="Moldura"
            keys="I"
            disabled={chosenFaces === 0}
            title={chosenFaces === 0 ? needFaces : "Cria uma face menor dentro de cada face"}
            onClick={() => void insetFaces(insetAmount)}
          />
          <AmountField label="Margem" value={insetAmount} onChange={setInsetAmount} />
        </div>
        <div className="tool-grid">
          <ToolButton
            icon={<Grid2x2 size={15} />}
            label="Dividir"
            title="Corta as faces selecionadas em faces menores. Sem seleção, corta a forma inteira"
            onClick={() => void divideFaces()}
          />
          <ToolButton
            icon={<Trash2 size={15} />}
            label="Apagar"
            keys="Del"
            disabled={nothing}
            title="Apaga o que está selecionado, deixando um buraco"
            onClick={() => void deleteSelected()}
          />
          <ToolButton
            icon={<Merge size={15} />}
            label="Juntar"
            disabled={chosenVertices < 2}
            title="Junta os pontos selecionados em um só"
            onClick={() => void weldSelected()}
          />
          <ToolButton
            icon={<Scan size={15} />}
            label="Criar face"
            disabled={chosenVertices < 3}
            title="Fecha um buraco com uma face passando pelos pontos selecionados"
            onClick={() => void fillSelected()}
          />
        </div>
        <label className="slider-field">
          <span className="slider-labels">
            <small>Arraste suave</small>
            <small>{softRadius === 0 ? "Desligado" : `${softRadius.toFixed(1)} m`}</small>
          </span>
          <input
            type="range"
            aria-label="Alcance do arraste suave"
            min={0}
            max={MAX_SOFT_RADIUS}
            step={0.1}
            value={softRadius}
            onChange={(event) => setSoftRadius(Number(event.target.value))}
          />
        </label>
      </section>
      )}

      {mode !== "sculpt" && <CutTools chosenFaces={chosenFaces} />}

      <section className="tool-section">
        <div className="field-label">Forma inteira</div>
        <div className="tool-grid">
          <ToolButton icon={<Blend size={15} />} label="Arredondar" title="Transforma cantos em curvas e multiplica as faces" onClick={() => void roundShape()} />
          <ToolButton icon={<Waves size={15} />} label="Suavizar" title="Alisa a superfície selecionada, ou a forma inteira" onClick={() => void smoothShape()} />
        </div>
        <div className="mirror-row">
          <span>
            <FlipHorizontal2 size={14} /> Espelhar
          </span>
          {(["x", "y", "z"] as const).map((axis) => (
            <button key={axis} className={`button axis-${axis}`} title={`Refaz um lado como reflexo do outro, no eixo ${axis.toUpperCase()}`} onClick={() => void mirrorShape(axis)}>
              {axis.toUpperCase()}
            </button>
          ))}
        </div>
        <SmoothingSlider shape={shape} />
      </section>

      {chosenFaces > 0 && (
        <section className="tool-section">
          <div className="field-label">Cor das faces</div>
          <Palette value={firstMaterial?.color ?? ""} onPick={(color) => void paintSelected({ color, finish: firstMaterial?.finish })} />
          <div className="finish-row">
            <select
              className="input"
              aria-label="Acabamento"
              value={firstMaterial?.finish ?? "matte"}
              onChange={(event) =>
                void paintSelected({
                  color: firstMaterial?.color,
                  ...(event.target.value === "matte" ? {} : { finish: event.target.value }),
                })
              }
            >
              {FINISHES.map(({ id, label }) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
            <button className="button" title="Volta a seguir a cor da peça" onClick={() => void paintSelected({})}>
              Cor da peça
            </button>
          </div>
        </section>
      )}
    </>
  );
}
