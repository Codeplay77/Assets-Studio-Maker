import { getBlock, hasBlock } from "../blocks/catalog";
import type { Assembler } from "./assembler";
import { HAIR_COLORS, SKIN_TONES, type Age, type PersonOptions, type Sex } from "./person";
import type { Rng } from "./rng";

// The Realista person is a MakeHuman body (see tools/blender/make_people.py) that bends with its
// skeleton instead of being built from blocks. It comes as a few blocks standing on the same spot:
// the body, what it wears on top, what it wears below with the shoes, the hair and maybe a hat. The
// body takes the skin color, each piece of clothing its own color, and the hair the hair color.

const PREFIX = "rz.pessoa";

/** Which MakeHuman body each age, sex and build gets. */
function bodyOf(sex: Sex, age: Age, build: string): string {
  const male = sex === "male";
  if (age === "child") return male ? "menino" : "menina";
  if (age === "teen") return male ? "rapaz" : "moca";
  if (age === "elder") return male ? "idoso" : "idosa";
  const base = male ? "homem" : "mulher";
  if (build === "slim") return `${base}_${male ? "magro" : "magra"}`;
  if (build === "strong") return `${base}_forte`;
  return base;
}

/** The outfits each kind of clothing can be, best first, for men and for women. */
const OUTFITS: Record<string, { male: string[]; female: string[] }> = {
  casual: { male: ["camiseta", "manga_longa", "camisa", "jaqueta"], female: ["camiseta_f", "bermuda_f"] },
  sport: { male: ["camiseta"], female: ["esporte_f", "bermuda_f"] },
  formal: { male: ["terno", "camisa"], female: ["social_f"] },
  uniform: { male: ["macacao"], female: ["social_f"] },
  dress: { male: ["camisa"], female: ["social_f"] },
};

const CASUAL = ["#3f6fb5", "#b8423c", "#3a7d6b", "#d9a62e", "#e8e4d8", "#2c3142", "#6d7480", "#7a3fd1", "#f2f0ea", "#c46a2b"];
const BRIGHT = ["#3f8cff", "#c23b3b", "#1ec08a", "#e0a81f", "#f26b1d", "#e93d82"];
const SHIRTS = ["#f4f1ea", "#dfe6ee", "#bcd0e6", "#e6c9d6", "#e8e4d8"];
const SUITS = ["#2c3142", "#23252c", "#3b4a63", "#4a3a2e", "#55585e"];
const SKIRTS = ["#2c3142", "#23252c", "#55585e", "#6b4a3a", "#3b4a63"];
const LEGGINGS = ["#23252c", "#2d3a55", "#3a3f47"];

/** What color each piece of an outfit takes; only those the outfit lets be tinted show it. */
function colorsOf(outfit: string, rng: Rng): { top: string; bottom: string } {
  switch (outfit) {
    case "terno": {
      const suit = rng.fork("suit").pick(SUITS);
      return { top: suit, bottom: suit };
    }
    case "camisa":
      return { top: rng.fork("shirt").pick([...SHIRTS, ...CASUAL.slice(0, 4)]), bottom: "#ffffff" };
    case "social_f":
      return { top: rng.fork("shirt").pick([...SHIRTS, "#a0335a", "#7a3fd1", "#2f7fd1"]), bottom: rng.fork("skirt").pick(SKIRTS) };
    case "esporte_f":
      return { top: rng.fork("shirt").pick(BRIGHT), bottom: rng.fork("leggings").pick(LEGGINGS) };
    default:
      return { top: rng.fork("shirt").pick(CASUAL), bottom: "#ffffff" };
  }
}

/** MakeHuman's hair for each hair choice, for men and for women. */
const HAIRS: Record<string, { male: string[]; female: string[] }> = {
  short: { male: ["short01", "short02", "short03"], female: ["bob02"] },
  bob: { male: ["short03"], female: ["bob01", "bob02"] },
  long: { male: ["short01"], female: ["long01"] },
  tied: { male: ["short02"], female: ["ponytail01", "braid01"] },
  curly: { male: ["afro01"], female: ["afro01"] },
  punk: { male: ["short04"], female: ["bob01"] },
  bald: { male: [], female: [] },
};

function likelyHair(sex: Sex, age: Age, rng: Rng): string {
  if (sex === "male") return rng.pick(age === "elder" ? ["short", "short", "bald"] : ["short", "short", "short", "curly", "punk"]);
  return rng.pick(age === "child" ? ["tied", "long", "bob", "curly"] : ["long", "long", "bob", "tied", "tied", "curly"]);
}

const HEIGHTS: Record<string, number> = { short: 0.95, medium: 1, tall: 1.05 };
const chosen = (value: string | undefined) => (value && value !== "any" ? value : undefined);

export function buildRealPerson(asm: Assembler, rng: Rng, options: PersonOptions, sex: Sex, age: Age): void {
  const build = chosen(options.build) ?? rng.fork("build").pick(["slim", "medium", "medium", "strong"]);
  const body = bodyOf(sex, age, build);
  const skinIndex = chosen(options.skin);
  const skin = skinIndex ? SKIN_TONES[Number(skinIndex)] : rng.fork("skin").pick(SKIN_TONES);
  const heightChoice = chosen(options.height);
  const scale = heightChoice ? HEIGHTS[heightChoice] : rng.fork("height").range(0.97, 1.03);
  const at = options.position ?? [0, 0, 0];
  let position = at;
  const place = (piece: string, color: string) => asm.add(`${PREFIX}.${body}.${piece}`, position, { color, yawSteps: options.yawSteps, scale });

  const kind = chosen(options.outfit) ?? rng.fork("outfit").pick(age === "child" ? ["casual", "casual", "sport"] : ["casual", "casual", "casual", "sport", "formal", "uniform"]);
  const candidates = OUTFITS[kind]?.[sex] ?? OUTFITS.casual[sex];
  // Not every body wears every outfit (no suits for children): the closest one it has.
  const outfit = [...candidates, ...OUTFITS.casual[sex]].find((name) => hasBlock(`${PREFIX}.${body}.corpo_${name}`)) ?? OUTFITS.casual[sex][0];
  const colors = colorsOf(outfit, rng.fork("colors"));
  // MakeHuman stands the bare feet on the ground; the soles of the shoes reach a little below them.
  const shoes = getBlock(`${PREFIX}.${body}.baixo_${outfit}`).shape;
  const sole = shoes.kind === "compound" ? Math.min(...shoes.pieces.map((piece) => ("min" in piece.shape ? piece.shape.min[1] : 0))) : 0;
  position = [at[0], at[1] - Math.min(0, sole) * scale, at[2]];
  place(`corpo_${outfit}`, skin);
  place(`cima_${outfit}`, colors.top);
  place(`baixo_${outfit}`, colors.bottom);

  const group = chosen(options.hair) ?? likelyHair(sex, age, rng.fork("hair"));
  const hairs = HAIRS[group]?.[sex] ?? HAIRS.short[sex];
  const hatChoice = chosen(options.hat);
  const hat = age !== "child" && (hatChoice ? hatChoice === "yes" : rng.fork("hat").chance(0.08)) && hasBlock(`${PREFIX}.${body}.chapeu`);
  if (hairs.length > 0) {
    const hair = rng.fork("hair kind").pick(hairs);
    place(`cabelo_${hair}`, hairColorOf(options, rng.fork("hair color"), age));
  }
  if (hat) place("chapeu", rng.fork("hat color").pick(["#5b5f63", "#3b3631", "#8a7a62", "#2c3142"]));
}

function hairColorOf(options: PersonOptions, rng: Rng, age: Age): string {
  const wanted = chosen(options.hairColor);
  if (wanted === "colored") return rng.pick(["#e93d82", "#3f8cff", "#8d4fe0"]);
  if (wanted) return HAIR_COLORS[wanted];
  if (age === "elder") return rng.pick(["#c9ccd1", "#e4e4e0", "#a7aaaf"]);
  return rng.pick([HAIR_COLORS.black, HAIR_COLORS.black, HAIR_COLORS.brown, HAIR_COLORS.brown, "#7a5233", HAIR_COLORS.blond]);
}
