import { describe, expect, it } from "vitest";
import type { Command, CustomShape, EditorSnapshot, Part, PartId } from "../core/types";
import { callTool, listTools, toolActivity, type ToolDeps, type ToolResult } from "./tools";

function part(id: number, overrides: Partial<Part> = {}): Part {
  return {
    id,
    block: "basic.cube",
    position: [0, 0.25, 0],
    rotation: [0, 0, 0, 1],
    scale: [1, 1, 1],
    color: "#ff0000",
    ...overrides,
  };
}

function fake(parts: Part[] = []) {
  const applied: Command[] = [];
  const saved: { name: string; size: number }[] = [];
  const captures: unknown[][] = [];
  const snapshot: EditorSnapshot = {
    project: { name: "Teste", parts, nextId: 100, nextGroup: 1, shapes: [], nextShape: 1 },
    canUndo: false,
    canRedo: false,
    revision: 1,
    dirty: false,
    path: null,
  };
  const deps: ToolDeps = {
    getState: () => Promise.resolve(snapshot),
    apply(command) {
      applied.push(command);
      return Promise.resolve([100]);
    },
    undo: () => Promise.resolve(),
    redo: () => Promise.resolve(),
    generate: () => Promise.resolve([1, 2] as PartId[]),
    capture(...args) {
      captures.push(args);
      return Promise.resolve("QUJD");
    },
    frame: () => Promise.resolve(),
    exportGlb: () => Promise.resolve(new ArrayBuffer(10)),
    saveExport(name, bytes) {
      saved.push({ name, size: bytes.length });
      return Promise.resolve("C:/x.glb");
    },
  };
  return { deps, applied, saved, captures };
}

function json(result: ToolResult): any {
  expect(result.isError).toBeUndefined();
  const [first] = result.content;
  if (first.type !== "text") throw new Error("expected text");
  return JSON.parse(first.text);
}

function errorOf(result: ToolResult): string {
  expect(result.isError).toBe(true);
  const [first] = result.content;
  return first.type === "text" ? first.text : "";
}

describe("tool list", () => {
  it("describes every tool with a schema", () => {
    const { tools } = listTools();
    expect(tools.length).toBeGreaterThan(10);
    expect(new Set(tools.map((tool) => tool.name)).size).toBe(tools.length);
    for (const tool of tools) {
      expect(tool.description.length).toBeGreaterThan(10);
      expect((tool.inputSchema as { type: string }).type).toBe("object");
    }
  });

  it("marks reading tools as read-only and changing tools as not", () => {
    const annotations = new Map(listTools().tools.map((tool) => [tool.name, tool.annotations]));
    expect(annotations.get("get_scene")!.readOnlyHint).toBe(true);
    expect(annotations.get("remove_parts")!.readOnlyHint).toBe(false);
  });

  it("only announces tools that change the scene", () => {
    expect(toolActivity("add_parts")).toBeDefined();
    expect(toolActivity("get_scene")).toBeUndefined();
  });
});

describe("failures", () => {
  it("reports unknown tools as a tool error", async () => {
    expect(errorOf(await callTool("nada", {}, fake().deps))).toContain("nada");
  });

  it("passes on what the editor refused", async () => {
    const { deps } = fake();
    deps.apply = () => Promise.reject("peça não encontrada: 9");
    const result = await callTool("remove_parts", { ids: [9] }, deps);
    expect(errorOf(result)).toBe("peça não encontrada: 9");
  });

  it.each([
    ["add_parts", { parts: "cubo" }],
    ["add_parts", { parts: [{ block: "basic.cube", position: [1, 2] }] }],
    ["add_parts", { parts: [{ block: "nope", position: [0, 0, 0] }] }],
    ["remove_parts", { ids: [] }],
    ["remove_parts", { ids: ["a"] }],
    ["update_parts", { updates: [{ position: [0, 0, 0] }] }],
    ["capture_view", { views: ["debaixo"] }],
    ["generate", { generator: "nada" }],
    ["generate", { generator: "person", style: "desenho" }],
    ["generate", { generator: "person", options: { asas: "sim" } }],
    ["generate", { generator: "person", options: { sex: "robo" } }],
    ["generate", { generator: "car", style: "arcade", options: { kind: "tractor" } }],
  ])("rejects bad arguments to %s", async (name, args) => {
    const { deps, applied } = fake();
    errorOf(await callTool(name, args, deps));
    expect(applied).toHaveLength(0);
  });
});

describe("generating", () => {
  const withGenerate = (parts: Part[] = []) => {
    const made = fake(parts);
    const calls: unknown[][] = [];
    made.deps.generate = (...args) => {
      calls.push(args);
      return Promise.resolve([1]);
    };
    return { ...made, calls };
  };

  it("passes the style and options on", async () => {
    const { deps, calls } = withGenerate();
    const result = json(await callTool("generate", { generator: "person", style: "blocks", options: { sex: "female", age: "child" }, seed: 5 }, deps));
    expect(result.style).toBe("blocks");
    expect(calls[0]).toEqual(["person", 5, true, { style: "blocks", options: { sex: "female", age: "child" } }]);
  });

  it("starts in low poly and then follows the scene", async () => {
    const empty = withGenerate();
    expect(json(await callTool("generate", { generator: "tree" }, empty.deps)).style).toBe("lowpoly");
    const scene = withGenerate([part(1, { block: "vx.oak" })]);
    expect(json(await callTool("generate", { generator: "tree" }, scene.deps)).style).toBe("blocks");
  });

  it("refuses to mix styles, and explains how to proceed", async () => {
    const { deps, calls } = withGenerate([part(1, { block: "vx.oak" })]);
    expect(errorOf(await callTool("generate", { generator: "tree", style: "realistic" }, deps))).toMatch(/keep false/);
    expect(calls).toHaveLength(0);
  });

  it("allows another style when it replaces the scene", async () => {
    const { deps } = withGenerate([part(1, { block: "vx.oak" })]);
    expect(json(await callTool("generate", { generator: "tree", style: "realistic", keep: false }, deps)).style).toBe("realistic");
  });

  it("does not count plain shapes as a style", async () => {
    const { deps } = withGenerate([part(1, { block: "basic.cube" })]);
    expect(json(await callTool("generate", { generator: "tree", style: "realistic" }, deps)).style).toBe("realistic");
  });

  it("tells which models each kind of vehicle has", () => {
    const tool = listTools().tools.find(({ name }) => name === "generate")!;
    expect(tool.description).toMatch(/moto=moto_/);
  });

  it("filters the catalog by style", async () => {
    const found = json(await callTool("search_blocks", { query: "mao", style: "blocks" }, fake().deps));
    expect(found.total).toBeGreaterThan(0);
    for (const block of found.blocks) expect(block.style).toBe("blocks");
  });
});

describe("reading", () => {
  it("shows rotations in degrees and measures the scene", async () => {
    const turned = part(1, { rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], position: [2, 0.25, 0] });
    const scene = json(await callTool("get_scene", {}, fake([turned]).deps));
    expect(scene.partCount).toBe(1);
    expect(scene.parts[0].rotation[1]).toBeCloseTo(90, 2);
    expect(scene.bounds.min[0]).toBeCloseTo(1.75, 3);
    expect(scene.bounds.max[0]).toBeCloseTo(2.25, 3);
  });

  it("has no bounds for an empty scene", async () => {
    expect(json(await callTool("get_scene", {}, fake().deps)).bounds).toBeNull();
  });

  it("finds blocks ignoring accents and lists categories only without a filter", async () => {
    const { deps } = fake();
    const accented = json(await callTool("search_blocks", { query: "cabeça" }, deps));
    const plain = json(await callTool("search_blocks", { query: "CABECA" }, deps));
    expect(accented.total).toBeGreaterThan(0);
    expect(plain.total).toBe(accented.total);
    expect(accented.categories).toBeUndefined();
    expect(json(await callTool("search_blocks", {}, deps)).categories.length).toBeGreaterThan(5);
  });

  it("returns a block's size and sockets", async () => {
    const block = json(await callTool("get_block", { id: "basic.cube" }, fake().deps));
    expect(block.size).toEqual([0.5, 0.5, 0.5]);
    expect(block.sockets.length).toBeGreaterThan(1);
  });

  it("places a part's sockets in the world", async () => {
    const moved = part(1, { position: [5, 0.25, 0] });
    const found = json(await callTool("get_part", { id: 1 }, fake([moved]).deps));
    const top = found.sockets.find((socket: { normal: number[] }) => socket.normal[1] === 1);
    expect(top.position).toEqual([5, 0.5, 0]);
  });
});

describe("placing", () => {
  it("converts degrees and fills in what's missing", async () => {
    const { deps, applied } = fake();
    await callTool("add_parts", { parts: [{ block: "basic.cube", position: [1, 2, 3], rotation: [0, 180, 0] }] }, deps);
    const command = applied[0] as Extract<Command, { type: "addParts" }>;
    expect(command.replace).toBe(false);
    expect(Math.abs(command.parts[0].rotation![1])).toBeCloseTo(1, 5);
    expect(command.parts[0].scale).toEqual([1, 1, 1]);
  });

  it("rests a block on the ground, whatever its size", async () => {
    const { deps, applied } = fake();
    await callTool("add_parts", { parts: [{ block: "basic.cube", position: [0, 9, 0], scale: [1, 4, 1], onGround: true }] }, deps);
    const command = applied[0] as Extract<Command, { type: "addParts" }>;
    expect(command.parts[0].position[1]).toBeCloseTo(1, 5);
  });

  it("attaches on top of a part, touching its socket", async () => {
    const { deps, applied } = fake([part(1)]);
    const { sockets: parentSockets } = json(await callTool("get_part", { id: 1 }, deps));
    const top = parentSockets.find((socket: { normal: number[] }) => socket.normal[1] === 1);

    const attached = json(
      await callTool("attach_part", { block: "basic.cube", parentId: 1, parentSocket: top.id }, deps),
    );
    expect(attached.id).toBe(100);
    expect(attached.position[1]).toBeCloseTo(0.75, 4);
    expect(applied[0]).toMatchObject({ type: "addPart", block: "basic.cube" });
  });

  it("names the available sockets when one doesn't exist", async () => {
    const result = await callTool("attach_part", { block: "basic.cube", parentId: 1, parentSocket: "nada" }, fake([part(1)]).deps);
    expect(errorOf(result)).toContain("Encaixes:");
  });

  it("moves parts by an offset as one command", async () => {
    const { deps, applied } = fake([part(1), part(2, { position: [1, 1, 1] })]);
    await callTool("move_parts", { ids: [1, 2], offset: [1, 0, -1] }, deps);
    expect(applied).toEqual([
      {
        type: "updateParts",
        updates: [
          { id: 1, position: [1, 0.25, -1] },
          { id: 2, position: [2, 1, 0] },
        ],
      },
    ]);
  });

  it("clears the scene with an undoable command", async () => {
    const { deps, applied } = fake([part(1)]);
    await callTool("clear_scene", {}, deps);
    expect(applied).toEqual([{ type: "addParts", parts: [], replace: true }]);
  });
});

// Like the editor's, it only goes up, including from one test to the next.
let revision = 1;

/** A stand-in that really keeps shapes, the way the editor does. */
function modelingFake(parts: Part[] = []) {
  const made = fake(parts);
  revision++;
  let nextShape = 1;
  const shapes: CustomShape[] = [];
  const state = () => ({
    project: { name: "Teste", parts, nextId: 100, nextGroup: 1, shapes: [...shapes], nextShape },
    canUndo: false,
    canRedo: false,
    revision,
    dirty: false,
    path: null,
  });
  made.deps.getState = () => Promise.resolve(state());
  made.deps.apply = (command) => {
    made.applied.push(command);
    revision++;
    if (command.type === "addShape") {
      const number = nextShape++;
      shapes.push({ ...command.shape, id: `shape.${number}` });
      return Promise.resolve([number, ...(command.parts ?? []).map((_, index) => 500 + index)]);
    }
    if (command.type === "updateShape") {
      shapes[shapes.findIndex((shape) => shape.id === command.shape.id)] = command.shape;
    }
    if (command.type === "removeShape") {
      shapes.splice(shapes.findIndex((shape) => shape.id === command.id), 1);
      return Promise.resolve([7]);
    }
    return Promise.resolve([]);
  };
  return { ...made, shapes };
}

describe("creating shapes", () => {
  const sword = {
    name: "Espada",
    color: "#884422",
    pieces: [
      { type: "extrude", outline: [[-0.05, 0], [0.05, 0], [0, 1]], depth: 0.02, at: [0, 0.2, 0], color: "#cccccc", finish: "metal" },
      { type: "cylinder", radius: 0.03, height: 0.2, at: [0, 0.1, 0] },
    ],
  };

  it("makes new geometry and rests it on the floor", async () => {
    const { deps, applied } = modelingFake();
    const result = json(await callTool("create_shape", sword, deps));
    expect(result.id).toBe("shape.1");
    expect(result.partId).toBe(500);
    expect(result.materials).toEqual([{}, { color: "#cccccc", finish: "metal" }]);
    expect(result.bounds.size[1]).toBeCloseTo(1.2, 4);
    expect(result.sockets[0].id).toBe("base");

    const command = applied[0] as Extract<Command, { type: "addShape" }>;
    expect(command.parts![0].position[1]).toBeCloseTo(0, 5);
  });

  it("refines a shape in the same call, as one step", async () => {
    const { deps, applied } = modelingFake();
    const result = json(
      await callTool(
        "create_shape",
        {
          name: "Torre",
          pieces: [{ type: "box", size: [1, 1, 1] }],
          operations: [
            { op: "extrude", faces: { normal: [0, 1, 0] }, distance: 1 },
            { op: "scale", vertices: { faces: { last: "caps" } }, factor: 0.5 },
          ],
        },
        deps,
      ),
    );
    expect(applied).toHaveLength(1);
    expect(result.faces).toBe(10);
    expect(result.bounds.size[1]).toBeCloseTo(2, 5);
  });

  it("can create without placing", async () => {
    const { deps, applied } = modelingFake();
    const result = json(await callTool("create_shape", { ...sword, place: false }, deps));
    expect(result.partId).toBeUndefined();
    expect((applied[0] as Extract<Command, { type: "addShape" }>).parts).toEqual([]);
  });

  it("makes a shape usable as a block right away", async () => {
    const { deps, applied } = modelingFake();
    const { id } = json(await callTool("create_shape", { ...sword, place: false }, deps));
    await callTool("add_parts", { parts: [{ block: id, position: [0, 9, 0], onGround: true }] }, deps);
    const command = applied[1] as Extract<Command, { type: "addParts" }>;
    expect(command.parts[0].block).toBe(id);
    expect(command.parts[0].position[1]).toBeCloseTo(0, 4);

    const found = json(await callTool("search_blocks", { query: "espada" }, deps));
    expect(found.blocks[0].id).toBe(id);
    expect(json(await callTool("get_block", { id }, deps)).triangles).toBeGreaterThan(0);
  });

  it("attaches other parts to the sockets of a new shape", async () => {
    const { deps } = modelingFake([part(1, { block: "shape.1" })]);
    await callTool("create_shape", { name: "Base", pieces: [{ type: "box", size: [2, 2, 2] }], place: false }, deps);
    const attached = json(await callTool("attach_part", { block: "basic.cube", parentId: 1, parentSocket: "topo" }, deps));
    expect(attached.position[1]).toBeCloseTo(1.5, 3);
  });

  it("edits a shape and reports the new faces", async () => {
    const { deps, applied } = modelingFake();
    await callTool("create_shape", { name: "A", pieces: [{ type: "box" }] }, deps);
    const result = json(
      await callTool("edit_shape", { id: "shape.1", operations: [{ op: "extrude", faces: { normal: [0, 1, 0] }, distance: 1 }] }, deps),
    );
    expect(result.faces).toBe(10);
    expect(result.lastCaps).toHaveLength(1);
    expect(result.lastSides).toHaveLength(4);
    expect(applied.map((command) => command.type)).toEqual(["addShape", "updateShape"]);
  });

  it("says which step failed and changes nothing", async () => {
    const { deps, applied } = modelingFake();
    await callTool("create_shape", { name: "A", pieces: [{ type: "box" }] }, deps);
    const message = errorOf(
      await callTool(
        "edit_shape",
        {
          id: "shape.1",
          operations: [
            { op: "extrude", faces: "all", distance: 1 },
            { op: "inset", faces: { ids: [999] }, amount: 0.1 },
          ],
        },
        deps,
      ),
    );
    expect(message).toContain("operação 2 (inset)");
    expect(applied).toHaveLength(1);
  });

  it("lists geometry for choosing what to edit", async () => {
    const { deps } = modelingFake();
    await callTool("create_shape", { name: "A", pieces: [{ type: "box" }] }, deps);
    const brief = json(await callTool("get_shape", { id: "shape.1" }, deps));
    expect(brief.faceList).toBeUndefined();
    const full = json(await callTool("get_shape", { id: "shape.1", includeGeometry: true }, deps));
    expect(full.vertexList).toHaveLength(8);
    expect(full.faceList).toHaveLength(6);
    expect(full.faceList[0].normal).toHaveLength(3);
  });

  it("copies, renames and deletes shapes", async () => {
    const { deps, shapes } = modelingFake();
    await callTool("create_shape", { name: "A", pieces: [{ type: "box" }] }, deps);
    const copy = json(await callTool("duplicate_shape", { id: "shape.1" }, deps));
    expect(copy).toMatchObject({ id: "shape.2", name: "A (cópia)" });
    expect(json(await callTool("update_shape", { id: "shape.1", name: "B", smoothAngle: 180 }, deps))).toMatchObject({ name: "B", smoothAngle: 180 });
    expect(json(await callTool("list_shapes", {}, deps)).shapes).toHaveLength(2);
    expect(json(await callTool("delete_shape", { id: "shape.2" }, deps)).removedParts).toEqual([7]);
    expect(shapes).toHaveLength(1);
  });

  it("makes ready-made parts editable, replacing them", async () => {
    const { deps, applied } = modelingFake([part(1, { position: [2, 0.25, 0] })]);
    const result = json(await callTool("convert_to_shape", { ids: [1] }, deps));
    expect(result.faces).toBe(6);
    expect(applied[0]).toMatchObject({ type: "addShape", removeParts: [1] });
    expect((applied[0] as Extract<Command, { type: "addShape" }>).parts![0].position).toEqual([2, 0.25, 0]);
  });

  it.each([
    ["create_shape", { name: "A" }],
    ["create_shape", { name: "A", pieces: [{ type: "nave" }] }],
    ["create_shape", { pieces: [{ type: "box" }] }],
    ["edit_shape", { id: "shape.9", operations: [{ op: "round" }] }],
    ["get_shape", { id: "shape.9" }],
    ["convert_to_shape", { ids: [9] }],
  ])("rejects bad arguments to %s", async (name, args) => {
    const { deps, applied } = modelingFake();
    errorOf(await callTool(name, args, deps));
    expect(applied).toHaveLength(0);
  });
});

describe("seeing and exporting", () => {
  it("returns one labeled picture per view", async () => {
    const { deps, captures } = fake([part(1)]);
    const result = await callTool("capture_view", { views: ["front", "top"], width: 99999 }, deps);
    expect(result.content.map((item) => item.type)).toEqual(["text", "image", "text", "image"]);
    expect(captures[0]).toEqual(["front", 1600, 720, undefined]);
  });

  it("exports only the requested parts, under the requested name", async () => {
    const { deps, saved } = fake([part(1), part(2)]);
    const result = json(await callTool("export_glb", { ids: [2], name: "robô" }, deps));
    expect(result.parts).toBe(1);
    expect(result.path).toBe("C:/x.glb");
    expect(saved).toEqual([{ name: "robô", size: 10 }]);
  });

  it("refuses to export nothing", async () => {
    expect(errorOf(await callTool("export_glb", {}, fake().deps))).toContain("não há peças");
  });
});
