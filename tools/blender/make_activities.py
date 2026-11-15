# Makes the editor's own everyday animations (driving, riding, chores, sports, gestures and music) on
# the Mesh2Motion human skeleton and exports them as a GLB that scripts/import-animations.ts adds to
# the animation pack.
#
#   blender --factory-startup -b --python tools/blender/make_activities.py -- <human-base-animations.glb> <atividades.glb> [clip,clip,...] [--previa <folder>]
#
# Every clip is a few key poses (see poser.py) eased by moves.py so it does not look robotic. Seats,
# saddles, wheels and handlebars are where they are in real life, so a person put on a vehicle of
# the editor sits on it: a car seat 40 cm over its floor, a motorcycle seat about 85 cm and its foot
# pegs 35 cm off the ground, the rider's hips 1.4 m up on a horse with the stirrups at 80 cm. Things held (a wheel, a
# broom, a paddle) are not there; the hands hold them in the air, so any object can be put in them.
#
# Character space: meters, x to the character's left, y up, z forward. Hips are given from where
# they stand at rest (0.917 m up). Hands are from the chest and turn with it. Angles in degrees.

import math
import os
import sys

script = globals().get("__file__") or sys.argv[sys.argv.index("--python") + 1]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))

import moves  # noqa: E402
from moves import blend, with_  # noqa: E402
from poser import P, mirror  # noqa: E402

PELVIS = 0.917
ANKLE = 0.104


def Clip(name, end, keys, **options):
    """An everyday clip: hands at ease where a pose does not say, the head following the body."""
    return moves.Clip(name, end, keys, hands=0.45, **options)


def at_height(y):
    """The hips offset that puts the hip joint `y` meters over the ground."""
    return y - PELVIS


def lifted(y):
    """How far to lift an ankle so it is `y` meters over the ground."""
    return y - ANKLE


def ring(center, radius, angle, tilt=0.0):
    """
    A point on a circle that faces the character: a steering wheel, a pedal path. The angle starts at
    the character's left and goes up; the circle leans back by `tilt` degrees from upright.
    """
    a, t = math.radians(angle), math.radians(tilt)
    up = (0.0, math.cos(t), -math.sin(t))
    x = center[0] + radius * math.cos(a)
    y = center[1] + radius * math.sin(a) * up[1]
    z = center[2] + radius * math.sin(a) * up[2]
    return (x, y, z)


# Standing at ease: weight even, arms hanging, hands loose.
S = P(hips=(0.0, -0.02, 0.0), fl=(0.11, 0.0, 0, 0, 8), fr=(-0.11, 0.0, 0, 0, -8), hl=(0.22, -0.40, 0.06), hr=(-0.22, -0.40, 0.06), fing=(0.45, 0.45))


# --- vehicles and riding -------------------------------------------------------------------------

def wheel(theta, center=(0.0, -0.03, 0.32), radius=0.17, tilt=20, grip=30):
    """Both hands on a steering wheel turned `theta` degrees to the left, at ten to two."""
    return dict(hl=ring(center, radius, grip - theta, tilt), hr=ring(center, radius, 180 - grip - theta, tilt))


def car_seat(**changes):
    """In a car's driving seat: hips 40 cm over the floor, back reclined, feet on the pedals."""
    pose = P(hips=(0.0, at_height(0.40), -0.06), hipr=(0, -16, 0), chest=(0, 8, 0), head=(0, 6, 0),
             fl=(0.13, 0.60, 0.02, -12, 6), fr=(-0.15, 0.64, 0.05, -22, -6), kl=(0.20, 0.60, 0.60), kr=(-0.20, 0.60, 0.60),
             el=(0.40, -0.50, 0.10), er=(-0.40, -0.50, 0.10), fing=(0.8, 0.8), **wheel(0))
    pose.update(changes)
    return pose


def carro_dirigindo():
    """Carro: dirigindo. Pequenas correções no volante, olha os retrovisores e volta para a estrada."""
    a = car_seat()
    b = car_seat(head=(4, 6, 0), **wheel(6))
    mirror_left = car_seat(head=(38, 8, 2), **wheel(2))
    c = car_seat(head=(-3, 5, 0), **wheel(-5))
    mirror_inside = car_seat(head=(-22, -4, 0), **wheel(-2))
    keys = [(0, a), (18, b), (34, mirror_left), (46, b), (60, c), (74, mirror_inside), (84, a), (100, c)]
    return Clip("Carro_Dirigindo", 110, keys, loop=True, life=0.8)


def carro_curvas():
    """Carro: fazendo curvas. Vira o volante para a esquerda, segura a curva, endireita e faz o mesmo para a direita."""
    straight = car_seat()
    left = car_seat(hips=(-0.02, at_height(0.40), -0.06), chest=(-4, 8, -6), head=(18, 6, -4), **wheel(85))
    right = car_seat(hips=(0.02, at_height(0.40), -0.06), chest=(4, 8, 6), head=(-18, 6, 4), **wheel(-85))
    keys = [(0, straight), (16, left), (40, with_(left, **wheel(80))), (56, straight), (72, right), (96, with_(right, **wheel(-80))), (112, straight)]
    return Clip("Carro_Curvas", 128, keys, loop=True, life=0.6)


def kart_pilotando():
    """Kart: pilotando. Sentado quase no chão, pernas esticadas, volante pequeno e correções rápidas."""
    seat = P(hips=(0.0, at_height(0.20), -0.10), hipr=(0, -24, 0), chest=(0, 12, 0), head=(0, 10, 0),
             fl=(0.12, 0.74, lifted(0.18), -30, 4), fr=(-0.12, 0.74, lifted(0.18), -30, -4), kl=(0.20, 0.60, 0.70), kr=(-0.20, 0.60, 0.70),
             el=(0.40, -0.45, 0.0), er=(-0.40, -0.45, 0.0), fing=(0.85, 0.85))
    turn = lambda theta, lean, look: with_(seat, chest=(0, 12, lean), head=(look, 10, lean / 2),
                                           **wheel(theta, center=(0.0, -0.10, 0.34), radius=0.13, tilt=40))
    keys = [(0, turn(0, 0, 0)), (10, turn(25, -6, 12)), (20, turn(10, -3, 6)), (30, turn(-20, 5, -10)), (42, turn(-30, 7, -14)), (52, turn(-5, 1, 0))]
    return Clip("Kart_Pilotando", 60, keys, loop=True, life=0.5)


def moto_pose(lean=0.0, look=0.0, crouch=0.0):
    """Astride a motorcycle: seat 85 cm up, feet on the pegs, chest down over the tank, hands on the bars."""
    return P(hips=(0.0, at_height(0.88), -0.05), hipr=(0, 24 + crouch, lean), chest=(0, 14 + crouch, lean / 2), head=(look, -22 - crouch, 0),
             fl=(0.17, -0.12, lifted(0.36), 20, 6), fr=(-0.17, -0.12, lifted(0.36), 20, -6), kl=(0.10, 0.20, 0.90), kr=(-0.10, 0.20, 0.90),
             hl=(0.29, 0.0, 0.32), hr=(-0.29, 0.0, 0.32), el=(0.50, -0.30, 0.0), er=(-0.50, -0.30, 0.0), fing=(0.85, 0.85))


def moto_pilotando():
    """Moto: pilotando. Debruçado sobre o tanque, o corpo acompanha a moto nas curvas suaves e a cabeça olha à frente."""
    keys = [(0, moto_pose()), (20, moto_pose(lean=8, look=6)), (40, moto_pose(crouch=6)), (60, moto_pose(lean=-8, look=-6)), (80, moto_pose())]
    return Clip("Moto_Pilotando", 90, keys, loop=True, life=0.6)


def bicicleta_pedalando():
    """Bicicleta: pedalando. Os pés giram com os pedais, o joelho sobe e desce, o quadril balança de leve."""
    keys = []
    steps = 8
    for k in range(steps):
        phase = 360.0 * k / steps
        pose = P(hips=(0.0, at_height(0.95), 0.0), hipr=(0, 20, 2.5 * math.sin(math.radians(phase))), chest=(0, 12, -1.5 * math.sin(math.radians(phase))),
                 head=(0, -14, 0), hl=(0.25, -0.04, 0.36), hr=(-0.25, -0.04, 0.36), el=(0.45, -0.40, 0.0), er=(-0.45, -0.40, 0.0),
                 fing=(0.8, 0.8), kl=(0.12, 0.30, 1.0), kr=(-0.12, 0.30, 1.0))
        for side, x, offset in (("fr", -0.12, 0.0), ("fl", 0.12, 180.0)):
            a = math.radians(phase + offset)
            # The pedal goes round a crank 30 cm up and 22 cm ahead of the seat; the ankle rides 7 cm above it.
            z = 0.22 + 0.17 * math.sin(a)
            y = 0.30 + 0.17 * math.cos(a) + 0.07
            pose[side] = (x, z, lifted(y), 12 + 14 * math.sin(a), 0)
        keys.append((30.0 * k / steps, pose))
    return Clip("Bicicleta_Pedalando", 30, keys, loop=True, life=0.4)


def saddle(rise=0.0, forward=0.0, lean=0.0, reins=0.0, look=0.0, sway=0.0):
    """
    On a horse: the hips 1.4 m up on the saddle, the legs round the horse's barrel and the feet in the
    stirrups 60 cm lower, knees a little bent, reins in front of the saddle.
    """
    return P(hips=(sway, at_height(1.40) + rise, forward), hipr=(0, 4 + lean, sway * 60), chest=(0, 2 + lean / 2, -sway * 40), head=(look, -lean / 2, 0),
             fl=(0.27, 0.06, lifted(0.80), 12, 10), fr=(-0.27, 0.06, lifted(0.80), 12, -10), kl=(0.45, -0.10, 0.60), kr=(-0.45, -0.10, 0.60),
             hl=(0.10, -0.22 - rise, 0.24 + 0.6 * reins), hr=(-0.10, -0.22 - rise, 0.24 + 0.6 * reins), el=(0.30, -0.45, -0.10), er=(-0.30, -0.45, -0.10),
             fing=(0.8, 0.8))


def cavalo_parado():
    """Cavalo: montado, parado. O cavalo muda o peso de pata, o cavaleiro balança junto e olha em volta."""
    keys = [(0, saddle()), (25, saddle(sway=0.015, look=20)), (50, saddle(lean=3, reins=0.03)), (75, saddle(sway=-0.015, look=-25)), (100, saddle(reins=-0.02))]
    return Clip("Cavalo_Parado", 120, keys, loop=True, life=0.9)


def cavalo_trote():
    """Cavalo: trote. O cavaleiro levanta do arreio a cada passada e senta de novo, mãos firmes nas rédeas."""
    down = saddle(lean=8)
    up = saddle(rise=0.07, forward=0.05, lean=14)
    # Two strides, the second a little different, so the loop does not look mechanical.
    keys = [(0, down), (10, up), (20, saddle(lean=9, sway=0.006)), (30, saddle(rise=0.065, forward=0.045, lean=13, sway=0.004))]
    return Clip("Cavalo_Trote", 40, keys, loop=True, life=0.3)


def cavalo_galope():
    """Cavalo: galope. Inclinado para a frente, o corpo balança com o cavalo e as mãos acompanham o pescoço dele."""
    a = saddle(rise=0.03, forward=0.0, lean=24, reins=0.08)
    b = saddle(rise=0.06, forward=0.05, lean=30, reins=0.14)
    c = saddle(rise=0.02, forward=-0.03, lean=20, reins=0.06)
    # Two strides, the second a little different, so the loop does not look mechanical.
    keys = [(0, a), (6, b), (12, c), (18, saddle(rise=0.035, lean=25, reins=0.09, sway=0.006)), (24, saddle(rise=0.065, forward=0.045, lean=31, reins=0.15)),
            (30, saddle(rise=0.02, forward=-0.025, lean=21, reins=0.07, sway=-0.004))]
    return Clip("Cavalo_Galope", 36, keys, loop=True, life=0.3, look=0.0)


def canoa_remando():
    """Canoa: remando. Sentado, o remo entra à frente de um lado, puxa até o quadril, troca de lado e repete."""
    seat = P(hips=(0.0, at_height(0.30), 0.0), hipr=(0, -4, 0), chest=(0, 10, 0), head=(0, 4, 0),
             fl=(0.16, 0.50, 0, -10, 10), fr=(-0.16, 0.50, 0, -10, -10), kl=(0.25, 0.70, 0.50), kr=(-0.25, 0.70, 0.50), fing=(0.85, 0.85))
    catch = with_(seat, hipr=(24, -2, 0), chest=(16, 16, -4), hr=(-0.25, -0.20, 0.32), hl=(-0.02, 0.16, 0.28),
                  er=(-0.45, -0.30, 0.0), el=(0.30, -0.20, 0.20))
    pull = with_(seat, hipr=(-14, -6, 0), chest=(-12, 4, 4), hr=(-0.34, -0.32, -0.05), hl=(0.06, 0.14, 0.38),
                 er=(-0.45, -0.30, -0.30), el=(0.30, -0.20, 0.20))
    swap = with_(seat, hr=(-0.10, 0.0, 0.30), hl=(0.10, 0.05, 0.30))
    keys = [(0, catch), (16, pull, "smooth"), (26, swap), (36, mirror(catch)), (52, mirror(pull)), (62, mirror(swap))]
    return Clip("Canoa_Remando", 72, keys, loop=True, life=0.4)


def skate_impulsionando():
    """Skate: impulsionando. O pé da frente fica na prancha, o de trás empurra o chão e volta, o joelho da frente dobra."""
    board = (0.02, 0.10, lifted(0.21), 0, -15)
    base = P(hipr=(-10, 8, 0), chest=(-4, 6, 0), hl=(0.26, -0.36, 0.10), hr=(-0.26, -0.36, 0.06), fl=board)
    touch = with_(base, hips=(-0.02, -0.11, 0.02), fr=(-0.18, 0.02, 0, 0, -5), hl=(0.25, -0.33, 0.16), hr=(-0.25, -0.38, -0.02))
    push = with_(base, hips=(-0.02, -0.10, -0.03), chest=(-4, 10, 0), fr=(-0.18, -0.42, 0, 25, -5), hl=(0.25, -0.38, -0.04), hr=(-0.24, -0.32, 0.18))
    lift = with_(base, hips=(0.0, -0.02, 0.0), fr=(-0.16, -0.30, 0.12, 30, -5))
    swing = with_(base, hips=(0.0, -0.03, 0.01), fr=(-0.16, -0.05, 0.10, 10, -5))
    keys = [(0, touch), (10, push, "lin"), (16, lift), (26, swing), (36, touch)]
    return Clip("Skate_Impulsionando", 40, keys, loop=True, life=0.4)


# --- chores --------------------------------------------------------------------------------------

def varrer():
    """Varrer: segura a vassoura com uma mão no alto e outra embaixo e varre de um lado para o outro."""
    stand = with_(S, fl=(0.14, 0.12, 0, 0, 10), fr=(-0.14, -0.10, 0, 0, -10), chest=(0, 16, 0), head=(0, 18, 0), knee=0.03)
    right = with_(stand, hipr=(-10, 6, 0), chest=(-14, 18, 0), hl=(-0.02, -0.10, 0.26), hr=(-0.14, -0.28, 0.22), fing=(0.8, 0.8))
    left = with_(stand, hipr=(8, 6, 0), chest=(14, 18, 0), hl=(0.14, -0.08, 0.24), hr=(0.02, -0.26, 0.22), fing=(0.8, 0.8))
    back = with_(right, hl=(-0.02, -0.05, 0.26), hr=(-0.12, -0.26, 0.22))
    # The stroke sweeps from right to left; the broom comes back a little lifted.
    keys = [(0, right), (14, left), (25, back), (39, left)]
    return Clip("Varrer", 50, keys, loop=True, life=0.5)


def martelar():
    """Martelar: segura o prego com a mão esquerda e bate duas vezes com o martelo na bancada."""
    stand = with_(S, fl=(0.14, 0.10, 0, 0, 10), fr=(-0.14, -0.08, 0, 0, -10), chest=(-6, 20, 0), head=(0, 22, 0),
                  hl=(0.10, -0.26, 0.26), el=(0.35, -0.40, -0.10), fing=(0.7, 0.9))
    hit = with_(stand, hr=(-0.04, -0.24, 0.26), er=(-0.40, -0.40, -0.10))
    up = with_(stand, chest=(-8, 16, 0), hr=(-0.14, 0.02, 0.20), er=(-0.50, 0.0, -0.20), sh=(0, 6))
    keys = [(0, hit, "snap"), (9, up), (15, hit, "snap"), (24, up)]
    return Clip("Martelar", 30, keys, loop=True, life=0.4, lag={"head": 0.5})


def serrar():
    """Serrar: a mão esquerda firma a madeira e a direita leva o serrote para a frente e para trás."""
    stand = with_(S, fl=(0.16, 0.14, 0, 0, 5), fr=(-0.16, -0.14, 0, 0, -20), hipr=(-8, 10, 0), chest=(-8, 18, 0), head=(0, 22, 0),
                  hl=(0.16, -0.26, 0.26), el=(0.40, -0.45, -0.10), fing=(0.6, 0.9))
    back = with_(stand, hr=(-0.14, -0.24, 0.06), er=(-0.40, -0.40, -0.30), hips=(0.0, -0.05, -0.02))
    forth = with_(stand, hr=(-0.10, -0.24, 0.32), er=(-0.40, -0.30, 0.0), hips=(0.0, -0.06, 0.03), reach=(0, 8))
    keys = [(0, back), (12, forth, "lin"), (24, back), (36, forth, "lin")]
    return Clip("Serrar", 48, keys, loop=True, life=0.4)


def cavar():
    """Cavar com pá: enfia a pá no chão com o pé, levanta a terra e joga para o lado esquerdo."""
    ready = with_(S, fl=(0.16, 0.12, 0, 0, 10), fr=(-0.12, -0.05, 0, 0, -10), chest=(0, 20, 0), head=(0, 20, 0),
                  hl=(0.06, -0.14, 0.22), hr=(-0.08, -0.28, 0.24), fing=(0.85, 0.85), knee=0.03)
    step = with_(ready, hips=(-0.03, 0.02, 0.03), fr=(-0.06, 0.32, lifted(0.22), 0, -5), hr=(-0.08, -0.30, 0.26), hl=(0.06, -0.14, 0.24))
    scoop = with_(ready, hips=(0.0, -0.30, -0.08), hipr=(0, 22, 0), chest=(0, 38, 0), hl=(0.08, -0.20, 0.18), hr=(-0.08, -0.30, 0.22), knee=0.06)
    lift = with_(ready, hips=(0.0, -0.06, -0.02), chest=(0, 12, 0), hl=(0.06, -0.10, 0.16), hr=(-0.04, -0.20, 0.30))
    toss = with_(lift, hipr=(30, 6, 0), chest=(28, 10, 4), head=(30, 10, 0), hl=(0.18, -0.10, 0.14), hr=(0.04, -0.12, 0.32))
    keys = [(0, ready), (12, step), (22, scoop), (38, lift), (48, toss, "snap"), (52, with_(toss, hr=(0.06, -0.12, 0.34))), (64, ready)]
    return Clip("Cavar", 76, keys, loop=True, life=0.5)


# Holding a fishing rod out in front, the right hand on the grip and the left one below it.
ROD = with_(S, fl=(0.14, 0.12, 0, 0, 10), fr=(-0.14, -0.10, 0, 0, -15), hipr=(-6, 2, 0), hr=(-0.10, -0.16, 0.32), hl=(0.0, -0.26, 0.26),
            er=(-0.40, -0.45, -0.10), el=(0.35, -0.45, -0.10), fing=(0.9, 0.85))


def pescar_lancar():
    """Pescar: lançar. Leva a vara para trás do ombro direito e lança para a frente com um estalo, depois volta a segurar."""
    back = with_(ROD, hipr=(-18, -4, 0), chest=(-12, -8, 0), head=(0, -6, 0), hr=(-0.18, 0.40, -0.06), hl=(-0.06, 0.24, 0.02),
                 er=(-0.65, 0.10, -0.20), el=(0.20, -0.10, 0.20))
    cast = with_(ROD, hipr=(4, 8, 0), chest=(6, 12, 0), hr=(-0.06, 0.16, 0.48), hl=(0.02, 0.02, 0.40), head=(0, -4, 0), er=(-0.60, 0.10, -0.10))
    follow = with_(ROD, hipr=(2, 6, 0), chest=(4, 10, 0), hr=(-0.08, -0.06, 0.40), hl=(0.0, -0.16, 0.34), head=(0, -2, 0), er=(-0.55, -0.25, -0.10))
    keys = [(0, ROD), (14, back), (20, back), (26, cast, "snap"), (31, follow, "out"), (48, ROD)]
    return Clip("Pescar_Lancar", 54, keys, life=0.5)


def pescar_esperando():
    """Pescar: esperando. Segura a vara, muda o peso de perna, olha a linha e dá um puxão de leve."""
    lean_left = with_(ROD, hips=(0.03, -0.02, 0.0), head=(6, 4, 2))
    lean_right = with_(ROD, hips=(-0.03, -0.02, 0.0), head=(-10, 0, -2))
    tug = with_(ROD, hr=(-0.10, -0.08, 0.30), hl=(0.0, -0.20, 0.25), head=(0, 10, 0))
    keys = [(0, ROD), (30, lean_left), (52, lean_left), (58, tug, "snap"), (66, ROD), (96, lean_right)]
    return Clip("Pescar_Esperando", 120, keys, loop=True, life=1.0)


def cozinhar():
    """Cozinhar: a mão esquerda segura o cabo da panela e a direita mexe com a colher em círculos, olhando a comida."""
    stove = with_(S, chest=(4, 16, 0), head=(4, 26, 0), hl=(0.20, -0.24, 0.24), el=(0.40, -0.45, -0.10), fing=(0.85, 0.9))
    keys = []
    for k in range(8):
        a = 2 * math.pi * k / 8
        keys.append((5 * k, with_(stove, hr=(-0.06 + 0.05 * math.cos(a), -0.22, 0.24 + 0.05 * math.sin(a)), er=(-0.40, -0.40, -0.10))))
    return Clip("Cozinhar", 40, keys, loop=True, life=0.6)


# Seated on a chair: hips 55 cm up, thighs flat, feet on the floor.
CHAIR = P(hips=(0.0, at_height(0.55), -0.04), hipr=(0, -4, 0), chest=(0, 8, 0), fl=(0.13, 0.42, 0, 0, 6), fr=(-0.13, 0.42, 0, 0, -6),
          kl=(0.15, 0.50, 0.80), kr=(-0.15, 0.50, 0.80))


def digitar():
    """Digitar: sentado à mesa, as mãos no teclado, os dedos batem nas teclas e às vezes para para ler a tela."""
    desk = with_(CHAIR, chest=(0, 10, 0), head=(0, 6, 0), el=(0.35, -0.50, -0.10), er=(-0.35, -0.50, -0.10))
    tap = lambda l, r, dx: with_(desk, hl=(0.12 + dx, -0.20, 0.36), hr=(-0.12 + dx, -0.20, 0.36), fing=(l, r), point=(1 - l, 1 - r))
    read = with_(desk, hl=(0.13, -0.19, 0.33), hr=(-0.13, -0.19, 0.33), fing=(0.35, 0.35), head=(4, 2, 0), chest=(0, 6, 0))
    keys = [(0, tap(0.3, 0.6, 0.0)), (4, tap(0.6, 0.3, 0.01)), (8, tap(0.35, 0.65, 0.0)), (12, tap(0.6, 0.25, -0.01)), (16, tap(0.3, 0.6, 0.0)),
            (20, tap(0.65, 0.35, 0.01)), (26, read), (44, read), (50, tap(0.3, 0.6, 0.0)), (54, tap(0.6, 0.3, -0.01))]
    return Clip("Digitar", 60, keys, loop=True, life=0.6)


def celular():
    """Mexer no celular: de pé, cabeça baixa, segura o celular com as duas mãos e desliza a tela com o polegar."""
    hold = with_(S, chest=(0, 10, 0), head=(0, 30, 0), hl=(0.04, -0.12, 0.24), hr=(-0.04, -0.12, 0.24),
                 el=(0.30, -0.50, -0.10), er=(-0.30, -0.50, -0.10), fing=(0.5, 0.5))
    scroll = with_(hold, hr=(-0.04, -0.09, 0.25), fing=(0.5, 0.7))
    shift = with_(hold, hips=(0.03, -0.02, 0.0), head=(6, 28, 3))
    keys = [(0, hold), (12, scroll), (18, hold), (34, scroll), (40, hold), (70, shift), (86, with_(shift, hr=(-0.04, -0.09, 0.25))), (94, shift)]
    return Clip("Celular", 120, keys, loop=True, life=0.8)


def levantar_caixa():
    """Levantar caixa: agacha com as costas retas, pega a caixa pelos lados e levanta até o peito."""
    squat = with_(S, hips=(0.0, -0.46, -0.16), hipr=(0, 30, 0), chest=(0, 24, 0), head=(0, -14, 0), fl=(0.16, 0.04, 0, 0, 15),
                  fr=(-0.16, 0.04, 0, 0, -15), knee=0.07, hl=(0.20, -0.36, 0.20), hr=(-0.20, -0.36, 0.20), fing=(0.6, 0.6))
    grab = with_(squat, fing=(0.9, 0.9), hl=(0.19, -0.35, 0.20), hr=(-0.19, -0.35, 0.20))
    half = with_(grab, hips=(0.0, -0.24, -0.08), hipr=(0, 18, 0), chest=(0, 12, 0), hl=(0.19, -0.30, 0.24), hr=(-0.19, -0.30, 0.24))
    carry = with_(S, fl=(0.16, 0.04, 0, 0, 15), fr=(-0.16, 0.04, 0, 0, -15), chest=(0, -6, 0), hl=(0.19, -0.22, 0.26), hr=(-0.19, -0.22, 0.26),
                  el=(0.40, -0.40, -0.20), er=(-0.40, -0.40, -0.20), fing=(0.9, 0.9))
    keys = [(0, S), (16, squat), (24, grab), (36, half), (48, carry), (62, carry)]
    return Clip("Levantar_Caixa", 62, keys, life=0.6)


# --- sports --------------------------------------------------------------------------------------

def chutar_bola():
    """Chutar a bola: dá um passo com o pé esquerdo ao lado da bola, a perna direita vai para trás e chuta com o peito do pé."""
    plant = with_(S, hips=(0.03, -0.06, 0.08), hipr=(8, 6, 6), chest=(6, 8, 6), fl=(0.16, 0.26, 0, 0, 10),
                  fr=(-0.10, -0.25, lifted(0.30), 50, -5), kr=(-0.10, 0.20, 0.80), hl=(0.42, -0.10, 0.10), hr=(-0.30, -0.25, 0.20))
    step = with_(blend(S, plant), fl=(0.14, 0.14, 0.07, 10, 10))
    kick = with_(plant, hips=(0.03, -0.05, 0.10), hipr=(-10, -4, 8), chest=(-8, -6, 8), fr=(-0.02, 0.52, lifted(0.32), 55, 0),
                 kr=(-0.05, 0.60, 0.80), hl=(0.45, 0.0, 0.0), hr=(-0.20, -0.30, 0.30))
    follow = with_(kick, fr=(0.0, 0.62, lifted(0.55), 45, 0), hipr=(-14, -8, 8), chest=(-10, -10, 8))
    land = with_(S, hips=(0.02, -0.06, 0.12), fl=(0.16, 0.26, 0, 10, 10), fr=(-0.10, 0.48, 0, 0, -5))
    keys = [(0, S), (8, step), (14, plant), (20, kick, "snap"), (25, follow, "out"), (34, land), (46, with_(S, fl=(0.14, 0.12, 0, 0, 8))), (58, S)]
    return Clip("Chutar_Bola", 58, keys, life=0.4)


def arremesso_basquete():
    """Arremessar ao cesto: dobra os joelhos com a bola no peito, sobe na ponta dos pés e solta a bola acima da cabeça."""
    ball = dict(fing=(0.15, 0.15), el=(0.35, -0.45, 0.0), er=(-0.35, -0.45, 0.0))
    hold = with_(S, hl=(0.10, 0.02, 0.26), hr=(-0.06, 0.04, 0.24), **ball)
    dip = with_(hold, hips=(0.0, -0.16, -0.04), hipr=(0, 10, 0), chest=(0, 10, 0), knee=0.04, hl=(0.10, -0.04, 0.24), hr=(-0.06, -0.02, 0.22))
    rise = with_(hold, hips=(0.0, 0.03, 0.02), fl=(0.11, 0.0, 0, 25, 8), fr=(-0.11, 0.0, 0, 25, -8), head=(0, -14, 0),
                 hl=(0.06, 0.48, 0.14), hr=(-0.06, 0.52, 0.12), el=(0.35, 0.20, 0.10), er=(-0.35, 0.20, 0.10))
    release = with_(rise, hr=(-0.05, 0.56, 0.24), hl=(0.10, 0.46, 0.18), fing=(0.15, 0.6), head=(0, -18, 0))
    keys = [(0, S), (10, hold), (18, dip), (26, rise), (30, release, "snap"), (40, release), (56, S)]
    return Clip("Arremesso_Basquete", 56, keys, life=0.4)


def goleiro():
    """Goleiro: pernas abertas e dobradas, mãos abertas à frente, muda o peso de um lado para o outro na ponta dos pés."""
    ready = with_(S, hips=(0.0, -0.18, -0.03), hipr=(0, 18, 0), chest=(0, 12, 0), head=(0, -24, 0), fl=(0.30, 0.02, 0, 8, 12),
                  fr=(-0.30, 0.02, 0, 8, -12), knee=0.07, hl=(0.30, -0.16, 0.34), hr=(-0.30, -0.16, 0.34), fing=(0.1, 0.1),
                  el=(0.50, -0.30, 0.0), er=(-0.50, -0.30, 0.0))
    left = with_(ready, hips=(0.06, -0.19, -0.03), hl=(0.33, -0.13, 0.34))
    right = with_(ready, hips=(-0.06, -0.19, -0.03), hr=(-0.33, -0.13, 0.34))
    keys = [(0, ready), (10, left), (20, ready), (30, right)]
    return Clip("Goleiro", 40, keys, loop=True, life=0.5, look=1.0)


def pular_corda():
    """Pular corda: pulinhos com os dois pés juntos, as mãos girando a corda ao lado do quadril."""
    hands = lambda a: dict(hl=(0.24 + 0.03 * math.cos(a), -0.30 + 0.04 * math.sin(a), 0.08), hr=(-0.24 - 0.03 * math.cos(a), -0.30 + 0.04 * math.sin(a), 0.08))
    land = with_(S, hips=(0.0, -0.07, 0.0), fl=(0.09, 0.02, 0, 15, 4), fr=(-0.09, 0.02, 0, 15, -4), knee=0.02, fing=(0.85, 0.85), **hands(0))
    air = with_(land, hips=(0.0, 0.05, 0.0), fl=(0.09, 0.02, 0.06, 30, 4), fr=(-0.09, 0.02, 0.06, 30, -4), **hands(math.pi))
    low = with_(air, hips=(0.0, 0.035, 0.0), fl=(0.09, 0.02, 0.045, 28, 4), fr=(-0.09, 0.02, 0.045, 28, -4))
    # Two hops, the second a little lower, so the loop does not look mechanical.
    keys = [(0, land), (4, with_(land, **hands(math.pi / 2))), (8, air), (12, with_(air, hips=(0.0, 0.0, 0.0), **hands(3 * math.pi / 2))),
            (16, with_(land, hips=(0.0, -0.065, 0.0))), (20, with_(land, **hands(math.pi / 2))), (24, low), (28, with_(low, hips=(0.0, -0.01, 0.0), **hands(3 * math.pi / 2)))]
    return Clip("Pular_Corda", 32, keys, loop=True, life=0.2)


def embaixadinha():
    """Embaixadinha: equilibra a bola tocando com o pé direito e o esquerdo, braços abertos e olhos na bola."""
    base = with_(S, hips=(0.0, -0.05, 0.0), chest=(0, 14, 0), head=(0, 34, 0), hl=(0.38, -0.20, 0.08), hr=(-0.38, -0.20, 0.08), knee=0.02)
    right = with_(base, hips=(0.03, -0.06, 0.0), fr=(-0.06, 0.24, lifted(0.42), 30, -10), kr=(-0.10, 0.60, 0.80), hr=(-0.42, -0.12, 0.06))
    left = with_(mirror(right), head=(0, 34, 0))
    keys = [(0, base), (7, right, "snap"), (15, base), (22, left, "snap")]
    return Clip("Embaixadinha", 30, keys, loop=True, life=0.3)


def agachamento():
    """Agachamento: desce com o quadril para trás e os braços à frente, e sobe de novo."""
    up = with_(S, fl=(0.17, 0.0, 0, 0, 15), fr=(-0.17, 0.0, 0, 0, -15), hl=(0.16, 0.02, 0.44), hr=(-0.16, 0.02, 0.44), fing=(0.5, 0.5))
    down = with_(up, hips=(0.0, -0.40, -0.16), hipr=(0, 24, 0), chest=(0, 16, 0), head=(0, -20, 0), knee=0.07, hl=(0.16, 0.08, 0.44), hr=(-0.16, 0.08, 0.44))
    keys = [(0, up), (26, down), (34, down), (60, up)]
    return Clip("Agachamento", 66, keys, loop=True, life=0.5)


def alongamento():
    """Alongamento: junta as mãos acima da cabeça, estica para cima, inclina para a esquerda, para a direita e solta."""
    side = with_(S, hl=(0.55, 0.20, 0.04), hr=(-0.55, 0.20, 0.04), el=(0.50, -0.50, -0.30), er=(-0.50, -0.50, -0.30), fing=(0.3, 0.3),
                 fl=(0.15, 0.0, 0, 0, 8), fr=(-0.15, 0.0, 0, 0, -8))
    up = with_(S, hl=(0.03, 0.62, 0.04), hr=(-0.03, 0.62, 0.04), el=(0.60, 0.10, -0.30), er=(-0.60, 0.10, -0.30), fing=(0.6, 0.6),
               fl=(0.15, 0.0, 0, 0, 8), fr=(-0.15, 0.0, 0, 0, -8), head=(0, -6, 0), hips=(0.0, 0.0, 0.0), sh=(10, 10))
    left = with_(up, hips=(-0.05, -0.02, 0.0), hipr=(0, 0, 6), chest=(0, 0, 24), head=(0, -4, 8))
    right = with_(up, hips=(0.05, -0.02, 0.0), hipr=(0, 0, -6), chest=(0, 0, -24), head=(0, -4, -8))
    keys = [(0, S), (10, side), (20, up), (32, up), (48, left), (60, left), (78, right), (90, right), (106, up), (116, side), (126, S)]
    return Clip("Alongamento", 126, keys, life=0.6)


# --- gestures ------------------------------------------------------------------------------------

def aplaudir():
    """Aplaudir: bate palmas na frente do peito, mãos abertas, com o corpo animado."""
    apart = with_(S, chest=(0, 4, 0), head=(0, -4, 0), hl=(0.15, -0.02, 0.28), hr=(-0.15, -0.02, 0.28), fing=(0.1, 0.1),
                  el=(0.40, -0.45, -0.10), er=(-0.40, -0.45, -0.10))
    together = with_(apart, hl=(0.02, -0.01, 0.30), hr=(-0.02, -0.01, 0.30))
    keys = [(0, together, "snap"), (4, apart), (8, together, "snap"), (12, apart), (16, together, "snap"), (20, apart)]
    return Clip("Aplaudir", 24, keys, loop=True, life=0.6)


def apontar():
    """Apontar: estica o braço direito e aponta com o indicador para a frente e à direita, olhando para lá."""
    point = with_(S, hipr=(-8, 0, 0), chest=(-10, 0, 0), head=(-22, -2, 0), hr=(-0.24, 0.20, 0.50), er=(-0.40, -0.30, 0.0),
                  fing=(0.45, 0.95), point=(0.0, 1.0), reach=(0, 10))
    keys = [(0, S), (10, point, "snap"), (34, with_(point, hr=(-0.25, 0.21, 0.49))), (48, S)]
    return Clip("Apontar", 48, keys, life=0.6)


def dar_de_ombros():
    """Dar de ombros: sobe os ombros, abre as mãos para os lados e inclina a cabeça, como quem diz "sei lá"."""
    shrug = with_(S, sh=(20, 20), head=(0, 2, 12), hl=(0.36, -0.24, 0.22), hr=(-0.36, -0.24, 0.22), fing=(0.05, 0.05),
                  el=(0.40, -0.50, -0.20), er=(-0.40, -0.50, -0.20))
    keys = [(0, S), (10, shrug), (24, with_(shrug, sh=(16, 16))), (40, S)]
    return Clip("Dar_de_Ombros", 40, keys, life=0.6)


def cocar_cabeca():
    """Coçar a cabeça: leva a mão direita atrás da cabeça e coça, com a cabeça inclinada, pensando."""
    # The hand comes up by the side of the head, the elbow out to the side all the way, then behind it.
    rising = with_(S, hr=(-0.24, 0.20, 0.06), er=(-0.70, -0.20, 0.0), fing=(0.45, 0.6))
    hand = with_(S, head=(-6, 10, -10), hr=(-0.08, 0.40, -0.02), er=(-0.70, 0.20, 0.10), fing=(0.45, 0.6))
    scratch = with_(hand, hr=(-0.06, 0.42, 0.0))
    keys = [(0, S), (12, rising), (21, hand), (25, scratch), (29, hand), (33, scratch), (37, hand), (41, scratch), (45, hand), (54, rising), (66, S)]
    return Clip("Cocar_Cabeca", 66, keys, life=0.6)


def olhar_relogio():
    """Olhar o relógio: levanta o pulso esquerdo na frente do peito e baixa os olhos para ele."""
    look = with_(S, hl=(-0.02, -0.02, 0.30), el=(0.35, -0.35, -0.05), head=(12, 26, 0), chest=(4, 6, 0), fing=(0.6, 0.45))
    keys = [(0, S), (12, look), (32, look), (46, S)]
    return Clip("Olhar_Relogio", 46, keys, life=0.6)


def rir():
    """Rir: joga a cabeça para trás e para a frente, os ombros sacodem e uma mão vai à barriga."""
    base = with_(S, hl=(0.06, -0.30, 0.18), el=(0.30, -0.45, -0.10), fing=(0.4, 0.45))
    up = with_(base, head=(0, -18, 0), chest=(0, -6, 0), sh=(8, 8))
    down = with_(base, head=(0, 6, 0), chest=(0, 8, 0), sh=(2, 2))
    keys = [(0, up), (5, down), (10, up), (15, down), (20, up), (26, down), (34, with_(down, head=(0, 14, 0), chest=(0, 14, 0)))]
    return Clip("Rir", 40, keys, loop=True, life=0.5)


def chorar():
    """Chorar: cobre o rosto com as mãos, cabeça baixa, e os ombros sacodem com os soluços."""
    cover = with_(S, chest=(0, 16, 0), head=(0, 26, 0), hl=(0.05, 0.22, 0.16), hr=(-0.05, 0.22, 0.16), el=(0.15, -0.40, 0.20),
                  er=(-0.15, -0.40, 0.20), fing=(0.35, 0.35))
    sob = with_(cover, sh=(10, 10), chest=(0, 12, 0), head=(0, 22, 0))
    keys = [(0, cover), (8, sob, "snap"), (14, cover), (20, sob, "snap"), (30, cover), (48, sob, "snap"), (56, cover)]
    return Clip("Chorar", 64, keys, loop=True, life=0.8)


def selfie():
    """Tirar selfie: estica o braço direito para o alto com o celular, inclina a cabeça, sorri e tira a foto."""
    pose = with_(S, hipr=(-6, 0, 2), chest=(-10, -4, 4), head=(-14, -8, 12), hr=(-0.20, 0.34, 0.44), er=(-0.40, -0.20, 0.10),
                 hl=(0.26, -0.24, -0.04), el=(0.55, -0.20, -0.30), fing=(0.6, 0.6), fr=(-0.11, 0.0, 0, 0, -20))
    click = with_(pose, fing=(0.6, 0.8), hr=(-0.20, 0.33, 0.44))
    keys = [(0, S), (14, pose), (28, pose), (31, click, "snap"), (34, pose), (44, pose), (60, S)]
    return Clip("Selfie", 60, keys, life=0.6)


# --- music ---------------------------------------------------------------------------------------

def violao():
    """Tocar violão: a mão esquerda no braço do violão, a direita batendo as cordas para baixo e para cima, o pé marcando o tempo."""
    hold = with_(S, chest=(4, 8, 0), head=(10, 14, 4), hl=(0.38, -0.08, 0.30), el=(0.40, -0.45, -0.20), fing=(0.7, 0.5),
                 er=(-0.40, -0.40, -0.20), fr=(-0.12, 0.04, 0, 0, -10))
    down = with_(hold, hr=(-0.02, -0.28, 0.20))
    up = with_(hold, hr=(-0.04, -0.20, 0.22))
    tap = with_(hold, fr=(-0.12, 0.04, 0, -12, -10))
    keys = [(0, up), (7.5, down, "snap"), (15, with_(up, fr=tap["fr"])), (22.5, down, "snap"), (30, up), (37.5, down, "snap"), (45, with_(up, fr=tap["fr"])),
            (52.5, down, "snap")]
    return Clip("Violao", 60, keys, loop=True, life=0.5, lag={"legs": 2.0})


def bateria():
    """Tocar bateria: sentado, a mão direita no chimbal, a esquerda na caixa nos tempos dois e quatro, o pé direito no bumbo."""
    kit = with_(CHAIR, chest=(0, 10, 0), head=(0, 10, 0), fing=(0.9, 0.9), el=(0.40, -0.40, -0.10), er=(-0.40, -0.40, -0.10),
                hl=(0.14, -0.20, 0.34), hr=(0.02, -0.12, 0.36), fr=(-0.13, 0.42, 0, -14, -6))
    hat_up = dict(hr=(0.02, -0.04, 0.32))
    snare_up = dict(hl=(0.14, -0.08, 0.30))
    # The bass drum: the toes, raised between beats, press the pedal down on beats one and three.
    kick = dict(fr=(-0.13, 0.42, 0, 0, -6))
    keys = []
    for k in range(8):
        frame = 7.5 * k
        pose = with_(kit)
        if k % 2 == 1:
            pose.update(hat_up)
        if k not in (2, 6):
            pose.update(snare_up)
        if k in (0, 4):
            pose.update(kick)
        keys.append((frame, pose, "snap" if k % 2 == 0 else "smooth"))
    return Clip("Bateria", 60, keys, loop=True, life=0.4)


CLIPS = [carro_dirigindo, carro_curvas, kart_pilotando, moto_pilotando, bicicleta_pedalando, cavalo_parado, cavalo_trote, cavalo_galope,
         canoa_remando, skate_impulsionando, varrer, martelar, serrar, cavar, pescar_lancar, pescar_esperando, cozinhar, digitar, celular,
         levantar_caixa, chutar_bola, arremesso_basquete, goleiro, pular_corda, embaixadinha, agachamento, alongamento, aplaudir, apontar,
         dar_de_ombros, cocar_cabeca, olhar_relogio, rir, chorar, selfie, violao, bateria]

moves.run(CLIPS, hands=0.45)
