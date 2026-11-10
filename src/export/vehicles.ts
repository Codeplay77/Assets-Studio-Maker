import * as THREE from "three";
import { partBounds as partBox, partMatrix } from "../blocks/bounds";
import { getBlock, type BlockDef } from "../blocks/catalog";
import { buildGeometry } from "../blocks/geometry";
import type { Part } from "../core/types";

export { partMatrix };

/** `wheel_0_l` on cars, trucks, buses and trailers; `wheel_fl` on karts. */
const WHEEL_SOCKET = /^wheel_(?:\d+_[lr]|[fr][lr])$/;

/** A wheel ready to turn in a game: its own node, centered on the axle. */
export interface VehicleWheel {
  /** `roda_dianteira_esquerda`, `roda_traseira_2_direita`... */
  name: string;
  /** Both tires of a dual wheel, with their colored bands. */
  parts: Part[];
  /** Middle of the tire on the axle, in the frame of its body. */
  center: THREE.Vector3;
  radius: number;
  width: number;
  /** Front wheels steer. */
  front: boolean;
  dual: boolean;
}

export interface VehicleBody {
  name: string;
  /**
   * Where the body is in the scene, without scale: on the ground, under the middle of its axles,
   * front toward +Z and left toward +X. A trailer's frame sits under its king pin instead, which is
   * where it turns.
   */
  frame: THREE.Matrix4;
  /** Everything but the wheels. */
  parts: Part[];
  wheels: VehicleWheel[];
  /** Bounds of the body without its wheels, in its frame. */
  box: THREE.Box3;
  trailer: boolean;
  /** Where a trailer hooks on, in the frame: the fifth wheel of a tractor or the king pin of a trailer. */
  hitch?: THREE.Vector3;
}

interface Tire {
  /** Middle of the tread along the wheel's own axis, which is local Y. */
  center: number;
  width: number;
  radius: number;
}

const tires = new WeakMap<BlockDef, Tire>();

/** Wheel blocks turn around their local Y axis; the tread is the ring of points farthest from it. */
function tireOf(def: BlockDef): Tire {
  let tire = tires.get(def);
  if (!tire) {
    const geometry = buildGeometry(def.shape);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!;
    const radius = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) / 2;
    const position = geometry.getAttribute("position");
    let low = Infinity;
    let high = -Infinity;
    for (let i = 0; i < position.count; i++) {
      // Voxel wheels are square, so their farthest points are along an axis, not a diagonal.
      const out = Math.max(Math.hypot(position.getX(i), position.getZ(i)), Math.abs(position.getX(i)), Math.abs(position.getZ(i)));
      if (out < radius * 0.9) continue;
      low = Math.min(low, position.getY(i));
      high = Math.max(high, position.getY(i));
    }
    geometry.dispose();
    if (low > high) {
      low = box.min.y;
      high = box.max.y;
    }
    tire = { center: (low + high) / 2, width: high - low, radius };
    tires.set(def, tire);
  }
  return tire;
}

const sameTransform = (a: Part, b: Part) =>
  a.position.every((value, i) => Math.abs(value - b.position[i]) < 1e-5) &&
  Math.abs(new THREE.Quaternion(...a.rotation).dot(new THREE.Quaternion(...b.rotation))) > 1 - 1e-6;

const wheelSockets = (def: BlockDef) => def.sockets.filter((socket) => WHEEL_SOCKET.test(socket.id));

interface Socket {
  base: Part;
  at: THREE.Vector3;
}

const round = (value: number) => Math.round(value * 1000) / 1000;

/** Names the wheels of one body from the front to the back, the way a game script expects to find them. */
function nameWheels(sets: { center: THREE.Vector3 }[], trailer: boolean): { name: string; front: boolean }[] {
  const zs = sets.map((set) => set.center.z);
  const middle = (Math.max(...zs) + Math.min(...zs)) / 2;
  // Wheels within a few centimeters of each other share an axle.
  const axles: number[] = [];
  for (const z of [...zs].sort((a, b) => b - a)) if (!axles.some((axle) => Math.abs(axle - z) < 0.05)) axles.push(z);
  const front = (z: number) => !trailer && axles.length > 1 && z > middle + 0.01;
  const frontAxles = axles.filter(front);
  const rearAxles = axles.filter((z) => !front(z));
  return sets.map(({ center }) => {
    const isFront = front(center.z);
    const list = isFront ? frontAxles : rearAxles;
    const index = list.findIndex((axle) => Math.abs(axle - center.z) < 0.05);
    const number = list.length > 1 ? `_${index + 1}` : "";
    const side = center.x >= 0 ? "esquerda" : "direita";
    // A trailer and its tractor go in the same file, so its wheels need names of their own.
    const where = trailer ? "carreta" : isFront ? "dianteira" : "traseira";
    return { name: `roda_${where}${number}_${side}`, front: isFront };
  });
}

/**
 * Finds the vehicles among the parts: a body with wheel sockets, the wheels fitted on them and
 * everything that belongs to the body (paint layers, signs, the driver of a kart). What is not part
 * of any vehicle comes back in `rest`.
 */
export function findVehicles(parts: Part[]): { bodies: VehicleBody[]; rest: Part[] } {
  const bases = parts.filter((part) => wheelSockets(getBlock(part.block)).length >= 2);
  if (bases.length === 0) return { bodies: [], rest: parts };

  const sockets: Socket[] = bases.flatMap((base) => {
    const matrix = partMatrix(base);
    return wheelSockets(getBlock(base.block)).map((socket) => ({ base, at: new THREE.Vector3(...socket.p).applyMatrix4(matrix) }));
  });

  // Each wheel goes to the socket it was fitted on. The inner tire of a dual wheel sits a tire
  // width inside, still much closer to its own socket than to any other.
  const fitted = new Map<Socket, Part[]>();
  const taken = new Set<Part>(bases);
  for (const part of parts) {
    const def = getBlock(part.block);
    if (def.category !== "wheel" || !def.sockets[0]) continue;
    const at = new THREE.Vector3(...def.sockets[0].p).applyMatrix4(partMatrix(part));
    let best: Socket | undefined;
    let distance = tireOf(def).radius * Math.max(...part.scale) * 1.2;
    for (const socket of sockets) {
      const d = socket.at.distanceTo(at);
      if (d < distance) {
        best = socket;
        distance = d;
      }
    }
    if (!best) continue;
    fitted.set(best, [...(fitted.get(best) ?? []), part]);
    taken.add(part);
  }

  // The paint layers of a body are overlaid on it, with the same transform.
  const members = new Map<Part, Part[]>(bases.map((base) => [base, [base]]));
  for (const part of parts) {
    if (taken.has(part)) continue;
    const base = bases.find((candidate) => sameTransform(candidate, part) && part.group === candidate.group);
    if (!base) continue;
    members.get(base)!.push(part);
    taken.add(part);
  }

  // Signs, sirens, the driver and the wing of a kart are fitted elsewhere on the body, so they are
  // found by where they are: on the body, in the same group. Only by where they are, because a
  // whole city can be one group, and its buildings are not part of the cars parked in it.
  const worldBox = new Map(
    bases.map((base) => [base, members.get(base)!.reduce((box, part) => box.union(partBox(part, new THREE.Matrix4())), new THREE.Box3()).expandByScalar(0.5)]),
  );
  const isTrailer = (base: Part) => getBlock(base.block).sockets[0]?.id === "king";
  const volume = (base: Part) => worldBox.get(base)!.getSize(new THREE.Vector3()).length();
  for (const part of parts) {
    if (taken.has(part)) continue;
    const at = new THREE.Vector3(...part.position);
    const base = bases
      .filter((candidate) => candidate.group === part.group && worldBox.get(candidate)!.containsPoint(at))
      .sort((a, b) => volume(a) - volume(b))[0];
    if (!base) continue;
    members.get(base)!.push(part);
    taken.add(part);
  }

  const used = new Map<string, number>();
  const bodies = bases.map((base): VehicleBody => {
    const def = getBlock(base.block);
    const trailer = isTrailer(base);
    const local = wheelSockets(def).map((socket) => socket.p[2]);
    const origin = new THREE.Vector3(0, 0, trailer ? 0 : (Math.max(...local) + Math.min(...local)) / 2).applyMatrix4(partMatrix(base));
    const frame = new THREE.Matrix4().compose(origin, new THREE.Quaternion(...base.rotation), new THREE.Vector3(1, 1, 1));
    const toFrame = frame.clone().invert();

    const sets = sockets
      .filter((socket) => socket.base === base && fitted.has(socket))
      .map((socket) => {
        const wheelParts = fitted.get(socket)!;
        const rims = wheelParts.filter((part) => part.block.endsWith("_rim"));
        const measured = rims.length > 0 ? rims : wheelParts;
        // The two faces of each tire, in the frame: their middle is the center of the wheel.
        const faces = measured.flatMap((part) => {
          const tire = tireOf(getBlock(part.block));
          const matrix = toFrame.clone().multiply(partMatrix(part));
          return [tire.center - tire.width / 2, tire.center + tire.width / 2].map((y) => new THREE.Vector3(0, y, 0).applyMatrix4(matrix));
        });
        const center = faces.reduce((sum, face) => sum.add(face), new THREE.Vector3()).divideScalar(faces.length);
        const xs = faces.map((face) => face.x);
        const first = measured[0];
        return {
          parts: wheelParts,
          center,
          radius: tireOf(getBlock(first.block)).radius * Math.max(first.scale[0], first.scale[2]),
          width: Math.max(...xs) - Math.min(...xs),
          dual: measured.length > 1,
        };
      });
    const names = nameWheels(sets, trailer);
    const wheels = sets.map((set, i) => ({ ...set, ...names[i] })).sort((a, b) => b.center.z - a.center.z || b.center.x - a.center.x);

    const bodyParts = members.get(base)!;
    const box = bodyParts.reduce((union, part) => union.union(partBox(part, toFrame)), new THREE.Box3());
    const hitchSocket = def.sockets.find((socket) => socket.id === (trailer ? "king" : "hitch"));
    const hitch = hitchSocket && new THREE.Vector3(...hitchSocket.p).applyMatrix4(partMatrix(base)).applyMatrix4(toFrame);

    const count = (used.get(def.name) ?? 0) + 1;
    used.set(def.name, count);
    return { name: count > 1 ? `${def.name} ${count}` : def.name, frame, parts: bodyParts, wheels, box, trailer, hitch };
  });

  return { bodies, rest: parts.filter((part) => !taken.has(part)) };
}

/** How many vehicles a game would drive: trailers ride along with their tractor. */
export function countVehicles(parts: Part[]): number {
  return parts.filter((part) => {
    const def = getBlock(part.block);
    return wheelSockets(def).length >= 2 && def.sockets[0]?.id !== "king";
  }).length;
}

/** What a game script needs to set up a wheel, saved in the file next to it. */
export function wheelExtras(wheel: VehicleWheel): Record<string, unknown> {
  return { raio: round(wheel.radius), largura: round(wheel.width), direcao: wheel.front, tracao: !wheel.front, dupla: wheel.dual };
}

export function bodyExtras(body: VehicleBody, box: THREE.Box3 = body.box): Record<string, unknown> {
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  return {
    veiculo: true,
    rodas: body.wheels.length,
    colisao: { centro: center.toArray().map(round), tamanho: size.toArray().map(round) },
    ...(body.hitch ? { [body.trailer ? "pino_rei" : "engate"]: body.hitch.toArray().map(round) } : {}),
  };
}
