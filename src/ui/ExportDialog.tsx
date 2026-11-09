import { useMemo, useState } from "react";
import { Download, LoaderCircle, X } from "lucide-react";
import { useEditor, useSelectedParts } from "../core/store";
import { countTriangles } from "../export/glb";
import { exportParts } from "./actions";

function formatCount(value: number): string {
  return value.toLocaleString("pt-BR");
}

function Toggle({
  checked,
  onChange,
  title,
  hint,
}: {
  checked: boolean;
  onChange(value: boolean): void;
  title: string;
  hint: string;
}) {
  return (
    <label className="option">
      <span>
        <strong>{title}</strong>
        <small>{hint}</small>
      </span>
      <span className="switch">
        <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
        <i aria-hidden />
      </span>
    </label>
  );
}

export function ExportDialog() {
  const setExportOpen = useEditor((state) => state.setExportOpen);
  const project = useEditor((state) => state.snapshot?.project);
  const selected = useSelectedParts();

  const [onlySelection, setOnlySelection] = useState(selected.length > 0);
  const [merge, setMerge] = useState(false);
  const [center, setCenter] = useState(true);
  const [busy, setBusy] = useState(false);

  const parts = onlySelection && selected.length > 0 ? selected : (project?.parts ?? []);
  const triangles = useMemo(() => countTriangles(parts), [parts]);
  const close = () => setExportOpen(false);

  const run = async () => {
    setBusy(true);
    // Gives the button a frame to show progress before the export takes over.
    await new Promise((resolve) => requestAnimationFrame(resolve));
    const done = await exportParts(parts, { merge, center, name: project?.name ?? "Modelo" });
    setBusy(false);
    if (done) close();
  };

  return (
    <div className="modal-backdrop">
      <section className="modal glass" role="dialog" aria-label="Exportar GLB">
        <header className="inspector-head">
          <div>
            <small>Formato aberto, aceito pelas principais engines</small>
            <h2>Exportar GLB</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <div className="stats">
          <div>
            <strong>{formatCount(parts.length)}</strong>
            <small>{parts.length === 1 ? "peça" : "peças"}</small>
          </div>
          <div>
            <strong>{formatCount(triangles)}</strong>
            <small>triângulos</small>
          </div>
        </div>

        {selected.length > 0 && (
          <Toggle
            checked={onlySelection}
            onChange={setOnlySelection}
            title="Só o que está selecionado"
            hint={`${selected.length} de ${project?.parts.length ?? 0} peças`}
          />
        )}
        <Toggle
          checked={merge}
          onChange={setMerge}
          title="Juntar em uma malha só"
          hint="Mais leve no jogo, mas as peças não podem mais ser separadas"
        />
        <Toggle
          checked={center}
          onChange={setCenter}
          title="Centralizar na origem"
          hint="Coloca a base do modelo no ponto zero"
        />

        <div className="actions">
          <button className="button" onClick={close}>
            Cancelar
          </button>
          <button className="button primary" onClick={() => void run()} disabled={busy || parts.length === 0}>
            {busy ? <LoaderCircle size={15} className="spin" /> : <Download size={15} />}
            {busy ? "Exportando…" : "Exportar"}
          </button>
        </div>
      </section>
    </div>
  );
}
