import { useEditor } from "../core/store";
import { saveProject } from "./actions";

export function UnsavedDialog() {
  const prompt = useEditor((state) => state.unsavedPrompt);
  const setPrompt = useEditor((state) => state.setUnsavedPrompt);
  if (!prompt) return null;

  const continueAfterSave = async () => {
    setPrompt(null);
    if (await saveProject()) prompt.next();
  };

  return (
    <div className="modal-backdrop">
      <section className="modal glass" role="alertdialog" aria-label="Alterações não salvas">
        <header className="inspector-head">
          <div>
            <h2>Salvar as alterações?</h2>
          </div>
        </header>
        <p className="modal-text">Se continuar sem salvar, o que você fez desde a última vez será perdido.</p>
        <div className="actions">
          <button className="button" onClick={() => setPrompt(null)}>
            Cancelar
          </button>
          <button
            className="button danger"
            onClick={() => {
              setPrompt(null);
              prompt.next();
            }}
          >
            Não salvar
          </button>
          <button className="button primary" onClick={() => void continueAfterSave()}>
            Salvar
          </button>
        </div>
      </section>
    </div>
  );
}
