import * as THREE from "three";
import { getSurface, surfaceFolder } from "./surfaces";

interface SurfaceImages {
  map: THREE.Texture;
  normalMap: THREE.Texture;
  /** Occlusion in red, roughness in green and metalness in blue, the layout glTF expects. */
  arm: THREE.Texture;
}

const loaded = new Map<string, SurfaceImages>();
const loading = new Map<string, Promise<SurfaceImages>>();
/** Materials made before their images arrived; they get them as soon as they load. */
const waiting = new Map<string, Set<THREE.MeshStandardMaterial>>();
const listeners = new Set<() => void>();

/** Runs after any surface finishes loading, so whatever shows it can draw again. */
export function onSurfaceLoaded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

async function loadTexture(url: string, color: boolean): Promise<THREE.Texture> {
  const texture = await new THREE.TextureLoader().loadAsync(url);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = 8;
  if (color) texture.colorSpace = THREE.SRGBColorSpace;
  // The glTF exporter writes PNG unless told otherwise, several times larger than these JPEGs.
  texture.userData.mimeType = url.endsWith(".png") ? "image/png" : "image/jpeg";
  return texture;
}

function applyImages(material: THREE.MeshStandardMaterial, images: SurfaceImages): void {
  material.map = images.map;
  material.normalMap = images.normalMap;
  material.aoMap = images.arm;
  material.roughnessMap = images.arm;
  material.metalnessMap = images.arm;
  material.roughness = 1;
  material.metalness = 1;
  material.needsUpdate = true;
}

export function loadSurface(id: string): Promise<SurfaceImages> {
  let promise = loading.get(id);
  if (!promise) {
    const surface = getSurface(id);
    const folder = surfaceFolder(surface);
    promise = Promise.all([
      loadTexture(`${folder}/color.${surface.cutout || surface.detail ? "png" : "jpg"}`, true),
      loadTexture(`${folder}/normal.jpg`, false),
      loadTexture(`${folder}/arm.jpg`, false),
    ]).then(([map, normalMap, arm]) => {
      const images = { map, normalMap, arm };
      loaded.set(id, images);
      for (const material of waiting.get(id) ?? []) applyImages(material, images);
      waiting.delete(id);
      for (const listener of listeners) listener();
      return images;
    });
    loading.set(id, promise);
    promise.catch((error: unknown) => {
      loading.delete(id);
      console.error(error);
    });
  }
  return promise;
}

export function isSurfaceLoaded(id: string): boolean {
  return loaded.has(id);
}

/** Resolves once every listed surface can be drawn with its images. */
export async function surfacesReady(ids: Iterable<string>): Promise<void> {
  await Promise.all([...new Set(ids)].map(loadSurface));
}

/** Loading needs a browser; tests in Node draw surfaces in plain color. */
const canLoad = typeof document !== "undefined";

/** A material that shows a surface. Until its images arrive it is drawn in plain color. */
export function createSurfaceMaterial(id: string, color?: THREE.ColorRepresentation): THREE.MeshStandardMaterial {
  const surface = getSurface(id);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    ...(color === undefined ? {} : { color }),
    roughness: 0.85,
    metalness: 0,
    ...(surface.cutout ? { alphaTest: 0.5 } : {}),
    ...((surface.cutout && surface.double !== false) || surface.double ? { side: THREE.DoubleSide } : {}),
  });
  material.userData.surface = id;
  const images = loaded.get(id);
  if (images) applyImages(material, images);
  else if (canLoad) {
    let set = waiting.get(id);
    if (!set) waiting.set(id, (set = new Set()));
    set.add(material);
    void loadSurface(id);
  }
  return material;
}
