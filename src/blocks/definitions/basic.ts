import type { BlockDef, Point, Vec3 } from "../types.ts";
import { arc, block, boxSockets, socket } from "./helpers.ts";

const GRAY = "#8a9bb0";

function cuboid(id: string, name: string, size: Vec3): BlockDef {
  return block(`basic.${id}`, name, "basic", GRAY, { kind: "box", size }, boxSockets(size));
}

const roundSockets = (radius: number, height: number) => [
  socket("bottom", [0, -height / 2, 0], [0, -1, 0]),
  socket("top", [0, height / 2, 0], [0, 1, 0]),
  socket("left", [-radius, 0, 0], [-1, 0, 0]),
  socket("right", [radius, 0, 0], [1, 0, 0]),
  socket("front", [0, 0, radius], [0, 0, 1]),
  socket("back", [0, 0, -radius], [0, 0, -1]),
];

const pointSockets = (height: number) => [
  socket("bottom", [0, -height / 2, 0], [0, -1, 0]),
  socket("tip", [0, height / 2, 0], [0, 1, 0]),
];

const stairs: Point[] = [
  [-0.5, 0],
  [0.5, 0],
  [0.5, 0.25],
  [0.25, 0.25],
  [0.25, 0.5],
  [0, 0.5],
  [0, 0.75],
  [-0.25, 0.75],
  [-0.25, 1],
  [-0.5, 1],
];

const archOpening: Point[] = [
  [-0.5, 0],
  [-0.3, 0],
  ...arc(0, 0.5, 0.3, 180, 0, 12).slice(1, -1),
  [0.3, 0],
  [0.5, 0],
  [0.5, 1],
  [-0.5, 1],
];

const lShape: Point[] = [
  [-0.25, 0],
  [0.5, 0],
  [0.5, 0.25],
  [0, 0.25],
  [0, 0.75],
  [-0.25, 0.75],
];

export const basicBlocks: BlockDef[] = [
  cuboid("cube", "Cubo", [0.5, 0.5, 0.5]),
  cuboid("plate", "Placa", [0.5, 0.125, 0.5]),
  cuboid("beam", "Viga", [0.25, 1, 0.25]),
  cuboid("wall", "Parede", [1, 1, 0.125]),
  cuboid("floor", "Piso grande", [2, 0.1, 2]),
  block("basic.wedge", "Rampa", "basic", GRAY, { kind: "wedge", size: [0.5, 0.5, 0.5] }, [
    socket("bottom", [0, -0.25, 0], [0, -1, 0]),
    socket("back", [0, 0, -0.25], [0, 0, -1]),
    socket("slope", [0, 0, 0], [0, 1, 1]),
  ]),
  block(
    "basic.pyramid",
    "Pirâmide",
    "basic",
    GRAY,
    { kind: "frustum", bottom: [0.5, 0.5], top: [0.001, 0.001], height: 0.5 },
    pointSockets(0.5),
  ),
  block(
    "basic.cylinder",
    "Cilindro",
    "basic",
    GRAY,
    { kind: "cylinder", radiusTop: 0.25, radiusBottom: 0.25, height: 0.5, segments: 20 },
    roundSockets(0.25, 0.5),
  ),
  block(
    "basic.hex",
    "Prisma",
    "basic",
    GRAY,
    { kind: "cylinder", radiusTop: 0.25, radiusBottom: 0.25, height: 0.5, segments: 6 },
    roundSockets(0.25, 0.5),
  ),
  block(
    "basic.cone",
    "Cone",
    "basic",
    GRAY,
    { kind: "cylinder", radiusTop: 0, radiusBottom: 0.25, height: 0.5, segments: 20 },
    pointSockets(0.5),
  ),
  block("basic.sphere", "Esfera", "basic", GRAY, { kind: "sphere", radius: 0.25 }, roundSockets(0.25, 0.5)),
  block("basic.dome", "Cúpula", "basic", GRAY, { kind: "dome", radius: 0.25 }, [
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", [0, 0.25, 0], [0, 1, 0]),
  ]),
  block(
    "basic.capsule",
    "Cápsula",
    "basic",
    GRAY,
    { kind: "capsule", radius: 0.15, length: 0.4 },
    pointSockets(0.7),
  ),
  block("basic.ring", "Anel", "basic", GRAY, { kind: "torus", radius: 0.3, tube: 0.07 }, [
    socket("back", [0, 0, -0.07], [0, 0, -1]),
    socket("front", [0, 0, 0.07], [0, 0, 1]),
  ]),
  block("basic.stairs", "Escada", "basic", GRAY, { kind: "extrude", points: stairs, depth: 1 }, [
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", [0, 1, -0.375], [0, 1, 0]),
  ]),
  block("basic.arch", "Arco", "basic", GRAY, { kind: "extrude", points: archOpening, depth: 0.25 }, [
    socket("bottom", [0, 0, 0], [0, -1, 0]),
    socket("top", [0, 1, 0], [0, 1, 0]),
  ]),
  block("basic.l", "Canto em L", "basic", GRAY, { kind: "extrude", points: lShape, depth: 0.25 }, [
    socket("bottom", [0, 0, 0.1], [0, -1, 0]),
    socket("top", [0, 0.75, -0.125], [0, 1, 0]),
  ]),
];
