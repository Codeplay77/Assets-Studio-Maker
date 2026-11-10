import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { getBlock, hasBlock, meshToBlockShape, type BlockDef } from "../blocks/catalog";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  buildGeometry,
  createBlockMaterials,
  createStudioLighting,
  disposeBlockMaterials,
} from "../blocks/geometry";
import type { CustomShape, Part, PartId, PartUpdate, PickMode, Project, Quat, Tool, Vec3 } from "../core/types";
import { softWeights, transformVertices, type PolyMesh } from "../modeling/mesh";
import { SculptStroke, type BrushKind, type BrushSettings } from "../modeling/sculpt";
import { MeshOverlay, type MeshBoxHit, type MeshHit, type MeshSelection } from "./MeshOverlay";
import {
  alignToSurface,
  findNearestSocket,
  snapOnPlane,
  worldNormal,
  worldSockets,
  type Placement,
  type WorldSocket,
} from "./placement";

const CLICK_TOLERANCE_PX = 4;
const SOCKET_SNAP_DISTANCE = 0.22;
const PLACEMENT_GRID = 0.125;
const MOVE_SNAP = 0.125;
const ROTATE_SNAP = THREE.MathUtils.degToRad(15);
const SCALE_SNAP = 0.125;
/** Editing polygons needs finer steps than moving whole parts. */
const MESH_MOVE_SNAP = 0.025;
const MESH_ROTATE_SNAP = THREE.MathUtils.degToRad(5);
const MESH_SCALE_SNAP = 0.05;
const MARKER_POOL = 24;
const SELECTED_EMISSIVE = 0x0b5a42;
const ACCENT = 0x1ef5a6;
const UP = new THREE.Vector3(0, 1, 0);
const SUN_DIRECTION = new THREE.Vector3(4, 8, 5).normalize();
const MIN_SHADOW_RADIUS = 8;
const FINE_GRID_RANGE = 16;
const DOUBLE_CLICK_MS = 350;
const HOVER_EMISSIVE = 0x06281f;
const MIN_UPWARD_NORMAL = 0.7;
/** The panel on the left covers the canvas, so the view is centered on what remains. */
const LEFT_DOCK_PX = 344;
const HORIZON = 0x161b27;
const FOCUS_MARGIN = 1.3;
const FOCUS_MARGIN_MODELING = 2.1;
const CAPTURE_FOV = 30;
const CAPTURE_MARGIN = 1.08;
const CAPTURE_QUALITY = 0.9;
const BRUSH_RING_SEGMENTS = 64;
const BRUSH_RING_LIFT = 0.004;
const Z_AXIS = new THREE.Vector3(0, 0, 1);

export type CaptureView = "iso" | "front" | "back" | "left" | "right" | "top" | "current";

const CAPTURE_DIRECTIONS: Record<Exclude<CaptureView, "current">, THREE.Vector3> = {
  iso: new THREE.Vector3(1, 0.75, 1.2).normalize(),
  front: new THREE.Vector3(0, 0, 1),
  back: new THREE.Vector3(0, 0, -1),
  left: new THREE.Vector3(-1, 0, 0),
  right: new THREE.Vector3(1, 0, 0),
  top: new THREE.Vector3(0, 1, 0),
};

function createBackdrop(): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, "#222b40");
  gradient.addColorStop(0.42, "#191f2e");
  gradient.addColorStop(0.62, "#141925");
  gradient.addColorStop(1, "#0c0f17");
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

type PartMesh = THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial[]>;

export interface ViewportCallbacks {
  onPlace(block: string, placement: Placement): void;
  onPick(id: PartId | null, mode: PickMode): void;
  onTransformCommit(updates: PartUpdate[]): void;
  onMeshPick(hit: MeshHit | null, additive: boolean): void;
  onMeshTransform(vertices: Vec3[]): void;
  onMeshBox(hit: MeshBoxHit, additive: boolean): void;
}

interface SculptSession {
  shape: CustomShape;
  stroke: SculptStroke;
  kind: BrushKind;
  partInverse: THREE.Matrix4;
  part: THREE.Matrix4;
  /** The surface point a grab holds on to, and the plane it moves along. */
  grabStart: THREE.Vector3 | null;
  grabPlane: THREE.Plane | null;
  changed: boolean;
  redrawQueued: boolean;
}

interface MeshDrag {
  shape: CustomShape;
  part: THREE.Matrix4;
  partInverse: THREE.Matrix4;
  pivotInverse: THREE.Matrix4;
  weights: Map<number, number>;
  preview: PolyMesh;
  changed: boolean;
}

export class EditorViewport {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(40, 1, 0.05, 2000);
  private readonly sun = new THREE.DirectionalLight(0xfff4e6, 1.8);
  private readonly fineGrid = new THREE.GridHelper(20, 80, 0x8895ad, 0x8895ad);
  private readonly orbit: OrbitControls;
  private readonly gizmo: TransformControls;
  private readonly raycaster = new THREE.Raycaster();
  private readonly pointer = new THREE.Vector2();
  private readonly ground = new THREE.Plane(UP.clone(), 0);
  private readonly resizeObserver: ResizeObserver;
  private readonly geometries = new Map<string, { def: BlockDef; geometry: THREE.BufferGeometry }>();
  private readonly overlay = new MeshOverlay();
  private readonly meshPivot = new THREE.Object3D();
  private project: Project | null = null;
  private modeling: { partId: PartId; shapeId: string } | null = null;
  private meshSelection: MeshSelection = { mode: "face", faces: [], vertices: [] };
  private softRadius = 0;
  private brush: BrushSettings = { kind: "raise", radius: 0.3, strength: 0.5, symmetry: false };
  private sculpt: SculptSession | null = null;
  private readonly brushRing = new THREE.LineLoop(
    new THREE.BufferGeometry().setFromPoints(
      Array.from({ length: BRUSH_RING_SEGMENTS }, (_, index) => {
        const angle = (index / BRUSH_RING_SEGMENTS) * Math.PI * 2;
        return new THREE.Vector3(Math.cos(angle), Math.sin(angle), 0);
      }),
    ),
    new THREE.LineBasicMaterial({ color: ACCENT, depthTest: false, transparent: true }),
  );
  private readonly marquee = document.createElement("div");
  private marqueeActive = false;
  private meshDrag: MeshDrag | null = null;
  private previewGeometry: THREE.BufferGeometry | null = null;
  private snapEnabled = true;
  private readonly meshes = new Map<PartId, PartMesh>();
  /** An animation being previewed: where each posed part is shown instead of where it is. */
  private pose: Map<PartId, { position: Vec3; rotation: Quat }> | null = null;
  private readonly ghost: PartMesh;
  private readonly markers: THREE.Mesh[] = [];

  /** What the gizmo moves when several parts are selected. */
  private readonly pivot = new THREE.Object3D();
  private selected: PartId[] = [];
  private hovered: PartId[] = [];
  private dragStart = new Map<PartId, THREE.Matrix4>();
  private pivotStartInverse = new THREE.Matrix4();
  private lastClick: { id: PartId; time: number } | null = null;
  private placing: { block: string; color: string } | null = null;
  private yawSteps = 0;
  private pointerInside = false;
  private transforming = false;
  private press: { x: number; y: number; onGizmo: boolean } | null = null;
  private renderQueued = false;
  private frame = 0;

  constructor(
    private readonly container: HTMLElement,
    private readonly callbacks: ViewportCallbacks,
  ) {
    // Logarithmic depth keeps thin layers (road markings, grass) stable from any distance.
    this.renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    createStudioLighting(this.renderer, this.scene, new RoomEnvironment());
    container.appendChild(this.renderer.domElement);

    this.scene.background = createBackdrop();
    this.scene.fog = new THREE.Fog(HORIZON, 30, 120);
    this.camera.position.set(3.2, 2.6, 4.2);

    this.orbit = new OrbitControls(this.camera, this.renderer.domElement);
    this.orbit.target.set(0, 0.5, 0);
    this.orbit.mouseButtons = {
      LEFT: null,
      MIDDLE: THREE.MOUSE.PAN,
      RIGHT: THREE.MOUSE.ROTATE,
    };
    this.orbit.maxPolarAngle = Math.PI * 0.495;
    this.orbit.minDistance = 0.5;
    this.orbit.maxDistance = 500;
    this.orbit.update();
    this.orbit.addEventListener("change", this.onCameraChange);
    this.onCameraChange();

    this.gizmo = new TransformControls(this.camera, this.renderer.domElement);
    this.gizmo.setTranslationSnap(MOVE_SNAP);
    this.gizmo.setRotationSnap(ROTATE_SNAP);
    this.gizmo.setScaleSnap(SCALE_SNAP);
    this.gizmo.addEventListener("change", this.requestRender);
    this.gizmo.addEventListener("dragging-changed", this.onGizmoDragging);
    this.gizmo.addEventListener("objectChange", this.onGizmoMoved);
    this.scene.add(this.gizmo.getHelper(), this.pivot, this.meshPivot, this.overlay.group, this.brushRing);
    this.brushRing.visible = false;
    this.brushRing.renderOrder = 12;
    this.brushRing.frustumCulled = false;
    this.marquee.className = "marquee";
    this.marquee.hidden = true;
    container.appendChild(this.marquee);

    this.addEnvironment();

    const ghostMaterials = createBlockMaterials(0xffffff, { ownFixed: true });
    for (const material of ghostMaterials) {
      material.transparent = true;
      material.opacity = 0.6;
      material.depthWrite = false;
    }
    this.ghost = new THREE.Mesh(new THREE.BufferGeometry(), ghostMaterials);
    this.ghost.visible = false;
    this.scene.add(this.ghost);

    const markerGeometry = new THREE.SphereGeometry(0.03, 10, 8);
    const markerMaterial = new THREE.MeshBasicMaterial({ color: ACCENT, depthTest: false });
    for (let i = 0; i < MARKER_POOL; i++) {
      const marker = new THREE.Mesh(markerGeometry, markerMaterial);
      marker.visible = false;
      marker.renderOrder = 10;
      this.markers.push(marker);
      this.scene.add(marker);
    }

    const canvas = this.renderer.domElement;
    canvas.addEventListener("pointermove", this.onPointerMove);
    canvas.addEventListener("pointerdown", this.onPointerDown);
    canvas.addEventListener("pointerup", this.onPointerUp);
    canvas.addEventListener("pointerleave", this.onPointerLeave);

    this.resizeObserver = new ResizeObserver(this.onResize);
    this.resizeObserver.observe(container);
    this.onResize();
  }

  setProject(project: Project): void {
    this.project = project;
    const present = new Set<PartId>();
    for (const part of project.parts) {
      present.add(part.id);
      this.syncPart(part);
    }
    for (const [id, mesh] of this.meshes) {
      if (present.has(id)) continue;
      this.scene.remove(mesh);
      disposeBlockMaterials(mesh.material);
      this.meshes.delete(id);
    }
    this.releaseUnusedGeometry();
    if (this.placing && hasBlock(this.placing.block)) this.ghost.geometry = this.geometryFor(this.placing.block);
    this.fitShadowsToModel();
    this.applySelection();
    this.updateGhost();
    this.requestRender();
  }

  setSelection(ids: PartId[]): void {
    this.selected = ids;
    this.applySelection();
    this.requestRender();
  }

  setSnap(enabled: boolean): void {
    this.snapEnabled = enabled;
    this.applySnap();
  }

  setModeling(
    target: { partId: PartId; shapeId: string } | null,
    selection: MeshSelection,
    softRadius: number,
    brush: BrushSettings,
  ): void {
    const changedTarget = target?.partId !== this.modeling?.partId;
    this.modeling = target;
    this.meshSelection = selection;
    this.softRadius = softRadius;
    this.brush = brush;
    if (selection.mode !== "sculpt" || !target) this.brushRing.visible = false;
    if (changedTarget) {
      this.overlay.hide();
      this.applySnap();
      if (!target) this.gizmo.setSpace("world");
    }
    this.applySelection();
    this.requestRender();
  }

  setPlacing(block: string | null, color: string | null): void {
    this.placing = block ? { block, color: color ?? getBlock(block).color } : null;
    if (this.placing) {
      this.ghost.geometry = this.geometryFor(this.placing.block);
      for (const material of this.tintedMaterials(this.ghost)) material.color.set(this.placing.color);
    }
    this.updateGhost();
    this.requestRender();
  }

  setYawSteps(steps: number): void {
    this.yawSteps = steps;
    this.updateGhost();
    this.requestRender();
  }

  setTool(tool: Tool): void {
    this.gizmo.setMode(tool);
  }

  /**
   * Renders a picture without touching what the person sees, and returns it as a base64 JPEG.
   * Reading the canvas right after drawing, in the same task, avoids keeping every frame around.
   */
  capture(view: CaptureView, width: number, height: number, ids?: PartId[]): string {
    const targets = ids ? ids.flatMap((id) => this.meshes.get(id) ?? []) : [...this.meshes.values()];
    if (ids && targets.length === 0) throw new Error("nenhuma das peças pedidas existe");
    const { camera, distance } = this.captureCamera(view, width / height, targets);

    const helpers = [this.gizmo.getHelper(), this.ghost, this.overlay.group, this.brushRing, ...this.markers];
    const wasVisible = helpers.map((helper) => helper.visible);
    const { selected, hovered } = this;
    for (const helper of helpers) helper.visible = false;
    this.selected = [];
    this.hovered = [];
    this.applyHighlights();
    this.fitAtmosphere(distance);

    const pixelRatio = this.renderer.getPixelRatio();
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.render(this.scene, camera);
    const image = this.renderer.domElement.toDataURL("image/jpeg", CAPTURE_QUALITY);

    helpers.forEach((helper, index) => (helper.visible = wasVisible[index]));
    this.selected = selected;
    this.hovered = hovered;
    this.applyHighlights();
    this.renderer.setPixelRatio(pixelRatio);
    this.onCameraChange();
    this.onResize();
    return image.slice(image.indexOf(",") + 1);
  }

  /** Frames the selection, or everything when nothing is selected or `all` is set. */
  focus(all = false): void {
    const selected = all ? [] : this.selectedMeshes();
    const targets = selected.length > 0 ? selected : [...this.meshes.values()];
    if (targets.length === 0) return;

    const box = new THREE.Box3();
    for (const target of targets) box.expandByObject(target);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.4);
    // Polygon editing needs room around the shape for the arrows, clear of the panels.
    const margin = this.modeling ? FOCUS_MARGIN_MODELING : FOCUS_MARGIN;
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * margin;
    const direction = this.camera.position.clone().sub(this.orbit.target).normalize();

    this.orbit.target.copy(center);
    this.camera.position.copy(center).addScaledVector(direction, distance);
    this.orbit.update();
    this.requestRender();
  }

  dispose(): void {
    cancelAnimationFrame(this.frame);
    this.resizeObserver.disconnect();
    const canvas = this.renderer.domElement;
    canvas.removeEventListener("pointermove", this.onPointerMove);
    canvas.removeEventListener("pointerdown", this.onPointerDown);
    canvas.removeEventListener("pointerup", this.onPointerUp);
    canvas.removeEventListener("pointerleave", this.onPointerLeave);
    this.marquee.remove();
    this.brushRing.geometry.dispose();
    this.brushRing.material.dispose();

    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    for (const mesh of [...this.meshes.values(), this.ghost]) disposeBlockMaterials(mesh.material);
    this.scene.environment?.dispose();
    (this.scene.background as THREE.Texture).dispose();
    for (const { geometry } of this.geometries.values()) geometry.dispose();
    this.previewGeometry?.dispose();
    this.overlay.dispose();
    this.renderer.dispose();
    canvas.remove();
  }

  private captureCamera(
    view: CaptureView,
    aspect: number,
    targets: PartMesh[],
  ): { camera: THREE.PerspectiveCamera; distance: number } {
    if (view === "current") {
      const camera = new THREE.PerspectiveCamera(this.camera.fov, aspect, this.camera.near, this.camera.far);
      camera.position.copy(this.camera.position);
      camera.quaternion.copy(this.camera.quaternion);
      camera.updateMatrixWorld();
      return { camera, distance: this.camera.position.distanceTo(this.orbit.target) };
    }

    const box = new THREE.Box3();
    for (const target of targets) box.expandByObject(target);
    if (box.isEmpty()) box.set(new THREE.Vector3(-1, 0, -1), new THREE.Vector3(1, 1, 1));
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.4);

    const camera = new THREE.PerspectiveCamera(CAPTURE_FOV, aspect, 0.05, 5000);
    const halfVertical = THREE.MathUtils.degToRad(CAPTURE_FOV / 2);
    const halfHorizontal = Math.atan(Math.tan(halfVertical) * aspect);
    const distance = (radius / Math.sin(Math.min(halfVertical, halfHorizontal))) * CAPTURE_MARGIN;

    camera.position.copy(center).addScaledVector(CAPTURE_DIRECTIONS[view], distance);
    if (view === "top") camera.up.set(0, 0, -1);
    camera.lookAt(center);
    camera.updateMatrixWorld();
    return { camera, distance };
  }

  /** Keeps the grid and the fog right for how far the camera is. */
  private fitAtmosphere(distance: number): void {
    // From far away the 25 cm grid turns into visual noise.
    this.fineGrid.visible = distance < FINE_GRID_RANGE;
    // The ground fades into the horizon at any zoom level.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = distance * 1.4 + 10;
    fog.far = distance * 3.2 + 50;
  }

  private addEnvironment(): void {
    this.scene.add(new THREE.HemisphereLight(0xdfe9ff, 0x3a3f4a, 0.55));

    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(4096, 4096);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    this.fitShadowsToModel();

    this.fineGrid.position.y = -0.03;
    const wideGrid = new THREE.GridHelper(600, 300, 0x46536a, 0x46536a);
    wideGrid.position.y = -0.04;
    for (const grid of [this.fineGrid, wideGrid]) {
      grid.material.transparent = true;
      grid.material.depthWrite = false;
    }
    this.fineGrid.material.opacity = 0.16;
    wideGrid.material.opacity = 0.3;
    this.scene.add(this.fineGrid, wideGrid);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(1000, 1000).rotateX(-Math.PI / 2),
      new THREE.ShadowMaterial({ opacity: 0.32 }),
    );
    floor.position.y = -0.002;
    floor.receiveShadow = true;
    this.scene.add(floor);
  }

  /** Keeps the shadow area just big enough, from a single character to a whole city. */
  private fitShadowsToModel(): void {
    const box = new THREE.Box3();
    for (const mesh of this.meshes.values()) box.expandByObject(mesh);
    const center = box.isEmpty() ? new THREE.Vector3() : box.getCenter(new THREE.Vector3());
    const radius = box.isEmpty()
      ? MIN_SHADOW_RADIUS
      : Math.max(box.getSize(new THREE.Vector3()).length() / 2, MIN_SHADOW_RADIUS);

    this.sun.target.position.copy(center);
    this.sun.target.updateMatrixWorld();
    this.sun.position.copy(center).addScaledVector(SUN_DIRECTION, radius * 2 + 10);

    const shadowCamera = this.sun.shadow.camera;
    shadowCamera.left = -radius - 2;
    shadowCamera.right = radius + 2;
    shadowCamera.top = radius + 2;
    shadowCamera.bottom = -radius - 2;
    shadowCamera.near = 0.5;
    shadowCamera.far = radius * 4 + 30;
    shadowCamera.updateProjectionMatrix();
  }

  private applySnap(): void {
    const fine = this.modeling !== null;
    this.gizmo.setTranslationSnap(this.snapEnabled ? (fine ? MESH_MOVE_SNAP : MOVE_SNAP) : null);
    this.gizmo.setRotationSnap(this.snapEnabled ? (fine ? MESH_ROTATE_SNAP : ROTATE_SNAP) : null);
    this.gizmo.setScaleSnap(this.snapEnabled ? (fine ? MESH_SCALE_SNAP : SCALE_SNAP) : null);
  }

  /** A shape that changed gets a new definition, which is what triggers a rebuild here. */
  private geometryFor(block: string): THREE.BufferGeometry {
    const def = getBlock(block);
    const cached = this.geometries.get(block);
    if (cached?.def === def) return cached.geometry;
    cached?.geometry.dispose();
    const geometry = buildGeometry(def.shape);
    this.geometries.set(block, { def, geometry });
    return geometry;
  }

  private releaseUnusedGeometry(): void {
    if (this.previewGeometry && !this.meshDrag && !this.sculpt) {
      this.previewGeometry.dispose();
      this.previewGeometry = null;
    }
    for (const [block, { geometry }] of this.geometries) {
      if (hasBlock(block)) continue;
      geometry.dispose();
      this.geometries.delete(block);
    }
  }

  private syncPart(part: Part): void {
    // The block list can be one step ahead of this project while an agent is working.
    if (!hasBlock(part.block)) return;
    const geometry = this.geometryFor(part.block);
    let mesh = this.meshes.get(part.id);
    if (!mesh) {
      mesh = new THREE.Mesh(geometry, createBlockMaterials(part.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = part.id;
      mesh.userData.block = part.block;
      this.scene.add(mesh);
      this.meshes.set(part.id, mesh);
    }
    if (mesh.geometry !== geometry && !this.meshDrag && !this.sculpt) mesh.geometry = geometry;
    mesh.userData.group = part.group;
    for (const material of this.tintedMaterials(mesh)) material.color.set(part.color);
    if (this.transforming && this.selected.includes(part.id)) return;
    const posed = this.pose?.get(part.id);
    mesh.position.fromArray(posed?.position ?? part.position);
    mesh.quaternion.fromArray(posed?.rotation ?? part.rotation);
    mesh.scale.fromArray(part.scale);
    mesh.updateMatrixWorld();
  }

  /**
   * Shows parts in an animation pose without changing the project; `null` puts them back. Called
   * on every frame of a preview, so it only moves the parts the pose names.
   */
  setPose(pose: Map<PartId, { position: Vec3; rotation: Quat }> | null): void {
    const previous = this.pose;
    this.pose = pose;
    if (this.project) {
      const ids = new Set([...(pose?.keys() ?? []), ...(previous?.keys() ?? [])]);
      for (const part of this.project.parts) if (ids.has(part.id)) this.syncPart(part);
    }
    if (Boolean(pose) !== Boolean(previous)) this.applySelection();
    this.requestRender();
  }

  /** Even slots follow the part's color; odd ones keep their own. */
  private tintedMaterials(mesh: PartMesh): THREE.MeshStandardMaterial[] {
    return mesh.material.filter((_, slot) => slot % 2 === 0);
  }

  private selectedMeshes(): PartMesh[] {
    return this.selected.flatMap((id) => this.meshes.get(id) ?? []);
  }

  private applyHighlights(): void {
    // While editing polygons the overlay shows the selection.
    const selected = new Set(this.modeling ? [] : this.selected);
    const hovered = new Set(this.hovered);
    for (const [id, mesh] of this.meshes) {
      const glow = selected.has(id) ? SELECTED_EMISSIVE : hovered.has(id) ? HOVER_EMISSIVE : 0x000000;
      for (const material of this.tintedMaterials(mesh)) material.emissive.setHex(glow);
    }
  }

  private applySelection(): void {
    this.applyHighlights();
    if (this.transforming) return;
    if (this.modeling) {
      this.updateMeshEditing();
      return;
    }

    const meshes = this.selectedMeshes();
    // A posed part is not where the project has it, so moving it would save the pose.
    if (meshes.length === 0 || this.pose) {
      this.gizmo.detach();
    } else if (meshes.length === 1) {
      if (this.gizmo.object !== meshes[0]) this.gizmo.attach(meshes[0]);
    } else {
      const box = new THREE.Box3();
      for (const mesh of meshes) box.expandByObject(mesh);
      box.getCenter(this.pivot.position);
      this.pivot.quaternion.identity();
      this.pivot.scale.setScalar(1);
      this.pivot.updateMatrixWorld();
      if (this.gizmo.object !== this.pivot) this.gizmo.attach(this.pivot);
    }
  }

  private editedShape(): CustomShape | undefined {
    return this.project?.shapes.find((shape) => shape.id === this.modeling?.shapeId);
  }

  /** Draws the polygons of the edited shape and puts the arrows on what is selected. */
  private updateMeshEditing(): void {
    const shape = this.editedShape();
    const mesh = this.modeling ? this.meshes.get(this.modeling.partId) : undefined;
    if (!shape || !mesh) {
      this.overlay.hide();
      this.gizmo.detach();
      return;
    }
    mesh.updateMatrixWorld();
    this.overlay.update(shape, mesh.matrixWorld, this.meshSelection);

    const ids = this.selectedMeshVertices(shape);
    if (ids.length === 0) {
      this.gizmo.detach();
      return;
    }
    const center = new THREE.Vector3();
    for (const id of ids) center.add(new THREE.Vector3(...shape.vertices[id]));
    this.meshPivot.position.copy(center.divideScalar(ids.length).applyMatrix4(mesh.matrixWorld));
    this.meshPivot.scale.setScalar(1);

    // Over faces, the green arrow points straight out of them, so pulling is the obvious move.
    const normal = this.meshSelection.mode === "face" ? this.overlay.averageNormal(this.meshSelection.faces) : new THREE.Vector3();
    if (normal.lengthSq() > 0) {
      this.meshPivot.quaternion.setFromUnitVectors(UP, normal);
      this.gizmo.setSpace("local");
    } else {
      this.meshPivot.quaternion.identity();
      this.gizmo.setSpace("world");
    }
    this.meshPivot.updateMatrix();
    this.meshPivot.updateMatrixWorld();
    if (this.gizmo.object !== this.meshPivot) this.gizmo.attach(this.meshPivot);
  }

  private selectedMeshVertices(shape: CustomShape): number[] {
    const { mode, faces, vertices } = this.meshSelection;
    const chosen = mode === "face" ? faces.flatMap((id) => shape.faces[id] ?? []) : vertices;
    return [...new Set(chosen)].filter((id) => id < shape.vertices.length);
  }

  private beginMeshDrag(): void {
    const shape = this.editedShape();
    const mesh = this.modeling ? this.meshes.get(this.modeling.partId) : undefined;
    if (!shape || !mesh) return;
    this.meshPivot.updateMatrix();
    mesh.updateMatrixWorld();
    this.meshDrag = {
      shape,
      part: mesh.matrixWorld.clone(),
      partInverse: mesh.matrixWorld.clone().invert(),
      pivotInverse: this.meshPivot.matrix.clone().invert(),
      weights: softWeights(shape, this.selectedMeshVertices(shape), this.softRadius),
      preview: shape,
      changed: false,
    };
  }

  /** Reshapes every part using this shape as the arrows move, before anything is saved. */
  private previewMeshDrag(): void {
    const drag = this.meshDrag;
    if (!drag) return;
    this.meshPivot.updateMatrix();
    const world = this.meshPivot.matrix.clone().multiply(drag.pivotInverse);
    const local = drag.partInverse.clone().multiply(world).multiply(drag.part);
    drag.preview = transformVertices(drag.shape, drag.weights, local);
    drag.changed = true;

    this.showPreview(drag.preview, drag.shape.id);
    this.overlay.update(drag.preview, drag.part, this.meshSelection);
  }

  private showPreview(preview: PolyMesh, shapeId: string): void {
    const geometry = buildGeometry(meshToBlockShape(preview));
    for (const mesh of this.meshes.values()) {
      if (mesh.userData.block === shapeId) mesh.geometry = geometry;
    }
    this.previewGeometry?.dispose();
    this.previewGeometry = geometry;
  }

  private rayHitsSurface() {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.overlay.pickSurfacePoint(this.raycaster);
  }

  private showBrushRing(): void {
    const hit = this.rayHitsSurface();
    const mesh = this.modeling ? this.meshes.get(this.modeling.partId) : undefined;
    const visible = hit !== null && mesh !== undefined;
    if (visible) {
      const scale = mesh.getWorldScale(new THREE.Vector3());
      this.brushRing.position.copy(hit.point).addScaledVector(hit.normal, BRUSH_RING_LIFT);
      this.brushRing.quaternion.setFromUnitVectors(Z_AXIS, hit.normal);
      this.brushRing.scale.setScalar(this.brush.radius * Math.max(scale.x, scale.y, scale.z));
    }
    if (visible || this.brushRing.visible) this.requestRender();
    this.brushRing.visible = visible;
  }

  private beginSculpt(event: PointerEvent): boolean {
    const shape = this.editedShape();
    const mesh = this.modeling ? this.meshes.get(this.modeling.partId) : undefined;
    const hit = this.rayHitsSurface();
    if (!shape || !mesh || !hit) return false;

    mesh.updateMatrixWorld();
    // Holding Ctrl does the opposite and holding Shift smooths, without going to the panel.
    let kind = this.brush.kind;
    if (event.shiftKey) kind = "smooth";
    else if (event.ctrlKey && kind === "raise") kind = "lower";
    else if (event.ctrlKey && kind === "lower") kind = "raise";

    const session: SculptSession = {
      shape,
      stroke: new SculptStroke(shape, { ...this.brush, kind }),
      kind,
      part: mesh.matrixWorld.clone(),
      partInverse: mesh.matrixWorld.clone().invert(),
      grabStart: null,
      grabPlane: null,
      changed: false,
      redrawQueued: false,
    };
    this.sculpt = session;
    const local = hit.point.clone().applyMatrix4(session.partInverse);
    if (kind === "grab") {
      session.grabStart = hit.point.clone();
      session.grabPlane = new THREE.Plane().setFromNormalAndCoplanarPoint(
        this.camera.getWorldDirection(new THREE.Vector3()),
        hit.point,
      );
      session.stroke.grab(local.toArray());
    } else {
      session.stroke.paint(local.toArray());
      this.markSculptChanged();
    }
    return true;
  }

  private continueSculpt(): void {
    const session = this.sculpt;
    if (!session) return;
    if (session.grabStart && session.grabPlane) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const point = this.raycaster.ray.intersectPlane(session.grabPlane, new THREE.Vector3());
      if (!point) return;
      const from = session.grabStart.clone().applyMatrix4(session.partInverse);
      session.stroke.drag(point.applyMatrix4(session.partInverse).sub(from).toArray());
      this.markSculptChanged();
      return;
    }
    const hit = this.rayHitsSurface();
    if (!hit) return;
    session.stroke.paint(hit.point.clone().applyMatrix4(session.partInverse).toArray());
    this.markSculptChanged();
  }

  /** Mouse events come faster than a detailed shape can be rebuilt, so it redraws once a frame. */
  private markSculptChanged(): void {
    const session = this.sculpt;
    if (!session) return;
    session.changed = true;
    if (session.redrawQueued) return;
    session.redrawQueued = true;
    requestAnimationFrame(() => {
      session.redrawQueued = false;
      if (this.sculpt !== session) return;
      this.showPreview({ ...session.shape, vertices: session.stroke.vertices }, session.shape.id);
      this.requestRender();
    });
  }

  private endSculpt(): void {
    const session = this.sculpt;
    this.sculpt = null;
    if (!session) return;
    if (session.changed) {
      this.showPreview({ ...session.shape, vertices: session.stroke.vertices }, session.shape.id);
      this.callbacks.onMeshTransform(session.stroke.vertices);
    }
    this.requestRender();
  }

  private updateMarquee(event: PointerEvent): void {
    const press = this.press;
    if (!press || press.onGizmo || !this.modeling || this.transforming) return;
    if (!this.marqueeActive && Math.hypot(event.clientX - press.x, event.clientY - press.y) <= CLICK_TOLERANCE_PX) return;
    this.marqueeActive = true;
    const { left, top } = this.renderer.domElement.getBoundingClientRect();
    this.marquee.hidden = false;
    this.marquee.style.left = `${Math.min(event.clientX, press.x) - left}px`;
    this.marquee.style.top = `${Math.min(event.clientY, press.y) - top}px`;
    this.marquee.style.width = `${Math.abs(event.clientX - press.x)}px`;
    this.marquee.style.height = `${Math.abs(event.clientY - press.y)}px`;
  }

  private finishMarquee(event: PointerEvent, press: { x: number; y: number }): void {
    this.marqueeActive = false;
    this.marquee.hidden = true;
    const canvas = this.renderer.domElement;
    const { left, top } = canvas.getBoundingClientRect();
    const rect = {
      left: Math.min(event.clientX, press.x) - left,
      top: Math.min(event.clientY, press.y) - top,
      right: Math.max(event.clientX, press.x) - left,
      bottom: Math.max(event.clientY, press.y) - top,
    };
    const hit = this.overlay.boxSelect(rect, canvas.clientWidth, canvas.clientHeight, this.camera, this.meshSelection.mode);
    this.callbacks.onMeshBox(hit, event.shiftKey || event.ctrlKey);
  }

  private endMeshDrag(): void {
    const drag = this.meshDrag;
    this.meshDrag = null;
    if (drag?.changed) this.callbacks.onMeshTransform(drag.preview.vertices);
    else this.applySelection();
  }

  private hitMesh(): MeshHit | null {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const size = this.renderer.getSize(new THREE.Vector2());
    if (this.meshSelection.mode === "sculpt") return null;
    if (this.meshSelection.mode === "face") {
      const face = this.overlay.pickFace(this.raycaster);
      return face === null ? null : { face };
    }
    if (this.meshSelection.mode === "vertex") {
      const vertex = this.overlay.pickVertex(this.raycaster, this.camera, this.pointer, size);
      return vertex === null ? null : { vertex };
    }
    const edge = this.overlay.pickEdge(this.raycaster, this.camera, this.pointer, size);
    return edge === null ? null : { edge };
  }

  private updateMeshHover(): void {
    if (this.meshSelection.mode === "sculpt") {
      this.showBrushRing();
      return;
    }
    let face: number | null = null;
    if (this.meshSelection.mode === "face" && !this.transforming && this.gizmo.axis === null) {
      this.raycaster.setFromCamera(this.pointer, this.camera);
      face = this.overlay.pickFace(this.raycaster);
    }
    if (this.overlay.setHover(face)) this.requestRender();
  }

  private updateHover(): void {
    if (this.modeling) {
      this.updateMeshHover();
      return;
    }
    const hit = this.transforming || this.placing ? undefined : this.pick();
    const id = hit?.object.userData.partId as PartId | undefined;
    const group = hit?.object.userData.group as number | undefined;

    let next: PartId[] = [];
    if (id !== undefined) {
      next =
        group === undefined
          ? [id]
          : [...this.meshes].filter(([, mesh]) => mesh.userData.group === group).map(([partId]) => partId);
    }
    if (next.length === this.hovered.length && next[0] === this.hovered[0]) return;
    this.hovered = next;
    this.applyHighlights();
    this.requestRender();
  }

  private pick(): THREE.Intersection<PartMesh> | undefined {
    this.raycaster.setFromCamera(this.pointer, this.camera);
    return this.raycaster.intersectObjects<PartMesh>([...this.meshes.values()], false)[0];
  }

  private computePlacement(): Placement | null {
    if (!this.placing || !this.pointerInside) return null;
    const def = getBlock(this.placing.block);
    const base = def.sockets[0];
    const grid = def.snap ?? PLACEMENT_GRID;
    const hit = def.ground ? undefined : this.pick();
    if (def.ground) this.raycaster.setFromCamera(this.pointer, this.camera);

    if (hit?.face && def.upright) {
      this.showMarkers([], null);
      const normal = worldNormal(hit.face.normal, hit.object.matrixWorld);
      if (normal.y > MIN_UPWARD_NORMAL) {
        return alignToSurface(base, snapOnPlane(hit.point, UP, grid), UP, this.yawSteps);
      }
    } else if (hit?.face) {
      const sockets = worldSockets(getBlock(hit.object.userData.block).sockets, hit.object.matrixWorld);
      const nearest = findNearestSocket(sockets, hit.point, SOCKET_SNAP_DISTANCE);
      this.showMarkers(sockets, nearest);
      if (nearest) return alignToSurface(base, nearest.position, nearest.normal, this.yawSteps);
      const normal = worldNormal(hit.face.normal, hit.object.matrixWorld);
      return alignToSurface(base, snapOnPlane(hit.point, normal, grid), normal, this.yawSteps);
    }

    this.showMarkers([], null);
    const point = this.raycaster.ray.intersectPlane(this.ground, new THREE.Vector3());
    if (!point) return null;
    return alignToSurface(base, snapOnPlane(point, UP, grid), UP, this.yawSteps);
  }

  private showMarkers(sockets: WorldSocket[], active: WorldSocket | null): void {
    this.markers.forEach((marker, index) => {
      const socket = sockets[index];
      marker.visible = socket !== undefined;
      if (socket) {
        marker.position.copy(socket.position);
        marker.scale.setScalar(socket === active ? 1.9 : 1);
      }
    });
  }

  private updateGhost(): void {
    const placement = this.computePlacement();
    if (!placement) {
      if (!this.placing || !this.pointerInside) this.showMarkers([], null);
      this.ghost.visible = false;
      return;
    }
    this.ghost.position.copy(placement.position);
    this.ghost.quaternion.copy(placement.quaternion);
    this.ghost.visible = true;
  }

  private updatePointer(event: PointerEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -(((event.clientY - rect.top) / rect.height) * 2 - 1),
    );
  }

  private readonly onPointerMove = (event: PointerEvent): void => {
    this.pointerInside = true;
    this.updatePointer(event);
    if (this.sculpt) {
      this.showBrushRing();
      this.continueSculpt();
      return;
    }
    if (this.modeling && this.meshSelection.mode !== "sculpt" && event.buttons === 1) this.updateMarquee(event);
    if (this.placing) {
      this.updateGhost();
      this.requestRender();
    } else if (event.buttons === 0) {
      this.updateHover();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.updatePointer(event);
    this.press = { x: event.clientX, y: event.clientY, onGizmo: this.gizmo.axis !== null };
    if (!this.modeling || this.press.onGizmo) return;
    if (this.meshSelection.mode === "sculpt" && !this.beginSculpt(event)) return;
    // The stroke or the rectangle keeps going if the mouse passes over a panel.
    this.renderer.domElement.setPointerCapture(event.pointerId);
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    this.press = null;
    if (event.button !== 0 || !press) return;
    if (this.renderer.domElement.hasPointerCapture(event.pointerId)) {
      this.renderer.domElement.releasePointerCapture(event.pointerId);
    }
    if (this.sculpt) {
      this.endSculpt();
      return;
    }
    if (this.marqueeActive) {
      this.finishMarquee(event, press);
      return;
    }
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE_PX) return;

    this.updatePointer(event);
    if (this.modeling) {
      if (!press.onGizmo) this.callbacks.onMeshPick(this.hitMesh(), event.shiftKey || event.ctrlKey);
      return;
    }
    // Adding a part to the selection has to work even when the part is behind the arrows.
    if (press.onGizmo && !event.shiftKey && !event.ctrlKey) {
      // The arrows sit on top of the model, and a double click there still means "this part".
      const under = this.pick();
      const id = under?.object.userData.partId as PartId | undefined;
      const repeated = id !== undefined && this.lastClick?.id === id;
      if (repeated && performance.now() - this.lastClick!.time < DOUBLE_CLICK_MS) {
        this.lastClick = null;
        this.callbacks.onPick(id, "single");
      }
      return;
    }

    if (this.placing) {
      const placement = this.computePlacement();
      if (placement) this.callbacks.onPlace(this.placing.block, placement);
      return;
    }
    const hit = this.pick();
    const id = hit ? (hit.object.userData.partId as PartId) : null;
    const additive = event.shiftKey || event.ctrlKey;
    const now = performance.now();
    const isDouble =
      !additive && id !== null && this.lastClick?.id === id && now - this.lastClick.time < DOUBLE_CLICK_MS;
    this.lastClick = id === null ? null : { id, time: now };
    this.callbacks.onPick(id, additive ? "toggle" : isDouble ? "single" : "group");
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    if (this.brushRing.visible) this.brushRing.visible = false;
    this.updateGhost();
    if (this.hovered.length > 0) {
      this.hovered = [];
      this.applyHighlights();
    }
    this.requestRender();
  };

  private readonly onGizmoDragging = (event: { value: unknown }): void => {
    const dragging = Boolean(event.value);
    this.orbit.enabled = !dragging;
    this.transforming = dragging;

    if (this.modeling) {
      if (dragging) this.beginMeshDrag();
      else this.endMeshDrag();
      return;
    }

    const meshes = this.selectedMeshes();
    if (dragging) {
      this.pivot.updateMatrix();
      this.pivotStartInverse.copy(this.pivot.matrix).invert();
      this.dragStart = new Map(
        meshes.map((mesh) => {
          mesh.updateMatrix();
          return [mesh.userData.partId as PartId, mesh.matrix.clone()];
        }),
      );
      return;
    }

    if (meshes.length === 0) return;
    this.callbacks.onTransformCommit(
      meshes.map((mesh) => ({
        id: mesh.userData.partId as PartId,
        position: mesh.position.toArray(),
        rotation: mesh.quaternion.toArray() as Quat,
        scale: mesh.scale.toArray(),
      })),
    );
  };

  /** With several parts selected, the gizmo moves the pivot and the parts follow it. */
  private readonly onGizmoMoved = (): void => {
    if (this.meshDrag) {
      this.previewMeshDrag();
      return;
    }
    if (this.gizmo.object !== this.pivot || !this.transforming) return;

    // Stretching a rotated group along one axis would shear its parts, so scale is uniform.
    if (this.gizmo.getMode() === "scale") {
      const { x, y, z } = this.pivot.scale;
      const strongest = [x, y, z].reduce((best, value) =>
        Math.abs(value - 1) > Math.abs(best - 1) ? value : best,
      );
      this.pivot.scale.setScalar(strongest);
    }

    this.pivot.updateMatrix();
    const delta = this.pivot.matrix.clone().multiply(this.pivotStartInverse);
    for (const [id, start] of this.dragStart) {
      const mesh = this.meshes.get(id);
      if (!mesh) continue;
      delta.clone().multiply(start).decompose(mesh.position, mesh.quaternion, mesh.scale);
      mesh.updateMatrixWorld();
    }
  };

  private readonly onCameraChange = (): void => {
    this.fitAtmosphere(this.camera.position.distanceTo(this.orbit.target));
    this.requestRender();
  };

  private readonly onResize = (): void => {
    const { clientWidth, clientHeight } = this.container;
    if (clientWidth === 0 || clientHeight === 0) return;
    this.renderer.setSize(clientWidth, clientHeight);
    this.camera.setViewOffset(
      clientWidth,
      clientHeight,
      -LEFT_DOCK_PX / 2,
      0,
      clientWidth,
      clientHeight,
    );
    this.renderer.render(this.scene, this.camera);
  };

  private readonly requestRender = (): void => {
    if (this.renderQueued) return;
    this.renderQueued = true;
    this.frame = requestAnimationFrame(() => {
      this.renderQueued = false;
      this.renderer.render(this.scene, this.camera);
    });
  };
}
