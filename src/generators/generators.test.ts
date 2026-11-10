import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { getBlock } from "../blocks/catalog";
import { ART_STYLES, styleOfBlock, type ArtStyle } from "../blocks/styles";
import { Assembler } from "./assembler";
import { generateModel, generators, getGenerator, runGenerator, settingsForStyle, validateSettings, visibleOptions, type GeneratorSettings } from ".";
import { Rng } from "./rng";
import { readFileSync } from "node:fs";
import { BAKED_ASSETS } from "../blocks/definitions/family/baked.generated.ts";
import { BAKED_SPECS, bakedModels, KART_IDS, WHEEL_RADIUS, type Axle } from "../blocks/definitions/family/baked.ts";
import { STYLE_PREFIX } from "../blocks/styles";
import { decodeBaked, setVehiclePack } from "../blocks/modelPack";
import { buildVehicle, modelsOf, VEHICLE_KINDS } from "./car";
import * as kit from "./kit";
import { buildPerson } from "./person";
import { fitTile, rotateOffset, rotateOpenings, STEPS, TILE_OPENINGS } from "./tiles";
import { contains, insetBlock, isSimple, lotsAlong, planStreets, polygonArea, type Block, type Point, type Street } from "./cityplan";
import { streetPlanSettings } from "./streetCity";

const SEEDS = Array.from({ length: 40 }, (_, index) => index * 7919 + 1);

const STYLES = ART_STYLES.map(({ id }) => id);
const CASES = generators.flatMap((generator) => STYLES.map((style) => [generator.id, style] as const));
const anyOf = (style: ArtStyle): GeneratorSettings => ({ style, options: {} });

describe.each(CASES)("generator %s in the %s style", (id, style) => {
  it("only uses known blocks and valid values", () => {
    for (const seed of SEEDS) {
      const parts = runGenerator(id, seed, anyOf(style));
      expect(parts.length, `seed ${seed}`).toBeGreaterThan(0);
      for (const part of parts) {
        if (!part.block.startsWith("@")) expect(() => getBlock(part.block)).not.toThrow();
        for (const value of [...part.position, ...part.rotation, ...part.scale]) {
          expect(Number.isFinite(value)).toBe(true);
        }
        expect(Math.min(...part.scale)).toBeGreaterThan(0.01);
      }
    }
  });

  it("never mixes in a block of another style", () => {
    for (const seed of SEEDS) {
      for (const part of runGenerator(id, seed, anyOf(style))) {
        expect([style, null], `${part.block}, seed ${seed}`).toContain(styleOfBlock(part.block));
      }
    }
  });

  it("works with every choice of every option", () => {
    for (const option of getGenerator(id).options) {
      for (const choice of option.choices(style)) {
        const settings = { style, options: { [option.id]: choice.id } };
        validateSettings(id, settings);
        // A choice can depend on another one, as the model of a kind of vehicle does.
        const parts = runGenerator(id, 7, settings);
        expect(parts.length, `${option.id}=${choice.id}`).toBeGreaterThan(0);
        for (const part of parts) expect([style, null], `${option.id}=${choice.id}: ${part.block}`).toContain(styleOfBlock(part.block));
      }
    }
  });

  it("builds the same model from the same seed", () => {
    expect(runGenerator(id, 1234, anyOf(style))).toEqual(runGenerator(id, 1234, anyOf(style)));
  });

  it("varies with the seed", () => {
    const outcomes = new Set(SEEDS.map((seed) => JSON.stringify(runGenerator(id, seed, anyOf(style)))));
    expect(outcomes.size).toBeGreaterThan(4);
  });
});


/** Two tires on each side of a dual axle, but only in Realista. */
const tireCount = (axles: Axle[], style: string) => axles.reduce((total, axle) => total + (axle.dual && style === "realistic" ? 4 : 2), 0);

describe("generator settings", () => {
  it("refuses what the generator does not have, and names what it has", () => {
    expect(() => validateSettings("person", { style: "lowpoly", options: { wings: "yes" } })).toThrow(/sex/);
    expect(() => validateSettings("person", { style: "lowpoly", options: { sex: "robot" } })).toThrow(/female/);
    expect(() => validateSettings("person", { style: "cartoon" as ArtStyle, options: {} })).toThrow(/lowpoly/);
  });

  it("drops a choice that does not exist in the new style", () => {
    expect(settingsForStyle("car", "blocks", { kind: "taxi" }).options).toEqual({ kind: "taxi" });
    expect(settingsForStyle("car", "lowpoly", { kind: "tractor" }).options).toEqual({ kind: "tractor" });
    expect(settingsForStyle("car", "arcade", { kind: "tractor" }).options).toEqual({});
  });

  it("hides options that do not apply", () => {
    const ids = (settings: GeneratorSettings) => visibleOptions(getGenerator("person"), settings).map(({ id }) => id);
    expect(ids({ style: "lowpoly", options: { sex: "male", age: "adult" } })).toContain("beard");
    expect(ids({ style: "lowpoly", options: { sex: "female" } })).not.toContain("beard");
    expect(ids({ style: "lowpoly", options: { age: "child" } })).not.toContain("beard");
    expect(ids({ style: "lowpoly", options: { hair: "bald" } })).not.toContain("hairColor");
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

describe.each(STYLES)("person in the %s style", (style) => {
  const build = (seed: number, options: Record<string, string> = {}) => {
    const asm = new Assembler();
    buildPerson(asm, new Rng(seed), { style, ...options });
    return asm;
  };
  const find = (asm: Assembler, name: RegExp) => asm.parts.find((part) => name.test(part.block));
  const topOfHead = (asm: Assembler) => asm.socketOf(find(asm, /\.head_/)!, "top").position.y;
  const blocks = (asm: Assembler) => asm.parts.map((part) => part.block);

  it("stands on the ground with feet level", () => {
    for (const seed of SEEDS) {
      const asm = build(seed);
      const feet = asm.parts.filter((part) => /\.shoe_/.test(part.block));
      expect(feet).toHaveLength(2);
      for (const foot of feet) {
        expect(Math.abs(asm.socketOf(foot, "sole").position.y), `seed ${seed}`).toBeLessThan(0.03);
      }
    }
  });

  it("has a plausible height for each age", () => {
    const ranges: Record<string, [number, number]> = {
      child: [0.95, 1.5],
      teen: [1.45, 1.95],
      adult: [1.55, 2.2],
      elder: [1.5, 2.1],
    };
    for (const seed of SEEDS) {
      for (const [age, [low, high]] of Object.entries(ranges)) {
        const top = topOfHead(build(seed, { age }));
        expect(top, `${age}, seed ${seed}`).toBeGreaterThan(low);
        expect(top, `${age}, seed ${seed}`).toBeLessThan(high);
      }
    }
  });

  it("makes a child much shorter than an adult, with a larger head for the body", () => {
    const adult = build(9, { age: "adult", sex: "male", height: "medium", build: "medium" });
    const child = build(9, { age: "child", sex: "male", height: "medium", build: "medium" });
    expect(topOfHead(child)).toBeLessThan(topOfHead(adult) * 0.8);
    const headShare = (asm: Assembler) => find(asm, /\.head_/)!.scale.x / find(asm, /\.hips/)!.scale.y;
    expect(headShare(child)).toBeGreaterThan(headShare(adult));
  });

  it("gives each side its own hand, thumb forward and palm toward the body", () => {
    for (const seed of SEEDS) {
      const asm = build(seed);
      const left = find(asm, /\.hand$/)!;
      const right = find(asm, /\.hand_right$/)!;
      expect(left.position.x, `seed ${seed}`).toBeGreaterThan(0);
      expect(right.position.x, `seed ${seed}`).toBeLessThan(0);

      const thumbLeft = new THREE.Vector3(1, 0, 0).applyQuaternion(left.quaternion);
      const thumbRight = new THREE.Vector3(-1, 0, 0).applyQuaternion(right.quaternion);
      expect(thumbLeft.z, `seed ${seed}`).toBeGreaterThan(0.8);
      expect(thumbRight.z, `seed ${seed}`).toBeGreaterThan(0.8);

      const palmLeft = new THREE.Vector3(0, 0, 1).applyQuaternion(left.quaternion);
      const palmRight = new THREE.Vector3(0, 0, 1).applyQuaternion(right.quaternion);
      expect(palmLeft.x, `seed ${seed}`).toBeLessThan(-0.8);
      expect(palmRight.x, `seed ${seed}`).toBeGreaterThan(0.8);
    }
  });

  it("gives adult women and men different bodies", () => {
    for (const seed of SEEDS) {
      const woman = blocks(build(seed, { sex: "female", age: "adult" }));
      const man = blocks(build(seed, { sex: "male", age: "adult" }));
      expect(woman.some((block) => /\.hips_f$/.test(block)), `seed ${seed}`).toBe(true);
      expect(woman.some((block) => /\.torso_f_/.test(block)), `seed ${seed}`).toBe(true);
      expect(man.some((block) => /\.hips_f$|\.torso_f_/.test(block)), `seed ${seed}`).toBe(false);
    }
  });

  it("never puts a beard on a woman or a child, or a dress on a man", () => {
    for (const seed of SEEDS) {
      for (const options of [{ sex: "female" }, { age: "child" }, { age: "teen" }] as Record<string, string>[]) {
        expect(blocks(build(seed, { beard: "yes", ...options })).some((block) => /beard/.test(block)), `seed ${seed}`).toBe(false);
      }
      const man = blocks(build(seed, { sex: "male", outfit: "dress" }));
      expect(man.some((block) => /\.skirt$|_dress$/.test(block)), `seed ${seed}`).toBe(false);
    }
  });

  it("makes a person in a dress a woman when the sex was left to chance", () => {
    for (const seed of SEEDS) {
      expect(blocks(build(seed, { outfit: "dress" })).some((block) => /\.skirt$/.test(block)), `seed ${seed}`).toBe(true);
    }
  });

  it("follows the chosen options", () => {
    const has = (options: Record<string, string>, name: RegExp) => blocks(build(5, options)).some((block) => name.test(block));
    expect(has({ glasses: "yes" }, /glasses_/)).toBe(true);
    expect(has({ glasses: "no" }, /glasses_/)).toBe(false);
    expect(has({ hat: "yes" }, /hat_/)).toBe(true);
    expect(has({ hat: "no" }, /hat_/)).toBe(false);
    expect(has({ backpack: "yes" }, /backpack/)).toBe(true);
    expect(has({ hair: "bald", hat: "no" }, /\.(short|side|bob|long|ponytail|bun|afro|curly|spiky|mohawk)$/)).toBe(false);
    expect(has({ hair: "long", hat: "no" }, /\.long$/)).toBe(true);
    expect(has({ sex: "male", age: "adult", beard: "yes" }, /beard_/)).toBe(true);

    const skin = build(5, { skin: "6" }).parts.find((part) => /\.neck$/.test(part.block))!;
    expect(skin.color).toBe("#573622");
  });

  it("keeps everything else when one option changes", () => {
    for (const seed of SEEDS) {
      const base = { sex: "male", hat: "no", outfit: "casual" };
      const adult = build(seed, { ...base, age: "adult", hair: "short" });
      const teen = build(seed, { ...base, age: "teen", hair: "short" });
      const shirt = (asm: Assembler) => find(asm, /\.torso_/)!;
      expect(shirt(teen).block, `seed ${seed}`).toBe(shirt(adult).block);
      expect(shirt(teen).color, `seed ${seed}`).toBe(shirt(adult).color);
      expect(find(teen, /\.neck$/)!.color, `seed ${seed}`).toBe(find(adult, /\.neck$/)!.color);
    }
  });
});

describe("kart-style family", () => {
  const vehicles = readFileSync(new URL("../../public/models/vehicles.bin", import.meta.url));
  setVehiclePack(vehicles.buffer.slice(vehicles.byteOffset, vehicles.byteOffset + vehicles.byteLength) as ArrayBuffer);

  const build = (id: string, seed: number, style: ArtStyle, options: Record<string, string>) =>
    runGenerator(id, seed, { style, options });

  it.each(STYLES)("keeps every wheel of a kart on the ground in the %s style", (style) => {
    for (const body of KART_IDS) {
      const parts = build("car", 3, style, { kind: "kart", model: body, wheels: "slick", spoiler: "asa" });
      const rims = parts.filter((part) => /wheel_slick_rim$/.test(part.block));
      expect(rims, body).toHaveLength(4);
      for (const rim of rims) expect(Math.abs(rim.position[1] - WHEEL_RADIUS * rim.scale[0]), body).toBeLessThan(0.002);
    }
  });

  it("paints each area with its own color", () => {
    const parts = build("car", 3, "arcade", { kind: "kart", model: "flecha", paint: "#e8202a", trim: "#f4f4f4", accent: "#ffc400", rim: "#9aa0a8", suit: "#1e7bff", helmetColor: "#121316", helmet: "integral", wheels: "slick" });
    const colorOf = (name: RegExp) => parts.find((part) => name.test(part.block))?.color;
    expect(colorOf(/kart_flecha_paint$/)).toBe("#e8202a");
    expect(colorOf(/kart_flecha_trim$/)).toBe("#f4f4f4");
    expect(colorOf(/kart_flecha_accent$/)).toBe("#ffc400");
    expect(colorOf(/wheel_slick_rim$/)).toBe("#9aa0a8");
    expect(colorOf(/wheel_slick_band$/)).toBe("#ffc400");
    expect(colorOf(/kart_driver$/)).toBe("#1e7bff");
    expect(colorOf(/kart_helmet_integral_base$/)).toBe("#121316");
  });

  it("can leave out the driver and the wing", () => {
    const parts = build("car", 3, "arcade", { kind: "kart", driver: "no", spoiler: "none" }).map((part) => part.block).join();
    expect(parts).not.toMatch(/kart_driver|kart_helmet|kart_spoiler/);
    expect(parts).toMatch(/kart_steering/);
  });

  const kindOf = (model: string) => VEHICLE_KINDS.find((kind) => modelsOf(kind).includes(model))!;

  it.each(Object.keys(BAKED_SPECS).filter((id) => !["semi", "moto"].includes(BAKED_SPECS[id].group)))("%s has every wheel on the ground, in every style", (model) => {
    const spec = BAKED_SPECS[model];
    for (const style of STYLES) {
      const parts = build("car", 3, style, { kind: kindOf(model), model, wheels: "slick" });
      const rims = parts.filter((part) => /wheel_slick_rim$/.test(part.block));
      expect(rims, style).toHaveLength(tireCount(style === "arcade" ? spec.arcadeAxles! : spec.axles, style));
      for (const rim of rims) expect(Math.abs(rim.position[1] - WHEEL_RADIUS * rim.scale[0]), `${style} ${model}`).toBeLessThan(0.002);
    }
  });

  it.each(bakedModels("moto"))("%s has its own wheels, on the middle line", (model) => {
    const asset = BAKED_ASSETS.find(({ id }) => id === model)!;
    expect(BAKED_SPECS[model].axles).toHaveLength(0);
    expect(build("car", 3, "arcade", { kind: "moto", model }).some((part) => part.block.includes("wheel_"))).toBe(false);
    for (const bake of [asset, asset.lp, asset.vx]) {
      const [offset, vertices, indices] = bake.zones.rubber;
      const tires = decodeBaked({ kind: "baked", offset, vertices, indices, min: bake.min, max: bake.max });
      tires.computeBoundingBox();
      expect(Math.abs(tires.boundingBox!.min.x + tires.boundingBox!.max.x), model).toBeLessThan(0.11);
      tires.dispose();
    }
  });

  it("hitches a trailer to every semi, in every style", () => {
    for (const style of STYLES) {
      for (const model of modelsOf("semi")) {
        const parts = build("car", 3, style, { kind: "semi", model, wheels: "slick" });
        const spec = BAKED_SPECS[model];
        expect(parts.some((part) => /veh_cavalo(_bicudo)?_base$/.test(part.block)), `${style} ${model}`).toBe(true);
        expect(parts.some((part) => part.block.includes(`veh_${spec.trailer}_base`)), `${style} ${model}`).toBe(true);
        const axles = style === "arcade" ? [...spec.arcadeAxles!, ...spec.arcadeTrailerAxles!] : [...spec.axles, ...spec.trailerAxles!];
        expect(parts.filter((part) => /wheel_slick_rim$/.test(part.block)), `${style} ${model}`).toHaveLength(tireCount(axles, style));
      }
    }
  });

  it("has every model in every style", () => {
    for (const asset of BAKED_ASSETS.filter(({ group }) => group !== "part" && group !== "wheel")) {
      const name = asset.group === "kart" ? `kart_${asset.id}` : `veh_${asset.id}`;
      for (const style of STYLES) expect(() => getBlock(`${STYLE_PREFIX[style]}.${name}_base`), `${style} ${asset.id}`).not.toThrow();
    }
  });

  it("offers motorcycles and semis in every style", () => {
    for (const style of STYLES) {
      for (const kind of ["semi", "moto"]) {
        const option = getGenerator("car").options.find(({ id }) => id === "kind")!;
        expect(option.choices(style).map(({ id }) => id), `${style} ${kind}`).toContain(kind);
      }
    }
  });

  it("only offers the models of the chosen kind", () => {
    const option = getGenerator("car").options.find(({ id }) => id === "model")!;
    expect(option.choices("arcade", { kind: "moto" }).map(({ id }) => id)).toEqual(bakedModels("moto"));
    expect(() => validateSettings("car", { style: "arcade", options: { kind: "moto", model: "sedan" } })).toThrow(/moto/);
  });

  it("gives houses and towers their three paints", () => {
    const house = build("house", 3, "arcade", { model: "casinha", paint: "#a8d8c8", trim: "#3a5f8a", accent: "#f4f4f4" });
    expect(house.map((part) => part.color)).toEqual([undefined, "#a8d8c8", "#3a5f8a", "#f4f4f4"].filter((_, i) => i !== 0 || house[0].color === undefined));
    const tower = build("building", 3, "arcade", { size: "low", ground: "loja", floor: "janelas", roof: "plano" });
    const levels = tower.filter((part) => part.block.endsWith("_base"));
    expect(levels[0].block).toBe("ar.torre_terreo_loja_base");
    expect(levels.at(-1)!.block).toBe("ar.torre_topo_plano_base");
    levels.slice(1, -1).forEach((level) => expect(level.block).toBe("ar.torre_andar_janelas_base"));
    levels.forEach((level, index) => {
      if (index > 0) expect(level.position[1]).toBeGreaterThan(levels[index - 1].position[1]);
    });
  });
});

describe("cars", () => {
  const sedan = (yawSteps = 0) => {
    const asm = new Assembler();
    buildVehicle(asm, new Rng(3), { style: "arcade", kind: "car", model: "sedan", wheels: "liga", yawSteps });
    return asm;
  };
  const wheelsOf = (asm: Assembler) => asm.parts.filter((part) => getBlock(part.block).sockets[0].id === "axle");

  it("does not repaint a plain sedan as a taxi when a plain car was asked for", () => {
    for (const seed of SEEDS) {
      const asm = new Assembler();
      buildVehicle(asm, new Rng(seed), { style: "blocks", kind: "car" });
      expect(asm.parts.map((part) => part.block).join(), `seed ${seed}`).not.toMatch(/taxi|siren/);
    }
  });

  it("puts wheels on the outside of each side", () => {
    const asm = sedan();
    expect(wheelsOf(asm)).toHaveLength(4);
    for (const wheel of wheelsOf(asm)) {
      const hub = asm.socketOf(wheel, "hub").position;
      expect(Math.abs(hub.x)).toBeGreaterThan(Math.abs(wheel.position.x));
    }
  });

  it("rotates as a whole", () => {
    const asm = sedan(1);
    expect(asm.socketOf(asm.parts[0], "wheel_0_l").position.x).toBeGreaterThan(1);
    const axisDirection = new THREE.Vector3(0, 1, 0).applyQuaternion(wheelsOf(asm)[0].quaternion);
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

describe("city", () => {
  const road = (style: ArtStyle, options: Record<string, string>) => runGenerator("city", 3, { style, options }).filter((part) => /road[._](straight|crosswalk|curve|t|cross)$|road-(straight|bend|intersection|crossroad|crossing)$/.test(part.block));
  const span = (values: number[]) => Math.max(...values) - Math.min(...values);

  it.each(STYLES)("follows the width, length and lots asked for on a grid in the %s style", (style) => {
    const tiles = road(style, { layout: "grid", width: "5", length: "2", lots: "3", traffic: "no" });
    expect(span(tiles.map((part) => part.position[0]))).toBeCloseTo(5 * 4 * 8, 3);
    expect(span(tiles.map((part) => part.position[2]))).toBeCloseTo(2 * 4 * 8, 3);
  });

  it("keeps the traffic of a large city under control", () => {
    const cars = runGenerator("city", 3, { style: "arcade", options: { width: "8", length: "8", lots: "4" } }).filter((part) => /veh_.*_base$/.test(part.block));
    expect(cars.length).toBeGreaterThan(10);
    expect(cars.length).toBeLessThan(100);
  });

  it("limits the height of the buildings", () => {
    const floors = (height: string) => runGenerator("city", 3, { style: "arcade", options: { width: "4", length: "4", density: "downtown", height, traffic: "no" } }).filter((part) => /torre_andar_.*_base$/.test(part.block)).length;
    expect(floors("low")).toBeLessThan(floors("skyscraper"));
  });

  it("builds nothing without a street in the middle of a large block", () => {
    const lots = runGenerator("city", 3, { style: "arcade", options: { layout: "grid", width: "1", length: "1", lots: "4", traffic: "no" } });
    const grass = lots.filter((part) => part.block === "ar.road_grass");
    expect(grass.some((part) => Math.abs(part.position[0]) < 9 && Math.abs(part.position[2]) < 9)).toBe(true);
  });
});

describe("streets of a city", () => {
  const LAYOUTS = [["irregular", "arcade"], ["organic", "realistic"], ["irregular", "blocks"]] as const;
  const planOf = (seed: number, style: ArtStyle, layout: string, blocksX = 5, blocksZ = 4, lots = 3) => {
    const settings = streetPlanSettings({ style, layout, blocksX, blocksZ, lots });
    return { settings, ...planStreets(new Rng(seed), settings) };
  };
  const pointsOf = (block: Block) => block.map(({ point }) => point);

  it.each(LAYOUTS)("cuts about as many blocks as asked for in the %s layout (%s)", (layout, style) => {
    for (let seed = 1; seed <= 25; seed++) {
      const { blocks, settings } = planOf(seed, style, layout);
      expect(blocks.length, `seed ${seed}`).toBeGreaterThanOrEqual(15);
      expect(blocks.length, `seed ${seed}`).toBeLessThanOrEqual(30);
      for (const block of blocks) expect(polygonArea(pointsOf(block)) / settings.blockArea, `seed ${seed}`).toBeLessThan(3.5);
    }
  });

  it.each(LAYOUTS)("keeps every block a valid shape in the %s layout (%s)", (layout, style) => {
    for (let seed = 1; seed <= 25; seed++) {
      for (const block of planOf(seed, style, layout).blocks) {
        const inner = insetBlock(block, 2);
        expect(polygonArea(inner), `seed ${seed}`).toBeGreaterThan(0);
        expect(isSimple(inner), `seed ${seed}`).toBe(true);
      }
    }
  });

  it("makes blocks of different sizes, not a grid", () => {
    for (const [layout, style] of LAYOUTS) {
      const areas = planOf(4, style, layout).blocks.map((block) => polygonArea(pointsOf(block)));
      expect(Math.max(...areas) / Math.min(...areas), layout).toBeGreaterThan(1.5);
    }
  });

  it("leans and bends streets, but keeps them on the axes for voxels", () => {
    const leaning = (street: Street) => street.points.slice(1).some((point, i) => {
      const dx = Math.abs(point[0] - street.points[i][0]);
      const dz = Math.abs(point[1] - street.points[i][1]);
      return dx > 0.01 && dz > 0.01;
    });
    expect(planOf(4, "arcade", "irregular").streets.filter(leaning).length).toBeGreaterThan(5);
    expect(planOf(4, "realistic", "organic").streets.some((street) => street.points.length > 2)).toBe(true);
    for (let seed = 1; seed <= 10; seed++) expect(planOf(seed, "blocks", "organic").streets.filter(leaning), `seed ${seed}`).toHaveLength(0);
  });

  it("has T junctions and, across seeds, crossings where two streets line up", () => {
    let crossings = 0;
    for (let seed = 1; seed <= 12; seed++) {
      const { streets } = planOf(seed, "arcade", "irregular");
      expect(streets.some((street) => street.joins.length > 0), `seed ${seed}`).toBe(true);
      for (const street of streets) crossings += street.joins.filter((a, i) => street.joins.some((b, j) => i !== j && Math.abs(a.at - b.at) < 0.01)).length;
    }
    expect(crossings).toBeGreaterThan(0);
  });

  it.each(STYLES)("fits one shape with no broken faces even at the largest size in the %s style", (style) => {
    for (const layout of ["irregular", "organic"]) {
      const { shapes, parts } = generateModel("city", 11, { style, options: { layout, width: "8", length: "8", lots: "4", traffic: "no" } });
      expect(shapes).toHaveLength(1);
      expect(shapes[0].vertices.length, layout).toBeLessThanOrEqual(20000);
      expect(shapes[0].faces.length, layout).toBeLessThanOrEqual(20000);
      expect(shapes[0].faceMaterials).toHaveLength(shapes[0].faces.length);
      for (const face of shapes[0].faces) {
        expect(new Set(face).size, layout).toBe(face.length);
        expect(face.length).toBeLessThanOrEqual(256);
      }
      expect(parts.filter((part) => part.block === "@0")).toHaveLength(1);
    }
  });

  it("gets its size from the width and length", () => {
    const { vertices } = generateModel("city", 3, { style: "arcade", options: { layout: "irregular", width: "5", length: "2", lots: "3", traffic: "no" } }).shapes[0];
    const span = (axis: 0 | 2) => Math.max(...vertices.map((v) => v[axis])) - Math.min(...vertices.map((v) => v[axis]));
    const pitch = 3 * 9 + 12;
    expect(span(0) / (5 * pitch)).toBeGreaterThan(0.85);
    expect(span(0) / (5 * pitch)).toBeLessThan(1.15);
    expect(span(2) / (2 * pitch)).toBeGreaterThan(0.85);
    expect(span(2) / (2 * pitch)).toBeLessThan(1.25);
  });

  it("always builds the same city from the same seed", () => {
    const build = () => generateModel("city", 42, { style: "lowpoly", options: { width: "3", length: "3" } });
    expect(build()).toEqual(build());
  });

  it("lines lots up without overlaps and inside their block", () => {
    for (let seed = 1; seed <= 15; seed++) {
      for (const block of planOf(seed, "arcade", "organic").blocks) {
        const inner = insetBlock(block, 2);
        const limit = insetBlock(block, 0.8);
        const lots = lotsAlong(inner, limit, new Rng(seed), 7.7, 7.7);
        lots.forEach((lot, i) => {
          for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
            const corner: Point = [
              lot.center[0] + (lot.along[0] * u * 7.7) / 2 + (lot.back[0] * v * 7.7) / 2,
              lot.center[1] + (lot.along[1] * u * 7.7) / 2 + (lot.back[1] * v * 7.7) / 2,
            ];
            expect(contains(limit, corner), `seed ${seed}`).toBe(true);
          }
          for (const other of lots.slice(i + 1)) expect(Math.hypot(lot.center[0] - other.center[0], lot.center[1] - other.center[1]), `seed ${seed}`).toBeGreaterThan(7.6);
        });
      }
    }
  });

  it("turns a whole group of parts together", () => {
    const asm = new Assembler();
    asm.add("nature.oak", [0, 0, 0]);
    const start = asm.parts.length;
    asm.add("nature.oak", [0, 0, 2]);
    asm.place(start, [10, 1, 0], Math.PI / 2);
    const [still, moved] = asm.result();
    expect(still.position).toEqual([0, 0, 0]);
    expect(moved.position[0]).toBeCloseTo(12, 6);
    expect(moved.position[1]).toBeCloseTo(1, 6);
    expect(moved.position[2]).toBeCloseTo(0, 6);
  });
});

describe("map", () => {
  const model = (seed: number, style: ArtStyle, options: Record<string, string> = {}) => generateModel("map", seed, { style, options });
  const biomes = getGenerator("map").options.find(({ id }) => id === "biome")!.choices("lowpoly").map(({ id }) => id);

  it.each(STYLES)("fits the limits of a shape even at the largest size in the %s style", (style) => {
    for (const biome of biomes) {
      const { shapes } = model(9, style, { biome, width: "500", length: "500", vegetation: "none" });
      expect(shapes).toHaveLength(1);
      expect(shapes[0].vertices.length, biome).toBeLessThanOrEqual(20000);
      expect(shapes[0].faces.length, biome).toBeLessThanOrEqual(20000);
      expect(shapes[0].faceMaterials).toHaveLength(shapes[0].faces.length);
      for (const face of shapes[0].faces) expect(new Set(face).size, biome).toBe(face.length);
    }
  });

  it.each(STYLES)("has only nature on it in the %s style", (style) => {
    for (const biome of biomes) {
      for (const part of model(9, style, { biome, vegetation: "dense" }).parts) {
        expect(part.block, biome).not.toMatch(/house|casa|torre|building|road|veh_/);
      }
    }
  });

  it.each(STYLES)("follows the width and length asked for in the %s style", (style) => {
    const { vertices } = model(3, style, { width: "300", length: "100", vegetation: "none" }).shapes[0];
    const span = (axis: 0 | 2) => Math.max(...vertices.map((v) => v[axis])) - Math.min(...vertices.map((v) => v[axis]));
    expect(span(0)).toBeCloseTo(300, 3);
    expect(span(2)).toBeCloseTo(100, 3);
  });

  it("paints smooth ground vertex by vertex, and keeps flat faces in the other styles", () => {
    for (const style of ["realistic", "arcade"] as const) {
      const { vertices, vertexColors, materials } = model(3, style, { vegetation: "none" }).shapes[0];
      expect(vertexColors, style).toHaveLength(vertices.length);
      expect(new Set(vertexColors).size, style).toBeGreaterThan(50);
      expect(materials[0].painted, style).toBe(true);
    }
    for (const style of ["lowpoly", "blocks"] as const) expect(model(3, style, { vegetation: "none" }).shapes[0].vertexColors, style).toBeUndefined();
  });

  it("rests on the floor of the scene", () => {
    for (const style of STYLES) {
      const { vertices } = model(3, style, { vegetation: "none" }).shapes[0];
      expect(Math.min(...vertices.map((v) => v[1]))).toBeCloseTo(0, 5);
    }
  });

  it("turns every face outward", () => {
    for (const style of STYLES) {
      const { vertices, faces } = model(3, style, { vegetation: "none", width: "50", length: "50" }).shapes[0];
      let volume = 0;
      for (const face of faces) {
        for (let i = 1; i < face.length - 1; i++) {
          const a = new THREE.Vector3(...vertices[face[0]]);
          const b = new THREE.Vector3(...vertices[face[i]]);
          const c = new THREE.Vector3(...vertices[face[i + 1]]);
          volume += a.dot(b.cross(c)) / 6;
        }
      }
      expect(volume, style).toBeGreaterThan(0);
    }
  });

  it("makes more relief when asked and keeps water out when asked", () => {
    const top = (options: Record<string, string>) => Math.max(...model(4, "realistic", { biome: "montanhas", vegetation: "none", ...options }).shapes[0].vertices.map((v) => v[1]));
    expect(top({ relief: "rough" })).toBeGreaterThan(top({ relief: "soft" }));
    const usesWater = (water: string) => {
      const { faceMaterials, materials } = model(4, "realistic", { biome: "floresta", vegetation: "none", water }).shapes[0];
      const blue = materials.findIndex((material) => material.finish === "gloss");
      return faceMaterials.includes(blue);
    };
    expect(usesWater("all")).toBe(true);
    expect(usesWater("none")).toBe(false);
  });

  it("grows more trees with denser vegetation", () => {
    const trees = (vegetation: string) => model(5, "lowpoly", { biome: "floresta", vegetation, width: "200", length: "200" }).parts.filter((part) => /tree_/.test(part.block)).length;
    expect(trees("none")).toBe(0);
    expect(trees("low")).toBeGreaterThan(0);
    expect(trees("dense")).toBeGreaterThan(trees("low"));
  });

  it("puts the plants on the ground", () => {
    for (const style of STYLES) {
      const { parts } = model(6, style, { biome: "floresta", relief: "medium" });
      for (const part of parts.slice(1)) expect(part.position[1], part.block).toBeGreaterThan(0);
    }
  });
});
