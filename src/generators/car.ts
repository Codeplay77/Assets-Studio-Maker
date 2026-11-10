import { BAKED_SPECS, bakedModels, BAKED_WHEEL_IDS, BAKED_WHEEL_WIDTH, KART_IDS, KART_NAMES, WHEEL_RADIUS, type Axle } from "../blocks/definitions/family/baked.ts";
import { STYLE_PREFIX, type ArtStyle } from "../blocks/styles";
import type { Vec3 } from "../core/types";
import type { AssembledPart, Assembler } from "./assembler";
import { addLayers, addWheel, buildKart, differentColor, PAINT_PALETTE } from "./kart";
import { KIT_TRACTORS } from "./kit";
import type { Rng } from "./rng";

/** Every kind of vehicle and its models. They are the same in all the art styles. */
const MODELS: Record<string, string[]> = {
  car: ["sedan", "sedan_luxo", "hatch", "perua", "compacto", "conversivel", "classico", "eletrico"],
  sport: ["coupe", "hatch_esportivo", "muscle", "super"],
  suv: ["suv_compacto", "suv_medio", "suv_grande", "jipe", "suv_esportivo"],
  pickup: ["picape", "picape_dupla", "picape_classica"],
  van: ["van", "furgao"],
  truck: bakedModels("truck").filter((id) => id !== "caminhao_bombeiros"),
  bus: bakedModels("bus"),
  semi: bakedModels("semi"),
  moto: bakedModels("moto"),
  kart: KART_IDS,
  race: ["super", "muscle", "coupe"],
  taxi: ["sedan", "hatch"],
  police: ["policia_sedan", "policia_suv"],
  ambulance: ["ambulancia"],
  firetruck: ["caminhao_bombeiros"],
};

/** Paint that a service vehicle always has, whatever was picked. */
const SERVICE_PAINT: Record<string, { paint: string; trim: string; accent: string }> = {
  taxi: { paint: "#ffc400", trim: "#121316", accent: "#f4f4f4" },
  police: { paint: "#1c2233", trim: "#f4f4f4", accent: "#e8202a" },
  ambulance: { paint: "#f4f4f4", trim: "#e8202a", accent: "#e8202a" },
  firetruck: { paint: "#e8202a", trim: "#f4f4f4", accent: "#ffc400" },
};

export const VEHICLE_KINDS = Object.keys(MODELS);
/** Tractors only exist in the low poly library. */
export const kindsOf = (style: ArtStyle) => (style === "lowpoly" ? [...VEHICLE_KINDS, "tractor"] : VEHICLE_KINDS);
export const modelsOf = (kind: string | undefined) => (kind ? (MODELS[kind] ?? []) : []);
export const vehicleModelName = (id: string) => BAKED_SPECS[id]?.name ?? KART_NAMES[id] ?? id;

export interface VehicleOptions {
  style: ArtStyle;
  kind?: string;
  model?: string;
  paint?: string;
  trim?: string;
  accent?: string;
  rim?: string;
  wheels?: string;
  position?: Vec3;
  yawSteps?: number;
  spoiler?: string;
  driver?: string;
  helmet?: string;
  suit?: string;
  helmetColor?: string;
}

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

/** The colors real vehicles come in: mostly whites, silvers and darks, some reds and blues. */
const REAL_PAINTS = [
  "#f1f1ee", "#f1f1ee", "#e6e3da", "#c9ccd1", "#c9ccd1", "#8b9097", "#4a4f56", "#15171a", "#15171a",
  "#7a1016", "#b8181f", "#1d3557", "#2f5f8f", "#2a4536", "#b7a98c", "#5b3c2a",
];
const REAL_RIMS = ["#c3c7cc", "#c3c7cc", "#9aa0a8", "#3a3f47", "#dcdee1"];
/** Trims and racks of trucks and buses: white, aluminum or black. */
const REAL_TRIMS = ["#f1f1ee", "#c9ccd1", "#2a2c31"];

function pickReal(rng: Rng, list: string[], other: string): string {
  let color = rng.pick(list);
  for (let i = 0; i < 8 && color === other; i++) color = rng.pick(list);
  return color;
}

interface VehicleColors {
  paint: string;
  trim: string;
  accent: string;
  rim: string;
}

/** Space between the two tires of a dual wheel, in the units of the wheel. */
const DUAL_GAP = 0.012;

function fitWheels(asm: Assembler, body: AssembledPart, axles: Axle[], prefix: string, wheel: string, colors: VehicleColors, dual: boolean): void {
  axles.forEach((axle, index) => {
    const scale = axle.radius / WHEEL_RADIUS;
    for (const side of ["l", "r"]) {
      const socket = `wheel_${index}_${side}`;
      addWheel(asm, body, socket, prefix, wheel, scale, { rim: colors.rim, band: colors.accent });
      if (!dual || !axle.dual) continue;
      // The inner tire sits right behind the outer one, toward the middle of the vehicle.
      const from = asm.parts.length;
      addWheel(asm, body, socket, prefix, wheel, scale, { rim: colors.rim, band: colors.accent });
      const inward = asm.socketOf(body, socket).normal.clone().multiplyScalar(-(BAKED_WHEEL_WIDTH[wheel] + DUAL_GAP) * scale);
      for (const part of asm.parts.slice(from)) part.position.add(inward);
    }
  });
}

function buildModel(asm: Assembler, rng: Rng, options: VehicleOptions, kind: string): void {
  const prefix = STYLE_PREFIX[options.style];
  const models = MODELS[kind];
  const model = chosen(options.model) && models.includes(options.model!) ? options.model! : rng.fork("model").pick(models);
  const spec = BAKED_SPECS[model];

  const service = SERVICE_PAINT[kind];
  // A colored stripe on the tire suits sports and race cars, not a family car or a truck.
  const racing = kind === "sport" || kind === "race";
  // Realista uses real-world vehicle colors; the other styles keep the bright toy palette.
  const real = options.style === "realistic";
  const heavy = spec.group === "truck" || spec.group === "bus" || spec.group === "semi";
  const paint = service?.paint ?? chosen(options.paint) ?? (real ? rng.fork("paint").pick(REAL_PAINTS) : rng.fork("paint").pick(PAINT_PALETTE));
  const trim =
    service?.trim ??
    chosen(options.trim) ??
    (!real ? differentColor(rng.fork("trim"), paint) : racing ? pickReal(rng.fork("trim"), REAL_PAINTS, paint) : heavy ? pickReal(rng.fork("trim"), REAL_TRIMS, paint) : paint);
  const accent = service?.accent ?? chosen(options.accent) ?? (real && !racing ? pickReal(rng.fork("accent"), REAL_PAINTS, paint) : differentColor(rng.fork("accent"), paint));
  const rim = chosen(options.rim) ?? rng.fork("rim").pick(real ? REAL_RIMS : ["#9aa0a8", "#f4f4f4", "#d4af37", "#3a3f47"]);
  // Arcade tires always wear the colored band, like the karts of the game.
  const colors = { paint, trim, accent: (racing && !real) || options.style === "arcade" ? accent : "#2a2c31", rim };
  const wheel = chosen(options.wheels) ?? spec.wheel ?? rng.fork("wheels").pick(BAKED_WHEEL_IDS);
  // The Arcade models are shorter and have bigger wheels; only the Realista ones have dual tires.
  const arcade = options.style === "arcade";
  const dual = options.style === "realistic";

  const id = `${prefix}.veh_${spec.trailer ? spec.tractor : model}`;
  const base = asm.add(`${id}_base`, options.position ?? [0, 0, 0], { yawSteps: options.yawSteps });
  addLayers(asm, base, id, { paint, trim, accent, rim });
  fitWheels(asm, base, (arcade && spec.arcadeAxles) || spec.axles, prefix, wheel, colors, dual);

  if (spec.trailer) {
    const trailerId = `${prefix}.veh_${spec.trailer}`;
    const trailer = asm.attach(base, "hitch", `${trailerId}_base`);
    const trailerPaint = real ? pickReal(rng.fork("trailer"), ["#f1f1ee", "#f1f1ee", "#c9ccd1", "#1d3557", "#7a1016", "#2a4536"], "") : differentColor(rng.fork("trailer"), trim);
    addLayers(asm, trailer, trailerId, { paint: trailerPaint, trim, accent });
    fitWheels(asm, trailer, (arcade && spec.arcadeTrailerAxles) || spec.trailerAxles!, prefix, wheel, colors, dual);
  }
  if (kind === "taxi") asm.attach(base, "roof", `${prefix}.veh_taxi_sign`, { color: "#ffc400" });
  if (kind === "police" || kind === "ambulance") asm.attach(base, "roof", `${prefix}.veh_siren`);
}

export function buildVehicle(asm: Assembler, rng: Rng, options: VehicleOptions): void {
  const wanted = chosen(options.kind);
  if (wanted === "tractor" && options.style === "lowpoly") {
    asm.add(rng.fork("model").pick(KIT_TRACTORS), options.position ?? [0, 0, 0], { yawSteps: options.yawSteps });
    return;
  }
  const kind = wanted && MODELS[wanted] ? wanted : rng.fork("kind").pick(["car", "car", "suv", "pickup", "sport", "van", "truck", "bus", "semi", "moto", "kart", "taxi", "police", "ambulance", "firetruck"]);
  if (kind === "kart") buildKart(asm, rng, { ...options, body: options.model });
  else buildModel(asm, rng, options, kind);
}
