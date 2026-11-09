import type { EditorViewport } from "./EditorViewport";

let current: EditorViewport | null = null;

/** The viewport on screen, for code that lives outside React. */
export function activeViewport(): EditorViewport | null {
  return current;
}

export function setActiveViewport(viewport: EditorViewport | null): void {
  current = viewport;
}
