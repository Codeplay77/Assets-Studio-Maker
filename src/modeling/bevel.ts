import type { Vec3 } from "../core/types";
import {
  MAX_FACES,
  MAX_VERTICES,
  add,
  compact,
  cross,
  dot,
  faceCenter,
  faceNormal,
  length,
  normalize,
  sub,
  times,
  type FaceResult,
  type PolyMesh,
} from "./mesh";

const MIN_SINE = 0.1;
const MIN_MITER = 0.2;
const MAX_SLIDE = 0.49;
const MAX_INSET = 0.95;
/** How far the middle of a rounded corner leans toward the original point. */
const CORNER_LEAN = 0.35;

interface Corner {
  face: number;
  index: number;
}

/** One run of faces around a vertex, between two beveled edges or the rim of an open surface. */
interface Sector {
  corners: Corner[];
  fromSelected: boolean;
  toSelected: boolean;
  first?: number;
  last?: number;
}

interface Fan {
  vertex: number;
  corners: Corner[];
  closed: boolean;
  sectors: Sector[];
}

/** Rounds or cuts the chosen edges. `segments` above one makes a curve. */
export function bevel(mesh: PolyMesh, edges: readonly [number, number][], amount: number, segments = 1): FaceResult {
  if (amount <= 0) throw new Error("a largura do chanfro precisa ser maior que zero");

  const size = mesh.vertices.length;
  const key = (a: number, b: number) => a * size + b;
  const undirected = (a: number, b: number) => (a < b ? key(a, b) : key(b, a));
  const cornerKey = ({ face, index }: Corner) => `${face}_${index}`;

  const at = new Map<number, Corner>();
  const tangled = new Set<number>();
  const cornersOf: Corner[][] = mesh.vertices.map(() => []);
  mesh.faces.forEach((face, id) => {
    face.forEach((vertex, index) => {
      const directed = key(vertex, face[(index + 1) % face.length]);
      if (at.has(directed)) tangled.add(directed);
      at.set(directed, { face: id, index });
      cornersOf[vertex].push({ face: id, index });
    });
  });

  // An edge on the rim of an open surface has only one face, so there is nothing to cut between.
  // One shared by more than two faces has no single inside and outside.
  const chosen = new Set<number>();
  for (const [a, b] of edges) {
    if (at.has(key(a, b)) && at.has(key(b, a)) && !tangled.has(key(a, b)) && !tangled.has(key(b, a))) {
      chosen.add(undirected(a, b));
    }
  }
  if (chosen.size === 0) throw new Error("escolha pelo menos uma aresta entre duas faces");

  const vertexOf = ({ face, index }: Corner) => mesh.faces[face][index];
  const nextOf = ({ face, index }: Corner) => mesh.faces[face][(index + 1) % mesh.faces[face].length];
  const previousOf = ({ face, index }: Corner) => {
    const loop = mesh.faces[face];
    return loop[(index + loop.length - 1) % loop.length];
  };
  const isChosen = (a: number, b: number) => chosen.has(undirected(a, b));
  const point = (id: number) => mesh.vertices[id];

  function buildFan(vertex: number, first: Corner): Fan {
    const stepBack = (corner: Corner): Corner | undefined => at.get(key(vertex, previousOf(corner)));
    const stepForward = (corner: Corner): Corner | undefined => {
      const twin = at.get(key(nextOf(corner), vertex));
      return twin && { face: twin.face, index: (twin.index + 1) % mesh.faces[twin.face].length };
    };

    let start = first;
    let closed = false;
    for (let guard = 0; guard <= cornersOf[vertex].length; guard++) {
      const previous = stepBack(start);
      if (!previous) break;
      start = previous;
      if (cornerKey(start) === cornerKey(first)) {
        closed = true;
        break;
      }
    }

    const corners: Corner[] = [];
    for (let current: Corner | undefined = start; current; current = stepForward(current)) {
      if (corners.length > 0 && cornerKey(current) === cornerKey(start)) break;
      if (corners.length > cornersOf[vertex].length) break;
      corners.push(current);
    }

    if (closed) {
      const offset = corners.findIndex((corner) => isChosen(vertex, previousOf(corner)));
      if (offset > 0) corners.push(...corners.splice(0, offset));
    }

    const sectors: Sector[] = [];
    let current: Sector | null = null;
    for (const corner of corners) {
      const entered = isChosen(vertex, previousOf(corner));
      if (!current || entered) {
        current = { corners: [], fromSelected: entered, toSelected: false };
        sectors.push(current);
      }
      current.corners.push(corner);
      if (isChosen(vertex, nextOf(corner))) {
        current.toSelected = true;
        current = null;
      }
    }
    return { vertex, corners, closed, sectors };
  }

  const fans: Fan[] = [];
  const seen = new Set<number>();
  for (const value of chosen) {
    const a = Math.floor(value / size);
    const b = value - a * size;
    for (const vertex of [a, b]) {
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      // Two surfaces can touch at a single point, and each one is cut on its own.
      const visited = new Set<string>();
      for (const corner of cornersOf[vertex]) {
        if (visited.has(cornerKey(corner))) continue;
        const fan = buildFan(vertex, corner);
        for (const member of fan.corners) visited.add(cornerKey(member));
        if (fan.corners.some((member) => isChosen(vertex, previousOf(member)) || isChosen(vertex, nextOf(member)))) fans.push(fan);
      }
    }
  }

  const sine = (origin: number, a: number, b: number) =>
    Math.max(length(cross(normalize(sub(point(a), point(origin))), normalize(sub(point(b), point(origin))))), MIN_SINE);

  function miterOf(corner: Corner, width: number): { direction: Vec3; reach: number; limit: number } {
    const loop = mesh.faces[corner.face];
    const normal = faceNormal(mesh, loop);
    const origin = point(vertexOf(corner));
    const inBefore = normalize(cross(normal, sub(origin, point(previousOf(corner)))));
    const inAfter = normalize(cross(normal, sub(point(nextOf(corner)), origin)));
    const direction = normalize(add(inBefore, inAfter));
    const miter = Math.max(dot(direction, inBefore), MIN_MITER);
    return { direction, reach: width / miter, limit: length(sub(faceCenter(mesh, loop), origin)) * MAX_INSET * miter };
  }

  /** Too wide a cut would pass through the next point, so the width is limited to what fits. */
  let width = amount;
  for (const { vertex, sectors } of fans) {
    for (const sector of sectors) {
      const first = sector.corners[0];
      const last = sector.corners.at(-1)!;
      if (sector.corners.length === 1 && sector.fromSelected && sector.toSelected) {
        width = Math.min(width, miterOf(first, amount).limit);
        continue;
      }
      if (sector.fromSelected) {
        const rail = nextOf(first);
        const from = previousOf(first);
        if (rail !== from) width = Math.min(width, length(sub(point(rail), point(vertex))) * MAX_SLIDE * sine(vertex, rail, from));
      }
      if (sector.toSelected) {
        const rail = previousOf(last);
        const to = nextOf(last);
        if (rail !== to) width = Math.min(width, length(sub(point(rail), point(vertex))) * MAX_SLIDE * sine(vertex, rail, to));
      }
    }
  }

  const vertices = [...mesh.vertices];
  const addPoint = (position: Vec3) => {
    vertices.push(position);
    return vertices.length - 1;
  };
  const slide = (vertex: number, rail: number, along: number) =>
    addPoint(add(point(vertex), times(normalize(sub(point(rail), point(vertex))), width / sine(vertex, rail, along))));

  /** Where each face's side of a chosen edge begins and ends after the cut. */
  const startOf = new Map<number, number>();
  const endOf = new Map<number, number>();
  const replaced = new Map<string, number[]>();

  for (const fan of fans) {
    const { vertex } = fan;
    for (const sector of fan.sectors) {
      const { corners, fromSelected, toSelected } = sector;
      const first = corners[0];
      const last = corners.at(-1)!;
      const count = corners.length;

      if (count === 1) {
        let id: number;
        if (fromSelected && toSelected) {
          const { direction, reach } = miterOf(first, width);
          id = addPoint(add(point(vertex), times(direction, reach)));
        } else if (toSelected) {
          id = slide(vertex, previousOf(first), nextOf(first));
        } else {
          id = slide(vertex, nextOf(first), previousOf(first));
        }
        replaced.set(cornerKey(first), [id]);
        sector.first = id;
        sector.last = id;
      } else {
        const a = fromSelected ? slide(vertex, nextOf(first), previousOf(first)) : undefined;
        const b =
          toSelected && count === 2 && a !== undefined ? a : toSelected ? slide(vertex, previousOf(last), nextOf(last)) : undefined;
        sector.first = a;
        sector.last = b;
        corners.forEach((corner, position) => {
          const isFirst = position === 0;
          const isLast = position === count - 1;
          if (isFirst && a !== undefined) replaced.set(cornerKey(corner), [a]);
          else if (isLast && b !== undefined) replaced.set(cornerKey(corner), [b]);
          else {
            const list: number[] = [];
            if (position === 1 && a !== undefined) list.push(a);
            // A single face between the two sides of the cut needs no point of its own.
            if (!(count === 3 && a !== undefined && b !== undefined)) list.push(vertex);
            if (position === count - 2 && b !== undefined) list.push(b);
            replaced.set(cornerKey(corner), list);
          }
        });
      }

      if (fromSelected) endOf.set(key(previousOf(first), vertex), sector.first!);
      if (toSelected) startOf.set(key(vertex, nextOf(last)), sector.last!);
    }
  }

  /** Curved from one side of the cut to the other, leaning on the original corner. */
  const arcs = new Map<string, number[]>();
  function arc(vertex: number, from: number, to: number): number[] {
    if (from === to) return new Array<number>(segments + 1).fill(from);
    const forward = arcs.get(`${vertex}_${from}_${to}`);
    if (forward) return forward;
    const backward = arcs.get(`${vertex}_${to}_${from}`);
    if (backward) return [...backward].reverse();
    const control = point(vertex);
    const result = [from];
    for (let step = 1; step < segments; step++) {
      const t = step / segments;
      const start = vertices[from];
      const end = vertices[to];
      result.push(
        addPoint([0, 1, 2].map((axis) => (1 - t) ** 2 * start[axis] + 2 * (1 - t) * t * control[axis] + t ** 2 * end[axis]) as Vec3),
      );
    }
    result.push(to);
    arcs.set(`${vertex}_${from}_${to}`, result);
    return result;
  }

  const faces: number[][] = [];
  const faceMaterials: number[] = [];
  const pushFace = (loop: number[], material: number): number | null => {
    const corners = loop.filter((vertex, i) => vertex !== loop[(i + 1) % loop.length]);
    if (corners.length < 3 || new Set(corners).size !== corners.length) return null;
    faces.push(corners);
    faceMaterials.push(material);
    return faces.length - 1;
  };

  // A lone cut ends on a single face: the curve becomes part of that face's outline.
  for (const { vertex, sectors, closed } of fans) {
    const selected = sectors.filter((sector) => sector.toSelected);
    if (!closed || selected.length !== 1 || segments < 2) continue;
    const [sector] = selected;
    if (sector.corners.length !== 3 || sector.first === undefined || sector.last === undefined) continue;
    const curve = arc(vertex, sector.last, sector.first);
    replaced.set(cornerKey(sector.corners[1]), [...curve].reverse());
  }

  mesh.faces.forEach((face, id) => {
    pushFace(
      face.flatMap((vertex, index) => replaced.get(`${id}_${index}`) ?? [vertex]),
      mesh.faceMaterials[id],
    );
  });

  const strips: number[] = [];
  for (const value of chosen) {
    const v = Math.floor(value / size);
    const w = value - v * size;
    const startV = startOf.get(key(v, w));
    const endV = endOf.get(key(w, v));
    const startW = startOf.get(key(w, v));
    const endW = endOf.get(key(v, w));
    if (startV === undefined || endV === undefined || startW === undefined || endW === undefined) continue;
    const atV = arc(v, startV, endV);
    const atW = [...arc(w, startW, endW)].reverse();
    const material = mesh.faceMaterials[at.get(key(v, w))!.face];
    for (let step = 0; step < segments; step++) {
      const id = pushFace([atW[step], atV[step], atV[step + 1], atW[step + 1]], material);
      if (id !== null) strips.push(id);
    }
  }

  // Where several cuts meet, or the end of a cut needs closing.
  for (const { vertex, corners, closed, sectors } of fans) {
    const selected = sectors.filter((sector) => sector.toSelected);
    const material = mesh.faceMaterials[corners[0].face];
    const lone = closed && selected.length === 1 && sectors[0].corners.length === 3;
    if (lone) continue;

    const ring: number[] = [];
    let usesVertex = false;
    for (let index = sectors.length - 1; index >= 0; index--) {
      const sector = sectors[index];
      const following = sectors[(index + 1) % sectors.length];
      if (sector.toSelected && sector.last !== undefined && following.first !== undefined) {
        ring.push(...[...arc(vertex, sector.last, following.first)].reverse());
      }
      if (sector.corners.length >= 4 || (!(sector.fromSelected && sector.toSelected) && sector.corners.length >= 2)) {
        usesVertex = true;
        ring.push(vertex);
      }
    }
    const loop = ring.filter((id, i) => id !== ring[(i + 1) % ring.length]);
    if (new Set(loop).size < 3 || new Set(loop).size !== loop.length) continue;

    if (segments > 1 && selected.length >= 3 && !usesVertex) {
      const middle = times(loop.reduce((sum, id) => add(sum, vertices[id]), [0, 0, 0] as Vec3), 1 / loop.length);
      const center = addPoint(add(middle, times(sub(point(vertex), middle), CORNER_LEAN)));
      loop.forEach((id, i) => pushFace([id, loop[(i + 1) % loop.length], center], material));
    } else {
      pushFace(loop, material);
    }
  }

  if (vertices.length > MAX_VERTICES || faces.length > MAX_FACES) {
    throw new Error(`a forma passaria do limite de ${MAX_VERTICES} vértices e ${MAX_FACES} faces`);
  }
  return { mesh: compact({ ...mesh, vertices, faces, faceMaterials }), caps: strips, sides: [] };
}
