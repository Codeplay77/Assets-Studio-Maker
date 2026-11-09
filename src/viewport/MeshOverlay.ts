import * as THREE from "three";
import type { Vec3 } from "../core/types";
import { faceNormal, meshBounds, triangulateMesh, uniqueEdges, type PolyMesh } from "../modeling/mesh";

export type MeshMode = "face" | "edge" | "vertex" | "sculpt";

export interface MeshSelection {
  mode: MeshMode;
  faces: number[];
  vertices: number[];
}

export type MeshHit = { face: number } | { vertex: number } | { edge: [number, number] };

export type MeshBoxHit = { faces: number[] } | { vertices: number[] };

/** In pixels, from the top left of the canvas. */
export interface ScreenRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export interface SurfacePoint {
  point: THREE.Vector3;
  normal: THREE.Vector3;
}

const VERTEX_PICK_PX = 14;
const EDGE_PICK_PX = 10;
const MAX_PICK_CANDIDATES = 12;
const LIFT_RATIO = 0.0015;
const MIN_LIFT = 0.0005;
const OCCLUSION_MARGIN = 0.01;
const BOX_DEPTH_MARGIN = 0.003;
const MAX_BOX_BUFFER = 512;
const MIN_CLIP_W = 1e-4;
const ACCENT = new THREE.Color(0x2ff0b0);
const POINT_COLOR = new THREE.Color(0xdde8ff);

function emptyGeometry(): THREE.BufferGeometry {
  return new THREE.BufferGeometry();
}

function setPositions(target: THREE.Object3D & { geometry: THREE.BufferGeometry }, positions: ArrayLike<number>): void {
  target.geometry.dispose();
  const geometry = emptyGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(positions), 3));
  target.geometry = geometry;
}

/** Shows the polygons of the shape being edited and works out what the mouse is over. */
export class MeshOverlay {
  readonly group = new THREE.Group();

  private readonly wire = new THREE.LineSegments(
    emptyGeometry(),
    new THREE.LineBasicMaterial({ color: 0xd8e6ff, transparent: true, opacity: 0.5 }),
  );
  private readonly selectedWire = new THREE.LineSegments(
    emptyGeometry(),
    new THREE.LineBasicMaterial({ color: ACCENT }),
  );
  private readonly points = new THREE.Points(
    emptyGeometry(),
    new THREE.PointsMaterial({ size: 9, sizeAttenuation: false, vertexColors: true }),
  );
  private readonly highlight = new THREE.Mesh(
    emptyGeometry(),
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.42,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  private readonly hover = new THREE.Mesh(
    emptyGeometry(),
    new THREE.MeshBasicMaterial({
      color: ACCENT,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
      side: THREE.DoubleSide,
    }),
  );
  /** Never drawn: it only answers which polygon a ray hits. */
  private readonly pickSurface = new THREE.Mesh(
    emptyGeometry(),
    new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }),
  );

  private mesh: PolyMesh | null = null;
  private lifted: PolyMesh | null = null;
  private edges: [number, number][] = [];
  private owners: Int32Array = new Int32Array(0);
  private hoveredFace: number | null = null;

  constructor() {
    this.group.matrixAutoUpdate = false;
    this.group.visible = false;
    this.wire.renderOrder = 3;
    this.selectedWire.renderOrder = 4;
    this.points.renderOrder = 5;
    this.highlight.renderOrder = 2;
    this.hover.renderOrder = 1;
    this.group.add(this.hover, this.highlight, this.wire, this.selectedWire, this.points);
    for (const child of this.group.children) child.frustumCulled = false;
  }

  hide(): void {
    this.group.visible = false;
    this.mesh = null;
    this.lifted = null;
    this.hoveredFace = null;
  }

  update(mesh: PolyMesh, matrixWorld: THREE.Matrix4, selection: MeshSelection): void {
    this.group.visible = true;
    this.group.matrix.copy(matrixWorld);
    this.group.matrixWorld.copy(matrixWorld);
    this.pickSurface.matrixWorld.copy(matrixWorld);

    const geometryChanged = this.mesh?.vertices !== mesh.vertices || this.mesh?.faces !== mesh.faces;
    this.mesh = mesh;
    if (geometryChanged) this.rebuild(mesh);
    this.showSelection(selection);
  }

  setHover(face: number | null): boolean {
    if (face === this.hoveredFace) return false;
    this.hoveredFace = face;
    this.drawHover();
    return true;
  }

  /** The polygon under the ray, if any. */
  pickFace(raycaster: THREE.Raycaster): number | null {
    if (!this.mesh) return null;
    const hit = raycaster.intersectObject(this.pickSurface, false)[0];
    return hit?.faceIndex === undefined || hit.faceIndex === null ? null : this.owners[hit.faceIndex];
  }

  pickVertex(raycaster: THREE.Raycaster, camera: THREE.Camera, pointer: THREE.Vector2, size: THREE.Vector2): number | null {
    if (!this.mesh) return null;
    const screen = new THREE.Vector3();
    const candidates: { id: number; distance: number }[] = [];
    this.mesh.vertices.forEach((vertex, id) => {
      screen.set(...vertex).applyMatrix4(this.group.matrixWorld).project(camera);
      if (screen.z > 1) return;
      const distance = Math.hypot(((screen.x - pointer.x) * size.x) / 2, ((screen.y - pointer.y) * size.y) / 2);
      if (distance <= VERTEX_PICK_PX) candidates.push({ id, distance });
    });
    candidates.sort((a, b) => a.distance - b.distance);
    for (const { id } of candidates.slice(0, MAX_PICK_CANDIDATES)) {
      if (this.isVisible(this.worldPoint(this.mesh.vertices[id]), raycaster, camera)) return id;
    }
    return null;
  }

  pickEdge(
    raycaster: THREE.Raycaster,
    camera: THREE.Camera,
    pointer: THREE.Vector2,
    size: THREE.Vector2,
  ): [number, number] | null {
    if (!this.mesh) return null;
    const mesh = this.mesh;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    const candidates: { edge: [number, number]; distance: number; t: number }[] = [];
    for (const edge of this.edges) {
      a.set(...mesh.vertices[edge[0]]).applyMatrix4(this.group.matrixWorld).project(camera);
      b.set(...mesh.vertices[edge[1]]).applyMatrix4(this.group.matrixWorld).project(camera);
      if (a.z > 1 || b.z > 1) continue;
      const ax = (a.x * size.x) / 2;
      const ay = (a.y * size.y) / 2;
      const bx = (b.x * size.x) / 2;
      const by = (b.y * size.y) / 2;
      const px = (pointer.x * size.x) / 2;
      const py = (pointer.y * size.y) / 2;
      const span = (bx - ax) ** 2 + (by - ay) ** 2;
      const t = span === 0 ? 0 : THREE.MathUtils.clamp(((px - ax) * (bx - ax) + (py - ay) * (by - ay)) / span, 0, 1);
      const distance = Math.hypot(px - (ax + t * (bx - ax)), py - (ay + t * (by - ay)));
      if (distance <= EDGE_PICK_PX) candidates.push({ edge, distance, t });
    }
    candidates.sort((x, y) => x.distance - y.distance);
    for (const { edge, t } of candidates.slice(0, MAX_PICK_CANDIDATES)) {
      const start = this.worldPoint(mesh.vertices[edge[0]]);
      const end = this.worldPoint(mesh.vertices[edge[1]]);
      if (this.isVisible(start.lerp(end, t), raycaster, camera)) return edge;
    }
    return null;
  }

  /** Where the ray meets the surface, in the world. */
  pickSurfacePoint(raycaster: THREE.Raycaster): SurfacePoint | null {
    if (!this.mesh) return null;
    const hit = raycaster.intersectObject(this.pickSurface, false)[0];
    if (!hit?.face) return null;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.group.matrixWorld);
    return { point: hit.point.clone(), normal: hit.face.normal.clone().applyMatrix3(normalMatrix).normalize() };
  }

  /**
   * What is inside a rectangle on screen. Only what can be seen counts: a small software depth
   * buffer answers that at once for thousands of points, which one ray each could not.
   */
  boxSelect(rect: ScreenRect, width: number, height: number, camera: THREE.Camera, mode: MeshMode): MeshBoxHit {
    const empty = mode === "face" ? { faces: [] } : { vertices: [] };
    const mesh = this.mesh;
    if (!mesh || mode === "sculpt") return empty;

    camera.updateMatrixWorld();
    const matrix = new THREE.Matrix4()
      .multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse)
      .multiply(this.group.matrixWorld);
    const clip = new THREE.Vector4();
    /** Screen x, screen y and 1/w, which stays linear across a triangle on screen. */
    const project = (x: number, y: number, z: number): [number, number, number] | null => {
      clip.set(x, y, z, 1).applyMatrix4(matrix);
      if (clip.w < MIN_CLIP_W) return null;
      return [((clip.x / clip.w + 1) / 2) * width, ((1 - clip.y / clip.w) / 2) * height, 1 / clip.w];
    };

    const scale = Math.min(1, MAX_BOX_BUFFER / Math.max(rect.right - rect.left, rect.bottom - rect.top, 1));
    const columns = Math.max(1, Math.ceil((rect.right - rect.left) * scale));
    const rows = Math.max(1, Math.ceil((rect.bottom - rect.top) * scale));
    const depth = new Float32Array(columns * rows);
    const toColumn = (x: number) => (x - rect.left) * scale;
    const toRow = (y: number) => (y - rect.top) * scale;

    const positions = this.pickSurface.geometry.getAttribute("position");
    for (let at = 0; at + 2 < positions.count; at += 3) {
      const a = project(positions.getX(at), positions.getY(at), positions.getZ(at));
      const b = project(positions.getX(at + 1), positions.getY(at + 1), positions.getZ(at + 1));
      const c = project(positions.getX(at + 2), positions.getY(at + 2), positions.getZ(at + 2));
      if (a && b && c) this.rasterize(depth, columns, rows, a, b, c, toColumn, toRow);
    }

    const visibleAt = (x: number, y: number, inverse: number) => {
      const column = Math.min(columns - 1, Math.floor(toColumn(x)));
      const row = Math.min(rows - 1, Math.floor(toRow(y)));
      // The farthest of the neighbors, so points on the edge of what is seen aren't lost.
      let front = Infinity;
      for (let r = Math.max(0, row - 1); r <= Math.min(rows - 1, row + 1); r++) {
        for (let q = Math.max(0, column - 1); q <= Math.min(columns - 1, column + 1); q++) {
          front = Math.min(front, depth[r * columns + q]);
        }
      }
      return inverse >= front * (1 - BOX_DEPTH_MARGIN);
    };
    const inside = (point: [number, number, number] | null) =>
      point !== null && point[0] >= rect.left && point[0] <= rect.right && point[1] >= rect.top && point[1] <= rect.bottom;
    const seen = (x: number, y: number, z: number) => {
      const point = project(x, y, z);
      return inside(point) && visibleAt(point![0], point![1], point![2]);
    };

    if (mode === "face") {
      const faces: number[] = [];
      mesh.faces.forEach((face, id) => {
        const center: Vec3 = [0, 0, 0];
        for (const vertex of face) {
          for (let axis = 0; axis < 3; axis++) center[axis] += mesh.vertices[vertex][axis] / face.length;
        }
        if (seen(...center)) faces.push(id);
      });
      return { faces };
    }

    const seenPoints = mesh.vertices.map((vertex) => seen(...vertex));
    if (mode === "vertex") return { vertices: seenPoints.flatMap((visible, id) => (visible ? [id] : [])) };
    const vertices = new Set<number>();
    for (const [a, b] of this.edges) {
      if (seenPoints[a] && seenPoints[b]) {
        vertices.add(a);
        vertices.add(b);
      }
    }
    return { vertices: [...vertices] };
  }

  /** A world-space average direction of the chosen faces, for aiming the arrows along them. */
  averageNormal(faces: readonly number[]): THREE.Vector3 {
    const sum = new THREE.Vector3();
    if (!this.mesh) return sum;
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(this.group.matrixWorld);
    for (const id of faces) {
      const face = this.mesh.faces[id];
      if (face) sum.add(new THREE.Vector3(...faceNormal(this.mesh, face)).applyMatrix3(normalMatrix).normalize());
    }
    return sum.lengthSq() < 1e-8 ? sum : sum.normalize();
  }

  dispose(): void {
    for (const object of [this.wire, this.selectedWire, this.points, this.highlight, this.hover, this.pickSurface]) {
      object.geometry.dispose();
      object.material.dispose();
    }
  }

  private rasterize(
    depth: Float32Array,
    columns: number,
    rows: number,
    [ax, ay, az]: readonly number[],
    [bx, by, bz]: readonly number[],
    [cx, cy, cz]: readonly number[],
    toColumn: (x: number) => number,
    toRow: (y: number) => number,
  ): void {
    const x0 = toColumn(ax);
    const y0 = toRow(ay);
    const x1 = toColumn(bx);
    const y1 = toRow(by);
    const x2 = toColumn(cx);
    const y2 = toRow(cy);
    const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
    if (area === 0) return;

    const startColumn = Math.max(0, Math.floor(Math.min(x0, x1, x2)));
    const endColumn = Math.min(columns - 1, Math.ceil(Math.max(x0, x1, x2)));
    const startRow = Math.max(0, Math.floor(Math.min(y0, y1, y2)));
    const endRow = Math.min(rows - 1, Math.ceil(Math.max(y0, y1, y2)));
    for (let row = startRow; row <= endRow; row++) {
      const y = row + 0.5;
      for (let column = startColumn; column <= endColumn; column++) {
        const x = column + 0.5;
        const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
        const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
        const w2 = 1 - w0 - w1;
        if (w0 < 0 || w1 < 0 || w2 < 0) continue;
        const inverse = w0 * az + w1 * bz + w2 * cz;
        const index = row * columns + column;
        if (inverse > depth[index]) depth[index] = inverse;
      }
    }
  }

  private worldPoint(vertex: Vec3): THREE.Vector3 {
    return new THREE.Vector3(...vertex).applyMatrix4(this.group.matrixWorld);
  }

  private isVisible(point: THREE.Vector3, raycaster: THREE.Raycaster, camera: THREE.Camera): boolean {
    const origin = camera.getWorldPosition(new THREE.Vector3());
    const direction = point.clone().sub(origin);
    const distance = direction.length();
    raycaster.set(origin, direction.normalize());
    const hit = raycaster.intersectObject(this.pickSurface, false)[0];
    return !hit || hit.distance >= distance * (1 - OCCLUSION_MARGIN);
  }

  /** Lines drawn exactly on a surface flicker, so everything floats a hair above it. */
  private rebuild(mesh: PolyMesh): void {
    const { min, max } = meshBounds(mesh);
    const lift = Math.max(Math.hypot(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * LIFT_RATIO, MIN_LIFT);
    const normals = mesh.vertices.map((): Vec3 => [0, 0, 0]);
    for (const face of mesh.faces) {
      const normal = faceNormal(mesh, face);
      for (const vertex of face) {
        for (let axis = 0; axis < 3; axis++) normals[vertex][axis] += normal[axis];
      }
    }
    const vertices = mesh.vertices.map((vertex, index) => {
      const size = Math.hypot(...normals[index]) || 1;
      return vertex.map((value, axis) => value + (normals[index][axis] / size) * lift) as Vec3;
    });
    this.lifted = { ...mesh, vertices };
    this.edges = uniqueEdges(mesh);
    this.hoveredFace = null;
    this.drawHover();

    const wire = new Float32Array(this.edges.length * 6);
    this.edges.forEach(([a, b], index) => {
      wire.set(vertices[a], index * 6);
      wire.set(vertices[b], index * 6 + 3);
    });
    setPositions(this.wire, wire);

    const { positions, owners } = triangulateMesh(mesh);
    this.owners = owners;
    setPositions(this.pickSurface, positions);
  }

  private drawHover(): void {
    const { hoveredFace, lifted } = this;
    if (hoveredFace === null || !lifted || !lifted.faces[hoveredFace]) {
      this.hover.visible = false;
      return;
    }
    this.hover.visible = true;
    setPositions(this.hover, triangulateMesh(lifted, [hoveredFace]).positions);
  }

  private showSelection({ mode, faces, vertices }: MeshSelection): void {
    const { lifted } = this;
    if (!lifted) return;

    const validFaces = faces.filter((id) => lifted.faces[id] !== undefined);
    setPositions(this.highlight, triangulateMesh(lifted, validFaces).positions);

    const chosen = new Set(vertices);
    const count = lifted.vertices.length;
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 3);
    lifted.vertices.forEach((vertex, index) => {
      positions.set(vertex, index * 3);
      (chosen.has(index) ? ACCENT : POINT_COLOR).toArray(colors, index * 3);
    });
    this.points.geometry.dispose();
    const pointGeometry = emptyGeometry();
    pointGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    pointGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    this.points.geometry = pointGeometry;
    this.points.visible = mode === "vertex";

    const selectedEdges = this.edges.filter(([a, b]) => chosen.has(a) && chosen.has(b));
    const wire = new Float32Array(selectedEdges.length * 6);
    selectedEdges.forEach(([a, b], index) => {
      wire.set(lifted.vertices[a], index * 6);
      wire.set(lifted.vertices[b], index * 6 + 3);
    });
    setPositions(this.selectedWire, wire);
    this.selectedWire.visible = mode !== "face";
    // A clean surface is easier to judge while sculpting.
    this.wire.visible = mode !== "sculpt";
  }
}
