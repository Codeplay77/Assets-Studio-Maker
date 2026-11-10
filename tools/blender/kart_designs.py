"""
Karts and kart parts that the game does not have, for Assets Studio Maker (Blender 5.1).

They use the modeling kit of the game, so they share its look. Blender coordinates: Z up, +Y front.
Colors follow the kit: paint_primary is the main paint, paint_secondary the trim, paint_accent the details.
"""

import os
import sys
from math import atan2, cos, degrees, pi, radians, sin

from mathutils import Matrix, Vector as V

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_karts as kit  # noqa: E402
import vehicle_kit as vk  # noqa: E402

ORIGIN = (0.0, 0.0, 0.0)


def spec(front, rear, hip, spoiler):
    """Front and rear are (x, y, wheel scale); hip and spoiler are (y, z)."""
    return kit.KartSpec(front=front, rear=rear, hip=(0.0, *hip), spoiler=(0.0, *spoiler), exhaust_l=ORIGIN, exhaust_r=ORIGIN)


def hull(name, sections, **options):
    """A smooth body through (y, half width, top, bottom, squareness) sections."""
    keys = [dict(pos=y, w=half, c2=(top + bottom) / 2, h=(top - bottom) / 2, e=square) for y, half, top, bottom, square in sections]
    options.setdefault("n", 44)
    options.setdefault("sub", 4)
    return kit.loft(name, keys, **options)


def racing_stripes(main="paint_primary", s_range=(0.0, 1.0)):
    return kit.stripe_fn(main, [(0.215, 0.285, "paint_secondary"), (0.2, 0.215, "paint_accent"), (0.285, 0.3, "paint_accent")], s_range)


def chassis(sp, rail="chrome"):
    """What every kart has: rails, floor, axles, pedals, seat and steering column."""
    fy, ry = sp.front[1], sp.rear[1]
    for s in (-1, 1):
        kit.tube("rail", [(s * 0.15, fy + 0.27, 0.115), (s * 0.24, fy + 0.11, 0.085), (s * 0.29, 0.4, 0.07), (s * 0.3, -0.3, 0.07), (s * 0.33, ry + 0.08, 0.09), (s * 0.3, ry - 0.19, 0.13)], 0.016, mat=rail, fillet=0.09)
        kit.tube("seat_strut", [(s * 0.29, sp.hip.y + 0.2, 0.07), (s * 0.2, sp.hip.y - 0.18, sp.hip.z + 0.14)], 0.011, mat=rail, fillet=0)
    for y in (0.25, -0.2):
        kit.tube("cross", [(-0.29, y, 0.07), (0.29, y, 0.07)], 0.015, mat=rail, fillet=0)
    kit.tube("cross_rear", [(-0.3, ry - 0.19, 0.13), (0.3, ry - 0.19, 0.13)], 0.015, mat=rail, fillet=0)
    kit.rbox("floor", (0.5, 1.1, 0.012), (0, 0.1, 0.06), mat="carbon", bevel=0.004, segs=2)
    kit.build_front_uprights(sp)
    kit.build_rear_axle(sp)
    kit.build_pedals(sp)
    kit.build_seat(sp)
    kit.build_column(sp)


def finned_engine(y):
    tilt = -degrees(atan2(0.35, 1))
    axis = V((0, -0.35, 1)).normalized()
    base = V((0, y - 0.02, 0.25))
    kit.rbox("crankcase", (0.22, 0.17, 0.15), (0, y, 0.175), mat="metal_dark", bevel=0.03, segs=3)
    kit.rbox("case_cover", (0.03, 0.12, 0.1), (0.12, y, 0.17), mat="chrome", bevel=0.012)
    kit.cyl("barrel", 0.05, 0.22, base + axis * 0.1, axis, mat="metal_dark", segs=24)
    for k in range(7):
        kit.rbox("fin", (0.17, 0.15, 0.008), base + axis * (0.02 + k * 0.026), mat="chrome" if k % 2 == 0 else "metal_dark", bevel=0.012, segs=2, rot=(tilt, 0, 0))
    head = base + axis * 0.205
    kit.rbox("cyl_head", (0.13, 0.12, 0.05), head, mat="paint_accent", bevel=0.018, rot=(tilt, 0, 0))
    kit.cyl("spark_plug", 0.012, 0.05, head + axis * 0.04, axis, mat="chrome", segs=12)
    kit.cyl("airbox", 0.065, 0.13, (0.24, y + 0.02, 0.3), (1, 0, 0), mat="paint_secondary", segs=32, bevel=0.015, cap_mat="carbon")
    kit.cyl("airbox_band", 0.067, 0.02, (0.24, y + 0.02, 0.3), (1, 0, 0), mat="chrome", segs=32, bevel=0.003)


def twin_exhaust(y, top, end_y, end_z, spread=0.16):
    for s in (-1, 1):
        kit.exhaust_pipe([(s * 0.03, y - 0.08, top), (s * 0.11, y - 0.14, top + 0.02), (s * spread, end_y + 0.12, end_z - 0.02), (s * (spread + 0.005), end_y, end_z)], 0.021, tip_len=0.075)


def headlamp(x, y, z, radius=0.034, tilt=-35.0, yaw=0.0):
    kit.sphere("headlight", radius, (x, y, z), scale=(1.3, 0.55, 0.7), mat="emissive_light", rot=(tilt, 0, yaw))
    kit.torus("bezel", radius * 0.97, radius * 0.18, kit.mtx_of((x, y + 0.003, z), (90 + tilt, 0, yaw), scale=(1.3, 0.72, 1.0)), mat="chrome", n_major=24, n_minor=6)


def tail_lamp(x, y, z, width=0.13):
    kit.rbox("tail_light", (width, 0.02, 0.032), (x, y, z), mat="emissive_tail", bevel=0.008)
    kit.rbox("tail_bezel", (width + 0.02, 0.016, 0.046), (x, y + 0.006, z), mat="metal_dark", bevel=0.01)


def bumper(y, z, width, depth, height, mat="paint_secondary"):
    half = width / 2
    hull("bumper", [(y + depth, half * 0.8, z + height * 0.5, z - height * 0.5, 3.4), (y + depth * 0.7, half, z + height, z - height, 3.4), (y - depth * 0.7, half, z + height, z - height, 3.4), (y - depth, half * 0.8, z + height * 0.5, z - height * 0.5, 3.4)], n=32, sub=2, mat=mat)


def wheel_fenders(sp, width=0.3, clearance=0.06, mat="paint_secondary", trim="paint_accent", a0=24, a1=156):
    for x, y, scale in (sp.front, sp.rear):
        r = kit.WHEEL_NOMINAL_RADIUS * scale
        for s in (-1, 1):
            kit.fender("fender", (s * x, y, r), r + clearance, a0, a1, width, 0.028, mat=mat, trim_mat=trim, n=24)


BOLHA = spec((0.58, 0.62, 0.95), (0.58, -0.6, 1.05), (-0.18, 0.3), (-0.84, 0.56))


def build_bolha():
    """A round, friendly kart with big eyes and a smile."""
    sp = BOLHA
    chassis(sp)
    hull("nose", [(1.08, 0.1, 0.25, 0.13, 2.0), (0.98, 0.26, 0.36, 0.1, 2.1), (0.78, 0.34, 0.46, 0.08, 2.1), (0.55, 0.34, 0.5, 0.08, 2.1), (0.38, 0.28, 0.46, 0.1, 2.2)], mat_fn=racing_stripes(), n=56, sub=6)
    hull("rear", [(-0.14, 0.36, 0.3, 0.08, 2.1), (-0.32, 0.46, 0.4, 0.08, 2.1), (-0.62, 0.46, 0.5, 0.08, 2.1), (-0.9, 0.36, 0.5, 0.1, 2.1), (-1.04, 0.08, 0.32, 0.18, 2.0)], mat_fn=racing_stripes(), n=56, sub=6)
    wheel_fenders(sp, width=0.3)
    for s in (-1, 1):
        kit.sphere("eye", 0.085, (s * 0.2, 0.96, 0.42), mat="z_white", segs=28, rings=18)
        kit.sphere("pupil", 0.045, (s * 0.2, 1.03, 0.43), mat="carbon", segs=20, rings=14)
        kit.sphere("shine", 0.014, (s * 0.21, 1.068, 0.455), mat="z_white", segs=10, rings=8)
        kit.torus("eye_ring", 0.088, 0.008, kit.mtx_of((s * 0.2, 0.975, 0.42), (90, 0, 0)), mat="chrome", n_major=32, n_minor=6)
        tail_lamp(s * 0.18, -1.0, 0.34, 0.1)
        kit.tube("skirt", [(s * 0.34, 0.34, 0.1), (s * 0.4, 0.1, 0.09), (s * 0.4, -0.12, 0.09), (s * 0.36, -0.3, 0.1)], 0.02, mat="chrome", fillet=0.1, n=10)
    smile = [(0.12 * cos(radians(a)), 1.07 - 0.04 * abs(cos(radians(a))), 0.205 + 0.09 * sin(radians(a))) for a in range(200, 341, 14)]
    kit.tube("smile", smile, 0.012, mat="carbon", smooth=2, n=8)
    kit.tube("bumper", [(-0.34, 1.0, 0.17), (-0.26, 1.12, 0.15), (0.26, 1.12, 0.15), (0.34, 1.0, 0.17)], 0.024, mat="chrome", fillet=0.12, n=12)
    kit.tube("bumper_rear", [(-0.36, -1.0, 0.2), (-0.26, -1.1, 0.19), (0.26, -1.1, 0.19), (0.36, -1.0, 0.2)], 0.024, mat="chrome", fillet=0.12, n=12)
    twin_exhaust(-0.72, 0.2, -0.98, 0.2, 0.2)


BUGGY = spec((0.6, 0.7, 0.95), (0.62, -0.62, 1.12), (-0.18, 0.32), (-0.86, 0.3))


def build_buggy():
    """A desert buggy: roll cage, short nose, engine in the open and a surfboard on top."""
    sp = BUGGY
    chassis(sp)
    hull("nose", [(0.96, 0.18, 0.34, 0.18, 2.8), (0.7, 0.26, 0.4, 0.16, 3.0), (0.42, 0.24, 0.42, 0.16, 3.0)], mat_fn=racing_stripes(), n=40)
    kit.rbox("skid_plate", (0.5, 0.6, 0.02), (0, 0.72, 0.13), mat="metal_dark", bevel=0.008, segs=1, rot=(8, 0, 0))
    for s in (-1, 1):
        kit.tube("cage_side", [(s * 0.34, 0.44, 0.1), (s * 0.36, 0.26, 0.7), (s * 0.3, 0.02, 1.22), (s * 0.26, -0.4, 1.26), (s * 0.34, -0.7, 0.7), (s * 0.33, -0.76, 0.14)], 0.022, fillet=0.12, n=12)
        kit.tube("cage_brace", [(s * 0.36, 0.26, 0.7), (s * 0.34, -0.7, 0.7)], 0.016, fillet=0, n=10)
        kit.tube("cage_rear", [(s * 0.3, -0.72, 0.68), (s * 0.08, -1.02, 0.3)], 0.015, fillet=0, n=8)
        headlamp(s * 0.15, 0.96, 0.3, 0.04, tilt=-20)
        tail_lamp(s * 0.2, -1.03, 0.3, 0.12)
    for points in (((-0.3, 0.02, 1.22), (0.3, 0.02, 1.22)), ((-0.26, -0.4, 1.26), (0.26, -0.4, 1.26)), ((-0.36, 0.26, 0.7), (0.36, 0.26, 0.7))):
        kit.tube("cage_cross", points, 0.02, fillet=0, n=10)
    kit.rbox("lamp_bar", (0.56, 0.05, 0.05), (0, 0.04, 1.27), mat="metal_dark", bevel=0.012, segs=1)
    for x in (-0.2, -0.07, 0.07, 0.2):
        kit.cyl("roof_lamp", 0.042, 0.04, (x, 0.08, 1.27), (0, 1, 0), mat="metal_dark", segs=16, bevel=0.006, cap_mat="emissive_light")
    # A surfboard strapped to the bars.
    board = [dict(pos=0.56, c2=1.32, w=0.03, h=0.012), dict(pos=0.3, w=0.14, h=0.018), dict(pos=-0.3, w=0.17, h=0.02), dict(pos=-0.76, w=0.1, h=0.018), dict(pos=-0.86, w=0.02, h=0.008)]
    kit.loft("surfboard", board, n=20, sub=5, mat_fn=kit.stripe_fn("paint_accent", [(0.2, 0.3, "paint_secondary")]))
    for y in (0.0, -0.42):
        kit.tube("strap", [(-0.18, y, 1.31), (-0.18, y, 1.345), (0.18, y, 1.345), (0.18, y, 1.31)], 0.006, mat="carbon", fillet=0.01, n=5)
    finned_engine(-0.56)
    twin_exhaust(-0.64, 0.34, -0.96, 0.46, 0.18)
    bumper(0.98, 0.16, 0.74, 0.05, 0.06)
    bumper(-1.0, 0.16, 0.74, 0.05, 0.06)


NEVASCA = spec((0.58, 0.64, 0.9), (0.6, -0.62, 1.08), (-0.2, 0.32), (-0.8, 0.6))


def plow(y):
    """A curved snow plow across the front."""
    rings = []
    count = 16
    for i in range(count + 1):
        t = i / count
        x = lerp(-0.72, 0.72, t)
        back = 0.3 * (x / 0.72) ** 2
        ring = []
        for a, z in ((0.05, 0.05), (0.02, 0.15), (-0.01, 0.25), (0.05, 0.36), (0.02, 0.37), (-0.04, 0.25), (-0.01, 0.15), (0.03, 0.05)):
            ring.append(V((x, y - back + a, z)))
        rings.append(ring)
    kit.grid_object("plow", rings, closed_u=True, cap0=True, cap1=True, mat="paint_accent", sharp_angle=44.0)
    kit.rbox("plow_edge", (1.42, 0.05, 0.03), (0, y + 0.03, 0.05), mat="chrome", bevel=0.008, segs=1)
    for s in (-1, 1):
        kit.tube("plow_arm", [(s * 0.3, 0.92, 0.12), (s * 0.5, y - 0.1, 0.17)], 0.015, fillet=0, n=8)
        kit.tube("plow_ram", [(s * 0.14, 0.92, 0.28), (s * 0.3, y - 0.04, 0.24)], 0.012, fillet=0, n=8)


def lerp(a, b, t):
    return a + (b - a) * t


def build_nevasca():
    """A kart for snow: tall nose, windshield and a plow, with snow on the fenders."""
    sp = NEVASCA
    chassis(sp)
    nose = [(1.08, 0.18, 0.27, 0.14, 2.6), (0.9, 0.3, 0.4, 0.13, 2.8), (0.62, 0.34, 0.5, 0.12, 2.8), (0.36, 0.3, 0.56, 0.14, 2.8)]
    hull("nose", nose, mat_fn=racing_stripes(), n=48, sub=5)
    wheel_fenders(sp, width=0.31, clearance=0.07, a0=30, a1=150)
    for x, y, scale in (sp.front, sp.rear):
        r = kit.WHEEL_NOMINAL_RADIUS * scale
        for s in (-1, 1):
            kit.fender("snow", (s * x, y, r), r + 0.092, 58, 122, 0.27, 0.05, mat="z_white", n=14)
    glass = [dict(pos=0.72, c2=0.52, w=0.2, h=0.006), dict(pos=0.56, c2=0.62, w=0.23, h=0.006), dict(pos=0.5, c2=0.72, w=0.21, h=0.006)]
    kit.loft("windshield", glass, n=10, sub=3, mat="z_glass", sharp_angle=60.0)
    kit.tube("windshield_frame", [(-0.22, 0.72, 0.49), (-0.21, 0.5, 0.74), (0.21, 0.5, 0.74), (0.22, 0.72, 0.49)], 0.012, fillet=0.04, n=8)
    for s in (-1, 1):
        headlamp(s * 0.2, 1.05, 0.34, 0.042, tilt=-20)
        tail_lamp(s * 0.32, -1.0, 0.34, 0.12)
        kit.tube("rack", [(s * 0.36, 0.18, 0.1), (s * 0.44, 0.0, 0.26), (s * 0.44, -0.36, 0.26), (s * 0.38, -0.5, 0.1)], 0.012, fillet=0.06, n=8)
    kit.rbox("fuel_can", (0.14, 0.26, 0.2), (0.0, -0.98, 0.34), mat="paint_secondary", bevel=0.02, segs=2)
    plow(1.3)
    finned_engine(-0.56)
    twin_exhaust(-0.64, 0.34, -0.98, 0.5, 0.2)


FOGUETE = spec((0.56, 0.66, 0.84), (0.58, -0.62, 1.0), (-0.24, 0.3), (-0.94, 0.62))


def build_foguete():
    """A rocket on wheels: nose cone, fins, boosters on the sides and a lit nozzle."""
    sp = FOGUETE
    chassis(sp)
    hull("nose", [(1.3, 0.008, 0.292, 0.268, 2.0), (1.26, 0.03, 0.31, 0.25, 2.0), (1.14, 0.09, 0.36, 0.18, 2.0), (0.9, 0.19, 0.44, 0.14, 2.0), (0.6, 0.25, 0.5, 0.1, 2.0), (0.3, 0.24, 0.5, 0.1, 2.0)], n=48, sub=5, mat_fn=lambda s, u: "paint_secondary" if s < 0.26 else "paint_primary")
    hull("body", [(-0.34, 0.2, 0.5, 0.14, 2.0), (-0.42, 0.25, 0.56, 0.1, 2.0), (-0.84, 0.25, 0.56, 0.1, 2.0), (-1.02, 0.18, 0.52, 0.16, 2.0)], n=48, sub=4, mat="paint_primary")
    for y, half in ((0.96, 0.178), (-0.5, 0.262), (-0.78, 0.262)):
        kit.torus("band", half, 0.012, kit.mtx_of((0, y, 0.33), (90, 0, 0)), mat="chrome", n_major=44, n_minor=6, rx=half)
    kit.torus("collar", 0.262, 0.03, kit.mtx_of((0, -0.64, 0.33), (90, 0, 0)), mat="paint_secondary", n_major=44, n_minor=6, rx=0.262)
    for s in (-1, 1):
        kit.sphere("porthole", 0.05, (s * 0.235, 0.62, 0.36), scale=(0.5, 1.0, 1.0), mat="z_glass", segs=18, rings=12)
        kit.torus("porthole_ring", 0.052, 0.009, kit.mtx_of((s * 0.243, 0.62, 0.36), (0, 90, 0)), mat="chrome", n_major=24, n_minor=6)
        headlamp(s * 0.11, 1.07, 0.36, 0.03, tilt=-14, yaw=s * -18)
        kit.loft("booster", [dict(pos=0.14, c1=s * 0.36, c2=0.2, w=0.012, h=0.012), dict(pos=0.06, w=0.05, h=0.05), dict(pos=-0.02, w=0.075, h=0.075), dict(pos=-0.56, w=0.075, h=0.075), dict(pos=-0.6, w=0.056, h=0.056)], n=20, sub=3, mat_fn=lambda a, u: "chrome" if a < 0.2 else "paint_accent", sharp_angle=44.0)
        kit.lathe("booster_flame", [(0.0, 0.05), (-0.08, 0.04), (-0.16, 0.012), (-0.17, 0.0005)], 16, mat="z_amber", sharp_angle=70.0, mtx=Matrix.Translation((s * 0.36, -0.6, 0.2)) @ Matrix.Rotation(pi / 2, 4, "Z"))
    for angle in (0, 125, -125):
        rotation = kit.mtx_of((0, -0.86, 0.33), (0, angle, 0))
        kit.slab("fin", kit.round_poly([(0.2, 0.0), (-0.16, 0.0), (-0.32, 0.27), (-0.08, 0.27)], 0.02), 0.03, rotation @ V((0, 0, 0.24)), rotation.to_3x3() @ V((0, 1, 0)), rotation.to_3x3() @ V((0, 0, 1)), mat="paint_accent", edge_mat="paint_secondary", bevel=0.006)
    nozzle = Matrix.Translation((0, -1.0, 0.33)) @ Matrix.Rotation(pi / 2, 4, "Z")
    kit.lathe("nozzle", [(0.02, 0.1), (-0.04, 0.12), (-0.18, 0.17), (-0.19, 0.16), (-0.05, 0.1), (-0.04, 0.0005)], 32, mat="metal_dark", sharp_angle=40.0, mtx=nozzle)
    kit.lathe("flame", [(-0.1, 0.12), (-0.26, 0.11), (-0.4, 0.05), (-0.46, 0.0005)], 22, mat="z_amber", sharp_angle=70.0, mtx=nozzle)
    kit.lathe("flame_core", [(-0.1, 0.075), (-0.24, 0.07), (-0.34, 0.02), (-0.37, 0.0005)], 18, mat="z_light", sharp_angle=70.0, mtx=nozzle)


TUBARAO = spec((0.58, 0.64, 0.9), (0.58, -0.62, 1.04), (-0.22, 0.28), (-0.86, 0.54))


def build_tubarao():
    """A shark: pointed snout, open mouth with teeth, gills and fins."""
    sp = TUBARAO
    chassis(sp)
    snout = hull("snout", [(1.22, 0.05, 0.2, 0.13, 2.0), (1.1, 0.18, 0.28, 0.1, 2.2), (0.88, 0.3, 0.38, 0.08, 2.3), (0.6, 0.34, 0.47, 0.08, 2.3), (0.36, 0.3, 0.5, 0.1, 2.3)], n=52, sub=6, mat_fn=lambda s, u: "paint_secondary" if 0.62 < u < 0.88 else "paint_primary")
    surface = vk.Surface(snout)

    def around_snout(angle, z):
        # Rays that close in on a point inside the snout, so the mouth wraps around it.
        a = radians(angle)
        aim = V((sin(a), cos(a), 0.0))
        return V((0, 0.82, z)) + aim * 6.0, -aim

    top, bottom = 0.235, 0.165
    corner = 72.0
    columns = [-corner + 2 * corner * i / 36 for i in range(37)]
    rows = [(top + 0.008, -0.006, "carbon"), (top, 0.012, "carbon"), ((top + bottom) / 2, 0.016, "carbon"), (bottom, 0.012, "carbon"), (bottom - 0.008, -0.006)]
    vk.drape("mouth", surface, columns, rows, around_snout, fade=lambda a: vk.smoothstep(0, 10, corner - abs(a)))
    hull("back", [(-0.26, 0.34, 0.3, 0.08, 2.3), (-0.5, 0.38, 0.42, 0.08, 2.3), (-0.82, 0.3, 0.46, 0.1, 2.3), (-1.0, 0.1, 0.4, 0.18, 2.2)], n=48, sub=5, mat_fn=lambda s, u: "paint_secondary" if 0.62 < u < 0.88 else "paint_primary")
    for s in (-1, 1):
        for angle in (12, 26, 40, 54):
            origin, direction = around_snout(s * angle, top)
            found = surface.hit(origin, direction)
            if found:
                x, y = found[0].x, found[0].y
                kit.cyl("tooth_top", 0.019, 0.05, (x, y, top + 0.002), (0, 0, -1), mat="z_white", segs=5, r2=0.002)
                kit.cyl("tooth_bottom", 0.015, 0.038, (x * 0.97, y - 0.005, bottom), (0, 0, 1), mat="z_white", segs=5, r2=0.002)
        kit.sphere("eye", 0.042, (s * 0.2, 1.0, 0.36), mat="z_white", segs=20, rings=14)
        kit.sphere("pupil", 0.024, (s * 0.215, 1.03, 0.365), mat="carbon", segs=14, rings=10)
        for y in (0.46, 0.53, 0.6):
            kit.rbox("gill", (0.012, 0.02, 0.13), (s * 0.336, y, 0.3), mat="carbon", bevel=0.004, segs=1, rot=(10, 0, s * 8))
        tail_lamp(s * 0.22, -1.0, 0.32, 0.12)
        plate = kit.round_poly([(0.1, 0.0), (-0.24, 0.0), (-0.04, -0.22)], 0.018)
        matrix = kit.mtx_of((s * 0.36, -0.28, 0.2), (0, 0, s * -30))
        kit.slab("pectoral", plate, 0.03, matrix @ V((0, 0, 0)), V((s * 0.5, -0.866, 0)), V((s * 0.24, 0.0, 0.97)), mat="paint_primary", edge_mat="paint_accent", bevel=0.006)
    kit.slab("dorsal", kit.round_poly([(0.16, 0.0), (-0.26, 0.0), (-0.34, 0.42), (-0.12, 0.42)], 0.02), 0.05, (0, -0.74, 0.44), (0, 1, 0), (0, 0, 1), mat="paint_primary", edge_mat="paint_accent", bevel=0.01)
    kit.exhaust_pipe([(-0.08, -0.72, 0.24), (-0.18, -0.8, 0.22), (-0.24, -0.96, 0.24)], 0.021, tip_len=0.075)
    kit.exhaust_pipe([(0.08, -0.72, 0.24), (0.18, -0.8, 0.22), (0.24, -0.96, 0.24)], 0.021, tip_len=0.075)


DRAGSTER = spec((0.5, 1.3, 0.62), (0.62, -0.6, 1.3), (-0.05, 0.28), (-0.92, 0.66))


def build_dragster():
    """A long, thin dragster: small front wheels, a huge engine and headers that stand up."""
    sp = DRAGSTER
    chassis(sp)
    hull("nose", [(1.6, 0.04, 0.17, 0.08, 2.2), (1.2, 0.09, 0.24, 0.08, 2.6), (0.7, 0.14, 0.32, 0.09, 2.6), (0.3, 0.2, 0.4, 0.1, 2.6)], mat_fn=racing_stripes(), n=40, sub=5)
    kit.sphere("nose_tip", 0.038, (0, 1.615, 0.122), scale=(1.0, 1.8, 0.75), mat="chrome", segs=18, rings=12)
    for s in (-1, 1):
        kit.tube("front_rail", [(s * 0.18, 0.3, 0.1), (s * 0.09, 1.3, 0.1)], 0.014, fillet=0, n=8)
        kit.tube("wing_strut", [(s * 0.08, -0.78, 0.2), (s * 0.08, -0.92, 0.66)], 0.018, mat="metal_dark", fillet=0, n=8)
    y = -0.56
    kit.rbox("block", (0.34, 0.42, 0.26), (0, y, 0.34), mat="metal_dark", bevel=0.04, segs=2)
    kit.rbox("valve_covers", (0.3, 0.36, 0.12), (0, y, 0.54), mat="chrome", bevel=0.03, segs=2)
    kit.rbox("blower", (0.2, 0.28, 0.18), (0, y, 0.68), mat="metal_dark", bevel=0.03, segs=2)
    for k in range(6):
        kit.rbox("blower_rib", (0.21, 0.02, 0.17), (0, y - 0.1 + k * 0.04, 0.68), mat="chrome", bevel=0.004, segs=1)
    kit.rbox("scoop", (0.26, 0.2, 0.05), (0, y, 0.8), mat="chrome", bevel=0.018, segs=2)
    kit.rbox("scoop_top", (0.22, 0.16, 0.03), (0, y, 0.76), mat="paint_accent", bevel=0.01, segs=1)
    for s in (-1, 1):
        for i in range(4):
            py = -0.4 - i * 0.1
            kit.tube("header", [(s * 0.17, py, 0.4), (s * 0.3, py, 0.48), (s * 0.4, py, 0.62)], 0.024, fillet=0.05, n=10)
            kit.cyl("header_tip", 0.034, 0.05, (s * 0.41, py, 0.64), (s * 0.7, 0, 0.7), mat="metal_dark", segs=12)
        kit.rbox("fuel_cell", (0.12, 0.4, 0.14), (s * 0.3, 0.05, 0.14), mat="paint_secondary", bevel=0.03, segs=2)
    kit.rbox("chute", (0.2, 0.2, 0.2), (0, -1.02, 0.36), mat="paint_accent", bevel=0.05, segs=2)
    kit.tube("chute_mount", [(0, -0.92, 0.36), (0, -1.02, 0.36)], 0.02, mat="metal_dark", fillet=0, n=8)
    bumper(-1.02, 0.2, 0.6, 0.04, 0.05)
    for s in (-1, 1):
        tail_lamp(s * 0.2, -1.04, 0.28, 0.1)


# --- spoilers that the game does not have -----------------------------------------------------


def build_spoiler_arc():
    """A hoop over the engine with a small wing on top."""
    kit.rbox("mount", (0.26, 0.07, 0.02), (0, 0, 0.01), mat="metal_dark", bevel=0.005)
    path = [(0.42 * cos(radians(a)), 0.0, 0.02 + 0.34 * sin(radians(a))) for a in range(0, 181, 12)]
    kit.tube("arch", path, 0.03, mat="paint_primary", smooth=2, n=14)
    for s in (-1, 1):
        kit.rbox("foot", (0.09, 0.09, 0.02), (s * 0.42, 0, 0.012), mat="metal_dark", bevel=0.005)
        kit.tube("stay", [(s * 0.1, 0.0, 0.02), (s * 0.28, 0.0, 0.25)], 0.012, mat="metal_dark", fillet=0, n=8)
    kit.wing_element("wing", -0.22, 0.22, 0.17, 0.12, 0.05, 10, 0.07, 0.385, nspan=8, n=14, mat_fn=kit.wing_mat(top="paint_secondary", stripe="paint_accent"))


def build_spoiler_jets():
    """A wing with a small jet at each end."""
    kit.rbox("mount", (0.26, 0.07, 0.02), (0, 0, 0.01), mat="metal_dark", bevel=0.005)
    for s in (-1, 1):
        kit.tube("mast", [(s * 0.08, 0.0, 0.02), (s * 0.08, -0.02, 0.2)], 0.014, mat="metal_dark", fillet=0, n=8)
    kit.wing_element("wing", -0.4, 0.4, 0.26, 0.12, 0.05, 8, 0.08, 0.215, nspan=10, n=16, mat_fn=kit.wing_mat())
    for s in (-1, 1):
        x = s * 0.42
        kit.loft("pod", [dict(pos=0.12, c1=x, c2=0.2, w=0.05, h=0.05), dict(pos=0.09, w=0.078, h=0.078), dict(pos=-0.14, w=0.078, h=0.078), dict(pos=-0.2, w=0.058, h=0.058)], n=22, sub=3, mat_fn=lambda a, u: "chrome" if a < 0.18 else "paint_secondary", sharp_angle=44.0)
        kit.cyl("intake", 0.046, 0.02, (x, 0.128, 0.2), (0, 1, 0), mat="metal_dark", segs=18)
        matrix = Matrix.Translation((x, -0.2, 0.2)) @ Matrix.Rotation(pi / 2, 4, "Z")
        kit.lathe("nozzle_core", [(0.0, 0.056), (-0.03, 0.05), (-0.03, 0.0005)], 18, mat="metal_dark", sharp_angle=40.0, mtx=matrix)
        kit.lathe("flame", [(-0.03, 0.046), (-0.1, 0.04), (-0.18, 0.012), (-0.2, 0.0005)], 16, mat="z_amber", sharp_angle=70.0, mtx=matrix)


# --- helmets ----------------------------------------------------------------------------------


def build_helmet_retro():
    """An open-face helmet with goggles and a leather strap."""
    cols, rows = 40, 14
    rings = []
    for i in range(rows + 1):
        t = i / rows
        ring = []
        for j in range(cols):
            lon = 360.0 * j / cols
            low = -38.0 - 22.0 * cos(radians(180 - lon)) * 0.5 + 18.0 * max(0.0, cos(radians(lon)))
            ring.append(kit.helmet_point(lon, low + (87.0 - low) * t)[0])
        rings.append(ring)
    kit.grid_object("shell", rings, closed_u=True, cap0=True, cap1=True, mat="helmet", cap_mat="rubber")
    ring = []
    for j in range(cols):
        lon = 360.0 * j / cols
        low = -38.0 - 22.0 * cos(radians(180 - lon)) * 0.5 + 18.0 * max(0.0, cos(radians(lon)))
        ring.append(kit.helmet_point(lon, low)[0])
    kit.sweep("edge", ring, kit.circle_pts(8, 0.008), closed=True, mat="z_wood", sharp_angle=None)
    kit.sphere("balaclava", 0.142, tuple(kit.HELMET_C + V((0, 0.012, -0.04))), scale=(0.94, 1.0, 1.06), mat="z_glove", segs=24, rings=16)
    band = [kit.helmet_point(360.0 * j / 44, 12, 0.006)[0] for j in range(44)]
    kit.sweep("strap", band, kit.se_pts(8, 0.004, 0.022, 4.0), closed=True, up=(0, 0, 1), mat="paint_accent", sharp_angle=None)
    for s in (-1, 1):
        point, normal = kit.helmet_point(s * 22, 12, 0.02)
        kit.sphere("lens", 0.05, tuple(point), scale=(1.0, 0.5, 0.82), mat="visor", segs=20, rings=12)
        kit.torus("lens_ring", 0.05, 0.009, Matrix.Translation(point) @ kit.axis_matrix(normal), mat="chrome", n_major=24, n_minor=6, rx=0.05)
    point, normal = kit.helmet_point(0, 12, 0.03)
    kit.rbox("nose_bridge", (0.03, 0.012, 0.012), tuple(point), mat="chrome", bevel=0.003, segs=1)


def build_helmet_horns():
    """The full helmet of the game, with horns."""
    helmet = kit.build_helmet()
    for s in (-1, 1):
        base = kit.HELMET_C + V((s * 0.13, -0.01, 0.07))
        points = [base, base + V((s * 0.1, 0.0, 0.05)), base + V((s * 0.15, -0.01, 0.15)), base + V((s * 0.14, -0.04, 0.27))]
        kit.tube("horn", points, 1.0, radii=[0.044, 0.034, 0.02, 0.003], smooth=4, n=12, mat="paint_accent")
    return helmet


# --- signs for service vehicles ---------------------------------------------------------------


def build_taxi_sign():
    kit.rbox("sign", (0.56, 0.2, 0.2), (0, 0, 0.12), mat="paint_primary", bevel=0.05, segs=3)
    for s in (-1, 1):
        kit.rbox("sign_face", (0.44, 0.012, 0.11), (0, s * 0.1, 0.12), mat="carbon", bevel=0.01, segs=1)
        kit.rbox("sign_letters", (0.3, 0.014, 0.05), (0, s * 0.102, 0.12), mat="z_light", bevel=0.006, segs=1)


def build_siren():
    kit.rbox("bar", (1.2, 0.3, 0.08), (0, 0, 0.05), mat="metal_dark", bevel=0.03, segs=2)
    for s, mat in ((-1, "z_blue"), (1, "z_red")):
        kit.rbox("beacon", (0.5, 0.26, 0.18), (s * 0.3, 0, 0.17), mat=mat, bevel=0.06, segs=3)
    kit.rbox("speaker", (0.14, 0.24, 0.12), (0, 0, 0.14), mat="chrome", bevel=0.02, segs=2)


KARTS = {
    "bolha": (build_bolha, BOLHA, "Bolinha"),
    "buggy": (build_buggy, BUGGY, "Buggy"),
    "nevasca": (build_nevasca, NEVASCA, "Nevasca"),
    "foguete": (build_foguete, FOGUETE, "Foguete"),
    "tubarao": (build_tubarao, TUBARAO, "Tubarão"),
    "dragster": (build_dragster, DRAGSTER, "Dragster"),
}

GAME_SPECS = {"flecha": (kit.VORTEX, "Flecha"), "trovao": (kit.BRUTUS, "Trovão"), "cometa": (kit.FALCON, "Cometa"), "faisca": (kit.BOLT, "Faísca"), "ferrao": (kit.MANTIS, "Ferrão"), "blindado": (kit.TITAN, "Blindado")}
