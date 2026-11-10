import type { ArtStyle } from "../blocks/styles";
import { HOUSE_IDS, HOUSE_NAMES, HOUSE_ROOFS, HOUSE_WALLS, TOWER_ACCENTS, TOWER_FLOORS, TOWER_GROUNDS, TOWER_NAMES, TOWER_ROOFS, TOWER_TRIMS, TOWER_WALLS } from "../blocks/definitions/family/homes.ts";
import { BAKED_WHEEL_IDS, BAKED_WHEEL_NAMES, KART_HELMETS, KART_SPOILERS } from "../blocks/definitions/family/baked.ts";
import { kindsOf, modelsOf, VEHICLE_KINDS, vehicleModelName } from "./car";
import { HOUSE_COLORS, ROOF_COLORS, treeKinds, WALL_COLORS } from "./buildings";
import { PAINT_PALETTE } from "./kart";
import { HAIR_COLORS, SKIN_TONES } from "./person";
import { ROOM_NAMES, SINGLE_ROOMS, WALL_COLORS as ROOM_WALLS } from "./interior";

/** The choice that leaves a decision to the seed. */
export const ANY = "any";

export interface OptionChoice {
  id: string;
  label: string;
  /** Shown as a color sample instead of text. */
  color?: string;
}

export interface GeneratorSettings {
  style: ArtStyle;
  /** Option id to choice id. Missing options are left to the seed. */
  options: Record<string, string>;
}

export interface GeneratorOption {
  id: string;
  label: string;
  /** The ANY choice is implied and always comes first. */
  choices: (style: ArtStyle, options?: Record<string, string>) => OptionChoice[];
  /** Hides an option that does not apply to the other settings. */
  applies?: (settings: GeneratorSettings) => boolean;
  /** For agents: the choices of an option whose list depends on another one. */
  describe?: () => string;
}

const fixed = (choices: OptionChoice[]) => () => choices;
const yesNo = fixed([
  { id: "yes", label: "Sim" },
  { id: "no", label: "Não" },
]);
const swatches = (colors: string[]) => fixed(colors.map((color) => ({ id: color, label: color, color })));
const builtFromParts = ({ style }: GeneratorSettings) => style !== "lowpoly" && style !== "arcade";
const isArcade = ({ style }: GeneratorSettings) => style === "arcade";
const paintSwatches = swatches(PAINT_PALETTE);
const named = (ids: string[], names: Record<string, string>) => fixed(ids.map((id) => ({ id, label: names[id] })));

const HAIR_COLOR_NAMES: Record<string, string> = {
  black: "Preto",
  brown: "Castanho",
  blond: "Loiro",
  red: "Ruivo",
  gray: "Grisalho",
  colored: "Colorido",
};

export const PERSON_OPTIONS: GeneratorOption[] = [
  {
    id: "sex",
    label: "Sexo",
    choices: fixed([
      { id: "male", label: "Homem" },
      { id: "female", label: "Mulher" },
    ]),
  },
  {
    id: "age",
    label: "Idade",
    choices: fixed([
      { id: "child", label: "Criança" },
      { id: "teen", label: "Jovem" },
      { id: "adult", label: "Adulto" },
      { id: "elder", label: "Idoso" },
    ]),
  },
  {
    id: "build",
    label: "Porte",
    choices: fixed([
      { id: "slim", label: "Magro" },
      { id: "medium", label: "Médio" },
      { id: "strong", label: "Forte" },
    ]),
  },
  {
    id: "height",
    label: "Altura",
    choices: fixed([
      { id: "short", label: "Baixo" },
      { id: "medium", label: "Médio" },
      { id: "tall", label: "Alto" },
    ]),
  },
  {
    id: "skin",
    label: "Pele",
    choices: fixed(SKIN_TONES.map((color, index) => ({ id: String(index), label: `Tom ${index + 1}`, color }))),
  },
  {
    id: "hair",
    label: "Cabelo",
    choices: fixed([
      { id: "short", label: "Curto" },
      { id: "bob", label: "Chanel" },
      { id: "long", label: "Longo" },
      { id: "tied", label: "Preso" },
      { id: "curly", label: "Cacheado" },
      { id: "punk", label: "Punk" },
      { id: "bald", label: "Careca" },
    ]),
  },
  {
    id: "hairColor",
    label: "Cor do cabelo",
    choices: fixed(
      Object.entries(HAIR_COLORS).map(([id, color]) => ({ id, color, label: HAIR_COLOR_NAMES[id] })),
    ),
    applies: ({ options }) => options.hair !== "bald",
  },
  {
    id: "outfit",
    label: "Roupa",
    choices: fixed([
      { id: "casual", label: "Casual" },
      { id: "sport", label: "Esporte" },
      { id: "formal", label: "Social" },
      { id: "uniform", label: "Uniforme" },
      { id: "dress", label: "Vestido" },
    ]),
  },
  {
    id: "beard",
    label: "Barba",
    choices: yesNo,
    applies: ({ options }) => options.sex !== "female" && options.age !== "child" && options.age !== "teen",
  },
  { id: "glasses", label: "Óculos", choices: yesNo },
  { id: "hat", label: "Chapéu", choices: yesNo },
  { id: "backpack", label: "Mochila", choices: yesNo },
];

const SERVICE_KINDS = ["taxi", "police", "ambulance", "firetruck"];
const isKart = ({ options }: GeneratorSettings) => options.kind === "kart";
const kartWithDriver = (settings: GeneratorSettings) => isKart(settings) && settings.options.driver !== "no";
/** Service vehicles keep their standard paint, so only the rims and wheels stay open. */
const familyPaint = ({ options }: GeneratorSettings) => options.kind !== "tractor" && !SERVICE_KINDS.includes(options.kind);

const VEHICLE_NAMES: Record<string, string> = {
  semi: "Carreta",
  moto: "Moto",
  car: "Carro",
  suv: "SUV",
  pickup: "Picape",
  sport: "Esportivo",
  van: "Van",
  truck: "Caminhão",
  bus: "Ônibus",
  race: "Corrida",
  kart: "Kart",
  taxi: "Táxi",
  police: "Polícia",
  ambulance: "Ambulância",
  firetruck: "Bombeiros",
  tractor: "Trator",
};

export const VEHICLE_OPTIONS: GeneratorOption[] = [
  {
    id: "kind",
    label: "Tipo",
    choices: (style) => kindsOf(style).map((id) => ({ id, label: VEHICLE_NAMES[id] })),
  },
  {
    id: "model",
    label: "Modelo",
    choices: (_style, options = {}) => modelsOf(options.kind).map((id) => ({ id, label: vehicleModelName(id) })),
    applies: ({ options }) => modelsOf(options.kind).length > 1,
    describe: () => `depends on kind; ${VEHICLE_KINDS.map((kind) => `${kind}=${modelsOf(kind).join("|")}`).join(", ")}`,
  },
  {
    id: "wheels",
    label: "Rodas",
    choices: () => BAKED_WHEEL_IDS.map((id) => ({ id, label: BAKED_WHEEL_NAMES[id] })),
    // A motorcycle's wheels are part of the model, already in the middle of it.
    applies: (settings) => familyPaint(settings) && settings.options.kind !== "moto",
  },
  {
    id: "spoiler",
    label: "Aerofólio",
    choices: fixed([{ id: "none", label: "Nenhum" }, ...Object.entries(KART_SPOILERS).map(([id, label]) => ({ id, label }))]),
    applies: isKart,
  },
  { id: "driver", label: "Piloto", choices: yesNo, applies: isKart },
  { id: "helmet", label: "Capacete", choices: named(Object.keys(KART_HELMETS), KART_HELMETS), applies: kartWithDriver },
  { id: "paint", label: "Pintura principal", choices: paintSwatches, applies: familyPaint },
  { id: "trim", label: "Pintura secundária", choices: paintSwatches, applies: familyPaint },
  { id: "accent", label: "Detalhes", choices: paintSwatches, applies: familyPaint },
  { id: "rim", label: "Aros", choices: paintSwatches, applies: familyPaint },
  { id: "suit", label: "Macacão", choices: paintSwatches, applies: kartWithDriver },
  { id: "helmetColor", label: "Cor do capacete", choices: paintSwatches, applies: kartWithDriver },
];

const towerChoice = (ids: string[]) => named(ids, TOWER_NAMES);

export const BUILDING_OPTIONS: GeneratorOption[] = [
  {
    id: "size",
    label: "Altura",
    choices: fixed([
      { id: "low", label: "Baixo" },
      { id: "medium", label: "Médio" },
      { id: "tall", label: "Alto" },
    ]),
  },
  { id: "ground", label: "Térreo", choices: towerChoice(TOWER_GROUNDS), applies: isArcade },
  { id: "floor", label: "Andares", choices: towerChoice(TOWER_FLOORS), applies: isArcade },
  { id: "roof", label: "Topo", choices: towerChoice(TOWER_ROOFS), applies: isArcade },
  { id: "color", label: "Cor", choices: swatches(WALL_COLORS), applies: builtFromParts },
  { id: "paint", label: "Paredes", choices: swatches(TOWER_WALLS), applies: isArcade },
  { id: "trim", label: "Molduras", choices: swatches(TOWER_TRIMS), applies: isArcade },
  { id: "accent", label: "Detalhes", choices: swatches(TOWER_ACCENTS), applies: isArcade },
];

export const HOUSE_OPTIONS: GeneratorOption[] = [
  { id: "model", label: "Modelo", choices: named(HOUSE_IDS, HOUSE_NAMES), applies: isArcade },
  {
    id: "size",
    label: "Tamanho",
    choices: fixed([
      { id: "small", label: "Pequena" },
      { id: "large", label: "Grande" },
    ]),
    applies: ({ style }) => style === "lowpoly",
  },
  { id: "color", label: "Paredes", choices: swatches(HOUSE_COLORS), applies: builtFromParts },
  { id: "roof", label: "Telhado", choices: swatches(ROOF_COLORS), applies: builtFromParts },
  { id: "paint", label: "Paredes", choices: swatches(HOUSE_WALLS), applies: isArcade },
  { id: "trim", label: "Telhado", choices: swatches(HOUSE_ROOFS), applies: isArcade },
  { id: "accent", label: "Detalhes", choices: paintSwatches, applies: isArcade },
];

const TREE_NAMES: Record<string, string> = { leafy: "Folhosa", pine: "Pinheiro", palm: "Palmeira", dead: "Seca" };

export const TREE_OPTIONS: GeneratorOption[] = [
  { id: "kind", label: "Tipo", choices: (style) => treeKinds(style).map((id) => ({ id, label: TREE_NAMES[id] })) },
  {
    id: "season",
    label: "Estação",
    choices: fixed([
      { id: "summer", label: "Verde" },
      { id: "autumn", label: "Outono" },
    ]),
    applies: ({ options }) => options.kind !== "dead" && options.kind !== "palm",
  },
  {
    id: "size",
    label: "Tamanho",
    choices: fixed([
      { id: "small", label: "Pequena" },
      { id: "medium", label: "Média" },
      { id: "large", label: "Grande" },
    ]),
  },
];

const MAP_SIZES = [50, 100, 150, 200, 300, 500];

export const MAP_OPTIONS: GeneratorOption[] = [
  {
    id: "biome",
    label: "Tipo",
    choices: fixed([
      { id: "floresta", label: "Floresta" },
      { id: "montanhas", label: "Montanhas" },
      { id: "planicie", label: "Planície" },
      { id: "vale", label: "Vale" },
      { id: "ilha", label: "Ilha" },
      { id: "arquipelago", label: "Arquipélago" },
      { id: "deserto", label: "Deserto" },
      { id: "neve", label: "Neve" },
      { id: "pantano", label: "Pântano" },
      { id: "vulcao", label: "Vulcão" },
    ]),
  },
  { id: "width", label: "Largura (metros)", choices: () => MAP_SIZES.map((size) => ({ id: String(size), label: String(size) })) },
  { id: "length", label: "Comprimento (metros)", choices: () => MAP_SIZES.map((size) => ({ id: String(size), label: String(size) })) },
  {
    id: "relief",
    label: "Relevo",
    choices: fixed([
      { id: "soft", label: "Suave" },
      { id: "medium", label: "Médio" },
      { id: "rough", label: "Acidentado" },
    ]),
  },
  {
    id: "vegetation",
    label: "Vegetação",
    choices: fixed([
      { id: "none", label: "Nenhuma" },
      { id: "low", label: "Pouca" },
      { id: "medium", label: "Média" },
      { id: "dense", label: "Densa" },
    ]),
  },
  {
    id: "water",
    label: "Água",
    choices: fixed([
      { id: "all", label: "Rios e lagos" },
      { id: "rivers", label: "Só rios" },
      { id: "lakes", label: "Só lagos" },
      { id: "none", label: "Sem água" },
    ]),
  },
  { id: "rocks", label: "Pedras", choices: yesNo },
  { id: "trails", label: "Trilhas", choices: yesNo },
];

const counts = (values: number[]) => fixed(values.map((value) => ({ id: String(value), label: String(value) })));
const CITY_BLOCKS = [1, 2, 3, 4, 5, 6, 8];

const FREE_LAYOUTS = [
  { id: "irregular", label: "Irregular" },
  { id: "organic", label: "Orgânico" },
  { id: "grid", label: "Grade" },
];

export const CITY_OPTIONS: GeneratorOption[] = [
  {
    id: "layout",
    label: "Traçado das ruas",
    // Voxels have no diagonals or curves, so the organic layout has nothing to offer them.
    choices: (style) => FREE_LAYOUTS.filter(({ id }) => style !== "blocks" || id !== "organic"),
  },
  { id: "width", label: "Largura (quarteirões)", choices: counts(CITY_BLOCKS) },
  { id: "length", label: "Comprimento (quarteirões)", choices: counts(CITY_BLOCKS) },
  {
    id: "lots",
    label: "Lotes por quarteirão",
    choices: fixed([
      { id: "2", label: "2 × 2" },
      { id: "3", label: "3 × 3" },
      { id: "4", label: "4 × 4" },
    ]),
  },
  {
    id: "height",
    label: "Altura dos prédios",
    choices: fixed([
      { id: "low", label: "Baixos" },
      { id: "medium", label: "Médios" },
      { id: "tall", label: "Altos" },
      { id: "skyscraper", label: "Arranha-céus" },
    ]),
  },
  {
    id: "density",
    label: "Região",
    choices: fixed([
      { id: "suburb", label: "Bairro" },
      { id: "downtown", label: "Centro" },
    ]),
  },
  { id: "traffic", label: "Carros na rua", choices: yesNo },
];

export const INTERIOR_OPTIONS: GeneratorOption[] = [
  {
    id: "kind",
    label: "Tipo",
    choices: fixed([
      { id: "house", label: "Casa" },
      { id: "apartment", label: "Apartamento" },
      { id: "office", label: "Escritório" },
      { id: "shop", label: "Loja" },
      { id: "restaurant", label: "Restaurante" },
      { id: "room", label: "Um cômodo" },
    ]),
  },
  {
    id: "room",
    label: "Cômodo",
    choices: fixed(SINGLE_ROOMS.map((id) => ({ id, label: ROOM_NAMES[id] }))),
    applies: ({ options }) => options.kind === "room",
  },
  {
    id: "size",
    label: "Tamanho",
    choices: fixed([
      { id: "small", label: "Pequeno" },
      { id: "medium", label: "Médio" },
      { id: "large", label: "Grande" },
    ]),
  },
  {
    id: "furniture",
    label: "Móveis",
    choices: fixed([
      { id: "none", label: "Sem móveis" },
      { id: "basic", label: "Básico" },
      { id: "full", label: "Completo" },
    ]),
  },
  {
    id: "floor",
    label: "Piso (salas e quartos)",
    choices: fixed([
      { id: "wood", label: "Madeira" },
      { id: "tile", label: "Cerâmica" },
      { id: "carpet", label: "Carpete" },
      { id: "concrete", label: "Cimento" },
      { id: "checker", label: "Xadrez" },
    ]),
  },
  { id: "wall", label: "Paredes", choices: (style) => ROOM_WALLS[style].map((color) => ({ id: color, label: color, color })) },
  { id: "doors", label: "Portas", choices: yesNo },
  { id: "ceiling", label: "Teto", choices: yesNo },
];
