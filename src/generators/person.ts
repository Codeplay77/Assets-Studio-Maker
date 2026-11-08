import type { Vec3 } from "../core/types";
import type { Assembler } from "./assembler";
import type { Rng } from "./rng";

const SKINS = ["#f6d7bd", "#eec4a0", "#e0ac83", "#c68c5e", "#a06c44", "#7a4e30", "#573622"];
const HAIR_COLORS = ["#1d1a18", "#3a2517", "#5e3c22", "#8a5a30", "#c79a55", "#e0c078", "#b9472a", "#c9ccd1"];
const FUN_HAIR = ["#e93d82", "#3f8cff", "#1ef5a6", "#8d4fe0"];
const EYE_COLORS = ["#5a3a22", "#3b6ea5", "#3f8f5f", "#7a6a3a", "#2b2320"];
const CLOTH = [
  "#3f8cff", "#c23b3b", "#3a7d6b", "#e0a81f", "#7a3fd1", "#e8e4d8", "#2c3142", "#f26b1d", "#6d7480", "#e93d82",
];
const PANTS = ["#2d3a55", "#23252c", "#55422f", "#6b7a4a", "#8a8f99", "#3b5f8a"];
const SHOES = ["#d6dde6", "#2b2320", "#5a4632", "#c23b3b", "#23252c"];

const ANY_HAIR = ["short", "side", "bob", "long", "ponytail", "bun", "afro", "curly", "spiky", "mohawk"];
const HATS = ["cap", "beanie", "top", "cowboy", "wizard", "helmet", "crown"];
const TORSOS = ["tshirt", "jacket", "suit", "hoodie", "shirt", "uniform"];
const HEADS = ["oval", "round", "square", "long"];
const EYES = ["round", "big", "dot", "sleepy", "narrow"];
const BROWS = ["brows_straight", "brows_arched", "brows_angry"];
const NOSES = ["nose_small", "nose_long", "nose_wide"];
const MOUTHS = ["mouth_smile", "mouth_flat", "mouth_open", "mouth_grin"];
const BEARDS = ["beard_full", "beard_goatee", "beard_mustache"];

export interface PersonOptions {
  position?: Vec3;
  yawSteps?: number;
}

export function buildPerson(asm: Assembler, rng: Rng, options: PersonOptions = {}): void {
  const [x, , z] = options.position ?? [0, 0, 0];
  const yawSteps = options.yawSteps ?? 0;

  const skin = rng.pick(SKINS);
  const height = rng.range(0.93, 1.07);
  const build = rng.range(0.9, 1.2);
  const shirt = rng.pick(CLOTH);
  const pants = rng.pick(PANTS);
  const uniform = (scale: number): Vec3 => [scale * height, height, scale * height];

  const hips = asm.add("body.hips", [x, 1.2, z], {
    color: pants,
    scale: [build * height, height, (1 + (build - 1) * 0.7) * height],
    yawSteps,
  });
  const torso = asm.attach(hips, "waist", `body.torso_${rng.pick(TORSOS)}`, {
    color: shirt,
    scale: [build * height, height, (1 + (build - 1) * 0.7) * height],
  });

  const neck = asm.attach(torso, "neck", "body.neck", { color: skin, scale: height });
  buildHead(asm, rng, neck, skin, height);

  const longSleeves = rng.chance(0.55);
  const arm = (side: string) => {
    const limbScale = uniform(0.92 + (build - 0.9) * 0.45);
    const upper = asm.attach(torso, `shoulder_${side}`, "body.upper_arm", {
      color: longSleeves || rng.chance(0.4) ? shirt : skin,
      scale: limbScale,
    });
    const fore = asm.attach(upper, "elbow", "body.forearm", {
      color: longSleeves ? shirt : skin,
      scale: limbScale,
    });
    asm.attach(fore, "wrist", "body.hand", { color: skin, scale: height });
  };
  arm("left");
  arm("right");

  const shorts = rng.chance(0.28);
  const skirt = rng.chance(0.2);
  if (skirt) asm.attach(hips, "belt", "body.skirt", { color: rng.pick(CLOTH), scale: uniform(build) });

  const shoeKind = rng.pick(["shoe_sneaker", "shoe_boot", "shoe_formal"]);
  const shoeColor = rng.pick(SHOES);
  let foot = hips;
  const leg = (side: string) => {
    const limbScale = uniform(0.95 + (build - 0.9) * 0.5);
    const thigh = asm.attach(hips, `hip_${side}`, "body.thigh", {
      color: skirt ? skin : pants,
      scale: limbScale,
    });
    const calf = asm.attach(thigh, "knee", "body.calf", {
      color: skirt || shorts ? skin : pants,
      scale: limbScale,
    });
    foot = asm.attach(calf, "ankle", `body.${shoeKind}`, { color: shoeColor, scale: height });
  };
  leg("left");
  leg("right");

  if (rng.chance(0.18)) asm.attach(torso, "back", "hair.backpack", { color: rng.pick(CLOTH), scale: height });

  asm.dropTo(foot, "sole", options.position?.[1] ?? 0);
}

function buildHead(
  asm: Assembler,
  rng: Rng,
  neck: ReturnType<Assembler["add"]>,
  skin: string,
  scale: number,
): void {
  const head = asm.attach(neck, "head", `body.head_${rng.pick(HEADS)}`, { color: skin, scale });
  const hair = rng.chance(0.08) ? rng.pick(FUN_HAIR) : rng.pick(HAIR_COLORS);
  const noseColor = skin;

  asm.attach(head, "eyes", `face.eyes_${rng.pick(EYES)}`, { color: rng.pick(EYE_COLORS), scale });
  asm.attach(head, "brows", `face.${rng.pick(BROWS)}`, { color: hair, scale });
  asm.attach(head, "nose", `face.${rng.pick(NOSES)}`, { color: noseColor, scale });
  asm.attach(head, "mouth", `face.${rng.pick(MOUTHS)}`, { scale });

  const ear = rng.chance(0.07) ? "face.ear_elf" : "face.ear";
  asm.attach(head, "ear_left", ear, { color: skin, scale });
  asm.attach(head, "ear_right", ear, { color: skin, scale });

  if (rng.chance(0.25)) asm.attach(head, "chin", `face.${rng.pick(BEARDS)}`, { color: hair, scale });
  if (rng.chance(0.2)) {
    asm.attach(head, "eyes", `face.${rng.pick(["glasses_round", "glasses_sun"])}`, { scale });
  }

  const wearsHat = rng.chance(0.3);
  if (wearsHat) {
    asm.attach(head, "top", `hair.hat_${rng.pick(HATS)}`, { scale });
    if (rng.chance(0.8)) {
      asm.attach(head, "top", `hair.${rng.pick(["under_short", "under_long"])}`, { color: hair, scale });
    }
  } else if (rng.chance(0.92)) {
    asm.attach(head, "top", `hair.${rng.pick(ANY_HAIR)}`, { color: hair, scale });
  }
}
