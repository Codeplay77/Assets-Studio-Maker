import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { Command, EditorSnapshot, PartId } from "./types";

export const getState = () => invoke<EditorSnapshot>("get_state");
export const applyCommand = (command: Command) => invoke<PartId[]>("apply_command", { command });
export const undo = () => invoke<void>("undo");
export const redo = () => invoke<void>("redo");

export function onStateChanged(handler: (snapshot: EditorSnapshot) => void): Promise<UnlistenFn> {
  return listen<EditorSnapshot>("state-changed", (event) => handler(event.payload));
}
