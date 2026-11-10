import * as THREE from "three";
import { mergeGeometries, toCreasedNormals } from "three/addons/utils/BufferGeometryUtils.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { triangulateFace } from "../modeling/triangulate";
import { decodeBaked, decodeModel } from "./modelPack";
import type {
  BlockFinish,
  BlockShape,
  BodyDeform,
  Bump,
  LoftRing,
  Point,
  Primitive,
  ShapePiece,
  Vec3,
} from "./types";

/** Edges sharper than this stay hard, so round parts look smooth and boxes stay crisp. */
const CREASE_ANGLE = THREE.MathUtils.degToRad(35);
/** Small enough to show every polygon, and enough to hide the diagonal inside a nearly flat quad. */
const FACETED_ANGLE = THREE.MathUtils.degToRad(8);

/** In slot order. New finishes go at the end, so the slots of the older ones never move. */
export const BLOCK_FINISHES: BlockFinish[] = ["matte", "gloss", "metal", "glass", "glow", "paint", "tint"];
const FINISHES = BLOCK_FINISHES;

/** Each finish has two material slots: one follows the part's color, one keeps its own. */
const slotOf = (piece: ShapePiece) =>
  FINISHES.indexOf(piece.finish ?? "matte") * 2 + (piece.color ? 1 : 0);

export const TINTED_GROUP = 0;
export const FIXED_GROUP = 1;

function polyhedron(vertices: number[][], faces: number[][]): THREE.BufferGeometry {
  const positions: number[] = [];
  for (const face of faces) {
    for (let i = 1; i < face.length - 1; i++) {
      positions.push(...vertices[face[0]], ...vertices[face[i]], ...vertices[face[i + 1]]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geometry;
}

function frustum(
  [bottomWidth, bottomDepth]: Point,
  [topWidth, topDepth]: Point,
  height: number,
): THREE.BufferGeometry {
  const y = height / 2;
  const bw = bottomWidth / 2;
  const bd = bottomDepth / 2;
  const tw = topWidth / 2;
  const td = topDepth / 2;
  return polyhedron(
    [
      [-bw, -y, -bd],
      [bw, -y, -bd],
      [bw, -y, bd],
      [-bw, -y, bd],
      [-tw, y, -td],
      [tw, y, -td],
      [tw, y, td],
      [-tw, y, td],
    ],
    [
      [0, 1, 2, 3],
      [4, 7, 6, 5],
      [3, 2, 6, 7],
      [1, 0, 4, 5],
      [2, 1, 5, 6],
      [0, 3, 7, 4],
    ],
  );
}

/** The tall side is at the back (-Z) and the slope faces forward (+Z). */
function wedge([width, height, depth]: readonly number[]): THREE.BufferGeometry {
  const w = width / 2;
  const h = height / 2;
  const d = depth / 2;
  return polyhedron(
    [
      [-w, -h, -d],
      [w, -h, -d],
      [w, -h, d],
      [-w, -h, d],
      [-w, h, -d],
      [w, h, -d],
    ],
    [
      [0, 1, 2, 3],
      [1, 0, 4, 5],
      [3, 2, 5, 4],
      [2, 1, 5],
      [0, 3, 4],
    ],
  );
}

/** A half sphere whose flat side sits on the block's origin. */
function dome(radius: number): THREE.BufferGeometry {
  const shell = new THREE.SphereGeometry(radius, 32, 12, 0, Math.PI * 2, 0, Math.PI / 2);
  const cap = new THREE.CircleGeometry(radius, 32).rotateX(Math.PI / 2);
  const merged = mergeGeometries([shell.toNonIndexed(), cap.toNonIndexed()]);
  shell.dispose();
  cap.dispose();
  if (!merged) throw new Error("Falha ao montar a cúpula");
  return merged;
}

const signedPower = (value: number, power: number) =>
  Math.sign(value) * Math.abs(value) ** power;

function catmullRom(a: number, b: number, c: number, d: number, t: number): number {
  return (
    0.5 *
    (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (3 * b - a - 3 * c + d) * t * t * t)
  );
}

/** Interpolates the rings so a handful of sections gives a smooth surface. */
function denseRings(rings: LoftRing[], steps: number): Required<{ [K in 0 | 1 | 2 | 3 | 4]: number }>[] {
  const full = rings.map(([h, a, b, p = 2, offset = 0]) => [h, a, b, p, offset]);
  const dense: { 0: number; 1: number; 2: number; 3: number; 4: number }[] = [];
  for (let i = 0; i < full.length - 1; i++) {
    const r0 = full[Math.max(i - 1, 0)];
    const r1 = full[i];
    const r2 = full[i + 1];
    const r3 = full[Math.min(i + 2, full.length - 1)];
    for (let s = 0; s < steps; s++) {
      const t = s / steps;
      const value = (channel: number) => catmullRom(r0[channel], r1[channel], r2[channel], r3[channel], t);
      dense.push({
        0: value(0),
        1: Math.max(value(1), 0.0002),
        2: Math.max(value(2), 0.0002),
        3: Math.max(value(3), 1),
        4: value(4),
      });
    }
  }
  const last = full[full.length - 1];
  dense.push({ 0: last[0], 1: Math.max(last[1], 0.0002), 2: Math.max(last[2], 0.0002), 3: last[3], 4: last[4] });
  return dense;
}

function applyBumps(geometry: THREE.BufferGeometry, bumps: Bump[]): void {
  geometry.computeVertexNormals();
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  for (let i = 0; i < position.count; i++) {
    let push = 0;
    for (const { at, radius, height, stretch = [1, 1, 1] } of bumps) {
      const dx = (position.getX(i) - at[0]) / (radius * stretch[0]);
      const dy = (position.getY(i) - at[1]) / (radius * stretch[1]);
      const dz = (position.getZ(i) - at[2]) / (radius * stretch[2]);
      push += height * Math.exp(-(dx * dx + dy * dy + dz * dz));
    }
    position.setXYZ(
      i,
      position.getX(i) + normal.getX(i) * push,
      position.getY(i) + normal.getY(i) * push,
      position.getZ(i) + normal.getZ(i) * push,
    );
  }
}

function loft(
  rings: LoftRing[],
  axis: "y" | "z",
  segments: number,
  steps: number,
  bumps: Bump[],
): THREE.BufferGeometry {
  const dense = denseRings(
    axis === "z" ? rings.map(([h, a, b, p, o]) => [h, a, b, p, -(o ?? 0)] as LoftRing) : rings,
    steps,
  );
  const positions: number[] = [];
  const indices: number[] = [];

  for (const ring of dense) {
    const exponent = 2 / ring[3];
    for (let j = 0; j < segments; j++) {
      const angle = (j / segments) * Math.PI * 2;
      positions.push(
        ring[1] * signedPower(Math.cos(angle), exponent),
        ring[0],
        ring[2] * signedPower(Math.sin(angle), exponent) + ring[4],
      );
    }
  }
  const rows = dense.length;
  const bottom = positions.length / 3;
  positions.push(0, dense[0][0], dense[0][4]);
  const top = bottom + 1;
  positions.push(0, dense[rows - 1][0], dense[rows - 1][4]);

  const vertex = (row: number, column: number) => row * segments + (column % segments);
  for (let row = 0; row < rows - 1; row++) {
    for (let j = 0; j < segments; j++) {
      indices.push(vertex(row, j), vertex(row + 1, j), vertex(row, j + 1));
      indices.push(vertex(row, j + 1), vertex(row + 1, j), vertex(row + 1, j + 1));
    }
  }
  for (let j = 0; j < segments; j++) {
    indices.push(bottom, vertex(0, j), vertex(0, j + 1));
    indices.push(top, vertex(rows - 1, j + 1), vertex(rows - 1, j));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  if (axis === "z") geometry.rotateX(Math.PI / 2);
  if (bumps.length > 0) applyBumps(geometry, bumps);
  return geometry;
}

function tube(
  path: Vec3[],
  radii: number[],
  radial: number,
  steps: number,
  flat: number,
): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(path.map((p) => new THREE.Vector3(...p)));
  const divisions = (path.length - 1) * steps;
  const points = curve.getSpacedPoints(divisions);
  const { normals, binormals } = curve.computeFrenetFrames(divisions, false);

  const radiusAt = (u: number) => {
    const position = u * (radii.length - 1);
    const index = Math.min(Math.floor(position), radii.length - 2);
    return radii[index] + (radii[index + 1] - radii[index]) * (position - index);
  };

  const positions: number[] = [];
  const indices: number[] = [];
  for (let i = 0; i <= divisions; i++) {
    const radius = Math.max(radiusAt(i / divisions), 0.0001);
    for (let j = 0; j < radial; j++) {
      const angle = (j / radial) * Math.PI * 2;
      const n = normals[i].clone().multiplyScalar(Math.cos(angle) * radius);
      const b = binormals[i].clone().multiplyScalar(Math.sin(angle) * radius * flat);
      positions.push(points[i].x + n.x + b.x, points[i].y + n.y + b.y, points[i].z + n.z + b.z);
    }
  }
  const start = positions.length / 3;
  positions.push(points[0].x, points[0].y, points[0].z);
  const end = start + 1;
  positions.push(points[divisions].x, points[divisions].y, points[divisions].z);

  const vertex = (row: number, column: number) => row * radial + (column % radial);
  for (let i = 0; i < divisions; i++) {
    for (let j = 0; j < radial; j++) {
      indices.push(vertex(i, j), vertex(i, j + 1), vertex(i + 1, j));
      indices.push(vertex(i, j + 1), vertex(i + 1, j + 1), vertex(i + 1, j));
    }
  }
  for (let j = 0; j < radial; j++) {
    indices.push(start, vertex(0, j + 1), vertex(0, j));
    indices.push(end, vertex(divisions, j), vertex(divisions, j + 1));
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  return geometry;
}

/** Same input always gives the same offset, so seams on shared vertices stay closed. */
function layeredNoise(x: number, y: number, z: number, seed: number): number {
  return (
    Math.sin(x * 1.7 + seed) * Math.cos(y * 1.3 - seed * 0.7) +
    0.55 * Math.sin(y * 3.1 + seed * 1.3) * Math.cos(z * 2.7 + seed) +
    0.3 * Math.sin(z * 6.1 - seed) * Math.cos(x * 5.3 + seed * 0.4)
  );
}

function lumpy(
  radius: number,
  detail: number,
  amount: number,
  seed: number,
  frequency: number,
): THREE.BufferGeometry {
  const geometry = new THREE.IcosahedronGeometry(1, detail);
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const scale = radius * (1 + amount * layeredNoise(x * frequency, y * frequency, z * frequency, seed));
    position.setXYZ(i, x * scale, y * scale, z * scale);
  }
  return geometry;
}

function polygons(vertices: Vec3[], faces: number[][], paint?: number[]): THREE.BufferGeometry {
  const positions: number[] = [];
  const colors: number[] = [];
  const color = new THREE.Color();
  for (const face of faces) {
    for (const triangle of triangulateFace(vertices, face)) {
      for (const vertex of triangle) {
        positions.push(...vertices[vertex]);
        if (paint) {
          color.setHex(paint[vertex], THREE.SRGBColorSpace);
          colors.push(color.r, color.g, color.b);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  if (paint) geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  return geometry;
}

function outline(points: Point[]): THREE.Shape {
  return new THREE.Shape(points.map(([x, y]) => new THREE.Vector2(x, y)));
}

function applyBodyDeform(geometry: THREE.BufferGeometry, deform: BodyDeform): void {
  const { barrel, center, span, plan, length, taper = 0, taperFrom = 0, taperTo = 1 } = deform;
  const position = geometry.getAttribute("position");
  for (let i = 0; i < position.count; i++) {
    const y = position.getY(i);
    const z = position.getZ(i);
    const bulge = 1 - barrel * ((y - center) / span) ** 2;
    const narrow = 1 - plan * Math.abs(z / length) ** 3;
    const lean = 1 - taper * THREE.MathUtils.clamp((y - taperFrom) / (taperTo - taperFrom), 0, 1);
    position.setX(i, position.getX(i) * bulge * narrow * lean);
  }
}

function extrudeProfile(
  points: Point[],
  depth: number,
  bevel: number,
  bevelSegments: number,
  deform?: BodyDeform,
): THREE.BufferGeometry {
  const body = depth - bevel * 2;
  const geometry = new THREE.ExtrudeGeometry(outline(points), {
    depth: body,
    bevelEnabled: bevel > 0,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: -bevel,
    bevelSegments,
  })
    .translate(0, 0, -body / 2)
    .rotateY(-Math.PI / 2);
  if (deform) applyBodyDeform(geometry, deform);
  return geometry;
}

function slab(points: Point[], height: number): THREE.BufferGeometry {
  const flipped = points.map(([x, z]): Point => [x, -z]);
  return new THREE.ExtrudeGeometry(outline(flipped), {
    depth: height,
    bevelEnabled: false,
  }).rotateX(-Math.PI / 2);
}

export function buildPrimitive(shape: Primitive): THREE.BufferGeometry {
  switch (shape.kind) {
    case "box":
      return new THREE.BoxGeometry(...shape.size);
    case "roundedBox":
      // Segments multiply quickly here: two already make 300 triangles for one box.
      return new RoundedBoxGeometry(...shape.size, shape.radius < 0.03 ? 1 : 2, shape.radius);
    case "wedge":
      return wedge(shape.size);
    case "frustum":
      return frustum(shape.bottom, shape.top, shape.height);
    case "cylinder":
      return new THREE.CylinderGeometry(
        shape.radiusTop,
        shape.radiusBottom,
        shape.height,
        shape.segments,
      );
    case "sphere": {
      // Detail follows size: an eye's pupil doesn't need the triangles of a boulder.
      const [width, height] = shape.radius < 0.02 ? [10, 7] : shape.radius < 0.07 ? [16, 11] : [28, 18];
      return new THREE.SphereGeometry(shape.radius, width, height);
    }
    case "dome":
      return dome(shape.radius);
    case "capsule":
      return shape.radius < 0.05
        ? new THREE.CapsuleGeometry(shape.radius, shape.length, 3, 10)
        : new THREE.CapsuleGeometry(shape.radius, shape.length, 6, 20);
    case "model":
      return decodeModel(shape);
    case "baked":
      return decodeBaked(shape);
    case "icosahedron":
      return new THREE.IcosahedronGeometry(shape.radius, shape.detail ?? 0);
    case "dodecahedron":
      return new THREE.DodecahedronGeometry(shape.radius, 0);
    case "torus":
      return new THREE.TorusGeometry(
        shape.radius,
        shape.tube,
        shape.tube < 0.02 ? 6 : 10,
        shape.radius < 0.08 ? 20 : 36,
        shape.arc ?? Math.PI * 2,
      );
    case "lathe":
      return new THREE.LatheGeometry(
        shape.profile.map(([radius, y]) => new THREE.Vector2(radius, y)),
        shape.segments,
      );
    case "loft":
      return loft(shape.rings, shape.axis ?? "y", shape.segments ?? 40, shape.steps ?? 5, shape.bumps ?? []);
    case "tube":
      return tube(shape.path, shape.radius, shape.radial ?? 8, shape.steps ?? 6, shape.flat ?? 1);
    case "lumpy":
      return lumpy(shape.radius, shape.detail, shape.amount, shape.seed, shape.frequency ?? 2.2);
    case "extrude":
      return extrudeProfile(shape.points, shape.depth, shape.bevel ?? 0, shape.bevelSteps ?? 1, shape.deform);
    case "slab":
      return slab(shape.points, shape.height);
    case "polygons":
      return polygons(shape.vertices, shape.faces, shape.colors);
  }
}

function pieceMatrix(piece: ShapePiece): THREE.Matrix4 {
  const [rx, ry, rz] = (piece.rot ?? [0, 0, 0]).map(THREE.MathUtils.degToRad);
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...(piece.at ?? [0, 0, 0])),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)),
    new THREE.Vector3(...(piece.scale ?? [1, 1, 1])),
  );
}

/** Zero-area triangles (the tip of a cone) have no normal, and glTF requires unit vectors. */
function repairNormals(geometry: THREE.BufferGeometry): void {
  const normal = geometry.getAttribute("normal");
  const vector = new THREE.Vector3();
  for (let i = 0; i < normal.count; i++) {
    vector.fromBufferAttribute(normal, i);
    if (vector.lengthSq() < 0.25) vector.set(0, 1, 0);
    vector.normalize();
    normal.setXYZ(i, vector.x, vector.y, vector.z);
  }
}

function buildPiece(piece: ShapePiece): THREE.BufferGeometry {
  // Imported models already carry their own normals and colors.
  if (piece.shape.kind === "model") return decodeModel(piece.shape);

  // Baked zones come with the normals Blender computed: creasing them again would undo its work.
  const raw = buildPrimitive(piece.shape);
  const crease = piece.faceted
    ? FACETED_ANGLE
    : piece.shape.kind === "polygons"
      ? THREE.MathUtils.degToRad(piece.shape.crease)
      : CREASE_ANGLE;
  const geometry = piece.shape.kind === "baked" ? raw : toCreasedNormals(raw, crease);
  if (geometry !== raw) raw.dispose();
  geometry.applyMatrix4(pieceMatrix(piece));
  repairNormals(geometry);
  const painted = piece.shape.kind === "polygons" && piece.shape.colors !== undefined;
  for (const name of Object.keys(geometry.attributes)) {
    if (name !== "position" && name !== "normal" && !(painted && name === "color")) geometry.deleteAttribute(name);
  }
  if (painted) return geometry;

  const color = piece.color
    ? new THREE.Color(piece.color)
    : new THREE.Color().setScalar(piece.shade ?? 1);
  const colors = new Float32Array(geometry.getAttribute("position").count * 3);
  for (let i = 0; i < colors.length; i += 3) color.toArray(colors, i);
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  return geometry;
}

function piecesOf(shape: BlockShape): ShapePiece[] {
  return shape.kind === "compound" ? shape.pieces : [{ shape }];
}

/** Merges a block into one mesh, with one group for each material it uses. */
export function buildGeometry(shape: BlockShape): THREE.BufferGeometry {
  const slots = new Map<number, THREE.BufferGeometry[]>();
  for (const piece of piecesOf(shape)) {
    const slot = slotOf(piece);
    slots.set(slot, [...(slots.get(slot) ?? []), buildPiece(piece)]);
  }

  const ordered = [...slots.keys()].sort((a, b) => a - b);
  const parts = ordered.flatMap((slot) => slots.get(slot)!);
  const merged = mergeGeometries(parts);
  if (!merged) throw new Error("Falha ao montar o bloco");

  let start = 0;
  for (const slot of ordered) {
    const count = slots
      .get(slot)!
      .reduce((total, geometry) => total + geometry.getAttribute("position").count, 0);
    merged.addGroup(start, count, slot);
    start += count;
  }

  for (const part of parts) part.dispose();
  merged.computeBoundingSphere();
  return merged;
}

const SURFACES: Record<BlockFinish, THREE.MeshPhysicalMaterialParameters> = {
  matte: { roughness: 0.72, metalness: 0 },
  gloss: { roughness: 0.24, metalness: 0.08 },
  metal: { roughness: 0.34, metalness: 0.78 },
  glass: { roughness: 0.06, metalness: 0.75 },
  glow: { roughness: 0.3, metalness: 0 },
  // Car paint: a soft base under a clear coat that keeps a sharp reflection.
  paint: { roughness: 0.4, metalness: 0.18, clearcoat: 1, clearcoatRoughness: 0.04 },
  // Tinted glass: the cabin shows through, darkened, and the glass still reflects.
  tint: { roughness: 0.05, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02, transparent: true, opacity: 0.55, depthWrite: false, envMapIntensity: 2.4 },
};

/** Finishes that need the physical material, which costs more to draw. */
const PHYSICAL = new Set<BlockFinish>(["paint", "tint"]);

function surfaceMaterial(finish: BlockFinish, color?: string | number): THREE.MeshStandardMaterial {
  const parameters = { vertexColors: true, ...(color === undefined ? {} : { color }), ...SURFACES[finish] };
  return PHYSICAL.has(finish) ? new THREE.MeshPhysicalMaterial(parameters) : new THREE.MeshStandardMaterial(parameters);
}

let sharedFixed: THREE.Material[] | null = null;

function createFixedMaterials(): THREE.Material[] {
  return FINISHES.map((finish) => {
    if (finish === "glow") return new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false });
    return surfaceMaterial(finish);
  });
}

function fixedMaterials(): THREE.Material[] {
  if (!sharedFixed) {
    sharedFixed = createFixedMaterials();
    for (const material of sharedFixed) material.userData.shared = true;
  }
  return sharedFixed;
}

/**
 * One material for each slot. Fixed colors are shared by all parts to keep scenes light;
 * pass `ownFixed` for something that changes them, like the translucent placement preview.
 */
export function createBlockMaterials(
  color: string | number,
  options: { ownFixed?: boolean } = {},
): THREE.MeshStandardMaterial[] {
  const fixed = options.ownFixed ? createFixedMaterials() : fixedMaterials();
  return FINISHES.flatMap((finish, index) => [surfaceMaterial(finish, color), fixed[index]]) as THREE.MeshStandardMaterial[];
}

export function disposeBlockMaterials(materials: THREE.Material[]): void {
  for (const material of materials) {
    if (!material.userData.shared) material.dispose();
  }
}

/** Studio lighting used by both the viewport and the catalog thumbnails. */
export function createStudioLighting(renderer: THREE.WebGLRenderer, scene: THREE.Scene, environment: THREE.Scene): void {
  // Neutral tone mapping keeps the colors a person picks instead of washing them out.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1;
  const generator = new THREE.PMREMGenerator(renderer);
  scene.environment = generator.fromScene(environment, 0.04).texture;
  scene.environmentIntensity = 0.42;
  generator.dispose();
}
