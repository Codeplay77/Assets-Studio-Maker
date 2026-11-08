import { TRACK_TILE } from "../blocks/definitions/roads.ts";
import type { Assembler } from "./assembler";
import { buildTree } from "./buildings";
import { KIT_RACERS } from "./kit";
import type { Rng } from "./rng";
import { fitTile, opposite, rotateOffset, STEPS, type Direction, type TileKind } from "./tiles";

const GRID_WIDTH = 6;
const GRID_HEIGHT = 5;
const TRACK_TOP = 0.05;

export interface LoopTile {
  x: number;
  y: number;
  /** Direction of travel out of this tile. */
  out: Direction;
  /** Direction of the previous tile. */
  back: Direction;
  kind: TileKind;
  yawSteps: number;
}

type Cell = `${number},${number}`;
const cellKey = (x: number, y: number): Cell => `${x},${y}`;

/**
 * Walks the outline of a group of cells, which is always a closed loop.
 * Returns null when the outline touches itself or leaves a hole.
 */
export function traceOutline(cells: Set<Cell>): LoopTile[] | null {
  const edges = new Map<string, Direction>();
  const addEdge = (x: number, y: number, direction: Direction) => {
    const key = cellKey(x, y);
    if (edges.has(key)) return false;
    edges.set(key, direction);
    return true;
  };

  for (const cell of cells) {
    const [x, y] = cell.split(",").map(Number);
    const open = (dx: number, dy: number) => !cells.has(cellKey(x + dx, y + dy));
    if (open(0, -1) && !addEdge(x, y, 1)) return null;
    if (open(1, 0) && !addEdge(x + 1, y, 0)) return null;
    if (open(0, 1) && !addEdge(x + 1, y + 1, 3)) return null;
    if (open(-1, 0) && !addEdge(x, y + 1, 2)) return null;
  }

  const [firstKey] = edges.keys();
  const [startX, startY] = firstKey.split(",").map(Number);
  const path: { x: number; y: number; out: Direction }[] = [];
  let x = startX;
  let y = startY;
  do {
    const out = edges.get(cellKey(x, y));
    if (out === undefined) return null;
    path.push({ x, y, out });
    x += STEPS[out][0];
    y += STEPS[out][1];
  } while ((x !== startX || y !== startY) && path.length <= edges.size);

  if (path.length !== edges.size) return null;

  return path.map((tile, index) => {
    const previous = path[(index + path.length - 1) % path.length];
    const back = opposite(previous.out);
    const { kind, yawSteps } = fitTile([tile.out, back]);
    return { ...tile, back, kind, yawSteps };
  });
}

function growCells(rng: Rng, target: number): Set<Cell> {
  const cells = new Set<Cell>([
    cellKey(2, 1),
    cellKey(3, 1),
    cellKey(2, 2),
    cellKey(3, 2),
  ]);

  for (let attempt = 0; attempt < 200 && cells.size < target; attempt++) {
    const [x, y] = rng.pick([...cells]).split(",").map(Number);
    const [dx, dy] = rng.pick(STEPS);
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= GRID_WIDTH - 1 || ny >= GRID_HEIGHT - 1) continue;
    const key = cellKey(nx, ny);
    if (cells.has(key)) continue;
    cells.add(key);
    if (!traceOutline(cells)) cells.delete(key);
  }
  return cells;
}

const TILE_BLOCK: Record<string, string> = {
  straight: "track.straight",
  curve: "track.curve",
};

export function buildTrack(asm: Assembler, rng: Rng): void {
  const cells = growCells(rng, rng.int(5, 11));
  const loop = traceOutline(cells);
  if (!loop) throw new Error("Falha ao traçar a pista");

  const offsetX = ((GRID_WIDTH - 1) * TRACK_TILE) / 2;
  const offsetZ = ((GRID_HEIGHT - 1) * TRACK_TILE) / 2;
  const world = (x: number, y: number): [number, number] => [
    x * TRACK_TILE - offsetX,
    y * TRACK_TILE - offsetZ,
  ];

  const startIndex = loop.findIndex((tile) => tile.kind === "straight");
  const start = loop[startIndex];
  const used = new Set<string>();

  loop.forEach((tile, index) => {
    const [x, z] = world(tile.x, tile.y);
    used.add(cellKey(tile.x, tile.y));
    asm.add(index === startIndex ? "track.start" : TILE_BLOCK[tile.kind], [x, 0, z], {
      yawSteps: tile.yawSteps,
    });
  });

  placeStart(asm, rng, start, world);

  for (let x = 0; x < GRID_WIDTH; x++) {
    for (let y = 0; y < GRID_HEIGHT; y++) {
      if (used.has(cellKey(x, y))) continue;
      const [wx, wz] = world(x, y);
      asm.add("track.infield", [wx, 0, wz]);
      decorate(asm, rng, wx, wz);
    }
  }
}

function placeStart(
  asm: Assembler,
  rng: Rng,
  start: LoopTile,
  world: (x: number, y: number) => [number, number],
): void {
  const [x, z] = world(start.x, start.y);
  asm.add("track.gate", [x, TRACK_TOP, z], { yawSteps: start.yawSteps + 1 });

  const cars = [
    { offset: [-2, -2.6] as [number, number] },
    { offset: [2, -4.4] as [number, number] },
  ];
  // The grid boxes on the tile are behind the line when traveling north.
  const flip = start.out === (start.yawSteps + 2) % 4;
  for (const { offset } of cars) {
    const [dx, dz] = rotateOffset(offset, start.yawSteps + (flip ? 2 : 0));
    asm.add(rng.pick(KIT_RACERS), [x + dx, TRACK_TOP, z + dz], { yawSteps: start.out });
  }
}

function decorate(asm: Assembler, rng: Rng, x: number, z: number): void {
  const roll = rng.next();
  if (roll < 0.25) {
    asm.add("track.grandstand", [x, 0.02, z], { yawSteps: rng.int(0, 3) });
  } else if (roll < 0.4) {
    asm.add("track.billboard", [x, 0.02, z], { yawSteps: rng.int(0, 3) });
  } else {
    for (let n = rng.int(1, 4); n > 0; n--) {
      buildTree(asm, rng, {
        position: [x + rng.range(-4.5, 4.5), 0.02, z + rng.range(-4.5, 4.5)],
        kinds: ["oak", "pine", "birch"],
      });
    }
  }
}
