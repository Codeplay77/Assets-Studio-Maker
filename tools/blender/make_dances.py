# Makes the editor's own dances on the Mesh2Motion human skeleton and exports them as a GLB that
# scripts/import-animations.ts adds to the animation pack.
#
#   blender --factory-startup -b --python tools/blender/make_dances.py -- <human-base-animations.glb> <dancas.glb> [dance,dance,...]
#
# The skeleton comes from Mesh2Motion's human-base-animations.glb (CC0); its own clips are dropped.
# Each dance is a list of key poses on the beat of its music (see poser.py for what a pose says).
# Legs and arms are driven by IK: feet stand on targets on the floor, so a planted foot never
# slides, and hands reach for places around the chest. Blender eases between the poses, bakes every
# frame into plain bone rotations, closes the loop and exports.

import math
import os
import sys

script = globals().get("__file__") or sys.argv[sys.argv.index("--python") + 1]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))

import poser  # noqa: E402
from poser import BASE, P, apply, bake, clear_animation, finish_curves, key, mirror  # noqa: E402,F401

args = sys.argv[sys.argv.index("--") + 1:]
SOURCE, OUT = args[0], args[1]
ONLY = set(args[2].split(",")) if len(args) > 2 and args[2] else None

# How far each dance closes the hands: clapping wants them flat.
CURL = {"Danca_Palmas": 0.2, "Danca_Rock": 1.0}


def blend(a, b, t=0.5):
    """A pose between two others."""
    out = {}
    for name in BASE:
        x, y = a[name], b[name]
        if x is None or y is None:
            out[name] = x if y is None else y
        elif isinstance(x, tuple):
            out[name] = tuple(p + (q - p) * t for p, q in zip(x, y))
        else:
            out[name] = x + (y - x) * t
    return out


def lift_steps(ordered, beats):
    """
    A foot that goes somewhere between two poses is lifted halfway there, so it steps instead of
    sliding over the floor.
    """
    out = []
    loop = ordered + [(beats, ordered[0][1])]
    for (beat, pose), (after, nxt) in zip(loop, loop[1:]):
        out.append((beat, pose))
        mid = None
        for side in "lr":
            a, b = pose[f"f{side}"], nxt[f"f{side}"]
            distance = math.hypot(b[0] - a[0], b[1] - a[1])
            if distance > 0.025 and a[2] < 0.01 and b[2] < 0.01:
                mid = mid or blend(pose, nxt)
                f = mid[f"f{side}"]
                mid[f"f{side}"] = (f[0], f[1], 0.04 + 0.15 * distance, 10, f[4])
        if mid is not None:
            out.append(((beat + after) / 2, mid))
    return out

def make_dance(name, bpm, keys, beats, interpolation="BEZIER"):
    """Keys the poses on their beats, bakes the loop into bone rotations and keeps it as an action."""
    print(f"== {name}")
    poser.hands = CURL.get(name, 0.6)
    clear_animation()
    frames_per_beat = poser.FPS * 60.0 / bpm
    end = round(beats * frames_per_beat)
    ordered = lift_steps(sorted(keys, key=lambda item: item[0]), beats)
    for beat, pose in ordered:
        apply(pose)
        key(round(beat * frames_per_beat))
    # The loop closes on its first pose.
    apply(ordered[0][1])
    key(end)
    finish_curves(interpolation)
    return bake(name, end - 1)


# --- dances --------------------------------------------------------------------------------------

def samba():
    """Samba no pé: um pé de cada vez troca o peso a cada meio tempo, o quadril estala, ombros sacodem e os braços giram abertos."""
    a = P(hips=(-0.05, -0.06, 0.0), hipr=(10, 0, -7), chest=(-12, 4, 5), head=(8, 0, -4),
          fr=(-0.10, 0.02, 0, 0, -10), fl=(0.06, -0.10, 0, 30, 10),
          hr=(-0.50, 0.04, 0.12), er=(-0.6, -0.2, -0.3), hl=(0.26, 0.14, 0.32), el=(0.5, -0.4, -0.1), sh=(8, 0), knee=0.04)
    b = P(hips=(0.0, -0.095, 0.02), hipr=(0, 4, 0), chest=(0, 6, 0), head=(0, 4, 0),
          fr=(-0.10, 0.02, 0, 12, -10), fl=(0.10, 0.02, 0, 12, 10),
          hr=(-0.46, -0.04, 0.18), er=(-0.6, -0.3, -0.2), hl=(0.46, -0.04, 0.18), el=(0.6, -0.3, -0.2), sh=(0, 8), knee=0.05)
    c, d = mirror(a), mirror(b)
    keys = [(0, a), (0.5, b), (1, c), (1.5, d), (2, a), (2.5, b), (3, c), (3.5, d)]
    return "Danca_Samba", 104, keys, 4


def forro():
    """Forró pé de serra, sozinho: dois pra lá, dois pra cá, abraçando o par invisível."""
    arms = dict(hl=(0.32, 0.10, 0.30), el=(0.6, -0.4, -0.2), hr=(-0.12, -0.02, 0.32), er=(-0.6, -0.3, -0.3))
    start = P(hips=(0.0, -0.03, 0), chest=(0, 4, 0), fl=(0.10, 0.0, 0, 0, 5), fr=(-0.10, 0.0, 0, 0, -5), **arms)
    out_l = P(hips=(0.06, -0.06, 0), hipr=(0, 0, 4), chest=(4, 4, -2), fl=(0.26, 0.0, 0, 0, 5), fr=(-0.10, 0.0, 0, 18, -5), knee=0.03, **arms)
    close_l = P(hips=(0.12, -0.08, 0), hipr=(0, 0, -3), chest=(4, 5, 2), fl=(0.26, 0.0, 0, 10, 5), fr=(0.10, 0.0, 0, 0, -5), knee=0.03, **arms)
    back_r = P(hips=(0.02, -0.05, 0), chest=(0, 4, 0), fl=(0.26, 0.0, 0, 15, 5), fr=(-0.10, 0.0, 0, 0, -5), **arms)
    out_r = P(hips=(-0.06, -0.06, 0), hipr=(0, 0, -4), chest=(-4, 4, 2), fl=(0.10, 0.0, 0, 18, 5), fr=(-0.26, 0.0, 0, 0, -5), knee=0.03, **arms)
    close_r = P(hips=(-0.12, -0.08, 0), hipr=(0, 0, 3), chest=(-4, 5, -2), fl=(-0.10, 0.0, 0, 0, 5), fr=(-0.26, 0.0, 0, 10, -5), knee=0.03, **arms)
    back_l = P(hips=(-0.02, -0.05, 0), chest=(0, 4, 0), fl=(0.10, 0.0, 0, 0, 5), fr=(-0.26, 0.0, 0, 15, -5), **arms)
    keys = [(0, start), (0.5, out_l), (1, close_l), (1.5, back_r), (2, {**start, "fr": (-0.10, 0.0, 0, 0, -5), "fl": (0.10, 0.0, 0, 0, 5)}),
            (2.5, out_r), (3, close_r), (3.5, back_l)]
    # back_r keeps the left foot out and returns the right; the next pose brings the left back.
    return "Danca_Forro", 116, keys, 4


def axe():
    """Axé: pulinhos no lugar, um braço sobe de cada vez e o corpo acompanha."""
    up_l = P(hips=(0.02, 0.02, 0), chest=(8, -2, -6), head=(10, -6, -4), fl=(0.11, 0, 0.06, 20, 0), fr=(-0.11, 0, 0, 0, 0),
             hl=(0.18, 0.62, 0.08), el=(0.6, 0.3, -0.3), hr=(-0.30, -0.18, 0.20), sh=(10, 0))
    down = P(hips=(0.0, -0.10, 0.02), chest=(0, 10, 0), head=(0, 8, 0), fl=(0.11, 0, 0, 0, 5), fr=(-0.11, 0, 0, 0, -5),
             hl=(0.30, -0.10, 0.25), hr=(-0.30, -0.10, 0.25), knee=0.05)
    up_r = mirror(up_l)
    keys = [(0, down), (0.5, up_l), (1, down), (1.5, up_r), (2, down), (2.5, up_l), (3, down), (3.5, up_r)]
    return "Danca_Axe", 128, keys, 4


def frevo():
    """Frevo: agachado e chutando para a frente, braços abertos segurando a sombrinha."""
    squat = P(hips=(0, -0.30, -0.04), hipr=(0, 8, 0), chest=(0, 12, 0), head=(0, -6, 0), fl=(0.18, 0.02, 0, 0, 20), fr=(-0.18, 0.02, 0, 0, -20),
              hl=(0.50, 0.30, 0.10), hr=(-0.48, 0.00, 0.12), sh=(8, 2), knee=0.12)
    kick_r = P(hips=(0.06, -0.10, -0.03), hipr=(0, -4, 6), chest=(-12, -2, -6), head=(-8, 0, 4), fl=(0.18, 0.02, 0, 20, 10), fr=(-0.12, 0.42, 0.28, -20, -5),
               hl=(0.52, 0.40, 0.05), hr=(-0.45, -0.05, 0.15), sh=(10, 0), knee=0.04)
    kick_l = mirror(kick_r)
    keys = [(0, squat), (0.5, kick_r), (1, squat), (1.5, kick_l), (2, squat), (2.5, kick_r), (3, squat), (3.5, kick_l)]
    return "Danca_Frevo", 140, keys, 4


def passinho():
    """Passinho: um pé bate à frente com o calcanhar e volta, o outro gira na ponta, joelhos baixos e braços soltos."""
    a = P(hips=(-0.03, -0.12, 0), hipr=(-10, 6, 0), chest=(18, 10, -4), head=(-10, 8, 0), fl=(0.13, 0.15, 0, -14, 25), fr=(-0.12, 0.0, 0, 0, -20),
          hl=(0.24, -0.30, -0.08), hr=(-0.22, -0.20, 0.30), er=(-0.4, -0.5, -0.4), sh=(0, 10), knee=0.08)
    b = P(hips=(0.0, -0.06, 0), chest=(0, 6, 0), head=(0, -2, 0), fl=(0.12, 0.0, 0, 0, -12), fr=(-0.12, 0.0, 0, 22, 12),
          hl=(0.26, -0.32, 0.12), hr=(-0.26, -0.32, 0.12), sh=(4, 4), knee=0.05)
    c, d = mirror(a), mirror(b)
    keys = [(0, a), (0.5, b), (1, c), (1.5, d), (2, a), (2.5, b), (3, c), (3.5, d)]
    return "Danca_Passinho", 130, keys, 4


def disco():
    """Disco: passo e toque para os lados; o braço aponta para o alto e depois cruza o corpo."""
    up = P(hips=(-0.07, -0.04, 0), hipr=(0, 0, -6), chest=(-8, -4, 6), head=(-15, -12, 0), fr=(-0.14, 0, 0, 0, -10), fl=(-0.02, 0.02, 0, 25, 10),
           hr=(-0.42, 0.62, 0.10), er=(-0.6, 0.2, -0.3), hl=(0.22, -0.12, 0.10), sh=(0, 10))
    step_l = P(hips=(0.0, -0.06, 0), chest=(0, 2, 0), head=(0, 0, 0), fr=(-0.14, 0, 0, 0, -10), fl=(0.14, 0, 0, 0, 10),
               hr=(-0.10, 0.10, 0.30), hl=(0.24, -0.20, 0.10))
    down = P(hips=(0.07, -0.06, 0), hipr=(0, 0, 6), chest=(10, 6, -4), head=(12, 10, 0), fl=(0.14, 0, 0, 0, 10), fr=(0.02, 0.02, 0, 25, -10),
             hr=(0.30, -0.45, 0.20), er=(-0.5, -0.3, -0.4), hl=(0.24, -0.18, 0.10))
    step_r = P(hips=(0.0, -0.05, 0), chest=(0, 2, 0), fl=(0.14, 0, 0, 0, 10), fr=(-0.14, 0, 0, 0, -10), hr=(-0.20, 0.10, 0.25), hl=(0.24, -0.20, 0.10))
    half = [(0, up), (0.5, step_l), (1, down), (1.5, step_r), (2, up), (2.5, step_l), (3, down), (3.5, step_r)]
    keys = half + [(beat + 4, mirror(pose)) for beat, pose in half]
    return "Danca_Disco", 112, keys, 8


def hiphop():
    """Balanço do hip hop: passo para um lado e junta, joelhos marcando o tempo, ombros rolando e braços balançando."""
    a = P(hips=(0.06, -0.14, 0.02), hipr=(10, 8, 0), chest=(-12, 14, -4), head=(-6, 14, 0), fl=(0.18, 0.0, 0, 0, 15), fr=(0.02, 0.0, 0, 20, -10),
          hl=(0.28, -0.28, 0.30), hr=(-0.26, -0.34, -0.06), sh=(10, 0), knee=0.07)
    up = P(hips=(0.06, -0.05, 0), hipr=(6, 2, 0), chest=(-6, 4, 2), head=(-4, -6, 0), fl=(0.18, 0.0, 0, 0, 15), fr=(0.02, 0.0, 0, 10, -10),
           hl=(0.26, -0.36, 0.10), hr=(-0.26, -0.36, 0.10), sh=(0, 8))
    deeper = {**a, "hips": (0.06, -0.17, 0.03), "sh": (0, 10), "head": (-6, 18, 0), "hl": (0.26, -0.34, -0.06), "hr": (-0.28, -0.28, 0.30)}
    out_r = P(hips=(0.0, -0.07, 0), chest=(0, 6, 0), fl=(0.18, 0.0, 0, 10, 15), fr=(-0.18, 0.0, 0, 0, -15), hl=(0.28, -0.32, 0.16), hr=(-0.28, -0.32, 0.16))
    half = [(0, a), (0.5, up), (1, deeper), (1.5, out_r)]
    keys = half + [(beat + 2, mirror(pose)) for beat, pose in half]
    return "Danca_HipHop", 96, keys, 4


def robo():
    """Robô: movimentos secos que param no lugar, cotovelos em ângulo reto e a cabeça girando de uma vez."""
    base = dict(hips=(0, -0.02, 0), fl=(0.12, 0, 0, 0, 0), fr=(-0.12, 0, 0, 0, 0), el=(0.55, -0.2, -0.1), er=(-0.55, -0.2, -0.1))
    p1 = P(**base, head=(30, 0, 0), chest=(10, 0, 0), hl=(0.34, 0.25, 0.10), hr=(-0.30, -0.10, 0.30))
    p3 = P(**base, head=(-30, 0, 0), chest=(-10, 0, 0), hl=(0.30, -0.10, 0.30), hr=(-0.34, 0.25, 0.10))
    p5 = P(**{**base, "hips": (0, -0.08, 0), "el": (0.5, -0.3, -0.2), "er": (-0.5, -0.3, -0.2)}, head=(0, -10, 0), hl=(0.20, 0.05, 0.40), hr=(-0.20, 0.05, 0.40))
    p7 = P(**{**base, "el": (0.6, -0.4, 0.1), "er": (-0.6, -0.4, 0.1)}, head=(0, 10, 0), hl=(0.44, 0.0, 0.0), hr=(-0.44, 0.0, 0.0))
    # Each move snaps on the beat and holds until just before the next one.
    keys = [(0, p1), (0.7, p1), (1, p3), (1.7, p3), (2, p5), (2.7, p5), (3, p7), (3.7, p7)]
    return "Danca_Robo", 108, keys, 4, "LINEAR"


def twist():
    """Twist: pés plantados girando, quadril para um lado e peito para o outro, descendo e subindo."""
    keys = []
    for i in range(8):
        side = 1 if i % 2 == 0 else -1
        depth = [0.02, 0.06, 0.10, 0.14, 0.14, 0.10, 0.06, 0.02][i]
        keys.append((i * 0.5, P(hips=(0, -0.04 - depth, 0), hipr=(28 * side, 4, 0), chest=(-34 * side, 8, 0), head=(18 * side, 4, 0),
                                fl=(0.13, 0.0, 0, 12, 30 * side), fr=(-0.13, 0.0, 0, 12, 30 * side),
                                hl=(0.30, -0.12, 0.10 + 0.12 * side), hr=(-0.30, -0.12, 0.10 - 0.12 * side), knee=0.05)))
    return "Danca_Twist", 150, keys, 4


def salsa():
    """Salsa: o passo básico, à frente com a esquerda, volta, e para trás com a direita, quadril solto."""
    # Arms bent in front at the waist, elbows down, as salsa dancers hold them.
    arms = dict(hl=(0.26, -0.06, 0.32), hr=(-0.26, -0.06, 0.32), el=(0.35, -0.55, -0.25), er=(-0.35, -0.55, -0.25))
    f1 = P(hips=(0.02, -0.05, 0.06), hipr=(0, 0, 6), chest=(-6, 2, -3), fl=(0.11, 0.20, 0, 0, 8), fr=(-0.11, 0.0, 0, 20, -8), **arms)
    f2 = P(hips=(-0.03, -0.04, 0.0), hipr=(0, 0, -6), chest=(4, 2, 3), fl=(0.11, 0.20, 0, 20, 8), fr=(-0.11, 0.0, 0, 0, -8), **arms)
    f3 = P(hips=(0.02, -0.05, 0.0), hipr=(0, 0, 5), chest=(0, 3, -2), fl=(0.11, 0.0, 0, 0, 8), fr=(-0.11, 0.0, 0, 15, -8), **arms)
    b1 = P(hips=(-0.02, -0.05, -0.06), hipr=(0, 0, -6), chest=(6, 2, 3), fl=(0.11, 0.0, 0, 20, 8), fr=(-0.11, -0.20, 0, 0, -8), **arms)
    b2 = P(hips=(0.03, -0.04, 0.0), hipr=(0, 0, 6), chest=(-4, 2, -3), fl=(0.11, 0.0, 0, 0, 8), fr=(-0.11, -0.20, 0, 20, -8), **arms)
    b3 = P(hips=(-0.02, -0.05, 0.0), hipr=(0, 0, -5), chest=(0, 3, 2), fl=(0.11, 0.0, 0, 15, 8), fr=(-0.11, 0.0, 0, 0, -8), **arms)
    keys = [(0, f1), (1, f2), (2, f3), (3, f3), (4, b1), (5, b2), (6, b3), (7, b3)]
    return "Danca_Salsa", 176, keys, 8


def grapevine():
    """Passo de lado com palmas: para a direita cruzando o pé atrás, toque e palma; e de volta."""
    open_arms = dict(hl=(0.30, -0.25, 0.12), hr=(-0.30, -0.25, 0.12))
    clap = dict(hl=(0.02, -0.02, 0.36), hr=(-0.02, -0.02, 0.36), el=(0.5, -0.4, -0.2), er=(-0.5, -0.4, -0.2))
    start = P(hips=(0, -0.04, 0), fl=(0.11, 0, 0, 0, 0), fr=(-0.11, 0, 0, 0, 0), **open_arms)
    s1 = P(hips=(-0.12, -0.04, 0), chest=(0, 2, -4), fl=(0.11, 0.0, 0, 15, 0), fr=(-0.30, 0.0, 0, 0, -10), **open_arms)
    s2 = P(hips=(-0.24, -0.05, 0), chest=(0, 2, 0), fl=(-0.40, -0.12, 0, 0, 10), fr=(-0.30, 0.0, 0, 15, -10), **open_arms)
    s3 = P(hips=(-0.40, -0.04, 0), chest=(0, 2, -4), fl=(-0.40, -0.12, 0, 15, 10), fr=(-0.58, 0.0, 0, 0, -10), **open_arms)
    s4 = P(hips=(-0.46, -0.06, 0), chest=(0, 6, 0), head=(0, 8, 0), fl=(-0.40, 0.0, 0, 30, 0), fr=(-0.58, 0.0, 0, 0, -10), **clap)
    t1 = P(hips=(-0.30, -0.04, 0), chest=(0, 2, 4), fl=(-0.20, 0.0, 0, 0, 10), fr=(-0.58, 0.0, 0, 15, -10), **open_arms)
    t2 = P(hips=(-0.18, -0.05, 0), chest=(0, 2, 0), fl=(-0.20, 0.0, 0, 15, 10), fr=(-0.12, -0.12, 0, 0, -10), **open_arms)
    t3 = P(hips=(-0.02, -0.04, 0), chest=(0, 2, 4), fl=(0.11, 0.0, 0, 0, 10), fr=(-0.12, -0.12, 0, 15, -10), **open_arms)
    t4 = P(hips=(0.04, -0.06, 0), chest=(0, 6, 0), head=(0, 8, 0), fl=(0.11, 0.0, 0, 0, 10), fr=(0.0, 0.0, 0, 30, 0), **clap)
    keys = [(0, start), (1, s1), (2, s2), (3, s3), (3.5, s4), (5, t1), (6, t2), (7, t3), (7.5, t4)]
    return "Danca_Palmas", 120, keys, 8


def rock():
    """Rock: balança a cabeça e toca a guitarra no ar, joelhos marcando o tempo."""
    guitar = dict(hl=(0.10, -0.02, 0.42), el=(0.6, -0.3, 0.1), er=(-0.6, -0.2, -0.3))
    down = P(hips=(0, -0.10, -0.02), hipr=(-6, 8, 0), chest=(14, 20, 0), head=(0, 34, 0), fl=(0.18, 0.08, 0, 0, 15), fr=(-0.16, -0.06, 0, 0, -20),
             hr=(-0.20, -0.42, 0.18), knee=0.06, **guitar)
    up = P(hips=(0, -0.04, 0), hipr=(-6, 2, 0), chest=(14, 4, 0), head=(0, -14, 0), fl=(0.18, 0.08, 0, 0, 15), fr=(-0.16, -0.06, 0, 0, -20),
           hr=(-0.18, -0.20, 0.20), knee=0.04, **guitar)
    keys = [(0, down), (0.5, up), (1, down), (1.5, up), (2, down), (2.5, up), (3, down), (3.5, up)]
    return "Danca_Rock", 140, keys, 4

DANCES = [samba, forro, axe, frevo, passinho, disco, hiphop, robo, twist, salsa, grapevine, rock]


poser.load(SOURCE)
poser.add_constraints()
poser.calibrate_all()
made = []
for build in DANCES:
    spec = build()
    if ONLY and spec[0] not in ONLY:
        continue
    made.append(make_dance(*spec))
poser.export(OUT, made)
