// Converts the CC0 human animations of Mesh2Motion, and the editor's own dances and fighting moves,
// into the editor's animation pack.
//
//   node scripts/import-animations.ts <folder with human-base-animations.glb and human-addon-animations.glb> <dancas.glb> <combate.glb>
//
// The editor's own clips are made on the same skeleton by tools/blender/make_dances.py and
// tools/blender/make_combat.py; any number of their GLBs may follow the folder.
// The files come from https://github.com/Mesh2Motion/mesh2motion-app (models, rigs and animations
// are CC0). Each file is only parsed as data; nothing from it is ever executed.
//
// Every clip is resampled at 30 frames per second. For each bone the pack keeps how far its world
// rotation turned from the rest pose, which is what lets a character with other proportions and
// another rest pose play it: the editor turns each of its own blocks by that amount.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Matrix4, Quaternion, Vector3 } from "three";

const FPS = 30;
const FILES = [
  { file: "human-base-animations.glb", set: "base" },
  { file: "human-addon-animations.glb", set: "extra" },
];

/** The body's bones, which tell whether a clip repeats. */
const BODY = [
  "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
  "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l",
  "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
  "thigh_l", "calf_l", "foot_l", "ball_l",
  "thigh_r", "calf_r", "foot_r", "ball_r",
];
/** Three bones in each finger, from the knuckle out. */
const FINGERS = ["thumb", "index", "middle", "ring", "pinky"].flatMap((finger) => ["01", "02", "03"].map((bone) => `${finger}_${bone}`));

/**
 * The bones the pack keeps, parents before children. Unreal mannequin names, like the source. The
 * fingers come last, so a skeleton without them (the people of the other styles) uses the first ones.
 */
const BONES = [...BODY, ...["l", "r"].flatMap((side) => FINGERS.map((bone) => `${bone}_${side}`))];

/** Where each bone points at rest: toward this other joint. */
const TIP: Record<string, string> = {
  pelvis: "spine_01", spine_01: "spine_02", spine_02: "spine_03", spine_03: "neck_01", neck_01: "head", head: "head_leaf",
  clavicle_l: "upperarm_l", upperarm_l: "lowerarm_l", lowerarm_l: "hand_l", hand_l: "middle_01_l",
  clavicle_r: "upperarm_r", upperarm_r: "lowerarm_r", lowerarm_r: "hand_r", hand_r: "middle_01_r",
  thigh_l: "calf_l", calf_l: "foot_l", foot_l: "ball_l", ball_l: "ball_leaf_l",
  thigh_r: "calf_r", calf_r: "foot_r", foot_r: "ball_r", ball_r: "ball_leaf_r",
  // A finger bone points to the next one; the last, to the fingertip.
  ...Object.fromEntries(BONES.filter((bone) => /_0[123]_[lr]$/.test(bone)).map((bone) => [bone, bone.replace(/_0([123])_/, (_, n) => `_0${Number(n) + 1}${n === "3" ? "_leaf" : ""}_`)])),
};

const CATEGORIES = [
  "Parado", "Andar e correr", "Pular e esquivar", "Luta", "Espada e escudo", "Armas", "Magia", "Gestos",
  "Dança", "Exercício", "Tarefas", "Escalar e nadar", "Voar e levitar", "Sentar e deitar", "Dano e morte", "Zumbi",
] as const;
type Category = (typeof CATEGORIES)[number];

/** A name in Portuguese and a category for every clip. */
const NAMES: Record<string, [string, Category]> = {
  Chest_Open: ["Abrir baú", "Tarefas"],
  Chop_Tree: ["Cortar árvore", "Tarefas"],
  ClimbUp_1m_RM: ["Subir um degrau alto", "Escalar e nadar"],
  Consume: ["Comer ou beber", "Tarefas"],
  Crouch_Idle: ["Agachado", "Parado"],
  Crouch_Walk: ["Andar agachado", "Andar e correr"],
  Dance_Simple: ["Dança simples", "Dança"],
  Death_D: ["Morrer 4", "Dano e morte"],
  Driving: ["Dirigir", "Tarefas"],
  Farm_Harvest: ["Colher", "Tarefas"],
  Farm_PlantSeed: ["Plantar semente", "Tarefas"],
  Farm_Watering: ["Regar", "Tarefas"],
  Fixing_Kneeling: ["Consertar ajoelhado", "Tarefas"],
  Hit_Chest: ["Golpe no peito", "Dano e morte"],
  Hit_Head: ["Golpe na cabeça", "Dano e morte"],
  Hit_Knockback: ["Ser arremessado", "Dano e morte"],
  Hit_Knockback_RM: ["Ser arremessado (sai do lugar)", "Dano e morte"],
  Idle_A: ["Parado", "Parado"],
  Idle_FoldArms: ["Braços cruzados", "Parado"],
  Idle_Lantern: ["Segurando lanterna", "Parado"],
  Idle_Rail: ["Apoiado no parapeito", "Parado"],
  Idle_Rail_Call: ["Apoiado no parapeito, chamando", "Parado"],
  Idle_ShakeOff: ["Sacudir o corpo", "Parado"],
  Idle_Shield: ["Parado com escudo", "Espada e escudo"],
  Idle_Shield_Break: ["Escudo quebrado", "Espada e escudo"],
  Idle_Sword: ["Parado com espada", "Espada e escudo"],
  Idle_Talking: ["Conversando", "Gestos"],
  Idle_TalkingPhone: ["Falando ao telefone", "Gestos"],
  Idle_Torch: ["Segurando tocha", "Parado"],
  Interact: ["Interagir", "Tarefas"],
  Jog: ["Trotar", "Andar e correr"],
  Jump_air: ["Pulo: no ar", "Pular e esquivar"],
  Jump_Land: ["Pulo: aterrissar", "Pular e esquivar"],
  Jump_Start: ["Pulo: impulso", "Pular e esquivar"],
  LayToIdle: ["Levantar do chão", "Sentar e deitar"],
  Melee_Hook: ["Gancho", "Luta"],
  Melee_Hook_Rec: ["Gancho: voltar", "Luta"],
  NinjaJump_Idle: ["Pulo ninja: no ar", "Pular e esquivar"],
  NinjaJump_Land: ["Pulo ninja: aterrissar", "Pular e esquivar"],
  NinjaJump_Start: ["Pulo ninja: impulso", "Pular e esquivar"],
  OverhandThrow: ["Arremessar", "Armas"],
  PickUp_Table: ["Pegar da mesa", "Tarefas"],
  Pistol_Aim_Down: ["Pistola: mirar para baixo", "Armas"],
  Pistol_Aim_Neutral: ["Pistola: mirar", "Armas"],
  Pistol_Aim_Up: ["Pistola: mirar para cima", "Armas"],
  Pistol_Idle: ["Pistola: parado", "Armas"],
  Pistol_Reload: ["Pistola: recarregar", "Armas"],
  Pistol_Shoot: ["Pistola: atirar", "Armas"],
  Punch_Cross: ["Soco cruzado", "Luta"],
  Punch_Jab: ["Soco direto", "Luta"],
  Push: ["Empurrar", "Tarefas"],
  Roll: ["Rolar", "Pular e esquivar"],
  Roll_RM: ["Rolar (sai do lugar)", "Pular e esquivar"],
  Shield_Dash_RM: ["Investida com escudo", "Espada e escudo"],
  Shield_OneShot: ["Golpe de escudo", "Espada e escudo"],
  Sitting_Enter: ["Sentar", "Sentar e deitar"],
  Sitting_Exit: ["Levantar da cadeira", "Sentar e deitar"],
  Sitting_Idle: ["Sentado", "Sentar e deitar"],
  Sitting_Talking: ["Sentado conversando", "Sentar e deitar"],
  Slide: ["Deslizar", "Pular e esquivar"],
  Slide_Exit: ["Deslizar: sair", "Pular e esquivar"],
  Slide_Start: ["Deslizar: entrar", "Pular e esquivar"],
  Spell_Simple_Enter: ["Magia: preparar", "Magia"],
  Spell_Simple_Exit: ["Magia: encerrar", "Magia"],
  Spell_Simple_Idle: ["Magia: concentrado", "Magia"],
  Spell_Simple_Shoot: ["Magia: lançar", "Magia"],
  Sprint: ["Correr rápido", "Andar e correr"],
  Swim_Fwd: ["Nadar", "Escalar e nadar"],
  Swim_Idle: ["Boiar", "Escalar e nadar"],
  Sword_Attack: ["Ataque de espada", "Espada e escudo"],
  Sword_Attack_RM: ["Ataque de espada (sai do lugar)", "Espada e escudo"],
  Sword_Block: ["Defender com espada", "Espada e escudo"],
  Sword_Dash_RM: ["Investida com espada", "Espada e escudo"],
  Sword_Regular_A: ["Golpe de espada 1", "Espada e escudo"],
  Sword_Regular_A_Rec: ["Golpe de espada 1: voltar", "Espada e escudo"],
  Sword_Regular_B: ["Golpe de espada 2", "Espada e escudo"],
  Sword_Regular_B_Rec: ["Golpe de espada 2: voltar", "Espada e escudo"],
  Sword_Regular_C: ["Golpe de espada 3", "Espada e escudo"],
  Sword_Regular_C_RM: ["Golpe de espada 3 (sai do lugar)", "Espada e escudo"],
  Sword_Regular_Combo: ["Sequência de golpes de espada", "Espada e escudo"],
  Walk: ["Andar", "Andar e correr"],
  Walk_Carry: ["Andar carregando", "Andar e correr"],
  Walk_Formal: ["Andar elegante", "Andar e correr"],
  Yes: ["Dizer sim", "Gestos"],
  Zombie_Idle: ["Zumbi parado", "Zumbi"],
  Zombie_Scratch: ["Zumbi arranhando", "Zumbi"],
  Zombie_Walk: ["Zumbi andando", "Zumbi"],

  Angry: ["Bravo", "Gestos"],
  Attack_Ground_Pound: ["Soco no chão", "Luta"],
  Backflip: ["Mortal para trás", "Pular e esquivar"],
  Bow: ["Reverência", "Gestos"],
  "Bow Pull Back": ["Arco: puxar a corda", "Armas"],
  "Bow Pull Hold": ["Arco: segurar a corda", "Armas"],
  "Bow Release": ["Arco: soltar a flecha", "Armas"],
  "Climb Ladder": ["Subir escada de mão", "Escalar e nadar"],
  "Climb Wall": ["Escalar parede", "Escalar e nadar"],
  Confused: ["Confuso", "Gestos"],
  "Consume Item": ["Usar item", "Tarefas"],
  Crawl: ["Rastejar", "Andar e correr"],
  "Crawl RM": ["Rastejar (sai do lugar)", "Andar e correr"],
  "Dance Body Roll": ["Dança: onda com o corpo", "Dança"],
  "Dance Charleston": ["Dança: charleston", "Dança"],
  "Dance Reach Hip": ["Dança: mão no quadril", "Dança"],
  Death_A: ["Morrer 1", "Dano e morte"],
  Death_B: ["Morrer 2", "Dano e morte"],
  Death_C: ["Morrer 3", "Dano e morte"],
  Defend: ["Defender", "Luta"],
  Dizzy: ["Tonto", "Gestos"],
  Dodge_back: ["Esquivar para trás", "Pular e esquivar"],
  Dodge_back_RM: ["Esquivar para trás (sai do lugar)", "Pular e esquivar"],
  Dodge_left: ["Esquivar para a esquerda", "Pular e esquivar"],
  Dodge_left_RM: ["Esquivar para a esquerda (sai do lugar)", "Pular e esquivar"],
  Dodge_right: ["Esquivar para a direita", "Pular e esquivar"],
  Dodge_right_RM: ["Esquivar para a direita (sai do lugar)", "Pular e esquivar"],
  "Fighting Idle": ["Guarda de luta", "Luta"],
  "Fighting Left Jab": ["Soco de esquerda", "Luta"],
  "Fighting Right Jab": ["Soco de direita", "Luta"],
  "Flying Forward": ["Voar", "Voar e levitar"],
  "Flying Forward Super": ["Voar como super-herói", "Voar e levitar"],
  Glide: ["Planar", "Voar e levitar"],
  Greeting: ["Acenar", "Gestos"],
  "Head Nod": ["Balançar a cabeça", "Gestos"],
  "Idle Hurt": ["Parado, machucado", "Parado"],
  "Idle Listening": ["Ouvindo", "Gestos"],
  Idle_Subtle: ["Parado, discreto", "Parado"],
  Jump_2: ["Pulo 2", "Pular e esquivar"],
  Jump_2_RM: ["Pulo 2 (sai do lugar)", "Pular e esquivar"],
  "Jumping Jacks": ["Polichinelo", "Exercício"],
  "Kneeling Tired": ["Ajoelhado, cansado", "Parado"],
  Ladder_Idle: ["Parado na escada de mão", "Escalar e nadar"],
  Land_Three_Point: ["Aterrissar de super-herói", "Pular e esquivar"],
  "Ledge Hang": ["Pendurado na beirada", "Escalar e nadar"],
  "Levitate Entrance": ["Levitar: subir", "Voar e levitar"],
  "Levitate Idle": ["Levitando", "Voar e levitar"],
  Meditate: ["Meditar", "Exercício"],
  "Pipe Climb": ["Subir no cano", "Escalar e nadar"],
  "Power Up": ["Carregar poder", "Magia"],
  Pushup: ["Flexão", "Exercício"],
  Reject: ["Recusar", "Gestos"],
  "Rest Pose": ["Pose em T", "Parado"],
  "Run Jump": ["Pular correndo", "Pular e esquivar"],
  Run_Anime: ["Correr como anime", "Andar e correr"],
  Run_Female: ["Correr leve", "Andar e correr"],
  Run_Stealth: ["Correr escondido", "Andar e correr"],
  Shivering: ["Tremendo de frio", "Gestos"],
  Sleeping: ["Dormindo", "Sentar e deitar"],
  Strafe_left: ["Andar de lado, para a esquerda", "Andar e correr"],
  Strafe_right: ["Andar de lado, para a direita", "Andar e correr"],
  Sword_Attack_Air_Vertical: ["Ataque de espada no ar", "Espada e escudo"],
  "Throw Object": ["Jogar objeto", "Armas"],
  "Tired Hunched": ["Cansado, curvado", "Parado"],
  "Two-hand Blast": ["Rajada com as duas mãos", "Magia"],
  Victory: ["Vitória", "Gestos"],
  "Victory Fist Pump": ["Vitória com o punho", "Gestos"],
  Walk_Backwards: ["Andar de costas", "Andar e correr"],
  Walk_Female: ["Andar leve", "Andar e correr"],
  Walk_Large: ["Andar pesado", "Andar e correr"],
  Walk_Stealth: ["Andar escondido", "Andar e correr"],
  "Zombie Yell": ["Zumbi gritando", "Zumbi"],
  Zombie_Idle_Crouch: ["Zumbi agachado", "Zumbi"],
  Zombie_Rise: ["Zumbi levantando", "Zumbi"],
  Zombie_Walk_2: ["Zumbi andando 2", "Zumbi"],
  // Made for the editor (tools/blender/make_dances.py).
  Danca_Samba: ["Dança: samba no pé", "Dança"],
  Danca_Forro: ["Dança: forró", "Dança"],
  Danca_Axe: ["Dança: axé", "Dança"],
  Danca_Frevo: ["Dança: frevo", "Dança"],
  Danca_Passinho: ["Dança: passinho", "Dança"],
  Danca_Disco: ["Dança: disco", "Dança"],
  Danca_HipHop: ["Dança: balanço do hip hop", "Dança"],
  Danca_Robo: ["Dança: robô", "Dança"],
  Danca_Twist: ["Dança: twist", "Dança"],
  Danca_Salsa: ["Dança: salsa", "Dança"],
  Danca_Palmas: ["Dança: passo de lado com palmas", "Dança"],
  Danca_Rock: ["Dança: rock na guitarra", "Dança"],
  // Made for the editor (tools/blender/make_combat.py). They all start and end in the same guard.
  Combate_Guarda: ["Combate: guarda", "Luta"],
  Combate_Jab: ["Combate: jab", "Luta"],
  Combate_Direto: ["Combate: direto", "Luta"],
  Combate_Gancho: ["Combate: gancho", "Luta"],
  Combate_Uppercut: ["Combate: uppercut", "Luta"],
  Combate_Um_Dois: ["Combate: jab e direto", "Luta"],
  Combate_Sequencia: ["Combate: jab, direto e gancho", "Luta"],
  Combate_Soco_Corpo: ["Combate: soco no corpo", "Luta"],
  Combate_Cotovelada: ["Combate: cotovelada", "Luta"],
  Combate_Joelhada: ["Combate: joelhada", "Luta"],
  Combate_Chute_Frontal: ["Combate: chute frontal", "Luta"],
  Combate_Chute_Lateral: ["Combate: chute lateral", "Luta"],
  Combate_Chute_Circular: ["Combate: chute circular", "Luta"],
  Combate_Chute_Baixo: ["Combate: chute baixo", "Luta"],
  Combate_Esquiva_Pendulo: ["Combate: esquiva pendular", "Luta"],
  Combate_Esquiva_Tras: ["Combate: esquiva para trás", "Luta"],
  Combate_Bloqueio: ["Combate: bloqueio alto", "Luta"],
  Combate_Empurrao: ["Combate: empurrão", "Luta"],
  Combate_Agarrar: ["Combate: agarrar", "Luta"],
  Combate_Martelo: ["Combate: golpe de martelo", "Luta"],
  Combate_Dano_Rosto: ["Combate: levar soco no rosto", "Luta"],
  Combate_Dano_Barriga: ["Combate: levar golpe na barriga", "Luta"],
  Combate_Atordoado: ["Combate: atordoado", "Luta"],
  Combate_Provocar: ["Combate: chamar para a briga", "Luta"],
  Combate_Vitoria: ["Combate: comemorar vitória", "Luta"],
  Capoeira_Ginga: ["Capoeira: ginga", "Luta"],
  Capoeira_Meia_Lua: ["Capoeira: meia-lua de frente", "Luta"],
};

/**
 * Actions that happen once, even though they start and end in the same stance: a game waits for
 * them to finish (an attack lands, a door opens), and an engine never reports the end of a clip
 * that repeats.
 */
const ONCE = new Set([
  "Attack_Ground_Pound", "Backflip", "Bow", "Bow Pull Back", "Bow Release", "Chest_Open", "ClimbUp_1m_RM", "Consume", "Consume Item",
  "Death_A", "Death_B", "Death_C", "Death_D", "Dodge_back", "Dodge_back_RM", "Dodge_left", "Dodge_left_RM", "Dodge_right", "Dodge_right_RM",
  "Farm_Harvest", "Farm_PlantSeed", "Fighting Left Jab", "Fighting Right Jab", "Hit_Chest", "Hit_Head", "Hit_Knockback", "Hit_Knockback_RM",
  "Interact", "Jump_2", "Jump_2_RM", "Jump_Land", "Jump_Start", "Land_Three_Point", "LayToIdle", "Levitate Entrance", "Melee_Hook",
  "Melee_Hook_Rec", "NinjaJump_Land", "NinjaJump_Start", "OverhandThrow", "PickUp_Table", "Pistol_Reload", "Pistol_Shoot", "Punch_Cross",
  "Punch_Jab", "Roll", "Roll_RM", "Run Jump", "Shield_Dash_RM", "Shield_OneShot", "Sitting_Enter", "Sitting_Exit", "Slide_Exit", "Slide_Start",
  "Spell_Simple_Enter", "Spell_Simple_Exit", "Spell_Simple_Shoot", "Sword_Attack", "Sword_Attack_Air_Vertical", "Sword_Attack_RM",
  "Sword_Dash_RM", "Sword_Regular_A", "Sword_Regular_A_Rec", "Sword_Regular_B", "Sword_Regular_B_Rec", "Sword_Regular_C", "Sword_Regular_C_RM",
  "Sword_Regular_Combo", "Throw Object", "Two-hand Blast", "Victory", "Victory Fist Pump", "Zombie_Rise",
  ...Object.keys(NAMES).filter((id) => /^(Combate|Capoeira)_/.test(id) && !["Combate_Guarda", "Combate_Atordoado", "Capoeira_Ginga"].includes(id)),
]);

interface Gltf {
  nodes: { name?: string; children?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  scenes: { nodes: number[] }[];
  animations: { name: string; channels: { sampler: number; target: { node: number; path: string } }[]; samplers: { input: number; output: number; interpolation?: string }[] }[];
  accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; max?: number[] }[];
  bufferViews: { byteOffset?: number; byteLength: number; byteStride?: number }[];
}

function readGlb(file: string): { json: Gltf; bin: Buffer } {
  const data = readFileSync(file);
  if (data.readUInt32LE(0) !== 0x46546c67) throw new Error(`${file} não é um GLB`);
  const jsonLength = data.readUInt32LE(12);
  const json = JSON.parse(data.subarray(20, 20 + jsonLength).toString("utf8")) as Gltf;
  const binStart = 20 + jsonLength + 8;
  return { json, bin: data.subarray(binStart, binStart + data.readUInt32LE(20 + jsonLength)) };
}

const COMPONENTS: Record<string, number> = { SCALAR: 1, VEC3: 3, VEC4: 4 };

function floats(gltf: Gltf, bin: Buffer, index: number): Float32Array {
  const accessor = gltf.accessors[index];
  if (accessor.componentType !== 5126) throw new Error("só valores float são lidos");
  const view = gltf.bufferViews[accessor.bufferView];
  const size = COMPONENTS[accessor.type];
  if (view.byteStride && view.byteStride !== size * 4) throw new Error("dados intercalados não são lidos");
  const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0);
  const out = new Float32Array(accessor.count * size);
  for (let i = 0; i < out.length; i++) out[i] = bin.readFloatLE(start + i * 4);
  return out;
}

interface Track {
  times: Float32Array;
  values: Float32Array;
  step: boolean;
}

function sample(track: Track, time: number, size: number, out: number[]): void {
  const { times, values } = track;
  let i = 0;
  while (i < times.length - 1 && times[i + 1] <= time) i++;
  const next = Math.min(i + 1, times.length - 1);
  const span = times[next] - times[i];
  const t = track.step || span <= 0 ? 0 : Math.min(1, Math.max(0, (time - times[i]) / span));
  if (size === 4) {
    const a = new Quaternion().fromArray(values, i * 4);
    const b = new Quaternion().fromArray(values, next * 4);
    a.slerp(b, t).toArray(out);
  } else {
    for (let k = 0; k < size; k++) out[k] = values[i * size + k] * (1 - t) + values[next * size + k] * t;
  }
}

const [source, ...own] = process.argv.slice(2);
if (!source || own.length === 0) throw new Error("Informe a pasta com os GLBs de animação humana do Mesh2Motion e os GLBs do editor (dancas.glb, combate.glb).");
const repo = path.resolve(import.meta.dirname, "..");

interface ClipOut {
  id: string;
  label: string;
  category: Category;
  set: string;
  frames: number;
  offset: number;
  loop: boolean;
  moves: boolean;
}

const clips: ClipOut[] = [];
const chunks: Buffer[] = [];
let size = 0;
let rest: { joints: Record<string, number[]>; directions: Record<string, number[]> } | null = null;

for (const { file, set } of [...FILES.map(({ file, set }) => ({ file: path.join(source, file), set })), ...own.map((file) => ({ file, set: "editor" }))]) {
  const { json, bin } = readGlb(file);
  const nodes = json.nodes;
  const byName = new Map(nodes.map((node, index) => [node.name ?? "", index]));
  const parent = new Map<number, number>();
  nodes.forEach((node, index) => node.children?.forEach((child) => parent.set(child, index)));
  for (const bone of BONES) if (!byName.has(bone)) throw new Error(`${file}: falta o osso ${bone}`);

  // Local transforms at rest, from the nodes. They match the skin's bind pose.
  const restLocal = nodes.map((node) => ({
    t: new Vector3().fromArray(node.translation ?? [0, 0, 0]),
    r: new Quaternion().fromArray(node.rotation ?? [0, 0, 0, 1]),
    s: new Vector3().fromArray(node.scale ?? [1, 1, 1]),
  }));
  const worldOf = (index: number, local: typeof restLocal, cache: Map<number, Matrix4>): Matrix4 => {
    const cached = cache.get(index);
    if (cached) return cached;
    const own = new Matrix4().compose(local[index].t, local[index].r, local[index].s);
    const up = parent.get(index);
    const matrix = up === undefined ? own : worldOf(up, local, cache).clone().multiply(own);
    cache.set(index, matrix);
    return matrix;
  };
  const restCache = new Map<number, Matrix4>();
  const restWorld = (index: number) => worldOf(index, restLocal, restCache);
  const position = (m: Matrix4) => new Vector3().setFromMatrixPosition(m);
  const rotation = (m: Matrix4) => {
    const r = new Quaternion();
    m.decompose(new Vector3(), r, new Vector3());
    return r;
  };

  if (!rest) {
    rest = { joints: {}, directions: {} };
    for (const bone of BONES) {
      const at = position(restWorld(byName.get(bone)!));
      const tip = position(restWorld(byName.get(TIP[bone])!));
      rest.joints[bone] = at.toArray().map((v) => Math.round(v * 1e5) / 1e5);
      rest.directions[bone] = tip.sub(at).normalize().toArray().map((v) => Math.round(v * 1e5) / 1e5);
    }
  }
  const restRotation = BONES.map((bone) => rotation(restWorld(byName.get(bone)!)).invert());
  const restPelvis = position(restWorld(byName.get("pelvis")!));

  for (const animation of json.animations) {
    const [label, category] = NAMES[animation.name] ?? (() => {
      throw new Error(`falta o nome em português de ${animation.name}`);
    })();
    const tracks = new Map<string, Track>();
    let duration = 0;
    for (const channel of animation.channels) {
      const sampler = animation.samplers[channel.sampler];
      const times = floats(json, bin, sampler.input);
      duration = Math.max(duration, times[times.length - 1]);
      tracks.set(`${channel.target.node}|${channel.target.path}`, { times, values: floats(json, bin, sampler.output), step: sampler.interpolation === "STEP" });
    }
    const frames = Math.max(2, Math.round(duration * FPS) + 1);
    const rotations = new Int16Array(frames * BONES.length * 4);
    const moves = new Float32Array(frames * 3);
    const previous = BONES.map(() => new Quaternion());
    const value = [0, 0, 0, 0];

    for (let frame = 0; frame < frames; frame++) {
      const time = Math.min(duration, frame / FPS);
      const local = restLocal.map((node, index) => {
        const t = tracks.get(`${index}|translation`);
        const r = tracks.get(`${index}|rotation`);
        const s = tracks.get(`${index}|scale`);
        return {
          t: t ? (sample(t, time, 3, value), new Vector3(value[0], value[1], value[2])) : node.t,
          r: r ? (sample(r, time, 4, value), new Quaternion(value[0], value[1], value[2], value[3]).normalize()) : node.r,
          s: s ? (sample(s, time, 3, value), new Vector3(value[0], value[1], value[2])) : node.s,
        };
      });
      const cache = new Map<number, Matrix4>();
      BONES.forEach((bone, b) => {
        const world = worldOf(byName.get(bone)!, local, cache);
        // How far the bone turned from rest, in the space of the scene.
        const turn = rotation(world).multiply(restRotation[b]).normalize();
        if (turn.dot(previous[b]) < 0) turn.set(-turn.x, -turn.y, -turn.z, -turn.w);
        previous[b].copy(turn);
        const at = (frame * BONES.length + b) * 4;
        rotations[at] = Math.round(turn.x * 32767);
        rotations[at + 1] = Math.round(turn.y * 32767);
        rotations[at + 2] = Math.round(turn.z * 32767);
        rotations[at + 3] = Math.round(turn.w * 32767);
        if (b === 0) position(world).sub(restPelvis).toArray(moves, frame * 3);
      });
    }

    // A clip repeats when going from its last pose back to its first is no bigger a change than one
    // of its own steps: either it ends on its first pose again, or one step before it.
    const turnAt = (frame: number, b: number) => {
      const at = (frame * BONES.length + b) * 4;
      return new Quaternion(...Array.from(rotations.subarray(at, at + 4), (v) => v / 32767)).normalize();
    };
    let worst = 0;
    let closes = true;
    for (let b = 0; b < BODY.length; b++) {
      const gap = turnAt(0, b).angleTo(turnAt(frames - 1, b));
      worst = Math.max(worst, gap);
      let step = 0;
      for (let frame = 0; frame + 1 < frames; frame++) step = Math.max(step, turnAt(frame, b).angleTo(turnAt(frame + 1, b)));
      if (gap > Math.max(1.5 * step, (4 * Math.PI) / 180)) closes = false;
    }
    // Some clips that travel jump back to the start on their last frame, so how far the hips get
    // during the clip is what tells a clip that goes somewhere.
    const start = new Vector3().fromArray(moves, 0);
    const travel = new Vector3().fromArray(moves, (frames - 1) * 3).sub(start);
    let away = 0;
    for (let frame = 0; frame < frames; frame++) {
      const offset = new Vector3().fromArray(moves, frame * 3).sub(start);
      away = Math.max(away, Math.hypot(offset.x, offset.z));
    }
    const travelled = away > 0.5;
    // A clip that wanders and snaps back to the start on its last frame does not repeat: its hips
    // jump there instead of walking.
    let stride = 0;
    for (let frame = 0; frame + 2 < frames; frame++) stride = Math.max(stride, new Vector3().fromArray(moves, (frame + 1) * 3).distanceTo(new Vector3().fromArray(moves, frame * 3)));
    const lastStep = frames > 1 ? new Vector3().fromArray(moves, (frames - 1) * 3).distanceTo(new Vector3().fromArray(moves, (frames - 2) * 3)) : 0;
    const snaps = lastStep > Math.max(3 * stride, 0.05);
    const loop = !ONCE.has(animation.name) && closes && travel.length() < 0.05 && !snaps;

    // A cycle that stops one step before its first pose gets that pose again at the end, so it
    // wraps around without a jump.
    let out = { rotations, moves, frames };
    if (loop && worst > (1 * Math.PI) / 180) {
      const longer = new Int16Array((frames + 1) * BONES.length * 4);
      longer.set(rotations);
      longer.set(rotations.subarray(0, BONES.length * 4), frames * BONES.length * 4);
      const further = new Float32Array((frames + 1) * 3);
      further.set(moves);
      further.set(moves.subarray(0, 3), frames * 3);
      out = { rotations: longer, moves: further, frames: frames + 1 };
    }

    const id = animation.name;
    if (clips.some((clip) => clip.id === id)) throw new Error(`clipe repetido: ${id}`);
    clips.push({ id, label, category, set, frames: out.frames, offset: size, loop, moves: travelled });
    for (const data of [Buffer.from(out.rotations.buffer), Buffer.from(out.moves.buffer)]) {
      chunks.push(data);
      size += data.length;
    }
  }
}

const missing = Object.keys(NAMES).filter((name) => !clips.some((clip) => clip.id === name));
if (missing.length > 0) throw new Error(`nomes sem clipe: ${missing.join(", ")}`);

writeFileSync(path.join(repo, "public/animations/human.bin"), Buffer.concat(chunks));
const order = (clip: ClipOut) => CATEGORIES.indexOf(clip.category) * 1000 + clips.indexOf(clip);
const sorted = [...clips].sort((a, b) => order(a) - order(b) || a.label.localeCompare(b.label, "pt-BR"));
const lines = [
  "// Gerado por scripts/import-animations.ts. Não edite à mão.",
  "// Animações do Mesh2Motion (https://github.com/Mesh2Motion/mesh2motion-app), CC0, e danças feitas para o editor.",
  "",
  `export const ANIMATION_FPS = ${FPS};`,
  `export const SOURCE_BONES = ${JSON.stringify(BONES)} as const;`,
  `export type SourceBone = (typeof SOURCE_BONES)[number];`,
  `export const ANIMATION_CATEGORIES = ${JSON.stringify(CATEGORIES)} as const;`,
  "",
  "/** The rest pose of the source skeleton: where each joint is and where its bone points. Meters, Y up, facing +Z. */",
  `export const SOURCE_REST: { joints: Record<SourceBone, [number, number, number]>; directions: Record<SourceBone, [number, number, number]> } = ${JSON.stringify(rest)};`,
  "",
  "export interface ClipInfo {",
  "  id: string;",
  "  label: string;",
  "  category: (typeof ANIMATION_CATEGORIES)[number];",
  "  set: string;",
  "  frames: number;",
  "  /** Where the clip starts in human.bin: int16 rotations, then float32 hip offsets. */",
  "  offset: number;",
  "  /** Ends where it starts, so it can repeat. */",
  "  loop: boolean;",
  "  /** Walks the character away from where it started. */",
  "  moves: boolean;",
  "}",
  "",
  "export const CLIPS: ClipInfo[] = [",
  ...sorted.map((clip) => `  ${JSON.stringify(clip)},`),
  "];",
  "",
];
writeFileSync(path.join(repo, "src/animation/library.generated.ts"), lines.join("\n"));
console.log(`${clips.length} clipes, ${(size / 1024 / 1024).toFixed(2)} MB, ${clips.filter((clip) => clip.loop).length} em ciclo`);
