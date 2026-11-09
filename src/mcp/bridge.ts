import * as api from "../core/api";
import { useEditor } from "../core/store";
import type { PartId } from "../core/types";
import { exportGlb } from "../export/glb";
import { generate } from "../ui/actions";
import { activeViewport } from "../viewport/active";
import type { CaptureView } from "../viewport/EditorViewport";
import { callTool, listTools, toolActivity, type ToolDeps } from "./tools";

const ACTIVITY_MS = 2500;

function requireViewport() {
  const viewport = activeViewport();
  if (!viewport) throw new Error("o viewport ainda não está pronto");
  return viewport;
}

/** The viewport normally updates a moment later, which is too late for a picture. */
async function syncedViewport() {
  const viewport = requireViewport();
  const snapshot = await api.getState();
  useEditor.getState().receiveSnapshot(snapshot);
  viewport.setProject(snapshot.project);
  return viewport;
}

const deps: ToolDeps = {
  getState: api.getState,
  apply: api.applyCommand,
  undo: api.undo,
  redo: api.redo,
  async generate(generator, seed, keep) {
    const created = await generate(generator, seed, keep);
    if (!created) throw new Error("não foi possível gerar o modelo");
    return created;
  },
  async capture(view: CaptureView, width: number, height: number, ids?: PartId[]) {
    return (await syncedViewport()).capture(view, width, height, ids);
  },
  async frame() {
    (await syncedViewport()).focus(true);
  },
  exportGlb,
  saveExport: api.saveAgentGlb,
};

let activityTimer = 0;

function showActivity(activity: string): void {
  useEditor.getState().setAgentActivity(activity);
  window.clearTimeout(activityTimer);
  activityTimer = window.setTimeout(() => useEditor.getState().setAgentActivity(null), ACTIVITY_MS);
}

async function answer(call: api.AgentCall): Promise<unknown> {
  if (call.method === "list") return listTools();

  const { name, arguments: args } = call.params;
  const activity = toolActivity(name);
  if (activity) showActivity(activity);
  return callTool(name, args, deps);
}

/** Runs once, outside React, so a call can never be answered twice. */
export async function startAgentBridge(): Promise<void> {
  await api.onAgentCall((call) => {
    answer(call)
      .then((result) => api.replyToAgent(call.id, result, null))
      .catch((error: unknown) => api.replyToAgent(call.id, null, String(error)));
  });
  useEditor.getState().setAgentStatus(await api.agentBridgeReady());
}
