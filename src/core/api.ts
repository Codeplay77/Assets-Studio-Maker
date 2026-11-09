import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { AgentStatus, Command, EditorSnapshot, PartId } from "./types";

export const getState = () => invoke<EditorSnapshot>("get_state");
export const applyCommand = (command: Command) => invoke<PartId[]>("apply_command", { command });
export const undo = () => invoke<void>("undo");
export const redo = () => invoke<void>("redo");
export const newProject = () => invoke<void>("new_project");

/** Resolves to false when the person cancels the save dialog. */
export const saveProject = (saveAs: boolean) => invoke<boolean>("save_project", { saveAs });
export const openProject = () => invoke<boolean>("open_project");

/** Asks where to save and writes the file. Resolves to the path, or null if canceled. */
export const saveGlb = (bytes: Uint8Array) => invoke<string | null>("save_glb", bytes);

/** Saves an agent's export in the fixed folder and resolves to its path. */
export const saveAgentGlb = (name: string, bytes: Uint8Array) =>
  invoke<string>("save_agent_glb", bytes, { headers: { "x-file-name": encodeURIComponent(name) } });

export const agentBridgeReady = () => invoke<AgentStatus>("agent_bridge_ready");
export const setAgentEnabled = (enabled: boolean) => invoke<AgentStatus>("set_agent_enabled", { enabled });
export const replaceAgentKey = () => invoke<AgentStatus>("replace_agent_key");
export const replyToAgent = (id: number, result: unknown, error: string | null) =>
  invoke<void>("agent_reply", { id, result, error });

export type AgentCall =
  | { id: number; method: "list"; params: Record<string, never> }
  | { id: number; method: "call"; params: { name?: unknown; arguments?: unknown } };

export function onAgentCall(handler: (call: AgentCall) => void): Promise<UnlistenFn> {
  return listen<AgentCall>("mcp-call", (event) => handler(event.payload));
}

export function onStateChanged(handler: (snapshot: EditorSnapshot) => void): Promise<UnlistenFn> {
  return listen<EditorSnapshot>("state-changed", (event) => handler(event.payload));
}
