"""
Modeling tools for the vehicles of Assets Studio Maker (Blender 5.1).

A vehicle body is one subdivision cage whose faces are tagged with regions (door, hood, glass...).
Everything else is laid over that surface by casting rays at it: bumpers, flares, lamps, plates.
That way the parts follow the body exactly, whatever shape the design gives it.
"""

import os
import sys
from math import cos, pi, radians, sin

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector as V
from mathutils.bvhtree import BVHTree

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_karts as kit  # noqa: E402

# zone -> (fixed color or None when a paint tints it, finish)
ZONES = {
    "paint": (None, "gloss"),
    "trim": (None, "gloss"),
    "accent": (None, "gloss"),
    "rim": (None, "metal"),
    "band": (None, "gloss"),
    "suit": (None, None),
    "helmet": (None, "gloss"),
    "chrome": ("#dfe3e8", "metal"),
    "steel": ("#8d939c", "metal"),
    "dark_metal": ("#2a2d33", "metal"),
    "carbon": ("#14161a", "gloss"),
    "rubber": ("#1b1c1f", None),
    "plastic": ("#25272c", None),
    "seat": ("#23252b", None),
    "cabin": ("#34363c", None),
    "glass": ("#10202c", "gloss"),
    "visor": ("#0b0f16", "glass"),
    "glove": ("#23252b", None),
    "light": ("#fff4d0", "glow"),
    "tail": ("#e22636", "glow"),
    "amber": ("#ffa61a", "glow"),
    "red": ("#e02f3a", "glow"),
    "blue": ("#2f6fe0", "glow"),
    "white": ("#f1f0ea", None),
    "plate": ("#f4f4ee", None),
    "wood": ("#8a5a34", None),
    "dirt": ("#7c5f40", None),
}

KIT_ZONES = {
    "paint_primary": "paint",
    "paint_secondary": "trim",
    "paint_accent": "accent",
    "rim": "rim",
    "suit": "suit",
    "helmet": "helmet",
    "chrome": "chrome",
    "carbon": "carbon",
    "metal_dark": "dark_metal",
    "rubber": "rubber",
    "seat_fabric": "seat",
    "glass": "glass",
    "visor": "visor",
    "glove": "glove",
    "emissive_light": "light",
    "emissive_tail": "tail",
    "whitewall": "white",
}

ZONE_OF = dict(KIT_ZONES)


def mark(name, zone):
    """A material that only says which zone its faces belong to."""
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    kit.MAT[name] = material
    ZONE_OF[name] = zone
    return name


def prepare():
    kit.make_materials()
    for zone in ZONES:
        mark("z_" + zone, zone)


# --- art style --------------------------------------------------------------------------------

# "real" builds the Realista models: true proportions, narrow tires with brakes behind the spokes and a
# cabin you can see through the glass. "arcade" builds the toy versions: short, round, big wheels.
STYLE = "real"


def set_style(style):
    global STYLE
    STYLE = style


def realistic():
    """Detail that only the full Realista model has: interiors, brakes, see-through windows."""
    return STYLE == "real" and LOD == "hi"


# --- level of detail ---------------------------------------------------------------------------

# The same design scripts build every style. "hi" is the full model; "lp" asks the helpers for few
# sides, no bevels and no tiny parts, which gives a clean low poly model with flat faces.
LOD = "hi"

# Parts too small to matter in a low poly model.
TINY = {
    "wiper", "handle", "handle_bezel", "lug", "lug_nut", "nut", "bolt", "hinge", "lever", "exhaust_in", "fin_rib", "slat", "strut_bolt",
    "visor_tab", "chin_vent", "louvre", "blower_rib", "strap", "rung_small", "spark_plug", "plug_cap", "axle_nut", "hub_nut", "swing_nut", "kingpin",
    "c_bracket", "tie_rod", "steer_arm", "sw_paddle", "sw_screen", "sw_display", "buckle", "zip", "shine", "vent_slat", "knee_seam", "boot_strap", "glove_patch", "knuckle", "thumb",
}

# In blocks a thin part only leaves a dotted line behind.
THIN = {"rib", "marker", "ac_vent", "stake", "lock", "side_guard", "bay_handle", "door_grip", "door_split", "cross", "seat_strut", "pod_stay", "bumper_stay", "wing_brace", "mirror_stem", "stay", "mast"}

_originals = {}


def _skip(name):
    return name in TINY or (LOD == "vx" and name in THIN)


def _low_lathe(name, prof, segs=64, mat="rim", mat_fn=None, closed=False, mtx=None, sharp_angle=40.0, a0=0.0, a1=2 * pi):
    return _originals["lathe"](name, prof, max(6, segs // 3), mat, mat_fn, closed, mtx, None, a0, a1)


def _low_tube(name, pts, r, mat="chrome", fillet=0.06, n=12, closed=False, caps=True, radii=None, steps=5, mat_fn=None, cap_mat=None, smooth=0):
    if _skip(name):
        return None
    return _originals["tube"](name, pts, r, mat, fillet, max(4, n // 2), closed, caps, radii, 1, mat_fn, cap_mat, max(1, smooth // 3) if smooth else 0)


def _low_torus(name, R, r, mtx, mat="chrome", n_major=48, n_minor=12, mat_fn=None, rx=None):
    return _originals["torus"](name, R, r, mtx, mat, max(8, n_major // 3), 4, mat_fn, rx)


def _low_cyl(name, r, depth, loc=(0, 0, 0), direction=(0, 0, 1), mat="metal_dark", segs=32, r2=None, bevel=0.0, bsegs=2, cap_mat=None, mtx=None):
    if _skip(name):
        return None
    return _originals["cyl"](name, r, depth, loc, direction, mat, max(6, segs // 3), r2, 0.0, bsegs, cap_mat, mtx)


def _low_sphere(name, r, loc=(0, 0, 0), scale=(1, 1, 1), mat="chrome", segs=24, rings=12, mtx=None, rot=(0, 0, 0)):
    if _skip(name):
        return None
    return _originals["sphere"](name, r, loc, scale, mat, max(6, segs // 3), max(3, rings // 3), mtx, rot)


def _low_rbox(name, size, loc=(0, 0, 0), mat="paint_primary", bevel=0.01, segs=3, rot=(0, 0, 0), taper=(1.0, 1.0), mtx=None, shear_y=0.0):
    if _skip(name):
        return None
    return _originals["rbox"](name, size, loc, mat, 0.0, 1, rot, taper, mtx, shear_y)


def _low_loft(name, keys, axis="y", n=32, sub=4, t0=0.0, t1=2 * pi, closed=True, cap0=True, cap1=True, mat="paint_primary", mat_fn=None, cap_mat=None, sharp_angle=None, mtx=None):
    return _originals["loft"](name, keys, axis, max(6, n // 3), 1, t0, t1, closed, cap0, cap1, mat, mat_fn, cap_mat, None, mtx)


def _low_sweep(name, path, profile, radii=None, closed=False, up=None, caps=True, mat="chrome", mat_fn=None, cap_mat=None, sharp_angle=50.0, closed_profile=True):
    def thin(items):
        items = list(items)
        return items if len(items) <= 6 else items[::2] + ([items[-1]] if len(items) % 2 == 0 else [])

    path = thin(path)
    if radii is not None:
        radii = thin(radii)
    if isinstance(up, list):
        up = thin(up)
    if len(profile) > 8:
        profile = list(profile)[::2]
    return _originals["sweep"](name, path, profile, radii, closed, up, caps, mat, mat_fn, cap_mat, None, closed_profile)


def _low_wing(name, x0, x1, chord, thick, camber, aoa, le_y, le_z, nspan=12, n=18, mat_fn=None, dihedral=0.0):
    return _originals["wing_element"](name, x0, x1, chord, thick, camber, aoa, le_y, le_z, 2, 8, mat_fn, dihedral)


def _low_exhaust(points, r, tip_len=0.08, tip_r=None, mat="chrome", inner_mat="metal_dark"):
    end = V(points[-1])
    d = (V(points[-1]) - V(points[-2])).normalized()
    _low_tube("exhaust", list(points) + [tuple(end + d * tip_len)], r * 1.2, mat=mat, smooth=3, n=8)
    return end + d * tip_len


_LOW = {"lathe": _low_lathe, "tube": _low_tube, "torus": _low_torus, "cyl": _low_cyl, "sphere": _low_sphere, "rbox": _low_rbox, "loft": _low_loft, "sweep": _low_sweep, "wing_element": _low_wing, "exhaust_pipe": _low_exhaust}


def set_lod(level):
    """Swaps the modeling helpers for their low poly versions, or back."""
    global LOD
    if not _originals:
        _originals.update({name: getattr(kit, name) for name in _LOW})
    LOD = level
    for name in _LOW:
        setattr(kit, name, _LOW[name] if level != "hi" else _originals[name])


# --- surface ----------------------------------------------------------------------------------


class Surface:
    """Answers where a ray meets the given objects."""

    def __init__(self, *objects):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        self.trees = [BVHTree.FromObject(obj, depsgraph) for obj in objects]

    def hit(self, origin, direction):
        best = None
        for tree in self.trees:
            location, normal, _, distance = tree.ray_cast(V(origin), V(direction).normalized())
            if location is not None and (best is None or distance < best[2]):
                best = (location, normal, distance)
        return best

    def add(self, *objects):
        depsgraph = bpy.context.evaluated_depsgraph_get()
        self.trees += [BVHTree.FromObject(obj, depsgraph) for obj in objects]


def _orient(bm, outward_score):
    if outward_score < 0:
        bmesh.ops.reverse_faces(bm, faces=bm.faces)


def _object(name, bm, materials, sharp):
    kit._shade(bm, sharp)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for material in materials.names:
        mesh.materials.append(kit.MAT[material])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    kit._register(obj)
    return obj


def drape(name, surface, columns, rows, ray, mat="z_paint", fade=None, sharp=42.0):
    """A sheet lying on the surface.

    columns are the positions along the sheet. rows are (coordinate, offset[, material]) across it.
    ray(column, coordinate) gives the origin and the direction of the ray that places the point.
    fade(column) scales the offsets, so the ends of the sheet can melt into the surface.
    """
    if LOD != "hi":
        columns = list(columns)
        columns = columns[::3] + ([columns[-1]] if (len(columns) - 1) % 3 else [])
        rows = list(rows)
        rows = rows[::2] + ([rows[-1]] if (len(rows) - 1) % 2 else [])
        rows = [(row[0], row[1] * 1.5, *row[2:]) for row in rows]
    samples = [[surface.hit(*ray(column, row[0])) for row in rows] for column in columns]
    if not any(found for line in samples for found in line):
        print(f"WARNING {name} has nothing to lie on")
        return None

    def borrowed(i, j):
        """A point the rays missed takes its depth from the nearest one they hit, so it cannot fly off."""
        return min(((abs(a - i) * 4 + abs(b - j), a, b) for a, line in enumerate(samples) for b, found in enumerate(line) if found))

    materials = kit.MatList()
    bm = bmesh.new()
    grid, directions = [], []
    for i, column in enumerate(columns):
        points = []
        for index, row in enumerate(rows):
            origin, direction = ray(column, row[0])
            found = samples[i][index]
            if found:
                location, normal, _ = found
            else:
                _, a, b = borrowed(i, index)
                _, normal, distance = samples[a][b]
                location = V(origin) + V(direction).normalized() * distance
            if normal.dot(V(direction)) > 0:
                normal = -normal
            offset = row[1] * (fade(column) if fade else 1.0)
            points.append(bm.verts.new(location + normal * offset))
            direction_now = direction
        grid.append(points)
        directions.append(V(direction_now).normalized())
    score = 0.0
    for i in range(len(columns) - 1):
        for j in range(len(rows) - 1):
            face = bm.faces.new((grid[i][j], grid[i][j + 1], grid[i + 1][j + 1], grid[i + 1][j]))
            face.material_index = materials.idx(rows[j][2] if len(rows[j]) > 2 else mat)
            face.normal_update()
            score += -face.normal.dot(directions[i]) * face.calc_area()
    _orient(bm, score)
    return _object(name, bm, materials, sharp)


def resample(points, step):
    """Evenly spaced points along a closed outline."""
    pts = [V((p[0], p[1])) for p in points]
    lengths = [(pts[(i + 1) % len(pts)] - pts[i]).length for i in range(len(pts))]
    total = sum(lengths)
    count = max(6, int(total / step))
    out = []
    edge, travelled = 0, 0.0
    for k in range(count):
        target = total * k / count
        while target > travelled + lengths[edge]:
            travelled += lengths[edge]
            edge += 1
        t = (target - travelled) / max(lengths[edge], 1e-9)
        a, b = pts[edge], pts[(edge + 1) % len(pts)]
        out.append(a.lerp(b, t))
    return out


def rounded(points, radius, steps=5):
    """Rounds the corners of a polygon. A corner may be (x, y, radius) to override the radius."""
    n = len(points)
    out = []
    for i, p in enumerate(points):
        here = V((p[0], p[1]))
        r = p[2] if len(p) > 2 else radius
        before = V(points[i - 1][:2])
        after = V(points[(i + 1) % n][:2])
        if r <= 0:
            out.append(here)
            continue
        a = here + (before - here).normalized() * min(r, (before - here).length * 0.48)
        b = here + (after - here).normalized() * min(r, (after - here).length * 0.48)
        for k in range(steps + 1):
            t = k / steps
            out.append(a * (1 - t) ** 2 + here * (2 * t * (1 - t)) + b * t ** 2)
    return out


def circle(radius, count=28, sx=1.0, sy=1.0):
    return [(radius * sx * cos(2 * pi * i / count), radius * sy * sin(2 * pi * i / count)) for i in range(count)]


PATCH_REACH = 0.8


def patch(name, surface, outline, center, axis, bands, fill=None, fill_offset=None, up=(0, 0, 1), mirror=False, step=0.03, sharp=50.0):
    """A shape laid on the surface, seen along axis.

    bands are (inset, offset, material) rings, from the outline inward; a band paints the faces up to
    the next ring. fill is the material of the inside, or None to leave a hollow frame.
    """
    if LOD != "hi":
        step *= 3.0
        bands = [bands[0], *[(inset, offset + 0.006, material) for inset, offset, material in bands[-1:]]] if len(bands) > 1 else [(bands[0][0], bands[0][1] + 0.006, bands[0][2])]
    axis = V(axis).normalized()
    u = V(up).cross(axis).normalized()
    v = axis.cross(u).normalized()
    center = V(center)
    flip = -1.0 if mirror else 1.0
    points = resample(outline, step)
    area = sum(points[i].x * points[(i + 1) % len(points)].y - points[(i + 1) % len(points)].x * points[i].y for i in range(len(points)))
    if area < 0:
        points.reverse()
    n = len(points)
    normals = []
    for i in range(n):
        t = (points[(i + 1) % n] - points[i - 1]).normalized()
        normals.append(V((-t.y, t.x)))
    centroid = sum(points, V((0, 0))) / n

    last = [None, axis]

    def place(p, offset):
        origin = center + u * (p.x * flip) + v * p.y + axis * 2.5
        found = surface.hit(origin, -axis)
        # A hit far behind the center went past an edge and landed on some other part of the body.
        if found and abs((found[0] - center).dot(axis)) > PATCH_REACH:
            found = None
        if found:
            location, normal, _ = found
            if normal.dot(axis) < 0:
                normal = -normal
            last[0], last[1] = location.dot(axis), normal
        else:
            depth = last[0] if last[0] is not None else center.dot(axis)
            location = center + u * (p.x * flip) + v * p.y + axis * (depth - center.dot(axis))
        return location + last[1] * offset

    materials = kit.MatList()
    bm = bmesh.new()
    rings = []
    ring_materials = []
    for inset, offset, material in bands:
        rings.append([bm.verts.new(place(p + m * inset, offset)) for p, m in zip(points, normals)])
        ring_materials.append(material)
    if fill:
        last_inset = bands[-1][0]
        base = [p + m * last_inset for p, m in zip(points, normals)]
        offset = bands[-1][1] if fill_offset is None else fill_offset
        for s in (0.82, 0.62, 0.42, 0.22) if LOD == "hi" else (0.5,):
            rings.append([bm.verts.new(place(centroid + (p - centroid) * s, offset)) for p in base])
            ring_materials.append(fill)
        tip = bm.verts.new(place(centroid, offset))
    faces = []
    for k in range(len(rings) - 1):
        mat_index = materials.idx(ring_materials[k])
        for i in range(n):
            j = (i + 1) % n
            face = bm.faces.new((rings[k][i], rings[k][j], rings[k + 1][j], rings[k + 1][i]))
            face.material_index = mat_index
            faces.append(face)
    if fill:
        mat_index = materials.idx(fill)
        for i in range(n):
            face = bm.faces.new((rings[-1][i], rings[-1][(i + 1) % n], tip))
            face.material_index = mat_index
            faces.append(face)
    score = 0.0
    for face in faces:
        face.normal_update()
        score += face.normal.dot(axis) * face.calc_area()
    _orient(bm, score)
    return _object(name, bm, materials, sharp)


# --- cage -------------------------------------------------------------------------------------


def smoothstep(a, b, x):
    t = max(0.0, min(1.0, (x - a) / (b - a))) if a != b else (0.0 if x < a else 1.0)
    return t * t * (3 - 2 * t)


def lerp(a, b, t):
    return a + (b - a) * t


def bake_modifiers(obj):
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    obj.modifiers.clear()
    old = obj.data
    obj.data = mesh
    if old.users == 0:
        bpy.data.meshes.remove(old)


def region_object(name, bm, regions):
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for region in regions:
        mesh.materials.append(kit.MAT["R_" + region])
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.scene.collection.objects.link(obj)
    return obj


def mark_regions(regions):
    for region, zone in regions.items():
        mark("R_" + region, zone)


def cage(name, rings, face_region, regions, longitudinal=None, transverse=None, border=None, end_regions=("TAIL", "NOSE"), ends=None, subdivide=2):
    """A closed quad cage through rings of points, with semi-sharp lines.

    rings[i] is a closed list of points. face_region(i, column) names the region of a face.
    longitudinal maps a point index of the ring to a crease along the length.
    transverse maps a ring index to (crease, first column, last column).
    border maps a pair of regions to the crease of the edges between them.
    ends gives, for each end, how much the closing rings shrink and move out.
    """
    names = list(regions)
    bm = bmesh.new()
    crease = bm.edges.layers.float.new("crease_edge")
    verts = [[bm.verts.new(p) for p in ring] for ring in rings]
    count = len(rings[0])
    half = count // 2 + 1
    for i in range(len(rings) - 1):
        for j in range(count):
            j2 = (j + 1) % count
            face = bm.faces.new((verts[i][j], verts[i][j2], verts[i + 1][j2], verts[i + 1][j]))
            column = j if j < half - 1 else count - 1 - j
            face.material_index = names.index(face_region(i, column))

    # The ends close with rings, so that no long faces reach the region borders.
    for ring, region, sign in ((0, end_regions[0], -1), (len(rings) - 1, end_regions[1], 1)):
        scale, push = (ends or {}).get(sign, (0.86, 0.018))
        center = sum((v.co for v in verts[ring]), V()) / count
        previous = verts[ring]
        for s, move in ((scale, push), (scale * 0.6, push * 1.5)):
            inner = [bm.verts.new(center + (v.co - center) * V((s, 1, s)) * 1.0 + V((0, sign * move, 0))) for v in verts[ring]]
            for j in range(count):
                j2 = (j + 1) % count
                face = bm.faces.new((previous[j], previous[j2], inner[j2], inner[j]))
                face.material_index = names.index(region)
            previous = inner
        face = bm.faces.new(previous)
        face.material_index = names.index(region)

    bm.edges.ensure_lookup_table()
    for j, value in (longitudinal or {}).items():
        mirrored = count - j
        for column in {j, mirrored % count}:
            for i in range(len(rings) - 1):
                edge = bm.edges.get((verts[i][column], verts[i + 1][column]))
                if edge:
                    edge[crease] = value
    for i, (value, first, last) in (transverse or {}).items():
        for j in range(count):
            j2 = (j + 1) % count
            column = j if j < half - 1 else count - 1 - j
            if first <= column <= last:
                edge = bm.edges.get((verts[i][j], verts[i][j2]))
                if edge:
                    edge[crease] = value
    if border:
        border = {frozenset(pair): value for pair, value in border.items()}
        for edge in bm.edges:
            if len(edge.link_faces) == 2:
                pair = frozenset(names[f.material_index] for f in edge.link_faces)
                if len(pair) == 2 and pair in border:
                    edge[crease] = max(edge[crease], border[pair])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    obj = region_object(name, bm, regions)
    if LOD == "hi":
        modifier = obj.modifiers.new("subsurf", "SUBSURF")
        modifier.levels = subdivide
        modifier.render_levels = subdivide
        bake_modifiers(obj)
    return obj


def cut_with(obj, cutters):
    """Carves every cutter out of the body. The new walls take the cutter's region."""
    for index, cutter in enumerate(cutters):
        modifier = obj.modifiers.new(f"cut{index}", "BOOLEAN")
        modifier.operation = "DIFFERENCE"
        modifier.object = cutter
        modifier.solver = "EXACT"
        modifier.material_mode = "INDEX"
    bake_modifiers(obj)
    for cutter in cutters:
        bpy.data.objects.remove(cutter, do_unlink=True)


def _carve_object(bm, regions, region):
    index = list(regions).index(region)
    for face in bm.faces:
        face.material_index = index
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return region_object("cutter", bm, regions)


def carve_cylinder(x, y, z, radius, depth, regions, region="CARVE", segments=56):
    if LOD != "hi":
        segments = 16
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=radius, radius2=radius, depth=depth)
    bmesh.ops.transform(bm, matrix=Matrix.Translation((x, y, z)) @ Matrix.Rotation(pi / 2, 4, "Y"), verts=bm.verts)
    return _carve_object(bm, regions, region)


def carve_box(size, location, regions, region="CARVE", rotation=(0, 0, 0), bevel=0.0):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    if bevel:
        bmesh.ops.bevel(bm, geom=list(bm.edges) + list(bm.verts), offset=bevel, segments=2, profile=0.5, affect="EDGES", clamp_overlap=True)
    matrix = Matrix.Translation(location) @ Matrix.Rotation(radians(rotation[2]), 4, "Z") @ Matrix.Rotation(radians(rotation[1]), 4, "Y") @ Matrix.Rotation(radians(rotation[0]), 4, "X")
    bmesh.ops.transform(bm, matrix=matrix, verts=bm.verts)
    return _carve_object(bm, regions, region)


def finish_surface(obj, regions, pairs, insets=(("GLASS", 0.016, 0.012),), frame="FRAME", gap=0.0055, depth=0.009):
    """Opens the panel gaps and sinks the glass into the body."""
    names = list(regions)
    pairs = {frozenset(pair) for pair in pairs} if LOD == "hi" else set()
    bm = bmesh.new()
    bm.from_mesh(obj.data)
    bm.faces.ensure_lookup_table()
    frame_index = names.index(frame)
    for region, thickness, sink in insets:
        faces = [f for f in bm.faces if names[f.material_index] == region]
        if faces:
            result = bmesh.ops.inset_region(bm, faces=faces, thickness=thickness, depth=-sink, use_even_offset=True, use_boundary=False)
            for face in result["faces"]:
                face.material_index = frame_index
    edges = []
    for edge in bm.edges:
        if len(edge.link_faces) == 2:
            a, b = (names[f.material_index] for f in edge.link_faces)
            if frozenset((a, b)) in pairs:
                edges.append(edge)
    if edges:
        verts = list({v for e in edges for v in e.verts})
        result = bmesh.ops.bevel(bm, geom=edges + verts, offset=gap, offset_type="OFFSET", segments=1, profile=0.5, affect="EDGES", clamp_overlap=True)
        gap_index = names.index("GAP")
        strip = set()
        for face in result["faces"]:
            face.material_index = gap_index
            strip.update(face.verts)
        bm.normal_update()
        for v, n in [(v, v.normal.copy()) for v in strip]:
            v.co -= n * depth
    bm.to_mesh(obj.data)
    bm.free()
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=radians(36))
    if LOD != "hi":
        return
    modifier = obj.modifiers.new("simplify", "DECIMATE")
    modifier.decimate_type = "DISSOLVE"
    modifier.angle_limit = radians(1.6)
    modifier.delimit = {"MATERIAL", "SEAM", "SHARP"}
    bake_modifiers(obj)
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=radians(36))


# --- wheels -----------------------------------------------------------------------------------

R, W = 0.28, 0.24


def tire(rim, shoulder=0.05, grooves=(0.0,), depth=0.008, band=None, r=R, width=W, segs=28):
    h = width / 2
    if LOD != "hi":
        profile = kit.mirror_profile([(0.0, r), (h - shoulder * 0.6, r), (h, r - shoulder), (h, rim + 0.02), (h - 0.012, rim)])
        return kit.lathe("tire", profile, 42, mat="rubber", sharp_angle=None)
    side = rim + (r - rim) * 0.42
    half = []
    x = 0.0
    tread = h - shoulder
    for g in grooves:
        if g > 0 and g < tread:
            half += [(g - 0.012, r), (g - 0.009, r - depth), (g + 0.009, r - depth), (g + 0.012, r)]
    half = [(0.0, r)] + half if not grooves or grooves[0] != 0 else [(0.0, r - depth), (0.009, r - depth), (0.012, r)] + half
    half += [
        (tread, r - 0.001),
        (h - shoulder * 0.45, r - shoulder * 0.16),
        (h - 0.006, r - shoulder * 0.62),
        (h, r - shoulder * 1.3),
        (h + 0.002, side),
    ]
    half += [(h - 0.004, rim + 0.012), (h - 0.014, rim)]
    profile = kit.mirror_profile(half)

    def material(i):
        (x0, r0), (x1, r1) = profile[i], profile[i + 1]
        if band and x0 > 0 and x1 > 0 and band[0] <= (r0 + r1) / 2 <= band[1]:
            return "z_band"
        return "rubber"

    return kit.lathe("tire", profile, segs, mat_fn=material, sharp_angle=58.0)


def rim_shell(radius, lip="chrome", width=W, dish=0.045, segs=26):
    h = width / 2 - 0.016
    kit.lathe("barrel", [(-h, radius - 0.018), (h, radius - 0.018), (h + 0.006, radius - 0.004), (h + 0.004, radius + 0.012), (h - 0.012, radius + 0.012), (-h, radius + 0.012)], segs, mat="rim", closed=True, sharp_angle=50.0)
    kit.lathe("lip", [(h - 0.003, radius + 0.01), (h + 0.01, radius + 0.012), (h + 0.012, radius + 0.002), (h + 0.002, radius - 0.008)], segs, mat=lip, sharp_angle=55.0)
    kit.cyl("back", radius - 0.012, 0.008, (dish - h, 0, 0), (1, 0, 0), mat="metal_dark", segs=segs)


def spokes(count, keys, phase=0.0, n=6, sub=2, mat="rim"):
    for k in range(count):
        m = Matrix.Rotation(phase + 2 * pi * k / count, 4, "X")
        kit.loft("spoke", keys, axis="z", n=n, sub=sub, mat=mat, sharp_angle=55.0, mtx=m)


def hub(radius, face, cap="chrome", lugs=5, phase=0.0, depth=0.03):
    kit.lathe("hub", [(face - depth, radius), (face - 0.006, radius), (face, radius * 0.86), (face + 0.002, radius * 0.5), (face + 0.002, 0.001)], 20, mat="rim", sharp_angle=52.0)
    kit.lathe("cap", [(face, radius * 0.5), (face + 0.008, radius * 0.42), (face + 0.012, radius * 0.2), (face + 0.013, 0.001)], 16, mat=cap, sharp_angle=60.0)
    for k in range(lugs):
        m = Matrix.Rotation(phase + 2 * pi * k / lugs, 4, "X")
        kit.cyl("lug", 0.0075, 0.012, m @ V((face, 0, radius * 0.72)), (1, 0, 0), mat="chrome", segs=6)


def wheel_alloy():
    "Liga leve de dez raios, para carros."
    rim = 0.2
    face = W / 2 - 0.018
    tire(rim, grooves=(0.0, 0.045), band=(0.226, 0.238))
    rim_shell(rim)
    for s in (-1, 1):
        keys = [dict(pos=0.042, c1=face - 0.012, c2=s * 0.012, w=0.011, h=0.011, e=3.0), dict(pos=0.12, c1=face - 0.006, c2=s * 0.03, w=0.0095, h=0.009), dict(pos=rim + 0.002, c1=face - 0.006, c2=s * 0.043, w=0.0085, h=0.011)]
        spokes(5, keys)
    hub(0.054, face + 0.002, lugs=5, phase=pi / 5)


def wheel_star():
    "Estrela de cinco pontas, larga."
    rim = 0.205
    face = W / 2 - 0.016
    tire(rim, shoulder=0.04, grooves=(0.0, 0.05), band=(0.232, 0.244))
    rim_shell(rim)
    keys = [dict(pos=0.04, c1=face - 0.012, w=0.03, h=0.016, e=3.5), dict(pos=0.12, c1=face - 0.004, w=0.022, h=0.012), dict(pos=rim + 0.002, c1=face - 0.004, w=0.03, h=0.014)]
    spokes(5, keys, n=8)
    hub(0.06, face + 0.002, lugs=5, phase=pi / 5)


def wheel_slick():
    "Pneu liso e aro fino de corrida."
    rim = 0.212
    face = W / 2 - 0.014
    tire(rim, shoulder=0.04, grooves=(0.0,), band=(0.238, 0.25))
    rim_shell(rim)
    keys = [dict(pos=0.04, c1=face - 0.02, w=0.009, h=0.016, e=4.0), dict(pos=0.14, c1=face - 0.012, w=0.0075, h=0.012), dict(pos=rim + 0.002, c1=face - 0.012, w=0.0075, h=0.014)]
    spokes(10, keys, phase=pi / 10)
    hub(0.05, face + 0.002, lugs=5)


def wheel_spoke():
    "Cinco raios retos, clássica."
    rim = 0.19
    face = W / 2 - 0.026
    tire(rim, shoulder=0.055, grooves=(0.0, 0.04), band=(0.214, 0.232))
    rim_shell(rim)
    keys = [dict(pos=0.05, c1=face - 0.006, w=0.016, h=0.015, e=2.6), dict(pos=rim + 0.002, c1=face + 0.004, w=0.014, h=0.012)]
    spokes(5, keys, n=8)
    hub(0.064, face + 0.004, lugs=5, phase=pi / 5)


def wheel_turbine():
    "Pás de turbina com miolo cromado."
    rim = 0.208
    face = W / 2 - 0.012
    tire(rim, shoulder=0.042, grooves=(0.0, 0.05), band=(0.232, 0.246))
    rim_shell(rim)
    blades = 14
    for k in range(blades):
        rings = []
        base = 2 * pi * k / blades
        for i in range(4):
            t = i / 3
            radius = 0.06 + t * (rim - 0.056)
            pitch = radians(50 - 18 * t)
            chord = 0.05 + 0.014 * t
            rotation = Matrix.Rotation(base + 0.34 * t * t, 3, "X")
            ring = []
            for a, b in kit.se_pts(6, chord / 2, 0.004, 2.2):
                ring.append(rotation @ V((face - 0.018 + a * cos(pitch) - b * sin(pitch), a * sin(pitch) + b * cos(pitch), radius)))
            rings.append(ring)
        kit.loft_profile("blade", rings, mat="rim", sharp_angle=60.0)
    kit.lathe("spinner", [(face - 0.04, 0.066), (face - 0.004, 0.064), (face + 0.01, 0.046), (face + 0.024, 0.016), (face + 0.027, 0.001)], 22, mat="chrome", sharp_angle=58.0)


def wheel_neon():
    "Anel que brilha e raios finos."
    rim = 0.21
    face = W / 2 - 0.016
    tire(rim, shoulder=0.04, grooves=(0.0,), band=(0.236, 0.25))
    rim_shell(rim, lip="z_band")
    kit.torus("glow", rim - 0.024, 0.0065, kit.X_AXIS_MTX(face - 0.004), mat="z_light", n_major=36, n_minor=6)
    keys = [dict(pos=0.044, c1=face - 0.008, w=0.012, h=0.008, e=3.5), dict(pos=rim - 0.02, c1=face - 0.008, w=0.008, h=0.006)]
    spokes(6, keys, n=6, sub=1)
    kit.lathe("hub", [(face - 0.04, 0.05), (face, 0.05), (face + 0.008, 0.036), (face + 0.012, 0.001)], 20, mat="z_band", sharp_angle=50.0)


def wheel_offroad():
    "Pneu de garras e aro com bedlock."
    rim = 0.16
    face = W / 2 - 0.014
    tire(rim, r=0.262, shoulder=0.06, grooves=(0.0, 0.05), depth=0.012, band=(0.195, 0.205))
    rim_shell(rim, lip="metal_dark")
    knobs = 13
    for k in range(knobs):
        angle = 2 * pi * k / knobs
        half = pi / knobs
        for s in (-1, 1):
            a = angle + (half if s > 0 else 0.0)
            kit.rbox("knob", (0.052, 0.058, 0.034), (s * 0.052, 0, 0.272), mat="rubber", bevel=0.007, segs=1, rot=(0, 0, s * 14), taper=(0.9, 0.86), mtx=Matrix.Rotation(a, 4, "X"))
            b = angle + (0 if s > 0 else half) + half * 0.5
            kit.rbox("lug", (0.048, 0.05, 0.032), (s * 0.108, 0, 0.243), mat="rubber", bevel=0.007, segs=1, rot=(0, s * 42, 0), taper=(0.9, 0.86), mtx=Matrix.Rotation(b, 4, "X"))
    for k in range(10):
        m = Matrix.Rotation(2 * pi * k / 10, 4, "X")
        kit.cyl("bolt", 0.0065, 0.01, m @ V((face + 0.014, 0, rim + 0.002)), (1, 0, 0), mat="chrome", segs=6)
    keys = [dict(pos=0.04, c1=face - 0.014, w=0.016, h=0.024, e=4.0), dict(pos=rim + 0.002, c1=face - 0.002, w=0.012, h=0.018)]
    spokes(6, keys, n=8)
    hub(0.056, face, cap="chrome", lugs=6)


def wheel_balloon():
    "Pneu balão gordinho, aro pequeno."
    rim = 0.12
    face = W / 2 - 0.018
    half = [(0.0, R), (0.05, R - 0.002), (0.09, R - 0.014), (0.116, R - 0.048), (0.126, R - 0.095), (0.118, R - 0.13), (0.1, rim + 0.012), (0.09, rim)]
    profile = kit.mirror_profile(half)
    kit.lathe("tire", profile, 36, mat="rubber", sharp_angle=60.0)
    rim_shell(rim, width=0.2)
    kit.lathe("dish", [(face - 0.034, rim - 0.01), (face - 0.018, rim * 0.7), (face - 0.01, rim * 0.5), (face, rim * 0.34), (face + 0.012, 0.001)], 24, mat="rim", sharp_angle=60.0)
    for k in range(4):
        m = Matrix.Rotation(2 * pi * k / 4, 4, "X")
        kit.cyl("lug", 0.009, 0.01, m @ V((face - 0.006, 0, rim * 0.62)), (1, 0, 0), mat="chrome", segs=6)
    kit.torus("band", rim * 0.8, 0.0058, kit.X_AXIS_MTX(face - 0.016), mat="z_band", n_major=26, n_minor=5)


def wheel_tractor():
    "Garras altas em V, roda de máquina."
    rim = 0.15
    face = W / 2 - 0.02
    tire(rim, r=0.25, shoulder=0.06, grooves=(0.0,), band=(0.185, 0.195))
    rim_shell(rim, lip="metal_dark")
    lugs = 11
    for k in range(lugs):
        m = Matrix.Rotation(2 * pi * k / lugs, 4, "X")
        for s in (-1, 1):
            kit.rbox("lug", (0.104, 0.038, 0.05), (s * 0.052, 0.018, 0.268), mat="rubber", bevel=0.008, segs=1, rot=(0, 0, s * 30), taper=(0.94, 0.8), mtx=m)
    kit.lathe("dish", [(face - 0.036, rim - 0.01), (face - 0.014, rim * 0.62), (face, rim * 0.44), (face + 0.004, 0.001)], 24, mat="rim", sharp_angle=60.0)
    for k in range(8):
        m = Matrix.Rotation(2 * pi * k / 8, 4, "X")
        kit.cyl("hole", 0.012, 0.008, m @ V((face - 0.012, 0, rim * 0.72)), (1, 0, 0), mat="metal_dark", segs=8)
    kit.cyl("cap", 0.04, 0.03, (face + 0.006, 0, 0), (1, 0, 0), mat="chrome", segs=16, bevel=0.005, bsegs=1)


def wheel_hubcap():
    "Calota lisa, carros populares e vans."
    rim = 0.19
    face = W / 2 - 0.018
    tire(rim, shoulder=0.058, grooves=(0.0, 0.05), band=(0.215, 0.228))
    rim_shell(rim, lip="rim")
    kit.lathe("cap", [(face - 0.016, rim + 0.004), (face + 0.002, rim - 0.008), (face + 0.006, rim * 0.7), (face + 0.004, rim * 0.4), (face + 0.012, rim * 0.24), (face + 0.016, 0.001)], 32, mat="rim", sharp_angle=44.0)
    for k in range(12):
        m = Matrix.Rotation(2 * pi * k / 12, 4, "X")
        kit.rbox("vent", (0.006, 0.03, 0.044), (face + 0.004, 0, rim * 0.74), mat="metal_dark", bevel=0, mtx=m)
    kit.cyl("center", 0.03, 0.006, (face + 0.016, 0, 0), (1, 0, 0), mat="chrome", segs=16)


def wheel_truck():
    "Roda de aço com porcas, caminhões e ônibus."
    rim = 0.17
    face = W / 2 - 0.044
    tire(rim, r=0.28, shoulder=0.05, grooves=(0.0, 0.03, 0.062), depth=0.012, band=(0.204, 0.214))
    rim_shell(rim, lip="rim")
    kit.lathe("dish", [(face - 0.03, rim - 0.008), (face - 0.022, rim * 0.72), (face - 0.004, rim * 0.62), (face, 0.056), (face + 0.016, 0.05), (face + 0.016, 0.001)], 32, mat="rim", sharp_angle=44.0)
    for k in range(10):
        m = Matrix.Rotation(2 * pi * k / 10, 4, "X")
        kit.cyl("hole", 0.0125, 0.008, m @ V((face - 0.014, 0, rim * 0.72)), (1, 0, 0), mat="metal_dark", segs=8)
        kit.cyl("nut", 0.0085, 0.014, m @ V((face + 0.012, 0, 0.074)), (1, 0, 0), mat="chrome", segs=6)
    kit.lathe("cap", [(face + 0.014, 0.046), (face + 0.03, 0.04), (face + 0.05, 0.03), (face + 0.055, 0.001)], 20, mat="chrome", sharp_angle=50.0)


# Tire width of the Realista wheels, in the units of the wheel (W is the Arcade width).
REAL_WIDTH = {"caminhao": 0.16, "cravo": 0.215, "balao": 0.23, "trator": 0.23}
REAL_DEFAULT_WIDTH = 0.19
# Wheels whose spokes leave the brake in sight.
BRAKES = {"liga", "estrela", "slick", "raio", "turbina", "neon", "cravo"}


def wheel_width(name):
    """Only the full Realista wheel is narrow; the simpler styles keep the chunky tire."""
    return REAL_WIDTH.get(name, REAL_DEFAULT_WIDTH) if realistic() else W


def orient_out(objects, center=(0.0, 0.0, 0.0)):
    """Turns open surfaces, like a lathed tire, so their faces look away from the center.

    Blender cannot tell the outside of an open surface, and the editor does not draw the back of a
    face: a tire facing in loses its tread and shows the rim through it. For a closed part the
    test always passes, since the sum below is three times its volume.
    """
    origin = V(center)
    for obj in objects:
        if obj is None or obj.type != "MESH":
            continue
        mesh = obj.data
        score = sum(p.normal.dot(p.center - origin) * p.area for p in mesh.polygons)
        if score < 0:
            bm = bmesh.new()
            bm.from_mesh(mesh)
            bmesh.ops.reverse_faces(bm, faces=bm.faces)
            bm.to_mesh(mesh)
            bm.free()
            mesh.update()


def build_wheel(name):
    """A whole wheel. The outer face stays at +W/2 in every style, so it sits on the same socket."""
    with kit.Group() as g:
        WHEELS[name]()
    objects = [obj for obj in g.objs if obj is not None]
    orient_out(objects)
    width = wheel_width(name)
    if width != W:
        k = width / W
        squeeze = Matrix.Translation((W / 2 * (1 - k), 0, 0)) @ Matrix.Diagonal((k, 1.0, 1.0, 1.0))
        for obj in objects:
            obj.data.transform(squeeze)
            obj.data.update()
    inner = W / 2 - width
    rim_radius = WHEEL_RIM.get(name, 0.19)
    with kit.Group() as extra:
        # The back of the wheel is closed, so from behind it reads as a solid wheel and not a ring.
        kit.cyl("wheel_back", rim_radius + 0.004, 0.006, (inner + 0.012, 0, 0), (1, 0, 0), mat="metal_dark", segs=28 if LOD == "hi" else 10)
        if realistic() and name in BRAKES:
            disc = rim_radius * 0.8
            x = inner + width * 0.42
            kit.cyl("brake_disc", disc, 0.02, (x, 0, 0), (1, 0, 0), mat="z_steel", segs=36)
            kit.cyl("brake_hat", disc * 0.42, 0.03, (x + 0.012, 0, 0), (1, 0, 0), mat="z_dark_metal", segs=20)
            kit.rbox("caliper", (0.05, disc * 0.62, 0.05), (x + 0.004, 0, disc * 0.86), mat="z_dark_metal", bevel=0.01, segs=1)
    return objects + [obj for obj in extra.objs if obj is not None]


# Radius of the rim of each wheel, where the tire sits.
WHEEL_RIM = {"liga": 0.2, "estrela": 0.205, "slick": 0.212, "raio": 0.19, "turbina": 0.208, "neon": 0.21, "cravo": 0.16, "balao": 0.12, "trator": 0.15, "calota": 0.19, "caminhao": 0.17}

WHEELS = {
    "liga": wheel_alloy,
    "calota": wheel_hubcap,
    "caminhao": wheel_truck,
    "slick": wheel_slick,
    "cravo": wheel_offroad,
    "turbina": wheel_turbine,
    "raio": wheel_spoke,
    "neon": wheel_neon,
    "estrela": wheel_star,
    "balao": wheel_balloon,
    "trator": wheel_tractor,
}


# --- bake -------------------------------------------------------------------------------------


def bake_mesh(obj):
    """Positions and normals of every triangle, split by zone, in world space."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    evaluated = obj.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(evaluated, preserve_all_data_layers=True, depsgraph=depsgraph)
    mesh.transform(obj.matrix_world)
    if LOD != "hi":
        mesh.shade_flat()
    mesh.calc_loop_triangles()
    triangles = len(mesh.loop_triangles)
    loops = len(mesh.loops)
    corners = np.empty(triangles * 3, dtype=np.int32)
    mesh.loop_triangles.foreach_get("loops", corners)
    corners = corners.reshape(-1, 3)
    materials = np.empty(triangles, dtype=np.int32)
    mesh.loop_triangles.foreach_get("material_index", materials)
    vertex_of = np.empty(loops, dtype=np.int32)
    mesh.loops.foreach_get("vertex_index", vertex_of)
    positions = np.empty(len(mesh.vertices) * 3, dtype=np.float64)
    mesh.vertices.foreach_get("co", positions)
    positions = positions.reshape(-1, 3)
    normals = np.empty(loops * 3, dtype=np.float64)
    mesh.corner_normals.foreach_get("vector", normals)
    normals = normals.reshape(-1, 3)
    names = [m.name for m in mesh.materials]
    result = {}
    for index, name in enumerate(names):
        chosen = materials == index
        if chosen.any():
            tri = corners[chosen].reshape(-1)
            result.setdefault(ZONE_OF[name], []).append((positions[vertex_of[tri]], normals[tri]))
    bpy.data.meshes.remove(mesh)
    return result


def collect(objects):
    zones = {}
    for obj in objects:
        if obj.type == "MESH":
            for zone, parts in bake_mesh(obj).items():
                zones.setdefault(zone, []).extend(parts)
    return {zone: (np.concatenate([p for p, _ in parts]), np.concatenate([n for _, n in parts])) for zone, parts in zones.items()}


def transformed(zones, matrix):
    m = np.array(matrix.to_3x3())
    t = np.array(matrix.translation)
    inverse = np.linalg.inv(m).T
    out = {}
    for zone, (p, n) in zones.items():
        q = p @ m.T + t
        k = n @ inverse.T
        k /= np.maximum(np.linalg.norm(k, axis=1, keepdims=True), 1e-9)
        if np.linalg.det(m) < 0:
            q = q.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3)
            k = k.reshape(-1, 3, 3)[:, ::-1].reshape(-1, 3)
        out[zone] = (q, k)
    return out


def merged(*groups):
    zones = {}
    for group in groups:
        for zone, data in group.items():
            zones.setdefault(zone, []).append(data)
    return {zone: (np.concatenate([p for p, _ in parts]), np.concatenate([n for _, n in parts])) for zone, parts in zones.items()}


def triangles(zones):
    return sum(len(p) // 3 for p, _ in zones.values())


# Small features would disappear in a majority vote, so they count for more.
VOTE_WEIGHT = {"light": 9.0, "tail": 9.0, "amber": 9.0, "red": 9.0, "blue": 9.0, "plate": 5.0, "glass": 4.0, "visor": 4.0, "chrome": 3.0, "steel": 2.0, "dark_metal": 1.5, "rubber": 1.5, "white": 4.0, "accent": 4.0, "trim": 4.0, "rim": 2.0, "wood": 4.0}


def voxelize(zones, size, samples=18.0):
    """Turns a model into blocks of the given size, one zone per block, with merged faces."""
    names = list(zones)
    random = np.random.default_rng(7)
    everything = np.concatenate([p for p, _ in zones.values()])
    low = np.floor(everything.min(axis=0) / size).astype(int) - 1
    high = np.floor(everything.max(axis=0) / size).astype(int) + 2
    shape = high - low
    votes = np.zeros((*shape, len(names)), dtype=np.float32)
    for index, name in enumerate(names):
        tris = zones[name][0].reshape(-1, 3, 3)
        a, b, c = tris[:, 0], tris[:, 1], tris[:, 2]
        areas = 0.5 * np.linalg.norm(np.cross(b - a, c - a), axis=1)
        counts = np.maximum(4, np.ceil(areas / (size * size) * samples)).astype(int)
        which = np.repeat(np.arange(len(tris)), counts)
        r1, r2 = random.random((2, len(which)))
        flip = r1 + r2 > 1
        r1[flip], r2[flip] = 1 - r1[flip], 1 - r2[flip]
        points = a[which] + (b[which] - a[which]) * r1[:, None] + (c[which] - a[which]) * r2[:, None]
        cells = np.floor(points / size).astype(int) - low
        np.add.at(votes[..., index], (cells[:, 0], cells[:, 1], cells[:, 2]), VOTE_WEIGHT.get(name, 1.0))

    solid = votes.max(axis=-1) > 0
    zone = votes.argmax(axis=-1)
    # Air flows in from the outside; whatever it cannot reach is the inside of the model.
    outside = np.zeros(shape, dtype=bool)
    outside[0, :, :] = outside[-1, :, :] = True
    outside[:, 0, :] = outside[:, -1, :] = True
    outside[:, :, 0] = outside[:, :, -1] = True
    outside &= ~solid
    while True:
        grown = outside.copy()
        grown[1:, :, :] |= outside[:-1, :, :]
        grown[:-1, :, :] |= outside[1:, :, :]
        grown[:, 1:, :] |= outside[:, :-1, :]
        grown[:, :-1, :] |= outside[:, 1:, :]
        grown[:, :, 1:] |= outside[:, :, :-1]
        grown[:, :, :-1] |= outside[:, :, 1:]
        grown &= ~solid
        if grown.sum() == outside.sum():
            break
        outside = grown

    result = {name: ([], []) for name in names}
    for axis in range(3):
        u_axis, v_axis = (axis + 1) % 3, (axis + 2) % 3
        for direction in (1, -1):
            neighbor = np.roll(outside, -direction, axis=axis)
            exposed = solid & neighbor
            for slice_index in np.nonzero(exposed.any(axis=(u_axis, v_axis)))[0]:
                taken = np.take(exposed, slice_index, axis=axis)
                labels = np.take(zone, slice_index, axis=axis)
                # After np.take the remaining axes keep their order; put u first and v second.
                if u_axis > v_axis:
                    taken, labels = taken.T, labels.T
                mask = np.where(taken, labels, -1)
                plane = (slice_index + (1 if direction > 0 else 0) + low[axis]) * size
                for u0, v0, u1, v1, label in _rectangles(mask):
                    corners = np.zeros((4, 3))
                    corners[:, axis] = plane
                    corners[:, u_axis] = ((np.array([u0, u1, u1, u0]) + low[u_axis]) * size)
                    corners[:, v_axis] = ((np.array([v0, v0, v1, v1]) + low[v_axis]) * size)
                    order = [0, 1, 2, 0, 2, 3] if direction > 0 else [0, 2, 1, 0, 3, 2]
                    normal = np.zeros(3)
                    normal[axis] = direction
                    bucket = result[names[label]]
                    bucket[0].append(corners[order])
                    bucket[1].append(np.tile(normal, (6, 1)))
    return {name: (np.concatenate(p), np.concatenate(n)) for name, (p, n) in result.items() if p}


def _rectangles(mask):
    """Greedy merge of a 2D grid of labels into rectangles: (u0, v0, u1, v1, label)."""
    mask = mask.copy()
    size_u, size_v = mask.shape
    for u in range(size_u):
        for v in range(size_v):
            label = mask[u, v]
            if label < 0:
                continue
            v_end = v + 1
            while v_end < size_v and mask[u, v_end] == label:
                v_end += 1
            u_end = u + 1
            while u_end < size_u and (mask[u_end, v:v_end] == label).all():
                u_end += 1
            mask[u:u_end, v:v_end] = -1
            yield u, v, u_end, v_end, int(label)


# --- preview ----------------------------------------------------------------------------------


def preview_material(zone, paints):
    name = "preview_" + zone
    material = bpy.data.materials.get(name)
    if material:
        return material
    material = bpy.data.materials.new(name)
    material.use_nodes = True
    node = next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    color, finish = ZONES[zone]
    code = color or paints.get(zone, "#c8c8c8")
    linear = [((int(code[i:i + 2], 16) / 255) ** 2.2) for i in (1, 3, 5)]
    node.inputs["Base Color"].default_value = (*linear, 1)
    node.inputs["Roughness"].default_value = {"gloss": 0.22, "metal": 0.24, "glass": 0.08, "glow": 0.4}.get(finish, 0.72)
    node.inputs["Metallic"].default_value = 1.0 if finish == "metal" else 0.0
    if finish == "glow":
        node.inputs["Emission Color"].default_value = (*linear, 1)
        node.inputs["Emission Strength"].default_value = 2.2
    return material


def show(zones, offset, paints):
    for zone, (p, n) in zones.items():
        mesh = bpy.data.meshes.new(zone)
        count = len(p)
        mesh.from_pydata((p + offset).tolist(), [], [(i, i + 1, i + 2) for i in range(0, count, 3)])
        mesh.materials.append(preview_material(zone, paints))
        mesh.shade_smooth()
        mesh.normals_split_custom_set(n.tolist())
        bpy.context.scene.collection.objects.link(bpy.data.objects.new(zone, mesh))


def setup_studio():
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.image_settings.file_format = "PNG"
    world = bpy.data.worlds.new("w")
    world.use_nodes = True
    background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
    background.inputs[0].default_value = (0.42, 0.47, 0.56, 1)
    background.inputs[1].default_value = 0.7
    scene.world = world
    sun = bpy.data.objects.new("s", bpy.data.lights.new("s", "SUN"))
    sun.data.energy = 3.2
    sun.rotation_euler = (radians(48), radians(12), radians(35))
    scene.collection.objects.link(sun)
    bm = bmesh.new()
    bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=80)
    mesh = bpy.data.meshes.new("floor")
    bm.to_mesh(mesh)
    bm.free()
    material = bpy.data.materials.new("floor")
    material.use_nodes = True
    next(n for n in material.node_tree.nodes if n.type == "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.2, 0.22, 0.25, 1)
    mesh.materials.append(material)
    scene.collection.objects.link(bpy.data.objects.new("floor", mesh))


def render(path, view, target, distance, size=(1500, 900), lens=70):
    scene = bpy.context.scene
    scene.render.resolution_x, scene.render.resolution_y = size
    scene.render.filepath = path
    data = bpy.data.cameras.new("c")
    data.lens = lens
    camera = bpy.data.objects.new("c", data)
    scene.collection.objects.link(camera)
    direction = V(view).normalized()
    camera.location = V(target) + direction * distance
    camera.rotation_euler = (-direction).to_track_quat("-Z", "Y").to_euler()
    scene.camera = camera
    bpy.ops.render.render(write_still=True)
    bpy.data.objects.remove(camera, do_unlink=True)
