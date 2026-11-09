import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { mergeGeometries, mergeVertices } from "three/addons/utils/BufferGeometryUtils.js";
import { getBlock, type BlockDef } from "../blocks/catalog";
import { buildGeometry, createBlockMaterials, disposeBlockMaterials } from "../blocks/geometry";
import type { Part } from "../core/types";

export interface ExportOptions {
  /** One mesh per material instead of one node per part: fewer draw calls in a game. */
  merge: boolean;
  /** Puts the model's base at the origin, which is where engines expect the pivot. */
  center: boolean;
  name: string;
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

function partMatrix(part: Part): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(...part.position),
    new THREE.Quaternion(...part.rotation),
    new THREE.Vector3(...part.scale),
  );
}

class GeometryCache {
  private readonly built = new Map<string, THREE.BufferGeometry>();

  get(block: string): THREE.BufferGeometry {
    let geometry = this.built.get(block);
    if (!geometry) {
      geometry = buildGeometry(getBlock(block).shape);
      this.built.set(block, geometry);
    }
    return geometry;
  }

  dispose(): void {
    for (const geometry of this.built.values()) geometry.dispose();
  }
}

const FINISH_NAMES = ["fosco", "brilhante", "metal", "vidro", "luz"];

function slice(geometry: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const result = new THREE.BufferGeometry();
  for (const name of ["position", "normal", "color"]) {
    const attribute = geometry.getAttribute(name);
    const array = (attribute.array as Float32Array).slice(start * 3, (start + count) * 3);
    result.setAttribute(name, new THREE.BufferAttribute(array, 3));
  }
  return result;
}

/** Collapses everything into one mesh per finish, with each part's color baked in. */
function mergeParts(parts: Part[], geometries: GeometryCache, root: THREE.Group): void {
  const byFinish = new Map<number, THREE.BufferGeometry[]>();
  const tint = new THREE.Color();

  for (const part of parts) {
    const geometry = geometries.get(part.block);
    const matrix = partMatrix(part);
    tint.set(part.color);

    for (const { start, count, materialIndex = 0 } of geometry.groups) {
      const piece = slice(geometry, start, count);
      piece.applyMatrix4(matrix);
      if (materialIndex % 2 === 0) {
        const colors = piece.getAttribute("color");
        for (let i = 0; i < colors.count; i++) {
          colors.setXYZ(i, colors.getX(i) * tint.r, colors.getY(i) * tint.g, colors.getZ(i) * tint.b);
        }
      }
      const finish = Math.floor(materialIndex / 2);
      byFinish.set(finish, [...(byFinish.get(finish) ?? []), piece]);
    }
  }

  // Slots are finish * 2, so white tinted materials give the five finishes directly.
  const materials = createBlockMaterials(0xffffff);
  for (const [finish, pieces] of byFinish) {
    const merged = mergeGeometries(pieces);
    if (!merged) throw new Error("Falha ao juntar as peças");
    const welded = mergeVertices(merged);
    merged.dispose();
    for (const piece of pieces) piece.dispose();

    // Glow is only unlit in its fixed slot; the tinted slot of the others is what we want.
    const material = finish === 4 ? materials[9] : materials[finish * 2];
    material.name = FINISH_NAMES[finish];
    const mesh = new THREE.Mesh(welded, material);
    mesh.name = `malha_${FINISH_NAMES[finish]}`;
    root.add(mesh);
  }
}

function addSeparateParts(parts: Part[], geometries: GeometryCache, root: THREE.Group): void {
  const welded = new Map<string, THREE.BufferGeometry>();
  const materialsByColor = new Map<string, THREE.Material[]>();
  const groups = new Map<number, THREE.Group>();

  for (const part of parts) {
    let geometry = welded.get(part.block);
    if (!geometry) {
      geometry = mergeVertices(geometries.get(part.block));
      welded.set(part.block, geometry);
    }

    let materials = materialsByColor.get(part.color);
    if (!materials) {
      materials = createBlockMaterials(part.color);
      materials.forEach((material, slot) => {
        const finish = FINISH_NAMES[Math.floor(slot / 2)];
        material.name = slot % 2 === 0 ? `${finish}_${part.color.slice(1)}` : `${finish}_fixo`;
      });
      materialsByColor.set(part.color, materials);
    }

    const mesh = new THREE.Mesh(geometry, materials);
    mesh.name = `${getBlock(part.block).name} ${part.id}`;
    mesh.applyMatrix4(partMatrix(part));

    let parent = root;
    if (part.group !== undefined) {
      let group = groups.get(part.group);
      if (!group) {
        group = new THREE.Group();
        group.name = `Grupo ${part.group}`;
        groups.set(part.group, group);
        root.add(group);
      }
      parent = group;
    }
    parent.add(mesh);
  }
}

/** Builds the scene to export. Kept apart from the file writing so it can be tested. */
export function buildExportScene(parts: Part[], options: ExportOptions): THREE.Scene {
  const scene = new THREE.Scene();
  const root = new THREE.Group();
  root.name = options.name;
  scene.add(root);

  const geometries = new GeometryCache();
  if (options.merge) mergeParts(parts, geometries, root);
  else addSeparateParts(parts, geometries, root);
  geometries.dispose();

  if (options.center && parts.length > 0) {
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
  slots.forEach((_, slot) => geometry.addGroup(slot * 3, 3, slot));

  const hint = new THREE.Mesh(geometry, slots);
  hint.name = "_cores_por_vertice";
  scene.add(hint);
}

export async function exportGlb(parts: Part[], options: ExportOptions): Promise<ArrayBuffer> {
  const scene = buildExportScene(parts, options);
  addVertexColorHint(scene);
  const result = await new GLTFExporter().parseAsync(scene, { binary: true });

  scene.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.geometry.dispose();
      disposeBlockMaterials(Array.isArray(object.material) ? object.material : [object.material]);
    }
  });
  return result as ArrayBuffer;
}
