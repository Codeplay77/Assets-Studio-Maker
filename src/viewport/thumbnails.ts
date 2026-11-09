import { useEffect, useState } from "react";
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import {
  buildGeometry,
  createBlockMaterials,
  createStudioLighting,
  disposeBlockMaterials,
} from "../blocks/geometry";
import type { BlockDef } from "../blocks/types";

const SIZE = 160;
const FRAME_BUDGET_MS = 10;

interface Studio {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
}

const direction = new THREE.Vector3(1, 0.85, 1.2).normalize();
const cache = new WeakMap<BlockDef, string>();
const queue = new Map<BlockDef, Set<(url: string) => void>>();
let studio: Studio | null = null;
let scheduled = false;

function getStudio(): Studio {
  if (studio) return studio;
  const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
  renderer.setSize(SIZE, SIZE);

  const scene = new THREE.Scene();
  createStudioLighting(renderer, scene, new RoomEnvironment());
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555b66, 0.7));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(2, 4, 3);
  scene.add(sun);

  studio = { renderer, scene, camera: new THREE.PerspectiveCamera(26, 1, 0.01, 500) };
  return studio;
}

function render(block: BlockDef): string {
  const { renderer, scene, camera } = getStudio();
  const geometry = buildGeometry(block.shape);
  const materials = createBlockMaterials(block.color);
  const mesh = new THREE.Mesh(geometry, materials);
  scene.add(mesh);

  const box = new THREE.Box3().setFromObject(mesh);
  const center = box.getCenter(new THREE.Vector3());
  const radius = box.getSize(new THREE.Vector3()).length() / 2;
  const distance = radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2));
  camera.position.copy(center).addScaledVector(direction, distance);
  camera.lookAt(center);

  renderer.render(scene, camera);
  const url = renderer.domElement.toDataURL("image/png");

  scene.remove(mesh);
  geometry.dispose();
  disposeBlockMaterials(materials);
  return url;
}

function schedule(): void {
  if (scheduled || queue.size === 0) return;
  scheduled = true;
  requestAnimationFrame(() => {
    scheduled = false;
    const start = performance.now();
    for (const [block, listeners] of queue) {
      if (performance.now() - start > FRAME_BUDGET_MS) break;
      queue.delete(block);
      const url = render(block);
      cache.set(block, url);
      for (const listener of listeners) listener(url);
    }
    schedule();
  });
}

/** Draws thumbnails a few per frame, so a category with hundreds of models never freezes. */
export function useThumbnail(block: BlockDef): string | undefined {
  const [url, setUrl] = useState(() => cache.get(block));

  useEffect(() => {
    const cached = cache.get(block);
    setUrl(cached);
    if (cached) return;

    const listeners = queue.get(block) ?? new Set();
    listeners.add(setUrl);
    queue.set(block, listeners);
    schedule();
    return () => {
      listeners.delete(setUrl);
      if (listeners.size === 0 && queue.get(block) === listeners) queue.delete(block);
    };
  }, [block]);

  return url;
}
