import { useEffect, useState } from "react";
import * as THREE from "three";
import { CopyPlus, Group, PencilRuler, RotateCw, SquaresIntersect, SquaresSubtract, SquaresUnite, Trash2, Ungroup, X } from "lucide-react";
import { getBlock } from "../blocks/catalog";
import { useEditor, useSelectedParts } from "../core/store";
import type { Part, Vec3 } from "../core/types";
import { duplicateSelection, recolorSelection, removeSelection, setSelectionGrouped } from "./actions";
import { ModelingPanel } from "./ModelingPanel";
import { Palette } from "./Palette";
import { combineSelected, convertToShape, isShapePart, startModeling } from "./modeling";

const AXES = ["x", "y", "z"] as const;

function formatNumber(value: number): string {
  return String(Math.round(value * 1000) / 1000);
}

function NumberField({ axis, value, onCommit }: { axis: string; value: number; onCommit(next: number): void }) {
  const [draft, setDraft] = useState(formatNumber(value));
  useEffect(() => setDraft(formatNumber(value)), [value]);

  const commit = () => {
    const parsed = Number(draft.replace(",", "."));
    if (draft.trim() === "" || !Number.isFinite(parsed)) {
      setDraft(formatNumber(value));
    } else if (formatNumber(parsed) !== formatNumber(value)) {
      onCommit(parsed);
    }
  };

  return (
    <label className={`axis-field axis-${axis}`}>
      <span>{axis.toUpperCase()}</span>
      <input
        inputMode="decimal"
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Enter") event.currentTarget.blur();
        }}
      />
    </label>
  );
}

function Vec3Row({ label, value, onCommit }: { label: string; value: Vec3; onCommit(next: Vec3): void }) {
  return (
    <div className="field">
      <div className="field-label">{label}</div>
      <div className="vec3">
        {AXES.map((axis, index) => (
          <NumberField
            key={axis}
            axis={axis}
            value={value[index]}
            onCommit={(next) => {
              const updated: Vec3 = [...value];
              updated[index] = next;
              onCommit(updated);
            }}
          />
        ))}
      </div>
    </div>
  );
}

function toDegrees(part: Part): Vec3 {
  const euler = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(...part.rotation));
  return [euler.x, euler.y, euler.z].map(THREE.MathUtils.radToDeg) as Vec3;
}

function fromDegrees(degrees: Vec3): Part["rotation"] {
  const [x, y, z] = degrees.map(THREE.MathUtils.degToRad);
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(x, y, z)).toArray() as Part["rotation"];
}

function PartEditor({ part }: { part: Part }) {
  const dispatch = useEditor((state) => state.dispatch);
  const select = useEditor((state) => state.select);
  const update = (changes: Partial<Omit<Part, "id" | "block">>) =>
    void dispatch({ type: "updatePart", id: part.id, ...changes });

  return (
    <>
      <header className="inspector-head">
        <div>
          <small>Peça selecionada</small>
          <h2>{getBlock(part.block).name}</h2>
        </div>
        <button className="icon-button" onClick={() => select([])} aria-label="Limpar seleção">
          <X size={16} />
        </button>
      </header>

      <div className="field">
        <div className="field-label">Cor</div>
        <Palette value={part.color} onPick={(color) => update({ color })} />
      </div>
      <Vec3Row label="Posição" value={part.position} onCommit={(position) => update({ position })} />
      <Vec3Row label="Rotação" value={toDegrees(part)} onCommit={(degrees) => update({ rotation: fromDegrees(degrees) })} />
      <Vec3Row label="Tamanho" value={part.scale} onCommit={(scale) => update({ scale })} />

      <div className="actions">
        <button
          className="button primary"
          onClick={() => startModeling(part)}
          title={isShapePart(part) ? "Editar faces, arestas e pontos (Tab)" : "Transforma em uma forma editável e abre a edição (Tab)"}
        >
          <PencilRuler size={15} /> Modelar esta peça
        </button>
      </div>
      <div className="actions">
        <button className="button" onClick={() => void duplicateSelection()} title="Duplicar (Ctrl+D)">
          <CopyPlus size={15} /> Duplicar
        </button>
        <button className="button danger" onClick={() => void removeSelection()} title="Apagar (Delete)">
          <Trash2 size={15} /> Apagar
        </button>
      </div>
    </>
  );
}

function SelectionEditor({ parts }: { parts: Part[] }) {
  const select = useEditor((state) => state.select);
  const firstGroup = parts[0].group;
  const isOneGroup = firstGroup !== undefined && parts.every((part) => part.group === firstGroup);
  const firstColor = parts[0].color;
  const sharedColor = parts.every((part) => part.color === firstColor) ? firstColor : "";

  return (
    <>
      <header className="inspector-head">
        <div>
          <small>{isOneGroup ? "Grupo selecionado" : "Seleção"}</small>
          <h2>{parts.length} peças</h2>
        </div>
        <button className="icon-button" onClick={() => select([])} aria-label="Limpar seleção">
          <X size={16} />
        </button>
      </header>

      <div className="field">
        <div className="field-label">Cor de todas</div>
        <Palette value={sharedColor} onPick={(color) => void recolorSelection(color)} />
      </div>

      <p className="inspector-tip">
        Use as setas para mover tudo junto. Clique duas vezes em uma peça para editar só ela.
      </p>

      <div className="actions">
        <button
          className="button primary"
          onClick={() => void convertToShape(parts)}
          title="Junta tudo em uma única forma editável, que substitui estas peças"
        >
          <PencilRuler size={15} /> Juntar e modelar
        </button>
      </div>
      <div className="field">
        <div className="field-label">Combinar as formas</div>
        <div className="combine-row">
          <button className="button" onClick={() => void combineSelected(parts, "subtract")} title="As outras peças abrem um buraco na peça que você clicou primeiro">
            <SquaresSubtract size={15} /> Furar
          </button>
          <button className="button" onClick={() => void combineSelected(parts, "union")} title="Transforma tudo em uma só casca, sem paredes por dentro">
            <SquaresUnite size={15} /> Unir
          </button>
          <button className="button" onClick={() => void combineSelected(parts, "intersect")} title="Fica só a parte que as peças têm em comum">
            <SquaresIntersect size={15} /> Comum
          </button>
        </div>
        <p className="inspector-tip">Deixe as peças encostadas. A primeira que você clicou é a que recebe o furo.</p>
      </div>
      <div className="actions">
        {isOneGroup ? (
          <button className="button" onClick={() => void setSelectionGrouped(false)} title="Desagrupar (Ctrl+Shift+G)">
            <Ungroup size={15} /> Desagrupar
          </button>
        ) : (
          <button className="button" onClick={() => void setSelectionGrouped(true)} title="Agrupar (Ctrl+G)">
            <Group size={15} /> Agrupar
          </button>
        )}
      </div>
      <div className="actions">
        <button className="button" onClick={() => void duplicateSelection()} title="Duplicar (Ctrl+D)">
          <CopyPlus size={15} /> Duplicar
        </button>
        <button className="button danger" onClick={() => void removeSelection()} title="Apagar (Delete)">
          <Trash2 size={15} /> Apagar
        </button>
      </div>
    </>
  );
}

function PlacementEditor({ blockId }: { blockId: string }) {
  const placementColor = useEditor((state) => state.placementColor);
  const setPlacementColor = useEditor((state) => state.setPlacementColor);
  const rotatePlacement = useEditor((state) => state.rotatePlacement);
  const stopPlacing = useEditor((state) => state.stopPlacing);
  const block = getBlock(blockId);

  return (
    <>
      <header className="inspector-head">
        <div>
          <small>Colocando</small>
          <h2>{block.name}</h2>
        </div>
        <button className="icon-button" onClick={stopPlacing} aria-label="Parar de colocar">
          <X size={16} />
        </button>
      </header>
      <div className="field">
        <div className="field-label">Cor</div>
        <Palette value={placementColor ?? block.color} onPick={setPlacementColor} />
      </div>
      <div className="actions">
        <button className="button" onClick={rotatePlacement} title="Girar (R)">
          <RotateCw size={15} /> Girar
        </button>
        {placementColor && (
          <button className="button" onClick={() => setPlacementColor(null)}>
            Cor original
          </button>
        )}
      </div>
    </>
  );
}

export function Inspector() {
  const parts = useSelectedParts();
  const placingBlock = useEditor((state) => state.placingBlock);
  const modelingId = useEditor((state) => state.modeling?.shapeId);
  const shape = useEditor((state) => state.snapshot?.project.shapes.find((item) => item.id === modelingId));

  if (shape) {
    return (
      <aside className="inspector glass modeling-panel">
        <ModelingPanel key={shape.id} shape={shape} />
      </aside>
    );
  }
  if (parts.length === 0 && !placingBlock) return null;

  return (
    <aside className="inspector glass">
      {parts.length === 1 && <PartEditor key={parts[0].id} part={parts[0]} />}
      {parts.length > 1 && <SelectionEditor parts={parts} />}
      {parts.length === 0 && <PlacementEditor blockId={placingBlock!} />}
    </aside>
  );
}
