import { useState } from "react";
import { Check, Copy, KeyRound, X } from "lucide-react";
import * as api from "../core/api";
import { useEditor, type AgentStatus } from "../core/store";

const SERVER_NAME = "assets-studio-maker";
const COPIED_MS = 1800;
/** The key stays out of the screen, which is often being recorded. */
const HIDDEN_KEY = "••••••••";

function claudeCommand(url: string, key: string): string {
  return `claude mcp add --transport http ${SERVER_NAME} ${url} --header "Authorization: Bearer ${key}"`;
}

function jsonConfig(url: string, key: string): string {
  const config = {
    mcpServers: {
      [SERVER_NAME]: { type: "http", url, headers: { Authorization: `Bearer ${key}` } },
    },
  };
  return JSON.stringify(config, null, 2);
}

function CopyBox({ title, shown, copied: value }: { title: string; shown: string; copied: string }) {
  const report = useEditor((state) => state.report);
  const [done, setDone] = useState(false);

  const copy = () => {
    navigator.clipboard
      .writeText(value)
      .then(() => {
        setDone(true);
        window.setTimeout(() => setDone(false), COPIED_MS);
      })
      .catch(report);
  };

  return (
    <div className="copy-box">
      <div className="copy-box-head">
        <strong>{title}</strong>
        <button className="button small" onClick={copy}>
          {done ? <Check size={13} /> : <Copy size={13} />}
          {done ? "Copiado" : "Copiar"}
        </button>
      </div>
      <pre>{shown}</pre>
    </div>
  );
}

export function AgentDialog() {
  const status = useEditor((state) => state.agentStatus);
  const setAgentStatus = useEditor((state) => state.setAgentStatus);
  const setAgentOpen = useEditor((state) => state.setAgentOpen);
  const report = useEditor((state) => state.report);
  const [busy, setBusy] = useState(false);

  const run = (action: () => Promise<AgentStatus>) => {
    setBusy(true);
    action()
      .then(setAgentStatus)
      .catch(report)
      .finally(() => setBusy(false));
  };

  const close = () => setAgentOpen(false);
  const running = status?.running ?? false;

  return (
    <div className="modal-backdrop">
      <section className="modal agent-modal glass" role="dialog" aria-label="Agente de IA">
        <header className="inspector-head">
          <div>
            <small>Servidor MCP local</small>
            <h2>Agente de IA</h2>
          </div>
          <button className="icon-button" onClick={close} aria-label="Fechar">
            <X size={16} />
          </button>
        </header>

        <p className="modal-text">
          Deixe um agente de IA montar modelos neste editor. Tudo o que ele fizer aparece na hora, e
          você desfaz com Ctrl+Z.
        </p>

        <label className="option">
          <span>
            <strong>Permitir agentes neste computador</strong>
            <small>{running ? "Ligado, aguardando conexões" : "Desligado"}</small>
          </span>
          <span className="switch">
            <input
              type="checkbox"
              aria-label="Permitir agentes neste computador"
              checked={status?.enabled ?? false}
              disabled={busy || !status}
              onChange={(event) => {
                const enabled = event.target.checked;
                run(() => api.setAgentEnabled(enabled));
              }}
            />
            <i aria-hidden />
          </span>
        </label>

        {status?.error && <p className="agent-error">{status.error}</p>}

        {running && status && (
          <>
            <CopyBox
              title="Claude Code"
              shown={claudeCommand(status.url, HIDDEN_KEY)}
              copied={claudeCommand(status.url, status.key)}
            />
            <CopyBox
              title="Outros agentes (JSON)"
              shown={jsonConfig(status.url, HIDDEN_KEY)}
              copied={jsonConfig(status.url, status.key)}
            />
            <div className="agent-key-row">
              <small>O que você copia contém a chave de acesso. Não compartilhe.</small>
              <button className="button small" disabled={busy} onClick={() => run(api.replaceAgentKey)}>
                <KeyRound size={13} /> Trocar chave
              </button>
            </div>
          </>
        )}
      </section>
    </div>
  );
}
