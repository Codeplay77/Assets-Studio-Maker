// Turns file names like "road-curve-barrier" into names a beginner can read in Portuguese.

const WORDS: Record<string, string> = {
  accessory: "acessório", ambulance: "ambulância", arch: "arco", awning: "toldo", bales: "fardos", bank: "barranco",
  barrel: "barril", barrier: "barreira", base: "base", bed: "cama", bend: "dobra", big: "grande", billboard: "outdoor",
  birch: "bétula", block: "bloco", blocky: "bloco", border: "borda", bottom: "base", branch: "galho", bridge: "ponte",
  building: "prédio", bush: "arbusto", cactus: "cacto", campfire: "fogueira", canoe: "canoa", car: "carro", center: "centro",
  character: "personagem", checkers: "xadrez", chimney: "chaminé", city: "cidade", cliff: "penhasco", cloud: "nuvem",
  column: "coluna", concrete: "concreto", cone: "cone", construction: "obra", corn: "milho", corner: "canto", crop: "plantação",
  crops: "plantação", cross: "cruz", crossing: "faixa", crossroad: "cruzamento", curve: "curva", curved: "curvo",
  dark: "escuro", dead: "seco", delivery: "entrega", detail: "detalhe", detailed: "detalhado", diagonal: "diagonal",
  dirt: "terra", door: "porta", double: "duplo", driveway: "garagem", edge: "borda", electricity: "eletricidade",
  end: "fim", entry: "entrada", fat: "largo", fence: "cerca", fir: "abeto", firetruck: "bombeiros", flag: "bandeira",
  flat: "plano", flower: "flor", forest: "floresta", fountain: "fonte", future: "futurista", garage: "garagem",
  garbage: "lixo", gate: "portão", grandstand: "arquibancada", grass: "grama", ground: "chão", group: "grupo",
  half: "meio", hatchback: "hatch", hedge: "cerca-viva", high: "alto", highway: "rodovia", hill: "colina", hole: "buraco",
  house: "casa", inner: "interno", intersection: "cruzamento", island: "ilha", kart: "kart", ladder: "escada", lake: "lago",
  large: "grande", larger: "maior", leafs: "folhas", left: "esquerda", light: "luz", lily: "lírio", lights: "luzes", log: "tora",
  long: "longo", low: "baixo", luxury: "luxo", mailbox: "correio", medium: "médio", mushroom: "cogumelo", narrow: "estreito",
  net: "rede", object: "objeto", oak: "carvalho", open: "aberto", outer: "externo", overhang: "cobertura", overhead: "suspenso",
  palm: "palmeira", parasol: "guarda-sol", path: "caminho", pillar: "pilar", pine: "pinheiro", pit: "box", pits: "boxes",
  planks: "tábuas", plant: "planta", platform: "plataforma", police: "polícia", pole: "poste", pumpkin: "abóbora",
  pylon: "torre", race: "corrida", racing: "corrida", ramp: "rampa", red: "vermelho", ridge: "crista", right: "direita",
  river: "rio", road: "rua", rock: "pedra", rocks: "pedras", roof: "telhado", round: "redondo", sand: "areia",
  sedan: "sedã", short: "curto", side: "lateral", sign: "placa", single: "simples", skyscraper: "arranha-céu", slant: "inclinado",
  small: "pequeno", snow: "neve", sports: "esportivo", spoiler: "aerofólio", square: "quadrado", stack: "pilha", stage: "estágio",
  start: "largada", statue: "estátua", steps: "degraus", stone: "pedra", stones: "pedras", straight: "reta", street: "rua",
  stump: "toco", sunflower: "girassol", suv: "SUV", tall: "alto", taxi: "táxi", tent: "tenda", tile: "piso", tiles: "pisos",
  tire: "pneu", tires: "pneus", tower: "torre", tractor: "trator", traffic: "trânsito", tree: "árvore", triangle: "triângulo",
  tripple: "triplo", triple: "triplo", truck: "caminhão", tunnel: "túnel", type: "tipo", van: "van", wall: "muro", warning: "alerta",
  water: "água", wheat: "trigo", wheel: "roda", wide: "largo", window: "janela", wood: "madeira", wooden: "de madeira",
};

const WHOLE_NAMES: Record<string, string> = {
  box: "Caixa",
  "garbage-truck": "Caminhão de lixo",
  "truck-flat": "Caminhão aberto",
  "delivery-flat": "Entrega aberta",
  "tractor-shovel": "Trator escavadeira",
  "tractor-police": "Trator da polícia",
  "hatchback-sports": "Hatch esportivo",
  "race-future": "Corrida futurista",
  "suv-luxury": "SUV de luxo",
  "sedan-sports": "Sedã esportivo",
};

export function translateName(fileName: string): string {
  if (WHOLE_NAMES[fileName]) return WHOLE_NAMES[fileName];
  const words = fileName
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([a-zA-Z])(\d)/g, "$1 $2")
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.toLowerCase());

  const translated = words.map((word) => {
    if (word.length === 1) return word.toUpperCase();
    return WORDS[word] ?? word;
  });
  const text = translated.join(" ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
