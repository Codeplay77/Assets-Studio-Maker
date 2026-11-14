"""
Assets Studio Maker -- prepares Poly Haven glTF models for the Realista style (Blender 5.1).

    blender -b --factory-startup --python tools/blender/prepare_polyhaven.py -- <downloads> <out> [ids...]

<downloads>/models/<id>/ holds the 1k glTF saved by scripts/download-realistic.ts. Each model is
reduced to a game budget while keeping its texture layout, and each material's textures are
rewritten as the three images glTF and the editor use:

    color.jpg (color.png when transparent pixels cut the surface), normal.jpg, arm.jpg
    (occlusion in red, roughness in green, metalness in blue)

<out>/<id>/ gets those images (m<k>_color.jpg ...), mesh.bin and mesh.json, which
scripts/import-realistic.ts packs into the editor.
"""

import json
import math
import os
import random
import struct
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

argv = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = argv[0], argv[1]
ONLY = set(argv[2:])

SMOOTH_ANGLE = 38.0
# Leaves, grass and fringes are cards cut out by transparency; reducing them like solid geometry
# melts them, so whole cards are dropped instead, and the rest grow a little to keep the crown full.
MAX_CARD_GROWTH = 1.5


def srgb_to_linear(c):
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c):
    c = np.clip(c, 0.0, 1.0)
    return np.where(c <= 0.0031308, c * 12.92, 1.055 * c ** (1 / 2.4) - 0.055)


def budget_for(info, size):
    """Triangles a model may keep: furniture like a game's, trees with enough to read as trees."""
    cats = set(info.get("categories", []))
    biggest = max(size)
    if cats & {"trees"} or biggest > 4:
        return 40000
    if cats & {"plants", "ground cover", "flowers", "grass", "potted plants"}:
        return 5000 if biggest > 0.8 else 2500
    # Rooms hang several lamps from the ceiling.
    if cats & {"lighting"}:
        return 2000
    if cats & {"rocks"}:
        return 5000
    # Furniture: a furnished house has to stay light enough for a game; the normal map keeps the detail.
    if biggest < 0.45:
        return 1500
    if cats & {"seating", "bed"} or biggest > 1.6:
        return 7000
    return 4000


NATURE = {"trees", "plants", "ground cover", "flowers", "grass", "rocks", "potted plants"}


def light_budget(info, size):
    """
    A second, light version of plants and rocks, for maps and cities that scatter hundreds of
    them; None when the model has no use for one.
    """
    cats = set(info.get("categories", []))
    if not cats & NATURE or cats & {"potted plants"}:
        return None
    biggest = max(size)
    if cats & {"trees"} or biggest > 4:
        return 6000
    if cats & {"rocks"}:
        return 500
    return 1400 if biggest > 0.8 else 600


def texture_size(size):
    return 1024 if max(size) >= 0.6 else 512


def material_table(gltf_path):
    gltf = json.load(open(gltf_path, encoding="utf-8"))
    folder = os.path.dirname(gltf_path)

    def image_of(texture):
        if texture is None:
            return None
        source = gltf["textures"][texture["index"]]["source"]
        return os.path.join(folder, gltf["images"][source]["uri"].replace("%20", " "))

    def transform_of(texture):
        ext = (texture or {}).get("extensions", {}).get("KHR_texture_transform")
        if not ext:
            return None
        return {"offset": ext.get("offset", [0, 0]), "scale": ext.get("scale", [1, 1])}

    table = {}
    for material in gltf.get("materials", []):
        pbr = material.get("pbrMetallicRoughness", {})
        exts = material.get("extensions", {})
        base = pbr.get("baseColorTexture")
        table[material.get("name", "")] = {
            "factor": np.array(pbr.get("baseColorFactor", [1, 1, 1, 1]), dtype=np.float32),
            "color": image_of(base),
            "transform": transform_of(base),
            "normal": image_of(material.get("normalTexture")),
            "mr": image_of(pbr.get("metallicRoughnessTexture")),
            "occlusion": image_of(material.get("occlusionTexture")),
            "metallic": float(pbr.get("metallicFactor", 1.0)),
            "roughness": float(pbr.get("roughnessFactor", 1.0)),
            "alpha": material.get("alphaMode", "OPAQUE"),
            "double": bool(material.get("doubleSided", False)),
            "glass": "KHR_materials_transmission" in exts,
        }
    return table


images = {}


def pixels(path):
    """An image as rows from the bottom, values as stored in the file (sRGB stays sRGB)."""
    if path not in images:
        image = bpy.data.images.load(path, check_existing=True)
        image.colorspace_settings.name = "Non-Color"
        w, h = image.size
        data = np.empty(w * h * 4, dtype=np.float32)
        image.pixels.foreach_get(data)
        images[path] = data.reshape(h, w, 4)
    return images[path]


def resized(data, size):
    """Nearest sampling to a square of `size`; the sources are 1k, so this only ever shrinks."""
    h, w = data.shape[:2]
    if w == size and h == size:
        return data
    ys = np.minimum((np.arange(size) + 0.5) * h / size, h - 1).astype(int)
    xs = np.minimum((np.arange(size) + 0.5) * w / size, w - 1).astype(int)
    return data[ys][:, xs]


def save_image(data, path, alpha):
    h, w = data.shape[:2]
    image = bpy.data.images.new(os.path.basename(path), w, h, alpha=alpha, float_buffer=False)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(np.ascontiguousarray(data, dtype=np.float32).ravel())
    image.file_format = "PNG" if alpha else "JPEG"
    image.filepath_raw = path
    image.save(filepath=path, quality=88)
    bpy.data.images.remove(image)


def write_textures(entry, size, folder, prefix):
    """The three images of a textured material, with its factors folded in."""
    color = resized(pixels(entry["color"]), size).copy()
    factor = entry["factor"]
    if np.any(factor[:3] < 0.999):
        color[..., :3] = linear_to_srgb(srgb_to_linear(color[..., :3]) * factor[:3])
    cutout = entry["alpha"] in ("MASK", "BLEND") and float(np.min(color[..., 3])) < 0.5
    if not cutout:
        color[..., 3] = 1
    color_file = f"{prefix}_color.{'png' if cutout else 'jpg'}"
    save_image(color, os.path.join(folder, color_file), cutout)

    if entry["normal"]:
        normal = resized(pixels(entry["normal"]), size).copy()
    else:
        normal = np.zeros((4, 4, 4), dtype=np.float32)
        normal[...] = (0.5, 0.5, 1.0, 1.0)
    normal[..., 3] = 1
    save_image(normal, os.path.join(folder, f"{prefix}_normal.jpg"), False)

    arm = np.ones((size, size, 4), dtype=np.float32)
    if entry["occlusion"]:
        arm[..., 0] = resized(pixels(entry["occlusion"]), size)[..., 0]
    if entry["mr"]:
        mr = resized(pixels(entry["mr"]), size)
        arm[..., 1] = np.clip(mr[..., 1] * entry["roughness"], 0, 1)
        arm[..., 2] = np.clip(mr[..., 2] * entry["metallic"], 0, 1)
    else:
        arm[..., 1] = entry["roughness"]
        arm[..., 2] = entry["metallic"]
    save_image(arm, os.path.join(folder, f"{prefix}_arm.jpg"), False)
    return {"color": color_file, "normal": f"{prefix}_normal.jpg", "arm": f"{prefix}_arm.jpg"}, cutout


def thin_cards(obj, keep, seed):
    """Keeps about `keep` of the loose pieces of a cut-out mesh, each grown about its center."""
    if keep >= 1:
        return
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    seen = set()
    islands = []
    for face in bm.faces:
        if face.index in seen:
            continue
        stack = [face]
        seen.add(face.index)
        island = []
        while stack:
            current = stack.pop()
            island.append(current)
            for edge in current.edges:
                for other in edge.link_faces:
                    if other.index not in seen:
                        seen.add(other.index)
                        stack.append(other)
        islands.append(island)
    rng = random.Random(seed)
    grow = min(MAX_CARD_GROWTH, 1 / math.sqrt(keep))
    doomed = []
    for island in islands:
        if rng.random() > keep:
            doomed.extend(island)
            continue
        verts = {v for f in island for v in f.verts}
        center = sum((v.co for v in verts), Vector()) / len(verts)
        for v in verts:
            v.co = center + (v.co - center) * grow
    bmesh.ops.delete(bm, geom=doomed, context="FACES")
    bm.to_mesh(obj.data)
    bm.free()


def triangle_count(obj):
    return sum(len(p.vertices) - 2 for p in obj.data.polygons)


def reduce(obj, budget, cutout_slots, seed):
    """Brings a mesh under budget: solid parts are decimated, cut-out cards thinned."""
    total = triangle_count(obj)
    if total <= budget:
        return
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.separate(type="MATERIAL")
    bpy.ops.object.mode_set(mode="OBJECT")
    parts = list(bpy.context.selected_objects)
    ratio = budget / total
    for part in parts:
        # Each separated part keeps every slot; the one its faces use is what matters.
        used = part.data.polygons[0].material_index if part.data.polygons else 0
        material = part.material_slots[used].material if used < len(part.material_slots) else None
        if material and material.name in cutout_slots:
            thin_cards(part, ratio, seed)
        else:
            mod = part.modifiers.new("reduce", "DECIMATE")
            mod.decimate_type = "COLLAPSE"
            mod.ratio = ratio
            mod.use_collapse_triangulate = True
            bpy.context.view_layer.objects.active = part
            bpy.ops.object.modifier_apply(modifier=mod.name)
    bpy.ops.object.select_all(action="DESELECT")
    for part in parts:
        part.select_set(True)
    bpy.context.view_layer.objects.active = parts[0]
    bpy.ops.object.join()
    return bpy.context.view_layer.objects.active


def load(gltf_path):
    """Imports a model with every mesh's transform baked into its vertices."""
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=gltf_path)
    meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    for o in meshes:
        world = o.matrix_world.copy()
        o.parent = None
        o.data = o.data.copy()
        o.data.transform(world)
        o.matrix_world = Matrix.Identity(4)
    return meshes


def variants(meshes):
    """
    Groups of meshes whose boxes touch. Many Poly Haven files lay several versions of a plant or a
    rock side by side; each group is one of them. A single object gives a single group.
    """
    boxes = []
    for o in meshes:
        co = np.empty(len(o.data.vertices) * 3, dtype=np.float32)
        o.data.vertices.foreach_get("co", co)
        co = co.reshape(-1, 3)
        if len(co) == 0:
            co = np.zeros((1, 3), dtype=np.float32)
        low = Vector(co.min(axis=0).tolist())
        high = Vector(co.max(axis=0).tolist())
        margin = max((high - low).length * 0.02, 0.005)
        boxes.append((low - Vector((margin,) * 3), high + Vector((margin,) * 3)))
    group = list(range(len(meshes)))

    def root(i):
        while group[i] != i:
            group[i] = group[group[i]]
            i = group[i]
        return i

    for i in range(len(meshes)):
        for j in range(i + 1, len(meshes)):
            (a0, a1), (b0, b1) = boxes[i], boxes[j]
            if all(a0[k] <= b1[k] and b0[k] <= a1[k] for k in range(3)):
                group[root(i)] = root(j)
    found = {}
    for i in range(len(meshes)):
        found.setdefault(root(i), []).append(meshes[i].name)
    return sorted(found.values(), key=lambda names: min(n for n in names))


MAX_VARIANTS = 4


def prepare(folder, out):
    info = json.load(open(os.path.join(folder, "info.json"), encoding="utf-8"))
    gltf_path = next(os.path.join(folder, name) for name in os.listdir(folder) if name.endswith(".gltf"))
    table = material_table(gltf_path)
    groups = variants(load(gltf_path))
    # The whole file first, then each version on its own when there are several; plants and rocks
    # also get a light copy of each.
    runs = [(None, out)] + ([(names, f"{out}@{k + 1}") for k, names in enumerate(groups[:MAX_VARIANTS])] if len(groups) > 1 else [])
    runs = [(names, target, False) for names, target in runs] + [(names, f"{target}~leve", True) for names, target in runs]
    for index, (names, target, light) in enumerate(runs):
        meshes = load(gltf_path) if index > 0 else [o for o in bpy.context.scene.objects if o.type == "MESH"]
        if names is not None:
            keep = set(names)
            dropped = [o for o in meshes if o.name not in keep]
            meshes = [o for o in meshes if o.name in keep]
            for o in dropped:
                bpy.data.objects.remove(o)
        process(meshes, info, table, target, light)


# Scanned trees model every leaf: millions of triangles that no game draws. Their crowns become
# impostors instead, the way games draw distant trees: Blender photographs the real crown from a
# few sides and the pictures go on crossed planes that cut out around the leaves.
IMPOSTOR_ABOVE = 300000
TRUNK_BUDGET = 15000


def emission_material(entry):
    """Shows a material's own colors, unlit, so a render records exactly the colors of the leaves."""
    material = bpy.data.materials.new("impostor")
    material.use_nodes = True
    nodes, links = material.node_tree.nodes, material.node_tree.links
    nodes.clear()
    output = nodes.new("ShaderNodeOutputMaterial")
    emission = nodes.new("ShaderNodeEmission")
    emission.inputs["Strength"].default_value = 1.0
    shader = emission.outputs[0]
    factor = entry["factor"] if entry else np.array([0.5, 0.5, 0.5, 1.0])
    if entry and entry["color"]:
        image = bpy.data.images.load(entry["color"], check_existing=False)
        image.colorspace_settings.name = "sRGB"
        texture = nodes.new("ShaderNodeTexImage")
        texture.image = image
        tint = nodes.new("ShaderNodeVectorMath")
        tint.operation = "MULTIPLY"
        tint.inputs[1].default_value = [float(v) for v in factor[:3]]
        links.new(texture.outputs["Color"], tint.inputs[0])
        links.new(tint.outputs[0], emission.inputs["Color"])
        if entry["alpha"] in ("MASK", "BLEND"):
            clip = nodes.new("ShaderNodeMath")
            clip.operation = "GREATER_THAN"
            clip.inputs[1].default_value = 0.5
            links.new(texture.outputs["Alpha"], clip.inputs[0])
            clear = nodes.new("ShaderNodeBsdfTransparent")
            mix = nodes.new("ShaderNodeMixShader")
            links.new(clip.outputs[0], mix.inputs[0])
            links.new(clear.outputs[0], mix.inputs[1])
            links.new(emission.outputs[0], mix.inputs[2])
            shader = mix.outputs[0]
    else:
        emission.inputs["Color"].default_value = [float(factor[0]), float(factor[1]), float(factor[2]), 1.0]
    links.new(shader, output.inputs["Surface"])
    return material


def split_off(obj, slots):
    """Moves the faces that use the named materials into an object of their own."""
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="DESELECT")
    for index, slot in enumerate(obj.material_slots):
        if slot.material and slot.material.name in slots:
            obj.active_material_index = index
            bpy.ops.object.material_slot_select()
    bpy.ops.mesh.separate(type="SELECTED")
    bpy.ops.object.mode_set(mode="OBJECT")
    return next(o for o in bpy.context.selected_objects if o != obj)


def render_impostor(target, entry_of, views, resolution, out):
    """
    Pictures of the target from several sides spread over half a turn, side by side in one image,
    and the crossed planes that show them: Blender coordinates, normals, texture positions and
    triangles.
    """
    scene = bpy.context.scene
    for o in scene.objects:
        o.hide_render = o is not target
    for slot in target.material_slots:
        slot.material = emission_material(entry_of(slot.material))

    co = np.empty(len(target.data.vertices) * 3, dtype=np.float32)
    target.data.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    low, high = co.min(axis=0), co.max(axis=0)
    center = (low + high) / 2
    reach = float(np.sqrt(((co[:, :2] - center[:2]) ** 2).sum(axis=1)).max())
    side = max(2 * reach, float(high[2] - low[2])) * 1.02

    scene.render.engine = "CYCLES"
    scene.cycles.device = "CPU"
    scene.cycles.samples = 16
    scene.cycles.use_denoising = False
    scene.cycles.max_bounces = 2
    scene.cycles.diffuse_bounces = 0
    scene.cycles.glossy_bounces = 0
    scene.cycles.transmission_bounces = 0
    # Light passes through many layers of leaves before it reaches the back of a crown.
    scene.cycles.transparent_max_bounces = 128
    scene.render.film_transparent = True
    scene.render.resolution_x = resolution
    scene.render.resolution_y = resolution
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA"
    try:
        scene.view_settings.view_transform = "Standard"
        scene.view_settings.look = "None"
    except TypeError:
        pass
    camera = bpy.data.cameras.new("impostor")
    camera.type = "ORTHO"
    camera.ortho_scale = side
    camera.clip_end = side * 10
    holder = bpy.data.objects.new("impostor", camera)
    scene.collection.objects.link(holder)
    scene.camera = holder

    strips = []
    positions, normals, uvs, indices = [], [], [], []
    for k in range(views):
        angle = math.pi * k / views
        toward = np.array([math.cos(angle), math.sin(angle), 0.0])
        right = np.array([-math.sin(angle), math.cos(angle), 0.0])
        holder.location = tuple(center + toward * side * 2)
        holder.rotation_euler = (math.pi / 2, 0, angle + math.pi / 2)
        path = os.path.join(out, f"_view{k}.png")
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        picture = bpy.data.images.load(path)
        picture.colorspace_settings.name = "Non-Color"
        data = np.empty(resolution * resolution * 4, dtype=np.float32)
        picture.pixels.foreach_get(data)
        strips.append(data.reshape(resolution, resolution, 4))
        bpy.data.images.remove(picture)
        os.remove(path)

        up = np.array([0.0, 0.0, 1.0])
        half = side / 2
        # Each plane is two one-sided faces whose normals lean up and out like a round crown, so
        # the sun lights every plane alike instead of leaving the back of each one dark.
        for facing in (toward, -toward):
            base = len(positions)
            for du, dv in ((-1, -1), (1, -1), (1, 1), (-1, 1)):
                outward = right * du * 0.35 + up * dv * 0.25
                normal = up + facing * 0.45 + outward
                positions.append(center + right * du * half + up * dv * half)
                normals.append(normal / np.linalg.norm(normal))
                uvs.append([(k + (du + 1) / 2) / views, (dv + 1) / 2])
            front = facing is toward
            indices += [base, base + 1, base + 2, base, base + 2, base + 3] if front else [base, base + 2, base + 1, base, base + 3, base + 2]

    bpy.data.objects.remove(holder)
    atlas = np.concatenate(strips, axis=1)
    save_image(atlas, os.path.join(out, "impostor_color.png"), True)
    flat = np.zeros((4, 4, 4), dtype=np.float32)
    flat[...] = (0.5, 0.5, 1.0, 1.0)
    save_image(flat, os.path.join(out, "impostor_normal.jpg"), False)
    rough = np.zeros((4, 4, 4), dtype=np.float32)
    rough[...] = (1.0, 0.9, 0.0, 1.0)
    save_image(rough, os.path.join(out, "impostor_arm.jpg"), False)
    files = {"color": "impostor_color.png", "normal": "impostor_normal.jpg", "arm": "impostor_arm.jpg"}
    return (
        np.array(positions, dtype=np.float32),
        np.array(normals, dtype=np.float32),
        np.array(uvs, dtype=np.float32),
        np.array(indices, dtype=np.uint32),
        files,
    )


def process(meshes, info, table, out, light=False):
    bpy.ops.object.select_all(action="DESELECT")
    for o in meshes:
        o.select_set(True)
    bpy.context.view_layer.objects.active = meshes[0]
    if len(meshes) > 1:
        bpy.ops.object.join()
    obj = bpy.context.view_layer.objects.active

    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bmesh.ops.triangulate(bm, faces=bm.faces[:])
    bm.to_mesh(obj.data)
    bm.free()

    def entry_of(material):
        name = material.name if material else ""
        return table.get(name) or table.get(name.rsplit(".", 1)[0])

    cutout_slots = set()
    for material in obj.data.materials:
        entry = entry_of(material)
        if entry and entry["color"] and entry["alpha"] in ("MASK", "BLEND") and not entry["glass"]:
            cutout_slots.add(material.name)

    dims = obj.dimensions.copy()
    size = (dims.x, dims.z, dims.y)
    triangles = triangle_count(obj)
    budget = light_budget(info, size) if light else budget_for(info, size)
    if budget is None:
        return
    os.makedirs(out, exist_ok=True)
    impostor = None
    leafy = triangles > IMPOSTOR_ABOVE and (set(info.get("categories", [])) & {"trees"} or max(size) > 3)
    if leafy and light:
        # The light copy is the whole tree on three planes.
        impostor = render_impostor(obj, entry_of, 3, 512, out)
        obj = None
    elif leafy and not cutout_slots:
        # Needles modeled one by one, with no cut-out cards to tell them from the branches.
        impostor = render_impostor(obj, entry_of, 4, 768, out)
        obj = None
    elif leafy:
        # The full tree keeps its real trunk and branches; the crown goes on four planes.
        leaves = split_off(obj, cutout_slots)
        impostor = render_impostor(leaves, entry_of, 4, 768, out)
        bpy.data.objects.remove(leaves)
        for o in bpy.context.scene.objects:
            o.hide_render = False
        cutout_slots = set()
        budget = TRUNK_BUDGET
    if obj is not None:
        obj = reduce(obj, budget, cutout_slots, info["id"]) or obj
    blob = bytearray()
    materials = []
    size_px = texture_size(size)
    if obj is not None:
        export_slots(obj, entry_of, cutout_slots, light, size_px, out, blob, materials)
    if impostor is not None:
        positions, normals, uvs, indices, files = impostor
        vp = np.stack([positions[:, 0], positions[:, 2], -positions[:, 1]], axis=1)
        vn = np.stack([normals[:, 0], normals[:, 2], -normals[:, 1]], axis=1)
        materials.append({"name": "impostor", "vertices": len(vp), "indices": len(indices), "offset": len(blob), "kind": "textured", "images": files, "cutout": True, "double": False})
        blob += vp.astype(np.float32).tobytes() + vn.astype(np.float32).tobytes() + uvs.astype(np.float32).tobytes() + indices.astype(np.uint32).tobytes()
    finish(info, triangles, size, materials, blob, out)


def export_slots(obj, entry_of, cutout_slots, light, size_px, out, blob, materials):
    """Writes each material of a reduced model: its corners into blob and its images to out."""
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.shade_smooth_by_angle(angle=math.radians(SMOOTH_ANGLE))

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
    uvs = np.zeros((len(mesh.loops), 2), dtype=np.float32)
    if uv_layer is not None:
        flat = np.empty(len(mesh.loops) * 2, dtype=np.float32)
        uv_layer.data.foreach_get("uv", flat)
        uvs = flat.reshape(-1, 2)

    for index, slot in enumerate(obj.material_slots):
        chosen = np.flatnonzero(mats == index)
        if len(chosen) == 0:
            continue
        entry = entry_of(slot.material)
        corner_loops = loops.reshape(-1, 3)[chosen].ravel()
        p = co[vert_of_loop[corner_loops]]
        n = normals[corner_loops]
        t = uvs[corner_loops].copy()
        if entry and entry["transform"]:
            # glTF measures v from the top of the image and Blender from the bottom.
            (ox, oy), (sx, sy) = entry["transform"]["offset"], entry["transform"]["scale"]
            t[:, 0] = t[:, 0] * sx + ox
            t[:, 1] = 1 - ((1 - t[:, 1]) * sy + oy)

        # One vertex per distinct corner: same point, normal and texture position.
        key = np.concatenate([np.round(p, 5), np.round(n, 3), np.round(t, 5)], axis=1)
        unique, first, inverse = np.unique(key, axis=0, return_index=True, return_inverse=True)
        inverse = inverse.ravel()
        vp, vn, vt = p[first], n[first], t[first]
        # Blender is Z up and the editor Y up: (x, y, z) -> (x, z, -y).
        vp = np.stack([vp[:, 0], vp[:, 2], -vp[:, 1]], axis=1)
        vn = np.stack([vn[:, 0], vn[:, 2], -vn[:, 1]], axis=1)

        record = {"name": slot.material.name if slot.material else "", "vertices": len(unique), "indices": len(inverse), "offset": len(blob)}
        blob += vp.astype(np.float32).tobytes() + vn.astype(np.float32).tobytes() + vt.astype(np.float32).tobytes()
        blob += inverse.astype(np.uint32).tobytes()

        if entry and entry["color"] and not entry["glass"] and light:
            # A light version shares the images of the full one, matched by material name.
            cutout = slot.material.name in cutout_slots
            record.update({"kind": "textured", "images": None, "cutout": cutout, "double": entry["double"] or cutout})
        elif entry and entry["color"] and not entry["glass"]:
            files, cutout = write_textures(entry, size_px, out, f"m{len(materials)}")
            record.update({"kind": "textured", "images": files, "cutout": cutout, "double": entry["double"] or cutout})
        else:
            factor = entry["factor"] if entry else np.array([0.8, 0.8, 0.8, 1])
            glass = bool(entry and (entry["glass"] or (entry["alpha"] == "BLEND" and factor[3] < 0.95)))
            metal = bool(entry and entry["metallic"] > 0.5)
            rgb = [int(round(v * 255)) for v in linear_to_srgb(factor[:3])]
            record.update({"kind": "plain", "color": rgb, "finish": "tint" if glass else "metal" if metal else "matte"})
        materials.append(record)


def finish(info, triangles, size, materials, blob, out):
    with open(os.path.join(out, "mesh.bin"), "wb") as f:
        f.write(bytes(blob))
    json.dump({"id": info["id"], "triangles": triangles, "size": [round(v, 3) for v in size], "materials": materials}, open(os.path.join(out, "mesh.json"), "w"), indent=1)
    kept = sum(m["indices"] for m in materials) // 3
    kinds = ", ".join(f"{m['kind']}{'/recorte' if m.get('cutout') else ''}" for m in materials)
    print(f"{os.path.basename(out)}: {triangles} -> {kept} triângulos, {[round(v, 2) for v in size]} m, {kinds}", flush=True)


root = os.path.join(SOURCE, "models")
for name in sorted(os.listdir(root)):
    folder = os.path.join(root, name)
    if not os.path.isfile(os.path.join(folder, "done")) or (ONLY and name not in ONLY):
        continue
    images.clear()
    try:
        prepare(folder, os.path.join(OUT, name))
    except Exception as error:
        print(f"{name}: FALHOU {error!r}", flush=True)
