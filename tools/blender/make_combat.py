# Makes the editor's own fighting moves on the Mesh2Motion human skeleton and exports them as a GLB
# that scripts/import-animations.ts adds to the animation pack.
#
#   blender --factory-startup -b --python tools/blender/make_combat.py -- <human-base-animations.glb> <combate.glb> [move,move,...] [--previa <folder>]
#
# Every move starts and ends in the same guard as Combate_Guarda, so a game can chain them. A move
# is a few key poses (see poser.py for what a pose says) on frames at 30 per second, eased by
# moves.py so it does not look robotic. The head keeps looking ahead while the body turns, as a
# fighter keeps the eyes on the opponent. --previa renders the mannequin at a few moments of each
# move into that folder, to review them.

import math
import os
import sys

script = globals().get("__file__") or sys.argv[sys.argv.index("--python") + 1]
sys.path.insert(0, os.path.dirname(os.path.abspath(script)))

import poser  # noqa: E402
from poser import P, mirror  # noqa: E402

import moves  # noqa: E402
from moves import with_  # noqa: E402

# How much the head turns back toward the opponent, in the guard: 1 would keep it straight ahead.
GUARD_LOOK = 0.7


def Clip(name, end, keys, look=GUARD_LOOK, **options):
    """A fighting move: fists closed, eyes on the opponent, and the guard's look at its ends."""
    return moves.Clip(name, end, keys, look=look, rest_look=GUARD_LOOK, hands=1.0, **options)


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
    """
    A left hook: the fist pulls back beside the head, then the body turns some 40 degrees and the arm,
    bent square with the elbow out at shoulder height, sweeps across in front of the chin.
    """
    load = with_(G, hips=(0.03, -0.10, 0.0), hipr=(-32, 6, 3), chest=(-16, 8, 5), hl=(0.16, 0.12, 0.22), el=(0.50, -0.20, -0.05))
    hit = with_(G, hips=(0.0, -0.09, 0.02), hipr=(0, 6, -2), chest=(10, 6, -3), hl=(-0.06, 0.26, 0.26), el=(0.65, 0.32, 0.20),
                reach=(10, 0), sh=(14, 8), fl=(0.10, 0.17, 0, 12, 25), hr=(-0.10, 0.19, 0.15))
    return load, hit


def gancho():
    """Gancho de esquerda: o corpo gira sobre o pé da frente e o braço dobrado vem de lado, na altura do queixo."""
    load, hit = hook_poses()
    after = with_(hit, chest=(13, 6, -3), hl=(-0.09, 0.26, 0.25))
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
    turn = with_(cross, hl=(0.16, 0.12, 0.22), el=(0.50, -0.20, -0.05), hr=(-0.06, 0.16, 0.30), hips=(0.02, -0.095, 0.02))
    back = with_(G, hipr=(-14, 5, 0), hl=(0.05, 0.16, 0.30))
    keys = [(0, G), (4, with_(G, hipr=(-25, 5, 0), chest=(-11, 7, 0))), (8, jab_hit, "snap"), (11, swap), (15, cross, "snap"),
            (19, turn), (23, hook, "snap"), (25, with_(hook, chest=(13, 6, -3))), (33, back, "out"), (48, G)]
    return Clip("Combate_Sequencia", 48, keys, life=0.4)


def soco_corpo():
    """Soco no corpo: dobra os joelhos, inclina para a esquerda e o gancho de esquerda vai na altura da barriga."""
    load = with_(G, hips=(0.04, -0.17, 0.0), hipr=(-30, 10, 6), chest=(-14, 14, 8), hl=(0.12, 0.02, 0.24), el=(0.42, -0.40, 0.0), knee=0.05)
    hit = with_(G, hips=(0.02, -0.16, 0.03), hipr=(4, 10, 2), chest=(10, 12, 2), hl=(-0.10, -0.10, 0.30), el=(0.55, -0.20, 0.20),
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
    raise_ = with_(G, hips=(0.0, -0.04, -0.02), hipr=(-18, -2, 0), chest=(-6, -8, 0), hr=(-0.10, 0.58, 0.02), er=(-0.60, 0.10, -0.10),
                   sh=(6, 18))
    smash = with_(G, hips=(0.0, -0.14, 0.04), hipr=(-6, 10, 0), chest=(6, 24, 0), hr=(-0.03, -0.02, 0.40), er=(-0.50, 0.0, 0.10),
                  fr=(-0.14, -0.15, 0, 20, -35))
    after = with_(smash, hr=(-0.03, -0.05, 0.39), chest=(6, 26, 0))
    keys = [(0, G), (9, raise_), (15, smash, "snap"), (17, after), (25, with_(G, hips=(0.0, -0.09, 0.0)), "out"), (35, G)]
    return Clip("Combate_Martelo", 35, keys, life=0.4)


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
    """Chamar para a briga: abre a guarda, estende a mão da frente e a puxa duas vezes para o peito, fechando os dedos, queixo para cima."""
    open_ = with_(G, hipr=(-20, 0, 0), chest=(-6, -4, 0), head=(0, -6, 0), hl=(0.10, 0.08, 0.44), el=(0.30, -0.45, 0.10),
                  fing=(0.05, 1), hr=(-0.14, 0.05, 0.12))
    call = with_(open_, fing=(0.9, 1), hl=(0.10, 0.16, 0.28), head=(0, -12, 0), chest=(-6, -7, 0))
    keys = [(0, G), (8, open_), (14, call), (20, open_), (26, call), (32, open_), (46, G)]
    return Clip("Combate_Provocar", 46, keys, life=0.6, look=0.9)


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


moves.run(MOVES, hands=1.0)
