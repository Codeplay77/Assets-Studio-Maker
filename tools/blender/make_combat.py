# Makes the editor's own fighting moves on the Mesh2Motion human skeleton and exports them as a GLB
# that scripts/import-animations.ts adds to the animation pack.
#
#   blender --factory-startup -b --python tools/blender/make_combat.py -- <human-base-animations.glb> <combate.glb> [move,move,...] [--previa <folder>]
#
# Every move starts and ends in the same guard as Combate_Guarda, so a game can chain them. A move
# is a few key poses (see poser.py for what a pose says) on frames at 30 per second. To look alive
# instead of robotic:
#
# - Between keys every value follows a smooth curve that keeps its speed through a key, and only
#   stops where it turns back (a monotone cubic). A blow instead speeds up into its key ("snap"),
#   arriving half again as fast as its average, and stops there, as a fist does on a target; a
#   recoil leaves fast and slows down ("out").
# - Body parts do not move together: the hips lead, the chest follows, the arms come after and the
#   head arrives last, a frame or two each, as the weight goes from the legs up to the fist.
# - Nothing is ever still: breath moves the chest, the head and the hands drift a little, in waves
#   that come back to nothing at the first and last frames.
# - The head keeps looking ahead while the body turns, as a fighter keeps the eyes on the opponent.
#
# --previa renders the mannequin at a few moments of each move into that folder, to review them.

import math
import os
import sys

script = globals().get("__file__") or sys.argv[sys.argv.index("--python") + 1]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))

import poser  # noqa: E402
from poser import BASE, P, apply, bake, clear_animation, finish_curves, key, mirror  # noqa: E402

args = sys.argv[sys.argv.index("--") + 1:]
PREVIEW = None
if "--previa" in args:
    PREVIEW = args[args.index("--previa") + 1]
    args = args[:args.index("--previa")]
SOURCE, OUT = args[0], args[1]
ONLY = set(args[2].split(",")) if len(args) > 2 and args[2] else None

# --- curves --------------------------------------------------------------------------------------

# Every value of a pose, in order, with how many numbers it has and the body part it belongs to.
SCHEMA = [
    ("hips", 3, "hips"), ("hipr", 3, "hips"),
    ("chest", 3, "chest"), ("sh", 2, "chest"), ("reach", 2, "chest"),
    ("head", 3, "head"),
    ("hl", 3, "arms"), ("hr", 3, "arms"), ("el", 3, "arms"), ("er", 3, "arms"), ("fing", 2, "arms"),
    ("fl", 6, "legs"), ("fr", 6, "legs"), ("knee", 1, "legs"), ("kl", 3, "legs"), ("kr", 3, "legs"), ("kw", 2, "legs"),
]
# How many frames each part comes after the moment of a key: the hips lead and the head comes last.
LAG = {"hips": -1.5, "chest": -0.5, "arms": 0.0, "head": 1.5, "legs": 0.0}


def flatten(pose):
    """A pose as numbers, every value filled in, in the order of SCHEMA."""
    values = []
    for name, size, _ in SCHEMA:
        value = pose.get(name)
        if name in ("el", "er") and value is None:
            value = (0.30 if name == "el" else -0.30, -0.45, -0.60)
        elif name in ("kl", "kr") and value is None:
            value = (0.0, 0.0, 0.0)
        elif name == "kw" and value is None:
            value = (1.0 if pose.get("kl") is not None else 0.0, 1.0 if pose.get("kr") is not None else 0.0)
        elif name == "fing" and value is None:
            value = (1.0, 1.0)
        elif name in ("fl", "fr") and len(value) == 5:
            # Feet may also roll, the sole turning sideways.
            value = (*value, 0.0)
        elif name == "knee":
            value = (value,)
        values.extend(float(v) for v in value)
    return values


def unflatten(values):
    pose = {}
    at = 0
    for name, size, _ in SCHEMA:
        part = tuple(values[at:at + size])
        pose[name] = part[0] if name == "knee" else part
        at += size
    return pose


def slopes(times, values, eases, loop, period):
    """
    How fast a value goes through each key: as fast as its neighbors ask, but not at all where it
    turns back, and never so fast that it overshoots (Fritsch and Carlson's monotone cubic). A key
    that a blow starts from is a stop.
    """
    n = len(times)
    out = []
    for i in range(n):
        if not loop and (i == 0 or i == n - 1):
            out.append(0.0)
            continue
        before, after = (i - 1) % n, (i + 1) % n
        t0 = times[before] - (period if loop and i == 0 else 0)
        t2 = times[after] + (period if loop and i == n - 1 else 0)
        d0 = (values[i] - values[before]) / max(times[i] - t0, 1e-6)
        d1 = (values[after] - values[i]) / max(t2 - times[i], 1e-6)
        if d0 * d1 <= 0 or eases[after] == "snap":
            out.append(0.0)
            continue
        slope = (d0 * (t2 - times[i]) + d1 * (times[i] - t0)) / (t2 - t0)
        limit = 3 * min(abs(d0), abs(d1))
        out.append(max(-limit, min(limit, slope)))
    return out


def curve_at(time, times, values, rates, eases, loop, period):
    n = len(times)
    if loop:
        time %= period
    else:
        time = max(times[0], min(times[-1], time))
    # The segment the time falls in, from key i to key j.
    i = max(k for k in range(n) if times[k] <= time) if time >= times[0] else n - 1
    j = (i + 1) % n
    t0 = times[i]
    t1 = times[j] + (period if j == 0 else 0) if loop else times[j] if j > i else times[i]
    if t1 <= t0:
        return values[i]
    h = t1 - t0
    u = (time - t0) / h
    v0, v1 = values[i], values[j]
    ease = eases[j]
    if ease == "snap":
        return v0 + (v1 - v0) * (1.5 * u * u - 0.5 * u * u * u)
    if ease == "out":
        return v0 + (v1 - v0) * (1 - (1 - u) ** 2)
    if ease == "lin":
        return v0 + (v1 - v0) * u
    u2, u3 = u * u, u * u * u
    return (2 * u3 - 3 * u2 + 1) * v0 + (u3 - 2 * u2 + u) * h * rates[i] + (-2 * u3 + 3 * u2) * v1 + (u3 - u2) * h * rates[j]


# How much the head turns back toward the opponent, in the guard: 1 would keep it straight ahead.
GUARD_LOOK = 0.7


class Clip:
    def __init__(self, name, end, keys, loop=False, lag=None, life=0.6, look=GUARD_LOOK):
        self.name, self.end, self.loop, self.life, self.look = name, end, loop, life, look
        keys = sorted(keys, key=lambda k: k[0])
        self.times = [k[0] for k in keys]
        self.eases = [k[2] if len(k) > 2 else "smooth" for k in keys]
        rows = [flatten(k[1]) for k in keys]
        self.columns = list(zip(*rows))
        self.rates = [slopes(self.times, list(column), self.eases, loop, end) for column in self.columns]
        self.lag = dict(LAG, **(lag or {}))
        self.parts = [part for _, size, part in SCHEMA for _ in range(size)]

    def pose_at(self, frame):
        # Every part is together at the first and last frames, so a move starts and ends exactly in its
        # stance and chains with the others; the parts drift apart over the first frames and come back
        # together over the last. In a loop the last frame is the first again, so it still wraps.
        together = min(1.0, frame / 4.0, (self.end - frame) / 4.0)
        values = []
        for c, column in enumerate(self.columns):
            time = frame - self.lag[self.parts[c]] * together
            values.append(curve_at(time, self.times, column, self.rates[c], self.eases, self.loop, self.end))
        pose = unflatten(values)
        self.alive(pose, frame)
        return pose

    def wave(self, frame, cycles, phase=0.0):
        """A wave that goes `cycles` times through the clip and is nothing at its first and last frames."""
        return math.sin(2 * math.pi * cycles * frame / self.end + phase) * math.sin(math.pi * frame / self.end) if not self.loop \
            else math.sin(2 * math.pi * cycles * frame / self.end + phase) - math.sin(phase)

    def alive(self, pose, frame):
        life = self.life
        breaths = max(1, round(self.end / 90))
        cycles = max(1, round(self.end / 40))
        yaw, pitch, roll = pose["chest"]
        pose["chest"] = (yaw, pitch + 1.6 * life * self.wave(frame, breaths), roll)
        hx, hy, hz = pose["hips"]
        pose["hips"] = (hx, hy + 0.004 * life * self.wave(frame, breaths, 1.0), hz)
        yaw, pitch, roll = pose["head"]
        # The eyes stay on the opponent while the hips and chest turn; in a move that happens once, as
        # much as in the guard at its first and last frames, so it chains with it.
        together = 1.0 if self.loop else min(1.0, frame / 4.0, (self.end - frame) / 4.0)
        look = GUARD_LOOK + (self.look - GUARD_LOOK) * together
        turned = pose["hipr"][0] + pose["chest"][0]
        pose["head"] = (yaw - look * turned + 1.5 * life * self.wave(frame, cycles, 0.7),
                        pitch + 1.0 * life * self.wave(frame, cycles + 1, 2.1), roll + 0.8 * life * self.wave(frame, cycles, 4.0))
        for side, phase in (("hl", 0.0), ("hr", 2.4)):
            x, y, z = pose[side]
            pose[side] = (x + 0.006 * life * self.wave(frame, cycles, phase), y + 0.008 * life * self.wave(frame, cycles + 1, phase + 1.3), z)


def make(clip):
    """Poses every frame of a clip, bakes it into bone rotations and keeps it as an action."""
    print(f"== {clip.name}")
    clear_animation()
    last = clip.end - 1 if clip.loop else clip.end
    for frame in range(clip.end + 1):
        apply(clip.pose_at(frame))
        key(frame)
    finish_curves("LINEAR", cyclic=False)
    return bake(clip.name, last)


def with_(pose, **changes):
    out = dict(pose)
    out.update(changes)
    return out


# --- the guard -----------------------------------------------------------------------------------

# Orthodox stance: left foot ahead, body turned a little to the right, fists at the chin, elbows in.
G = P(
    hips=(0.0, -0.07, -0.01), hipr=(-22, 4, 0), chest=(-8, 6, 0), head=(0, 7, 0),
    fl=(0.10, 0.17, 0, 0, -12), fr=(-0.14, -0.17, 0, 8, -45), knee=0.03,
    hl=(0.12, 0.17, 0.28), hr=(-0.13, 0.17, 0.15), el=(0.18, -0.50, 0.10), er=(-0.18, -0.50, 0.0),
    sh=(6, 6), fing=(1, 1),
)


def guarda():
    """Guarda: o peso vai de uma perna para a outra, os punhos acompanham, quase parado."""
    a = with_(G, hips=(0.01, -0.085, 0.0), hipr=(-20, 5, 1), hl=(0.06, 0.16, 0.31), hr=(-0.10, 0.16, 0.17), fr=(-0.14, -0.17, 0, 10, -45))
    b = with_(G, hips=(-0.01, -0.065, -0.02), hipr=(-24, 3, -1), chest=(-9, 5, -1), hl=(0.07, 0.18, 0.28), hr=(-0.09, 0.18, 0.16))
    c = with_(G, hips=(0.0, -0.09, 0.0), hipr=(-21, 5, 0), hl=(0.05, 0.155, 0.32), hr=(-0.10, 0.165, 0.18), fr=(-0.14, -0.17, 0, 12, -45))
    keys = [(0, G), (10, a), (20, b), (30, c)]
    return Clip("Combate_Guarda", 40, keys, loop=True, life=1.0)


def jab():
    """Jab: o punho da frente sai reto e volta pelo mesmo caminho, o ombro cobre o queixo."""
    load = with_(G, hips=(0.0, -0.08, -0.02), hipr=(-25, 5, 0), chest=(-11, 7, 0), hl=(0.07, 0.15, 0.27))
    hit = with_(G, hips=(0.0, -0.075, 0.035), hipr=(-18, 6, 0), chest=(-2, 7, 2), hl=(0.03, 0.16, 0.55), el=(0.35, -0.10, 0.10),
                reach=(16, 0), sh=(14, 6), fl=(0.10, 0.19, 0, 0, -12))
    after = with_(hit, hl=(0.03, 0.155, 0.53), chest=(-3, 7, 2))
    back = with_(G, hips=(0.0, -0.072, -0.015), hl=(0.06, 0.17, 0.29))
    keys = [(0, G), (4, load), (8, hit, "snap"), (10, after), (16, back, "out"), (26, G)]
    return Clip("Combate_Jab", 26, keys, life=0.5)


def cross_poses():
    load = with_(G, hips=(-0.01, -0.085, -0.02), hipr=(-30, 5, 0), chest=(-13, 8, 0), hr=(-0.10, 0.15, 0.15))
    hit = with_(G, hips=(0.0, -0.08, 0.05), hipr=(8, 7, 0), chest=(12, 7, -2), hr=(-0.03, 0.15, 0.56), er=(-0.35, -0.12, 0.10),
                reach=(0, 18), sh=(6, 14), hl=(0.09, 0.19, 0.15), fr=(-0.14, -0.15, 0, 28, -15))
    return load, hit


def direto():
    """Direto de direita: o quadril gira, o pé de trás pivota e o punho de trás atravessa reto."""
    load, hit = cross_poses()
    after = with_(hit, hr=(-0.03, 0.15, 0.54), chest=(10, 7, -2))
    back = with_(G, hipr=(-18, 4, 0), hr=(-0.10, 0.17, 0.19), fr=(-0.14, -0.17, 0, 14, -40))
    keys = [(0, G), (5, load), (10, hit, "snap"), (12, after), (19, back, "out"), (30, G)]
    return Clip("Combate_Direto", 30, keys, life=0.5)


def hook_poses():
    load = with_(G, hips=(0.03, -0.10, 0.0), hipr=(-32, 6, 3), chest=(-16, 8, 5), hl=(0.10, 0.12, 0.26), el=(0.40, -0.30, 0.05))
    hit = with_(G, hips=(0.0, -0.09, 0.02), hipr=(16, 6, -2), chest=(24, 6, -3), hl=(-0.12, 0.17, 0.36), el=(0.55, 0.05, 0.25),
                reach=(10, 0), sh=(12, 8), fl=(0.10, 0.17, 0, 12, 25), hr=(-0.10, 0.19, 0.15))
    return load, hit


def gancho():
    """Gancho de esquerda: o corpo gira sobre o pé da frente e o braço dobrado vem de lado, na altura do queixo."""
    load, hit = hook_poses()
    after = with_(hit, chest=(28, 6, -3), hl=(-0.16, 0.17, 0.33))
    back = with_(G, hipr=(-16, 5, 0), hl=(0.05, 0.16, 0.30))
    keys = [(0, G), (6, load), (11, hit, "snap"), (13, after), (21, back, "out"), (32, G)]
    return Clip("Combate_Gancho", 32, keys, life=0.5)


def uppercut():
    """Uppercut de direita: abaixa e inclina para a direita, sobe girando e o punho sobe rente ao corpo."""
    load = with_(G, hips=(-0.03, -0.16, 0.0), hipr=(-28, 10, -5), chest=(-14, 16, -7), hr=(-0.10, -0.04, 0.20), er=(-0.30, -0.50, 0.0),
                 knee=0.05, fr=(-0.14, -0.17, 0, 4, -45))
    hit = with_(G, hips=(0.0, -0.05, 0.03), hipr=(8, -1, 4), chest=(16, -6, 4), hr=(-0.02, 0.25, 0.31), er=(-0.25, -0.55, 0.30),
                reach=(0, 8), sh=(6, 12), fr=(-0.14, -0.16, 0, 24, -20))
    after = with_(hit, hr=(-0.02, 0.27, 0.29), hips=(0.0, -0.045, 0.03))
    back = with_(G, hipr=(-17, 4, 0), hr=(-0.10, 0.18, 0.19))
    keys = [(0, G), (7, load), (12, hit, "snap"), (14, after), (23, back, "out"), (34, G)]
    return Clip("Combate_Uppercut", 34, keys, life=0.5)


def um_dois():
    """Jab e direto: o jab mede a distância e, enquanto volta, o direto já sai."""
    jab_hit = with_(G, hips=(0.0, -0.075, 0.035), hipr=(-18, 6, 0), chest=(-2, 7, 2), hl=(0.03, 0.16, 0.55), el=(0.35, -0.10, 0.10),
                    reach=(16, 0), sh=(14, 6))
    load, cross = cross_poses()
    swap = with_(load, hl=(0.06, 0.17, 0.36), hipr=(-26, 5, 0))
    after = with_(cross, hr=(-0.03, 0.15, 0.54))
    back = with_(G, hipr=(-18, 4, 0), hr=(-0.10, 0.17, 0.19), fr=(-0.14, -0.17, 0, 14, -40))
    keys = [(0, G), (4, with_(G, hipr=(-25, 5, 0), chest=(-11, 7, 0))), (8, jab_hit, "snap"), (12, swap), (16, cross, "snap"),
            (18, after), (25, back, "out"), (36, G)]
    return Clip("Combate_Um_Dois", 36, keys, life=0.4)


def sequencia():
    """Jab, direto e gancho: cada golpe carrega o próximo, o quadril vai e volta."""
    jab_hit = with_(G, hips=(0.0, -0.075, 0.035), hipr=(-18, 6, 0), chest=(-2, 7, 2), hl=(0.03, 0.16, 0.55), el=(0.35, -0.10, 0.10),
                    reach=(16, 0), sh=(14, 6))
    _, cross = cross_poses()
    _, hook = hook_poses()
    swap = with_(G, hips=(-0.01, -0.085, -0.01), hipr=(-26, 5, 0), chest=(-12, 8, 0), hl=(0.06, 0.17, 0.34))
    turn = with_(cross, hl=(0.12, 0.13, 0.26), el=(0.42, -0.30, 0.05), hr=(-0.06, 0.16, 0.30), hips=(0.02, -0.095, 0.02))
    back = with_(G, hipr=(-14, 5, 0), hl=(0.05, 0.16, 0.30))
    keys = [(0, G), (4, with_(G, hipr=(-25, 5, 0), chest=(-11, 7, 0))), (8, jab_hit, "snap"), (11, swap), (15, cross, "snap"),
            (19, turn), (23, hook, "snap"), (25, with_(hook, chest=(27, 6, -3))), (33, back, "out"), (48, G)]
    return Clip("Combate_Sequencia", 48, keys, life=0.4)


def soco_corpo():
    """Soco no corpo: dobra os joelhos, inclina para a esquerda e o gancho de esquerda vai na altura da barriga."""
    load = with_(G, hips=(0.04, -0.17, 0.0), hipr=(-30, 10, 6), chest=(-14, 14, 8), hl=(0.12, 0.02, 0.24), el=(0.42, -0.40, 0.0), knee=0.05)
    hit = with_(G, hips=(0.02, -0.16, 0.03), hipr=(14, 10, 2), chest=(20, 12, 2), hl=(-0.08, -0.08, 0.36), el=(0.50, -0.25, 0.25),
                fl=(0.10, 0.17, 0, 10, 20), reach=(8, 0), knee=0.05, hr=(-0.10, 0.18, 0.15))
    after = with_(hit, chest=(23, 12, 2))
    back = with_(G, hips=(0.0, -0.09, 0.0), hl=(0.06, 0.15, 0.28))
    keys = [(0, G), (7, load), (12, hit, "snap"), (14, after), (22, back, "out"), (34, G)]
    return Clip("Combate_Soco_Corpo", 34, keys, life=0.5)


def cotovelada():
    """Cotovelada de direita: o braço dobra junto da orelha e o cotovelo cruza na frente do rosto."""
    load = with_(G, hipr=(-30, 5, 0), chest=(-14, 7, 0), hr=(-0.14, 0.24, 0.08), er=(-0.55, 0.05, -0.20))
    hit = with_(G, hips=(0.0, -0.08, 0.04), hipr=(14, 6, 0), chest=(26, 8, -3), hr=(0.08, 0.22, 0.10), er=(-0.10, 0.20, 0.90),
                reach=(0, 12), sh=(6, 14), fr=(-0.14, -0.15, 0, 26, -15), hl=(0.08, 0.19, 0.16))
    after = with_(hit, chest=(30, 8, -3))
    back = with_(G, hipr=(-17, 4, 0), hr=(-0.10, 0.18, 0.19))
    keys = [(0, G), (6, load), (12, hit, "snap"), (14, after), (22, back, "out"), (33, G)]
    return Clip("Combate_Cotovelada", 33, keys, life=0.5)


def joelhada():
    """Joelhada: agarra a nuca do outro com as duas mãos, puxa para baixo e o joelho de trás sobe."""
    grab = with_(G, hipr=(-8, 4, 0), chest=(0, 8, 0), hl=(0.10, 0.22, 0.42), hr=(-0.10, 0.22, 0.42), el=(0.40, -0.20, 0.30),
                 er=(-0.40, -0.20, 0.30), fing=(0.5, 0.5), sh=(10, 10))
    pull = with_(grab, hl=(0.12, 0.08, 0.38), hr=(-0.12, 0.08, 0.38), chest=(0, 16, 0), fing=(0.9, 0.9))
    knee_up = with_(pull, hips=(0.02, -0.02, 0.07), hipr=(0, -12, 0), chest=(0, 22, 0), hl=(0.12, 0.02, 0.36), hr=(-0.12, 0.02, 0.36),
                    fr=(-0.06, 0.16, 0.46, 50, -5), kr=(-0.05, 0.60, 1.0), fl=(0.10, 0.17, 0, 14, -12))
    after = with_(knee_up, fr=(-0.06, 0.17, 0.48, 50, -5))
    down = with_(G, hipr=(-14, 5, 0), fr=(-0.12, -0.10, 0.08, 20, -35), hl=(0.07, 0.16, 0.32), hr=(-0.09, 0.16, 0.22))
    keys = [(0, G), (6, grab), (10, pull), (15, knee_up, "snap"), (17, after), (24, down, "out"), (34, G)]
    return Clip("Combate_Joelhada", 34, keys, life=0.4)


def chute_frontal():
    """Chute frontal: o joelho de trás sobe, a perna estica e empurra com a sola, o corpo inclina para trás."""
    chamber = with_(G, hips=(-0.02, -0.06, -0.02), hipr=(-10, -4, 0), chest=(-4, -2, 0), fr=(-0.08, 0.08, 0.38, 20, -15),
                    kr=(-0.05, 0.50, 1.0), fl=(0.10, 0.17, 0, 0, -25))
    kick = with_(G, hips=(-0.02, -0.03, 0.06), hipr=(0, -14, 0), chest=(0, -12, 0), fr=(-0.05, 0.80, 0.55, -30, -8),
                 kr=(-0.05, 0.60, 1.0), fl=(0.10, 0.17, 0, 0, -30), hr=(-0.14, 0.10, 0.12), hl=(0.08, 0.18, 0.26))
    after = with_(kick, fr=(-0.05, 0.82, 0.56, -32, -8))
    back = with_(chamber, fr=(-0.10, 0.05, 0.32, 25, -20))
    land = with_(G, fr=(-0.14, -0.14, 0.03, 10, -40))
    keys = [(0, G), (7, chamber), (13, kick, "snap"), (16, after), (23, back, "out"), (30, land), (40, G)]
    return Clip("Combate_Chute_Frontal", 40, keys, life=0.3)


def chute_lateral():
    """Chute lateral: vira de lado, o joelho da frente sobe cruzado e a perna estica com o calcanhar na frente."""
    turn = with_(G, hipr=(-70, 0, -6), chest=(-15, 2, -8), fl=(0.06, 0.10, 0.32, 10, -80), kl=(0.20, 0.35, 0.80),
                 fr=(-0.14, -0.17, 0, 10, -110), hl=(0.08, 0.18, 0.24), hr=(-0.08, 0.20, 0.14))
    kick = with_(turn, hips=(-0.04, -0.04, -0.03), hipr=(-85, 0, -14), chest=(-10, 0, -16), fl=(0.04, 0.78, 0.60, -10, -90, 70),
                 kl=(0.40, 0.70, 0.40), hl=(0.12, 0.10, 0.22))
    after = with_(kick, fl=(0.04, 0.80, 0.61, -10, -90, 70))
    back = with_(turn, fl=(0.08, 0.12, 0.30, 15, -70))
    land = with_(G, fl=(0.10, 0.12, 0.03, 0, -20), hipr=(-35, 4, 0))
    keys = [(0, G), (8, turn), (14, kick, "snap"), (17, after), (25, back, "out"), (32, land), (42, G)]
    return Clip("Combate_Chute_Lateral", 42, keys, life=0.3)


def chute_circular():
    """Chute circular: gira sobre o pé da frente, o quadril vira por cima e a canela de trás acerta de lado, na altura da cintura."""
    lift = with_(G, hipr=(20, 0, 8), chest=(8, 2, 8), fr=(-0.28, 0.02, 0.40, 50, 10, -30), kr=(-0.60, 0.40, 0.40),
                 fl=(0.10, 0.17, 0, 15, 40), hl=(0.08, 0.20, 0.24), hr=(-0.20, -0.10, 0.05))
    # The leg is almost straight when the shin lands, at the height of the other's waist.
    kick = with_(lift, hips=(0.04, -0.04, 0.02), hipr=(80, 0, 26), chest=(10, 0, 22), fr=(0.12, 0.78, 0.66, 60, 80, -60),
                 kr=(0.70, 0.50, 0.40), fl=(0.10, 0.17, 0, 18, 85), hr=(-0.30, -0.25, -0.20))
    after = with_(kick, fr=(0.26, 0.72, 0.64, 60, 95, -60), hipr=(90, 0, 26))
    back = with_(lift, fr=(-0.25, 0.0, 0.35, 40, -20, -20))
    land = with_(G, fr=(-0.14, -0.14, 0.03, 10, -40), fl=(0.10, 0.17, 0, 6, 5))
    keys = [(0, G), (8, lift), (15, kick, "snap"), (18, after), (26, back, "out"), (33, land), (44, G)]
    return Clip("Combate_Chute_Circular", 44, keys, life=0.3)


def chute_baixo():
    """Chute baixo: gira o quadril e a canela de trás acerta a coxa do outro, baixo."""
    load = with_(G, hipr=(-28, 5, 0), chest=(-12, 7, 0), fl=(0.10, 0.20, 0, 6, -5))
    kick = with_(G, hips=(0.03, -0.06, 0.03), hipr=(55, 2, 14), chest=(12, 4, 12), fr=(0.16, 0.64, 0.30, 55, 70, -40),
                 kr=(0.50, 0.40, 0.60), fl=(0.10, 0.20, 0, 14, 50), hr=(-0.24, -0.05, 0.05))
    after = with_(kick, fr=(0.26, 0.58, 0.27, 55, 80, -40))
    back = with_(G, fr=(-0.16, -0.10, 0.10, 25, -40), hipr=(-10, 4, 0))
    keys = [(0, G), (6, load), (13, kick, "snap"), (15, after), (22, back, "out"), (33, G)]
    return Clip("Combate_Chute_Baixo", 33, keys, life=0.3)


def esquiva_pendulo():
    """Esquiva pendular: abaixa para a direita, passa por baixo do golpe e sobe pela esquerda, olhando para a frente."""
    right = with_(G, hips=(-0.07, -0.20, 0.0), hipr=(-28, 14, -10), chest=(-10, 22, -12), knee=0.06,
                  hl=(0.08, 0.20, 0.24), hr=(-0.08, 0.20, 0.15))
    under = with_(G, hips=(0.0, -0.24, 0.02), hipr=(-20, 18, 0), chest=(-6, 26, 0), knee=0.07, hl=(0.07, 0.21, 0.24), hr=(-0.09, 0.21, 0.15))
    left = with_(G, hips=(0.07, -0.18, 0.0), hipr=(-14, 12, 10), chest=(-4, 18, 12), knee=0.06, hl=(0.07, 0.20, 0.25), hr=(-0.09, 0.20, 0.16))
    rise = with_(G, hips=(0.03, -0.09, 0.0), hipr=(-18, 6, 4), chest=(-6, 8, 4))
    keys = [(0, G), (8, right), (14, under), (20, left), (28, rise), (38, G)]
    return Clip("Combate_Esquiva_Pendulo", 38, keys, life=0.4, look=0.9)


def esquiva_tras():
    """Esquiva para trás: o tronco cai para trás de uma vez, o peso vai para a perna de trás, e volta."""
    lean = with_(G, hips=(-0.01, -0.07, -0.07), hipr=(-24, -8, 0), chest=(-8, -22, 0), head=(0, -6, 0),
                 hl=(0.07, 0.22, 0.24), hr=(-0.09, 0.21, 0.13), fl=(0.10, 0.17, 0, 0, -12), fr=(-0.14, -0.17, 0, 0, -45))
    hold = with_(lean, chest=(-8, -24, 0), hips=(-0.01, -0.075, -0.075))
    keys = [(0, G), (5, lean, "snap"), (10, hold), (18, with_(G, hips=(0.0, -0.075, 0.0)), "out"), (28, G)]
    return Clip("Combate_Esquiva_Tras", 28, keys, life=0.4, look=0.6)


def bloqueio():
    """Bloqueio alto: fecha os braços na frente do rosto, abaixa o queixo, segura o impacto e volta."""
    cover = with_(G, hips=(0.0, -0.10, -0.01), hipr=(-14, 8, 0), chest=(-4, 12, 0), head=(0, 14, 0),
                  hl=(0.06, 0.29, 0.17), hr=(-0.06, 0.29, 0.16), el=(0.12, -0.25, 0.70), er=(-0.12, -0.25, 0.70), sh=(16, 16))
    hit = with_(cover, hips=(0.0, -0.11, -0.05), chest=(-4, 4, 0), head=(0, 8, 0), hl=(0.06, 0.29, 0.13), hr=(-0.06, 0.29, 0.12))
    keys = [(0, G), (4, cover, "snap"), (9, hit, "snap"), (14, with_(cover, hips=(0.0, -0.10, 0.0)), "out"), (21, cover), (32, G)]
    return Clip("Combate_Bloqueio", 32, keys, life=0.4, look=0.8)


def empurrao():
    """Empurrão: endireita o corpo, puxa as mãos abertas para o peito e empurra com as duas."""
    load = with_(G, hips=(0.0, -0.08, -0.04), hipr=(-6, 2, 0), chest=(0, 2, 0), hl=(0.16, 0.04, 0.16), hr=(-0.16, 0.04, 0.16),
                 el=(0.40, -0.40, -0.20), er=(-0.40, -0.40, -0.20), fing=(0.15, 0.15))
    push = with_(load, hips=(0.0, -0.08, 0.08), hipr=(0, 6, 0), chest=(0, 10, 0), hl=(0.17, 0.07, 0.54), hr=(-0.17, 0.07, 0.54),
                 reach=(12, 12), fr=(-0.14, -0.15, 0, 24, -40))
    after = with_(push, hl=(0.17, 0.07, 0.52), hr=(-0.17, 0.07, 0.52))
    keys = [(0, G), (7, load), (12, push, "snap"), (15, after), (22, with_(G, fing=(0.6, 0.6)), "out"), (32, G)]
    return Clip("Combate_Empurrao", 32, keys, life=0.4)


def agarrar():
    """Agarrar: avança as mãos abertas, fecha na roupa do outro e puxa para perto, inclinando para trás."""
    reach = with_(G, hips=(0.0, -0.08, 0.06), hipr=(-8, 8, 0), chest=(-2, 12, 0), hl=(0.13, 0.14, 0.50), hr=(-0.13, 0.14, 0.50),
                  el=(0.40, -0.30, 0.10), er=(-0.40, -0.30, 0.10), fing=(0.05, 0.05), reach=(10, 10))
    close = with_(reach, fing=(1, 1), hl=(0.12, 0.13, 0.49), hr=(-0.12, 0.13, 0.49))
    pull = with_(G, hips=(0.0, -0.10, -0.06), hipr=(-10, -4, 0), chest=(-2, -8, 0), hl=(0.12, 0.06, 0.24), hr=(-0.12, 0.06, 0.24),
                 el=(0.40, -0.40, -0.20), er=(-0.40, -0.40, -0.20), fl=(0.10, 0.17, 0, 0, -12))
    keys = [(0, G), (7, reach, "snap"), (11, close), (19, pull), (26, with_(pull, hips=(0.0, -0.095, -0.05))), (40, G)]
    return Clip("Combate_Agarrar", 40, keys, life=0.4)


def martelo():
    """Golpe de martelo: ergue o punho de trás acima da cabeça e desce de uma vez, o corpo junto."""
    raise_ = with_(G, hips=(0.0, -0.04, -0.02), hipr=(-18, -2, 0), chest=(-6, -8, 0), hr=(-0.08, 0.48, 0.06), er=(-0.60, 0.10, -0.10),
                   sh=(6, 18))
    smash = with_(G, hips=(0.0, -0.14, 0.04), hipr=(-6, 10, 0), chest=(6, 24, 0), hr=(-0.03, -0.02, 0.40), er=(-0.50, 0.0, 0.10),
                  fr=(-0.14, -0.15, 0, 20, -35))
    after = with_(smash, hr=(-0.03, -0.05, 0.39), chest=(6, 26, 0))
    keys = [(0, G), (9, raise_), (14, smash, "snap"), (16, after), (24, with_(G, hips=(0.0, -0.09, 0.0)), "out"), (34, G)]
    return Clip("Combate_Martelo", 34, keys, life=0.4)


def dano_rosto():
    """Levar soco no rosto: a cabeça vai para trás e de lado, o corpo cambaleia, o pé de trás recua e volta à guarda."""
    hit = with_(G, hips=(-0.02, -0.07, -0.06), hipr=(-10, -6, 4), chest=(10, -16, 9), head=(36, -30, 14),
                hl=(0.18, 0.08, 0.22), hr=(-0.16, 0.10, 0.08), fing=(0.5, 0.5), sh=(12, 4))
    more = with_(hit, head=(42, -34, 16), chest=(12, -18, 10))
    step = with_(hit, hips=(-0.02, -0.10, -0.09), fr=(-0.16, -0.27, 0.06, 10, -45), head=(18, -10, 6), chest=(2, -4, 3))
    keys = [(0, G), (3, hit, "snap"), (7, more), (14, step), (19, with_(step, fr=(-0.16, -0.27, 0, 6, -45), hips=(-0.02, -0.11, -0.08))),
            (29, with_(G, hips=(0.0, -0.08, -0.04))), (40, G)]
    return Clip("Combate_Dano_Rosto", 40, keys, life=0.6, look=0.0, lag={"head": 0.5})


def dano_barriga():
    """Levar golpe na barriga: o corpo se dobra sobre o golpe, as mãos vão à barriga, respira e volta."""
    hit = with_(G, hips=(0.0, -0.11, -0.08), hipr=(-18, 14, 0), chest=(-6, 30, 0), head=(0, 18, 0),
                hl=(0.08, 0.04, 0.22), hr=(-0.08, 0.03, 0.20), el=(0.30, -0.40, -0.20), er=(-0.30, -0.40, -0.20), fing=(0.6, 0.6), knee=0.05)
    deep = with_(hit, chest=(-6, 36, 0), hips=(0.0, -0.13, -0.09), head=(0, 22, 0), hl=(0.06, -0.18, 0.20), hr=(-0.06, -0.20, 0.18))
    hold = with_(deep, chest=(-6, 32, 2))
    keys = [(0, G), (3, hit, "snap"), (8, deep), (18, hold), (28, with_(G, hips=(0.0, -0.09, -0.03), chest=(-8, 14, 0))), (42, G)]
    return Clip("Combate_Dano_Barriga", 42, keys, life=0.8, look=0.3)


def atordoado():
    """Atordoado: os joelhos amolecem, o corpo balança em círculo, a cabeça pende e os braços caem."""
    base = with_(G, hipr=(-14, 4, 0), chest=(-4, 10, 0), head=(0, 14, 0), hl=(0.18, -0.25, 0.14), hr=(-0.18, -0.27, 0.10),
                 el=(0.30, -0.45, -0.60), er=(-0.30, -0.45, -0.60), fing=(0.4, 0.4), sh=(0, 0), knee=0.05)
    a = with_(base, hips=(0.05, -0.10, 0.02), hipr=(-12, 6, 6), chest=(-2, 12, 8), head=(6, 18, 14))
    b = with_(base, hips=(0.0, -0.12, 0.05), hipr=(-16, 10, 0), chest=(-4, 16, 0), head=(-4, 24, 2))
    c = with_(base, hips=(-0.05, -0.10, 0.01), hipr=(-18, 6, -6), chest=(-6, 12, -8), head=(-8, 16, -14))
    d = with_(base, hips=(0.0, -0.08, -0.03), hipr=(-14, 2, 0), chest=(-4, 6, 0), head=(2, 8, -2))
    keys = [(0, a), (15, b), (30, c), (45, d)]
    return Clip("Combate_Atordoado", 60, keys, loop=True, life=0.8, look=0.0, lag={"head": 3.0, "arms": 2.0})


def provocar():
    """Chamar para a briga: abre a guarda, estende a mão da frente e chama duas vezes com os dedos, queixo para cima."""
    open_ = with_(G, hipr=(-20, 0, 0), chest=(-6, -4, 0), head=(0, -6, 0), hl=(0.10, 0.10, 0.42), el=(0.30, -0.45, 0.10),
                  fing=(0.1, 1), hr=(-0.14, 0.05, 0.12))
    curl = with_(open_, fing=(0.95, 1), hl=(0.10, 0.11, 0.40))
    keys = [(0, G), (8, open_), (16, curl), (22, open_), (30, curl), (36, with_(open_, fing=(0.2, 1))), (50, G)]
    return Clip("Combate_Provocar", 50, keys, life=0.6, look=0.9)


def vitoria():
    """Comemorar vitória: ergue os dois punhos, sacode duas vezes e volta à guarda."""
    up = with_(G, hips=(0.0, -0.02, 0.0), hipr=(-6, -2, 0), chest=(0, -8, 0), head=(0, -14, 0), hl=(0.22, 0.58, 0.06),
               hr=(-0.22, 0.58, 0.06), el=(0.60, -0.10, -0.10), er=(-0.60, -0.10, -0.10), sh=(12, 12), fl=(0.11, 0.08, 0, 0, -8),
               fr=(-0.12, -0.08, 0, 0, -20))
    pump = with_(up, hl=(0.24, 0.50, 0.08), hr=(-0.24, 0.50, 0.08), hips=(0.0, -0.06, 0.0), chest=(0, -4, 0))
    keys = [(0, G), (10, up), (15, pump), (20, up), (25, pump), (30, up), (41, with_(G, hips=(0.0, -0.05, 0.0)), "out"), (52, G)]
    return Clip("Combate_Vitoria", 52, keys, life=0.6, look=0.3)


# --- capoeira ------------------------------------------------------------------------------------

def ginga_poses():
    """
    The base of the ginga, feet wide and knees bent, and the step back: the right leg goes back on a
    diagonal, the body leans over the front knee and the right arm crosses in front of the face while
    the left one opens low to the side.
    """
    base = P(hips=(0.0, -0.15, 0.0), hipr=(0, 10, 0), chest=(0, 10, 0), head=(0, 4, 0),
             fl=(0.26, 0.02, 0, 0, 15), fr=(-0.26, 0.02, 0, 0, -15), knee=0.07,
             hl=(0.22, 0.06, 0.26), hr=(-0.20, -0.06, 0.22), el=(0.40, -0.45, -0.10), er=(-0.40, -0.45, -0.10), fing=(0.35, 0.35))
    back = with_(base, hips=(0.0, -0.21, -0.12), hipr=(-28, 20, 0), chest=(-8, 22, 0), head=(0, 4, 0),
                 fr=(-0.12, -0.52, 0, 14, -25), fl=(0.22, 0.04, 0, 0, 5),
                 hr=(0.10, 0.27, 0.24), er=(-0.25, -0.35, 0.50), hl=(0.38, -0.12, -0.02), el=(0.50, -0.30, -0.30))
    return base, back


def ginga():
    """Ginga: da base, uma perna vai para trás na diagonal com o braço do mesmo lado protegendo o rosto, volta e troca."""
    base, back = ginga_poses()
    # The foot that goes back lifts a little on the way, and again on the way back.
    out = with_(blend_feet(base, back), fr=(-0.19, -0.25, 0.07, 15, -20))
    home = with_(out, fl=(0.24, 0.03, 0, 0, 10))
    keys = [(0, base), (6, out), (12, back), (18, home), (24, mirror(base)), (30, mirror(out)), (36, mirror(back)), (42, mirror(home))]
    return Clip("Capoeira_Ginga", 48, keys, loop=True, life=0.6, look=0.5)


def blend_feet(a, b):
    out = dict(a)
    for name in ("hips", "hipr", "chest", "hl", "hr", "el", "er"):
        out[name] = tuple((p + q) / 2 for p, q in zip(a[name], b[name]))
    return out


def meia_lua():
    """
    Meia-lua de frente: da ginga, a perna de trás passa esticada num arco por fora, cruza na frente do
    rosto do outro e volta para a base. O peso fica na perna da frente e o tronco se afasta do chute.
    """
    base, back = ginga_poses()
    # The hands come up to cover the face while the leg steps back, instead of crossing as in the ginga.
    guard = dict(hl=(0.12, 0.22, 0.26), hr=(-0.10, 0.24, 0.22), el=(0.30, -0.40, 0.20), er=(-0.30, -0.40, 0.20), fing=(0.6, 0.6))
    back = with_(back, **guard)
    step = with_(blend_feet(base, back), fr=(-0.19, -0.25, 0.07, 15, -20))
    # The kicking hip, with the weight on the left foot, is near (-0.04, 0.85, 0); the foot goes round
    # it at 0.76 m, a leg almost straight: out to the right, in front, across to the left.
    wind = with_(back, hips=(0.05, -0.10, -0.04), hipr=(-20, 4, 6), chest=(-4, 4, 8), fl=(0.22, 0.04, 0, 0, 15))
    out_ = with_(wind, hips=(0.06, -0.08, 0.0), hipr=(-6, -4, 12), chest=(0, -6, 12), fr=(-0.66, 0.43, 0.68, -10, -40),
                 kr=(-0.20, 0.90, 0.30), fl=(0.22, 0.04, 0, 6, 25))
    top = with_(out_, hipr=(8, -8, 14), chest=(4, -8, 14), fr=(-0.04, 0.76, 0.80, -10, 0), kr=(0.0, 0.90, 0.40))
    across = with_(top, hipr=(22, -6, 12), chest=(8, -6, 12), fr=(0.54, 0.49, 0.66, -10, 40), kr=(0.20, 0.90, 0.30), fl=(0.22, 0.04, 0, 8, 35))
    down = with_(blend_feet(base, across), fr=(-0.14, 0.12, 0.14, 10, -10), fl=(0.24, 0.03, 0, 0, 20))
    # The leg swings round in one long, even arc: a whip into the first key would snap it.
    keys = [(0, base), (5, step), (10, back), (15, wind), (23, out_), (27, top), (31, across), (39, down, "out"), (50, base)]
    return Clip("Capoeira_Meia_Lua", 50, keys, life=0.4, look=0.6)


MOVES = [guarda, jab, direto, gancho, uppercut, um_dois, sequencia, soco_corpo, cotovelada, joelhada,
         chute_frontal, chute_lateral, chute_circular, chute_baixo, esquiva_pendulo, esquiva_tras, bloqueio,
         empurrao, agarrar, martelo, dano_rosto, dano_barriga, atordoado, provocar, vitoria, ginga, meia_lua]


def show_frames(clip, count=8):
    """Frames to look at: spread over the clip, and every key."""
    frames = sorted(set([round(i * clip.end / count) for i in range(count)] + [t for t in clip.times if t < clip.end]))
    return frames[:12]


poser.hands = 1.0
poser.load(SOURCE)
poser.add_constraints()
poser.calibrate_all()
made = []
for build in MOVES:
    clip = build()
    if ONLY and clip.name not in ONLY:
        continue
    action = make(clip)
    made.append(action)
    if PREVIEW:
        os.makedirs(PREVIEW, exist_ok=True)
        frames = show_frames(clip)
        print("   prévia nos quadros", frames)
        poser.preview(action, frames, os.path.join(PREVIEW, clip.name + ".png"))
poser.export(OUT, made)
