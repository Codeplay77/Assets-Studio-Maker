import type { ArtStyle } from "./types";

export type { ArtStyle };

export const ART_STYLES: { id: ArtStyle; name: string; hint: string }[] = [
  { id: "lowpoly", name: "Low poly", hint: "Polígonos à vista, leve e colorido" },
  { id: "realistic", name: "Realista", hint: "Proporções reais, pintura com verniz e o interior visível pelos vidros" },
  { id: "blocks", name: "Blocos", hint: "Tudo feito de cubos" },
  { id: "arcade", name: "Arcade", hint: "Brinquedos: curtos, redondos e de rodas grandes, como no Codeplay in Kart" },
];

/** Blocks made for one style start with its prefix; the catalog's older blocks have none. */
export const STYLE_PREFIX: Record<ArtStyle, string> = { lowpoly: "lp", realistic: "rz", blocks: "vx", arcade: "ar" };

export const DEFAULT_STYLE: ArtStyle = "lowpoly";

/** The style a catalog block belongs to. Plain shapes and project shapes fit any style. */
export function styleOfBlock(id: string): ArtStyle | null {
  if (id.startsWith("basic.") || id.startsWith("shape.") || id.startsWith("@")) return null;
  if (id.startsWith("vx.") || id.startsWith("kit.blocky.")) return "blocks";
  if (id.startsWith("lp.") || id.startsWith("kit.")) return "lowpoly";
  if (id.startsWith("ar.")) return "arcade";
  return "realistic";
}

/** The style of a list of blocks: that of the first one that has a style. */
export function blocksStyle(ids: readonly string[]): ArtStyle | null {
  for (const id of ids) {
    const style = styleOfBlock(id);
    if (style) return style;
  }
  return null;
}

export function styleName(style: ArtStyle): string {
  return ART_STYLES.find(({ id }) => id === style)!.name;
}
