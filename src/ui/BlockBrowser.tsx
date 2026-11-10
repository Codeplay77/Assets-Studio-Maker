import { memo, useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { blocks, categories, isColorLayer } from "../blocks/catalog";
import { ART_STYLES, styleOfBlock, type ArtStyle } from "../blocks/styles";
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
    return blocks.filter((block) => ids.has(block.category) && !isColorLayer(block.id));
  }, [groupCategories]);

  const [category, setCategory] = useState(groupCategories[0].id);
  const [search, setSearch] = useState("");
  const placingBlock = useEditor((state) => state.placingBlock);
  const artStyle = useEditor((state) => state.artStyle);
  /** Null follows the style chosen for the project; "all" shows everything. */
  const [styleFilter, setStyleFilter] = useState<ArtStyle | "all" | null>(null);
  // The ready-made library has no realistic models, so an empty list would only look broken.
  const styleHasItems = useMemo(() => groupBlocks.some((block) => styleOfBlock(block.id) === artStyle), [artStyle, groupBlocks]);
  const activeStyle = styleFilter ?? (styleHasItems ? artStyle : "all");

  const styledBlocks = useMemo(
    () =>
      activeStyle === "all"
        ? groupBlocks
        : groupBlocks.filter((block) => [activeStyle, null].includes(styleOfBlock(block.id))),
    [activeStyle, groupBlocks],
  );
  const usedCategories = useMemo(() => {
    const used = new Set(styledBlocks.map((block) => block.category));
    return groupCategories.filter((item) => used.has(item.id));
  }, [groupCategories, styledBlocks]);
  const currentCategory = usedCategories.some((item) => item.id === category) ? category : usedCategories[0]?.id;

  const term = search.trim().toLowerCase();
  const visible = useMemo(
    () =>
      term
        ? styledBlocks.filter(
            (block) => block.name.toLowerCase().includes(term) || block.id.toLowerCase().includes(term),
          )
        : styledBlocks.filter((block) => block.category === currentCategory),
    [currentCategory, styledBlocks, term],
  );

  return (
    <div className="dock-body browser">
      <div className="search">
        <Search size={15} />
        <input
          aria-label="Buscar modelos e peças"
          placeholder={`Buscar em ${styledBlocks.length} itens…`}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {search && (
          <button className="icon-button" onClick={() => setSearch("")} aria-label="Limpar busca">
            <X size={14} />
          </button>
        )}
      </div>

      <div className="style-filter" role="radiogroup" aria-label="Filtrar por estilo">
        {ART_STYLES.map(({ id, name }) => (
          <button key={id} role="radio" aria-checked={activeStyle === id} className={activeStyle === id ? "active" : ""} onClick={() => setStyleFilter(id)}>
            {name}
          </button>
        ))}
        <button role="radio" aria-checked={activeStyle === "all"} className={activeStyle === "all" ? "active" : ""} onClick={() => setStyleFilter("all")}>
          Todos
        </button>
      </div>

      <div className="chips">
        {usedCategories.map(({ id, name }) => (
          <button
            key={id}
            className={`chip ${!term && currentCategory === id ? "active" : ""}`}
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
        {visible.length === 0 && (
          <p className="empty">{search ? `Nada encontrado para “${search}”.` : "Este estilo não tem itens aqui. Escolha outro estilo acima."}</p>
        )}
      </div>

      {group === "library" && <p className="credit">Modelos CC0 por Kenney (kenney.nl)</p>}
    </div>
  );
}
