import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { TransformControls } from "three/addons/controls/TransformControls.js";
import { getBlock } from "../blocks/catalog";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  buildGeometry,
  createBlockMaterials,
  createStudioLighting,
  disposeBlockMaterials,
} from "../blocks/geometry";
import type { Part, PartId, Project, Quat, Tool } from "../core/types";
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
const MARKER_POOL = 24;
const SELECTED_EMISSIVE = 0x0b5a42;
const ACCENT = 0x1ef5a6;
const UP = new THREE.Vector3(0, 1, 0);
const SUN_DIRECTION = new THREE.Vector3(4, 8, 5).normalize();
const MIN_SHADOW_RADIUS = 8;
const FINE_GRID_RANGE = 16;
const MIN_UPWARD_NORMAL = 0.7;
/** The panel on the left covers the canvas, so the view is centered on what remains. */
const LEFT_DOCK_PX = 344;
const HORIZON = 0x161b27;

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

export interface TransformValues {
  position: [number, number, number];
  rotation: Quat;
  scale: [number, number, number];
}

export interface ViewportCallbacks {
  onPlace(block: string, placement: Placement): void;
  onSelect(id: PartId | null): void;
  onTransformCommit(id: PartId, values: TransformValues): void;
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
  private readonly geometries = new Map<string, THREE.BufferGeometry>();
  private readonly meshes = new Map<PartId, PartMesh>();
  private readonly ghost: PartMesh;
  private readonly markers: THREE.Mesh[] = [];

  private selected: PartId | null = null;
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
    this.scene.add(this.gizmo.getHelper());

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
    this.fitShadowsToModel();
    this.applySelection();
    this.updateGhost();
    this.requestRender();
  }

  setSelection(id: PartId | null): void {
    this.selected = id;
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

  /** Frames the selected part, or the whole model when nothing is selected. */
  focus(): void {
    const selected = this.selected === null ? undefined : this.meshes.get(this.selected);
    const targets = selected ? [selected] : [...this.meshes.values()];
    if (targets.length === 0) return;

    const box = new THREE.Box3();
    for (const target of targets) box.expandByObject(target);
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getSize(new THREE.Vector3()).length() / 2, 0.4);
    const distance = (radius / Math.sin(THREE.MathUtils.degToRad(this.camera.fov / 2))) * 1.3;
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

    this.gizmo.detach();
    this.gizmo.dispose();
    this.orbit.dispose();
    for (const mesh of [...this.meshes.values(), this.ghost]) disposeBlockMaterials(mesh.material);
    this.scene.environment?.dispose();
    (this.scene.background as THREE.Texture).dispose();
    for (const geometry of this.geometries.values()) geometry.dispose();
    this.renderer.dispose();
    canvas.remove();
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

  private geometryFor(block: string): THREE.BufferGeometry {
    let geometry = this.geometries.get(block);
    if (!geometry) {
      geometry = buildGeometry(getBlock(block).shape);
      this.geometries.set(block, geometry);
    }
    return geometry;
  }

  private syncPart(part: Part): void {
    let mesh = this.meshes.get(part.id);
    if (!mesh) {
      mesh = new THREE.Mesh(this.geometryFor(part.block), createBlockMaterials(part.color));
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.partId = part.id;
      mesh.userData.block = part.block;
      this.scene.add(mesh);
      this.meshes.set(part.id, mesh);
    }
    for (const material of this.tintedMaterials(mesh)) material.color.set(part.color);
    if (this.transforming && part.id === this.selected) return;
    mesh.position.fromArray(part.position);
    mesh.quaternion.fromArray(part.rotation);
    mesh.scale.fromArray(part.scale);
    mesh.updateMatrixWorld();
  }

  /** Even slots follow the part's color; odd ones keep their own. */
  private tintedMaterials(mesh: PartMesh): THREE.MeshStandardMaterial[] {
    return mesh.material.filter((_, slot) => slot % 2 === 0);
  }

  private applySelection(): void {
    for (const [id, mesh] of this.meshes) {
      for (const material of this.tintedMaterials(mesh)) {
        material.emissive.setHex(id === this.selected ? SELECTED_EMISSIVE : 0x000000);
      }
    }
    const mesh = this.selected === null ? undefined : this.meshes.get(this.selected);
    if (mesh) {
      if (this.gizmo.object !== mesh) this.gizmo.attach(mesh);
    } else {
      this.gizmo.detach();
    }
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
    if (this.placing) {
      this.updateGhost();
      this.requestRender();
    }
  };

  private readonly onPointerDown = (event: PointerEvent): void => {
    if (event.button !== 0) return;
    this.updatePointer(event);
    this.press = { x: event.clientX, y: event.clientY, onGizmo: this.gizmo.axis !== null };
  };

  private readonly onPointerUp = (event: PointerEvent): void => {
    const press = this.press;
    this.press = null;
    if (event.button !== 0 || !press || press.onGizmo) return;
    if (Math.hypot(event.clientX - press.x, event.clientY - press.y) > CLICK_TOLERANCE_PX) return;

    this.updatePointer(event);
    if (this.placing) {
      const placement = this.computePlacement();
      if (placement) this.callbacks.onPlace(this.placing.block, placement);
      return;
    }
    const hit = this.pick();
    this.callbacks.onSelect(hit ? (hit.object.userData.partId as PartId) : null);
  };

  private readonly onPointerLeave = (): void => {
    this.pointerInside = false;
    this.updateGhost();
    this.requestRender();
  };

  private readonly onGizmoDragging = (event: { value: unknown }): void => {
    const dragging = Boolean(event.value);
    this.orbit.enabled = !dragging;
    this.transforming = dragging;
    if (dragging || this.selected === null) return;

    const mesh = this.meshes.get(this.selected);
    if (!mesh) return;
    this.callbacks.onTransformCommit(this.selected, {
      position: mesh.position.toArray(),
      rotation: mesh.quaternion.toArray() as Quat,
      scale: mesh.scale.toArray(),
    });
  };

  private readonly onCameraChange = (): void => {
    const distance = this.camera.position.distanceTo(this.orbit.target);
    // From far away the 25 cm grid turns into visual noise.
    this.fineGrid.visible = distance < FINE_GRID_RANGE;
    // The ground fades into the horizon at any zoom level.
    const fog = this.scene.fog as THREE.Fog;
    fog.near = distance * 1.4 + 10;
    fog.far = distance * 3.2 + 50;
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
