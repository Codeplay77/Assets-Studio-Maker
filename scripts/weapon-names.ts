// Portuguese names for the CC0 weapon packs, how long each piece really is and how it is held.
//
// Every weapon is stored the way it stands in the library: a gun upright with its barrel toward +Z,
// anything else upright with its tip up (+Y) and its edge or face toward +Z. Its first socket is
// where the hand holds it (see scripts/import-weapons.ts).

/**
 * How a piece is held, which decides where its grip is:
 * - `gun`: by a pistol grip or the wrist of a stock, `grip` along its length from the back;
 * - `blade`: by the handle under the guard, found from its shape;
 * - `pole`: by the shaft, `grip` up its length from the bottom;
 * - `thing`: not held by a handle (magazines, scopes, targets); the grip is its middle.
 */
export type HoldKind = "gun" | "blade" | "pole" | "thing";

export interface WeaponName {
  label: string;
  /** Its longest side, in meters. */
  length: number;
  hold: HoldKind;
  /** For `gun` and `pole`: where the hand goes, as a fraction of its length. */
  grip?: number;
  /** Turns that stand it the way the library keeps it, after its kit's, one after the other. */
  turn?: Turn;
  /** Held by its front, as a bow is by its handle and not by its string. */
  front?: boolean;
}

/** Turns about the world's axes, in degrees, one after the other. */
export type Turn = ["x" | "y" | "z", number][];

const gun = (label: string, length: number, grip: number, turn?: Turn): WeaponName => ({ label, length, hold: "gun", grip, ...(turn ? { turn } : {}) });
const blade = (label: string, length: number, turn?: Turn): WeaponName => ({ label, length, hold: "blade", ...(turn ? { turn } : {}) });
const pole = (label: string, length: number, grip: number, turn?: Turn): WeaponName => ({ label, length, hold: "pole", grip, ...(turn ? { turn } : {}) });
const thing = (label: string, length: number, turn?: Turn): WeaponName => ({ label, length, hold: "thing", ...(turn ? { turn } : {}) });

/** Quaternius, Ultimate Gun Pack (July 2019): barrels along +X. */
export const QUATERNIUS_GUNS: Record<string, WeaponName> = {
  AssaultRifle_1: gun("Fuzil de assalto sem coronha", 0.55, 0.2),
  AssaultRifle_2: gun("Fuzil de assalto", 0.88, 0.37),
  AssaultRifle_3: gun("Fuzil de assalto compacto", 0.6, 0.27),
  AssaultRifle_4: gun("Fuzil de assalto de coronha preta", 0.88, 0.37),
  AssaultRifle_5: gun("Fuzil de assalto de coronha dobrável", 0.88, 0.37),
  AssaultRifle2_1: gun("Carabina tática", 0.85, 0.34),
  AssaultRifle2_2: gun("Carabina", 0.8, 0.34),
  AssaultRifle2_3: gun("Carabina sem coronha", 0.62, 0.12),
  AssaultRifle2_4: gun("Carabina curta", 0.5, 0.38),
  Bullpup_1: gun("Fuzil bullpup", 0.8, 0.5),
  Bullpup_2: gun("Fuzil bullpup compacto", 0.6, 0.55),
  Bullpup_3: gun("Fuzil bullpup com empunhadura", 0.68, 0.43),
  Pistol_1: gun("Pistola", 0.22, 0.2),
  Pistol_2: gun("Pistola escura", 0.22, 0.2),
  Pistol_3: gun("Pistola com trilho", 0.22, 0.2),
  Pistol_4: gun("Pistola grande", 0.26, 0.2),
  Pistol_5: gun("Pistola compacta", 0.21, 0.2),
  Pistol_6: gun("Pistola de cano longo", 0.29, 0.2),
  Revolver_1: gun("Revólver", 0.26, 0.12),
  Revolver_2: gun("Revólver de cano longo", 0.27, 0.1),
  Revolver_3: gun("Revólver prateado", 0.27, 0.12),
  Revolver_4: gun("Revólver curto", 0.2, 0.2),
  Revolver_5: gun("Revólver escuro", 0.26, 0.1),
  Shotgun_1: gun("Espingarda", 0.95, 0.28),
  Shotgun_2: gun("Espingarda de cano longo", 1.05, 0.26),
  Shotgun_3: gun("Espingarda de caça", 1.05, 0.26),
  Shotgun_4: gun("Espingarda de bomba", 1.0, 0.28),
  Shotgun_SawedOff: gun("Espingarda de cano serrado", 0.5, 0.08),
  Shotgun_ShortStock: gun("Espingarda de coronha curta", 0.75, 0.1),
  SniperRifle_1: gun("Fuzil de precisão", 1.25, 0.3),
  SniperRifle_2: gun("Fuzil de precisão de coronha vazada", 1.27, 0.28),
  SniperRifle_3: gun("Fuzil de precisão cinza", 1.24, 0.3),
  SniperRifle_4: gun("Fuzil de precisão curto", 1.1, 0.3),
  SniperRifle_5: gun("Fuzil de precisão com bipé", 1.1, 0.4),
  SniperRifle_6: gun("Fuzil de precisão de madeira", 1.24, 0.3),
  SubmachineGun_1: gun("Submetralhadora", 0.45, 0.3),
  SubmachineGun_2: gun("Submetralhadora de coronha", 0.66, 0.48),
  SubmachineGun_3: gun("Submetralhadora de coronha dobrável", 0.66, 0.5),
  SubmachineGun_4: gun("Submetralhadora compacta", 0.42, 0.27),
  SubmachineGun_5: gun("Submetralhadora longa", 0.82, 0.4),
};

/** Quaternius, the gun pack's accessories, at the guns' scale. */
export const QUATERNIUS_GUN_PARTS: Record<string, WeaponName> = {
  Bayonet: pole("Baioneta", 0.19, 0.18, [["x", -90]]),
  Bayonet_2: pole("Baioneta serrilhada", 0.19, 0.18, [["x", -90]]),
  Bipod: thing("Bipé", 0.22),
  Flashlight: thing("Lanterna de arma", 0.065),
  Grip: thing("Empunhadura frontal", 0.11),
  Scope_1: thing("Mira telescópica", 0.34),
  Scope_2: thing("Mira telescópica grande", 0.34),
  Scope_3: thing("Mira telescópica curta", 0.31),
  Silencer_1: thing("Silenciador", 0.28),
  Silencer_2: thing("Silenciador liso", 0.27),
  Silencer_3: thing("Silenciador grosso", 0.29),
  Silencer_Short: thing("Silenciador curto", 0.14),
  Silencer_long: thing("Silenciador longo", 0.43),
  Stock: thing("Coronha", 0.26),
  Tripod: thing("Tripé", 0.21),
};

/** Quaternius, Low Poly Medieval Weapons: each file stands its own way. */
export const QUATERNIUS_MEDIEVAL: Record<string, WeaponName> = {
  Club: pole("Clava", 0.8, 0.12),
  Katana: blade("Catana", 1.0, [["x", -90], ["y", 90]]),
  LongSword: blade("Espada longa", 1.15, [["x", 90], ["y", 90]]),
  ShortSword: blade("Espada curta", 0.8, [["x", 90], ["y", 90]]),
  SimpleAxe: pole("Machado simples", 0.75, 0.25, [["y", -90]]),
  Spear: pole("Lança", 2.0, 0.4),
};

/** Quaternius, Ultimate RPG Items Pack (August 2019): upright, tips up. */
export const QUATERNIUS_RPG: Record<string, WeaponName> = {
  Arrow: thing("Flecha", 0.75),
  Arrow_Golden: thing("Flecha dourada", 0.75),
  Axe_Double: pole("Machado de duas lâminas", 0.9, 0.25),
  Axe_Double_Golden: pole("Machado dourado de duas lâminas", 0.9, 0.25),
  Axe_small: pole("Machadinha", 0.6, 0.25),
  Axe_small_Golden: pole("Machadinha dourada", 0.6, 0.25),
  Bow_Golden: { ...pole("Arco dourado", 1.3, 0.5, [["y", 180]]), front: true },
  Bow_Wooden: { ...pole("Arco de madeira", 1.2, 0.5, [["y", 180]]), front: true },
  Dagger: blade("Adaga curva", 0.4),
  Dagger_Golden: blade("Adaga curva dourada", 0.4),
  Dart: thing("Dardo", 0.3),
  Dart_Golden: thing("Dardo dourado", 0.3),
  Hammer_Double: pole("Martelo de guerra", 1.0, 0.22),
  Hammer_Double_Golden: pole("Martelo de guerra dourado", 1.0, 0.22),
  Sword: blade("Espada", 0.95),
  Sword_Golden: blade("Espada dourada", 0.95),
  Sword_big: blade("Espada grande", 1.3),
  Sword_big_Golden: blade("Espada grande dourada", 1.3),
};

/** Kenney, Blaster Kit 2.1: toy blasters, barrels along the Z axis. */
export const KENNEY_BLASTERS: Record<string, WeaponName> = {
  "blaster-a": gun("Blaster de brinquedo A", 0.48, 0.3),
  "blaster-b": gun("Blaster de brinquedo B", 0.25, 0.3),
  "blaster-c": gun("Blaster de brinquedo C", 0.28, 0.3),
  "blaster-d": gun("Blaster de brinquedo D", 0.54, 0.3),
  "blaster-e": gun("Blaster de brinquedo E", 0.83, 0.3),
  "blaster-f": gun("Blaster de brinquedo F", 0.79, 0.3),
  "blaster-g": gun("Blaster de brinquedo G", 0.47, 0.3),
  "blaster-h": gun("Blaster de brinquedo H", 0.39, 0.18),
  "blaster-i": gun("Blaster de brinquedo I", 0.31, 0.22),
  "blaster-j": gun("Blaster de brinquedo J", 0.37, 0.2),
  "blaster-k": gun("Blaster de brinquedo K", 0.28, 0.3),
  "blaster-l": gun("Blaster de brinquedo L", 0.33, 0.3),
  "blaster-m": gun("Blaster de brinquedo M", 0.37, 0.3),
  "blaster-n": gun("Blaster de brinquedo N", 0.38, 0.3),
  "blaster-o": gun("Blaster de brinquedo O", 0.29, 0.3),
  "blaster-p": gun("Blaster de brinquedo P", 0.52, 0.3),
  "blaster-q": gun("Blaster de brinquedo Q", 0.43, 0.3),
  "blaster-r": gun("Blaster de brinquedo R", 0.41, 0.3),
  "clip-large": thing("Pente grande", 0.15),
  "clip-small": thing("Pente pequeno", 0.094),
  "crate-medium": thing("Caixa de blasters", 0.6),
  "crate-small": thing("Caixa de blaster pequena", 0.48),
  "crate-wide": thing("Caixa de blasters larga", 0.72),
  "grenade-a": thing("Granada de brinquedo", 0.14),
  "grenade-b": thing("Granada de brinquedo redonda", 0.13),
  "scope-large-a": thing("Mira de brinquedo", 0.26),
  "scope-large-b": thing("Mira de brinquedo B", 0.26),
  "scope-small": thing("Mira de brinquedo curta", 0.17),
  "silencer-larger": thing("Silenciador de brinquedo", 0.17),
  "silencer-small": thing("Silenciador de brinquedo pequeno", 0.15),
  smoke: thing("Fumaça", 0.3),
  "target-detail": thing("Alvo com suporte", 0.3),
  "target-large": thing("Alvo grande", 0.4),
  "target-small": thing("Alvo pequeno", 0.24),
};
