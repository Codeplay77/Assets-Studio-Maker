import type { Vec3 } from "../core/types";
import { BAKED_WHEEL_IDS, KART_HELMETS, KART_IDS, KART_SCALES, KART_SPOILERS } from "../blocks/definitions/family/baked.ts";
import { STYLE_PREFIX, type ArtStyle } from "../blocks/styles";
import type { AssembledPart, Assembler } from "./assembler";
import type { Rng } from "./rng";

/** The colors a person can pick for any part of the Arcade family. */
export const PAINT_PALETTE = [
  "#e8202a", "#ff6a00", "#ffc400", "#9be600", "#18c46a", "#00c2c7", "#1e7bff", "#2b2fd9",
  "#8a2be2", "#ff3fa4", "#f4f4f4", "#9aa0a8", "#3a3f47", "#121316", "#7a4a26", "#d4af37",
];

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

export interface KartOptions {
  style?: ArtStyle;
  position?: Vec3;
  yawSteps?: number;
  body?: string;
  wheels?: string;
  spoiler?: string;
  helmet?: string;
  driver?: string;
  paint?: string;
  trim?: string;
  accent?: string;
  rim?: string;
  suit?: string;
  helmetColor?: string;
}

/** Stacks a model's color layers on its base block. Layers a model does not have are skipped. */
export function addLayers(
  asm: Assembler,
  base: AssembledPart,
  id: string,
  colors: { paint?: string; trim?: string; accent?: string; rim?: string },
): void {
  for (const [slot, color] of Object.entries(colors)) {
    if (asm.hasBlock(`${id}_${slot}`)) asm.overlay(base, `${id}_${slot}`, { color });
  }
}

/** Fits a family wheel on a socket and adds its colored band when it has one. */
export function addWheel(
  asm: Assembler,
  body: AssembledPart,
  socket: string,
  prefix: string,
  wheel: string,
  scale: number,
  colors: { rim: string; band: string },
): void {
  const part = asm.attach(body, socket, `${prefix}.wheel_${wheel}_rim`, { scale, color: colors.rim });
  if (asm.hasBlock(`${prefix}.wheel_${wheel}_band`)) asm.overlay(part, `${prefix}.wheel_${wheel}_band`, { color: colors.band });
}

/** Keeps two random colors from coming out the same. */
export function differentColor(rng: Rng, other: string): string {
  let color = rng.pick(PAINT_PALETTE);
  for (let i = 0; i < 8 && color === other; i++) color = rng.pick(PAINT_PALETTE);
  return color;
}

export function buildKart(asm: Assembler, rng: Rng, options: KartOptions = {}): void {
  const prefix = STYLE_PREFIX[options.style ?? "arcade"];
  const bodyId = chosen(options.body) ?? rng.fork("body").pick(KART_IDS);
  const scales = KART_SCALES[bodyId];
  const wheelId = chosen(options.wheels) ?? rng.fork("wheels").pick(BAKED_WHEEL_IDS.filter((id) => id !== "caminhao"));
  const spoilerId = chosen(options.spoiler) ?? rng.fork("spoiler").pick(["none", ...Object.keys(KART_SPOILERS)]);
  const helmetId = chosen(options.helmet) ?? rng.fork("helmet").pick(Object.keys(KART_HELMETS));

  const paint = chosen(options.paint) ?? rng.fork("paint").pick(PAINT_PALETTE);
  const trim = chosen(options.trim) ?? differentColor(rng.fork("trim"), paint);
  const accent = chosen(options.accent) ?? differentColor(rng.fork("accent"), paint);
  const rim = chosen(options.rim) ?? rng.fork("rim").pick(["#9aa0a8", "#f4f4f4", "#d4af37", "#3a3f47", paint]);
  const suit = chosen(options.suit) ?? differentColor(rng.fork("suit"), paint);
  const helmetColor = chosen(options.helmetColor) ?? rng.fork("helmet color").pick(["#f4f4f4", paint, trim, "#121316"]);

  const id = `${prefix}.kart_${bodyId}`;
  const base = asm.add(`${id}_base`, options.position ?? [0, 0, 0], { yawSteps: options.yawSteps });
  addLayers(asm, base, id, { paint, trim, accent });

  for (const [socket, scale] of [["wheel_fl", scales.front], ["wheel_fr", scales.front], ["wheel_rl", scales.rear], ["wheel_rr", scales.rear]] as const) {
    addWheel(asm, base, socket, prefix, wheelId, scale, { rim, band: accent });
  }

  if (spoilerId !== "none") {
    const wingId = `${prefix}.kart_spoiler_${spoilerId}`;
    const wing = asm.attach(base, "spoiler", `${wingId}_base`);
    addLayers(asm, wing, wingId, { paint, trim, accent });
  }

  asm.attach(base, "steering", `${prefix}.kart_steering`, { color: accent });
  if (options.driver !== "no") {
    const driver = asm.attach(base, "driver", `${prefix}.kart_driver`, { color: suit });
    addLayers(asm, driver, `${prefix}.kart_driver`, { paint, trim, accent });
    const helmetBlock = `${prefix}.kart_helmet_${helmetId}`;
    const shell = asm.overlay(driver, `${helmetBlock}_base`, { color: helmetColor });
    asm.overlay(shell, `${helmetBlock}_stripe`, { color: accent });
  }
}
