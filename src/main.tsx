import "@fontsource-variable/inter";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { loadModelPack } from "./blocks/modelPack";
import { startAgentBridge } from "./mcp/bridge";
import { App } from "./ui/App";
import "./ui/styles.css";

const root = createRoot(document.getElementById("root")!);

loadModelPack()
  .then(() => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
    startAgentBridge().catch((error: unknown) => console.error(error));
  })
  .catch((error: unknown) => {
    root.render(<p className="fatal">Não foi possível carregar a biblioteca de modelos: {String(error)}</p>);
  });
