import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { getBlock, type BlockDef } from "../blocks/catalog";
import {
  buildGeometry,
  createBlockMaterials,
  disposeBlockMaterials,
  fitBlockMaterials,
  isUsedMaterial,
  slotInfo,
  surfacesOfShape,
} from "../blocks/geometry";
import { surfaceIndex, SURFACES } from "../blocks/surfaces";
import { createSurfaceMaterial, surfacesReady } from "../blocks/textures";
import { bakeClip, buildSkeleton } from "../animation/bake";
import { ClipSampler, clipFileName, getClip, hasAnimationPack, loadAnimationPack, type ClipInfo } from "../animation/clips";
import { findRigs, type Rig } from "../animation/rig";
import type { Part, PartId } from "../core/types";
import { bodyExtras, findVehicles, partMatrix, wheelExtras, type VehicleBody } from "./vehicles";

export interface ExportOptions {
  /** One mesh per material instead of one node per part: fewer draw calls in a game. */
  merge: boolean;
  /** Puts the model's base at the origin, which is where engines expect the pivot. */
  center: boolean;
  name: string;
  /** Gives each vehicle a node of its own and each wheel a node centered on its axle. */
  vehicles?: boolean;
  /**
   * Names the vehicles so Godot 4 imports them as a VehicleBody3D with VehicleWheel3D wheels and a
   * box collision shape, and marks the animations that repeat so Godot loops them.
   */
  godot?: boolean;
  /**
   * The animations each character carries, under the id of its hips part (the project's
   * `animations`). A character with animations is exported with a skeleton and its clips.
   */
  animations?: Record<string, string[]>;
}

const triangleCounts = new WeakMap<BlockDef, number>();

export function blockTriangles(block: string): number {
  const def = getBlock(block);
  let count = triangleCounts.get(def);
  if (count === undefined) {
    const { shape } = def;
    if (shape.kind === "model") {
      count = shape.vertices / 3;
    } else {
      const geometry = buildGeometry(shape);
      count = geometry.getAttribute("position").count / 3;
      geometry.dispose();
    }
    triangleCounts.set(def, count);
  }
  return count;
}

export function countTriangles(parts: Part[]): number {
  return parts.reduce((total, part) => total + blockTriangles(part.block), 0);
}

/** Named in the slot order of BLOCK_FINISHES. */
const FINISH_NAMES = ["fosco", "brilhante", "metal", "vidro", "luz", "pintura", "vidro_fume"];

/** Merged meshes are split by material: finishes keep their index, surfaces come after them. */
const SURFACE_KEY = FINISH_NAMES.length;
const keyOfSlot = (slot: number) => {
  const { surface } = slotInfo(slot);
  return surface ? SURFACE_KEY + surfaceIndex(surface) : Math.floor(slot / 2);
};
const keyName = (key: number) => (key < SURFACE_KEY ? FINISH_NAMES[key] : SURFACES[key - SURFACE_KEY].id.replace(/\./g, "_"));

/** Cuts a group out of a block's geometry. Only textured groups keep texture coordinates. */
function slice(geometry: THREE.BufferGeometry, start: number, count: number, textured: boolean): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  for (const name of textured ? ["position", "normal", "color", "uv"] : ["position", "normal", "color"]) {
    const attribute = geometry.getAttribute(name);
    const size = attribute.itemSize;
    const array = (attribute.array as Float32Array).slice(start * size, (start + count) * size);
    result.setAttribute(name, new THREE.BufferAttribute(array, size));
  }
  return result;
}

/** Merging needs the same attributes everywhere, so untextured pieces get empty coordinates. */
function matchTextureCoordinates(geometries: THREE.BufferGeometry[]): void {
  if (!geometries.some((geometry) => geometry.getAttribute("uv"))) return;
  for (const geometry of geometries) {
    if (!geometry.getAttribute("uv")) geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(geometry.getAttribute("position").count * 2), 2));
  }
}

/**
 * Turns parts into meshes. Geometry and materials are shared across everything it adds, so a car
 * body and its four wheels use the same materials in the file.
 */
class SceneBuilder {
  private readonly built = new Map<string, THREE.BufferGeometry>();
  private readonly welded = new Map<string, THREE.BufferGeometry>();
  private readonly materialsByColor = new Map<string, THREE.Material[]>();
  private white?: THREE.Material[];
  private readonly whiteSurfaces = new Map<number, THREE.Material>();

  constructor(private readonly merge: boolean) {}

  private geometry(block: string): THREE.BufferGeometry {
    let geometry = this.built.get(block);
    if (!geometry) {
      geometry = buildGeometry(getBlock(block).shape);
      this.built.set(block, geometry);
    }
    return geometry;
  }

  /**
   * Adds the parts under `parent`. `toParent` takes the scene into the parent's space. `prefix`
   * names merged meshes, and `groups` keeps the editor's groups as nodes.
   */
  add(parts: Part[], parent: THREE.Object3D, toParent: THREE.Matrix4, prefix: string, groups: boolean): void {
    if (parts.length === 0) return;
    if (this.merge) this.addMerged(parts, parent, toParent, prefix);
    else this.addSeparate(parts, parent, toParent, groups);
  }

  /**
   * The parts cut into pieces by material (see keyOfSlot), with each part's color baked in. With
   * `bones`, each piece's vertices are bound to the bone of its part, or, for a skinned part, keep
   * the bones and weights the block brings.
   */
  private piecesByMaterial(parts: Part[], toParent: THREE.Matrix4, bones?: Map<PartId, number | "skin">): Map<number, THREE.BufferGeometry[]> {
    const byMaterial = new Map<number, THREE.BufferGeometry[]>();
    const tint = new THREE.Color();

    for (const part of parts) {
      const geometry = this.geometry(part.block);
      const matrix = toParent.clone().multiply(partMatrix(part));
      tint.set(part.color);

      for (const { start, count, materialIndex = 0 } of geometry.groups) {
        const piece = slice(geometry, start, count, slotInfo(materialIndex).surface !== undefined);
        piece.applyMatrix4(matrix);
        if (materialIndex % 2 === 0) {
          const colors = piece.getAttribute("color");
          for (let i = 0; i < colors.count; i++) {
            colors.setXYZ(i, colors.getX(i) * tint.r, colors.getY(i) * tint.g, colors.getZ(i) * tint.b);
          }
        }
        const owner = bones?.get(part.id) ?? 0;
        if (bones && owner === "skin" && geometry.getAttribute("skinIndex")) {
          const own = (name: string) => (geometry.getAttribute(name).array as Uint16Array | Float32Array).slice(start * 4, (start + count) * 4);
          piece.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(own("skinIndex"), 4));
          piece.setAttribute("skinWeight", new THREE.Float32BufferAttribute(own("skinWeight"), 4));
        } else if (bones) {
          const indices = new Uint16Array(count * 4);
          const weights = new Float32Array(count * 4);
          const bone = owner === "skin" ? 0 : owner;
          for (let i = 0; i < count; i++) {
            indices[i * 4] = bone;
            weights[i * 4] = 1;
          }
          piece.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
          piece.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
        }
        const key = keyOfSlot(materialIndex);
        byMaterial.set(key, [...(byMaterial.get(key) ?? []), piece]);
      }
    }
    return byMaterial;
  }

  /**
   * A white material for a key: the parts' colors are baked into the vertices. Finish slots are
   * finish * 2, so white tinted materials give every finish directly.
   */
  private whiteMaterial(key: number): THREE.Material {
    if (!this.white) {
      this.white = createBlockMaterials(0xffffff);
      FINISH_NAMES.forEach((name, index) => {
        // Glow is only unlit in its fixed slot; the tinted slot of the others is what we want.
        this.white![index === 4 ? 9 : index * 2].name = name;
      });
    }
    if (key < SURFACE_KEY) return this.white[key === 4 ? 9 : key * 2];
    let material = this.whiteSurfaces.get(key);
    if (!material) {
      material = createSurfaceMaterial(SURFACES[key - SURFACE_KEY].id, 0xffffff);
      material.name = keyName(key);
      this.whiteSurfaces.set(key, material);
    }
    return material;
  }

  private static join(pieces: THREE.BufferGeometry[]): THREE.BufferGeometry {
    matchTextureCoordinates(pieces);
    const merged = mergeGeometries(pieces);
    if (!merged) throw new Error("Falha ao juntar as peças");
    const welded = mergeVertices(merged);
    merged.dispose();
    for (const piece of pieces) piece.dispose();
    return welded;
  }

  /** Collapses the parts into one mesh per finish. */
  private addMerged(parts: Part[], parent: THREE.Object3D, toParent: THREE.Matrix4, prefix: string): void {
    for (const [key, pieces] of this.piecesByMaterial(parts, toParent)) {
      const mesh = new THREE.Mesh(SceneBuilder.join(pieces), this.whiteMaterial(key));
      mesh.name = `${prefix}_${keyName(key)}`;
      parent.add(mesh);
    }
  }

  /**
   * One skinned mesh for a whole character, a material per finish. Every vertex of a block person
   * follows only the bone of its part, so the blocks stay rigid; a Realista person bends.
   */
  addSkinned(parts: Part[], bones: Map<PartId, number | "skin">, parent: THREE.Object3D, toParent: THREE.Matrix4, name: string): THREE.SkinnedMesh {
    const byMaterial = [...this.piecesByMaterial(parts, toParent, bones)].sort(([a], [b]) => a - b);
    const geometries = byMaterial.map(([, pieces]) => SceneBuilder.join(pieces));
    matchTextureCoordinates(geometries);
    const geometry = mergeGeometries(geometries, true);
    if (!geometry) throw new Error("Falha ao juntar as peças do personagem");
    for (const part of geometries) part.dispose();
    const mesh = new THREE.SkinnedMesh(geometry, byMaterial.map(([key]) => this.whiteMaterial(key)));
    mesh.name = name;
    parent.add(mesh);
    return mesh;
  }

  private addSeparate(parts: Part[], parent: THREE.Object3D, toParent: THREE.Matrix4, useGroups: boolean): void {
    const groups = new Map<number, THREE.Group>();

    for (const part of parts) {
      let geometry = this.welded.get(part.block);
      if (!geometry) {
        // A person standing still needs no bones in the file.
        const plain = this.geometry(part.block).clone();
        plain.deleteAttribute("skinIndex");
        plain.deleteAttribute("skinWeight");
        geometry = mergeVertices(plain);
        plain.dispose();
        this.welded.set(part.block, geometry);
      }

      let materials = this.materialsByColor.get(part.color);
      if (!materials) {
        materials = createBlockMaterials(part.color);
        this.materialsByColor.set(part.color, materials);
      }
      fitBlockMaterials(materials, geometry, part.color);
      materials.forEach((material, slot) => {
        if (material.name || !isUsedMaterial(material)) return;
        const name = keyName(keyOfSlot(slot));
        material.name = slot % 2 === 0 ? `${name}_${part.color.slice(1)}` : `${name}_fixo`;
      });

      const mesh = new THREE.Mesh(geometry, materials);
      mesh.name = `${getBlock(part.block).name} ${part.id}`;
      mesh.applyMatrix4(toParent.clone().multiply(partMatrix(part)));

      let target = parent;
      if (useGroups && part.group !== undefined) {
        let group = groups.get(part.group);
        if (!group) {
          group = new THREE.Group();
          group.name = `Grupo ${part.group}`;
          groups.set(part.group, group);
          parent.add(group);
        }
        target = group;
      }
      target.add(mesh);
    }
  }

  dispose(): void {
    for (const geometry of this.built.values()) geometry.dispose();
  }
}

/** Physics written with the OMI glTF extensions, which Godot 4 reads on import. */
interface Physics {
  bodies: Map<THREE.Object3D, Record<string, unknown>>;
  shapes: Record<string, unknown>[];
}

const physicsOf = new WeakMap<THREE.Scene, Physics>();

function setFrom(object: THREE.Object3D, matrix: THREE.Matrix4): void {
  matrix.decompose(object.position, object.quaternion, object.scale);
}

/**
 * A box that fits the body in its own frame. Its width comes from the lower part only: mirrors
 * stick out above it (on a truck cab they hang at 1.9 m), and a box as wide as the mirrors would
 * hit walls the body clears.
 */
function collisionBox(shell: THREE.Object3D): THREE.Box3 {
  const point = new THREE.Vector3();
  const points = (visit: (p: THREE.Vector3) => void) => {
    for (const child of shell.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      child.updateMatrix();
      const position = child.geometry.getAttribute("position");
      for (let i = 0; i < position.count; i++) visit(point.fromBufferAttribute(position, i).applyMatrix4(child.matrix));
    }
  };
  const box = new THREE.Box3();
  points((p) => box.expandByPoint(p));
  if (box.isEmpty()) return box;
  const below = box.min.y + (box.max.y - box.min.y) * 0.45;
  let left = -Infinity;
  let right = Infinity;
  points((p) => {
    if (p.y > below) return;
    left = Math.max(left, p.x);
    right = Math.min(right, p.x);
  });
  if (left > right) {
    box.max.x = left;
    box.min.x = right;
  }
  return box;
}

function addVehicle(body: VehicleBody, builder: SceneBuilder, parent: THREE.Object3D, toScene: THREE.Matrix4, options: ExportOptions, physics: Physics): void {
  const node = new THREE.Group();
  node.name = body.name;
  setFrom(node, toScene.clone().multiply(body.frame));
  parent.add(node);

  // Godot makes every name in the file unique, so the trailer's nodes get names of their own
  // instead of a number at the end.
  const suffix = body.trailer ? "_carreta" : "";
  const toBody = body.frame.clone().invert();
  const shell = new THREE.Group();
  shell.name = `carroceria${suffix}`;
  node.add(shell);
  builder.add(body.parts, shell, toBody, shell.name, false);
  const box = collisionBox(shell);
  node.userData = bodyExtras(body, box);

  for (const wheel of body.wheels) {
    const holder = new THREE.Group();
    // Godot turns a node named `-wheel` into a VehicleWheel3D, which spins around its X axis.
    holder.name = options.godot ? `${wheel.name}-wheel` : wheel.name;
    holder.position.copy(wheel.center);
    holder.userData = wheelExtras(wheel);
    node.add(holder);
    builder.add(wheel.parts, holder, new THREE.Matrix4().makeTranslation(wheel.center.clone().negate()).multiply(toBody), wheel.name, false);
  }

  if (options.godot && !box.isEmpty()) {
    // The original OMI body type "vehicle" is what makes Godot build a VehicleBody3D; a collider
    // inside it becomes its CollisionShape3D. Tested with Godot 4.7.
    physics.bodies.set(node, { type: "vehicle" });
    const collider = new THREE.Object3D();
    collider.name = `colisao${suffix}`;
    box.getCenter(collider.position);
    node.add(collider);
    physics.bodies.set(collider, { collider: { shape: physics.shapes.length } });
    physics.shapes.push({ type: "box", box: { size: box.getSize(new THREE.Vector3()).toArray() } });
  }
}

/** The characters that carry animations, and the parts that are not theirs. */
function findAnimated(parts: Part[], animations: Record<string, string[]> | undefined): { rigs: { rig: Rig; clips: ClipInfo[] }[]; rest: Part[] } {
  if (!animations || Object.keys(animations).length === 0) return { rigs: [], rest: parts };
  const rigs = findRigs(parts)
    .map((rig) => ({ rig, clips: (animations[String(rig.root)] ?? []).flatMap((id) => getClip(id) ?? []) }))
    .filter(({ clips }) => clips.length > 0);
  const taken = new Set(rigs.flatMap(({ rig }) => rig.parts.map((part) => part.id)));
  return { rigs, rest: parts.filter((part) => !taken.has(part.id)) };
}

/** Where a character stands: on the ground under its hips, facing +Z. */
const characterFrame = (rig: Rig) => rig.frame.clone().multiply(new THREE.Matrix4().makeTranslation(0, rig.ground, 0));

/** A character as one skinned mesh with its skeleton, and its clips baked on that skeleton. */
function addCharacter(
  rig: Rig,
  clips: ClipInfo[],
  parts: Map<PartId, Part>,
  builder: SceneBuilder,
  parent: THREE.Object3D,
  toScene: THREE.Matrix4,
  names: { node: string; mesh: string; clipPrefix: string },
  godot: boolean,
): THREE.AnimationClip[] {
  const node = new THREE.Group();
  node.name = names.node;
  const frame = characterFrame(rig);
  setFrom(node, toScene.clone().multiply(frame));
  parent.add(node);

  const bones = buildSkeleton(rig);
  node.add(bones[0]);
  const owners = new Map(rig.parts.map((part): [PartId, number | "skin"] => [part.id, part.skin ? "skin" : part.bone]));
  const mesh = builder.addSkinned(rig.parts.map((part) => parts.get(part.id)!), owners, node, frame.clone().invert(), names.mesh);
  node.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(bones));
  // Godot loops an animation whose name ends in -loop.
  return clips.map((clip) => bakeClip(rig, new ClipSampler(clip), bones, `${names.clipPrefix}${clipFileName(clip)}${godot && clip.loop ? "-loop" : ""}`));
}

/** Builds the scene to export. Kept apart from the file writing so it can be tested. */
export function buildExportScene(parts: Part[], options: ExportOptions): THREE.Scene {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = options.name;
  scene.add(root);

  const { bodies, rest: afterVehicles } = options.vehicles ? findVehicles(parts) : { bodies: [], rest: parts };
  const { rigs, rest } = findAnimated(afterVehicles, options.animations);
  if (rigs.length > 0 && !hasAnimationPack()) throw new Error("As animações ainda não foram carregadas");
  // A vehicle or a character exported alone goes in its own frame: at the origin and facing +Z,
  // whatever its place in the scene, because that is how a game spawns it.
  const drivers = bodies.filter((body) => !body.trailer);
  const alone = options.center && rest.length === 0 && drivers.length + rigs.length === 1;
  const subject = drivers[0]?.frame ?? (rigs[0] && characterFrame(rigs[0].rig));
  const own = alone && subject !== undefined;
  const toScene = own ? subject.clone().invert() : new THREE.Matrix4();

  const builder = new SceneBuilder(options.merge);
  const physics: Physics = { bodies: new Map(), shapes: [] };
  builder.add(rest, root, toScene, "malha", true);
  for (const body of bodies) addVehicle(body, builder, root, toScene, options, physics);
  const byId = new Map(parts.map((part) => [part.id, part]));
  rigs.forEach(({ rig, clips }, index) => {
    const number = rigs.length > 1 ? ` ${index + 1}` : "";
    const names = { node: `Personagem${number}`, mesh: `corpo${number.replace(" ", "_")}`, clipPrefix: rigs.length > 1 ? `personagem${index + 1}_` : "" };
    scene.animations.push(...addCharacter(rig, clips, byId, builder, root, toScene, names, options.godot ?? false));
  });
  builder.dispose();
  if (physics.shapes.length > 0) physicsOf.set(scene, physics);

  if (options.center && !own && parts.length > 0) {
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const center = box.getCenter(new THREE.Vector3());
    root.position.set(-center.x, -box.min.y, -center.z);
  }
  return scene;
}

/**
 * Godot's importer only turns on vertex colors for materials used after the first primitive
 * of a mesh, which leaves single-primitive models white. Materials are shared across the
 * file, so one invisible mesh using each of them in a later primitive fixes all the others.
 */
export function addVertexColorHint(scene: THREE.Scene): void {
  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const list: THREE.Material[] = Array.isArray(object.material) ? object.material : [object.material];
    const used = object.geometry.groups.length > 0 && Array.isArray(object.material)
      ? object.geometry.groups.map((group: { materialIndex?: number }) => list[group.materialIndex ?? 0])
      : list;
    for (const material of used) materials.add(material);
  });
  if (materials.size === 0) return;

  const ordered = [...materials];
  const slots = [ordered[0], ...ordered];
  const vertices = slots.length * 3;
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
  const normals = new Float32Array(vertices * 3);
  for (let i = 1; i < normals.length; i += 3) normals[i] = 1;
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(new Float32Array(vertices * 3).fill(1), 3));
  // glTF requires texture coordinates wherever a textured material is used.
  geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(vertices * 2), 2));
  slots.forEach((_, slot) => geometry.addGroup(slot * 3, 3, slot));

  const hint = new THREE.Mesh(geometry, slots);
  hint.name = "_cores_por_vertice";
  scene.add(hint);
}

interface ExporterWriter {
  json: Record<string, unknown> & { extensions?: Record<string, unknown> };
  extensionsUsed: Record<string, boolean>;
}

/** Writes the physics of a scene into the file, with the OMI_physics_body and OMI_physics_shape extensions. */
function physicsPlugin(physics: Physics) {
  return (writer: ExporterWriter) => ({
    writeNode(object: THREE.Object3D, nodeDef: Record<string, unknown> & { extensions?: Record<string, unknown> }) {
      const body = physics.bodies.get(object);
      if (!body) return;
      nodeDef.extensions = { ...nodeDef.extensions, OMI_physics_body: body };
      writer.extensionsUsed.OMI_physics_body = true;
    },
    afterParse() {
      writer.json.extensions = { ...writer.json.extensions, OMI_physics_shape: { shapes: physics.shapes } };
      writer.extensionsUsed.OMI_physics_shape = true;
    },
  });
}

export async function exportGlb(parts: Part[], options: ExportOptions): Promise<ArrayBuffer> {
  if (options.animations && Object.values(options.animations).some((clips) => clips.length > 0)) await loadAnimationPack();
  // Textures go into the file, so their images have to be here first.
  await surfacesReady(new Set(parts.flatMap((part) => surfacesOfShape(getBlock(part.block).shape))));
  const scene = buildExportScene(parts, options);
  addVertexColorHint(scene);
  const exporter = new GLTFExporter();
  const physics = physicsOf.get(scene);
  // three's types describe plugins loosely; the writer hands us its json and extension list.
  if (physics) exporter.register(physicsPlugin(physics) as unknown as Parameters<GLTFExporter["register"]>[0]);
  const result = await exporter.parseAsync(scene, { binary: true, animations: scene.animations });

  const materials = new Set<THREE.Material>();
  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      for (const material of Array.isArray(object.material) ? object.material : [object.material]) materials.add(material);
    }
  });
  disposeBlockMaterials([...materials]);
  return result as ArrayBuffer;
}
