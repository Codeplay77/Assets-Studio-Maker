import { memo, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { blocks, categories } from "../blocks/catalog";
import type { BlockCategory, BlockDef } from "../blocks/types";
import { useEditor } from "../core/store";
import { useThumbnail } from "../viewport/thumbnails";

const BlockCard = memo(function BlockCard({ block, active }: { block: BlockDef; active: boolean }) {
  const startPlacing = useEditor((state) => state.startPlacing);
  const stopPlacing = useEditor((state) => state.stopPlacing);
  const thumbnail = useThumbnail(block);

  return (
    <button
      className={`block-card ${active ? "active" : ""}`}
      onClick={() => (active ? stopPlacing() : startPlacing(block.id))}
      title={block.name}
    >
      <span className="block-thumb">
        {thumbnail ? <img src={thumbnail} alt="" draggable={false} /> : <span className="shimmer" />}
      </span>
      <span className="block-name">{block.name}</span>
    </button>
  );
});

export function BlockBrowser({ group }: { group: BlockCategory["group"] }) {
  const groupCategories = useMemo(() => categories.filter((item) => item.group === group), [group]);
  const groupBlocks = useMemo(() => {
    const ids = new Set(groupCategories.map((item) => item.id));
    return blocks.filter((block) => ids.has(block.category));
  }, [groupCategories]);

  const [category, setCategory] = useState(groupCategories[0].id);
  const [search, setSearch] = useState("");
  const placingBlock = useEditor((state) => state.placingBlock);

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term
        ? groupBlocks.filter(
            (block) => block.name.toLowerCase().includes(term) || block.id.toLowerCase().includes(term),
          )
        : groupBlocks.filter((block) => block.category === category),
    [category, groupBlocks, term],
  );

  return (
    <div className="dock-body browser">
      <div className="search">
        <Search size={15} />
        <input
          placeholder={`Buscar em ${groupBlocks.length} itens…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button className="icon-button" onClick={() => setSearch("")} aria-label="Limpar busca">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="chips">
        {groupCategories.map(({ id, name }) => (
          <button
            key={id}
            className={`chip ${!term && category === id ? "active" : ""}`}
            onClick={() => {
              setCategory(id);
              setSearch("");
            }}
          >
            {name}
          </button>
        ))}
      </div>

      <div className="block-scroll">
        <div className="block-grid">
          {visible.map((block) => (
            <BlockCard key={block.id} block={block} active={placingBlock === block.id} />
          ))}
        </div>
        {visible.length === 0 && <p className="empty">Nada encontrado para “{search}”.</p>}
      </div>

      {group === "library" && <p className="credit">Modelos CC0 por Kenney (kenney.nl)</p>}
    </div>
  );
}
