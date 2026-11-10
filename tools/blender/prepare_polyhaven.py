"""
Assets Studio Maker -- turns Poly Haven glTF models into light game assets (Blender 5.1).

    blender -b --factory-startup --python tools/blender/prepare_polyhaven.py -- <downloads> <out> [ids...]

<downloads> has one folder per model, as the Poly Haven API serves the 1k glTF. Each model is
reduced to a few thousand triangles and its textures become one color per triangle corner,
because the editor draws vertex colors only. The result, <out>/<id>.tris, is read by
scripts/import-interior.ts:

    uint32 triangles, then per corner 9 float32 (x y z, normal, sRGB color) with Y up,
    then one byte per triangle: 0 matte, 1 metal, 2 glass.
"""

import json
import os
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix

argv = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = argv[0], argv[1]
ONLY = set(argv[2:])

# Most furniture reads well with about two thousand triangles; small things need far fewer.
BUDGET_LARGE = 2600
BUDGET = 1800
BUDGET_SMALL = 700
# Pieces a room repeats many times, like shop shelves, get a smaller budget of their own.
BUDGETS = {"steel_frame_shelves_01": 900}
SMOOTH_ANGLE = 38.0
# Corners are sampled a little inside the triangle, so a corner on a seam keeps its own side.
INSET = 0.15

MATTE, METAL, GLASS = 0, 1, 2


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


images = {}


def pixels(path):
    """The image as an array of rows from the bottom, the way Blender's UVs address it."""
    if path not in images:
        image = bpy.data.images.load(path, check_existing=True)
        w, h = image.size
        data = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(data)
        images[path] = data.reshape(h, w, 4)
    return images[path]


def sample(image, uv):
    h, w = image.shape[:2]
    u = np.mod(uv[:, 0], 1.0)
    v = np.mod(uv[:, 1], 1.0)
    x = np.minimum((u * w).astype(int), w - 1)
    y = np.minimum((v * h).astype(int), h - 1)
    return image[y, x]


def material_table(gltf_path):
    """Base color factor, base color image and metal/roughness image of each glTF material."""
    gltf = json.load(open(gltf_path, encoding="utf-8"))
    folder = os.path.dirname(gltf_path)

    def image_of(texture):
        if texture is None:
            return None
        source = gltf["textures"][texture["index"]]["source"]
        return os.path.join(folder, gltf["images"][source]["uri"].replace("%20", " "))

    table = {}
    for material in gltf.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        glass = material.get("alphaMode") == "BLEND" or "KHR_materials_transmission" in material.get("extensions", {})
        table[material.get("name", "")] = {
            "factor": np.array(pbr.get("baseColorFactor", [1, 1, 1, 1])[:3], dtype=np.float32),
            "color": image_of(pbr.get("baseColorTexture")),
            "arm": image_of(pbr.get("metallicRoughnessTexture")),
            "metallic": pbr.get("metallicFactor", 1.0),
            "glass": glass,
        }
    return table


def budget_for(info, size):
    if info["id"] in BUDGETS:
        return BUDGETS[info["id"]]
    if max(size) < 0.45:
        return BUDGET_SMALL
    cats = set(info.get("categories", []))
    if cats & {"seating", "bed"} or max(size) > 1.6:
        return BUDGET_LARGE
    return BUDGET


def prepare(folder, out_path):
    info = json.load(open(os.path.join(folder, "info.json"), encoding="utf-8"))
    gltf_path = next(os.path.join(folder, name) for name in os.listdir(folder) if name.endswith(".gltf"))
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=gltf_path)
    table = material_table(gltf_path)

    # Baked into the vertices and detached from their parents, so a scaled parent can't be lost.
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        world = o.matrix_world.copy()
        o.parent = None
        o.data = o.data.copy()
        o.data.transform(world)
        o.matrix_world = Matrix.Identity(4)
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active
    obj.data.transform(obj.matrix_world)
    obj.matrix_world = Matrix.Identity(4)

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()

    dims = obj.dimensions
    budget = budget_for(info, dims)
    triangles = len(obj.data.polygons)
    if triangles > budget:
        mod = obj.modifiers.new("reduce", "DECIMATE")
        mod.decimate_type = "COLLAPSE"
        mod.ratio = budget / triangles
        mod.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.shade_smooth_by_angle(angle=np.radians(SMOOTH_ANGLE))
    mesh = obj.data
    mesh.calc_loop_triangles()

    tris = mesh.loop_triangles
    count = len(tris)
    loops = np.empty(count * 3, dtype=np.int64)
    tris.foreach_get("loops", loops)
    mats = np.empty(count, dtype=np.int64)
    tris.foreach_get("material_index", mats)

    vert_of_loop = np.empty(len(mesh.loops), dtype=np.int64)
    mesh.loops.foreach_get("vertex_index", vert_of_loop)
    co = np.empty(len(mesh.vertices) * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    normals = np.empty(len(mesh.loops) * 3, dtype=np.float32)
    mesh.corner_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    uv_layer = mesh.uv_layers.active
    if uv_layer is not None:
        uvs = np.empty(len(mesh.loops) * 2, dtype=np.float32)
        uv_layer.data.foreach_get("uv", uvs)
        uvs = uvs.reshape(-1, 2)
    else:
        uvs = np.zeros((len(mesh.loops), 2), dtype=np.float32)

    p = co[vert_of_loop[loops]].reshape(count, 3, 3)
    n = normals[loops].reshape(count, 3, 3)
    uv = uvs[loops].reshape(count, 3, 2)
    inset = uv + (uv.mean(axis=1, keepdims=True) - uv) * INSET

    color = np.ones((count, 3, 3), dtype=np.float32)
    finish = np.zeros(count, dtype=np.uint8)
    for index, slot in enumerate(obj.material_slots):
        chosen = mats == index
        if not chosen.any():
            continue
        name = slot.material.name if slot.material else ""
        entry = table.get(name) or table.get(name.rsplit(".", 1)[0])
        if entry is None:
            continue
        corner_uv = inset[chosen].reshape(-1, 2)
        linear = np.tile(entry["factor"], (corner_uv.shape[0], 1))
        if entry["color"]:
            linear = linear * srgb_to_linear(sample(pixels(entry["color"]), corner_uv)[:, :3])
        color[chosen] = linear_to_srgb(linear).reshape(-1, 3, 3)
        if entry["glass"]:
            finish[chosen] = GLASS
        elif entry["arm"] and entry["metallic"] > 0:
            # Poly Haven packs ambient occlusion, roughness and metalness in one image (blue is metal).
            metal = sample(pixels(entry["arm"]), uv[chosen].mean(axis=1))[:, 2] * entry["metallic"]
            finish[np.flatnonzero(chosen)[metal > 0.5]] = METAL
        elif entry["metallic"] > 0.5:
            finish[chosen] = METAL

    # Blender is Z up and the editor Y up: (x, y, z) -> (x, z, -y).
    def y_up(a):
        return np.stack([a[..., 0], a[..., 2], -a[..., 1]], axis=-1)

    corners = np.concatenate([y_up(p), y_up(n), color], axis=-1).astype(np.float32)
    with open(out_path, "wb") as f:
        f.write(struct.pack("<I", count))
        f.write(corners.tobytes())
        f.write(finish.tobytes())
    size = [round(v, 2) for v in (dims.x, dims.z, dims.y)]
    print(f"{info['id']}: {triangles} -> {count} triângulos, {size} m, metal {int((finish == METAL).sum())}, vidro {int((finish == GLASS).sum())}", flush=True)


os.makedirs(OUT, exist_ok=True)
for name in sorted(os.listdir(SOURCE)):
    folder = os.path.join(SOURCE, name)
    if not os.path.isfile(os.path.join(folder, "done")) or (ONLY and name not in ONLY):
        continue
    images.clear()
    prepare(folder, os.path.join(OUT, f"{name}.tris"))
