import { useMemo } from "react";
import { Copy, Trash2 } from "lucide-react";
import { getBlock, hasBlock, meshToBlockShape, type BlockDef } from "../blocks/catalog";
import { useEditor } from "../core/store";
import type { CustomShape } from "../core/types";
import { buildPiece } from "../modeling/operations";
import { useThumbnail } from "../viewport/thumbnails";
import { BASE_SHAPES, createBaseShape, duplicateShape, removeShape, type BaseShape } from "./modeling";

function Thumbnail({ block }: { block: BlockDef }) {
  const thumbnail = useThumbnail(block);
  return (
    <span className="block-thumb">
      {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span className="shimmer" />}
    </span>
  );
}

function BaseCard({ base }: { base: BaseShape }) {
  const block = useMemo<BlockDef>(
    () => ({
      id: `base.${base.id}`,
      name: base.name,
      category: "base",
      color: "#8a9bb0",
      shape: meshToBlockShape(buildPiece(base.piece)),
      sockets: [{ id: "base", p: [0, 0, 0], n: [0, -1, 0] }],
    }),
    [base],
  );
  return (
    <button className="block-card" title={`Começar de: ${base.name}`} onClick={() => void createBaseShape(base)}>
      <Thumbnail block={block} />
      <span className="block-name">{base.name}</span>
    </button>
  );
}

function ShapeCard({ shape }: { shape: CustomShape }) {
  const placingBlock = useEditor((state) => state.placingBlock);
  const startPlacing = useEditor((state) => state.startPlacing);
  const stopPlacing = useEditor((state) => state.stopPlacing);
  const active = placingBlock === shape.id;

  // A snapshot can reach this list a moment before the block registry.
  if (!hasBlock(shape.id)) return null;
  return (
    <div className={`block-card shape-card ${active ? "active" : ""}`}>
      <button className="shape-main" title={`Colocar ${shape.name} na cena`} onClick={() => (active ? stopPlacing() : startPlacing(shape.id))}>
        <Thumbnail block={getBlock(shape.id)} />
        <span className="block-name">{shape.name}</span>
      </button>
      <span className="shape-actions">
        <button className="icon-button" title="Fazer uma cópia independente" aria-label={`Copiar ${shape.name}`} onClick={() => void duplicateShape(shape)}>
          <Copy size={13} />
        </button>
        <button className="icon-button" title="Apagar a forma e as peças que a usam" aria-label={`Apagar ${shape.name}`} onClick={() => void removeShape(shape.id)}>
          <Trash2 size={13} />
        </button>
      </span>
    </div>
  );
}

export function ShapePanel() {
  const shapes = useEditor((state) => state.snapshot?.project.shapes);

  return (
    <div className="dock-body browser">
      <div className="block-scroll">
        <div className="section-head">
          <h2>Modelar do zero</h2>
          <p>Escolha uma forma para começar e molde do seu jeito.</p>
        </div>
        <div className="block-grid">
          {BASE_SHAPES.map((base) => (
            <BaseCard key={base.id} base={base} />
          ))}
        </div>

        <div className="section-head shapes-head">
          <h2>Minhas formas</h2>
          <p>
            {shapes && shapes.length > 0
              ? "Clique para colocar mais. Alterar uma forma muda todas as peças que a usam."
              : "As formas que você ou o agente criarem aparecem aqui."}
          </p>
        </div>
        {shapes && shapes.length > 0 && (
          <div className="block-grid">
            {shapes.map((shape) => (
              <ShapeCard key={shape.id} shape={shape} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
