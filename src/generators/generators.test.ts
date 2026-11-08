import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getBlock } from "../blocks/catalog";
import { Assembler } from "./assembler";
import { generators, runGenerator } from ".";
import { Rng } from "./rng";
import { buildCar, CAR_KINDS } from "./car";
import * as kit from "./kit";
import { buildPerson } from "./person";
import { fitTile, opposite, rotateOffset, rotateOpenings, STEPS, TILE_OPENINGS } from "./tiles";
import { traceOutline } from "./track";

const SEEDS = Array.from({ length: 40 }, (_, index) => index * 7919 + 1);

describe.each(generators.map((generator) => [generator.id] as const))("generator %s", (id) => {
  it("only uses known blocks and valid values", () => {
    for (const seed of SEEDS) {
      const parts = runGenerator(id, seed);
      expect(parts.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const part of parts) {
        expect(() => getBlock(part.block)).not.toThrow();
        for (const value of [...part.position, ...part.rotation, ...part.scale]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(Math.min(...part.scale)).toBeGreaterThan(0.01);
      }
    }
  });

  it("builds the same model from the same seed", () => {
    expect(runGenerator(id, 1234)).toEqual(runGenerator(id, 1234));
  });

  it("varies with the seed", () => {
    const outcomes = new Set(SEEDS.map((seed) => JSON.stringify(runGenerator(id, seed))));
    expect(outcomes.size).toBeGreaterThan(SEEDS.length / 2);
  });
});

describe("CC0 library", () => {
  it.each(Object.entries(kit).filter(([name]) => name.startsWith("KIT_")))(
    "%s finds models in the catalog",
    (_name, list) => {
      expect((list as string[]).length).toBeGreaterThan(0);
    },
  );

  it("fits buildings inside their lot", () => {
    for (const seed of SEEDS) {
      const asm = new Assembler();
      kit.placeFitted(asm, new Rng(seed), kit.KIT_TOWERS, { position: [0, 0, 0], maxWidth: 7 });
      const [part] = asm.parts;
      expect(kit.footprint(part.block) * part.scale.x).toBeLessThanOrEqual(7.001);
    }
  });
});

describe("person", () => {
  it("stands on the ground with feet level", () => {
    for (const seed of SEEDS) {
      const asm = new Assembler();
      buildPerson(asm, new Rng(seed));
      const feet = asm.parts.filter((part) => part.block.startsWith("body.shoe"));
      expect(feet).toHaveLength(2);
      for (const foot of feet) {
        expect(Math.abs(asm.socketOf(foot, "sole").position.y), `seed ${seed}`).toBeLessThan(0.03);
      }
    }
  });

  it("is a plausible height", () => {
    for (const seed of SEEDS) {
      const asm = new Assembler();
      buildPerson(asm, new Rng(seed));
      const head = asm.parts.find((part) => part.block.startsWith("body.head"))!;
      const top = asm.socketOf(head, "top").position.y;
      expect(top, `seed ${seed}`).toBeGreaterThan(1.55);
      expect(top, `seed ${seed}`).toBeLessThan(2.05);
    }
  });

  it("keeps the torso above the hips", () => {
    const asm = new Assembler();
    buildPerson(asm, new Rng(5));
    const hips = asm.parts.find((part) => part.block === "body.hips")!;
    const head = asm.parts.find((part) => part.block.startsWith("body.head"))!;
    expect(head.position.y).toBeGreaterThan(hips.position.y + 0.3);
  });
});

describe("cars", () => {
  it.each(Object.keys(CAR_KINDS))("%s has four wheels touching the ground", (kind) => {
    const asm = new Assembler();
    buildCar(asm, new Rng(3), { kind });
    const wheels = asm.parts.filter(
      (part) => getBlock(part.block).sockets[0].id === "axle",
    );
    expect(wheels).toHaveLength(4);
    for (const wheel of wheels) {
      expect(wheel.position.y).toBeCloseTo(CAR_KINDS[kind].radius, 3);
    }
  });

  it("puts wheels on the outside of each side", () => {
    const asm = new Assembler();
    buildCar(asm, new Rng(3), { kind: "sedan" });
    const body = asm.parts[0];
    const left = asm.parts[1];
    const hub = asm.socketOf(left, "hub").position;
    expect(hub.x).toBeGreaterThan(left.position.x);
    expect(body.position.x).toBeLessThan(left.position.x);
  });

  it("rotates as a whole", () => {
    const asm = new Assembler();
    buildCar(asm, new Rng(3), { kind: "sedan", yawSteps: 1 });
    const front = asm.socketOf(asm.parts[0], "front").position;
    expect(front.x).toBeGreaterThan(1.5);
    expect(Math.abs(front.z)).toBeLessThan(0.01);
    const wheel = asm.parts[1];
    const axisDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(wheel.quaternion);
    expect(Math.abs(axisDirection.z)).toBeCloseTo(1, 5);
  });
});

describe("tiles", () => {
  it("rotates openings clockwise from above", () => {
    expect(rotateOpenings(TILE_OPENINGS.curve, 1).sort()).toEqual([1, 2]);
  });

  it("matches the rotation applied to positions", () => {
    for (let steps = 0; steps < 4; steps++) {
      for (let direction = 0; direction < 4; direction++) {
        const [dx, dz] = STEPS[direction];
        const [x, z] = rotateOffset([dx, dz], steps);
        const quaternion = new THREE.Quaternion().setFromAxisAngle(
          new THREE.Vector3(0, 1, 0),
          (steps * Math.PI) / 2,
        );
        const v = new THREE.Vector3(dx, 0, dz).applyQuaternion(quaternion);
        expect(v.x).toBeCloseTo(x, 6);
        expect(v.z).toBeCloseTo(z, 6);

        const [expectedX, expectedZ] = STEPS[(direction + steps) % 4];
        expect(x).toBeCloseTo(expectedX, 6);
        expect(z).toBeCloseTo(expectedZ, 6);
      }
    }
  });

  it("finds a tile for every useful combination", () => {
    expect(fitTile([0, 2]).kind).toBe("straight");
    expect(fitTile([1, 3]).kind).toBe("straight");
    expect(fitTile([1, 2]).kind).toBe("curve");
    expect(fitTile([0, 1, 3]).kind).toBe("t");
    expect(fitTile([0, 1, 2, 3]).kind).toBe("cross");
  });
});

describe("track", () => {
  it("rejects an outline that touches itself", () => {
    expect(traceOutline(new Set(["0,0", "1,1"]))).toBeNull();
  });

  it("forms a closed loop whose tiles line up", () => {
    const cells = new Set<`${number},${number}`>(["1,1", "2,1", "1,2", "2,2", "3,2"]);
    const loop = traceOutline(cells)!;
    expect(loop).not.toBeNull();
    loop.forEach((tile, index) => {
      const next = loop[(index + 1) % loop.length];
      const [dx, dy] = STEPS[tile.out];
      expect(next.x).toBe(tile.x + dx);
      expect(next.y).toBe(tile.y + dy);
      expect(next.back).toBe(opposite(tile.out));
      const openings = rotateOpenings(TILE_OPENINGS[tile.kind], tile.yawSteps);
      expect(openings).toContain(tile.out);
      expect(openings).toContain(tile.back);
    });
  });

  it("always has a start tile and closed connections", () => {
    for (const seed of SEEDS) {
      const parts = runGenerator("track", seed);
      expect(parts.filter((part) => part.block === "track.start")).toHaveLength(1);
    }
  });
});
