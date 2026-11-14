# Makes the Realista people with MPFB (MakeHuman for Blender) and its CC0 system assets.
#
#   blender --factory-startup -b --python tools/blender/make_people.py -- <out> [body,body,...]
#
# MPFB has to be installed and enabled, with the "makehuman system assets" pack in its data folder
# (see CONTRIBUTING.md). For each body it writes, under <out>:
#   <block>/mesh.json + mesh.bin   the pieces of one block, already skinned to the editor's skeleton
#   surfaces/<id>/                 color, normal and arm (occlusion, roughness, metal) images
#   surfaces.json                  every surface, with the asset it came from
#
# A person is a few blocks that share one skeleton and stand on the same spot: the body (skin,
# eyes, brows, lashes), what it wears on top, what it wears below (with the shoes), the hair and,
# sometimes, a hat. The body under each outfit loses the skin the clothes cover, so it is made once
# for every outfit. Clothes are fitted to every body, so they are made once per body too.
#
# The skeleton is the editor's: the 52 bones of Mesh2Motion's human (the body and three in each
# finger), which MPFB's "game engine" rig has under the same names. The person is exported standing
# with the arms down, which becomes the rest pose; the editor turns it into the animation skeleton's
# T pose by itself.
#
# Coordinates in the files: meters, Y up, the person facing +Z, its left at +X.

import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Matrix, Vector

args = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(args[0])
ONLY = set(args[1].split(",")) if len(args) > 1 and args[1] else None

bpy.ops.preferences.addon_enable(module="bl_ext.user_default.mpfb")
from bl_ext.user_default.mpfb.services.humanservice import HumanService  # noqa: E402
from bl_ext.user_default.mpfb.services.locationservice import LocationService  # noqa: E402

DATA = LocationService.get_user_data()

FINGERS = ("thumb", "index", "middle", "ring", "pinky")
# The animation pack's bones, in its order: the body, then three bones in each finger.
SOURCE_BONES = [
    "pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head",
    "clavicle_l", "upperarm_l", "lowerarm_l", "hand_l", "clavicle_r", "upperarm_r", "lowerarm_r", "hand_r",
    "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r",
    *[f"{finger}_0{n}_{side}" for side in "lr" for finger in FINGERS for n in (1, 2, 3)],
]
BONE_INDEX = {name: i for i, name in enumerate(SOURCE_BONES)}
LOWER = {"pelvis", "thigh_l", "calf_l", "foot_l", "ball_l", "thigh_r", "calf_r", "foot_r", "ball_r"}


def source_bone(name):
    """The editor's bone that a bone of the game engine rig moves with, or None."""
    if name in BONE_INDEX:
        return name
    if name == "Root":
        return "pelvis"
    return None


# Brazilians are of every origin; the face shapes mix them.
RACE = {"caucasian": 0.5, "african": 0.3, "asian": 0.2}


def macros(gender, age, muscle=0.5, weight=0.5, height=0.5, proportions=0.6):
    return {"gender": gender, "age": age, "muscle": muscle, "weight": weight, "proportions": proportions,
            "height": height, "cupsize": 0.5, "firmness": 0.5, "race": dict(RACE)}


# MakeHuman's age slider: 0 is 1 year old, 0.1875 is 11, 0.5 is 25 and 1 is 90.
BODIES = {
    "homem": ("m", "adulto", macros(1.0, 0.54, 0.55, 0.5, 0.55)),
    "homem_magro": ("m", "adulto", macros(1.0, 0.54, 0.45, 0.2, 0.55)),
    "homem_forte": ("m", "adulto", macros(1.0, 0.56, 0.6, 0.85, 0.55, 0.55)),
    "mulher": ("f", "adulto", macros(0.0, 0.54, 0.45, 0.5, 0.5)),
    "mulher_magra": ("f", "adulto", macros(0.0, 0.54, 0.4, 0.2, 0.5)),
    "mulher_forte": ("f", "adulto", macros(0.0, 0.56, 0.5, 0.85, 0.5, 0.55)),
    "rapaz": ("m", "jovem", macros(1.0, 0.43, 0.5, 0.45, 0.6, 0.55)),
    "moca": ("f", "jovem", macros(0.0, 0.43, 0.45, 0.45, 0.6, 0.55)),
    "menino": ("m", "crianca", macros(1.0, 0.13, 0.5, 0.5, 0.5, 0.5)),
    "menina": ("f", "crianca", macros(0.0, 0.13, 0.5, 0.5, 0.5, 0.5)),
    "idoso": ("m", "idoso", macros(1.0, 0.86, 0.4, 0.6, 0.45, 0.5)),
    "idosa": ("f", "idoso", macros(0.0, 0.86, 0.4, 0.6, 0.45, 0.5)),
}

# Outfit: the clothes asset, whether its top and its bottom take the part's color, and the shoes.
OUTFITS = {
    "camiseta": ("male_casualsuit06", True, False, "shoes05"),
    "manga_longa": ("male_casualsuit02", True, False, "shoes06"),
    "camisa": ("male_casualsuit01", True, False, "shoes01"),
    "jaqueta": ("male_casualsuit05", True, False, "shoes02"),
    "terno": ("male_elegantsuit01", True, True, "shoes04"),
    "macacao": ("male_worksuit01", False, False, "shoes03"),
    "camiseta_f": ("female_casualsuit01", True, False, "shoes05"),
    "bermuda_f": ("female_casualsuit02", True, False, "shoes06"),
    "esporte_f": ("female_sportsuit01", True, True, "shoes05"),
    "social_f": ("female_elegantsuit01", True, True, "shoes04"),
}
WARDROBE = {
    ("m", "adulto"): ["camiseta", "manga_longa", "camisa", "jaqueta", "terno", "macacao"],
    ("f", "adulto"): ["camiseta_f", "bermuda_f", "esporte_f", "social_f"],
    ("m", "jovem"): ["camiseta", "manga_longa", "camisa", "jaqueta"],
    ("f", "jovem"): ["camiseta_f", "bermuda_f", "esporte_f"],
    ("m", "crianca"): ["camiseta", "manga_longa", "camisa"],
    ("f", "crianca"): ["camiseta_f", "bermuda_f"],
    ("m", "idoso"): ["camisa", "jaqueta", "terno"],
    ("f", "idoso"): ["camiseta_f", "social_f"],
}
HAIRS = {"m": ["short01", "short02", "short03", "short04", "afro01"],
         "f": ["bob01", "bob02", "long01", "ponytail01", "braid01", "afro01"]}

# Triangle budgets after reduction; the body and the hair cards keep theirs.
OUTFIT_TRIANGLES = 7000
SHOE_TRIANGLES = 1600
HAT_TRIANGLES = 1500

# --- textures ------------------------------------------------------------------------------------

surfaces = {}
os.makedirs(os.path.join(OUT, "surfaces"), exist_ok=True)


def mhmat(path):
    """The keys of a MakeHuman material file, with texture paths made absolute."""
    values = {}
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            line = line.strip()
            if not line or line.startswith(("#", "//")):
                continue
            key, _, value = line.partition(" ")
            values[key] = value.strip()
    folder = os.path.dirname(path)
    for key in ("diffuseTexture", "normalmapTexture", "aomapTexture"):
        if key in values:
            values[key] = os.path.join(folder, os.path.basename(values[key]))
    return values


def read_image(path, size):
    image = bpy.data.images.load(path, check_existing=False)
    image.colorspace_settings.name = "Non-Color"
    if image.size[0] != size:
        image.scale(size, size)
    pixels = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(pixels)
    bpy.data.images.remove(image)
    return pixels.reshape(size, size, 4)


def write_image(pixels, path, alpha):
    height, width = pixels.shape[:2]
    image = bpy.data.images.new("out", width, height, alpha=alpha)
    image.colorspace_settings.name = "Non-Color"
    image.pixels.foreach_set(np.ascontiguousarray(pixels, dtype=np.float32).ravel())
    image.filepath_raw = path
    image.file_format = "PNG" if alpha else "JPEG"
    image.save(quality=88)
    bpy.data.images.remove(image)


def flat(value):
    pixels = np.zeros((4, 4, 4), dtype=np.float32)
    pixels[...] = value
    return pixels


def neutral(rgb, mask, level, gray):
    """Keeps a texture's detail around an even `level`, so the part's color decides its tone."""
    if gray:
        lum = rgb @ np.array([0.2126, 0.7152, 0.0722], dtype=np.float32)
        mean = float(lum[mask].mean()) if mask.any() else 0.5
        out = np.repeat((lum / max(mean, 1e-3) * level)[..., None], 3, axis=2)
    else:
        mean = rgb[mask].mean(axis=0) if mask.any() else np.full(3, 0.5)
        out = rgb / np.maximum(mean, 1e-3) * level
    return np.clip(out, 0, 1)


# MakeHuman's t-shirts carry the MakeHuman logo. Each box (from the image's top left, as fractions)
# holds one, and the offset points at plain fabric of the same shirt, whose weave fills the hole.
LOGOS = {
    "female_casualsuit01": [((0.70, 0.12, 0.90, 0.33), (-0.48, 0.0))],
    "female_casualsuit02": [((0.69, 0.12, 0.89, 0.33), (-0.48, 0.0))],
    "male_casualsuit02": [((0.49, 0.09, 0.62, 0.25), (-0.42, 0.0))],
    "male_casualsuit04": [((0.49, 0.08, 0.62, 0.24), (-0.42, 0.0))],
    "male_casualsuit06": [((0.19, 0.09, 0.34, 0.19), (0.0, 0.15)), ((0.41, 0.10, 0.69, 0.22), (0.0, 0.15))],
}


def smooth(values, passes):
    for _ in range(passes):
        values = (values + np.roll(values, 1, 0) + np.roll(values, -1, 0) + np.roll(values, 1, 1) + np.roll(values, -1, 1)) / 5
    return values


def clean_logos(pixels, logos):
    """Fills each logo from the fabric around it, then puts back the weave of a plain patch."""
    height, width = pixels.shape[:2]
    for (u0, v0, u1, v1), (du, dv) in logos:
        # Blender keeps the bottom row first.
        x0, x1 = int(u0 * width), int(u1 * width)
        y0, y1 = int((1 - v1) * height), int((1 - v0) * height)
        region = pixels[y0:y1, x0:x1, :3].copy()
        median = np.median(region.reshape(-1, 3), axis=0)
        mask = np.linalg.norm(region - median, axis=2) > 0.1
        for _ in range(3):
            mask = mask | np.roll(mask, 1, 0) | np.roll(mask, -1, 0) | np.roll(mask, 1, 1) | np.roll(mask, -1, 1)
        fill = region.copy()
        fill[mask] = median
        for _ in range(300):
            around = (np.roll(fill, 1, 0) + np.roll(fill, -1, 0) + np.roll(fill, 1, 1) + np.roll(fill, -1, 1)) / 4
            fill[mask] = around[mask]
        dx, dy = int(du * width), int(-dv * height)
        patch = pixels[y0 + dy:y1 + dy, x0 + dx:x1 + dx, :3]
        fill[mask] += (patch - smooth(patch, 6))[mask]
        pixels[y0:y1, x0:x1, :3] = np.clip(fill, 0, 1)


def surface(surface_id, name, source, material, *, size=1024, tint=None, cutout=False, rough=0.85):
    """
    Writes a surface once: the color (made neutral when the part's color tints it), the relief and
    an arm image. `tint` is None to keep the colors, or the even level and whether to go gray.
    """
    if surface_id in surfaces:
        return surface_id
    folder = os.path.join(OUT, "surfaces", surface_id)
    os.makedirs(folder, exist_ok=True)
    color = read_image(material["diffuseTexture"], size)
    logos = LOGOS.get(os.path.basename(source))
    if logos:
        clean_logos(color, logos)
    alpha = color[..., 3:4]
    if tint is not None:
        level, gray = tint
        color[..., :3] = neutral(color[..., :3], color[..., 3] > 0.5, level, gray)
    write_image(color if cutout else np.concatenate([color[..., :3], np.ones_like(alpha)], axis=2),
                os.path.join(folder, "color.png" if cutout else "color.jpg"), cutout)
    normal_path = material.get("normalmapTexture")
    if normal_path and os.path.exists(normal_path):
        normal = read_image(normal_path, size)
        normal[..., 3] = 1
        write_image(normal, os.path.join(folder, "normal.jpg"), False)
    else:
        write_image(flat((0.5, 0.5, 1.0, 1.0)), os.path.join(folder, "normal.jpg"), False)
    ao_path = material.get("aomapTexture")
    if ao_path and os.path.exists(ao_path):
        ao = read_image(ao_path, size // 2)
        arm = np.stack([ao[..., 0], np.full_like(ao[..., 0], rough), np.zeros_like(ao[..., 0]), np.ones_like(ao[..., 0])], axis=2)
    else:
        arm = flat((1.0, rough, 0.0, 1.0))
    write_image(arm, os.path.join(folder, "arm.jpg"), False)
    surfaces[surface_id] = {"id": surface_id, "name": name, "source": source, "cutout": cutout}
    return surface_id


# --- meshes --------------------------------------------------------------------------------------

def to_editor(points):
    """Blender's Z up and -Y front to the editor's Y up and +Z front."""
    return np.stack([points[:, 0], points[:, 2], -points[:, 1]], axis=1)


def bone_matrices(armature):
    """For every bone, how the pose moves a point from where it is at rest, in world space."""
    world = armature.matrix_world
    inverse = world.inverted()
    return {pb.name: world @ pb.matrix @ pb.bone.matrix_local.inverted() @ inverse for pb in armature.pose.bones}


def mesh_data(obj, armature):
    """
    The object's triangles, posed: positions and normals moved by the armature, texture
    coordinates, the editor's bones with their weights, and which faces each triangle comes from.
    Vertices hidden by the object's masks are left out.
    """
    toggled = [m for m in obj.modifiers if m.type in ("ARMATURE", "MASK") and m.show_viewport]
    for m in toggled:
        m.show_viewport = False
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = evaluated.to_mesh()
    count = len(mesh.vertices)
    co = np.empty(count * 3, dtype=np.float32)
    mesh.vertices.foreach_get("co", co)
    co = co.reshape(-1, 3)
    normals = np.empty(count * 3, dtype=np.float32)
    mesh.vertex_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    mesh.calc_loop_triangles()
    tris = len(mesh.loop_triangles)
    tri_vertices = np.empty(tris * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("vertices", tri_vertices)
    tri_loops = np.empty(tris * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("loops", tri_loops)
    tri_faces = np.empty(tris, dtype=np.int32)
    mesh.loop_triangles.foreach_get("polygon_index", tri_faces)
    uv = np.empty(len(mesh.loops) * 2, dtype=np.float32)
    mesh.uv_layers.active.data.foreach_get("uv", uv)
    uv = uv.reshape(-1, 2)
    islands = uv_islands(mesh, uv)
    evaluated.to_mesh_clear()
    for m in toggled:
        m.show_viewport = True

    # World space, then posed by the armature with the same weights Blender uses.
    world = np.array(obj.matrix_world, dtype=np.float32)
    co = co @ world[:3, :3].T + world[:3, 3]
    normals = normals @ world[:3, :3].T
    names = {g.index: g.name for g in obj.vertex_groups}
    moves = bone_matrices(armature)
    posed = np.zeros_like(co)
    turned = np.zeros_like(normals)
    total = np.zeros(count, dtype=np.float32)
    groups = [[] for _ in range(count)]
    by_bone = {}
    for vertex in obj.data.vertices:
        for g in vertex.groups:
            name = names.get(g.group)
            if g.weight > 0 and name in moves:
                groups[vertex.index].append((name, g.weight))
                by_bone.setdefault(name, []).append((vertex.index, g.weight))
    for name, entries in by_bone.items():
        m = np.array(moves[name], dtype=np.float32)
        idx = np.array([i for i, _ in entries])
        w = np.array([wt for _, wt in entries], dtype=np.float32)
        posed[idx] += w[:, None] * (co[idx] @ m[:3, :3].T + m[:3, 3])
        turned[idx] += w[:, None] * (normals[idx] @ m[:3, :3].T)
        total[idx] += w
    free = total <= 0
    posed[~free] /= total[~free, None]
    posed[free] = co[free]
    turned[free] = normals[free]
    turned /= np.maximum(np.linalg.norm(turned, axis=1, keepdims=True), 1e-8)

    # The editor's four strongest bones for every vertex.
    joints = np.zeros((count, 4), dtype=np.uint8)
    weights = np.zeros((count, 4), dtype=np.float32)
    for i, entries in enumerate(groups):
        merged = {}
        for name, weight in entries:
            target = source_bone(name)
            if target:
                merged[target] = merged.get(target, 0) + weight
        if not merged:
            merged = {"pelvis": 1.0}
        best = sorted(merged.items(), key=lambda item: -item[1])[:4]
        s = sum(weight for _, weight in best)
        for k, (name, weight) in enumerate(best):
            joints[i, k] = BONE_INDEX[name]
            weights[i, k] = weight / s

    keep = np.ones(count, dtype=bool)
    for m in obj.modifiers:
        if m.type != "MASK" or not m.vertex_group or m.vertex_group not in obj.vertex_groups:
            continue
        index = obj.vertex_groups[m.vertex_group].index
        inside = np.array([any(g.group == index and g.weight > m.threshold for g in v.groups) for v in obj.data.vertices])
        keep &= ~inside if m.invert_vertex_group else inside

    return {
        "co": posed, "normals": turned, "uv": uv, "joints": joints, "weights": weights, "keep": keep,
        "tri_vertices": tri_vertices.reshape(-1, 3), "tri_loops": tri_loops.reshape(-1, 3),
        "tri_faces": tri_faces, "islands": islands,
    }


def uv_islands(mesh, uv):
    """The island of each face: faces sharing an edge with the same texture coordinates on it."""
    parent = list(range(len(mesh.polygons)))

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    seen = {}
    loops = mesh.loops
    for polygon in mesh.polygons:
        indices = list(polygon.loop_indices)
        for k, first in enumerate(indices):
            second = indices[(k + 1) % len(indices)]
            a, b = loops[first].vertex_index, loops[second].vertex_index
            ua, ub = tuple(np.round(uv[first], 4)), tuple(np.round(uv[second], 4))
            key = (a, ua, b, ub) if a < b else (b, ub, a, ua)
            if key in seen:
                parent[find(polygon.index)] = find(seen[key])
            else:
                seen[key] = polygon.index
    return np.array([find(i) for i in range(len(mesh.polygons))], dtype=np.int32)


def piece(data, triangles):
    """The given triangles as an indexed piece: one vertex for each corner position and texture spot."""
    corners = {}
    order = []
    indices = []
    for t in triangles:
        for vertex, loop in zip(data["tri_vertices"][t], data["tri_loops"][t]):
            key = (int(vertex), round(float(data["uv"][loop][0]), 5), round(float(data["uv"][loop][1]), 5))
            if key not in corners:
                corners[key] = len(order)
                order.append((int(vertex), int(loop)))
            indices.append(corners[key])
    vertices = np.array([v for v, _ in order], dtype=np.int64)
    loops = np.array([lp for _, lp in order], dtype=np.int64)
    return {
        "positions": to_editor(data["co"][vertices]),
        "normals": to_editor(data["normals"][vertices]),
        "uvs": data["uv"][loops],
        "joints": data["joints"][vertices],
        "weights": data["weights"][vertices],
        "indices": np.array(indices, dtype=np.uint32),
    }


def visible(data):
    keep = data["keep"]
    return [t for t, tri in enumerate(data["tri_vertices"]) if keep[tri].all()]


def split_outfit(data):
    """Triangles of the top and of the bottom: each texture island goes where most of it moves."""
    lower = np.array([BONE_INDEX[name] for name in LOWER])
    dominant = data["joints"][:, 0]
    is_lower = np.isin(dominant, lower)
    votes = {}
    for t in visible(data):
        island = data["islands"][data["tri_faces"][t]]
        low = int(is_lower[data["tri_vertices"][t]].sum())
        a, b = votes.get(island, (0, 0))
        votes[island] = (a + low, b + 3)
    top, bottom = [], []
    for t in visible(data):
        a, b = votes[data["islands"][data["tri_faces"][t]]]
        (bottom if a * 2 > b else top).append(t)
    return top, bottom


def write_block(block_id, pieces, skeleton):
    folder = os.path.join(OUT, block_id)
    os.makedirs(folder, exist_ok=True)
    blob = bytearray()
    entries = []
    for entry, p in pieces:
        if len(p["indices"]) == 0:
            continue
        entries.append({**entry, "vertices": len(p["positions"]), "indices": len(p["indices"]), "offset": len(blob)})
        blob += p["positions"].astype(np.float32).tobytes()
        blob += p["normals"].astype(np.float32).tobytes()
        blob += p["uvs"].astype(np.float32).tobytes()
        blob += p["joints"].astype(np.uint8).tobytes()
        blob += p["weights"].astype(np.float32).tobytes()
        blob += p["indices"].astype(np.uint32).tobytes()
    with open(os.path.join(folder, "mesh.bin"), "wb") as f:
        f.write(blob)
    with open(os.path.join(folder, "mesh.json"), "w", encoding="utf-8") as f:
        json.dump({"pieces": entries, "skeleton": skeleton}, f)
    triangles = sum(e["indices"] for e in entries) // 3
    print(f"  {block_id}: {triangles} triângulos")


def reduce(obj, budget):
    triangles = sum(len(p.vertices) - 2 for p in obj.data.polygons)
    if triangles <= budget:
        return
    if obj.data.shape_keys:
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.shape_key_remove(all=True, apply_mix=True)
    modifier = obj.modifiers.new("reduce", "DECIMATE")
    modifier.ratio = budget / triangles
    modifier.use_collapse_triangulate = True
    bpy.ops.object.select_all(action="DESELECT")
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj
    bpy.ops.object.modifier_move_to_index(modifier="reduce", index=0)
    bpy.ops.object.modifier_apply(modifier="reduce")


# --- people --------------------------------------------------------------------------------------

def relax_arms(armature):
    """From MakeHuman's A pose to arms hanging a little away from the body."""
    bpy.context.view_layer.objects.active = armature
    for side, sign in (("l", -1), ("r", 1)):
        bone = armature.pose.bones[f"upperarm_{side}"]
        head = bone.head.copy()
        tail = bone.tail.copy()
        direction = (tail - head).normalized()
        down = Vector((0, 0, -1))
        # Leave the arm about 12 degrees out from straight down.
        target = (down * math.cos(math.radians(12)) + Vector((-sign, 0, 0)) * math.sin(math.radians(12))).normalized()
        turn = direction.rotation_difference(target).to_matrix().to_4x4()
        bone.matrix = Matrix.Translation(head) @ turn @ Matrix.Translation(-head) @ bone.matrix
        bpy.context.view_layer.update()
        # A slight bend at the elbow, forward, as relaxed arms have.
        fore = armature.pose.bones[f"lowerarm_{side}"]
        elbow = fore.head.copy()
        # Blender's front is -Y: a negative turn about X brings the hand forward.
        bend = Matrix.Rotation(math.radians(-8), 4, Vector((1, 0, 0)))
        fore.matrix = Matrix.Translation(elbow) @ bend @ Matrix.Translation(-elbow) @ fore.matrix
        bpy.context.view_layer.update()


def skeleton_of(armature):
    world = armature.matrix_world
    heads, tails = [], []
    for name in SOURCE_BONES:
        pb = armature.pose.bones[name]
        heads.append(world @ pb.head)
        tails.append(world @ pb.tail)
    heads = to_editor(np.array(heads, dtype=np.float32))
    tails = to_editor(np.array(tails, dtype=np.float32))
    directions = tails - heads
    directions /= np.maximum(np.linalg.norm(directions, axis=1, keepdims=True), 1e-8)
    return {"joints": np.round(heads, 4).tolist(), "directions": np.round(directions, 5).tolist()}


def asset(rel):
    return os.path.join(DATA, rel)


def add(basemesh, rel, kind):
    return HumanService.add_mhclo_asset(asset(rel), basemesh, asset_type=kind, subdiv_levels=0)


def remove(basemesh, obj):
    HumanService.unload_mhclo_asset(basemesh, obj)


def material_of(rel):
    """The material an asset's .mhclo names."""
    path = asset(rel)
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if line.startswith("material "):
                return mhmat(os.path.join(os.path.dirname(path), line.split(" ", 1)[1].strip()))
    raise ValueError(f"{rel} não diz qual é o seu material")


def clothes_material(name):
    return material_of(f"clothes/{name}/{name}.mhclo")


def make_body(body_id, sex, group, settings):
    print(f"== {body_id}")
    for o in list(bpy.data.objects):
        bpy.data.objects.remove(o)
    basemesh = HumanService.create_human(macro_detail_dict=settings)
    armature = HumanService.add_builtin_rig(basemesh, "game_engine")
    skin_name = ("old" if group == "idoso" else "young") + "_caucasian_" + ("male" if sex == "m" else "female")
    skin_material = mhmat(asset(f"skins/{skin_name}/{skin_name}.mhmat"))
    brows = "eyebrow009" if group == "idoso" and sex == "m" else "eyebrow001" if sex == "m" else "eyebrow006"
    eyes = add(basemesh, "eyes/low-poly/low-poly.mhclo", "Eyes")
    brow = add(basemesh, f"eyebrows/{brows}/{brows}.mhclo", "Eyebrows")
    lashes = add(basemesh, "eyelashes/eyelashes01/eyelashes01.mhclo", "Eyelashes")
    relax_arms(armature)
    skeleton = skeleton_of(armature)

    skin = surface(f"mh.pele.{skin_name}", "Pele", f"skins/{skin_name}", skin_material, size=2048, tint=(0.88, False), rough=0.6)
    eye = surface("mh.olhos", "Olhos", "eyes/materials/brown", mhmat(asset("eyes/materials/brown.mhmat")), size=512, rough=0.15)
    brow_surface = surface(f"mh.sobrancelha.{brows}", "Sobrancelha", f"eyebrows/{brows}", material_of(f"eyebrows/{brows}/{brows}.mhclo"), size=512, cutout=True, rough=0.8)
    lash = surface("mh.cilios", "Cílios", "eyelashes/eyelashes01", material_of("eyelashes/eyelashes01/eyelashes01.mhclo"), size=256, cutout=True, rough=0.8)
    face = [
        ({"surface": eye, "tint": False}, eyes),
        ({"surface": brow_surface, "tint": False}, brow),
        ({"surface": lash, "tint": False}, lashes),
    ]
    face_pieces = []
    for entry, obj in face:
        data = mesh_data(obj, armature)
        face_pieces.append((entry, piece(data, visible(data))))

    for hair in HAIRS[sex]:
        obj = add(basemesh, f"hair/{hair}/{hair}.mhclo", "Hair")
        material = material_of(f"hair/{hair}/{hair}.mhclo")
        hair_surface = surface(f"mh.cabelo.{hair}", "Cabelo", f"hair/{hair}", material, tint=(0.8, True), cutout=True, rough=0.55)
        data = mesh_data(obj, armature)
        write_block(f"rz.pessoa.{body_id}.cabelo_{hair}", [({"surface": hair_surface, "tint": True}, piece(data, visible(data)))], skeleton)
        remove(basemesh, obj)

    if group != "crianca":
        obj = add(basemesh, "clothes/fedora01/fedora01.mhclo", "Clothes")
        reduce(obj, HAT_TRIANGLES)
        hat = surface("mh.chapeu.fedora01", "Chapéu", "clothes/fedora01", clothes_material("fedora01"), tint=(0.8, True), rough=0.9)
        data = mesh_data(obj, armature)
        write_block(f"rz.pessoa.{body_id}.chapeu", [({"surface": hat, "tint": True}, piece(data, visible(data)))], skeleton)
        remove(basemesh, obj)

    for outfit in WARDROBE[(sex, group)]:
        clothes_name, tint_top, tint_bottom, shoes_name = OUTFITS[outfit]
        clothes = add(basemesh, f"clothes/{clothes_name}/{clothes_name}.mhclo", "Clothes")
        shoes = add(basemesh, f"clothes/{shoes_name}/{shoes_name}.mhclo", "Clothes")
        reduce(clothes, OUTFIT_TRIANGLES)
        reduce(shoes, SHOE_TRIANGLES)
        material = clothes_material(clothes_name)
        plain = None if tint_top and tint_bottom else surface(f"mh.roupa.{clothes_name}", "Roupa", f"clothes/{clothes_name}", material)
        tinted = surface(f"mh.roupa.{clothes_name}.cor", "Roupa", f"clothes/{clothes_name}", material, tint=(0.82, True)) if tint_top or tint_bottom else None
        shoe = surface(f"mh.sapato.{shoes_name}", "Sapato", f"clothes/{shoes_name}", clothes_material(shoes_name), rough=0.6)

        data = mesh_data(basemesh, armature)
        write_block(f"rz.pessoa.{body_id}.corpo_{outfit}", [({"surface": skin, "tint": True}, piece(data, visible(data))), *face_pieces], skeleton)
        data = mesh_data(clothes, armature)
        top, bottom = split_outfit(data)
        write_block(f"rz.pessoa.{body_id}.cima_{outfit}", [({"surface": tinted if tint_top else plain, "tint": tint_top}, piece(data, top))], skeleton)
        shoe_data = mesh_data(shoes, armature)
        write_block(
            f"rz.pessoa.{body_id}.baixo_{outfit}",
            [({"surface": tinted if tint_bottom else plain, "tint": tint_bottom}, piece(data, bottom)),
             ({"surface": shoe, "tint": False}, piece(shoe_data, visible(shoe_data)))],
            skeleton,
        )
        remove(basemesh, shoes)
        remove(basemesh, clothes)


for body_id, (sex, group, settings) in BODIES.items():
    if ONLY and body_id not in ONLY:
        continue
    make_body(body_id, sex, group, settings)

existing = {}
listing = os.path.join(OUT, "surfaces.json")
if os.path.exists(listing):
    with open(listing, encoding="utf-8") as f:
        existing = {s["id"]: s for s in json.load(f)}
existing.update(surfaces)
with open(listing, "w", encoding="utf-8") as f:
    json.dump(sorted(existing.values(), key=lambda s: s["id"]), f, indent=1, ensure_ascii=False)
print("pronto")
