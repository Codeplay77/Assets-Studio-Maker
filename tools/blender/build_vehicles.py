"""
Assets Studio Maker -- vehicles for the Arcade style (Blender 5.1).

    blender -b --factory-startup --python tools/blender/build_vehicles.py -- [names...] [--preview out.png]
"""

import json
import os
import sys
import tempfile
from math import asin, atan2, cos, degrees, pi, radians, sin

import bpy
import numpy as np
from mathutils import Matrix, Vector as V

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import build_karts as kit  # noqa: E402
import kart_designs as designs  # noqa: E402
import vehicle_kit as vk  # noqa: E402
from vehicle_kit import Surface, carve_box, carve_cylinder, circle, cut_with, drape, finish_surface, lerp, mark, patch, rounded, smoothstep  # noqa: E402

REGIONS = {
    "BOTTOM": "carbon", "SILL": "paint", "NOSE": "paint", "FENDER": "paint", "DOOR_F": "paint",
    "DOOR_R": "paint", "QUARTER": "paint", "TAIL": "paint", "HOOD": "paint", "COWL": "plastic",
    "ROOF": "paint", "TRUNK": "paint", "RAIL": "paint", "PILLAR": "carbon", "GLASS": "glass",
    "STRIPE": "trim", "GAP": "carbon", "CARVE": "rubber", "FRAME": "rubber",
}

GAPS = [
    ("FENDER", "DOOR_F"), ("DOOR_F", "DOOR_R"), ("DOOR_R", "QUARTER"), ("DOOR_F", "QUARTER"),
    ("DOOR_F", "SILL"), ("DOOR_R", "SILL"), ("HOOD", "FENDER"), ("HOOD", "NOSE"), ("HOOD", "STRIPE"),
    ("TRUNK", "QUARTER"), ("TRUNK", "TAIL"), ("FENDER", "NOSE"), ("QUARTER", "TAIL"), ("TRUNK", "STRIPE"),
    ("HOOD", "COWL"), ("FENDER", "SILL"),
]

CREASE = {
    ("GLASS", "RAIL"): 1.0, ("GLASS", "ROOF"): 1.0, ("GLASS", "PILLAR"): 1.0, ("GLASS", "DOOR_F"): 1.0, ("GLASS", "DOOR_R"): 1.0,
    ("GLASS", "QUARTER"): 1.0, ("GLASS", "COWL"): 1.0, ("GLASS", "TRUNK"): 1.0, ("GLASS", "STRIPE"): 1.0, ("GLASS", "FENDER"): 1.0,
    ("PILLAR", "RAIL"): 1.0, ("PILLAR", "DOOR_F"): 1.0, ("PILLAR", "DOOR_R"): 1.0, ("PILLAR", "QUARTER"): 1.0,
    ("COWL", "FENDER"): 0.9, ("HOOD", "COWL"): 0.9, ("HOOD", "FENDER"): 0.75, ("HOOD", "NOSE"): 0.6,
    ("TRUNK", "QUARTER"): 0.75, ("TRUNK", "TAIL"): 0.7, ("ROOF", "RAIL"): 0.55,
    ("FENDER", "NOSE"): 0.5, ("QUARTER", "TAIL"): 0.5,
}

# --- cage ------------------------------------------------------------------------------------


def section(s):
    """Half a cross-section, from the bottom center to the top center, as (x, z) points."""
    w, wr, zb, zs, zsh, zr, g = s["w"], s["wr"], s["zb"], s["zs"], s["zsh"], s["zr"], s["g"]
    box = s.get("box", 0.0)
    low = [
        (0.0, zb),
        (w * 0.62, zb),
        (w * lerp(0.93, 0.985, box), zb + 0.008),
        (w * lerp(0.985, 1.0, box), zs),
        (w * 1.0, lerp(zs, zsh, 0.6)),
        (w * lerp(0.982, 1.0, box), zsh - 0.055),
        (w * lerp(0.955, 0.995, box), zsh),
    ]
    hood = [
        (w * lerp(0.9, 0.97, box), zsh + (zr - zsh) * 0.5),
        (w * lerp(0.76, 0.92, box), zsh + (zr - zsh) * 0.82),
        (w * 0.44, zsh + (zr - zsh) * 0.97),
        (min(0.16, w * 0.3), zr - 0.001),
        (0.0, zr),
    ]
    top = s.get("gt", 0.9)
    cabin = [
        (lerp(w * lerp(0.965, 0.995, box), wr, 0.86 * top / 0.9), zsh + (zr - 0.055 - zsh) * top),
        (wr, zr - 0.05),
        (wr * 0.62, zr - 0.01),
        (min(0.16, wr * 0.3), zr - 0.001),
        (0.0, zr),
    ]
    return low + [(lerp(h[0], c[0], g), lerp(h[1], c[1], g)) for h, c in zip(hood, cabin)]


def post_y(d, y_rr, y_rf):
    """Where the B pillar stands, always clear of the stations at the ends of the roof."""
    margin = 0.09 + d.get("pillar", 0.05) + 0.015
    share = d.get("b")
    # Unless a design says otherwise, the front door is as long as a real one.
    wanted = lerp(y_rr, y_rf, share) if share is not None else d["L"] / 2 - d["hood"] - d.get("front_door", 1.08)
    return max(y_rr + margin, min(y_rf - margin, wanted))


def stations_for(d):
    """Cross-sections from the tail to the nose. Windows and doors are split at these stations."""
    L = d["L"] / 2
    hw = d["W"] / 2
    zb = d["zb"]
    zs = zb + d.get("sill", 0.15)
    y_cowl = L - d["hood"]
    y_rf = y_cowl - d["ws"]
    y_rr = y_rf - d["roof"]
    y_d0 = y_rr - d["rw"]
    y_b = post_y(d, y_rr, y_rf)
    y_hl = L - d.get("hl", 0.3)
    wr = d["roof_w"]
    n, hl, cowl, belt, roof, deck, tail = d["h_nose"], d["h_hl"], d["h_cowl"], d["h_belt"], d["h_roof"], d["h_deck"], d["h_tail"]
    crown = d.get("crown", 0.05)
    waist = d.get("waist", 0.985)
    box = d.get("box", 0.0)
    open_top = d.get("open", False)
    cabin = 0.0 if open_top else 1.0
    out = []

    glass_top = d.get("glass_top", 0.9)

    def st(key, y, zr, zsh, w, g, bottom=None):
        out.append(dict(key=key, y=y, zr=zr, zsh=zsh, w=w, wr=wr, g=g * cabin, box=box, gt=glass_top, zb=zb if bottom is None else bottom, zs=zs if bottom is None else max(zs, bottom + 0.12)))

    if open_top:
        roof = belt + 0.015

    tail_y = -L
    room = y_d0 - tail_y
    if d.get("flat_back"):
        st("T0", tail_y, roof - 0.035, belt, hw * waist * d.get("tail_w", 0.97), 1, zb + d.get("tail_up", 0.1))
        st("T1", tail_y + 0.08, roof - 0.012, belt, hw * waist, 1, zb + 0.03)
    else:
        st("T0", tail_y, tail - 0.012, tail - 0.1, hw * d.get("tail_w", 0.9), 0, zb + d.get("tail_up", 0.1))
        st("T1", tail_y + 0.08, tail + 0.012, tail - 0.04, hw * 0.975, 0, zb + 0.03)
    if room > 0.42:
        st("D2", tail_y + room * 0.42, lerp(tail, deck, 0.82) + 0.01, lerp(tail, belt, 0.7) - 0.02, hw * 0.996, 0)
        st("D1", y_d0 - 0.08, deck + 0.01, belt - 0.012, hw, 0)
    # An upright rear window keeps the shape of the roof all the way down, or its glass buckles.
    upright = d["rw"] < 0.35
    st("D0", y_d0, deck + 0.02, belt, hw * waist if upright else hw, 1 if upright else 0.06)
    st("RW", lerp(y_d0, y_rr, 0.5), lerp(deck, roof, 0.5 if upright else 0.62), belt, hw * waist if upright else hw, 1 if upright else 0.62)
    st("R3", y_rr, roof - 0.018, belt, hw * waist, 1)
    st("R2", y_rr + 0.09, roof - 0.006, belt, hw * waist, 1)
    posts = sorted([(y_b, "B", d.get("pillar", 0.05))] + [(lerp(y_rr, y_rf, f), f"P{i}", d.get("pillar", 0.05)) for i, f in enumerate(d.get("pillars", ()))])
    for y, name, half in posts:
        st(name + "0", y - half, roof, belt, hw * waist, 1)
        st(name + "1", y + half, roof, belt, hw * waist, 1)
    st("R1", y_rf - 0.09, roof - 0.006, belt, hw * waist, 1)
    st("R0", y_rf, roof - 0.02, belt, hw * waist, 1)
    if d.get("ws_glass"):
        share = d["ws_glass"]
        st("WG", lerp(y_cowl, y_rf, share), lerp(cowl, roof, share + (1 - share) * 0.35), belt - 0.002, hw * lerp(waist, 1, 1 - share), lerp(0.6, 1, share))
    st("W1", lerp(y_rf, y_cowl, 0.5), lerp(roof, cowl, 0.56), belt - 0.003, hw * lerp(waist, 1, 0.5), 0.6)
    st("C0", y_cowl, cowl + 0.012, belt - 0.008, hw, 0.05)
    st("C1", y_cowl + 0.08, cowl + 0.003, belt - 0.012, hw, 0)
    if y_hl > y_cowl + 0.2:
        st("H1", lerp(y_cowl, y_hl, 0.5), lerp(cowl, hl, 0.48) + crown * 0.3, lerp(belt, hl, 0.4) - 0.03, hw, 0)
    st("N2", max(y_hl, y_cowl + 0.13), hl + crown * 0.12, hl - 0.06, hw * 0.99, 0)
    st("N1", L - 0.08, lerp(hl, n, 0.72), n - 0.05, hw * 0.955, 0, zb + 0.02)
    st("N0", L, n - 0.018, n - 0.1, hw * d.get("nose_w", 0.88), 0, zb + 0.09)
    return out


def region_for(d, stations):
    keys = [s["key"] for s in stations]
    order = {key: index for index, key in enumerate(keys)}
    doors = d.get("doors", 4)
    stripes = d.get("stripes", False)
    open_top = d.get("open", False)
    windows = d.get("windows", True)
    posts = {key[:-1] for key in keys if key[0] == "P" and key[-1] == "0"}
    pick = max if d.get("sliding") else min
    last_post = pick(posts, key=lambda post: order[f"{post}0"]) if posts else None

    def within(a, low, high):
        return order[low] <= order[a] < order[high]

    def region(index, column):
        a = keys[index]
        if column <= 1:
            return "BOTTOM"
        if column == 2:
            return "SILL" if within(a, "D0", "C0") else "FENDER" if within(a, "C0", "N0") else "QUARTER"
        if column in (3, 4, 5):
            if within(a, "C0", "N0"):
                return "FENDER"
            if within(a, "B1", "C0"):
                return "DOOR_F"
            if within(a, "B0", "B1"):
                return "DOOR_R" if doors == 4 else "DOOR_F"
            if within(a, "R3", "B0"):
                # On a long roof the rear door ends at the last pillar, and the body goes on behind it.
                if doors == 4 and last_post and within(a, "R3", f"{last_post}0"):
                    return "QUARTER"
                return "DOOR_R" if doors == 4 else "QUARTER"
            return "QUARTER"
        if column == 6:
            if open_top:
                return "FENDER" if within(a, "C0", "N0") else "QUARTER"
            if d.get("no_side_glass"):
                return "RAIL"
            if within(a, "B0", "B1"):
                return "PILLAR" if doors == 4 else "GLASS" if windows else "RAIL"
            if any(within(a, f"{p}0", f"{p}1") for p in posts):
                return "PILLAR"
            if within(a, "B1", "C0"):
                return "GLASS" if windows or doors == 2 else "RAIL"
            if within(a, "R3", "B0"):
                return "GLASS" if windows else "RAIL"
            if within(a, "RW", "R3") and d.get("quarter_glass"):
                return "GLASS"
            if within(a, "RW", "C0"):
                return "RAIL"
            return "FENDER" if within(a, "C0", "N0") else "QUARTER"
        if within(a, "C1", "N1"):
            return "STRIPE" if column == 10 and stripes else "HOOD"
        if within(a, "N1", "N0"):
            return "NOSE"
        if within(a, "C0", "C1"):
            return "COWL" if column >= 8 else "FENDER"
        if open_top:
            return "STRIPE" if column == 10 and stripes else "TRUNK"
        if "WG" in order and within(a, "R0", "WG"):
            return "ROOF" if column >= 8 else "RAIL"
        if within(a, "R0", "C0"):
            return "GLASS" if column >= 8 else "RAIL"
        if within(a, "R3", "R0"):
            if column == 7:
                return "RAIL"
            return "STRIPE" if column == 10 and stripes else "ROOF"
        if within(a, "D0", "R3"):
            return "GLASS" if column >= 8 and d.get("rear_glass", True) else "RAIL" if column == 7 else "ROOF"
        return "STRIPE" if column == 10 and stripes else "TRUNK"

    return region


def build_body(d, axles):
    fit_grille(d)
    regions = dict(REGIONS)
    regions.update(d.get("regions", {}))
    vk.mark_regions(regions)
    stations = stations_for(d)
    keys = [s["key"] for s in stations]
    rings = []
    for s in stations:
        half = section(s)
        rings.append([V((-x, s["y"], z)) for x, z in half] + [V((x, s["y"], z)) for x, z in reversed(half[1:-1])])
    index = {key: i for i, key in enumerate(keys)}
    box = d.get("box", 0.0)
    obj = vk.cage(
        "body",
        rings,
        region_for(d, stations),
        regions,
        longitudinal={3: 0.5, 4: 0.55, 6: 0.92 if box < 0.5 else 1.0, 8: 0.45 + box * 0.5},
        transverse={
            index["C0"]: (0.85, 7, 11),
            index["R0"]: (0.7, 7, 11),
            index["R3"]: (0.7 + box * 0.3, 7, 11),
            index["D0"]: (0.85, 7, 11),
            index["N0"]: (0.35 + box * 0.5, 2, 11),
            index["T0"]: (0.35 + box * 0.5, 2, 11),
        },
        border=CREASE,
        subdivide=d.get("subdivide", 2),
    )
    surface = Surface(obj)
    surface.owner = obj
    hw = d["W"] / 2
    cutters = []
    for axle in axles:
        y, r = axle[:2]
        for s in (-1, 1):
            cutters.append(carve_cylinder(s * (hw - 0.14), y, r, r * ARCH, 0.58, regions))
    grille = d.get("grille")
    if grille and d.get("grille_style", "bars") != "slots":
        w, h, z = grille
        cutters.append(carve_box((w, 0.3, h), (0, d["L"] / 2 + 0.03, z), regions, bevel=min(h, w) * 0.2))
    if d.get("bed"):
        L = d["L"] / 2
        front = L - d["hood"] - d["ws"] - d["roof"] - d["rw"] - 0.06
        back = -L + 0.1
        bottom = d["zb"] + 0.36
        top = d["h_deck"] + 0.5
        cutters.append(carve_box((d["W"] - 0.18, front - back, top - bottom), (0, (front + back) / 2, (top + bottom) / 2), regions, bevel=0.012))
    for size, location in d.get("carve", ()):
        cutters.append(carve_box(size, location, regions, bevel=0.012))
    cut_with(obj, cutters)
    gaps = [] if d.get("toy") else [pair for pair in GAPS if not (d.get("bed") and "TRUNK" in pair)]
    finish_surface(obj, regions, gaps)
    return obj, surface


# --- Arcade -------------------------------------------------------------------------------------

# How far a wheel arch reaches past the tire. Arcade trucks and buses are built with wider arches,
# then shrunk around their wheels (see toy_finish).
ARCH = 1.18
TOY_SCALE = 0.86
TOY_ARCH = 1.18 / TOY_SCALE * 1.03


def set_arch(scaled):
    global ARCH
    ARCH = TOY_ARCH if scaled and vk.STYLE == "arcade" else 1.18


def toy_car(d):
    """The Arcade version of a car: short, with big wheels at the corners, a tall round cabin and
    chunky fenders, like a toy. The fine details of a real car are left out."""
    t = dict(d)
    r = d["r"]
    nr = r * 1.2
    wheelbase = (d["front"] - d["rear"]) * 0.84
    over_f = max(nr * 1.18 + 0.2, (d["L"] / 2 - d["front"]) * 0.72)
    over_r = max(nr * 1.18 + 0.2, (d["L"] / 2 + d["rear"]) * 0.72)
    L = wheelbase + over_f + over_r
    k = L / d["L"]
    t.update(L=L, r=nr, front=L / 2 - over_f)
    t["rear"] = t["front"] - wheelbase
    for key in ("hood", "ws", "roof", "rw"):
        t[key] = d[key] * k
    t["front_door"] = d.get("front_door", 1.08) * k
    low = (nr - r) * 0.8
    for key in ("zb", "h_nose", "h_hl"):
        t[key] = d[key] + low
    for key in ("h_cowl", "h_belt", "h_deck", "h_tail"):
        t[key] = d[key] + low + 0.04
    t["h_roof"] = d["h_roof"] + low + 0.1
    for key in ("tail_z", "rear_bumper", "rear_glass_bottom", "side_z", "bumper_z"):
        if key in d:
            t[key] = d[key] + low + 0.02
    if d.get("grille"):
        w, h, z = d["grille"]
        t["grille"] = (w * 1.06, h * 1.2, z + low)
    if d.get("carve"):
        t["carve"] = [((sx, sy * k, sz), (x, y * k, z + low + 0.04)) for (sx, sy, sz), (x, y, z) in d["carve"]]
    t["W"] = d["W"] * 1.05
    t["roof_w"] = d["roof_w"] * 1.08
    t["box"] = d.get("box", 0.0) * 0.55
    t["crown"] = max(d.get("crown", 0.05), 0.08)
    t["waist"] = min(d.get("waist", 0.985), 0.95)
    t["nose_w"] = d.get("nose_w", 0.88) * 0.95
    t["tail_w"] = d.get("tail_w", 0.9) * 0.95
    t["flare"] = max(d.get("flare", 0.03), 0.07) + 0.015
    t["flare_lift"] = max(d.get("flare_lift", 0.012), 0.035)
    t["bumper_depth"] = 0.05
    t["mirror"] = 1.0
    if "lamp_r" in d:
        t["lamp_r"] = d["lamp_r"] * 1.3
    t["lamp_size"] = tuple(v * 1.25 for v in d.get("lamp_size", (0.3, 0.15)))
    t["tail_h"] = d.get("tail_h", 0.42) * 1.1
    t["toy"] = True
    return t


def toy_finish(objects, axles, hw, extra, r):
    """Arcade trucks and buses: the body shrinks around wheels that keep their size, so the wheels
    look big, and it rises so the axles stay at the height of the wheel centers."""
    s = TOY_SCALE
    lift = r * (1 - s)
    matrix = Matrix.Translation((0, 0, lift)) @ Matrix.Scale(s, 4)
    for obj in objects:
        if obj is not None:
            obj.data.transform(matrix)
            obj.data.update()
    axles = [(axle[0] * s, axle[1], *axle[2:]) for axle in axles]
    moved = {}
    for key, value in (extra or {}).items():
        moved[key] = value * s + lift if key == "king" else (value[0] * s, value[1] * s + lift)
    return objects, axles, hw * s, moved


# --- details ---------------------------------------------------------------------------------


def around(center_y, facing=1):
    """Rays that come from outside the vehicle and point at a vertical axis on its center line."""

    def ray(angle, z):
        d = V((sin(angle), facing * cos(angle), 0))
        return V((0, center_y, z)) + d * 8.0, -d

    return ray


def angles(limit, count):
    return [radians(-limit + 2 * limit * i / (count - 1)) for i in range(count)]


def bumper(surface, center, end, half_width, top, bottom, depth=0.03, count=36, mat="z_paint", lip="z_plastic", name="bumper"):
    """A bumper wrapped around one end. It stops at the height of `end`, next to the wheel arch."""
    limit = degrees(atan2(half_width, abs(end - center)))
    span = top - bottom
    rows = [
        (top + 0.016, -0.012, mat),
        (top, depth * 0.5, mat),
        (top - span * 0.08, depth * 0.95, mat),
        (top - span * 0.26, depth, mat),
        (top - span * 0.46, depth * 1.08, mat),
        (top - span * 0.66, depth * 0.98, lip),
        (top - span * 0.86, depth * 0.9, lip),
        (bottom + 0.004, depth * 0.45, lip),
        (bottom - 0.012, -0.02),
    ]
    edge = radians(limit)
    fade = lambda a: lerp(-0.25, 1.0, smoothstep(edge, edge * 0.9, abs(a)))
    return drape(name, surface, angles(limit, count), rows, around(center, 1 if end > center else -1), fade=fade)


def side_ray(side):
    def ray(y, z):
        return V((side * 6.0, y, z)), V((-side, 0, 0))

    return ray


def skirt(surface, y0, y1, top, bottom, side, depth=0.02, mat="z_plastic"):
    columns = [lerp(y0, y1, i / 14) for i in range(15)]
    span = top - bottom
    rows = [(top + 0.01, -0.01, mat), (top, depth * 0.7, mat), (top - span * 0.3, depth, mat), (bottom + span * 0.2, depth, mat), (bottom, depth * 0.3, mat), (bottom - 0.008, -0.012)]
    fade = lambda y: lerp(-0.25, 1.0, smoothstep(0, 0.05, min(y - min(y0, y1), max(y0, y1) - y)))
    return drape("skirt", surface, columns, rows, side_ray(side), fade=fade)


def side_line(surface, y0, y1, z, height, side, depth=0.006, mat="z_accent"):
    """A thin line along the side: a stripe, a chrome trim, a molding."""
    columns = [lerp(y0, y1, i / 22) for i in range(23)]
    rows = [(z + height / 2 + 0.002, -0.004, mat), (z + height / 2, depth, mat), (z - height / 2, depth, mat), (z - height / 2 - 0.002, -0.004)]
    fade = lambda y: lerp(-0.25, 1.0, smoothstep(0, 0.02, min(y - min(y0, y1), max(y0, y1) - y)))
    return drape("line", surface, columns, rows, side_ray(side), fade=fade)


def arch(surface, y, z, radius, side, floor, width=0.03, lift=0.012, mat="z_paint"):
    """The lip of a wheel arch, from the bottom of the body on one side to the other."""
    start = degrees(asin(max(-1.0, min(1.0, (floor - z) / radius))))
    end = 180.0 - start

    def ray(angle, r):
        a = radians(angle)
        return V((side * 6.0, y + r * cos(a), z + r * sin(a))), V((-side, 0, 0))

    columns = [lerp(start, end, i / 28) for i in range(29)]
    rows = [(radius - 0.004, -lift * 0.6, mat), (radius + 0.0005, lift * 0.62, mat), (radius + width * 0.3, lift, mat), (radius + width * 0.7, lift * 0.74, mat), (radius + width, 0.0, mat), (radius + width + 0.01, -0.008)]
    fade = lambda a: lerp(-0.25, 1.0, smoothstep(0, 8, min(a - start, end - a)))
    return drape("arch", surface, columns, rows, ray, fade=fade)


def mirrors(hw, y, z, mat="z_paint", size=1.0):
    for s in (-1, 1):
        out = hw + 0.03 + 0.06 * size
        kit.tube("mirror_arm", [(s * (hw - 0.08), y + 0.05, z - 0.05), (s * (out - 0.04), y, z)], 0.016, mat="z_plastic", fillet=0, n=6)
        keys = [dict(pos=y - 0.06 * size, c1=s * out, c2=z + 0.01, w=0.055 * size, h=0.036 * size, e=2.6), dict(pos=y - 0.03 * size, c1=s * out, c2=z + 0.01, w=0.1 * size, h=0.06 * size), dict(pos=y + 0.035 * size, c1=s * out, c2=z + 0.01, w=0.105 * size, h=0.064 * size), dict(pos=y + 0.05 * size, c1=s * out, c2=z + 0.01, w=0.07 * size, h=0.044 * size)]
        kit.loft("mirror", keys, n=10, sub=2, mat=mat, cap_mat="z_carbon")


def handle(surface, y, z, side, width=0.15, height=0.03):
    outline = rounded([(-width / 2, -height / 2), (width / 2, -height / 2), (width / 2, height / 2), (-width / 2, height / 2)], 0.012)
    patch("handle_bezel", surface, rounded([(-width * 0.7, -height), (width * 0.7, -height), (width * 0.7, height), (-width * 0.7, height)], 0.018), (side * 0.8, y, z), (side, 0, 0), [(0, -0.002, "z_plastic"), (0.004, 0.003, "z_plastic")], fill="z_plastic", step=0.03)
    patch("handle", surface, outline, (side * 0.8, y, z), (side, 0, 0), [(0, 0.004, "z_chrome"), (0.005, 0.016, "z_chrome")], fill="z_chrome", step=0.03)


def plate(surface, y, z, sign, width=0.46, height=0.13):
    outline = rounded([(-width / 2, -height / 2), (width / 2, -height / 2), (width / 2, height / 2), (-width / 2, height / 2)], 0.012)
    patch("plate", surface, outline, (0, y, z), (0, sign, 0), [(0, 0.004, "z_plastic"), (0.006, 0.012, "z_plastic"), (0.014, 0.012, "z_plate")], fill="z_plate", step=0.06)


def box_shape(w, h, r):
    return rounded([(-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)], r)


def glow_lamp(surface, outline, center, axis, mirror, fill, rim="z_dark_metal", step=0.026):
    # A rim this thin would turn into a stray black voxel next to the lamp.
    if vk.LOD == "vx":
        rim = fill
    patch("lamp", surface, outline, center, axis, [(0, -0.003, rim), (0.008, 0.009, rim), (0.016, 0.009, fill)], fill=fill, mirror=mirror, step=step)


def headlights(d, surface):
    L, hw, style = d["L"] / 2, d["W"] / 2, d.get("lamp", "wedge")
    z = d["h_hl"] - d.get("lamp_drop", 0.15)
    for s in (-1, 1):
        flip = s < 0
        if style == "wedge":
            direction = (s * 0.55, 1.0, 0.1)
            center = (s * (hw - 0.26), L - 0.2, z)
            outline = rounded([(-0.24, -0.05), (0.2, -0.06), (0.25, 0.04), (0.08, 0.075), (-0.25, 0.05)], 0.035)
            glow_lamp(surface, outline, center, direction, flip, "z_chrome", step=0.024)
            patch("projector", surface, circle(0.04), (s * (hw - 0.33), L - 0.13, z), direction, [(0, 0.012, "z_dark_metal"), (0.008, 0.014, "z_light")], fill="z_light", mirror=flip, step=0.02)
            patch("projector", surface, circle(0.03), (s * (hw - 0.18), L - 0.25, z + 0.005), direction, [(0, 0.012, "z_dark_metal"), (0.007, 0.014, "z_light")], fill="z_light", mirror=flip, step=0.02)
        elif style == "slim":
            direction = (s * 0.5, 1.0, 0.05)
            center = (s * (hw - 0.3), L - 0.16, z + 0.06)
            outline = rounded([(-0.28, -0.022), (0.26, -0.03), (0.3, 0.02), (-0.3, 0.03)], 0.016)
            glow_lamp(surface, outline, center, direction, flip, "z_light", step=0.03)
        elif style == "round":
            direction = (s * 0.18, 1.0, 0.04)
            round_lamp(surface, s * (hw - 0.3), L, z, direction, d.get("lamp_r", 0.1))
        elif style == "square":
            direction = (s * 0.3, 1.0, 0.02)
            center = (s * (hw - 0.27), L, z)
            size = d.get("lamp_size", (0.3, 0.15))
            glow_lamp(surface, box_shape(size[0], size[1], 0.024), center, direction, flip, "z_chrome", step=0.03)
            patch("lens", surface, box_shape(size[0] * 0.42, size[1] * 0.7, 0.02), (center[0] - s * size[0] * 0.2, L, z), direction, [(0, 0.014, "z_light")], fill="z_light", mirror=flip, step=0.03)
            patch("lens", surface, box_shape(size[0] * 0.3, size[1] * 0.6, 0.02), (center[0] + s * size[0] * 0.24, L, z), direction, [(0, 0.014, "z_amber")], fill="z_amber", mirror=flip, step=0.03)


def taillights(d, surface):
    L, hw, style = d["L"] / 2, d["W"] / 2, d.get("tail", "wedge")
    z = d.get("tail_z", d["h_tail"] - d.get("tail_drop", 0.14))
    if style == "bar":
        patch("taillight", surface, box_shape(d["W"] * 0.92, 0.05, 0.02), (0, -L, z + 0.02), (0, -1, 0), [(0, -0.003, "z_dark_metal"), (0.008, 0.01, "z_dark_metal"), (0.014, 0.01, "z_tail")], fill="z_tail", step=0.05)
        return
    for s in (-1, 1):
        flip = s < 0
        if style == "wedge":
            direction = (s * 0.4, -1.0, 0.0)
            center = (s * (hw - 0.27), -L + 0.14, z)
            glow_lamp(surface, rounded([(-0.26, -0.05), (0.2, -0.055), (0.24, 0.05), (-0.27, 0.06)], 0.03), center, direction, flip, "z_tail")
        elif style == "vertical":
            direction = (s * 0.32, -1.0, 0.0)
            center = (s * (hw - 0.13), -L, z)
            glow_lamp(surface, box_shape(0.15, d.get("tail_h", 0.42), 0.03), center, direction, flip, "z_tail")
            patch("reverse", surface, box_shape(0.09, 0.05, 0.012), (s * (hw - 0.13), -L, z - 0.06), direction, [(0, 0.014, "z_white")], fill="z_white", mirror=flip, step=0.03)
        elif style == "round":
            direction = (s * 0.2, -1.0, 0.0)
            for i, x in enumerate((hw - 0.22, hw - 0.46)):
                round_lamp(surface, s * x, -L, z, direction, 0.08, lens="z_tail")
        elif style == "square":
            direction = (s * 0.25, -1.0, 0.0)
            center = (s * (hw - 0.22), -L, z)
            glow_lamp(surface, box_shape(0.34, 0.14, 0.02), center, direction, flip, "z_tail")
            patch("reverse", surface, box_shape(0.1, 0.1, 0.012), (center[0] - s * 0.1, -L, z), direction, [(0, 0.014, "z_white")], fill="z_white", mirror=flip, step=0.03)
            patch("signal", surface, box_shape(0.09, 0.1, 0.012), (center[0] + s * 0.11, -L, z), direction, [(0, 0.014, "z_amber")], fill="z_amber", mirror=flip, step=0.03)


def grille(d, surface):
    style = d.get("grille_style", "bars")
    box_dims = d.get("grille")
    if not box_dims:
        return
    L = d["L"] / 2
    w, h, z = box_dims
    if z + h / 2 > d["h_nose"] - 0.03:
        print(f"WARNING grille of {d['name']} goes over the nose")
    if style == "slots":
        count = 7
        for i in range(count):
            x = (i - (count - 1) / 2) * w / count
            patch("slot", surface, box_shape(w / count * 0.56, h, 0.02), (x, L, z), (0, 1, 0), [(0, 0.004, "z_carbon")], fill="z_carbon", step=0.04)
        return
    y = L - 0.07
    kit.rbox("grille_back", (w * 1.1, 0.02, h * 1.1), (0, y - 0.05, z), mat="z_carbon", bevel=0)
    if style == "bars":
        count = max(3, int(h / 0.042))
        for i in range(count):
            kit.rbox("bar", (w * 0.96, 0.024, 0.014), (0, y, z - h * 0.42 + i * h * 0.84 / (count - 1)), mat="z_chrome", bevel=0.005, segs=1)
    elif style == "mesh":
        for i in range(int(h / 0.05)):
            kit.rbox("bar", (w * 0.96, 0.014, 0.008), (0, y, z - h * 0.42 + i * 0.05), mat="z_plastic", bevel=0)
        for i in range(int(w / 0.07)):
            kit.rbox("bar", (0.008, 0.014, h * 0.96), (-w * 0.46 + i * 0.07, y, z), mat="z_plastic", bevel=0)
    elif style == "tall":
        count = max(5, int(w / 0.07))
        for i in range(count):
            kit.rbox("bar", (0.018, 0.024, h * 0.96), (-w * 0.44 + i * w * 0.88 / (count - 1), y, z), mat="z_chrome", bevel=0.005, segs=1)
    patch("grille_frame", surface, box_shape(w * 1.04, h * 1.1, min(h, w) * 0.18), (0, L, z), (0, 1, 0), [(0, -0.003, d.get("grille_frame", "z_chrome")), (0.005, 0.012, d.get("grille_frame", "z_chrome")), (0.018, -0.008, d.get("grille_frame", "z_chrome"))], step=0.03)


def roof_spoiler(d):
    L = d["L"] / 2
    y_rr = L - d["hood"] - d["ws"] - d["roof"]
    z = d["h_roof"] - 0.03
    w = d["roof_w"] * 1.04
    keys = [dict(pos=-w, c1=y_rr + 0.03, c2=z, w=0.01, h=0.005), dict(pos=-w * 0.96, c1=y_rr - 0.03, c2=z, w=0.13, h=0.018), dict(pos=w * 0.96, c1=y_rr - 0.03, c2=z, w=0.13, h=0.018), dict(pos=w, c1=y_rr + 0.03, c2=z, w=0.01, h=0.005)]
    kit.loft("spoiler", keys, axis="x", n=10, sub=2, mat="z_paint", sharp_angle=50.0)


def wing(d):
    L = d["L"] / 2
    z = d["h_deck"] + 0.3
    y = -L + 0.2
    w = d["W"] * 0.46
    for s in (-1, 1):
        kit.rbox("pylon", (0.02, 0.2, 0.28), (s * 0.5, y, z - 0.13), mat="z_carbon", bevel=0.006, segs=1, rot=(14, 0, 0))
        kit.rbox("endplate", (0.012, 0.32, 0.17), (s * w, y, z + 0.015), mat="z_trim", bevel=0.005, segs=1)
    keys = [dict(pos=-w, c1=y, c2=z + 0.02, w=0.155, h=0.018), dict(pos=w, c1=y, c2=z + 0.02, w=0.155, h=0.018)]
    kit.loft("wing", keys, axis="x", n=12, sub=1, mat="z_trim", sharp_angle=60.0)


def scoop(d, surface):
    L = d["L"] / 2
    y = L - d["hood"] * 0.42
    z = d["h_cowl"] + 0.03
    keys = [dict(pos=y + 0.28, c2=z - 0.03, w=0.2, h=0.02), dict(pos=y + 0.2, c2=z, w=0.21, h=0.06), dict(pos=y - 0.25, c2=z + 0.012, w=0.2, h=0.06), dict(pos=y - 0.26, c2=z + 0.012, w=0.17, h=0.04)]
    kit.loft("scoop", keys, n=14, sub=2, mat="z_trim", cap_mat="z_carbon", sharp_angle=46.0)


def roof_rails(d):
    L = d["L"] / 2
    y1 = L - d["hood"] - d["ws"] - 0.12
    y0 = y1 - d["roof"] + 0.24
    z = d["h_roof"] + 0.03
    x = d["roof_w"] * 0.9
    for s in (-1, 1):
        kit.tube("rail", [(s * x, y1 + 0.08, z - 0.06), (s * x, y1, z), (s * x, y0, z), (s * x, y0 - 0.08, z - 0.06)], 0.018, mat="z_chrome" if d.get("chrome_rails") else "z_plastic", fillet=0.06, n=8)


def roof_rack(d):
    L = d["L"] / 2
    y1 = L - d["hood"] - d["ws"] - 0.1
    y0 = y1 - d["roof"] * 0.8
    z = d["h_roof"] + 0.09
    x = d["roof_w"] * 0.9
    for s in (-1, 1):
        kit.tube("rack", [(s * x, y1, z), (s * x, y0, z)], 0.016, mat="z_plastic", fillet=0, n=8)
    for i in range(5):
        y = lerp(y0, y1, i / 4)
        kit.tube("rack", [(-x, y, z), (x, y, z)], 0.012, mat="z_plastic", fillet=0, n=6)
    for s in (-1, 1):
        for t in (0, 1):
            y = lerp(y0, y1, t)
            kit.tube("rack", [(s * x, y, z - 0.07), (s * x, y, z)], 0.014, mat="z_plastic", fillet=0, n=6)


def spare_wheel(d, r):
    L = d["L"] / 2
    kit.cyl("spare_tire", r, 0.2, (0, -L - 0.1, d["h_belt"] - 0.05), (0, 1, 0), mat="rubber", segs=24, bevel=0.03, bsegs=2)
    kit.cyl("spare_cover", r * 0.62, 0.21, (0, -L - 0.102, d["h_belt"] - 0.05), (0, 1, 0), mat="z_paint", segs=20, bevel=0.008, bsegs=1)


def bull_bar(d):
    L = d["L"] / 2
    hw = d["W"] / 2
    z0 = d["zb"] + 0.1
    z1 = d["h_nose"] + 0.08
    for s in (-1, 1):
        kit.tube("bar", [(s * (hw * 0.5), L + 0.1, z0), (s * (hw * 0.5), L + 0.12, z1 * 0.72), (s * (hw * 0.32), L + 0.13, z1), (-s * (hw * 0.32), L + 0.13, z1)], 0.024, mat="z_plastic", fillet=0.06, n=8)
    kit.tube("bar", [(-hw * 0.6, L + 0.11, d["h_nose"] - 0.22), (hw * 0.6, L + 0.11, d["h_nose"] - 0.22)], 0.026, mat="z_plastic", fillet=0, n=8)


def chrome_bumper(y, z, hw, sign):
    path = [(-hw - 0.01, y - sign * 0.22, z), (-hw * 0.82, y - sign * 0.03, z), (0, y + sign * 0.03, z), (hw * 0.82, y - sign * 0.03, z), (hw + 0.01, y - sign * 0.22, z)]
    kit.tube("chrome_bumper", path, 0.038, mat="z_chrome", n=10, smooth=5)


def cockpit(d):
    """Seats, steering wheel and windshield of an open car."""
    L = d["L"] / 2
    y_cowl = L - d["hood"]
    z = d["h_belt"]
    y_seat = y_cowl - 0.85
    for s in (-1, 1):
        x = s * 0.38
        kit.rbox("seat", (0.44, 0.48, 0.14), (x, y_seat, z - 0.3), mat="z_seat", bevel=0.04, segs=2)
        kit.rbox("seat", (0.42, 0.13, 0.56), (x, y_seat - 0.28, z - 0.03), mat="z_seat", bevel=0.05, segs=2, rot=(-12, 0, 0))
        kit.rbox("headrest", (0.22, 0.09, 0.15), (x, y_seat - 0.36, z + 0.31), mat="z_seat", bevel=0.03, segs=2, rot=(-12, 0, 0))
        kit.tube("hoop", [(x - 0.2, y_seat - 0.48, z - 0.04), (x - 0.2, y_seat - 0.48, z + 0.27), (x + 0.2, y_seat - 0.48, z + 0.27), (x + 0.2, y_seat - 0.48, z - 0.04)], 0.022, mat="z_chrome", fillet=0.1, n=8)
    kit.rbox("dash", (d["W"] * 0.82, 0.38, 0.17), (0, y_cowl - 0.2, z - 0.1), mat="z_carbon", bevel=0.03, segs=2)
    kit.torus("wheel", 0.15, 0.014, kit.mtx_of((-0.38, y_cowl - 0.42, z + 0.03), (72, 0, 0)), mat="z_carbon", n_major=20, n_minor=6)
    kit.tube("column", [(-0.38, y_cowl - 0.42, z + 0.03), (-0.38, y_cowl - 0.22, z - 0.08)], 0.016, mat="z_carbon", fillet=0, n=6)
    # Windshield frame and glass.
    half = d["W"] * 0.46
    top = z + 0.34
    y0, y1 = y_cowl + 0.02, y_cowl - 0.3
    frame = [(-half, y0, z - 0.02), (-half * 0.92, y1, top), (half * 0.92, y1, top), (half, y0, z - 0.02)]
    kit.tube("ws_frame", frame, 0.018, mat="z_chrome", fillet=0.05, n=8)
    verts = [V(frame[0]), V(frame[1]), V(frame[2]), V(frame[3])]
    bm = vk.bmesh.new()
    face = bm.faces.new([bm.verts.new(v) for v in verts])
    material = kit.MatList()
    face.material_index = material.idx("z_glass")
    vk.bmesh.ops.solidify(bm, geom=list(bm.faces), thickness=0.01)
    kit.mesh_object("ws_glass", bm, material)


# --- interior (Realista) ------------------------------------------------------------------------

# Parts of the body that are not a wall of the cabin.
NOT_LINED = ("GLASS", "FRAME", "CARVE", "GAP")


def lining(body, y0, y1, depth=0.03, z0=None):
    """The inside of the cabin: the body's own walls, copied a little inward and facing in.

    Without it the tinted glass would show the far side of the body from behind, where faces are
    not drawn, and the car would look hollow.
    """
    bm = vk.bmesh.new()
    bm.from_mesh(body.data)
    names = [material.name[2:] for material in body.data.materials]
    drop = []
    for face in bm.faces:
        center = face.calc_center_median()
        if names[face.material_index] in NOT_LINED or not (y0 <= center.y <= y1) or (z0 is not None and center.z < z0):
            drop.append(face)
    vk.bmesh.ops.delete(bm, geom=drop, context="FACES")
    bm.normal_update()
    moves = [(v, v.normal.copy()) for v in bm.verts]
    for v, n in moves:
        v.co -= n * depth
    vk.bmesh.ops.reverse_faces(bm, faces=bm.faces)
    materials = kit.MatList()
    index = materials.idx("z_cabin")
    for face in bm.faces:
        face.material_index = index
    return kit.mesh_object("lining", bm, materials, recalc=False, sharp_angle=40.0)


def car_seat(x, y, z, width=0.5, back=0.6, mat="z_seat", headrest=True):
    """A seat whose cushion top is at height z and whose backrest starts at y."""
    kit.rbox("seat_cushion", (width, 0.5, 0.13), (x, y + 0.26, z - 0.065), mat=mat, bevel=0.045, segs=2, rot=(-5, 0, 0))
    tilt = radians(16)
    center = V((x, y - sin(tilt) * back / 2, z + cos(tilt) * back / 2))
    kit.rbox("seat_back", (width * 0.95, 0.12, back), tuple(center), mat=mat, bevel=0.05, segs=2, rot=(16, 0, 0))
    if headrest:
        top = V((x, y - sin(tilt) * back, z + cos(tilt) * back))
        kit.rbox("headrest", (min(0.27, width * 0.55), 0.1, 0.17), tuple(top + V((0, -0.03, 0.1))), mat=mat, bevel=0.04, segs=2, rot=(10, 0, 0))


def bench(y, z, width, back=0.58, mat="z_seat", heads=2):
    """A rear bench: one wide cushion and backrest, with a headrest for each place."""
    car_seat(0.0, y, z, width=width, back=back, mat=mat, headrest=False)
    tilt = radians(16)
    for i in range(heads):
        x = (i - (heads - 1) / 2) * width / heads
        top = V((x, y - sin(tilt) * back, z + cos(tilt) * back))
        kit.rbox("headrest", (0.25, 0.1, 0.16), tuple(top + V((0, -0.03, 0.09))), mat=mat, bevel=0.04, segs=2, rot=(10, 0, 0))


def dashboard(y_front, y_back, z, half, driver_x, wheel_radius=0.18, wheel_tilt=62):
    """Dash across the cabin, instrument hood, steering wheel and its column."""
    depth = y_front - y_back
    keys = [
        dict(pos=y_front, c2=z - 0.04, w=half, h=0.07, e=4.0),
        dict(pos=y_back + depth * 0.3, c2=z, w=half, h=0.12, e=4.0),
        dict(pos=y_back, c2=z - 0.08, w=half * 0.98, h=0.1, e=4.0),
    ]
    kit.loft("dash", keys, n=24, sub=2, mat="z_cabin", sharp_angle=46.0)
    kit.rbox("cluster_hood", (0.4, 0.16, 0.07), (driver_x, y_back + 0.1, z + 0.12), mat="z_plastic", bevel=0.03, segs=2)
    kit.rbox("screen", (0.26, 0.03, 0.15), (0.0, y_back + 0.06, z + 0.08), mat="z_carbon", bevel=0.01, segs=1, rot=(-14, 0, 0))
    center = V((driver_x, y_back - 0.2, z - 0.02))
    kit.torus("steering_rim", wheel_radius, 0.018, kit.mtx_of(tuple(center), (wheel_tilt, 0, 0)), mat="z_plastic", n_major=28, n_minor=8)
    hub = kit.mtx_of(tuple(center), (wheel_tilt, 0, 0))
    kit.cyl("steering_hub", 0.06, 0.05, tuple(center), tuple(hub.to_3x3() @ V((0, 0, 1))), mat="z_plastic", segs=16)
    for angle in (90, 210, 330):
        a = radians(angle)
        tip = hub @ V((cos(a) * wheel_radius * 0.95, sin(a) * wheel_radius * 0.95, 0))
        kit.tube("steering_spoke", [tuple(center), tuple(tip)], 0.014, mat="z_plastic", fillet=0, n=6)
    kit.tube("steering_column", [tuple(center), tuple(center + V((0, 0.3, -0.12)))], 0.03, mat="z_plastic", fillet=0, n=8)


def car_interior(d, body):
    """Seats, dash and lining of a closed car, seen through the tinted glass of the Realista style."""
    L, hw = d["L"] / 2, d["W"] / 2
    y_cowl = L - d["hood"]
    y_rf = y_cowl - d["ws"]
    y_rr = y_rf - d["roof"]
    y_d0 = y_rr - d["rw"]
    y_b = post_y(d, y_rr, y_rf)
    floor = d["zb"] + 0.14
    roof = d["h_roof"] - 0.05
    # A seated person needs about 0.9 m from the cushion to the top of the head.
    seat_z = max(floor + 0.14, min(floor + 0.26, roof - 0.96))
    lining(body, y_d0 - (0.6 if d.get("van_rows") else 0.25), y_cowl + 0.12)
    driver = -0.38 * min(1.0, hw / 0.92)
    for x in (driver, -driver):
        car_seat(x, y_b + 0.02, seat_z, width=0.5)
    kit.rbox("console", (0.2, 0.62, 0.2), (0.0, y_b + 0.32, floor + 0.12), mat="z_plastic", bevel=0.04, segs=2)
    dash_back = max(y_b + 0.72, y_cowl - 0.5)
    dashboard(y_cowl + 0.05, dash_back, d["h_belt"] + 0.02, hw - 0.08, driver)
    rows = d.get("van_rows", 1 if d.get("doors", 4) == 4 or d["roof"] > 1.3 else 0)
    # The first rear row sits behind the front seats, but never under a sloping rear window.
    y = max(y_b - 0.95, y_rr + 0.08)
    for _ in range(rows):
        if y < y_rr - 0.02:
            break
        bench(y, seat_z - 0.02, (hw - 0.12) * 2, heads=3 if hw > 0.95 else 2)
        y -= 0.86
    if d["rw"] >= 0.35 and not d.get("bed"):
        # A sedan's parcel shelf, under the rear window.
        kit.rbox("shelf", (2 * hw - 0.2, max(0.2, y_rr - y_d0 - 0.05), 0.02), (0.0, (y_rr + y_d0) / 2 - 0.05, d["h_belt"] - 0.01), mat="z_cabin", bevel=0)


def bed(d):
    """The cargo bed of a pickup: tailgate, floor ribs, cab guard."""
    L = d["L"] / 2
    hw = d["W"] / 2
    y_d0 = L - d["hood"] - d["ws"] - d["roof"] - d["rw"]
    z = d["h_deck"]
    floor = d["zb"] + 0.36
    y0, y1 = -L + 0.1, y_d0 - 0.08
    for i in range(7):
        x = (i - 3) * (hw - 0.13) / 3.4
        kit.rbox("rib", (0.05, y1 - y0 - 0.04, 0.012), (x, (y0 + y1) / 2, floor + 0.006), mat="z_dark_metal", bevel=0)
    kit.rbox("floor", (2 * hw - 0.16, y1 - y0, 0.015), (0, (y0 + y1) / 2, floor), mat="z_plastic", bevel=0)
    for s in (-1, 1):
        kit.tube("rail", [(s * (hw - 0.07), y0, z + 0.05), (s * (hw - 0.07), y1, z + 0.05)], 0.016, mat="z_chrome", fillet=0, n=6)


def cross_mark(d, surface, door_end):
    """The cross on the sides of an ambulance, on the closed part of the body."""
    arm, half = 0.3, 0.1
    outline = [(-half, -arm), (half, -arm), (half, -half), (arm, -half), (arm, half), (half, half), (half, arm), (-half, arm), (-half, half), (-arm, half), (-arm, -half), (-half, -half)]
    y = lerp(door_end, -d["L"] / 2, 0.5)
    z = (d["h_belt"] + d["h_roof"]) / 2 + 0.06
    for s in (-1, 1):
        patch("cross", surface, outline, (s * 0.8, y, z), (s, 0, 0), [(0, 0.004, "z_accent")], fill="z_accent", step=0.04)


def rear_window_boxes(d):
    """(x, z, width, height) of the windows in the back doors."""
    hw = d["W"] / 2
    bottom = d.get("rear_glass_bottom", d["h_belt"] + 0.1)
    top = d["h_roof"] - d.get("rear_glass_gap", 0.24)
    z, h = (bottom + top) / 2, top - bottom
    if d.get("rear_windows", 2) == 2:
        return [(-hw * 0.47, z, hw * 0.76, h), (hw * 0.47, z, hw * 0.76, h)]
    return [(0.0, z, hw * d.get("rear_glass_w", 1.5), h)]


def window_holes(d):
    """In Realista the back windows are real openings, so the cabin shows through them."""
    if not vk.realistic():
        return []
    L = d["L"] / 2
    return [((w, 0.4, h), (x, -L, z)) for x, z, w, h in rear_window_boxes(d)]


def flat_back(d, surface):
    """Windows, the line between the doors, a handle and a step on a flat back."""
    L, hw, zb = d["L"] / 2, d["W"] / 2, d["zb"]
    for x, z, w, h in rear_window_boxes(d):
        if vk.realistic():
            kit.rbox("rear_glass", (w + 0.03, 0.01, h + 0.03), (x, -L + 0.016, z), mat="z_glass", bevel=0)
        else:
            patch("rear_window", surface, box_shape(w, h, 0.06), (x, -L, z), (0, -1, 0), [(0, -0.002, "z_rubber"), (0.014, 0.012, "z_rubber"), (0.028, 0.008, "z_glass")], fill="z_glass", step=0.08)
    if d.get("rear_windows", 2) == 2:
        top = d["h_roof"] - 0.09
        bottom = d.get("rear_bumper", zb + 0.4) + 0.03
        patch("door_split", surface, box_shape(0.014, top - bottom, 0.004), (0, -L, (top + bottom) / 2), (0, -1, 0), [(0, 0.003, "z_carbon")], fill="z_carbon", step=0.05)
    if d.get("rear_handle", True):
        patch("handle", surface, box_shape(0.16, 0.035, 0.012), (0.14, -L, d["h_belt"] - 0.04), (0, -1, 0), [(0, 0.004, "z_chrome"), (0.005, 0.014, "z_chrome")], fill="z_chrome", step=0.03)
    if d.get("rear_step", True):
        kit.rbox("step", (0.9, 0.22, 0.06), (0, -L - 0.06, zb + 0.16), mat="z_plastic", bevel=0.015, segs=1)


def fit_grille(d):
    """Keeps the grille on the front face, under the edge of the hood."""
    if d.get("grille"):
        w, h, z = d["grille"]
        d["grille"] = (w, h, min(z, d["h_nose"] - 0.05 - h / 2))


def round_lamp(surface, x, y, z, direction, radius, lens="z_light", ring="z_chrome"):
    """A real round lamp, standing on the surface: a metal ring and a domed lens."""
    aim = V(direction).normalized()
    found = surface.hit(V((x, y, z)) + aim * 3.0, -aim)
    point = found[0] if found else V((x, y, z))
    matrix = Matrix.Translation(point) @ V((1, 0, 0)).rotation_difference(aim).to_matrix().to_4x4()
    kit.lathe("ring", [(-0.03, radius + 0.024), (0.006, radius + 0.024), (0.018, radius + 0.016), (0.018, radius * 0.97), (0.008, radius * 0.92)], 26, mat=ring, sharp_angle=46.0, mtx=matrix)
    kit.lathe("lens", [(0.008, radius * 0.93), (0.026, radius * 0.76), (0.04, radius * 0.46), (0.046, 0.0005)], 22, mat=lens, sharp_angle=70.0, mtx=matrix)


def car_details(d, surface, axles):
    L, hw = d["L"] / 2, d["W"] / 2
    zb = d["zb"]
    trim = d.get("bumper_mat", "z_paint")
    lip = d.get("lip", "z_plastic")
    if d.get("bumpers", "body") == "body":
        r = axles[0][1] * 1.18 + 0.05
        front = bumper(surface, axles[0][0] + r - 0.36, axles[0][0] + r, hw, d["h_nose"] - d.get("bumper_gap", 0.14), zb + 0.07, depth=d.get("bumper_depth", 0.032), mat=trim, lip=lip)
        rear = bumper(surface, axles[1][0] - r + 0.36, axles[1][0] - r, hw, d.get("rear_bumper", d["h_tail"] - 0.24), zb + 0.07, depth=d.get("bumper_depth", 0.03), mat=trim, lip=lip, name="bumper_rear")
        both = Surface(surface.owner, front, rear)
    else:
        both = surface
        chrome_bumper(L + 0.03, d.get("bumper_z", zb + 0.24), hw, 1)
        chrome_bumper(-L - 0.03, d.get("bumper_z", zb + 0.26), hw, -1)

    grille(d, surface)
    headlights(d, surface)
    taillights(d, surface)

    plate(both, L, zb + d.get("plate_f", 0.28), 1)
    plate(both, -L, zb + d.get("plate_r", 0.34), -1)
    if d.get("intake", True) and d.get("bumpers", "body") == "body":
        w = d.get("intake_w", 0.5)
        patch("intake", both, rounded([(-w, -0.07), (w, -0.07), (w + 0.06, 0.06), (-w - 0.06, 0.06)], 0.03), (0, L, zb + 0.14), (0, 1, 0), [(0, 0.0, "z_plastic"), (0.012, 0.004, "z_carbon")], fill="z_carbon", step=0.06)
    if d.get("bumpers", "body") == "body":
        for s in (-1, 1):
            patch("reflector", both, box_shape(0.14, 0.032, 0.01), (s * (hw - 0.3), -L, zb + 0.22), (0, -1, 0), [(0, 0.003, "z_tail")], fill="z_tail", step=0.03)

    y_cowl = L - d["hood"]
    y_rf = y_cowl - d["ws"]
    y_rr = y_rf - d["roof"]
    y_b = post_y(d, y_rr, y_rf)
    door_z = d["h_belt"] - 0.11
    front_y, rear_y = axles[0][0], axles[1][0]
    r = axles[0][1] * 1.18 + 0.03
    for s in (-1, 1):
        skirt(surface, rear_y + r - 0.06, front_y - r + 0.06, zb + d.get("skirt_h", 0.12), zb + 0.015, s, depth=d.get("skirt_depth", 0.02), mat=d.get("skirt_mat", "z_plastic"))
        for y, radius in axles:
            arch(surface, y, radius, radius * ARCH, s, zb + 0.09, width=d.get("flare", 0.03), lift=d.get("flare_lift", 0.012), mat=d.get("flare_mat", "z_paint"))
        if d.get("toy"):
            pass
        elif d.get("doors", 4) == 4:
            pillars = d.get("pillars", ())
            handle(surface, y_b + 0.14, door_z, s)
            post = (max if d.get("sliding") else min)(pillars) if pillars else None
            handle(surface, (lerp(y_rr, y_rf, post) if post is not None else y_rr) + 0.2, door_z, s)
        elif d.get("doors", 4) == 2:
            handle(surface, y_b + 0.14, door_z, s)
        if d.get("belt_trim"):
            side_line(surface, y_rr - 0.04, y_cowl + 0.02, d["h_belt"] - 0.012, 0.018, s, depth=0.004, mat=d["belt_trim"])
        if d.get("side_stripe"):
            line_z = d.get("side_z", d["h_belt"] - 0.22)
            side_line(surface, rear_y + r + 0.012, front_y - r - 0.012, line_z, d.get("side_h", 0.05), s, depth=0.005, mat=d["side_stripe"])
    if not d.get("open"):
        mirrors(hw - 0.04, y_cowl - d["ws"] * 0.34, d["h_belt"] + 0.075, mat=d.get("mirror_mat", "z_paint"), size=d.get("mirror", 0.76))
    else:
        mirrors(hw - 0.05, y_cowl - 0.12, d["h_belt"] + 0.05, mat=d.get("mirror_mat", "z_paint"), size=0.76)

    exhaust = d.get("exhaust", 2)
    for x in {2: (-0.48, 0.48), 1: (0.48,), 4: (-0.56, -0.42, 0.42, 0.56), 0: ()}[exhaust]:
        kit.tube("exhaust", [(x, -L + 0.2, zb + 0.1), (x, -L - 0.04, zb + 0.1)], 0.036, mat="z_chrome", fillet=0, n=10)
        kit.cyl("exhaust_in", 0.028, 0.01, (x, -L - 0.04, zb + 0.1), (0, 1, 0), mat="z_carbon", segs=10)

    if not d.get("open") and not d.get("toy"):
        for s in (-1, 1):
            x0 = s * 0.12 + 0.1
            kit.tube("wiper", [(x0, y_cowl - 0.02, d["h_cowl"] + 0.03), (x0 + 0.38, y_cowl - 0.12, d["h_cowl"] + 0.11)], 0.007, mat="z_plastic", fillet=0, n=5)
        fin_y = y_rr + 0.16
        keys = [dict(pos=fin_y - 0.1, c2=d["h_roof"] + 0.01, w=0.012, h=0.01), dict(pos=fin_y - 0.03, c2=d["h_roof"] + 0.03, w=0.022, h=0.03), dict(pos=fin_y + 0.08, c2=d["h_roof"] + 0.012, w=0.02, h=0.012)]
        kit.loft("fin", keys, n=6, sub=2, mat="z_carbon")

    for extra in d.get("extras", ()):
        if extra == "roof_spoiler":
            roof_spoiler(d)
        elif extra == "wing":
            wing(d)
        elif extra == "scoop":
            scoop(d, surface)
        elif extra == "roof_rails":
            roof_rails(d)
        elif extra == "roof_rack":
            roof_rack(d)
        elif extra == "spare":
            spare_wheel(d, axles[0][1])
        elif extra == "bull_bar":
            bull_bar(d)
        elif extra == "cockpit":
            cockpit(d)
        elif extra == "bed":
            bed(d)
        elif extra == "cross":
            cross_mark(d, surface, post_y(d, y_rr, y_rf))
    if d.get("flat_back") and d.get("rear_windows", 2):
        flat_back(d, surface)


def design(name, base=None, **values):
    merged = dict(BASE)
    if base:
        merged.update(CARS[base])
    merged.update(values)
    merged["name"] = name
    return merged


BASE = dict(
    L=4.6, W=1.84, zb=0.2, hood=1.36, ws=0.8, roof=1.1, rw=0.62,
    h_nose=0.7, h_hl=0.81, h_cowl=0.95, h_belt=0.96, h_roof=1.42, h_deck=1.02, h_tail=0.97,
    roof_w=0.64, r=0.35, front=1.5, rear=-1.26, grille=(0.82, 0.13, 0.66),
)

CARS = {}
CARS["sedan"] = design("Sedã")
CARS["sedan_luxo"] = design("Sedã de luxo", L=5.0, hood=1.56, ws=0.84, roof=1.3, rw=0.6, r=0.36, front=1.72, rear=-1.42, h_nose=0.76, h_hl=0.86, h_cowl=1.0, h_belt=1.02, h_roof=1.5, h_deck=1.08, h_tail=1.03, grille=(0.72, 0.2, 0.62), grille_style="tall", belt_trim="z_chrome", exhaust=4, wheel="estrela", side_stripe="z_chrome", side_h=0.012, side_z=0.56, front_door=1.2)
CARS["hatch"] = design("Hatch", L=3.98, hood=1.02, ws=0.74, roof=1.62, rw=0.3, r=0.33, front=1.32, rear=-1.2, h_roof=1.47, h_deck=1.1, h_tail=1.06, tail="vertical", tail_h=0.32, tail_drop=0.2, exhaust=1, extras=("roof_spoiler",), wheel="calota", grille=(0.76, 0.1, 0.64), plate_r=0.36, pillars=(0.2,), tail_w=0.96)
CARS["hatch_esportivo"] = design("Hatch esportivo", base="hatch", W=1.88, r=0.35, zb=0.15, h_nose=0.64, h_hl=0.77, h_cowl=0.9, h_belt=0.91, h_roof=1.36, h_deck=1.03, h_tail=1.0, stripes=True, exhaust=2, grille_style="mesh", grille=(0.86, 0.13, 0.58), wheel="slick", side_stripe="z_accent", side_z=0.42, lip="z_trim", extras=("roof_spoiler",), grille_frame="z_carbon", intake_w=0.62, tail="wedge")
CARS["perua"] = design("Perua", L=4.75, hood=1.24, ws=0.8, roof=2.22, rw=0.2, r=0.35, front=1.56, rear=-1.32, h_roof=1.48, h_deck=1.24, h_tail=1.18, quarter_glass=True, tail="vertical", tail_drop=0.3, tail_h=0.36, extras=("roof_rails",), chrome_rails=True, pillars=(0.43,), rear_side_glass=True, exhaust=1, tail_w=0.96)
CARS["coupe"] = design("Cupê", L=4.5, hood=1.4, ws=0.92, roof=0.74, rw=0.9, doors=2, r=0.36, front=1.46, rear=-1.24, h_nose=0.62, h_hl=0.74, h_cowl=0.87, h_belt=0.89, h_roof=1.3, h_deck=0.98, h_tail=0.95, roof_w=0.6, b=0.4, stripes=True, tail="bar", wheel="estrela", side_stripe="z_accent", side_z=0.56, side_h=0.02, grille_style="mesh", grille=(0.8, 0.09, 0.56), grille_frame="z_carbon", intake_w=0.58, extras=("roof_spoiler",))
CARS["super"] = design("Superesportivo", L=4.5, W=1.98, zb=0.1, hood=1.24, ws=1.06, roof=0.56, rw=1.05, doors=2, r=0.34, front=1.42, rear=-1.32, h_nose=0.5, h_hl=0.7, h_cowl=0.82, h_belt=0.84, h_roof=1.13, h_deck=0.98, h_tail=0.95, roof_w=0.52, b=0.55, crown=0.02, stripes=True, tail="bar", lamp="slim", lamp_drop=0.1, grille=None, intake_w=0.7, exhaust=4, wheel="turbina", waist=0.93, extras=("wing",), lip="z_trim", skirt_mat="z_trim", skirt_depth=0.03, side_stripe="z_accent", side_z=0.42, side_h=0.03, plate_f=0.16, plate_r=0.26, bumper_gap=0.08)
CARS["muscle"] = design("Muscle", L=4.8, W=1.92, hood=1.7, ws=0.74, roof=0.86, rw=0.76, doors=2, r=0.37, front=1.62, rear=-1.34, h_nose=0.74, h_hl=0.84, h_cowl=0.97, h_belt=0.98, h_roof=1.36, h_deck=1.05, h_tail=1.03, roof_w=0.62, b=0.35, stripes=True, grille=(1.1, 0.14, 0.62), grille_style="mesh", grille_frame="z_carbon", tail="square", lamp="round", lamp_r=0.09, exhaust=2, wheel="raio", extras=("scoop", "roof_spoiler"))
CARS["conversivel"] = design("Conversível", L=4.45, hood=1.3, ws=0.62, roof=1.0, rw=0.5, doors=2, open=True, r=0.35, front=1.44, rear=-1.24, h_nose=0.66, h_hl=0.78, h_cowl=0.91, h_belt=0.92, h_roof=1.34, h_deck=0.98, h_tail=0.96, roof_w=0.6, b=0.4, regions={"COWL": "paint"}, carve=[((1.4, 1.5, 0.5), (0, 0.01, 1.0))], extras=("cockpit",), tail="bar", grille_style="mesh", grille_frame="z_carbon", wheel="estrela", side_stripe="z_accent", side_z=0.5, side_h=0.02)
CARS["classico"] = design("Clássico", L=4.0, W=1.74, zb=0.26, hood=1.12, ws=0.56, roof=1.12, rw=0.5, doors=2, r=0.36, front=1.32, rear=-1.26, h_nose=0.82, h_hl=0.92, h_cowl=1.02, h_belt=1.03, h_roof=1.5, h_deck=1.1, h_tail=0.94, roof_w=0.56, crown=0.1, waist=0.95, nose_w=0.7, tail_w=0.74, b=0.4, bumpers="chrome", lamp="round", tail="round", tail_drop=0.2, flare=0.075, flare_lift=0.038, grille=None, wheel="calota", exhaust=1, belt_trim="z_chrome", plate_f=0.3, plate_r=0.3, skirt_h=0.08)
CARS["eletrico"] = design("Elétrico", L=4.5, W=1.88, hood=1.18, ws=1.0, roof=1.2, rw=0.98, r=0.36, front=1.46, rear=-1.4, h_nose=0.66, h_hl=0.76, h_cowl=0.93, h_belt=0.95, h_roof=1.44, h_deck=1.05, h_tail=1.0, roof_w=0.62, crown=0.03, lamp="slim", tail="bar", grille=None, exhaust=0, intake=False, wheel="turbina", bumper_gap=0.1)
CARS["compacto"] = design("Compacto", L=3.4, W=1.66, hood=0.92, ws=0.66, roof=1.42, rw=0.16, r=0.31, front=1.02, rear=-1.02, h_nose=0.76, h_hl=0.88, h_cowl=1.0, h_belt=1.02, h_roof=1.58, h_deck=1.2, h_tail=1.16, roof_w=0.6, tail="vertical", tail_h=0.4, tail_drop=0.26, lamp="round", lamp_r=0.08, grille=(0.6, 0.08, 0.72), wheel="calota", exhaust=1, plate_r=0.32, regions={"ROOF": "trim"}, intake_w=0.4, tail_w=0.96, front_door=0.98)

CARS["suv_compacto"] = design("SUV compacto", L=4.3, W=1.84, zb=0.3, hood=1.08, ws=0.76, roof=1.96, rw=0.24, r=0.37, front=1.42, rear=-1.34, h_nose=0.86, h_hl=1.0, h_cowl=1.12, h_belt=1.14, h_roof=1.66, h_deck=1.34, h_tail=1.3, roof_w=0.66, quarter_glass=True, tail="vertical", tail_drop=0.34, tail_h=0.38, exhaust=1, grille=(0.84, 0.13, 0.84), grille_style="mesh", flare=0.07, flare_lift=0.02, flare_mat="z_plastic", skirt_h=0.2, sill=0.2, extras=("roof_rails",), plate_f=0.32, plate_r=0.42, wheel="liga", pillars=(0.33,), tail_w=0.96)
CARS["suv_medio"] = design("SUV médio", base="suv_compacto", L=4.7, W=1.9, hood=1.2, roof=2.18, rw=0.26, r=0.39, front=1.56, rear=-1.46, h_roof=1.74, h_belt=1.18, h_nose=0.9, h_hl=1.04, h_cowl=1.16, h_deck=1.4, h_tail=1.36, tail_drop=0.38, grille=(0.9, 0.2, 0.86), grille_style="bars", extras=("roof_rails",), chrome_rails=True, belt_trim="z_chrome", pillars=(0.4,), wheel="estrela")
CARS["suv_grande"] = design("SUV grande", base="suv_medio", L=5.2, W=2.0, hood=1.4, roof=2.52, rw=0.24, r=0.41, front=1.74, rear=-1.62, zb=0.34, h_nose=1.0, h_hl=1.14, h_cowl=1.26, h_belt=1.28, h_roof=1.92, h_deck=1.54, h_tail=1.5, tail_drop=0.44, roof_w=0.72, box=0.45, grille=(1.1, 0.3, 0.94), grille_style="tall", lamp="square", lamp_size=(0.34, 0.16), tail="vertical", tail_h=0.5, pillars=(0.4,), wheel="liga", extras=("roof_rails",), exhaust=2, front_door=1.2)
CARS["jipe"] = design("Jipe", L=4.1, W=1.82, zb=0.42, hood=1.1, ws=0.42, roof=2.24, rw=0.12, doors=2, r=0.42, front=1.32, rear=-1.26, h_nose=1.08, h_hl=1.16, h_cowl=1.24, h_belt=1.26, h_roof=1.86, h_deck=1.5, h_tail=1.42, roof_w=0.8, box=1.0, waist=1.0, crown=0.0, nose_w=0.97, tail_w=0.97, lamp="round", lamp_r=0.1, lamp_drop=0.12, grille=(0.76, 0.32, 0.96), grille_style="slots", tail="square", tail_drop=0.4, flare=0.12, flare_lift=0.05, flare_mat="z_plastic", bumpers="none", wheel="cravo", exhaust=1, extras=("spare", "bull_bar", "roof_rack"), plate_f=0.34, plate_r=0.42, skirt_h=0.16, skirt_mat="z_plastic", bumper_z=0.58, regions={"ROOF": "trim", "RAIL": "trim", "GLASS": "glass"}, quarter_glass=True, b=0.62)
CARS["suv_esportivo"] = design("SUV esportivo", base="suv_compacto", L=4.5, W=1.96, hood=1.2, ws=1.0, roof=1.2, rw=0.84, zb=0.3, r=0.39, front=1.5, rear=-1.34, h_nose=0.86, h_hl=1.0, h_cowl=1.14, h_belt=1.16, h_roof=1.64, h_deck=1.32, h_tail=1.28, roof_w=0.6, lamp="wedge", tail="bar", grille=(1.0, 0.16, 0.8), grille_style="mesh", grille_frame="z_carbon", exhaust=4, wheel="slick", quarter_glass=False, pillars=(), extras=("roof_spoiler",), flare_mat="z_plastic", flare=0.06, flare_lift=0.024, skirt_h=0.18, lip="z_trim")

CARS["picape"] = design("Picape", L=5.1, W=1.9, zb=0.36, hood=1.32, ws=0.7, roof=0.92, rw=0.1, doors=2, r=0.39, front=1.72, rear=-1.5, h_nose=0.98, h_hl=1.1, h_cowl=1.2, h_belt=1.22, h_roof=1.74, h_deck=1.2, h_tail=1.18, roof_w=0.72, box=0.55, b=0.3, nose_w=0.94, tail_w=0.97, tail="vertical", tail_drop=0.22, tail_h=0.3, lamp="square", grille=(1.0, 0.26, 0.92), grille_style="bars", bed=True, rear_glass=False, regions={"TRUNK": "paint"}, extras=("bed",), flare=0.06, flare_lift=0.02, flare_mat="z_plastic", wheel="liga", exhaust=1, plate_f=0.36, plate_r=0.42, skirt_h=0.14)
CARS["picape_dupla"] = design("Picape cabine dupla", base="picape", L=5.5, roof=1.5, doors=4, front=1.92, rear=-1.64, b=None, extras=("bed", "roof_rails"))
CARS["picape_classica"] = design("Picape clássica", base="picape", L=4.9, W=1.86, zb=0.38, box=0.2, roof=0.8, hood=1.3, front=1.66, rear=-1.46, bumpers="chrome", lamp="round", lamp_r=0.1, grille=(0.94, 0.2, 0.9), grille_style="tall", tail="round", wheel="calota", flare=0.1, flare_lift=0.05, flare_mat="z_paint", bumper_z=0.62, extras=("bed",))

CARS["van"] = design(
    "Van", L=5.6, W=2.0, zb=0.32, hood=0.95, ws=0.95, roof=3.5, rw=0.06, r=0.37, front=1.86, rear=-1.62,
    h_nose=1.02, h_hl=1.14, h_cowl=1.26, h_belt=1.28, h_roof=2.42, h_deck=2.4, h_tail=2.38, roof_w=0.93, box=0.72, waist=0.985, tail_w=0.985,
    crown=0.02, nose_w=0.93, front_door=1.05, doors=4, sliding=True, pillars=(0.3, 0.58), glass_top=0.74, flat_back=True, rear_windows=2, van_rows=3, ws_glass=0.8,
    lamp="square", lamp_size=(0.36, 0.2), lamp_drop=0.2, tail="vertical", tail_h=0.66, tail_z=0.98, rear_bumper=0.74, grille=(0.96, 0.26, 0.8), grille_style="mesh",
    wheel="calota", exhaust=1, plate_f=0.36, plate_r=0.52, flare=0.05, flare_lift=0.018, flare_mat="z_plastic", skirt_h=0.14, regions={"PILLAR": "carbon"},
    quarter_glass=False, mirror=1.0,
)
CARS["furgao"] = design("Furgão", base="van", windows=False, doors=2, b=None, pillars=(), sliding=False, van_rows=0, side_stripe="z_accent", side_z=1.05, side_h=0.08, regions={"PILLAR": "paint"})

CARS["ambulancia"] = design(
    "Ambulância", base="van", L=5.9, W=2.04, roof=3.8, h_roof=2.78, h_deck=2.76, h_tail=2.74, roof_w=0.97, box=0.88, windows=False, doors=2, b=None,
    pillars=(), sliding=False, van_rows=0, side_stripe="z_accent", side_z=1.04, side_h=0.2, regions={"PILLAR": "paint"}, extras=("cross",), front=1.96, rear=-1.8,
    rear_glass_bottom=1.62, rear_glass_gap=0.5,
)
CARS["policia_sedan"] = design("Sedã", regions={"DOOR_F": "trim", "DOOR_R": "trim"}, wheel="calota")
CARS["policia_suv"] = design("SUV médio", base="suv_medio", regions={"DOOR_F": "trim", "DOOR_R": "trim"}, extras=(), chrome_rails=False, belt_trim=None, wheel="liga")


def car(name):
    vk.prepare()
    set_arch(False)
    d = toy_car(CARS[name]) if vk.STYLE == "arcade" else dict(CARS[name])
    if d.get("flat_back"):
        d["carve"] = list(d.get("carve", ())) + window_holes(d)
    axles = [(d["front"], d["r"]), (d["rear"], d["r"])]
    with kit.Group() as g:
        body, surface = build_body(d, axles)
        car_details(d, surface, axles)
        if vk.realistic() and not d.get("open"):
            car_interior(d, body)
    for obj in g.objs:
        for vertex in obj.data.vertices:
            if abs(vertex.co.x) > d["W"] / 2 + 0.6 or abs(vertex.co.y) > d["L"] / 2 + 0.6 or vertex.co.z < -0.1 or vertex.co.z > d["h_roof"] + 0.8:
                print(f"STRAY {name} {obj.name} {tuple(round(c, 2) for c in vertex.co)}")
                break
    extra = {}
    if not d.get("open"):
        extra["roof"] = (d["L"] / 2 - d["hood"] - d["ws"] - d["roof"] * 0.5, d["h_roof"])
    return [body, *g.objs], axles, d["W"] / 2, extra



# --- trucks, buses, trailers ------------------------------------------------------------------

CAB_FLAT = dict(
    L=2.14, W=2.4, zb=0.82, hood=0.38, ws=0.42, roof=1.18, rw=0.02, h_nose=1.66, h_hl=1.74, h_cowl=1.86, h_belt=1.88,
    h_roof=2.92, h_deck=2.3, h_tail=1.8, roof_w=1.02, box=0.82, waist=1.0, b=0.72, doors=2, windows=False, crown=0.01,
    nose_w=0.965, tail_w=1.0, hl=0.25, sill=0.12, lamp="square", lamp_size=(0.34, 0.2), lamp_drop=0.72, tail="none", grille=(1.5, 0.42, 1.34),
    grille_style="bars", bumpers="none", exhaust=0, r=0.5, regions={"COWL": "carbon"}, no_cab_details=True, rear_glass=False,
)
CAB_NOSE = dict(
    L=3.5, W=2.36, zb=0.78, hood=1.72, ws=0.46, roof=1.24, rw=0.02, h_nose=1.76, h_hl=1.8, h_cowl=1.88, h_belt=1.9,
    h_roof=2.98, h_deck=2.3, h_tail=1.8, roof_w=1.0, box=0.85, waist=1.0, b=0.72, doors=2, windows=False, crown=0.0,
    nose_w=0.94, tail_w=1.0, hl=0.42, sill=0.12, lamp="square", lamp_size=(0.36, 0.18), lamp_drop=0.42, tail="none", grille=(1.04, 0.62, 1.42),
    grille_style="tall", bumpers="none", exhaust=0, r=0.5, regions={"COWL": "carbon"}, no_cab_details=True, rear_glass=False,
)


def mudguard(y, r, x, width, floor, mat="z_plastic"):
    """A fender over a rear wheel, curved around it."""
    radius = r + 0.1 + (ARCH - 1.18) * r
    start = degrees(asin(min(1.0, max(-1.0, (floor - r) / radius))))
    path = [(x, y + radius * cos(radians(a)), r + radius * sin(radians(a))) for a in [lerp(start, 180 - start, i / 18) for i in range(19)]]
    kit.sweep("mudguard", path, [(-width / 2, 0.012), (width / 2, 0.012), (width / 2, -0.012), (-width / 2, -0.012)], up=(1, 0, 0), mat=mat, sharp_angle=50.0)


def chassis(y0, y1, z, hw):
    for s in (-1, 1):
        kit.rbox("rail", (0.1, y1 - y0, 0.2), (s * (hw * 0.42), (y0 + y1) / 2, z), mat="z_dark_metal", bevel=0.012, segs=1)
    count = max(3, int((y1 - y0) / 1.2))
    for i in range(count):
        kit.rbox("cross", (hw * 0.84, 0.08, 0.1), (0, lerp(y0 + 0.2, y1 - 0.2, i / (count - 1)), z - 0.02), mat="z_dark_metal", bevel=0.008, segs=1)


def axle_hardware(y, r, hw, dual=False):
    kit.tube("axle", [(-hw + 0.2, y, r), (hw - 0.2, y, r)], 0.05, mat="z_dark_metal", fillet=0, n=8)
    kit.rbox("diff", (0.34, 0.3, 0.26), (0, y, r), mat="z_dark_metal", bevel=0.05, segs=1)
    for s in (-1, 1):
        kit.rbox("spring", (0.1, 1.0, 0.07), (s * (hw * 0.42), y, r + 0.2), mat="z_dark_metal", bevel=0.012, segs=1)


def fuel_tank(y, x, z, length=1.1, radius=0.25):
    keys = [dict(pos=y - length / 2 - 0.03, c1=x, c2=z, w=radius * 0.8, h=radius * 0.8, e=2.6), dict(pos=y - length / 2, c1=x, c2=z, w=radius, h=radius, e=3.2), dict(pos=y + length / 2, c1=x, c2=z, w=radius, h=radius, e=3.2), dict(pos=y + length / 2 + 0.03, c1=x, c2=z, w=radius * 0.8, h=radius * 0.8, e=2.6)]
    kit.loft("tank", keys, n=18, sub=1, mat="z_chrome", sharp_angle=44.0)
    for t in (-0.3, 0.3):
        kit.torus("strap", radius + 0.008, 0.012, kit.mtx_of((x, y + t * length, z), (90, 0, 0)), mat="z_dark_metal", n_major=18, n_minor=4, rx=radius + 0.012)
    kit.cyl("cap", 0.05, 0.03, (x, y + 0.3 * length, z + radius + 0.01), (0, 0, 1), mat="z_chrome", segs=10)


def steps(y, hw, z0, z1, side):
    count = 2
    for i in range(count):
        z = lerp(z0, z1, (i + 0.4) / count)
        kit.rbox("step", (0.14, 0.42, 0.03), (side * (hw - 0.09), y, z), mat="z_chrome", bevel=0.008, segs=1)
    kit.rbox("step_bracket", (0.05, 0.46, z1 - z0), (side * (hw - 0.04), y, (z0 + z1) / 2), mat="z_dark_metal", bevel=0.008, segs=1)


def exhaust_stack(x, y, z0, z1):
    kit.tube("stack", [(x, y, z0), (x, y, z1 - 0.1), (x, y + 0.04, z1)], 0.06, mat="z_chrome", fillet=0.08, n=12)
    kit.tube("heat_shield", [(x, y, z0 + 0.1), (x, y, z0 + 0.8)], 0.075, mat="z_steel", fillet=0, n=12, caps=True)


def truck_mirrors(x, y, z):
    for s in (-1, 1):
        kit.tube("mirror_arm", [(s * (x - 0.1), y, z + 0.32), (s * (x + 0.12), y, z + 0.32), (s * (x + 0.12), y, z - 0.32), (s * (x - 0.1), y, z - 0.32)], 0.014, mat="z_dark_metal", fillet=0.06, n=6)
        kit.rbox("mirror", (0.05, 0.16, 0.42), (s * (x + 0.12), y - 0.01, z), mat="z_carbon", bevel=0.018, segs=1)


def build_cab(d, axle, cab_y, roof_fairing=False):
    """A truck cab placed so that its nose ends at the given position."""
    d = dict(d)
    local = axle - cab_y
    with kit.Group() as g:
        body, surface = build_body(d, [(local, d["r"])])
        grille(d, surface)
        headlights(d, surface)
        L, hw = d["L"] / 2, d["W"] / 2
        y_cowl = L - d["hood"]
        y_rr = y_cowl - d["ws"] - d["roof"]
        for s in (-1, 1):
            handle(surface, y_rr + 0.48, d["h_belt"] - 0.2, s, width=0.2)
            arch(surface, local, d["r"], d["r"] * ARCH, s, d["zb"] + 0.05, width=0.05, lift=0.016, mat="z_paint")
        kit.tube("wiper", [(-0.5, y_cowl - 0.02, d["h_cowl"] + 0.04), (-0.05, y_cowl - 0.1, d["h_cowl"] + 0.5)], 0.008, mat="z_plastic", fillet=0, n=5)
        kit.tube("wiper", [(0.4, y_cowl - 0.02, d["h_cowl"] + 0.04), (0.85, y_cowl - 0.1, d["h_cowl"] + 0.5)], 0.008, mat="z_plastic", fillet=0, n=5)
        visor_y = y_cowl - d["ws"] + 0.04
        kit.rbox("visor", (d["W"] * 0.88, 0.2, 0.05), (0, visor_y + 0.12, d["h_roof"] - 0.08), mat="z_carbon", bevel=0.012, segs=1, rot=(-12, 0, 0))
        for x in (-0.46, -0.16, 0.16, 0.46):
            kit.cyl("marker", 0.03, 0.016, (x, visor_y - 0.06, d["h_roof"] + 0.01), (0, 0, 1), mat="z_amber", segs=10)
        if vk.realistic():
            cab_interior(d, body)
        if roof_fairing:
            keys = [dict(pos=y_rr + 1.04, c2=d["h_roof"] + 0.02, w=hw * 0.86, h=0.02, e=4), dict(pos=y_rr + 0.8, c2=d["h_roof"] + 0.16, w=hw * 0.94, h=0.17, e=4), dict(pos=y_rr + 0.1, c2=d["h_roof"] + 0.36, w=hw * 0.98, h=0.37, e=4), dict(pos=y_rr - 0.04, c2=d["h_roof"] + 0.36, w=hw * 0.98, h=0.37, e=4)]
            kit.loft("fairing", keys, n=20, sub=3, mat="z_paint", sharp_angle=44.0, cap_mat="z_carbon")
    objects = [body, *g.objs]
    for obj in objects:
        obj.data.transform(Matrix.Translation((0, cab_y, 0)))
        obj.data.update()
    truck_mirrors(d["W"] / 2 + 0.04, cab_y + d["L"] / 2 - d["hood"] - d["ws"] * 0.4, d["h_belt"] + 0.38)
    return objects


def cab_interior(d, body):
    L, hw = d["L"] / 2, d["W"] / 2
    y_cowl = L - d["hood"]
    y_rr = y_cowl - d["ws"] - d["roof"]
    lining(body, -L - 0.1, y_cowl + 0.15)
    floor = d["zb"] + 0.12
    seat_z = floor + 0.5
    driver = -hw * 0.48
    for x in (driver, -driver):
        car_seat(x, y_rr + 0.28, seat_z, width=0.56, back=0.72)
    dashboard(y_cowl + 0.05, y_cowl - 0.38, d["h_belt"] - 0.04, hw - 0.1, driver, wheel_radius=0.23, wheel_tilt=36)


def truck_front(y, hw, z, wide=1.0):
    kit.rbox("bumper", (hw * 2.02 * wide, 0.28, 0.34), (0, y, z), mat="z_chrome", bevel=0.05, segs=2, taper=(0.98, 0.96))
    kit.rbox("bumper_slot", (hw * 1.4, 0.3, 0.05), (0, y + 0.002, z), mat="z_carbon", bevel=0.01, segs=1)
    for s in (-1, 1):
        kit.cyl("fog", 0.075, 0.02, (s * (hw * 0.72), y + 0.13, z), (0, 1, 0), mat="z_light", segs=16)
        kit.torus("fog_ring", 0.075, 0.01, kit.mtx_of((s * (hw * 0.72), y + 0.14, z), (90, 0, 0)), mat="z_dark_metal", n_major=16, n_minor=4)


def rear_lamps(y, hw, z, side_lamp=True):
    for s in (-1, 1):
        kit.rbox("tail", (0.34, 0.03, 0.12), (s * (hw - 0.32), y, z), mat="z_tail", bevel=0.01, segs=1)
        kit.rbox("tail_rev", (0.1, 0.032, 0.12), (s * (hw - 0.54), y, z), mat="z_white", bevel=0.008, segs=1)
    kit.rbox("under_bar", (hw * 1.8, 0.1, 0.1), (0, y + 0.02, z - 0.18), mat="z_dark_metal", bevel=0.012, segs=1)
    kit.rbox("plate", (0.46, 0.02, 0.14), (0, y - 0.02, z), mat="z_plate", bevel=0.005, segs=1)


def cargo_box(y0, y1, z0, height, hw, ribs=True):
    length = y1 - y0
    center = (y0 + y1) / 2
    kit.rbox("floor", (hw * 2, length, 0.14), (0, center, z0 + 0.07), mat="z_dark_metal", bevel=0.012, segs=1)
    kit.rbox("box", (hw * 2 - 0.04, length - 0.04, height), (0, center, z0 + 0.14 + height / 2), mat="z_paint", bevel=0.04, segs=2)
    top = z0 + 0.14 + height
    for z, mat in ((top - 0.05, "z_trim"), (z0 + 0.2, "z_trim")):
        for s in (-1, 1):
            kit.rbox("rail", (0.03, length - 0.02, 0.1), (s * (hw - 0.002), center, z), mat=mat, bevel=0.01, segs=1)
    if ribs:
        count = max(3, int(length / 0.62))
        for i in range(count):
            y = lerp(y0 + 0.15, y1 - 0.15, i / (count - 1))
            for s in (-1, 1):
                kit.rbox("rib", (0.024, 0.05, height - 0.2), (s * (hw - 0.006), y, z0 + 0.14 + height / 2), mat="z_steel", bevel=0.006, segs=1)
    # Rear doors with hinges and lock rods.
    y = y0 + 0.001
    kit.rbox("door_frame", (hw * 2 - 0.1, 0.03, height - 0.08), (0, y, z0 + 0.14 + height / 2), mat="z_steel", bevel=0.012, segs=1)
    for s in (-1, 1):
        kit.rbox("door", (hw - 0.09, 0.03, height - 0.2), (s * (hw * 0.5), y - 0.012, z0 + 0.14 + height / 2), mat="z_paint", bevel=0.012, segs=1)
        kit.tube("lock", [(s * 0.22, y - 0.04, z0 + 0.3), (s * 0.22, y - 0.04, top - 0.16)], 0.012, mat="z_chrome", fillet=0, n=6)
        for z in (z0 + 0.4, top - 0.34):
            kit.rbox("hinge", (0.12, 0.024, 0.05), (s * (hw - 0.06), y - 0.028, z), mat="z_chrome", bevel=0.005, segs=1)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)
    for s in (-1, 1):
        for t in (0.15, 0.5, 0.85):
            kit.rbox("marker", (0.016, 0.1, 0.04), (s * (hw + 0.004), lerp(y0, y1, t), z0 + 0.06), mat="z_amber", bevel=0.004, segs=1)


def cargo_dump(y0, y1, z0, height, hw):
    length = y1 - y0
    center = (y0 + y1) / 2
    kit.rbox("floor", (hw * 2, length, 0.14), (0, center, z0 + 0.07), mat="z_dark_metal", bevel=0.012, segs=1)
    for s in (-1, 1):
        kit.rbox("wall", (0.08, length, height), (s * (hw - 0.04), center, z0 + 0.14 + height / 2), mat="z_paint", bevel=0.02, segs=1, taper=(1.0, 1.0))
        kit.rbox("top_rail", (0.13, length + 0.02, 0.07), (s * (hw - 0.03), center, z0 + 0.14 + height), mat="z_trim", bevel=0.015, segs=1)
        count = max(3, int(length / 0.7))
        for i in range(count):
            y = lerp(y0 + 0.16, y1 - 0.16, i / (count - 1))
            kit.rbox("rib", (0.04, 0.09, height - 0.1), (s * (hw + 0.004), y, z0 + 0.14 + height / 2), mat="z_paint", bevel=0.012, segs=1, taper=(1.0, 0.8))
    kit.rbox("front_wall", (hw * 2, 0.1, height + 0.3), (0, y1 - 0.05, z0 + 0.29 + height / 2), mat="z_paint", bevel=0.02, segs=1)
    kit.rbox("tailgate", (hw * 2 - 0.06, 0.08, height), (0, y0 + 0.04, z0 + 0.14 + height / 2), mat="z_trim", bevel=0.02, segs=1)
    kit.rbox("load", (hw * 2 - 0.2, length - 0.3, 0.05), (0, center, z0 + height * 0.72), mat="z_dirt", bevel=0)
    for i in range(26):
        a = i * 2.4
        kit.sphere("heap", 0.24 + 0.05 * sin(a * 3.1), (sin(a) * hw * 0.68, center + cos(a * 0.73) * length * 0.38, z0 + height * 0.74), scale=(1.8, 1.8, 0.32), mat="z_dirt", segs=8, rings=4)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def cargo_flat(y0, y1, z0, hw, posts=True):
    length = y1 - y0
    center = (y0 + y1) / 2
    kit.rbox("deck", (hw * 2, length, 0.13), (0, center, z0 + 0.065), mat="z_dark_metal", bevel=0.012, segs=1)
    count = int(length / 0.2)
    for i in range(count):
        y = lerp(y0 + 0.09, y1 - 0.09, i / (count - 1))
        kit.rbox("plank", (hw * 2 - 0.1, 0.17, 0.03), (0, y, z0 + 0.14), mat="z_wood", bevel=0.005, segs=1)
    kit.rbox("headboard", (hw * 2 - 0.1, 0.09, 0.9), (0, y1 - 0.08, z0 + 0.6), mat="z_paint", bevel=0.02, segs=1)
    for s in (-1, 1):
        kit.rbox("side_rail", (0.04, length, 0.14), (s * (hw + 0.002), center, z0 + 0.07), mat="z_trim", bevel=0.01, segs=1)
        if posts:
            for t in range(max(2, int(length / 1.6)) + 1):
                y = lerp(y0 + 0.3, y1 - 0.3, t / max(2, int(length / 1.6)))
                kit.rbox("stake", (0.05, 0.05, 0.7), (s * (hw - 0.02), y, z0 + 0.44), mat="z_steel", bevel=0.008, segs=1)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def cargo_tank(y0, y1, z0, hw, height, mat="z_steel"):
    length = y1 - y0
    center = (y0 + y1) / 2
    z = z0 + height / 2 + 0.06
    kit.rbox("frame", (hw * 1.5, length, 0.1), (0, center, z0 + 0.04), mat="z_dark_metal", bevel=0.012, segs=1)
    keys = [dict(pos=y0 - 0.14, c2=z, w=hw * 0.56, h=height * 0.28, e=2.4), dict(pos=y0 + 0.02, c2=z, w=hw * 0.97, h=height * 0.47, e=2.8), dict(pos=y0 + 0.3, c2=z, w=hw, h=height * 0.5, e=2.8), dict(pos=y1 - 0.3, c2=z, w=hw, h=height * 0.5, e=2.8), dict(pos=y1 - 0.02, c2=z, w=hw * 0.97, h=height * 0.47, e=2.8), dict(pos=y1 + 0.12, c2=z, w=hw * 0.56, h=height * 0.28, e=2.4)]
    kit.loft("tank", keys, n=36, sub=3, mat=mat, sharp_angle=46.0)
    for t in (0.1, 0.37, 0.63, 0.9):
        y = lerp(y0, y1, t)
        kit.torus("band", hw + 0.012, 0.016, kit.mtx_of((0, y, z), (90, 0, 0)), mat="z_trim", n_major=44, n_minor=4, rx=hw * 1.02)
    kit.rbox("walkway", (0.34, length * 0.8, 0.03), (0, center, z + height * 0.5 + 0.01), mat="z_dark_metal", bevel=0.005, segs=1)
    for t in (0.22, 0.5, 0.78):
        kit.cyl("hatch", 0.19, 0.06, (0, lerp(y0, y1, t), z + height * 0.5 + 0.03), (0, 0, 1), mat="z_steel", segs=16, bevel=0.012, bsegs=1)
    x = hw * 0.74
    kit.tube("ladder", [(x, y0 - 0.1, z0 + 0.1), (x, y0 - 0.1, z0 + height * 0.92)], 0.012, mat="z_chrome", fillet=0, n=6)
    kit.tube("ladder", [(x - 0.3, y0 - 0.1, z0 + 0.1), (x - 0.3, y0 - 0.1, z0 + height * 0.92)], 0.012, mat="z_chrome", fillet=0, n=6)
    for i in range(7):
        h = lerp(z0 + 0.14, z0 + height * 0.88, i / 6)
        kit.tube("ladder", [(x, y0 - 0.1, h), (x - 0.3, y0 - 0.1, h)], 0.01, mat="z_chrome", fillet=0, n=5)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def cargo_mixer(y0, y1, z0, hw):
    length = y1 - y0
    z = z0 + 1.25
    kit.rbox("frame", (hw * 1.3, length, 0.12), (0, (y0 + y1) / 2, z0 + 0.06), mat="z_dark_metal", bevel=0.012, segs=1)
    tilt = radians(14)
    origin = V((0, (y0 + y1) / 2, z))
    profile = [(-1.5, 0.32), (-1.12, 0.74), (-0.5, 1.02), (0.3, 1.02), (1.0, 0.72), (1.5, 0.42), (1.56, 0.32)]
    matrix = Matrix.Translation(origin) @ Matrix.Rotation(-tilt, 4, "X") @ Matrix.Rotation(pi / 2, 4, "Z")
    kit.lathe("drum", profile, 34, mat="z_paint", mtx=matrix, sharp_angle=46.0)
    path = []
    for i in range(90):
        t = i / 89
        a = t * 5 * pi
        x = lerp(-1.38, 1.42, t)
        r = max(0.34, min(1.02, 1.02 - max(0.0, abs(x - 0.0) - 0.42) * 0.58)) + 0.014
        path.append(matrix @ V((x, r * cos(a), r * sin(a))))
    kit.sweep("spiral", path, [(-0.02, 0.035), (0.02, 0.035), (0.02, -0.018), (-0.02, -0.018)], up=(matrix.to_3x3() @ V((1, 0, 0))), mat="z_trim", sharp_angle=50.0)
    kit.rbox("chute", (0.4, 0.8, 0.1), (0, y0 - 0.18, z0 + 1.1), mat="z_steel", bevel=0.02, segs=1, rot=(30, 0, 0))
    kit.rbox("hopper", (0.8, 0.5, 0.5), (0, y0 + 0.42, z0 + 2.12), mat="z_steel", bevel=0.05, segs=1, taper=(1.3, 1.3))
    kit.rbox("support", (hw * 1.1, 0.26, 1.34), (0, y0 + 0.62, z0 + 0.7), mat="z_dark_metal", bevel=0.02, segs=1)
    kit.rbox("support", (hw * 1.2, 0.3, 0.7), (0, y1 - 0.55, z0 + 0.4), mat="z_dark_metal", bevel=0.02, segs=1)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def cargo_garbage(y0, y1, z0, hw):
    length = y1 - y0
    center = (y0 + y1) / 2
    height = 1.85
    z = z0 + height / 2
    keys = [dict(pos=y0 + 0.9, c2=z, w=hw, h=height * 0.5, e=5.0), dict(pos=y1 - 0.08, c2=z, w=hw, h=height * 0.5, e=5.0), dict(pos=y1, c2=z, w=hw * 0.9, h=height * 0.44, e=5.0)]
    kit.loft("body", keys, n=32, sub=2, mat="z_paint", sharp_angle=44.0)
    rear_keys = [dict(pos=y0, c2=z - 0.08, w=hw * 0.95, h=height * 0.5, e=4.5), dict(pos=y0 + 0.1, c2=z - 0.06, w=hw, h=height * 0.54, e=5.0), dict(pos=y0 + 0.95, c2=z + 0.02, w=hw * 1.0, h=height * 0.52, e=5.0)]
    kit.loft("hopper", rear_keys, n=32, sub=2, mat="z_trim", sharp_angle=44.0, cap_mat="z_carbon")
    count = max(3, int(length / 0.55))
    for i in range(count):
        y = lerp(y0 + 1.1, y1 - 0.2, i / (count - 1))
        for s in (-1, 1):
            kit.rbox("rib", (0.04, 0.08, height - 0.3), (s * (hw + 0.005), y, z), mat="z_steel", bevel=0.01, segs=1)
    kit.rbox("slot", (hw * 1.4, 0.14, 0.7), (0, y0 + 0.03, z - 0.02), mat="z_carbon", bevel=0.02, segs=1)
    kit.rbox("bin_lift", (hw * 1.5, 0.14, 0.34), (0, y0 - 0.08, z0 + 0.3), mat="z_steel", bevel=0.02, segs=1)
    for s in (-1, 1):
        kit.rbox("light", (0.14, 0.04, 0.32), (s * (hw - 0.14), y0 - 0.01, z + 0.4), mat="z_amber", bevel=0.01, segs=1)
    rear_lamps(y0 - 0.1, hw, z0 - 0.06)


def cargo_tow(y0, y1, z0, hw):
    length = y1 - y0
    center = (y0 + y1) / 2
    cargo_flat(y0, y1, z0, hw, posts=False)
    kit.rbox("boom_base", (0.5, 0.7, 0.5), (0, y0 + 0.7, z0 + 0.4), mat="z_dark_metal", bevel=0.05, segs=1)
    for s in (-1, 1):
        kit.tube("boom", [(s * 0.14, y0 + 0.8, z0 + 0.4), (s * 0.14, y0 - 0.6, z0 + 1.9)], 0.06, mat="z_paint", fillet=0, n=8)
    kit.tube("boom_cross", [(-0.14, y0 - 0.5, z0 + 1.8), (0.14, y0 - 0.5, z0 + 1.8)], 0.05, mat="z_paint", fillet=0, n=8)
    kit.tube("cable", [(0, y0 - 0.56, z0 + 1.84), (0, y0 - 0.56, z0 + 0.5)], 0.012, mat="z_steel", fillet=0, n=5)
    kit.torus("hook", 0.07, 0.016, kit.mtx_of((0, y0 - 0.56, z0 + 0.42), (0, 90, 0)), mat="z_chrome", n_major=14, n_minor=5)
    kit.rbox("bar_light", (1.1, 0.16, 0.11), (0, y1 + 0.02, z0 + 1.18), mat="z_amber", bevel=0.03, segs=2)


def cargo_fire(y0, y1, z0, hw):
    length = y1 - y0
    center = (y0 + y1) / 2
    height = 1.65
    kit.rbox("body", (hw * 2 - 0.04, length, height), (0, center, z0 + height / 2), mat="z_paint", bevel=0.05, segs=2)
    bays = max(3, int(length / 0.95))
    for s in (-1, 1):
        for i in range(bays):
            y = lerp(y0 + length / bays / 2, y1 - length / bays / 2, i / (bays - 1))
            kit.rbox("bay", (0.02, length / bays - 0.1, height * 0.7), (s * (hw - 0.012), y, z0 + height * 0.48), mat="z_steel", bevel=0.01, segs=1)
            count = 10
            for k in range(count):
                kit.rbox("slat", (0.024, length / bays - 0.14, 0.014), (s * (hw - 0.008), y, lerp(z0 + height * 0.18, z0 + height * 0.78, k / (count - 1))), mat="z_dark_metal", bevel=0)
        kit.rbox("stripe", (0.016, length, 0.14), (s * (hw - 0.012), center, z0 + height * 0.92), mat="z_accent", bevel=0.004, segs=1)
        kit.rbox("hose_reel", (0.1, 0.34, 0.26), (s * (hw + 0.04), y1 - 0.5, z0 + height + 0.16), mat="z_chrome", bevel=0.05, segs=1)
    x = hw * 0.62
    z = z0 + height + 0.24
    for s in (-1, 1):
        kit.tube("ladder", [(s * x, y0 - 0.6, z), (s * x, y1 - 0.1, z + 0.06)], 0.026, mat="z_chrome", fillet=0, n=8)
    for i in range(int((length + 0.5) / 0.3)):
        y = lerp(y0 - 0.55, y1 - 0.15, i / (int((length + 0.5) / 0.3) - 1))
        kit.tube("rung", [(-x, y, z + 0.02), (x, y, z + 0.02)], 0.014, mat="z_chrome", fillet=0, n=5)
    for y in (y0 + 0.2, y1 - 0.3):
        kit.rbox("ladder_rack", (hw * 1.5, 0.12, 0.24), (0, y, z0 + height + 0.12), mat="z_dark_metal", bevel=0.012, segs=1)
    rear_lamps(y0 - 0.02, hw, z0 + 0.2)


def fire_bar(y, z):
    kit.rbox("bar_base", (1.5, 0.3, 0.1), (0, y, z), mat="z_dark_metal", bevel=0.02, segs=1)
    for i, x in enumerate((-0.6, -0.2, 0.2, 0.6)):
        kit.rbox("beacon", (0.34, 0.26, 0.16), (x, y, z + 0.11), mat="z_tail" if i % 2 == 0 else "z_light", bevel=0.06, segs=2)


TRUCKS = {
    "bau": dict(name="Caminhão baú", T=8.2, cab="flat", cargo="box", axles=(2.95, -1.25, -2.55)),
    "cacamba": dict(name="Caminhão caçamba", T=7.4, cab="flat", cargo="dump", axles=(2.6, -1.0, -2.3)),
    "tanque": dict(name="Caminhão-tanque", T=8.2, cab="flat", cargo="tank", axles=(2.95, -1.25, -2.55)),
    "bombeiros": dict(name="Caminhão de bombeiros", T=8.6, cab="flat", cargo="fire", axles=(3.15, -1.9), bar=True),
    "prancha": dict(name="Caminhão prancha", T=8.2, cab="nose", cargo="flat", axles=(2.5, -1.25, -2.55)),
    "lixo": dict(name="Caminhão de lixo", T=8.0, cab="flat", cargo="garbage", axles=(2.85, -1.0, -2.3)),
    "betoneira": dict(name="Betoneira", T=8.0, cab="nose", cargo="mixer", axles=(2.4, -1.2, -2.5)),
    "guincho": dict(name="Guincho", T=7.2, cab="nose", cargo="tow", axles=(2.05, -1.6)),
}


def truck(key):
    vk.prepare()
    set_arch(True)
    t = dict(TRUCKS[key])
    base = CAB_FLAT if t["cab"] == "flat" else CAB_NOSE
    T = t["T"]
    r = base["r"]
    toy = vk.STYLE == "arcade"
    if toy:
        # Shorter, with one axle behind the cab: the cab keeps its place over the front wheels.
        front = t["axles"][0]
        rear = t["axles"][1:]
        T = T * 0.84
        t["axles"] = (T / 2 - (t["T"] / 2 - front), sum(rear) / len(rear) * 0.84)
    # Behind the cab the axles carry two tires on each side.
    axles = [(y, r, None, index > 0 and vk.STYLE == "real") for index, y in enumerate(t["axles"])]
    cab_y = T / 2 - base["L"] / 2
    with kit.Group() as g:
        cab_objects = build_cab(base, t["axles"][0], cab_y)
        hw = base["W"] / 2
        cab_back = cab_y - base["L"] / 2
        frame_z = 0.96
        chassis(-T / 2 + 0.2, cab_back + 0.5, frame_z, hw)
        truck_front(T / 2 + 0.04, hw, 0.92)
        for y in t["axles"]:
            axle_hardware(y, r, hw)
        for y in t["axles"][1:]:
            for s in (-1, 1):
                mudguard(y, r, s * (hw - 0.17), 0.42, 1.08 if t["cab"] == "nose" else 1.08)
        # The tank hangs between the front wheel and the rear ones.
        tank_y = min(cab_back + 0.1, t["axles"][0] - r * ARCH - 0.62)
        fuel_tank(tank_y, hw - 0.28, 0.72)
        kit.rbox("batteries", (0.5, 0.7, 0.42), (-hw + 0.3, tank_y, 0.72), mat="z_dark_metal", bevel=0.03, segs=1)
        for s in (-1, 1):
            steps(cab_y + base["L"] / 2 - base["hood"] - 0.55, hw + 0.02, 0.56, 1.0, s)
        exhaust_stack(hw - 0.14, cab_back - 0.14, 1.0, base["h_roof"] + 0.5)
        y0 = -T / 2 + 0.1
        y1 = cab_back - 0.2
        z0 = frame_z + 0.1
        cargo = t["cargo"]
        if cargo == "box":
            cargo_box(y0, y1, z0, 2.6, hw + 0.02)
        elif cargo == "dump":
            cargo_dump(y0, y1, z0, 1.1, hw + 0.02)
        elif cargo == "tank":
            cargo_tank(y0, y1, z0 + 0.04, hw - 0.04, 1.9)
        elif cargo == "flat":
            cargo_flat(y0, y1, z0, hw + 0.02)
        elif cargo == "garbage":
            cargo_garbage(y0, y1, z0, hw + 0.02)
        elif cargo == "mixer":
            cargo_mixer(y0, y1, z0, hw)
        elif cargo == "tow":
            cargo_tow(y0, y1, z0, hw + 0.02)
        elif cargo == "fire":
            cargo_fire(y0, y1, z0, hw)
        if t.get("bar"):
            fire_bar(cab_y + base["L"] / 2 - base["hood"] - base["ws"] - 0.4, base["h_roof"] + 0.08)
    if toy:
        return toy_finish([*cab_objects, *g.objs], axles, hw, {}, r)
    return [*cab_objects, *g.objs], axles, hw


TRACTORS = {"cavalo": CAB_FLAT, "cavalo_bicudo": CAB_NOSE}

GAME_KARTS = {"flecha": "body_vortex", "trovao": "body_brutus", "cometa": "body_falcon", "faisca": "body_bolt", "ferrao": "body_mantis", "blindado": "body_titan"}
# How far each body of the game can be simplified before its small details start to break.
KART_TARGET = {"faisca": 40000, "tubarao": 30000}
KART_DEFAULT = 26000


def game_kart(key):
    """A kart body from the game, simplified to the size of the other vehicles."""
    vk.prepare()
    made = kit.PARTS[GAME_KARTS[key]]()
    body = made[GAME_KARTS[key]]
    total = kit.tri_count(body)
    simplify(body, KART_TARGET.get(key, KART_DEFAULT))
    return [body], kart_axles(designs.GAME_SPECS[key][0]), 0.0


def simplify(obj, target):
    total = kit.tri_count(obj)
    if total <= target:
        return
    modifier = obj.modifiers.new("simplify", "DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = target / total
    modifier.use_collapse_triangulate = True
    vk.bake_modifiers(obj)
    obj.data.shade_smooth()
    obj.data.set_sharp_from_angle(angle=radians(42))


def kart_axles(sp):
    """(y, radius, distance of the wheel from the middle) for the front and the rear."""
    return [(y, vk.R * scale, x) for x, y, scale in (sp.front, sp.rear)]


def new_kart(key):
    vk.prepare()
    with kit.Group() as g:
        designs.KARTS[key][0]()
    # One mesh, like the karts of the game, so the triangle budget can really be met.
    body = kit.join(g.objs, "kart")
    if vk.LOD == "hi":
        simplify(body, KART_TARGET.get(key, KART_DEFAULT))
    return [body], kart_axles(designs.KARTS[key][1]), 0.0


def game_part(part):
    vk.prepare()
    made = kit.PARTS[part]()
    return list(made.values()), [], 0.0


def driver():
    vk.prepare()
    made = kit.PARTS["driver"]()
    simplify(made["driver"], 11000)
    return [made["driver"]], [], 0.0


def group_of(builder):
    def build():
        vk.prepare()
        with kit.Group() as g:
            made = builder()
        # Some helpers of the game keep their own group and return the objects.
        return [*g.objs, *(made if isinstance(made, list) else [])], [], 0.0

    return build



def tractor(key):
    vk.prepare()
    set_arch(True)
    toy = vk.STYLE == "arcade"
    base = dict(TRACTORS[key])
    r = base["r"]
    wheelbase = (3.4 if key == "cavalo" else 4.0) - (0.7 if toy else 0.0)
    T = wheelbase + base["L"] * 0.7 + 1.0
    cab_y = T / 2 - base["L"] / 2
    front = T / 2 - (1.15 if key == "cavalo" else 1.0)
    # The Arcade tractor has one rear axle, under the hitch.
    rear = (front - wheelbase - 0.66,) if toy else (front - wheelbase, front - wheelbase - 1.32)
    dual = vk.STYLE == "real"
    axles = [(front, r)] + [(y, r, None, dual) for y in rear]
    with kit.Group() as g:
        cab_objects = build_cab(base, front, cab_y, roof_fairing=True)
        hw = base["W"] / 2
        cab_back = cab_y - base["L"] / 2
        chassis(rear[-1] - 0.8, cab_back + 0.5, 0.96, hw)
        truck_front(T / 2 + 0.04, hw, 0.92)
        for y, *_ in axles:
            axle_hardware(y, r, hw)
        for y in rear:
            for s in (-1, 1):
                mudguard(y, r, s * (hw - 0.17), 0.42, 1.08)
        for s in (-1, 1):
            fuel_tank(cab_back + 0.05, s * (hw - 0.28), 0.72)
            steps(cab_y + base["L"] / 2 - base["hood"] - 0.55, hw + 0.02, 0.56, 1.0, s)
            exhaust_stack(s * (hw - 0.14), cab_back - 0.14, 1.0, base["h_roof"] + 0.5)
        hitch_y = sum(rear) / len(rear)
        hitch_z = 1.28
        kit.rbox("fifth_plate", (1.1, 1.1, 0.06), (0, hitch_y, hitch_z - 0.06), mat="z_steel", bevel=0.02, segs=1)
        kit.rbox("fifth_base", (0.8, 0.8, 0.2), (0, hitch_y, hitch_z - 0.2), mat="z_dark_metal", bevel=0.03, segs=1)
    if toy:
        return toy_finish([*cab_objects, *g.objs], axles, hw, {"hitch": (hitch_y, hitch_z)}, r)
    return [*cab_objects, *g.objs], axles, hw, {"hitch": (hitch_y, hitch_z)}


TRAILERS = {
    "bau": dict(name="Carreta baú", cargo="box"),
    "tanque": dict(name="Carreta-tanque", cargo="tank"),
    "prancha": dict(name="Carreta prancha", cargo="flat"),
    "cacamba": dict(name="Carreta caçamba", cargo="dump"),
    "cegonha": dict(name="Cegonha", cargo="carrier"),
    "sider": dict(name="Carreta sider", cargo="sider"),
}


def carrier_deck(y0, y1, z0, z1, hw):
    """One level of a car carrier, from height z0 at y0 to height z1 at y1."""
    length = (y1 - y0) / cos(atan2(z1 - z0, y1 - y0))
    center = ((y0 + y1) / 2, (z0 + z1) / 2)
    angle = degrees(atan2(z1 - z0, y1 - y0))
    for s in (-1, 1):
        kit.rbox("beam", (0.1, length, 0.14), (s * (hw - 0.05), center[0], center[1]), mat="z_paint", bevel=0.012, segs=1, rot=(angle, 0, 0))
    for x in (-0.82, 0.82):
        kit.rbox("track", (0.48, length, 0.03), (x, center[0], center[1] + 0.05), mat="z_steel", bevel=0, rot=(angle, 0, 0))
    for i in range(int(length / 1.1)):
        t = (i + 0.5) / int(length / 1.1)
        kit.rbox("cross", (hw * 2 - 0.1, 0.07, 0.07), (0, lerp(y0, y1, t), lerp(z0, z1, t)), mat="z_dark_metal", bevel=0.008, segs=1)


def carried_car(y, z, lean, mat):
    """A car riding on a carrier, facing forward. `lean` is the rise per meter of the deck it is on."""

    def at(offset, up):
        return dict(pos=y + offset, c2=z + up + offset * lean)

    body = [(1.72, 0.42, 0.68, 0.14), (1.58, 0.48, 0.8, 0.21), (0.6, 0.52, 0.85, 0.27), (-1.2, 0.54, 0.85, 0.28), (-1.62, 0.54, 0.8, 0.22), (-1.72, 0.53, 0.68, 0.14)]
    kit.loft("car_body", [dict(at(a, b), w=c, h=e) for a, b, c, e in body], n=14, sub=2, mat=mat, sharp_angle=44.0)
    cabin = [(0.62, 0.78, 0.74, 0.04), (0.18, 0.98, 0.68, 0.21), (-0.62, 1.0, 0.66, 0.22), (-1.08, 0.84, 0.72, 0.07)]
    kit.loft("car_cabin", [dict(at(a, b), w=c, h=e) for a, b, c, e in cabin], n=12, sub=2, mat="z_glass", sharp_angle=44.0)
    kit.loft("car_roof", [dict(at(a, 1.2), w=c, h=0.035) for a, c in ((0.22, 0.56), (-0.1, 0.62), (-0.62, 0.56))], n=10, sub=2, mat=mat, sharp_angle=44.0)
    for offset in (1.08, -1.08):
        for s in (-1, 1):
            kit.cyl("car_tire", 0.3, 0.2, (s * 0.76, y + offset, z + 0.3 + offset * lean), (1, 0, 0), mat="rubber", segs=16, bevel=0.03, bsegs=1)
            kit.cyl("car_rim", 0.17, 0.205, (s * 0.76, y + offset, z + 0.3 + offset * lean), (1, 0, 0), mat="z_steel", segs=12)


def cargo_carrier(y0, y1, z0, hw):
    """Two levels of cars: the lower one low on the frame, the upper one sloping down at the back."""
    low = z0 - 0.2
    high = z0 + 1.6
    bend = y0 + 3.1
    tail = high - 0.72
    kit.rbox("floor", (hw * 2, y1 - y0, 0.1), ((0), (y0 + y1) / 2, low), mat="z_dark_metal", bevel=0.01, segs=1)
    for x in (-0.82, 0.82):
        kit.rbox("track", (0.48, y1 - y0 - 0.1, 0.03), (x, (y0 + y1) / 2, low + 0.06), mat="z_steel", bevel=0)
    carrier_deck(bend, y1 - 0.1, high, high, hw + 0.02)
    carrier_deck(y0 + 0.05, bend, tail, high, hw + 0.02)
    for s in (-1, 1):
        for y in [lerp(bend, y1 - 0.25, i / 3) for i in range(4)]:
            kit.rbox("post", (0.09, 0.12, high - low), (s * (hw - 0.03), y, (low + high) / 2), mat="z_paint", bevel=0.012, segs=1)
        kit.rbox("post", (0.09, 0.12, tail - low), (s * (hw - 0.03), y0 + 0.15, (low + tail) / 2), mat="z_paint", bevel=0.012, segs=1)
        kit.rbox("post", (0.09, 0.12, lerp(tail, high, 0.5) - low), (s * (hw - 0.03), lerp(y0, bend, 0.5), (low + lerp(tail, high, 0.5)) / 2), mat="z_paint", bevel=0.012, segs=1)
        kit.rbox("rail", (0.05, y1 - bend - 0.3, 0.07), (s * (hw - 0.03), (bend + y1) / 2, high + 0.42), mat="z_trim", bevel=0.01, segs=1)
    colors = ("z_accent", "z_trim", "z_white", "z_steel", "z_accent", "z_trim")
    for i, y in enumerate((y1 - 2.0, y1 - 5.7, y1 - 9.3)):
        carried_car(y, low + 0.06, 0.0, colors[i])
    for i, y in enumerate((y1 - 2.1, y1 - 5.9)):
        carried_car(y, high + 0.07, 0.0, colors[i + 3])
    lean = (high - tail) / (bend - y0)
    y = y0 + 1.72
    carried_car(y, lerp(tail, high, (y - y0) / (bend - y0)) + 0.07, lean, colors[5])
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def sider_body(y0, y1, z0, height, hw):
    length = y1 - y0
    center = (y0 + y1) / 2
    kit.rbox("floor", (hw * 2, length, 0.14), (0, center, z0 + 0.07), mat="z_dark_metal", bevel=0.012, segs=1)
    kit.rbox("roof", (hw * 2, length, 0.1), (0, center, z0 + height + 0.1), mat="z_trim", bevel=0.02, segs=1)
    kit.rbox("curtain", (hw * 2 - 0.05, length - 0.05, height), (0, center, z0 + 0.14 + height / 2), mat="z_paint", bevel=0.02, segs=1)
    for i in range(14):
        y = lerp(y0 + 0.3, y1 - 0.3, i / 13)
        for s in (-1, 1):
            kit.rbox("strap", (0.02, 0.05, height), (s * (hw - 0.012), y, z0 + 0.14 + height / 2), mat="z_steel", bevel=0, )
    kit.rbox("door", (hw * 2 - 0.1, 0.04, height), (0, y0 + 0.01, z0 + 0.14 + height / 2), mat="z_steel", bevel=0.012, segs=1)
    rear_lamps(y0 - 0.02, hw, z0 - 0.08)


def trailer(key):
    vk.prepare()
    set_arch(True)
    toy = vk.STYLE == "arcade"
    t = TRAILERS[key]
    r = 0.5
    hw = 1.24
    # The Arcade trailer is shorter and rolls on two axles.
    length = 9.0 if toy else 11.2
    y0, y1 = -length + 0.9, 0.9
    z0 = 1.28
    dual = vk.STYLE == "real"
    spots = (1.7, 3.0) if toy else (1.9, 3.15, 4.4)
    axles = [(y0 + spot, r, None, dual) for spot in spots]
    with kit.Group() as g:
        chassis(y0, y1 - 0.1, z0 - 0.06, hw)
        kit.cyl("kingpin", 0.05, 0.1, (0, 0, z0 - 0.02), (0, 0, 1), mat="z_chrome", segs=10)
        for y, *_ in axles:
            axle_hardware(y, r, hw)
            for s in (-1, 1):
                mudguard(y, r, s * (hw - 0.17), 0.4, 1.12)
        for s in (-1, 1):
            kit.rbox("landing_leg", (0.08, 0.1, 1.06), (s * 0.75, -0.9, 0.62), mat="z_dark_metal", bevel=0.015, segs=1)
            kit.rbox("foot", (0.22, 0.26, 0.05), (s * 0.75, -0.9, 0.06), mat="z_dark_metal", bevel=0.012, segs=1)
            for k in range(3):
                kit.rbox("side_guard", (0.03, 2.6, 0.05), (s * (hw - 0.02), -3.2, 0.58 + k * 0.2), mat="z_steel", bevel=0.008, segs=1)
        kit.rbox("toolbox", (0.7, 0.7, 0.5), (0, -2.6, 0.92), mat="z_dark_metal", bevel=0.04, segs=1)
        kit.rbox("spare_rack", (0.9, 0.9, 0.04), (0, -4.6, 0.94), mat="z_dark_metal", bevel=0.01, segs=1)
        kit.cyl("spare", r, 0.26, (0, -4.6, 0.7), (0, 0, 1), mat="rubber", segs=20, bevel=0.03, bsegs=1)
        cargo = t["cargo"]
        if cargo == "box":
            cargo_box(y0, y1, z0 + 0.06, 2.72, hw + 0.02)
        elif cargo == "tank":
            cargo_tank(y0 + 0.4, y1 - 0.4, z0 + 0.1, hw - 0.04, 1.96)
        elif cargo == "flat":
            cargo_flat(y0, y1, z0 + 0.06, hw + 0.02)
        elif cargo == "dump":
            cargo_dump(y0, y1, z0 + 0.06, 1.5, hw + 0.02)
        elif cargo == "sider":
            sider_body(y0, y1, z0 + 0.06, 2.6, hw + 0.02)
        elif cargo == "carrier":
            cargo_carrier(y0, y1, z0, hw)
    if toy:
        return toy_finish(list(g.objs), axles, hw, {"king": z0}, r)
    return list(g.objs), axles, hw, {"king": z0}


BUSES = {
    "urbano": dict(name="Ônibus urbano", L=12.0, W=2.5, zb=0.42, hood=0.4, ws=0.42, rw=0.06, h_belt=1.4, h_roof=3.08, r=0.5, front=3.3, rear=-3.3, windows=8, doors_at=(4.55, -0.4)),
    "escolar": dict(name="Ônibus escolar", L=9.6, W=2.4, zb=0.5, hood=1.22, ws=0.44, rw=0.06, h_belt=1.56, h_roof=3.0, r=0.5, front=3.3, rear=-2.8, windows=7, doors_at=(2.0,), paint_stripes=True, bonnet=True, regions={"ROOF": "trim", "HOOD": "paint"}),
    "viagem": dict(name="Ônibus de viagem", L=13.2, W=2.56, zb=0.5, hood=0.4, ws=0.5, rw=0.06, h_belt=2.05, h_roof=3.72, r=0.5, front=4.0, rear=-3.9, windows=6, doors_at=(5.1,), luggage=True),
    "dois_andares": dict(name="Ônibus de dois andares", L=12.0, W=2.5, zb=0.42, hood=0.42, ws=0.4, rw=0.06, h_belt=1.46, h_roof=4.3, r=0.5, front=3.3, rear=-3.4, windows=7, doors_at=(4.55,), upper=True, h_upper=3.1),
    "micro": dict(name="Micro-ônibus", L=7.4, W=2.2, zb=0.4, hood=0.72, ws=0.6, rw=0.06, h_belt=1.34, h_roof=2.8, r=0.42, front=2.0, rear=-1.9, windows=5, doors_at=(0.9,)),
}


def window_strip(surface, center_y, z, width, height, side, frame="z_rubber"):
    outline = box_shape(width, height, 0.05)
    patch("window", surface, outline, (side * 0.8, center_y, z), (side, 0, 0), [(0, -0.002, "z_rubber"), (0.012, 0.012, "z_rubber"), (0.024, 0.008, "z_glass")], fill="z_glass", step=0.14)


def bus_door(surface, y, z, height, side):
    patch("door", surface, box_shape(1.05, height, 0.06), (side * 0.8, y, z), (side, 0, 0), [(0, -0.002, "z_rubber"), (0.012, 0.014, "z_steel"), (0.04, 0.014, "z_glass")], fill="z_glass", step=0.14)
    kit.rbox("door_split", (0.03, 0.036, height - 0.06), (side * (surface.half + 0.006), y, z), mat="z_rubber", bevel=0)
    for s in (-1, 1):
        kit.rbox("door_grip", (0.012, 0.02, 0.5), (side * (surface.half + 0.01), y + s * 0.06, z - 0.04), mat="z_steel", bevel=0)


def side_x(surface, y, z, side, fallback):
    """Where the side of the body is, at a given length and height."""
    found = surface.hit(V((side * 4.0, y, z)), V((-side, 0, 0)))
    return abs(found[0].x) if found else fallback


def slanted_box(name, x0, z0, x1, z1, y, length, thickness, side, mat):
    """A flat piece standing on the side of the body, from (x0, z0) up to (x1, z1)."""
    dx, dz = x1 - x0, z1 - z0
    angle = degrees(atan2(side * dx, dz))
    height = (dx * dx + dz * dz) ** 0.5
    kit.rbox(name, (thickness, length, height), (side * (x0 + x1) / 2, y, (z0 + z1) / 2), mat=mat, bevel=0, rot=(0, angle, 0))


def bus_glazing(surface, hw, y0, y1, z0, z1, count, side, skip=()):
    """A band of real windows: one sheet of glass behind black posts and frames."""
    xb = side_x(surface, (y0 + y1) / 2, z0 - 0.06, side, hw) - 0.012
    xt = side_x(surface, (y0 + y1) / 2, z1 + 0.06, side, hw) - 0.012
    # The cut gives the opening; the glass sits just inside it.
    lerp_x = lambda z: lerp(xb, xt, (z - (z0 - 0.06)) / ((z1 + 0.06) - (z0 - 0.06)))
    slanted_box("bus_glass", lerp_x(z0) - 0.03, z0 - 0.03, lerp_x(z1) - 0.03, z1 + 0.03, (y0 + y1) / 2, y1 - y0 + 0.06, 0.012, side, "z_glass")
    pitch = (y1 - y0) / count
    for i in range(count + 1):
        y = y0 + pitch * i
        if any(abs(y - d) < 0.6 for d in skip):
            continue
        slanted_box("window_post", lerp_x(z0) - 0.01, z0, lerp_x(z1) - 0.01, z1, y, 0.09, 0.03, side, "z_rubber")
    for z in (z0, z1):
        x = lerp_x(z) - 0.01
        kit.rbox("window_rail", (0.03, y1 - y0, 0.05), (side * x, (y0 + y1) / 2, z), mat="z_rubber", bevel=0)


def bus_seats(hw, y0, y1, floor, side, skip=(), row=0.82):
    """Pairs of seats along one side, facing forward, with the aisle in the middle."""
    x = side * (hw - 0.55)
    y = y0 + 0.2
    while y + 0.55 < y1:
        if not any(abs(y + 0.25 - d) < 0.75 for d in skip):
            car_seat(x, y, floor + 0.45, width=0.86, back=0.66, headrest=False)
        y += row


def bus(key):
    vk.prepare()
    set_arch(True)
    b = dict(BUSES[key])
    toy = vk.STYLE == "arcade"
    if toy:
        # Shorter, with fewer windows; the wheels keep their size.
        k = 0.8
        b.update(L=b["L"] * k, front=b["front"] * k, rear=b["rear"] * k, windows=max(3, round(b["windows"] * k)), doors_at=tuple(y * k for y in b["doors_at"]))
    bonnet = b.get("bonnet")
    upper = b.get("upper")
    # Only the school bus has a hood. On the others the shoulder of the body stays low, so the
    # windshield reaches almost down to the bumper; the side windows are laid over the body.
    shoulder = b["h_belt"] if bonnet else b["zb"] + 0.62
    zb = b["zb"]
    d = dict(
        L=b["L"], W=b["W"], zb=zb, hood=b["hood"] if bonnet else 0.34, ws=b["ws"], roof=b["L"] - (b["hood"] if bonnet else 0.34) - b["ws"] - b["rw"] - 0.3, rw=b["rw"],
        h_belt=shoulder, h_roof=b["h_roof"], h_nose=shoulder - 0.2 if bonnet else shoulder - 0.12, h_hl=shoulder - 0.12 if bonnet else shoulder - 0.06,
        h_cowl=shoulder - 0.04, h_deck=b["h_roof"] - 0.02, h_tail=b["h_roof"] - 0.04, roof_w=b["W"] * 0.47, box=0.86, waist=1.0, crown=0.0, nose_w=0.97, tail_w=0.985,
        doors=2, no_side_glass=True, b=0.5, hl=0.3 if bonnet else 0.22, lamp="square", lamp_size=(0.34, 0.18), lamp_drop=0.3 if bonnet else 0.18,
        bumpers="none", grille=(0.9, 0.28, shoulder - 0.68) if bonnet else (1.1, 0.14, shoulder - 0.34), grille_style="bars" if bonnet else "mesh", exhaust=0,
        regions={"PILLAR": "paint", **b.get("regions", {})}, sill=0.12, rear_glass=False,
        # A flat back: one wide window up high, the engine grille low and tall lamps at the corners.
        flat_back=True, rear_windows=1, rear_glass_w=1.5, rear_glass_bottom=b["h_roof"] - 1.12, rear_glass_gap=0.3, rear_handle=False, rear_step=False,
        tail="vertical", tail_h=0.7, tail_z=zb + 1.0,
    )
    axles = [(b["front"], b["r"]), (b["rear"], b["r"], None, vk.STYLE == "real")]
    hw = b["W"] / 2
    L = b["L"] / 2
    y_cowl = L - d["hood"]
    y_rf = y_cowl - b["ws"]
    y_tail = -L + b["rw"] + 0.5
    window_z = (b["h_belt"] + b["h_roof"] - 0.34) / 2
    height = b["h_roof"] - 0.34 - b["h_belt"] - 0.05
    if upper:
        height = b["h_upper"] - 0.26 - b["h_belt"]
        window_z = (b["h_belt"] + b["h_upper"] - 0.26) / 2
    upper_z = (b["h_upper"] + 0.14 + b["h_roof"] - 0.34) / 2 if upper else 0.0
    upper_h = b["h_roof"] - 0.34 - b["h_upper"] - 0.14 if upper else 0.0
    doors = list(b["doors_at"])
    door_top = (b["h_upper"] if upper else b["h_roof"]) - 0.34
    door_bottom = zb + 0.14
    band = (y_tail, y_rf - 0.12)
    real = vk.realistic()
    if real:
        # Real openings, so the seats show through the tinted glass.
        holes = []
        for s in (-1, 1):
            holes.append(((0.5, band[1] - band[0], height), (s * hw, (band[0] + band[1]) / 2, window_z)))
            if upper:
                holes.append(((0.5, band[1] - band[0], upper_h), (s * hw, (band[0] + band[1]) / 2, upper_z)))
        for dy in doors:
            holes.append(((0.5, 0.95, door_top - door_bottom - 0.1), (hw, dy, (door_top + door_bottom) / 2)))
        d["carve"] = holes + window_holes(d)
    with kit.Group() as g:
        body, surface = build_body(d, axles)
        surface.half = hw
        grille(d, surface)
        headlights(d, surface)
        taillights(d, surface)
        flat_back(d, surface)
        kit.rbox("bumper_f", (b["W"] * 0.98, 0.14, 0.34), (0, L + 0.03, zb + 0.14), mat="z_plastic", bevel=0.05, segs=2)
        kit.rbox("bumper_r", (b["W"] * 0.98, 0.14, 0.34), (0, -L - 0.03, zb + 0.14), mat="z_plastic", bevel=0.05, segs=2)
        kit.rbox("plate", (0.46, 0.03, 0.14), (0, L + 0.11, zb + 0.14), mat="z_plate", bevel=0.005, segs=1)
        kit.rbox("plate", (0.46, 0.03, 0.14), (0, -L - 0.11, zb + 0.14), mat="z_plate", bevel=0.005, segs=1)
        # Engine grille on the back.
        for i in range(6):
            z = zb + 0.42 + i * 0.09
            patch("louver", surface, box_shape(b["W"] * 0.5, 0.035, 0.012), (0, -L, z), (0, -1, 0), [(0, 0.004, "z_carbon")], fill="z_carbon", step=0.06)
        count = b["windows"]
        pitch = (y_rf - y_tail) / count
        for s in (-1, 1):
            if real:
                bus_glazing(surface, hw, band[0], band[1], window_z - height / 2, window_z + height / 2, count, s, skip=doors if s > 0 else ())
                if upper:
                    bus_glazing(surface, hw, band[0], band[1], upper_z - upper_h / 2, upper_z + upper_h / 2, count, s)
            else:
                for i in range(count):
                    y = y_tail + pitch * (i + 0.5)
                    if s > 0 and any(abs(y - dy) < pitch * 0.72 for dy in doors):
                        continue
                    window_strip(surface, y, window_z, pitch - 0.14, height, s)
                if upper:
                    for i in range(count):
                        window_strip(surface, y_tail + pitch * (i + 0.5), upper_z, pitch - 0.14, upper_h, s)
            for y, radius, *_ in axles:
                arch(surface, y, radius, radius * ARCH, s, zb + 0.05, width=0.05, lift=0.014, mat="z_trim")
            if b.get("luggage"):
                bays = 4
                span = (y_rf - 0.3 - y_tail) / bays
                for i in range(bays):
                    y = y_tail + span * (i + 0.5)
                    if any(abs(y - axle[0]) < axle[1] * 1.5 for axle in axles):
                        continue
                    patch("bay", surface, box_shape(span - 0.12, b["h_belt"] - zb - 0.5, 0.05), (s * 0.8, y, (zb + 0.25 + b["h_belt"] - 0.2) / 2), (s, 0, 0), [(0, -0.002, "z_rubber"), (0.012, 0.012, "z_trim")], fill="z_trim", step=0.2)
                    kit.rbox("bay_handle", (0.02, 0.16, 0.04), (s * (hw + 0.018), y, b["h_belt"] - 0.36), mat="z_chrome", bevel=0.006, segs=1)
            if b.get("paint_stripes"):
                for z in (b["h_belt"] - 0.22, b["h_belt"] - 0.44):
                    side_line(surface, axles[1][0] + b["r"] * 1.24, axles[0][0] - b["r"] * 1.24, z, 0.05, s, depth=0.004, mat="z_carbon")
            elif not b.get("luggage"):
                side_line(surface, axles[1][0] + b["r"] * 1.24, axles[0][0] - b["r"] * 1.24, b["h_belt"] - 0.3, 0.26, s, depth=0.004, mat="z_accent")
            side_line(surface, -L + 0.5, y_rf - 0.04, b["h_roof"] - 0.2, 0.14, s, depth=0.004, mat="z_trim")
        for dy in doors:
            bus_door(surface, dy, (door_top + door_bottom) / 2, door_top - door_bottom, 1)
        if bonnet:
            mirrors(hw - 0.02, y_cowl - 0.16, b["h_belt"] + 0.3, mat="z_carbon", size=1.6)
        else:
            mirrors(hw + 0.02, y_cowl - 0.14, b["h_belt"] + 0.45, mat="z_carbon", size=1.6)
        for x in (-0.55, 0.55):
            kit.cyl("marker", 0.028, 0.012, (x, y_rf + 0.04, b["h_roof"] + 0.012), (0, 0, 1), mat="z_amber", segs=10)
        kit.rbox("ac", (1.3, 2.2, 0.2), (0, 0.0, b["h_roof"] + 0.1), mat="z_trim", bevel=0.06, segs=2)
        for y in (-0.55, 0.55):
            kit.cyl("ac_fan", 0.34, 0.02, (0, y, b["h_roof"] + 0.205), (0, 0, 1), mat="z_plastic", segs=18)
            kit.cyl("ac_hub", 0.08, 0.03, (0, y, b["h_roof"] + 0.21), (0, 0, 1), mat="z_steel", segs=10)
        kit.rbox("display", (1.1, 0.03, 0.2), (0, y_rf + 0.1, b["h_roof"] - 0.3), mat="z_amber", bevel=0.01, segs=1, rot=(-40, 0, 0))
        wiper_y = y_cowl + 0.02
        for x in (-0.55, 0.35):
            kit.tube("wiper", [(x, wiper_y, d["h_cowl"] + 0.05), (x + 0.45, wiper_y - 0.12, d["h_cowl"] + 0.62)], 0.009, mat="z_plastic", fillet=0, n=5)
        if real:
            bus_interior(b, d, body, hw, L, y_cowl, y_rf, y_tail, doors)
    if toy:
        return toy_finish([body, *g.objs], axles, hw, {}, b["r"])
    return [body, *g.objs], axles, hw


def bus_interior(b, d, body, hw, L, y_cowl, y_rf, y_tail, doors):
    """Lining, floor, rows of seats and the driver's place, seen through the windows."""
    lining(body, -L - 0.1, L + 0.1)
    floor = b["h_belt"] - 0.74
    kit.rbox("floor", (2 * hw - 0.12, 2 * L - 0.4, 0.04), (0, 0, floor), mat="z_cabin", bevel=0)
    front = y_cowl - 1.55
    for s in (-1, 1):
        bus_seats(hw, y_tail, front, floor, s, skip=doors if s > 0 else ())
    if b.get("upper"):
        upper = b["h_upper"] - 0.02
        kit.rbox("upper_floor", (2 * hw - 0.12, 2 * L - 0.4, 0.06), (0, 0, upper), mat="z_cabin", bevel=0)
        for s in (-1, 1):
            bus_seats(hw, y_tail, y_rf - 0.2, upper, s)
    driver = -(hw - 0.55)
    car_seat(driver, y_cowl - 1.25, floor + 0.5, width=0.52, back=0.68)
    # A bus driver sits high, with the wheel almost flat in front of the knees.
    dashboard(y_cowl - 0.05, y_cowl - 0.55, floor + 0.82, hw - 0.1, driver, wheel_radius=0.24, wheel_tilt=34)


# --- motorcycles ------------------------------------------------------------------------------


def moto_wheel(y, r, width, hub_mat="z_rim", spokes_count=9, knobby=False, rim=0.74):
    """A motorcycle wheel, built with the bike and centered on it."""
    with kit.Group() as g:
        moto_wheel_parts(y, r, width, hub_mat, spokes_count, knobby, rim)
    vk.orient_out(g.objs, (0.0, y, r))
    for obj in g.objs:
        if obj is not None:
            kit._register(obj)


def moto_wheel_parts(y, r, width, hub_mat, spokes_count, knobby, rim):
    with_matrix = Matrix.Translation((0, y, r))
    h = width / 2
    rim_r = r * rim
    wall = r - rim_r
    profile = [(-h * 0.2, r - 0.004), (0, r), (h * 0.2, r - 0.004), (h * 0.62, r - wall * 0.18), (h * 0.95, r - wall * 0.45), (h, r - wall * 0.72), (h * 0.8, r - wall * 0.94), (h * 0.62, rim_r)]
    profile = [(-x, ring) for x, ring in reversed(profile[1:])] + profile
    kit.lathe("tire", profile, 30, mat="rubber", mtx=with_matrix, sharp_angle=60.0)
    kit.lathe("rim", [(-h * 0.66, rim_r + 0.008), (h * 0.66, rim_r + 0.008), (h * 0.5, rim_r - 0.022), (-h * 0.5, rim_r - 0.022)], 30, mat="z_rim", closed=True, mtx=with_matrix, sharp_angle=50.0)
    kit.cyl("disc", r * 0.36, 0.008, (h * 0.8, y, r), (1, 0, 0), mat="z_chrome", segs=24)
    kit.cyl("hub", 0.06, width, (0, y, r), (1, 0, 0), mat="z_dark_metal", segs=14)
    for i in range(spokes_count):
        a = 2 * pi * i / spokes_count
        p0 = V((0.006, y + cos(a) * 0.05, r + sin(a) * 0.05))
        p1 = V((0.0, y + cos(a) * (rim_r - 0.02), r + sin(a) * (rim_r - 0.02)))
        kit.tube("spoke", [tuple(p0), tuple(p1)], 0.012, mat="z_rim", fillet=0, n=5)
    if knobby:
        for k in range(20):
            a = 2 * pi * k / 20
            for s in (-1, 1):
                b = a + (pi / 20 if s > 0 else 0)
                kit.rbox("knob", (0.04, 0.04, 0.03), (s * 0.03, 0, r + 0.006), mat="rubber", bevel=0.006, segs=1, mtx=Matrix.Translation((0, y, r)) @ Matrix.Rotation(b, 4, "X") @ Matrix.Translation((0, 0, -r)))


MOTOS = {
    "esportiva": dict(name="Moto esportiva", front=0.76, rear=-0.68, r=0.31, width=0.13, rear_width=0.18, head=(0.4, 1.0), seat=0.84, tank=1.0, tank_w=0.14, bars="clip", kind="sport", spokes=5, tail_up=0.12, rim=0.76),
    "custom": dict(name="Moto custom", front=1.0, rear=-0.74, r=0.33, width=0.15, head=(0.5, 0.98), seat=0.66, tank=0.94, bars="pull", kind="custom", spokes=14, chrome=True, tail_up=0.02, rim=0.7),
    "naked": dict(name="Moto naked", front=0.76, rear=-0.68, r=0.31, width=0.17, head=(0.42, 1.0), seat=0.84, tank=1.02, bars="flat", kind="naked", spokes=7, tail_up=0.07),
    "scooter": dict(name="Scooter", front=0.66, rear=-0.62, r=0.24, width=0.12, scooter=True, spokes=5, rim=0.62),
    "trilha": dict(name="Moto de trilha", front=0.82, rear=-0.72, r=0.36, width=0.1, head=(0.44, 1.14), seat=0.98, tank=1.14, tank_drop=0.2, tank_w=0.125, bars="wide", kind="trail", spokes=20, knobby=True, tail_up=0.05, rim=0.76),
}


def moto(key):
    vk.prepare()
    m = MOTOS[key]
    f, b, r, w = m["front"], m["rear"], m["r"], m["width"]
    with kit.Group() as g:
        moto_wheel(f, r, w, spokes_count=m["spokes"], knobby=m.get("knobby", False), rim=m.get("rim", 0.74))
        moto_wheel(b, r, m.get("rear_width", w * 1.05), spokes_count=m["spokes"], knobby=m.get("knobby", False), rim=m.get("rim", 0.74))
        if m.get("scooter"):
            scooter_parts(m)
        else:
            bike_parts(m)
    if vk.STYLE == "arcade":
        # A toy bike: everything wider across, so the tires are fat and the tank is chunky. Only
        # the width changes, so the wheels stay round.
        widen = Matrix.Diagonal((1.45, 1.0, 1.0, 1.0))
        for obj in g.objs:
            if obj is not None:
                obj.data.transform(widen)
                obj.data.update()
    return list(g.objs), [], 0.3


FAIRING_REGIONS = {
    "FAIR": "paint", "STRIPE": "trim", "VENT": "carbon", "LAMP": "light", "BELLY": "carbon", "INTAKE": "carbon",
    "TAIL": "paint", "NOSE": "paint", "GAP": "carbon", "FRAME": "dark_metal", "CARVE": "rubber", "REAR_LAMP": "tail",
}
FAIRING_EDGES = {
    ("FAIR", "LAMP"): 1.0, ("FAIR", "STRIPE"): 0.9, ("FAIR", "VENT"): 1.0, ("STRIPE", "VENT"): 1.0, ("FAIR", "BELLY"): 0.9,
    ("FAIR", "INTAKE"): 1.0, ("LAMP", "INTAKE"): 1.0, ("BELLY", "VENT"): 1.0, ("FAIR", "REAR_LAMP"): 1.0, ("FAIR", "TAIL"): 0.7,
}


def bike_rings(stations, origin_y=0.0):
    """Closed sections through (y, bottom, widest height, top, width, width at the top)."""
    rings = []
    for y, zb, zm, zt, w, wt in stations:
        half = [
            (0.0, zb),
            (w * 0.34, zb + 0.006),
            (w * 0.86, lerp(zb, zm, 0.5)),
            (w, zm),
            (lerp(w, wt, 0.3), lerp(zm, zt, 0.26)),
            (lerp(w, wt, 0.52), lerp(zm, zt, 0.46)),
            (lerp(w, wt, 0.82), lerp(zm, zt, 0.74)),
            (wt * 0.62, zt - 0.006),
            (0.0, zt),
        ]
        rings.append([V((-x, origin_y + y, z)) for x, z in half] + [V((x, origin_y + y, z)) for x, z in reversed(half[1:-1])])
    return rings


def sport_fairing(head, r):
    """The fairing of a sport bike: one cage with sharp lines, built the same way as a car body."""
    vk.mark_regions(FAIRING_REGIONS)
    rings = bike_rings([
        (-0.50, 0.50, 0.62, 0.72, 0.05, 0.035),
        (-0.42, 0.40, 0.58, 0.78, 0.15, 0.105),
        (-0.28, 0.33, 0.57, 0.82, 0.185, 0.13),
        (-0.12, 0.36, 0.61, 0.88, 0.19, 0.14),
        (0.00, 0.51, 0.70, 0.94, 0.18, 0.13),
        (0.10, 0.65, 0.80, 0.99, 0.16, 0.10),
        (0.20, 0.74, 0.85, 0.98, 0.13, 0.075),
        (0.28, 0.79, 0.87, 0.94, 0.095, 0.05),
        (0.34, 0.835, 0.88, 0.91, 0.045, 0.02),
    ], head.y)

    def region(i, column):
        if i >= 6 and column in (3, 4, 5):
            return "LAMP"
        if i == 7 and column in (1, 2):
            return "INTAKE"
        if column <= 1:
            return "BELLY" if i <= 2 else "FAIR"
        if column == 2 and i == 3:
            return "VENT"
        if column == 4 and 1 <= i <= 4:
            return "STRIPE"
        return "FAIR"

    fairing = vk.cage("fairing", rings, region, FAIRING_REGIONS, longitudinal={3: 0.9, 6: 0.85, 2: 0.5}, border=FAIRING_EDGES, ends={-1: (0.7, 0.01), 1: (0.6, 0.012)})
    finish_surface(fairing, FAIRING_REGIONS, [("FAIR", "VENT"), ("STRIPE", "VENT"), ("FAIR", "BELLY"), ("FAIR", "LAMP"), ("LAMP", "INTAKE")], insets=(), gap=0.0035, depth=0.005)
    kit._register(fairing)
    keys = [dict(pos=head.y + 0.24, c2=0.962, w=0.07, h=0.005), dict(pos=head.y + 0.13, c2=1.02, w=0.085, h=0.006), dict(pos=head.y + 0.05, c2=1.055, w=0.05, h=0.005)]
    kit.loft("windscreen", keys, n=12, sub=3, mat="z_glass", sharp_angle=60.0)
    for s in (-1, 1):
        kit.tube("mirror_stem", [(s * 0.13, head.y + 0.12, 0.92), (s * 0.2, head.y + 0.14, 0.99)], 0.007, mat="z_dark_metal", fillet=0, n=5)
        kit.rbox("mirror", (0.085, 0.022, 0.045), (s * 0.225, head.y + 0.14, 1.0), mat="z_carbon", bevel=0.012, segs=1)
        for k in range(3):
            kit.rbox("vent_slat", (0.012, 0.11, 0.01), (s * 0.2, head.y - 0.06, 0.47 + k * 0.03), mat="z_chrome", bevel=0)


def sport_tail(seat_end, tank_end):
    """The solid tail of a sport bike, kicked up, that hides the subframe."""
    vk.mark_regions(FAIRING_REGIONS)
    rings = bike_rings([
        (seat_end - 0.08, 0.955, 0.965, 0.985, 0.045, 0.03),
        (seat_end + 0.02, 0.84, 0.91, 0.955, 0.09, 0.07),
        (lerp(seat_end, tank_end, 0.28), 0.74, 0.86, 0.905, 0.125, 0.1),
        (lerp(seat_end, tank_end, 0.55), 0.64, 0.8, 0.865, 0.13, 0.11),
        (lerp(seat_end, tank_end, 0.8), 0.56, 0.74, 0.84, 0.12, 0.1),
        (tank_end, 0.52, 0.7, 0.82, 0.1, 0.08),
    ])

    def region(i, column):
        if i == 0:
            return "REAR_LAMP"
        if column == 4 and i >= 1:
            return "STRIPE"
        return "FAIR"

    tail = vk.cage("tail", rings, region, FAIRING_REGIONS, longitudinal={3: 0.85, 6: 0.8}, border=FAIRING_EDGES, end_regions=("REAR_LAMP", "NOSE"), ends={-1: (0.7, 0.008), 1: (0.8, 0.01)})
    finish_surface(tail, FAIRING_REGIONS, [("FAIR", "REAR_LAMP"), ("STRIPE", "REAR_LAMP")], insets=(), gap=0.003, depth=0.004)
    kit._register(tail)


def bike_parts(m):
    f, b, r, w = m["front"], m["rear"], m["r"], m["width"]
    kind = m["kind"]
    chrome = m.get("chrome", False)
    metal = "z_chrome" if chrome else "z_dark_metal"
    wheelbase = f - b
    at = lambda t: b + wheelbase * t
    head = V((0.0, m["head"][0], m["head"][1]))
    axle = V((0.0, f, r))
    fork_axis = (head - axle).normalized()
    fork_top = head + fork_axis * 0.05
    head_low = head - fork_axis * 0.16
    seat_z = m["seat"]
    tank_top = m["tank"]
    pivot = V((0.0, at(0.4), r + 0.13))
    engine = V((0.0, at(0.585), r + 0.09))

    # Fork, with thicker sliders at the bottom.
    for s in (-1, 1):
        x0 = s * (w / 2 + 0.035)
        x1 = s * 0.075
        lower = axle.lerp(fork_top, 0.46)
        kit.tube("fork", [(x0, axle.y, axle.z), (x1, fork_top.y, fork_top.z)], 0.021, mat="z_chrome", fillet=0, n=10)
        kit.tube("slider", [(x0, axle.y, axle.z), (lerp(x0, x1, 0.46), lower.y, lower.z)], 0.03, mat=metal, fillet=0, n=10)
        kit.cyl("axle_nut", 0.028, 0.02, (x0 + s * 0.03, axle.y, axle.z), (1, 0, 0), mat="z_chrome", segs=8)
    kit.rbox("tree_low", (0.2, 0.08, 0.03), tuple(head_low), mat=metal, bevel=0.01, segs=1)
    kit.rbox("tree_top", (0.2, 0.08, 0.03), tuple(fork_top), mat=metal, bevel=0.01, segs=1)
    kit.tube("steering_head", [tuple(head_low), tuple(fork_top)], 0.032, mat="z_dark_metal", fillet=0, n=10)

    # Handlebars.
    half, rise, back = {"clip": (0.3, -0.03, 0.06), "flat": (0.34, 0.09, 0.05), "pull": (0.38, 0.2, 0.2), "wide": (0.42, 0.14, 0.06)}[m["bars"]]
    bar_z = fork_top.z + rise
    y = fork_top.y
    if m["bars"] == "clip":
        for s in (-1, 1):
            kit.tube("bar", [(s * 0.075, y, fork_top.z - 0.01), (s * half, y - back, fork_top.z - 0.05)], 0.013, mat=metal, fillet=0, n=8)
    else:
        kit.tube("bar", [(-half, y - back, bar_z), (-0.14, y - back * 0.4, bar_z - rise * 0.2), (-0.05, y, fork_top.z + 0.02), (0.05, y, fork_top.z + 0.02), (0.14, y - back * 0.4, bar_z - rise * 0.2), (half, y - back, bar_z)], 0.013, mat="z_chrome" if chrome else "z_dark_metal", fillet=0.05, n=8)
    grip_z = fork_top.z - 0.05 if m["bars"] == "clip" else bar_z
    for s in (-1, 1):
        kit.tube("grip", [(s * half, y - back, grip_z), (s * (half - 0.13), y - back * 0.8, grip_z)], 0.018, mat="rubber", fillet=0, n=8)
        kit.rbox("lever", (0.13, 0.012, 0.012), (s * (half - 0.09), y - back * 0.8 + 0.06, grip_z), mat="z_chrome", bevel=0)
        if m["bars"] != "clip":
            kit.tube("mirror_stem", [(s * (half - 0.14), y - back * 0.8, grip_z), (s * (half - 0.09), y - back, grip_z + 0.11)], 0.007, mat="z_chrome", fillet=0, n=5)
            kit.rbox("mirror", (0.1, 0.02, 0.07), (s * (half - 0.08), y - back, grip_z + 0.135), mat="z_carbon", bevel=0.012, segs=1)

    # Frame: a cradle under the engine and a backbone to the swingarm pivot.
    tank_end = at(0.47 if kind == "sport" else 0.6)
    over = V((0.0, at(0.46), seat_z - 0.06))
    for s in (-1, 1):
        x = s * 0.07
        kit.tube("backbone", [(x * 0.5, head.y - 0.02, head.z - 0.05), (x, over.y, over.z), (x, pivot.y, pivot.z + 0.02)], 0.018, mat="z_dark_metal", fillet=0.08, n=8)
        kit.tube("cradle", [(x * 0.5, head_low.y - 0.02, head_low.z), (x, engine.y + 0.24, engine.z + 0.02), (x, engine.y + 0.16, engine.z - 0.17), (x, pivot.y + 0.05, pivot.z - 0.2), (x, pivot.y, pivot.z - 0.02)], 0.016, mat="z_dark_metal", fillet=0.06, n=8)
        if kind != "sport":
            kit.tube("subframe", [(x, over.y + 0.02, over.z), (x * 0.7, at(0.12), seat_z - 0.02)], 0.012, mat="z_dark_metal", fillet=0, n=6)
            kit.tube("strut", [(x, pivot.y - 0.02, pivot.z + 0.08), (x * 0.7, at(0.16), seat_z - 0.02)], 0.011, mat="z_dark_metal", fillet=0, n=6)
        rear_w = m.get("rear_width", w)
        kit.tube("swingarm", [(s * 0.06, pivot.y, pivot.z), (s * (rear_w / 2 + 0.035), b, r)], 0.022, mat=metal, fillet=0, n=8)
        kit.cyl("swing_nut", 0.028, 0.02, (s * (rear_w / 2 + 0.06), b, r), (1, 0, 0), mat="z_chrome", segs=8)
        if kind not in ("custom", "sport") or (kind == "custom" and s > 0):
            mid = pivot.lerp(V((0.0, b, r)), 0.56)
            top = (x * 0.7, at(0.2), seat_z - 0.05)
            kit.tube("shock", [(s * 0.075, mid.y, mid.z + 0.01), top], 0.015, mat="z_chrome", fillet=0, n=8)
            kit.tube("spring", [(s * 0.075, lerp(mid.y, top[1], 0.2), lerp(mid.z, top[2], 0.2)), (x * 0.82, lerp(mid.y, top[1], 0.78), lerp(mid.z, top[2], 0.78))], 0.025, mat="z_accent", fillet=0, n=8)
    if kind == "sport":
        low = pivot.lerp(V((0.0, b, r)), 0.3)
        high = V((0.0, at(0.3), seat_z - 0.14))
        kit.tube("mono_shock", [tuple(low), tuple(high)], 0.016, mat="z_chrome", fillet=0, n=8)
        kit.tube("mono_spring", [tuple(low.lerp(high, 0.2)), tuple(low.lerp(high, 0.8))], 0.032, mat="z_accent", fillet=0, n=10)
    kit.rbox("pivot_plate", (0.17, 0.09, 0.09), tuple(pivot), mat="z_dark_metal", bevel=0.012, segs=1)

    # Engine.
    kit.rbox("crankcase", (0.2, 0.36, 0.2), tuple(engine), mat="z_dark_metal", bevel=0.05, segs=2)
    for s in (-1, 1):
        kit.cyl("clutch", 0.09, 0.025, (s * 0.113, engine.y - 0.07, engine.z - 0.01), (1, 0, 0), mat="z_chrome", segs=18, bevel=0.01, bsegs=1)
    angles_list = [-22, 22] if kind == "custom" else [-16]
    for angle in angles_list:
        tilt = radians(angle)
        direction = V((0, sin(-tilt), cos(tilt)))
        base = engine + V((0, 0.05 if angle > 0 else -0.05 if kind == "custom" else 0.04, 0.09))
        center = base + direction * 0.12
        kit.rbox("cylinder", (0.14, 0.12, 0.16), tuple(center), mat="z_steel", bevel=0.01, segs=1, rot=(angle, 0, 0))
        for k in range(5):
            kit.rbox("fin", (0.18, 0.16, 0.01), tuple(base + direction * (0.05 + k * 0.03)), mat="z_chrome", bevel=0, rot=(angle, 0, 0))
        kit.rbox("head", (0.16, 0.13, 0.05), tuple(base + direction * 0.21), mat="z_dark_metal", bevel=0.012, segs=1, rot=(angle, 0, 0))

    # Tank.
    z0 = seat_z - m.get("tank_drop", 0.02)
    height = max(0.1, tank_top - z0)
    tank_w = m.get("tank_w", 0.15)
    keys = [
        dict(pos=head.y - 0.04, c2=z0 + height * 0.44, w=0.052, h=height * 0.26, e=2.2),
        dict(pos=head.y - 0.12, c2=z0 + height * 0.54, w=tank_w * 0.77, h=height * 0.46),
        dict(pos=lerp(head.y - 0.12, tank_end, 0.45), c2=z0 + height * 0.52, w=tank_w, h=height * 0.54),
        dict(pos=lerp(head.y - 0.12, tank_end, 0.84), c2=z0 + height * 0.34, w=tank_w * 0.87, h=height * 0.4),
        dict(pos=tank_end, c2=z0 + height * 0.16, w=0.07, h=height * 0.16),
    ]
    tank = kit.loft("tank", keys, n=16, sub=4, mat="z_paint", sharp_angle=46.0)
    surface = Surface(tank)
    # The stripes of a sport bike are on its fairing.
    for s in (-1, 1) if kind != "sport" else ():
        y0, y1 = head.y - 0.18, tank_end + 0.1
        outline = rounded([(y0 - head.y, -height * 0.13), (y1 - head.y, -height * 0.28), (y1 - head.y + 0.03, -height * 0.1), (y0 - head.y + 0.04, height * 0.16)], 0.02)
        points = [(p[0], p[1]) for p in outline]
        patch("tank_stripe", surface, [(-p[0], p[1]) for p in points], (s * 0.1, head.y, z0 + height * 0.5), (s, 0, 0), [(0, 0.003, "z_accent")], fill="z_accent", mirror=s > 0, step=0.03)
    kit.cyl("tank_cap", 0.042, 0.018, (0, lerp(head.y - 0.12, tank_end, 0.45), tank_top + 0.002), (0, 0, 1), mat="z_chrome", segs=12, bevel=0.005, bsegs=1)

    # Seat and tail.
    seat_end = at(0.14)
    tail_lift = m.get("tail_up", 0.0)
    keys = [
        dict(pos=tank_end + 0.03, c2=seat_z - 0.01, w=0.09, h=0.025),
        dict(pos=tank_end - 0.03, c2=seat_z, w=0.135, h=0.045),
        dict(pos=lerp(tank_end, seat_end, 0.55), c2=seat_z + tail_lift * 0.35, w=0.125, h=0.045),
        dict(pos=seat_end + 0.04, c2=seat_z + tail_lift, w=0.09, h=0.04),
        dict(pos=seat_end, c2=seat_z + tail_lift, w=0.05, h=0.018),
    ]
    kit.loft("seat", keys, n=12, sub=4, mat="z_seat", sharp_angle=60.0)
    if kind == "sport":
        sport_tail(seat_end, tank_end)
    else:
        keys = [
            dict(pos=lerp(tank_end, seat_end, 0.28), c2=seat_z - 0.09, w=0.1, h=0.04),
            dict(pos=lerp(tank_end, seat_end, 0.5), c2=seat_z - 0.05 + tail_lift * 0.3, w=0.115, h=0.07),
            dict(pos=seat_end + 0.03, c2=seat_z - 0.0 + tail_lift, w=0.085, h=0.045),
            dict(pos=seat_end - 0.06, c2=seat_z + 0.01 + tail_lift, w=0.04, h=0.022),
        ]
        kit.loft("tail", keys, n=12, sub=3, mat="z_trim", sharp_angle=46.0, cap_mat="z_tail")
        kit.rbox("tail_lamp", (0.1, 0.022, 0.032), (0, seat_end - 0.05, seat_z + 0.005 + tail_lift), mat="z_tail", bevel=0.008, segs=1)
    kit.rbox("plate", (0.16, 0.012, 0.09), (0, b + 0.08, r + 0.32), mat="z_plate", bevel=0.005, segs=1, rot=(-24, 0, 0))
    kit.tube("plate_arm", [(0, at(0.14), seat_z + (0.06 if kind == "sport" else -0.02)), (0, b + 0.08, r + 0.36)], 0.01, mat="z_dark_metal", fillet=0, n=5)
    for s in (-1, 1):
        signal_z = 0.89 if kind == "sport" else seat_z - 0.04
        kit.rbox("signal", (0.05, 0.03, 0.025), (s * (0.115 if kind == "sport" else 0.13), seat_end + 0.04, signal_z), mat="z_amber", bevel=0.008, segs=1)
        if kind != "sport":
            keys = [dict(pos=at(0.5), c1=s * 0.1, c2=seat_z - 0.13, w=0.01, h=0.025), dict(pos=at(0.46), c1=s * 0.105, c2=seat_z - 0.13, w=0.012, h=0.07), dict(pos=at(0.3), c1=s * 0.105, c2=seat_z - 0.11, w=0.012, h=0.055), dict(pos=at(0.26), c1=s * 0.1, c2=seat_z - 0.1, w=0.01, h=0.02)]
            kit.loft("side_cover", keys, n=8, sub=2, mat="z_paint", sharp_angle=60.0)

    # Fenders.
    arcs = {"front": (f, w + 0.03, "z_paint", 46, 150 if kind != "trail" else 120, r + 0.05), "rear": (b, w + 0.04, "z_trim", 24, 118, r + 0.05)}
    if kind == "sport":
        arcs["rear"] = (b, m.get("rear_width", w) + 0.03, "z_carbon", 34, 96, r + 0.035)
    if kind == "custom":
        arcs["rear"] = (b, w + 0.06, "z_paint", 10, 130, r + 0.04)
        arcs["front"] = (f, w + 0.04, "z_paint", 26, 154, r + 0.04)
    for y0, width, mat, a0, a1, radius in arcs.values():
        path = [(0, y0 + radius * cos(radians(a)), r + radius * sin(radians(a))) for a in [lerp(a0, a1, i / 14) for i in range(15)]]
        kit.sweep("fender", path, [(-width / 2, 0.008), (width / 2, 0.008), (width / 2, -0.008), (-width / 2, -0.008)], up=(1, 0, 0), mat=mat, sharp_angle=50.0)
    if kind == "trail":
        keys = [dict(pos=f + 0.3, c2=r + 0.42, w=0.05, h=0.006), dict(pos=f + 0.05, c2=r + 0.44, w=0.08, h=0.01), dict(pos=f - 0.3, c2=r + 0.41, w=0.07, h=0.008)]
        kit.loft("fender_high", keys, n=8, sub=3, mat="z_paint", sharp_angle=60.0)

    # Exhaust on the right side.
    x = 0.17
    pipe_y = at(0.3)
    pipe_z = r + (0.22 if kind == "trail" else 0.03)
    muffler_end = b - 0.1 if kind not in ("trail", "sport") else b + 0.05
    if kind == "sport":
        pipe_y = at(0.2)
        pipe_z = r + 0.06
    kit.tube("header", [(0.05, engine.y + 0.13, engine.z + 0.26), (0.12, engine.y + 0.3, engine.z + 0.05), (x, engine.y + 0.12, engine.z - 0.17), (x, pipe_y + 0.1, pipe_z)], 0.022, mat="z_chrome", fillet=0.06, n=10)
    rise = {"custom": 0.03, "sport": 0.2}.get(kind, 0.12)
    keys = [dict(pos=pipe_y + 0.14, c1=x, c2=pipe_z, w=0.03, h=0.03), dict(pos=pipe_y + 0.04, c1=x, c2=pipe_z + rise * 0.2, w=0.062, h=0.062), dict(pos=muffler_end + 0.08, c1=x, c2=pipe_z + rise, w=0.068, h=0.068), dict(pos=muffler_end, c1=x, c2=pipe_z + rise, w=0.052, h=0.052)]
    kit.loft("muffler", keys, n=14, sub=2, mat="z_chrome", sharp_angle=44.0, cap_mat="z_carbon")
    if kind == "custom":
        keys_low = [dict(k, c2=k["c2"] - 0.12) for k in keys]
        kit.tube("header2", [(0.05, engine.y - 0.1, engine.z + 0.24), (0.15, engine.y - 0.1, engine.z + 0.02), (x, pipe_y + 0.1, pipe_z - 0.12)], 0.02, mat="z_chrome", fillet=0.06, n=10)
        kit.loft("muffler2", keys_low, n=14, sub=2, mat="z_chrome", sharp_angle=44.0, cap_mat="z_carbon")

    # Front of the bike.
    if kind == "sport":
        sport_fairing(head, r)
    else:
        radius = 0.09 if kind != "trail" else 0.06
        lamp_at = head_low + V((0, 0.14, 0.06))
        matrix = Matrix.Translation(tuple(lamp_at)) @ Matrix.Rotation(pi / 2, 4, "Z")
        kit.lathe("lamp_body", [(-0.09, 0.05), (-0.05, radius), (0.03, radius), (0.04, radius - 0.008)], 20, mat="z_chrome" if chrome else "z_dark_metal", sharp_angle=40.0, mtx=matrix)
        kit.lathe("lamp_lens", [(0.04, radius - 0.008), (0.062, radius * 0.5), (0.07, 0.0005)], 18, mat="z_light", sharp_angle=70.0, mtx=matrix)
        for s in (-1, 1):
            kit.tube("lamp_arm", [(s * 0.075, head_low.y + 0.0, head_low.z - 0.01), (s * 0.06, lamp_at.y - 0.03, lamp_at.z)], 0.009, mat=metal, fillet=0, n=5)
        if kind == "naked":
            kit.cyl("clock", 0.05, 0.03, (0, head.y + 0.02, fork_top.z + 0.05), (0.0, 0.5, 1.0), mat="z_carbon", segs=14, bevel=0.008, bsegs=1)
            for s in (-1, 1):
                kit.rbox("radiator", (0.02, 0.2, 0.26), (s * 0.13, engine.y + 0.26, engine.z + 0.12), mat="z_steel", bevel=0.005, segs=1)

    # Foot pegs and the side stand.
    for s in (-1, 1):
        kit.tube("peg", [(s * 0.1, pivot.y - 0.04, r - 0.02), (s * 0.22, pivot.y - 0.04, r - 0.02)], 0.013, mat="z_chrome", fillet=0, n=6)
    kit.tube("stand", [(-0.1, pivot.y - 0.02, r - 0.05), (-0.3, pivot.y - 0.2, 0.012)], 0.012, mat="z_dark_metal", fillet=0, n=6)


def scooter_parts(m):
    f, b, r, w = m["front"], m["rear"], m["r"], m["width"]
    # Step-through body: a shield in front, a floor, and a rear body that covers the engine.
    keys = [dict(pos=f + 0.08, c2=0.72, w=0.13, h=0.2, e=2.4), dict(pos=f - 0.04, c2=0.7, w=0.2, h=0.36, e=2.6), dict(pos=f - 0.16, c2=0.62, w=0.2, h=0.42, e=3.0), dict(pos=f - 0.22, c2=0.56, w=0.16, h=0.34, e=3.0)]
    kit.loft("shield", keys, n=18, sub=4, mat="z_paint", sharp_angle=46.0)
    kit.rbox("floor", (0.32, 0.5, 0.05), (0, lerp(b, f, 0.56), 0.24), mat="z_carbon", bevel=0.018, segs=1)
    keys = [dict(pos=f - 0.2, c2=0.22, w=0.15, h=0.05, e=3.0), dict(pos=lerp(b, f, 0.5), c2=0.24, w=0.16, h=0.07, e=3.0), dict(pos=lerp(b, f, 0.34), c2=0.34, w=0.18, h=0.16, e=3.0)]
    kit.loft("underbody", keys, n=14, sub=3, mat="z_paint", sharp_angle=46.0)
    keys = [dict(pos=lerp(b, f, 0.4), c2=0.38, w=0.13, h=0.2, e=2.6), dict(pos=lerp(b, f, 0.2), c2=0.46, w=0.2, h=0.26, e=2.8), dict(pos=b + 0.08, c2=0.5, w=0.2, h=0.24, e=2.8), dict(pos=b - 0.16, c2=0.56, w=0.14, h=0.13, e=2.6), dict(pos=b - 0.2, c2=0.58, w=0.06, h=0.04)]
    kit.loft("rear_body", keys, n=18, sub=4, mat="z_paint", sharp_angle=44.0)
    keys = [dict(pos=lerp(b, f, 0.44), c2=0.72, w=0.13, h=0.04), dict(pos=lerp(b, f, 0.3), c2=0.76, w=0.16, h=0.06), dict(pos=b + 0.1, c2=0.78, w=0.15, h=0.06), dict(pos=b - 0.1, c2=0.78, w=0.1, h=0.05)]
    kit.loft("seat", keys, n=12, sub=3, mat="z_seat", sharp_angle=60.0)
    kit.rbox("rear_rack", (0.2, 0.22, 0.016), (0, b - 0.1, 0.84), mat="z_dark_metal", bevel=0.006, segs=1)
    for s in (-1, 1):
        kit.tube("fork", [(s * (w / 2 + 0.03), f, r), (s * 0.03, f - 0.1, 0.94)], 0.02, mat="z_chrome", fillet=0, n=8)
    kit.tube("steering", [(0, f - 0.1, 0.94), (0, f - 0.14, 1.06)], 0.022, mat="z_dark_metal", fillet=0, n=8)
    kit.tube("bar", [(-0.32, f - 0.2, 1.08), (-0.1, f - 0.14, 1.06), (0.1, f - 0.14, 1.06), (0.32, f - 0.2, 1.08)], 0.012, mat="z_dark_metal", fillet=0.04, n=8)
    for s in (-1, 1):
        kit.tube("grip", [(s * 0.32, f - 0.2, 1.08), (s * 0.22, f - 0.17, 1.075)], 0.018, mat="rubber", fillet=0, n=8)
        kit.rbox("mirror_stem", (0.012, 0.012, 0.09), (s * 0.24, f - 0.18, 1.135), mat="z_chrome", bevel=0)
        kit.sphere("mirror", 0.05, (s * 0.25, f - 0.18, 1.2), scale=(1, 0.3, 0.7), mat="z_carbon", segs=10, rings=6)
    keys = [dict(pos=f - 0.06, c2=1.05, w=0.13, h=0.08, e=2.4), dict(pos=f - 0.14, c2=1.08, w=0.15, h=0.1, e=2.6), dict(pos=f - 0.26, c2=1.1, w=0.12, h=0.07, e=2.6)]
    kit.loft("headset", keys, n=14, sub=3, mat="z_paint", sharp_angle=46.0, cap_mat="z_carbon")
    matrix = Matrix.Translation((0, f + 0.02, 0.86)) @ Matrix.Rotation(pi / 2, 4, "Z")
    kit.lathe("lamp_ring", [(-0.02, 0.08), (0.02, 0.08), (0.03, 0.07)], 18, mat="z_chrome", sharp_angle=40.0, mtx=matrix)
    kit.lathe("lamp_lens", [(0.03, 0.07), (0.05, 0.04), (0.055, 0.0005)], 16, mat="z_light", sharp_angle=70.0, mtx=matrix)
    kit.rbox("tail_lamp", (0.14, 0.02, 0.05), (0, b - 0.22, 0.62), mat="z_tail", bevel=0.01, segs=1)
    kit.rbox("plate", (0.16, 0.012, 0.09), (0, b - 0.2, 0.42), mat="z_plate", bevel=0.005, segs=1, rot=(-8, 0, 0))
    for y, width, mat, a0, a1 in ((f, w + 0.02, "z_trim", 40, 150), (b, w + 0.04, "z_trim", 20, 115)):
        path = [(0, y + (r + 0.045) * cos(radians(a)), r + (r + 0.045) * sin(radians(a))) for a in [lerp(a0, a1, i / 12) for i in range(13)]]
        kit.sweep("fender", path, [(-width / 2, 0.007), (width / 2, 0.007), (width / 2, -0.007), (-width / 2, -0.007)], up=(1, 0, 0), mat=mat, sharp_angle=50.0)
    kit.tube("exhaust", [(0.14, b + 0.2, 0.22), (0.14, b - 0.2, 0.26)], 0.05, mat="z_chrome", fillet=0, n=10)
    kit.tube("stand", [(-0.1, lerp(b, f, 0.5), 0.24), (-0.22, lerp(b, f, 0.42), 0.012)], 0.012, mat="z_dark_metal", fillet=0, n=6)


def wheel(name):
    vk.prepare()
    return vk.build_wheel(name)


def fitted(wheel_zones, axles, hw, width=None):
    """A wheel at each corner, with its outer face near the side of the body. Dual axles get two."""
    width = width or vk.W
    groups = []
    for axle in axles:
        y, radius = axle[:2]
        scale = radius / vk.R
        half = vk.W / 2 * scale
        dual = len(axle) > 3 and axle[3]
        for s in (-1, 1):
            center = axle[2] if len(axle) > 2 and axle[2] is not None else hw - half - 0.015
            for k in (0, 1) if dual else (0,):
                at = center - k * (width + DUAL_GAP) * scale
                matrix = Matrix.Translation((s * at, y, radius)) @ Matrix.Rotation(0 if s > 0 else pi, 4, "Z") @ Matrix.Scale(scale, 4)
                groups.append(vk.transformed(wheel_zones, matrix))
    return vk.merged(*groups)


# Space between the two tires of a dual wheel, in the units of the wheel.
DUAL_GAP = 0.012


def parse():
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    options = {}
    for flag in ("--preview", "--lod", "--style", "--only"):
        if flag in args:
            at = args.index(flag)
            options[flag[2:]] = args[at + 1]
            del args[at : at + 2]
    return args, options


def clear():
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)


def all_models():
    """id -> (group, name, wheel, builder)."""
    models = {}
    for key, d in CARS.items():
        models[key] = ("car", d["name"], d.get("wheel", "liga"), lambda key=key: car(key))
    for key, t in TRUCKS.items():
        models["caminhao_" + key] = ("truck", t["name"], "caminhao", lambda key=key: truck(key))
    for key, b in BUSES.items():
        models["onibus_" + key] = ("bus", b["name"], "caminhao", lambda key=key: bus(key))
    for key in TRACTORS:
        models["trator_" + key] = ("tractor", "Cavalo mecânico", "caminhao", lambda key=key: tractor(key))
    for key, t in TRAILERS.items():
        models["carreta_" + key] = ("trailer", t["name"], "caminhao", lambda key=key: trailer(key))
    for key, m in MOTOS.items():
        models["moto_" + key] = ("moto", m["name"], None, lambda key=key: moto(key))
    for key in GAME_KARTS:
        models["kart_" + key] = ("kart", designs.GAME_SPECS[key][1], "slick", lambda key=key: game_kart(key))
    for key, (_, _, label) in designs.KARTS.items():
        models["kart_" + key] = ("kart", label, "slick", lambda key=key: new_kart(key))
    for key, part, label in (("asa", "spoiler_wing", "Asa clássica"), ("dupla", "spoiler_twin", "Asa dupla"), ("barbatana", "spoiler_fin", "Barbatana"), ("pato", "spoiler_duck", "Rabo de pato"), ("halo", "spoiler_halo", "Halo")):
        models["part_kart_spoiler_" + key] = ("part", label, None, lambda part=part: game_part(part))
    models["part_kart_spoiler_arco"] = ("part", "Arco", None, group_of(designs.build_spoiler_arc))
    models["part_kart_spoiler_jato"] = ("part", "Jatos", None, group_of(designs.build_spoiler_jets))
    models["part_kart_driver"] = ("part", "Piloto", None, driver)
    models["part_kart_helmet_integral"] = ("part", "Capacete integral", None, group_of(kit.build_helmet))
    models["part_kart_helmet_retro"] = ("part", "Capacete retrô", None, group_of(designs.build_helmet_retro))
    models["part_kart_helmet_chifre"] = ("part", "Capacete de chifres", None, group_of(designs.build_helmet_horns))
    models["part_kart_steering"] = ("part", "Volante", None, group_of(kit.build_steering_wheel))
    models["part_veh_taxi_sign"] = ("part", "Placa de táxi", None, group_of(designs.build_taxi_sign))
    models["part_veh_siren"] = ("part", "Sirene", None, group_of(designs.build_siren))
    return models


def stray_report(name, objects):
    for obj in objects:
        coordinates = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
        obj.data.vertices.foreach_get("co", coordinates)
        if len(coordinates) and (np.isnan(coordinates).any() or np.abs(coordinates).max() > 20.0):
            print(f"STRAY {name} {obj.name}")


def build(name, models):
    """Builds one model in the current style: (zones, axles, half width, extra sockets)."""
    group, _, _, builder = models[name]
    clear()
    result = builder()
    objects, axles = result[0], result[1]
    half = result[2] if len(result) > 2 else 0.0
    stray_report(name, objects)
    if group == "part":
        for word, budget in (("helmet", 4500), ("spoiler", 3000), ("steering", 1800)):
            if word in name:
                limit_low(objects, budget)
    return vk.collect(objects), axles, half, (result[3] if len(result) > 3 else None) or {}


WHEEL_NAMES = {
    "liga": "Liga leve", "calota": "Calota", "caminhao": "Caminhão", "slick": "Esportiva", "cravo": "Cravos", "turbina": "Turbina",
    "raio": "Raios", "neon": "Neon", "estrela": "Estrela", "balao": "Balão", "trator": "Trator",
}


class Pack:
    """Writes the binary pack and the catalog the editor reads."""

    def __init__(self):
        self.chunks = []
        self.size = 0
        self.assets = []

    def encode(self, label, zones):
        everything = np.concatenate([p for p, _ in zones.values()])
        low, high = everything.min(axis=0), everything.max(axis=0)
        span = np.maximum(high - low, 1e-6)
        table = {}
        for zone, (p, n) in zones.items():
            q = np.rint((p - low) / span * 65534 - 32767).astype(np.int32)
            k = np.rint(np.clip(n, -1, 1) * 127).astype(np.int32)
            rows, inverse = np.unique(np.hstack((q, k)), axis=0, return_inverse=True)
            inverse = inverse.reshape(-1).reshape(-1, 3)
            keep = (inverse[:, 0] != inverse[:, 1]) & (inverse[:, 1] != inverse[:, 2]) & (inverse[:, 0] != inverse[:, 2])
            inverse = inverse[keep]
            if not len(inverse):
                continue
            used, compact = np.unique(inverse, return_inverse=True)
            rows = rows[used]
            indices = compact.reshape(-1)
            if len(rows) > 65535:
                raise ValueError(f"{label}/{zone} has {len(rows)} vertices")
            vertices = np.zeros(len(rows), dtype=[("p", "<i2", 3), ("n", "i1", 3)])
            vertices["p"] = rows[:, :3]
            vertices["n"] = rows[:, 3:]
            table[zone] = [self.size, len(rows), int(len(indices))]
            for chunk in (vertices.tobytes(), indices.astype("<u2").tobytes()):
                self.chunks.append(chunk)
                self.size += len(chunk)
        return {"zones": table, "min": [round(float(v), 5) for v in low], "max": [round(float(v), 5) for v in high]}

    def write(self):
        repo = os.path.dirname(os.path.dirname(HERE))
        with open(os.path.join(repo, "public", "models", "vehicles.bin"), "wb") as handle:
            for chunk in self.chunks:
                handle.write(chunk)
        lines = ['import type { BakedAsset } from "./baked.ts";', "", "// Generated by tools/blender/build_vehicles.py -- do not edit.", "export const BAKED_ASSETS: BakedAsset[] = ["]
        lines += ["  " + json.dumps(asset, ensure_ascii=False, separators=(",", ":")) + "," for asset in self.assets]
        lines += ["];", ""]
        with open(os.path.join(repo, "src", "blocks", "definitions", "family", "baked.generated.ts"), "w", encoding="utf-8", newline="\n") as handle:
            handle.write("\n".join(lines))
        print(f"PACK {len(self.assets)} assets, {self.size / 1048576:.1f} MB")


def rounded3(values):
    return [round(float(v), 4) for v in values]


def to_editor(zones):
    """Blender (X right, Y front, Z up) to the editor (X left, Y up, Z front)."""
    return {zone: (np.stack((-p[:, 0], p[:, 2], p[:, 1]), axis=1), np.stack((-n[:, 0], n[:, 2], n[:, 1]), axis=1)) for zone, (p, n) in zones.items()}


def wheel_to_editor(zones):
    """A wheel has its axle along Y: the inner face at Y = 0 and the outer one at Y = -W."""
    return {zone: (np.stack((p[:, 1], -p[:, 0] - vk.W / 2, p[:, 2]), axis=1), np.stack((n[:, 1], -n[:, 0], n[:, 2]), axis=1)) for zone, (p, n) in zones.items()}


VOXEL_SIZE = {"wheel": 0.07, "car": 0.09, "truck": 0.125, "bus": 0.125, "tractor": 0.125, "trailer": 0.125, "moto": 0.05, "kart": 0.07, "part": 0.05}
LOW_BUDGET = {"wheel": 900, "car": 6000, "truck": 7000, "bus": 7000, "tractor": 6000, "trailer": 5000, "moto": 2600, "kart": 5000, "part": 1800}
VEHICLE_SOCKETS = ("ground",)


def limit_low(objects, budget):
    """Keeps a low poly model under its budget, without touching small parts."""
    meshes = [obj for obj in objects if obj is not None and obj.type == "MESH"]
    total = sum(kit.tri_count(obj) for obj in meshes)
    if total <= budget:
        return
    ratio = budget / total
    for obj in meshes:
        if kit.tri_count(obj) > 60:
            modifier = obj.modifiers.new("limit", "DECIMATE")
            modifier.decimate_type = "COLLAPSE"
            modifier.ratio = ratio
            modifier.use_collapse_triangulate = True


def low_poly(name, models, level="lp"):
    """Builds the simple version of a model and returns its zones."""
    group, _, _, builder = models[name]
    clear()
    vk.set_lod(level)
    try:
        objects = builder()[0]
        limit_low(objects, LOW_BUDGET[group])
        return vk.collect(objects)
    finally:
        vk.set_lod("hi")


def wheel_low(wheel_id, level="lp"):
    clear()
    vk.set_lod(level)
    try:
        objects = wheel(wheel_id)
        limit_low(objects, LOW_BUDGET["wheel"])
        return vk.collect(objects)
    finally:
        vk.set_lod("hi")


def in_style(style, work):
    vk.set_style(style)
    try:
        return work()
    finally:
        vk.set_style("real")


def kart_sockets(sp):
    """The sockets of a kart body, in the editor's axes."""
    sockets = [{"id": "ground", "p": [0, 0, 0], "n": [0, -1, 0]}]
    for name, (x, y, scale), side in (("wheel_fl", sp.front, 1), ("wheel_fr", sp.front, -1), ("wheel_rl", sp.rear, 1), ("wheel_rr", sp.rear, -1)):
        sockets.append({"id": name, "p": rounded3((side * (x - vk.W * scale / 2), vk.R * scale, y)), "n": [side, 0, 0]})
    sockets.append({"id": "spoiler", "p": rounded3((0, sp.spoiler.z, sp.spoiler.y)), "n": [0, 1, 0]})
    sockets.append({"id": "driver", "p": rounded3((0, sp.hip.z, sp.hip.y)), "n": [0, 1, 0]})
    tilt = radians(40)
    sockets.append({"id": "steering", "p": rounded3((0, sp.hip.z + 0.24, sp.hip.y + 0.42)), "n": [0, round(sin(tilt), 4), round(-cos(tilt), 4)]})
    return sockets


def part_details(name):
    """How a kart part or a sign is colored and attached."""
    base = {"id": "base", "p": [0, 0, 0], "n": [0, -1, 0]}
    if "spoiler" in name:
        return {"sockets": [base]}
    if name.endswith("kart_driver"):
        return {"sockets": [base], "plain": True, "tint": ["suit"]}
    if "helmet" in name:
        return {"sockets": [{"id": "ground", "p": [0, 0, 0], "n": [0, -1, 0]}], "tint": ["helmet"], "stripe": True}
    if name.endswith("kart_steering"):
        return {"sockets": [{"id": "base", "p": [0, 0, 0], "n": [0, 0, 1]}], "plain": True, "tint": ["accent", "paint"]}
    return {"sockets": [base], "plain": True, "tint": ["paint"]}


def vehicle_meta(group, axles, half, extra):
    """Axles and sockets of a vehicle body, in the editor's axes."""
    meta = {"axles": [], "sockets": []}
    if group in ("kart", "part"):
        return meta
    wheel_half = lambda radius: vk.W / 2 * radius / vk.R
    for axle in axles:
        entry = {"z": round(float(axle[0]), 4), "radius": float(axle[1]), "x": round(float(half - wheel_half(axle[1]) - 0.015), 4)}
        if len(axle) > 3 and axle[3]:
            entry["dual"] = True
        meta["axles"].append(entry)
    if "hitch" in extra:
        y, z = extra["hitch"]
        meta["sockets"] = [{"id": "hitch", "p": rounded3((0, z, y)), "n": [0, 1, 0]}]
    if "king" in extra:
        meta["king"] = {"id": "king", "p": rounded3((0, extra["king"], 0)), "n": [0, -1, 0]}
    if "roof" in extra:
        y, z = extra["roof"]
        meta["sockets"] = [{"id": "roof", "p": rounded3((0, z, y)), "n": [0, 1, 0]}]
    return meta


# Built models are kept here, so an export can rebuild only the ones that changed (--only).
CACHE = os.environ.get("VEH_CACHE") or os.path.join(tempfile.gettempdir(), "asm_vehicle_cache")


def save_cache(key, variants, meta):
    os.makedirs(CACHE, exist_ok=True)
    arrays = {}
    for variant, zones in variants.items():
        for zone, (p, n) in zones.items():
            arrays[f"{variant}|{zone}|p"] = p.astype(np.float32)
            arrays[f"{variant}|{zone}|n"] = n.astype(np.float32)
    np.savez(os.path.join(CACHE, key + ".npz"), **arrays)
    with open(os.path.join(CACHE, key + ".json"), "w", encoding="utf-8") as handle:
        json.dump(meta, handle, ensure_ascii=False)


def load_cache(key):
    path = os.path.join(CACHE, key + ".npz")
    if not os.path.exists(path):
        return None
    data = np.load(path)
    variants = {}
    for entry in data.files:
        variant, zone, kind = entry.split("|")
        variants.setdefault(variant, {}).setdefault(zone, [None, None])[0 if kind == "p" else 1] = data[entry].astype(np.float64)
    with open(os.path.join(CACHE, key + ".json"), encoding="utf-8") as handle:
        meta = json.load(handle)
    return {variant: {zone: tuple(pair) for zone, pair in zones.items()} for variant, zones in variants.items()}, meta


def wanted(key, only):
    if only is None:
        return True
    return any(key == item or (item.endswith("*") and key.startswith(item[:-1])) for item in only)


def wheel_variants(wheel_id):
    def full():
        clear()
        return vk.collect(wheel(wheel_id))

    variants = {
        "hi": wheel_to_editor(full()),
        "lp": wheel_to_editor(wheel_low(wheel_id)),
        "vx": wheel_to_editor(vk.voxelize(wheel_low(wheel_id, "vx"), VOXEL_SIZE["wheel"])),
        "ar": wheel_to_editor(in_style("arcade", full)),
    }
    meta = {"asset": {"width": round(vk.wheel_width(wheel_id), 4)}, "ar": {"width": vk.W}}
    return variants, meta


def model_variants(name, models):
    group, label, wheel_id, _ = models[name]
    zones, axles, half, extra = build(name, models)
    asset_id = name.replace("trator_", "").replace("kart_", "", 1) if group != "part" else name.replace("part_", "")
    asset = {"id": asset_id, "name": label, "group": group, "wheel": wheel_id if group != "kart" else None}
    asset.update(vehicle_meta(group, axles, half, extra))
    if group == "kart":
        sp = designs.GAME_SPECS[asset_id][0] if asset_id in designs.GAME_SPECS else designs.KARTS[asset_id][1]
        asset["sockets"] = kart_sockets(sp)
        asset["kart"] = {"front": sp.front[2], "rear": sp.rear[2]}
    if group == "part":
        asset.update(part_details(name))
    variants = {
        "hi": to_editor(zones),
        "lp": to_editor(low_poly(name, models)),
        "vx": to_editor(vk.voxelize(low_poly(name, models, "vx"), VOXEL_SIZE[group])),
    }
    meta = {"asset": asset}
    print(f"MODEL {asset_id}: {vk.triangles(zones)} lp {vk.triangles(variants['lp'])}")
    # Karts and their parts already are the Arcade style.
    if group not in ("kart", "part"):
        zones_ar, axles_ar, half_ar, extra_ar = in_style("arcade", lambda: build(name, models))
        variants["ar"] = to_editor(zones_ar)
        meta["ar"] = vehicle_meta(group, axles_ar, half_ar, extra_ar)
        print(f"ARCADE {asset_id}: {vk.triangles(zones_ar)}")
    return variants, meta


def export(only=None):
    models = all_models()
    pack = Pack()
    jobs = [("wheel_" + wheel_id, lambda wheel_id=wheel_id: wheel_variants(wheel_id), {"id": wheel_id, "name": label, "group": "wheel", "axles": [], "sockets": []}) for wheel_id, label in WHEEL_NAMES.items()]
    jobs += [(name, lambda name=name: model_variants(name, models), None) for name in models]
    for key, work, base in jobs:
        cached = None if wanted(key, only) else load_cache(key)
        if cached is None:
            variants, meta = work()
            save_cache(key, variants, meta)
        else:
            variants, meta = cached
        asset = dict(base or {})
        asset.update(meta["asset"])
        asset.update(pack.encode(key, variants["hi"]))
        asset["lp"] = pack.encode(key, variants["lp"])
        asset["vx"] = pack.encode(key, variants["vx"])
        if "ar" in variants:
            asset["ar"] = {**pack.encode(key, variants["ar"]), **meta.get("ar", {})}
        pack.assets.append(asset)
    pack.write()


def main():
    names, options = parse()
    if "--export" in names:
        only = options.get("only")
        export(only.split(",") if only else None)
        return
    lod = options.get("lod", "hi")
    vk.set_style(options.get("style", "real"))
    preview = options.get("preview")
    models = all_models()
    chosen = []
    for name in names or list(models):
        if name.endswith("*"):
            chosen += [m for m in models if m.startswith(name[:-1])]
        else:
            chosen.append(name)
    paints = {"paint": "#c8202e", "trim": "#f0f0ea", "accent": "#ffc400", "rim": "#b8bcc4", "band": "#3a3d44"}
    results = []
    for name in chosen:
        group, _, wheel_id, _ = models[name]
        zones, axles, half, _ = build(name, models)
        wheel_zones = None
        if wheel_id and group != "kart":
            clear()
            wheel_zones = vk.collect(wheel(wheel_id))
        if lod != "hi":
            zones = low_poly(name, models, lod)
            wheel_zones = wheel_low(wheel_id, lod) if wheel_zones is not None else None
            if lod == "vx":
                zones = vk.voxelize(zones, VOXEL_SIZE[group])
                wheel_zones = vk.voxelize(wheel_zones, VOXEL_SIZE["wheel"]) if wheel_zones is not None else None
        count = vk.triangles(zones) + (vk.triangles(wheel_zones) * 2 * len(axles) if wheel_zones is not None else 0)
        print(f"MODEL {name}: {vk.triangles(zones)} body, {count} total, zones {len(zones)}")
        results.append(vk.merged(zones, fitted(wheel_zones, axles, half, vk.wheel_width(wheel_id))) if wheel_zones is not None else zones)
    if preview:
        clear()
        vk.setup_studio()
        length = max(np.ptp(np.concatenate([p for p, _ in r.values()])[:, 1]) for r in results)
        columns = 3 if len(results) > 2 else max(1, len(results))
        rows = (len(results) + columns - 1) // columns
        spacing_x, spacing_y = max(3.5, length * 0.42), max(6.4, length * 1.2)
        for index, zones in enumerate(results):
            vk.show(zones, np.array([(index % columns - (columns - 1) / 2) * spacing_x, -(index // columns - (rows - 1) / 2) * spacing_y, 0.0]), paints)
        distance = max(spacing_x * columns, spacing_y * rows * 0.75) * 2.35
        if len(results) == 1:
            distance = max(4.6, length * 2.3)
        size = (1800, 1100 if rows < 3 else 1600)
        vk.render(preview, (0.75, 1.0, 0.62), (0, 0, 0.6), distance, size=size)
        vk.render(preview.replace(".png", "_back.png"), (-0.75, -1.0, 0.62), (0, 0, 0.6), distance, size=size)
        vk.render(preview.replace(".png", "_side.png"), (1.0, 0.0, 0.08), (0, 0, 0.6), distance, size=size)


if __name__ == "__main__":
    main()
