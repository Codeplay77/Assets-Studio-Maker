import { useEffect, useState } from "react";
import * as THREE from "three";
import { CopyPlus, Pipette, RotateCw, Trash2, X } from "lucide-react";
import { getBlock } from "../blocks/catalog";
import { selectedPart, useEditor } from "../core/store";
import type { Part, Vec3 } from "../core/types";
import { duplicateSelection, removeSelection } from "./actions";

const PALETTE = [
  "#ffffff", "#f2c9a0", "#c68642", "#8d5524",
  "#e5484d", "#f76b15", "#ffc53d", "#3fae5a",
  "#1ef5a6", "#12a594", "#3f8cff", "#2d3a55",
  "#7a3fd1", "#e93d82", "#8a9bb0", "#2b2f38",
];

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

function Palette({ value, onPick }: { value: string; onPick(color: string): void }) {
  return (
    <div className="palette">
      {PALETTE.map((color) => (
        <button
          key={color}
          className={`swatch ${color === value ? "active" : ""}`}
          style={{ background: color }}
          onClick={() => onPick(color)}
          aria-label={`Cor ${color}`}
        />
      ))}
      <label className="swatch custom" title="Escolher outra cor">
        <Pipette size={14} />
        <input type="color" value={value} onChange={(event) => onPick(event.target.value)} />
      </label>
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
        <button className="icon-button" onClick={() => select(null)} aria-label="Limpar seleção">
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
  const part = useEditor(selectedPart);
  const placingBlock = useEditor((state) => state.placingBlock);
  if (!part && !placingBlock) return null;

  return (
    <aside className="inspector glass">
      {part ? <PartEditor key={part.id} part={part} /> : <PlacementEditor blockId={placingBlock!} />}
    </aside>
  );
}
