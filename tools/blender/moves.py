# Shared by make_combat.py and make_activities.py: clips made of a few key poses (see poser.py for
# what a pose says) on frames at 30 per second, eased into each other the way bodies move, so they
# look alive instead of robotic:
#
# - Between keys every value follows a smooth curve that keeps its speed through a key, and only
#   stops where it turns back (a monotone cubic). A blow instead speeds up into its key ("snap"),
#   arriving half again as fast as its average, and stops there, as a fist does on a target; a
#   recoil leaves fast and slows down ("out"); "lin" goes at an even pace.
# - Body parts do not move together: the hips lead, the chest follows, the arms come after and the
#   head arrives last, a frame or two each, as the weight goes from the legs up to the hands.
# - Nothing is ever still: breath moves the chest, the head and the hands drift a little, in waves
#   that come back to nothing at the first and last frames.
# - The head can keep looking ahead while the body turns, as a fighter keeps the eyes on the opponent.
#
# run() makes the clips, can render previews of them with --previa <folder>, and exports them.

import math
import os
import sys

import poser
from poser import apply, bake, clear_animation, finish_curves, key

# Every value of a pose, in order, with how many numbers it has and the body part it belongs to.
SCHEMA = [
    ("hips", 3, "hips"), ("hipr", 3, "hips"),
    ("chest", 3, "chest"), ("sh", 2, "chest"), ("reach", 2, "chest"),
    ("head", 3, "head"),
    ("hl", 3, "arms"), ("hr", 3, "arms"), ("el", 3, "arms"), ("er", 3, "arms"), ("fing", 2, "arms"), ("point", 2, "arms"),
    ("fl", 6, "legs"), ("fr", 6, "legs"), ("knee", 1, "legs"), ("kl", 3, "legs"), ("kr", 3, "legs"), ("kw", 2, "legs"),
]
# How many frames each part comes after the moment of a key: the hips lead and the head comes last.
LAG = {"hips": -1.5, "chest": -0.5, "arms": 0.0, "head": 1.5, "legs": 0.0}


def flatten(pose, hands=1.0):
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
            value = (hands, hands)
        elif name in ("reach", "point") and value is None:
            value = (0.0, 0.0)
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


class Clip:
    """
    A clip: its name, its length in frames, its keys as (frame, pose) or (frame, pose, ease), and how
    it moves. `life` scales breath and drift; `look` is how much the head turns back toward the
    front while the body turns, and `rest_look` how much at the first and last frames of a move that
    happens once; `hands` is how closed the hands are where a pose does not say.
    """

    def __init__(self, name, end, keys, loop=False, lag=None, life=0.6, look=0.0, rest_look=None, hands=1.0):
        self.name, self.end, self.loop, self.life, self.look = name, end, loop, life, look
        self.rest_look = look if rest_look is None else rest_look
        keys = sorted(keys, key=lambda k: k[0])
        self.keys = [(k[0], unflatten(flatten(k[1], hands))) for k in keys]
        self.times = [k[0] for k in keys]
        self.eases = [k[2] if len(k) > 2 else "smooth" for k in keys]
        rows = [flatten(k[1], hands) for k in keys]
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
        together = 1.0 if self.loop else min(1.0, frame / 4.0, (self.end - frame) / 4.0)
        look = self.rest_look + (self.look - self.rest_look) * together
        turned = pose["hipr"][0] + pose["chest"][0]
        pose["head"] = (yaw - look * turned + 1.5 * life * self.wave(frame, cycles, 0.7),
                        pitch + 1.0 * life * self.wave(frame, cycles + 1, 2.1), roll + 0.8 * life * self.wave(frame, cycles, 4.0))
        for side, phase in (("hl", 0.0), ("hr", 2.4)):
            x, y, z = pose[side]
            pose[side] = (x + 0.006 * life * self.wave(frame, cycles, phase), y + 0.008 * life * self.wave(frame, cycles + 1, phase + 1.3), z)


def out_of_reach(clip):
    """
    Keys whose hands are farther from the shoulder than the arm reaches: the arm would go straight and
    the hand stop short, so a circle or a blow would come out smaller than asked. Hands are measured
    from the chest, as poses give them.
    """
    chest = poser.REST["spine_03"].to_translation()
    found = []
    for side in "lr":
        shoulder = poser.REST[f"upperarm_{side}"].to_translation()
        elbow = poser.REST[f"lowerarm_{side}"].to_translation()
        wrist = poser.REST[f"hand_{side}"].to_translation()
        reach = 1.03 * ((elbow - shoulder).length + (wrist - elbow).length)
        offset = shoulder - chest
        x0, y0, z0 = offset.x, offset.z, -offset.y
        for time, pose in clip.keys:
            x, y, z = pose[f"h{side}"]
            distance = math.sqrt((x - x0) ** 2 + (y - y0) ** 2 + (z - z0) ** 2)
            if distance > reach:
                found.append(f"quadro {time}: mão {'esquerda' if side == 'l' else 'direita'} a {distance:.2f} m do ombro, o braço alcança {reach:.2f}")
    return found


def make(clip):
    """Poses every frame of a clip, bakes it into bone rotations and keeps it as an action."""
    print(f"== {clip.name}")
    for problem in out_of_reach(clip):
        print(f"   fora do alcance, {problem}")
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


def blend(a, b, t=0.5, names=None):
    """A pose between two others; only the values named, if any, the rest from the first."""
    out = dict(a)
    for name in names or [n for n, _, _ in SCHEMA]:
        x, y = a.get(name), b.get(name)
        if x is None or y is None:
            continue
        out[name] = x + (y - x) * t if not isinstance(x, tuple) else tuple(p + (q - p) * t for p, q in zip(x, y))
    return out


def show_frames(clip, count=8):
    """Frames to look at: spread over the clip, and every key."""
    frames = sorted(set([round(i * clip.end / count) for i in range(count)] + [round(t) for t in clip.times if round(t) < clip.end]))
    return frames[:12]


def arguments():
    """<human-base-animations.glb> <out.glb> [clip,clip,...] [--previa <folder>], from the command line."""
    args = sys.argv[sys.argv.index("--") + 1:]
    preview = None
    if "--previa" in args:
        preview = args[args.index("--previa") + 1]
        args = args[:args.index("--previa")]
    only = set(args[2].split(",")) if len(args) > 2 and args[2] else None
    return args[0], args[1], only, preview


def run(builders, hands=1.0):
    """Makes every clip the builders return, renders previews when asked, and exports them."""
    source, out, only, preview = arguments()
    poser.hands = hands
    poser.load(source)
    poser.add_constraints()
    poser.calibrate_all()
    made = []
    for build in builders:
        clip = build()
        if only and clip.name not in only:
            continue
        action = make(clip)
        made.append(action)
        if preview:
            os.makedirs(preview, exist_ok=True)
            frames = show_frames(clip)
            print("   prévia nos quadros", frames)
            poser.preview(action, frames, os.path.join(preview, clip.name + ".png"))
    poser.export(out, made)
