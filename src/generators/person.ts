import type { ArtStyle } from "../blocks/styles";
import type { Vec3 } from "../core/types";
import type { AssembledPart, Assembler } from "./assembler";
import type { Rng } from "./rng";

export const SKIN_TONES = ["#f6d7bd", "#eec4a0", "#e0ac83", "#c68c5e", "#a06c44", "#7a4e30", "#573622"];
export const HAIR_COLORS: Record<string, string> = {
  black: "#1d1a18",
  brown: "#5e3c22",
  blond: "#d8b874",
  red: "#b9472a",
  gray: "#c9ccd1",
  colored: "#e93d82",
};
const NATURAL_HAIR = ["black", "black", "brown", "brown", "blond", "red"];
const FUN_HAIR = ["#e93d82", "#3f8cff", "#1ef5a6", "#8d4fe0"];
const EYE_COLORS = ["#5a3a22", "#3b6ea5", "#3f8f5f", "#7a6a3a", "#2b2320"];
const CLOTH = ["#3f8cff", "#c23b3b", "#3a7d6b", "#e0a81f", "#7a3fd1", "#e8e4d8", "#2c3142", "#f26b1d", "#6d7480", "#e93d82"];
const BRIGHT = ["#3f8cff", "#c23b3b", "#1ec08a", "#e0a81f", "#f26b1d", "#e93d82"];
const FORMAL = ["#2c3142", "#23252c", "#3b4a63", "#4a3a2e"];
const SHIRTS = ["#e8e4d8", "#f4f1ea", "#bcd0e6", "#e6c9d6"];
const DRESSES = ["#a0335a", "#7a3fd1", "#2f7fd1", "#3a7d6b", "#c23b3b", "#23252c", "#e0a81f"];
const UNIFORMS = ["#23405f", "#3e4a2e", "#2c3142", "#5a2230"];
const PANTS = ["#2d3a55", "#23252c", "#55422f", "#6b7a4a", "#8a8f99", "#3b5f8a"];
const SHOES = ["#d6dde6", "#2b2320", "#5a4632", "#c23b3b", "#23252c"];
const LIPSTICK = ["#b5484f", "#a0334a", "#c2566a", "#8f3d3d"];

export type Sex = "male" | "female";
export type Age = "child" | "teen" | "adult" | "elder";
type Outfit = "casual" | "sport" | "formal" | "uniform" | "dress";
type HairGroup = "short" | "bob" | "long" | "tied" | "curly" | "punk" | "bald";

const HAIR_STYLES: Record<HairGroup, string[]> = {
  short: ["short", "side"],
  bob: ["bob"],
  long: ["long"],
  tied: ["ponytail", "bun"],
  curly: ["curly", "afro"],
  punk: ["spiky", "mohawk"],
  bald: [],
};

/** Which group each kind of person usually gets when nothing was chosen. */
function likelyHair(sex: Sex, age: Age): HairGroup[] {
  if (age === "child") return sex === "male" ? ["short", "short", "curly"] : ["long", "bob", "tied", "curly"];
  if (age === "elder") return sex === "male" ? ["short", "short", "bald", "curly"] : ["bob", "tied", "short"];
  return sex === "male"
    ? ["short", "short", "short", "curly", "punk", ...(age === "adult" ? (["bald"] as HairGroup[]) : [])]
    : ["long", "long", "bob", "tied", "tied", "curly"];
}

const STATURE: Record<Age, { male: number; female: number; width: number; head: number }> = {
  child: { male: 0.63, female: 0.63, width: 0.68, head: 0.86 },
  teen: { male: 0.9, female: 0.87, width: 0.86, head: 0.95 },
  adult: { male: 1, female: 0.94, width: 1, head: 1 },
  elder: { male: 0.95, female: 0.9, width: 0.97, head: 0.98 },
};

const BUILDS: Record<string, number> = { slim: 0.88, medium: 1, strong: 1.18 };
const HEIGHTS: Record<string, number> = { short: 0.95, medium: 1, tall: 1.06 };

interface PersonKit {
  body: string;
  face: string;
  hair: string;
  heads: { male: string[]; female: string[]; child: string[] };
  eyes: { male: string[]; female: string[]; child: string[] };
  /** Low poly and block characters read better with a larger head. */
  headScale: number;
  /** How much thinner a woman's arms and legs are. */
  feminineLimbs: number;
  earLeft: string;
  hats: string[];
}

const KITS: Record<ArtStyle, PersonKit> = {
  realistic: {
    body: "body",
    face: "face",
    hair: "hair",
    heads: { male: ["oval", "square", "round", "long"], female: ["soft", "heart", "oval"], child: ["round", "soft"] },
    eyes: { male: ["round", "narrow", "sleepy"], female: ["lashes", "lashes", "big"], child: ["big", "round"] },
    headScale: 1,
    feminineLimbs: 0.9,
    earLeft: "ear_left",
    hats: ["cap", "beanie", "cap", "beanie", "top", "cowboy"],
  },
  lowpoly: {
    body: "lp",
    face: "lp",
    hair: "lp",
    heads: { male: ["oval", "square", "round"], female: ["soft", "oval"], child: ["round", "soft"] },
    eyes: { male: ["round"], female: ["lashes", "big"], child: ["big", "round"] },
    headScale: 1.16,
    feminineLimbs: 0.9,
    earLeft: "ear",
    hats: ["cap", "beanie", "cap", "beanie", "top", "cowboy"],
  },
  arcade: {
    body: "ar",
    face: "ar",
    hair: "ar",
    heads: { male: ["oval", "square", "round"], female: ["soft", "oval"], child: ["round", "soft"] },
    eyes: { male: ["round"], female: ["lashes", "big"], child: ["big", "round"] },
    headScale: 1.26,
    feminineLimbs: 0.9,
    earLeft: "ear",
    hats: ["cap", "beanie", "cap", "beanie", "top", "cowboy"],
  },
  blocks: {
    body: "vx",
    face: "vx",
    hair: "vx",
    heads: { male: ["block"], female: ["block"], child: ["block"] },
    eyes: { male: ["round"], female: ["lashes", "big"], child: ["big", "round"] },
    headScale: 1,
    feminineLimbs: 0.8,
    earLeft: "ear",
    hats: ["cap", "beanie", "cap", "beanie", "top", "cowboy"],
  },
};

export interface PersonOptions {
  position?: Vec3;
  yawSteps?: number;
  style?: ArtStyle;
  /** Each of these is left out, or "any", to let the seed decide. */
  sex?: string;
  age?: string;
  build?: string;
  height?: string;
  skin?: string;
  hair?: string;
  hairColor?: string;
  outfit?: string;
  beard?: string;
  glasses?: string;
  hat?: string;
  backpack?: string;
}

const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

/** A natural lip color: a darker, redder version of the skin. */
function lipTone(skin: string): string {
  const mix = (index: number, target: number) => Math.round(parseInt(skin.slice(index, index + 2), 16) * 0.52 + target * 0.48);
  return `#${[mix(1, 122), mix(3, 44), mix(5, 44)].map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

function decide(value: string | undefined, rng: Rng, probability: number): boolean {
  const wanted = chosen(value);
  return wanted ? wanted === "yes" : rng.chance(probability);
}

function resolveSex(options: PersonOptions, rng: Rng): Sex {
  const wanted = chosen(options.sex);
  if (wanted) return wanted as Sex;
  // A dress settles what was left to chance.
  return chosen(options.outfit) === "dress" ? "female" : rng.pick(["male", "female"]);
}

function resolveOutfit(options: PersonOptions, rng: Rng, sex: Sex, age: Age): Outfit {
  const wanted = chosen(options.outfit) as Outfit | undefined;
  if (wanted && !(wanted === "dress" && sex === "male")) return wanted;
  if (age === "child") return rng.pick<Outfit>(sex === "female" ? ["casual", "casual", "sport", "dress"] : ["casual", "casual", "sport"]);
  if (sex === "female") return rng.pick<Outfit>(["casual", "casual", "casual", "dress", "dress", "sport", "formal", "formal", "uniform"]);
  return rng.pick<Outfit>(["casual", "casual", "casual", "casual", "sport", "formal", "formal", "uniform"]);
}

interface Clothes {
  garment: string;
  shirt: string;
  bottom: "pants" | "shorts" | "skirt";
  bottomColor: string;
  shoe: string;
  shoeColor: string;
  longSleeves: boolean;
}

function dress(outfit: Outfit, sex: Sex, age: Age, rng: Rng): Clothes {
  const female = sex === "female";
  const child = age === "child";
  const shoeColor = rng.fork("shoe color").pick(SHOES);
  const bottomRoll = rng.fork("bottom").next();
  switch (outfit) {
    case "sport":
      return {
        garment: "tshirt",
        shirt: rng.fork("shirt").pick(BRIGHT),
        bottom: "shorts",
        bottomColor: rng.fork("bottom color").pick(["#23252c", "#ffffff", "#2d3a55"]),
        shoe: "sneaker",
        shoeColor,
        longSleeves: false,
      };
    case "formal": {
      const garment = rng.fork("garment").pick(["shirt", "suit"]);
      const dark = rng.fork("bottom color").pick(FORMAL);
      return {
        garment,
        shirt: garment === "suit" ? dark : rng.fork("shirt").pick(SHIRTS),
        bottom: female && !child && bottomRoll < 0.5 ? "skirt" : "pants",
        bottomColor: dark,
        shoe: female && !child ? rng.fork("shoe").pick(["heel", "formal"]) : "formal",
        shoeColor: female ? rng.fork("shoe color").pick(["#23252c", "#a0335a", "#2c3142"]) : "#2b2320",
        longSleeves: true,
      };
    }
    case "uniform": {
      const color = rng.fork("shirt").pick(UNIFORMS);
      return { garment: "uniform", shirt: color, bottom: "pants", bottomColor: color, shoe: "boot", shoeColor: "#23252c", longSleeves: true };
    }
    case "dress": {
      const color = rng.fork("shirt").pick(DRESSES);
      return {
        // A child's body has no bust, so the plain top goes with the skirt.
        garment: child ? "tshirt" : "dress",
        shirt: color,
        bottom: "skirt",
        bottomColor: color,
        shoe: child ? "sneaker" : rng.fork("shoe").pick(["heel", "heel", "sneaker"]),
        shoeColor,
        longSleeves: false,
      };
    }
    case "casual":
    default: {
      const garment = rng.fork("garment").pick(["tshirt", "tshirt", "hoodie", "jacket"]);
      const bottom = female ? (bottomRoll < 0.55 ? "pants" : bottomRoll < 0.75 ? "shorts" : "skirt") : bottomRoll < 0.72 ? "pants" : "shorts";
      return {
        garment,
        shirt: rng.fork("shirt").pick(CLOTH),
        bottom,
        bottomColor: bottom === "skirt" ? rng.fork("bottom color").pick(CLOTH) : rng.fork("bottom color").pick(PANTS),
        shoe: rng.fork("shoe").pick(["sneaker", "sneaker", "boot"]),
        shoeColor,
        longSleeves: garment !== "tshirt" || rng.fork("sleeves").chance(0.15),
      };
    }
  }
}

export function buildPerson(asm: Assembler, rng: Rng, options: PersonOptions = {}): void {
  const [x, , z] = options.position ?? [0, 0, 0];
  const yawSteps = options.yawSteps ?? 0;
  const kit = KITS[options.style ?? "realistic"];

  const sex = resolveSex(options, rng.fork("sex"));
  const age = (chosen(options.age) as Age | undefined) ?? rng.fork("age").pick<Age>(["adult", "adult", "adult", "adult", "teen", "child", "elder"]);
  const skinIndex = chosen(options.skin);
  const skin = skinIndex ? SKIN_TONES[Number(skinIndex)] : rng.fork("skin").pick(SKIN_TONES);
  const stature = STATURE[age];
  const heightChoice = chosen(options.height);
  const tall = heightChoice ? HEIGHTS[heightChoice] : rng.fork("height").range(0.97, 1.03);
  const buildChoice = chosen(options.build);
  const buildFactor = buildChoice
    ? BUILDS[buildChoice]
    : rng.fork("build").pick(age === "child" || age === "teen" ? [0.88, 1, 1] : [0.88, 1, 1, 1.18]);

  const female = sex === "female";
  // Children's bodies are the same shape; it is what they wear and their hair that differs.
  const feminineBody = female && age !== "child";
  const sy = stature[sex] * tall;
  const width = stature.width;
  const trunk: Vec3 = [width * buildFactor, sy, width * (1 + (buildFactor - 1) * 0.7)];
  const limbWidth = width * (0.92 + (buildFactor - 0.9) * 0.45) * (female ? kit.feminineLimbs : 1);
  const limb: Vec3 = [limbWidth, sy, limbWidth];
  const extremity = Math.max(width, 0.74) * (female ? 0.9 : 1);

  const outfit = resolveOutfit(options, rng.fork("outfit"), sex, age);
  const clothes = dress(outfit, sex, age, rng);
  const hips = asm.add(`${kit.body}.${feminineBody ? "hips_f" : "hips"}`, [x, 1.2, z], {
    color: clothes.bottomColor,
    scale: trunk,
    yawSteps,
  });
  const torso = asm.attach(hips, "waist", `${kit.body}.torso${feminineBody ? "_f" : ""}_${clothes.garment}`, {
    color: clothes.shirt,
    scale: trunk,
  });
  const neckWidth = width * (feminineBody ? 0.86 : 1);
  const neck = asm.attach(torso, "neck", `${kit.body}.neck`, { color: skin, scale: [neckWidth, sy, neckWidth] });
  buildHead(asm, rng, neck, kit, options, { sex, age, skin, scale: stature.head * kit.headScale * (feminineBody ? 0.97 : 1) });

  const sleeve = clothes.longSleeves ? clothes.shirt : skin;
  const upperSleeve = clothes.longSleeves || clothes.garment === "tshirt" ? clothes.shirt : skin;
  const arm = (side: "left" | "right") => {
    const upper = asm.attach(torso, `shoulder_${side}`, `${kit.body}.upper_arm`, { color: upperSleeve, scale: limb });
    const fore = asm.attach(upper, "elbow", `${kit.body}.forearm`, { color: sleeve, scale: limb });
    // A quarter turn leaves the palms facing the body and the thumbs pointing forward.
    asm.attach(fore, "wrist", `${kit.body}.${side === "left" ? "hand" : "hand_right"}`, {
      color: skin,
      scale: extremity,
      yawSteps: side === "left" ? 1 : 3,
    });
  };
  arm("left");
  arm("right");

  if (clothes.bottom === "skirt") {
    // Wide enough that the hips never show through.
    const across = width * buildFactor * (feminineBody ? 1.14 : 1.02);
    asm.attach(hips, "belt", `${kit.body}.skirt`, { color: clothes.bottomColor, scale: [across, sy, across] });
  }

  let foot = hips;
  const leg = (side: "left" | "right") => {
    const covered = clothes.bottom === "pants";
    const thigh = asm.attach(hips, `hip_${side}`, `${kit.body}.thigh`, {
      color: clothes.bottom === "skirt" ? skin : clothes.bottomColor,
      scale: limb,
    });
    const calf = asm.attach(thigh, "knee", `${kit.body}.calf`, { color: covered ? clothes.bottomColor : skin, scale: limb });
    foot = asm.attach(calf, "ankle", `${kit.body}.shoe_${clothes.shoe}`, { color: clothes.shoeColor, scale: extremity });
  };
  leg("left");
  leg("right");

  if (decide(options.backpack, rng.fork("backpack"), 0.14)) {
    asm.attach(torso, "back", `${kit.hair}.backpack`, { color: rng.fork("backpack color").pick(CLOTH), scale: width });
  }

  asm.dropTo(foot, "sole", options.position?.[1] ?? 0);
}

function buildHead(
  asm: Assembler,
  rng: Rng,
  neck: AssembledPart,
  kit: PersonKit,
  options: PersonOptions,
  person: { sex: Sex; age: Age; skin: string; scale: number },
): void {
  const { sex, age, skin, scale } = person;
  const female = sex === "female";
  const child = age === "child";
  const faceKind = child ? "child" : sex;

  const head = asm.attach(neck, "head", `${kit.body}.head_${rng.fork("head").pick(kit.heads[faceKind])}`, { color: skin, scale });
  const hairGroup = (chosen(options.hair) as HairGroup | undefined) ?? rng.fork("hair").pick(likelyHair(sex, age));
  const hairColor = resolveHairColor(options, rng.fork("hair color"), age);

  asm.attach(head, "eyes", `${kit.face}.eyes_${rng.fork("eyes").pick(kit.eyes[faceKind])}`, {
    color: rng.fork("eye color").pick(EYE_COLORS),
    scale,
  });
  asm.attach(head, "brows", `${kit.face}.brows_${female ? "arched" : rng.fork("brows").pick(["straight", "straight", "straight", "straight", "angry"])}`, {
    color: hairColor,
    scale,
  });
  asm.attach(head, "nose", `${kit.face}.nose_${female || child ? "small" : rng.fork("nose").pick(["small", "long", "wide"])}`, {
    color: skin,
    scale,
  });

  if (female && !child) {
    asm.attach(head, "mouth", `${kit.face}.mouth_full`, { color: rng.fork("lips").pick(LIPSTICK), scale });
  } else {
    const mouths = child ? ["smile", "grin"] : ["smile", "smile", "flat", "grin"];
    asm.attach(head, "mouth", `${kit.face}.mouth_${rng.fork("mouth").pick(mouths)}`, { color: lipTone(skin), scale });
  }

  asm.attach(head, "ear_left", `${kit.face}.${kit.earLeft}`, { color: skin, scale });
  asm.attach(head, "ear_right", `${kit.face}.ear`, { color: skin, scale });

  const canHaveBeard = !female && (age === "adult" || age === "elder");
  if (canHaveBeard && decide(options.beard, rng.fork("beard"), 0.3)) {
    const beard = rng.fork("beard kind").pick(["beard_full", "beard_goatee", "beard_mustache"]);
    asm.attach(head, "chin", `${kit.face}.${beard}`, { color: hairColor, scale });
  }
  if (decide(options.glasses, rng.fork("glasses"), age === "elder" ? 0.45 : child ? 0.06 : 0.14)) {
    asm.attach(head, "eyes", `${kit.face}.glasses_${rng.fork("glasses kind").pick(age === "elder" ? ["round"] : ["round", "sun"])}`, { scale });
  }

  const hair = HAIR_STYLES[hairGroup];
  if (decide(options.hat, rng.fork("hat"), child ? 0.14 : 0.2)) {
    const hats = child ? ["cap", "beanie"] : kit.hats;
    asm.attach(head, "top", `${kit.hair}.hat_${rng.fork("hat kind").pick(hats)}`, { scale });
    if (hairGroup !== "bald") {
      const under = hairGroup === "long" || hairGroup === "tied" ? "under_long" : "under_short";
      asm.attach(head, "top", `${kit.hair}.${under}`, { color: hairColor, scale });
    }
  } else if (hair.length > 0) {
    asm.attach(head, "top", `${kit.hair}.${rng.fork("hair kind").pick(hair)}`, { color: hairColor, scale });
  }
}

function resolveHairColor(options: PersonOptions, rng: Rng, age: Age): string {
  const wanted = chosen(options.hairColor);
  if (wanted === "colored") return rng.pick(FUN_HAIR);
  if (wanted) return HAIR_COLORS[wanted];
  if (age === "elder") return rng.pick(["#c9ccd1", "#e4e4e0", "#a7aaaf"]);
  return HAIR_COLORS[rng.pick(NATURAL_HAIR)];
}
