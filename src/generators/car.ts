import type { Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import type { Rng } from "./rng";

const PAINT = [
  "#c23b3b", "#2f7fd1", "#e8e4d8", "#23252c", "#8a939f", "#e0a81f", "#3a7d6b", "#7a3fd1", "#f26b1d", "#d6dde6",
];

type WheelKind = "steel" | "sport" | "star" | "whitewall" | "offroad" | "heavy" | "slick" | "kart";

const WHEEL_RADIUS: Record<WheelKind, number> = {
  steel: 0.33,
  sport: 0.34,
  star: 0.33,
  whitewall: 0.33,
  offroad: 0.42,
  heavy: 0.52,
  slick: 0.33,
  kart: 0.14,
};

interface CarKind {
  radius: number;
  wheels: WheelKind[];
}

export const CAR_KINDS: Record<string, CarKind> = {
  sedan: { radius: 0.33, wheels: ["steel", "star", "whitewall", "sport"] },
  hatch: { radius: 0.31, wheels: ["steel", "star", "sport"] },
  suv: { radius: 0.42, wheels: ["offroad", "star", "sport"] },
  pickup: { radius: 0.4, wheels: ["offroad", "steel"] },
  sport: { radius: 0.34, wheels: ["sport", "star"] },
  van: { radius: 0.36, wheels: ["steel"] },
  bus: { radius: 0.52, wheels: ["heavy"] },
  truck: { radius: 0.5, wheels: ["heavy"] },
  race: { radius: 0.33, wheels: ["slick"] },
  kart: { radius: 0.14, wheels: ["kart"] },
};

export const STREET_CARS = ["sedan", "hatch", "suv", "pickup", "sport", "van"];
const ALL_CARS = Object.keys(CAR_KINDS);

export interface CarOptions {
  position?: Vec3;
  yawSteps?: number;
  kind?: string;
  color?: string;
}

export function buildCar(asm: Assembler, rng: Rng, options: CarOptions = {}): void {
  const kindName = options.kind ?? rng.pick(ALL_CARS);
  const kind = CAR_KINDS[kindName];
  const special = kindName === "sedan" ? rng.pick(["none", "none", "taxi", "police"]) : "none";
  const color =
    options.color ??
    (special === "taxi" ? "#f0c94a" : special === "police" ? "#e8e4d8" : rng.pick(PAINT));

  const body = asm.add(`vehicle.${kindName}`, options.position ?? [0, 0, 0], {
    color,
    yawSteps: options.yawSteps,
  });

  const wheel = rng.pick(kind.wheels);
  const scale = kind.radius / WHEEL_RADIUS[wheel];
  for (const socket of ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"]) {
    asm.attach(body, socket, `wheel.${wheel}`, { scale });
  }

  if (special === "taxi") asm.attach(body, "roof", "wheel.taxi_sign");
  if (special === "police") asm.attach(body, "roof", "wheel.police_bar");

  if (kindName === "sport" || (kindName === "sedan" && special === "none" && rng.chance(0.25))) {
    const spoiler = rng.chance(0.5) ? "wheel.spoiler_wing" : "wheel.spoiler_low";
    asm.attach(body, "trunk", spoiler);
  }
  if ((kindName === "suv" || kindName === "hatch") && rng.chance(0.45)) {
    asm.attach(body, "roof", "wheel.roof_rack");
  }
  if ((kindName === "suv" || kindName === "pickup") && rng.chance(0.4)) {
    asm.attach(body, "front", "wheel.bull_bar");
  }
}
