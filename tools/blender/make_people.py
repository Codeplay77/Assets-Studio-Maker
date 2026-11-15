# Makes the Realista people with MPFB (MakeHuman for Blender) and its CC0 system assets.
#
#   blender --factory-startup -b --python tools/blender/make_people.py -- <out> [body,body,...] [mochila]
#
# With "mochila" at the end, only the backpacks are made again, and the rest of <out> is kept.
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
from mathutils.kdtree import KDTree

args = sys.argv[sys.argv.index("--") + 1:]
OUT = os.path.abspath(args[0])
ONLY = set(args[1].split(",")) if len(args) > 1 and args[1] else None
BACKPACK_ONLY = len(args) > 2 and args[2] == "mochila"

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
    # The cap's slogan, at the bottom middle of its crown.
    "toigo_maga_hat": [((0.38, 0.875, 0.63, 0.955), (0.0, -0.10))],
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


def surface(surface_id, name, source, material, *, size=1024, tint=None, cutout=False, rough=0.85, white_margin=False):
    """
    Writes a surface once: the color (made neutral when the part's color tints it), the relief and
    an arm image. `tint` is None to keep the colors, or the even level and whether to go gray.
    `white_margin` says the image has a white ground around its pieces, which is not cloth.
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
        cloth = color[..., 3] > 0.5
        if white_margin:
            cloth &= color[..., :3].min(axis=2) < 0.92
        color[..., :3] = neutral(color[..., :3], cloth, level, gray)
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


# --- cap and backpack ----------------------------------------------------------------------------
#
# The cap is a baseball cap from the MakeHuman community's CC0 "hats01" pack (toigo_maga_hat, by
# MargaretToigo), fitted to every body like the other clothes, its slogan painted out, and lifted
# over the hair that fits under a cap. MakeHuman has no backpack, so it is built here for every body:
# the bag on the back, its straps over the shoulders and under the arms, in the editor's tiling
# cotton laid in meters, so it keeps its real size and takes the color chosen for the part. Every
# point moves with the bones of the skin under it: the bag with the chest, the straps with the
# shoulders.

CLOTH = 0.264  # One tile of the editor's cotton, in meters.
NO_CAP = {"afro01"}
# Too full for a fedora: the editor gives a person in one other hair (see realPerson.ts).
NO_HAT = {"afro01", "bob01"}
STRAPS = "#2b2d31"
TORSO = {"pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "clavicle_l", "clavicle_r"}


def vertex_normals(points, triangles):
    normals = np.zeros_like(points)
    a, b, c = points[triangles[:, 0]], points[triangles[:, 1]], points[triangles[:, 2]]
    face = np.cross(b - a, c - a)
    for k in range(3):
        np.add.at(normals, triangles[:, k], face)
    return normals / np.maximum(np.linalg.norm(normals, axis=1, keepdims=True), 1e-9)


def grid(rows, cols, wrap=False, start=0):
    """Triangles joining `rows` rows of `cols` points, each row after the other, facing out."""
    tris = []
    span = cols if wrap else cols - 1
    for r in range(rows - 1):
        for c in range(span):
            a = start + r * cols + c
            b = start + r * cols + (c + 1) % cols
            tris += [(a, b, a + cols), (b, b + cols, a + cols)]
    return tris


def cloth_piece(points, triangles, uvs, joints, weights):
    """A piece for write_block, from points in Blender's space; its normals follow its faces."""
    triangles = np.array(triangles, dtype=np.int64)
    normals = vertex_normals(points, triangles)
    return {
        "positions": to_editor(points.astype(np.float32)),
        "normals": to_editor(normals.astype(np.float32)),
        "uvs": np.asarray(uvs, dtype=np.float32),
        "joints": np.asarray(joints, dtype=np.uint8),
        "weights": np.asarray(weights, dtype=np.float32),
        "indices": triangles.reshape(-1).astype(np.uint32),
    }


def planar_uv(points, normals):
    """Cloth laid from the side each point faces, in tiles, as the editor lays it on blocks."""
    uv = np.zeros((len(points), 2), dtype=np.float32)
    for i, (p, n) in enumerate(zip(points, normals)):
        ax, ay, az = abs(n[0]), abs(n[1]), abs(n[2])
        if az >= ax and az >= ay:
            uv[i] = (p[0], p[1])
        elif ax >= ay:
            uv[i] = (p[1], p[2])
        else:
            uv[i] = (p[0], p[2])
    return uv / CLOTH


CAP = "toigo_maga_hat"
CAP_TRIANGLES = 1800


def lift_over(data, cover, center, gap=0.004):
    """
    Pushes a hat out where hair would come through it: each point goes as far out from the head's
    middle as the hair reaches in its direction, and the push spreads smoothly to its neighbors, so
    the hat keeps its shape and only rises over the hair.
    """
    points = data["co"]
    offsets = cover - center
    distance = np.linalg.norm(offsets, axis=1)
    unit = offsets / distance[:, None]
    ray = points - center
    reach = np.linalg.norm(ray, axis=1)
    ray /= reach[:, None]
    cone = math.cos(math.radians(6))
    need = np.zeros(len(points))
    for i in range(len(points)):
        near = unit @ ray[i] > cone
        if near.any():
            need[i] = max(0.0, distance[near].max() + gap - reach[i])
    neighbors = [set() for _ in range(len(points))]
    for a, b, c in data["tri_vertices"]:
        neighbors[a].update((b, c))
        neighbors[b].update((a, c))
        neighbors[c].update((a, b))
    neighbors = [list(near) for near in neighbors]
    average = lambda values: np.array([values[near].mean() if near else 0.0 for near in neighbors])
    # The push spreads out and fades away from where it is needed, then is smoothed, so the crown
    # rises in one gentle swell instead of a bump at every strand.
    push = need.copy()
    for _ in range(40):
        push = np.maximum(need, 0.92 * average(push))
    for _ in range(8):
        push = np.maximum(0.5 * (push + average(push)), need)
    data["co"] = points + ray * push[:, None]


def under_hat(hat, hair, center, cone_degrees=4.0):
    """
    For each hair point, how far out the hat reaches in its direction, seen from the head's middle,
    and how far the hair does; -inf where the hat does not cover that direction.
    """
    hat = hat - center
    reach = np.linalg.norm(hat, axis=1)
    unit = (hat / reach[:, None]).astype(np.float32)
    ray = hair - center
    distance = np.linalg.norm(ray, axis=1)
    ray = (ray / distance[:, None]).astype(np.float32)
    covered = (ray @ unit.T) > math.cos(math.radians(cone_degrees))
    return np.where(covered, reach[None, :], -np.inf).max(axis=1), distance


def crown_of(points, center):
    """
    A hat's crown, as a mask of its points no farther from the head's axis than its top half
    reaches, and a filter for the points above the crown's lower edge. The edge is not level (a
    fedora tilts), so it is looked up in the direction of each point round the head: what is
    below it shows under the brim, as it should.
    """
    across = np.linalg.norm((points - center)[:, :2], axis=1)
    upper = points[:, 2] > np.median(points[:, 2])
    mask = across <= across[upper].max() + 0.005
    crown = points[mask]
    bins = 36
    sector = lambda p: ((np.arctan2(p[:, 1] - center[1], p[:, 0] - center[0]) + np.pi) / (2 * np.pi) * bins).astype(int) % bins
    lowest = np.full(bins, np.inf)
    np.minimum.at(lowest, sector(crown), crown[:, 2])
    lowest = np.minimum(lowest, np.minimum(np.roll(lowest, 1), np.roll(lowest, -1)))
    return mask, lambda cover: cover[cover[:, 2] > lowest[sector(cover)] + 0.003]


def fit_stiff(data, cover, center, gap=0.004, most_lift=0.015, most_size=1.12):
    """
    Fits a stiff hat over the hair the way one is worn: it rises a little and is made a little
    larger, evenly, so it keeps its shape. Within those limits it takes what leaves the least hair
    sticking out of its crown, for `lift_over` to cover with a gentle swell.
    """
    points = data["co"]
    if len(cover) > 6000:
        cover = cover[np.random.default_rng(1).choice(len(cover), 6000, replace=False)]
    best = None
    for lift in np.arange(0.0, most_lift + 1e-6, 0.0025):
        for size in np.arange(1.0, most_size + 1e-6, 0.01):
            moved = center + (points - center) * size + np.array([0.0, 0.0, lift])
            mask, above = crown_of(moved, center)
            reach, distance = under_hat(moved[mask], above(cover), center)
            sticking = (distance - reach - gap)[np.isfinite(reach)]
            worst = float(sticking.max()) if len(sticking) else 0.0
            cost = max(worst, 0.0) + 0.5 * (lift + 0.11 * (size - 1))
            if best is None or cost < best[0]:
                best = (cost, lift, size, worst)
    _, lift, size, worst = best
    data["co"] = center + (points - center) * size + np.array([0.0, 0.0, lift])
    print(f"   chapéu erguido {lift * 100:.1f} cm e {round((size - 1) * 100)}% maior; resta {max(worst, 0) * 100:.1f} cm de cabelo")


def poking(data, hair, center, cone_degrees=4.0):
    """How many hair points stick out of a hat: farther from the head's middle than the hat is in their direction."""
    hat = data["co"] - center
    reach = np.linalg.norm(hat, axis=1)
    unit = hat / reach[:, None]
    ray = hair - center
    distance = np.linalg.norm(ray, axis=1)
    ray /= distance[:, None]
    cone = math.cos(math.radians(cone_degrees))
    count = 0
    for i in range(len(hair)):
        near = unit @ ray[i] > cone
        if near.any() and distance[i] > reach[near].max() + 0.001:
            count += 1
    return count


def superquadric(center, half, roundness=0.35, around=32, up=16, taper=0.0):
    """A rounded box: a superellipsoid of half sizes `half`, narrower toward the top by `taper`."""
    points, normals = [], []
    for i in range(up + 1):
        v = -math.pi / 2 + math.pi * i / up
        for j in range(around + 1):
            u = 2 * math.pi * j / around
            power = lambda value: math.copysign(abs(value) ** roundness, value)
            x = half[0] * power(math.cos(v)) * power(math.cos(u))
            y = half[1] * power(math.cos(v)) * power(math.sin(u))
            z = half[2] * power(math.sin(v))
            narrow = 1 - taper * max(0.0, z / half[2])
            points.append(center + np.array([x * narrow, y * narrow, z]))
    points = np.array(points)
    return points, grid(up + 1, around + 1)


def make_backpack(body_id, skeleton, base, armature):
    """
    A backpack on the upper back, its straps from the top of the bag over the shoulders, down the
    chest and back under the arms to the bottom corners, 2.5 cm off the skin so a shirt fits under.
    The bag leans with the back and sinks a little into it, so it rests on the clothes instead of
    hanging off them.

    It moves with the trunk only. The bag is one rigid piece on the chest's bone: blending it between
    the bones of the spine would bend it out of shape when the back bends. The straps follow the skin
    of the trunk near them, never the arms, so they do not stretch toward a raised arm, and toward
    their ends they move more and more with the bag, so they stay sewn to it.
    """
    world = armature.matrix_world
    bone_at = lambda name: np.array(world @ armature.pose.bones[name].head)
    left, right = bone_at("upperarm_l"), bone_at("upperarm_r")
    shoulders = max(left[2], right[2])
    size = min(1.15, max(0.6, abs(left[0] - right[0]) / 0.34))
    points, normals = base["co"], base["normals"]
    dominant = np.array([SOURCE_BONES[j] for j in base["joints"][:, 0]])
    torso = np.isin(dominant, list(TORSO))
    body = points[torso]
    body_normals = normals[torso]
    body_joints = base["joints"][torso]
    body_weights = base["weights"][torso]

    def trunk_weights(indices, bones):
        """The weights of skin points of the trunk, added up, keeping only `bones`."""
        total = {}
        for i in indices:
            for joint, weight in zip(body_joints[i], body_weights[i]):
                if weight > 0 and SOURCE_BONES[joint] in bones:
                    total[int(joint)] = total.get(int(joint), 0.0) + float(weight)
        amount = sum(total.values())
        return {joint: weight / amount for joint, weight in total.items()}

    def packed(mix, count):
        """Four bones and their weights, the strongest ones, for `count` points."""
        strongest = sorted(mix.items(), key=lambda item: -item[1])[:4]
        amount = sum(weight for _, weight in strongest)
        joints = np.zeros((count, 4), dtype=np.uint8)
        weights = np.zeros((count, 4), dtype=np.float32)
        for k, (joint, weight) in enumerate(strongest):
            joints[:, k] = joint
            weights[:, k] = weight / amount
        return joints, weights

    def column(x, z, reach=0.03):
        return body[(np.abs(body[:, 0] - x) < reach) & (np.abs(body[:, 2] - z) < reach)]

    back_zone = body[(np.abs(body[:, 0]) < 0.10 * size) & (body[:, 2] < shoulders - 0.05 * size) & (body[:, 2] > shoulders - 0.40 * size)]
    bag_mix = {BONE_INDEX["spine_03"]: 1.0}
    back = back_zone[:, 1].max()  # The back is toward +Y in Blender.
    width, height, depth = 0.30 * size, 0.40 * size, 0.14 * size
    top = shoulders - 0.03 * size
    bottom = top - height
    face = back - 0.008
    # How far back the back is at each height of the bag, as a straight line the bag leans along.
    heights = np.linspace(bottom + 0.03, top - 0.03, 8)
    profile = []
    for h in heights:
        level = back_zone[np.abs(back_zone[:, 2] - h) < 0.025]
        profile.append(level[:, 1].max() if len(level) else back)
    slope, intercept = np.polyfit(heights, profile, 1)

    def lean(p):
        p = np.array(p, dtype=float)
        if p.ndim == 1:
            return p + np.array([0.0, slope * p[2] + intercept - back, 0.0])
        return p + np.stack([np.zeros(len(p)), slope * p[:, 2] + intercept - back, np.zeros(len(p))], axis=1)

    bag_points, bag_tris = superquadric(np.array([0.0, face + depth / 2, top - height / 2]), (width / 2, depth / 2, height / 2), taper=0.12)
    bag_points = lean(bag_points)
    bag_normals = vertex_normals(bag_points, np.array(bag_tris))
    pocket_points, pocket_tris = superquadric(np.array([0.0, face + depth * 0.93, bottom + height * 0.28]),
                                              (width * 0.36, depth * 0.16, height * 0.21), roundness=0.4, around=24, up=12)
    pocket_points = lean(pocket_points)
    pocket_normals = vertex_normals(pocket_points, np.array(pocket_tris))
    joints, weights = packed(bag_mix, len(bag_points))
    bag = cloth_piece(bag_points, bag_tris, planar_uv(bag_points, bag_normals), joints, weights)
    joints, weights = packed(bag_mix, len(pocket_points))
    pocket = cloth_piece(pocket_points, pocket_tris, planar_uv(pocket_points, pocket_normals), joints, weights)

    tree = KDTree(len(body))
    for i, p in enumerate(body):
        tree.insert(Vector(p), i)
    tree.balance()
    on_bag = KDTree(len(bag_points))
    for i, p in enumerate(bag_points):
        on_bag.insert(Vector(p), i)
    on_bag.balance()

    strap_points, strap_tris, strap_uvs, strap_joints, strap_weights = [], [], [], [], []
    for sign in (1, -1):
        mid_y = (left[1] + right[1]) / 2
        x1 = sign * 0.10 * size
        shoulder_top = column(x1, shoulders, 0.04)
        shoulder_top = shoulder_top[np.abs(shoulder_top[:, 1] - mid_y) < 0.06]
        x2, z2 = sign * 0.12 * size, shoulders - 0.10 * size
        x3, z3 = sign * 0.15 * size, shoulders - 0.20 * size
        z4 = shoulders - 0.27 * size
        side = body[(np.abs(body[:, 2] - z4) < 0.03) & (np.abs(body[:, 1] - mid_y) < 0.05) & (np.sign(body[:, 0]) == sign)]
        controls = [
            lean([sign * 0.055 * size, face + 0.012, top - 0.025]),
            np.array([x1, mid_y + 0.02, shoulder_top[:, 2].max() + 0.02]),
            np.array([x2, column(x2, z2)[:, 1].min() - 0.025, z2]),
            np.array([x3, column(x3, z3)[:, 1].min() - 0.025, z3]),
            np.array([sign * (np.abs(side[:, 0]).max() + 0.02), mid_y + 0.03, z4]),
            # Into the side of the bag, not flat on the back, where a loose shirt would cover it.
            lean([sign * (width / 2 - 0.02), face + depth * 0.3, bottom + 0.07]),
        ]
        # A smooth path through the controls (Catmull-Rom), laid on the body.
        path = []
        padded = [controls[0], *controls, controls[-1]]
        steps = 10
        for i in range(1, len(padded) - 2):
            p0, p1, p2, p3 = padded[i - 1], padded[i], padded[i + 1], padded[i + 2]
            for s in range(steps):
                t = s / steps
                path.append(0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t ** 3))
        path.append(controls[-1])
        count = len(path)
        laid, outward, holds = [], [], []
        for i, p in enumerate(path):
            t = i / (count - 1)
            hold = min(1.0, t / 0.12, (1 - t) / 0.12)
            hold = hold * hold * (3 - 2 * hold)
            holds.append(hold)
            # The average of the skin near the point, not one vertex, so the strap does not zigzag.
            near = tree.find_n(Vector(p), 12)
            q = np.mean([body[i] for _, i, _ in near], axis=0)
            n = np.mean([body_normals[i] for _, i, _ in near], axis=0)
            n /= max(np.linalg.norm(n), 1e-9)
            # Off the skin, and further on the way back to the bag, where a T-shirt hangs loose.
            ease = min(1.0, max(0.0, (t - 0.68) / 0.14))
            off = 0.025 + 0.02 * ease * ease * (3 - 2 * ease)
            laid.append(p + (q + n * off - p) * hold)
            bag_side = np.array([0.0, 1.0, 0.0])
            out = bag_side + (n - bag_side) * hold
            outward.append(out / np.linalg.norm(out))
        for _ in range(3):
            laid = [laid[0]] + [(laid[i - 1] + 2 * laid[i] + laid[i + 1]) / 4 for i in range(1, count - 1)] + [laid[-1]]
            outward = [outward[0]] + [(outward[i - 1] + 2 * outward[i] + outward[i + 1]) / 4 for i in range(1, count - 1)] + [outward[-1]]
            outward = [n / np.linalg.norm(n) for n in outward]
        base_index = len(strap_points)
        length = 0.0
        for i, p in enumerate(laid):
            if i:
                length += np.linalg.norm(laid[i] - laid[i - 1])
            ahead = laid[min(i + 1, count - 1)] - laid[max(i - 1, 0)]
            across = np.cross(ahead, outward[i])
            across /= max(np.linalg.norm(across), 1e-9)
            half = 0.0225 * size
            for offset, lift in ((half, 0.002), (-half, 0.002), (-half, -0.002), (half, -0.002)):
                strap_points.append(p + across * offset + outward[i] * lift)
                strap_uvs.append((length / CLOTH, offset / CLOTH))
            skin = trunk_weights([k for _, k, _ in tree.find_n(Vector(p), 12)], TORSO)
            # Wherever the strap runs by the bag, it moves with the bag, fading out over 10 cm.
            away = min(1.0, max(0.0, (on_bag.find(Vector(p))[2] - 0.01) / 0.1))
            follow = min(holds[i], away * away * (3 - 2 * away))
            mix = {joint: follow * skin.get(joint, 0.0) + (1 - follow) * bag_mix.get(joint, 0.0) for joint in {*skin, *bag_mix}}
            joints, weights = packed(mix, 4)
            strap_joints += list(joints)
            strap_weights += list(weights)
        for i in range(count - 1):
            a, b = base_index + 4 * i, base_index + 4 * (i + 1)
            for k in range(4):
                c, d = k, (k + 1) % 4
                strap_tris += [(a + c, b + c, a + d), (a + d, b + c, b + d)]
        # Close the ends, both ways: they are 4 mm by 4.5 cm and seen from either side.
        for a in (base_index, base_index + 4 * (count - 1)):
            strap_tris += [(a, a + 1, a + 2), (a, a + 2, a + 3), (a + 2, a + 1, a), (a + 3, a + 2, a)]
    straps = cloth_piece(np.array(strap_points), strap_tris, strap_uvs, strap_joints, strap_weights)

    write_block(
        f"rz.pessoa.{body_id}.mochila",
        [({"surface": "cotton", "tint": True}, bag), ({"surface": "cotton", "tint": True}, pocket),
         ({"surface": "cotton", "tint": False, "color": STRAPS}, straps)],
        skeleton,
    )


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
    if BACKPACK_ONLY:
        make_backpack(body_id, skeleton, mesh_data(basemesh, armature), armature)
        return

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
    brow_top = float(mesh_data(brow, armature)["co"][:, 2].max())

    under_cap = []
    under_hat_points = []
    hair_points = {}
    for hair in HAIRS[sex]:
        obj = add(basemesh, f"hair/{hair}/{hair}.mhclo", "Hair")
        material = material_of(f"hair/{hair}/{hair}.mhclo")
        hair_surface = surface(f"mh.cabelo.{hair}", "Cabelo", f"hair/{hair}", material, tint=(0.8, True), cutout=True, rough=0.55)
        data = mesh_data(obj, armature)
        write_block(f"rz.pessoa.{body_id}.cabelo_{hair}", [({"surface": hair_surface, "tint": True}, piece(data, visible(data)))], skeleton)
        # An afro does not fit under a cap: the editor gives a capped person other hair.
        if hair not in NO_CAP:
            under_cap.append(data["co"])
            hair_points[hair] = data["co"][data["co"][:, 2] > brow_top - 0.02]
        if hair not in NO_HAT:
            under_hat_points.append(data["co"])
        remove(basemesh, obj)

    bare = mesh_data(basemesh, armature)
    dominant = np.array([SOURCE_BONES[j] for j in bare["joints"][:, 0]])
    head = bare["co"][(dominant == "head") & (bare["weights"][:, 0] > 0.8)]
    cover = np.vstack(under_cap) if under_cap else head
    cover = cover[cover[:, 2] > brow_top - 0.02]
    obj = add(basemesh, f"clothes/{CAP}/{CAP}.mhclo", "Clothes")
    reduce(obj, CAP_TRIANGLES)
    cap = surface("mh.bone", "Boné", f"clothes/{CAP}", clothes_material(CAP), tint=(0.8, True), rough=0.9, white_margin=True)
    data = mesh_data(obj, armature)
    width = head[:, 0].max() - head[:, 0].min()
    middle = np.array([head[:, 0].mean(), head[:, 1].mean(), head[:, 2].max() - 0.6 * width])
    lift_over(data, cover, middle)
    report = {hair: poking(data, points, middle) for hair, points in hair_points.items()}
    print(f"   cabelo fora do boné: {report}")
    write_block(f"rz.pessoa.{body_id}.bone", [({"surface": cap, "tint": True}, piece(data, visible(data)))], skeleton)
    remove(basemesh, obj)
    make_backpack(body_id, skeleton, bare, armature)

    if group != "crianca":
        obj = add(basemesh, "clothes/fedora01/fedora01.mhclo", "Clothes")
        reduce(obj, HAT_TRIANGLES)
        hat = surface("mh.chapeu.fedora01", "Chapéu", "clothes/fedora01", clothes_material("fedora01"), tint=(0.8, True), rough=0.9)
        data = mesh_data(obj, armature)
        # The fedora is stiff: it rises over the hair worn with it and is made a little larger, and
        # only then gives a little where some strand still comes through.
        worn = np.vstack(under_hat_points) if under_hat_points else head
        worn = worn[worn[:, 2] > brow_top - 0.02]
        fit_stiff(data, worn, middle)
        # Only hair above the crown's lower edge: what hangs below the brim stays there.
        lift_over(data, crown_of(data["co"], middle)[1](worn), middle)
        report = {hair: poking(data, points, middle) for hair, points in hair_points.items() if hair not in NO_HAT}
        print(f"   cabelo fora do chapéu: {report}")
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
