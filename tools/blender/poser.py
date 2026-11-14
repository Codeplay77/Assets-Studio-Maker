# Shared by make_dances.py and make_combat.py: Mesh2Motion's human skeleton in Blender, posed in
# the character's own space, baked into plain bone rotations and exported for
# scripts/import-animations.ts.
#
# A pose says where the hips are and how hips, chest and head turn; where each foot stands and how
# it is turned; where each hand reaches, relative to the chest; where elbows and knees point; how
# much the shoulders rise or come forward; and how closed each hand is. Legs and arms follow by IK,
# so a planted foot never slides and a hand goes exactly where the pose puts it.
#
# Character space: meters, x to the character's left, y up, z forward. Angles are in degrees: yaw
# turns to the left, pitch bends forward, roll leans to the left.

import math
import os

import bpy
from mathutils import Matrix, Quaternion, Vector

FPS = 30
FINGER_BONES = [f"{finger}_0{n}_{side}" for side in "lr" for finger in ("thumb", "index", "middle", "ring", "pinky") for n in (1, 2, 3)]

arm = None
scene = None
REST = {}
ANKLE = {}
BALL = {}
CLOSED = {}
CONTROLS = {}
# How closed the hands are when a pose does not say: 0 is flat, 1 the hand Mesh2Motion closes.
hands = 0.6


def load(source):
    """Opens Mesh2Motion's human with its mannequin, keeps its closed hand and drops its clips."""
    global arm, scene
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj)
    bpy.ops.import_scene.gltf(filepath=source)
    arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
    scene = bpy.context.scene
    CLOSED.update(closed_hand())
    for action in list(bpy.data.actions):
        bpy.data.actions.remove(action)
    for obj in list(bpy.data.objects):
        if obj.type == "MESH" and obj.parent is None:
            bpy.data.objects.remove(obj)
    arm.animation_data_clear()
    scene.render.fps = FPS
    bpy.context.view_layer.objects.active = arm
    for pb in arm.pose.bones:
        pb.rotation_mode = "QUATERNION"
    REST.update({b.name: b.matrix_local.copy() for b in arm.data.bones})
    ANKLE.update({s: REST[f"foot_{s}"].to_translation() for s in "lr"})
    BALL.update({s: REST[f"ball_{s}"].to_translation() for s in "lr"})


def closed_hand():
    """The fingers of Mesh2Motion's own idle, first frame: a loosely closed hand."""
    arm.animation_data_create()
    idle = bpy.data.actions["Idle_A"]
    arm.animation_data.action = idle
    if hasattr(arm.animation_data, "action_slot") and idle.slots:
        arm.animation_data.action_slot = idle.slots[0]
    scene.frame_set(int(idle.frame_range[0]))
    hand = {}
    for name in FINGER_BONES:
        pb = arm.pose.bones[name]
        pb.rotation_mode = "QUATERNION"
        hand[name] = pb.rotation_quaternion.copy()
    arm.animation_data.action = None
    return hand


def C(x, y, z):
    """Character space to Blender: x left stays +X, y up is +Z, z forward is -Y."""
    return Vector((x, -z, y))


def R(yaw=0.0, pitch=0.0, roll=0.0):
    return (
        Matrix.Rotation(math.radians(yaw), 3, "Z")
        @ Matrix.Rotation(math.radians(pitch), 3, "X")
        @ Matrix.Rotation(math.radians(roll), 3, "Y")
    )


def update():
    bpy.context.view_layer.update()


def reset_pose(fingers=None):
    """Every bone at rest, but the fingers, closed as much as asked: (left, right) or both `hands`."""
    for pb in arm.pose.bones:
        pb.location = (0, 0, 0)
        pb.rotation_quaternion = (1, 0, 0, 0)
        pb.scale = (1, 1, 1)
    left, right = fingers if fingers is not None else (hands, hands)
    for name, rotation in CLOSED.items():
        arm.pose.bones[name].rotation_quaternion = Quaternion().slerp(rotation, left if name.endswith("_l") else right)
    update()


def turn(name, rotation, about=None):
    """Turns a bone, and what hangs from it, by a rotation in the scene, about its joint."""
    pb = arm.pose.bones[name]
    head = about if about is not None else pb.head.copy()
    pb.matrix = Matrix.Translation(head) @ rotation.to_4x4() @ Matrix.Translation(-head) @ pb.matrix
    update()


def move(name, offset):
    pb = arm.pose.bones[name]
    pb.matrix = Matrix.Translation(offset) @ pb.matrix
    update()


def turned(name):
    """Where a bone's joint is and how far it turned from rest, in the scene."""
    pb = arm.pose.bones[name]
    return pb.head.copy(), pb.matrix.to_3x3() @ REST[name].to_3x3().inverted()


# --- controls ------------------------------------------------------------------------------------

def empty(name):
    obj = bpy.data.objects.get(name) or bpy.data.objects.new(name, None)
    if obj.name not in scene.collection.objects:
        scene.collection.objects.link(obj)
    obj.rotation_mode = "QUATERNION"
    return obj


def add_constraints():
    for side in "lr":
        foot = empty(f"pe_{side}")
        knee = empty(f"joelho_{side}")
        hand = empty(f"mao_{side}")
        elbow = empty(f"cotovelo_{side}")
        CONTROLS.update({f"pe_{side}": foot, f"joelho_{side}": knee, f"mao_{side}": hand, f"cotovelo_{side}": elbow})
        leg = arm.pose.bones[f"calf_{side}"].constraints.new("IK")
        leg.name = "ik"
        leg.target, leg.pole_target, leg.chain_count = foot, knee, 2
        sole = arm.pose.bones[f"foot_{side}"].constraints.new("COPY_ROTATION")
        sole.name = "pe"
        sole.target = foot
        reach = arm.pose.bones[f"lowerarm_{side}"].constraints.new("IK")
        reach.name = "ik"
        reach.target, reach.pole_target, reach.chain_count = hand, elbow, 2


def remove_constraints():
    for pb in arm.pose.bones:
        for constraint in list(pb.constraints):
            pb.constraints.remove(constraint)


def calibrate(bone, target, pole, joint, tip, bend, pole_at):
    """Finds the pole angle that bends the middle joint toward the pole, for this rig's bone rolls."""
    constraint = arm.pose.bones[bone].constraints["ik"]
    target.location = bend
    pole.location = pole_at
    best = None
    for step in range(-180, 180, 5):
        constraint.pole_angle = math.radians(step)
        update()
        root = arm.pose.bones[joint].head
        mid = arm.pose.bones[bone].head
        line = (tip - root).normalized()
        towards = (mid - root) - line * (mid - root).dot(line)
        wanted = (pole_at - root) - line * (pole_at - root).dot(line)
        error = towards.angle(wanted) if towards.length > 1e-6 and wanted.length > 1e-6 else math.pi
        if best is None or error < best[0]:
            best = (error, step)
    constraint.pole_angle = math.radians(best[1])
    return best


def calibrate_all():
    reset_pose()
    for side, sign in (("l", 1), ("r", -1)):
        foot, knee = CONTROLS[f"pe_{side}"], CONTROLS[f"joelho_{side}"]
        foot.rotation_quaternion = REST[f"foot_{side}"].to_quaternion()
        hip = REST[f"thigh_{side}"].to_translation()
        bend = hip + Vector((0, -0.25, -0.6))
        print("  joelho", side, calibrate(f"calf_{side}", foot, knee, f"thigh_{side}", bend, bend, hip + Vector((0, -1.0, -0.4))))
        hand, elbow = CONTROLS[f"mao_{side}"], CONTROLS[f"cotovelo_{side}"]
        shoulder = REST[f"upperarm_{side}"].to_translation()
        reach = shoulder + Vector((sign * 0.25, -0.2, -0.35))
        print("  cotovelo", side, calibrate(f"lowerarm_{side}", hand, elbow, f"upperarm_{side}", reach, reach, shoulder + Vector((sign * 0.4, 0.6, -0.4))))


# --- poses ---------------------------------------------------------------------------------------

BASE = {
    "hips": (0.0, -0.02, 0.0),
    "hipr": (0, 0, 0),
    "chest": (0, 0, 0),
    "head": (0, 0, 0),
    # Feet: where the ankle stands (x, z), how high it is lifted, its tilt and its turn.
    "fl": (0.11, 0.0, 0.0, 0, 0),
    "fr": (-0.11, 0.0, 0.0, 0, 0),
    # Hands, from the chest and turning with it.
    "hl": (0.24, -0.40, 0.04),
    "hr": (-0.24, -0.40, 0.04),
    # Where the elbows point, from the chest; None lets them hang back and down.
    "el": None,
    "er": None,
    # How far the shoulders rise, and how far they come forward, in degrees.
    "sh": (0, 0),
    "reach": (0, 0),
    # How far the knees bend out, and where they point, from the hips; None points them over the toes.
    "knee": 0.0,
    "kl": None,
    "kr": None,
    # How closed each hand is, 0 flat to 1 closed; None leaves both at `hands`.
    "fing": None,
}


def mirror(pose):
    """The same pose on the other side."""
    out = dict(pose)
    flip3 = lambda v: (-v[0], v[1], v[2]) if v is not None else None
    turn3 = lambda v: (-v[0], v[1], -v[2])
    swap = lambda v: (v[1], v[0]) if v is not None else None
    out["hips"] = flip3(pose["hips"])
    out["hipr"] = turn3(pose["hipr"])
    out["chest"] = turn3(pose["chest"])
    out["head"] = turn3(pose["head"])
    foot = lambda f: (-f[0], f[1], f[2], f[3], -f[4], *(-v for v in f[5:]))
    out["fl"], out["fr"] = foot(pose["fr"]), foot(pose["fl"])
    out["hl"], out["hr"] = flip3(pose["hr"]), flip3(pose["hl"])
    out["el"], out["er"] = flip3(pose["er"]), flip3(pose["el"])
    out["sh"] = swap(pose["sh"])
    out["reach"] = swap(pose.get("reach", (0, 0)))
    out["kl"], out["kr"] = flip3(pose.get("kr")), flip3(pose.get("kl"))
    if "kw" in pose:
        out["kw"] = swap(pose["kw"])
    out["fing"] = swap(pose.get("fing"))
    return out


def P(**changes):
    pose = dict(BASE)
    pose.update(changes)
    return pose


def place_foot(side, spec):
    """
    A foot: where its ankle stands (x, z), how high it is lifted, its tilt and its turn, and, if
    there is a sixth number, how far it rolls about its length, the sole turning to the side. On the
    floor the tilt raises the heel over the ball of the foot, which stays down; in the air it
    points the toes down.
    """
    x, z, lift, tilt, yaw, *more = spec
    roll = more[0] if more else 0.0
    rest = REST[f"foot_{side}"]
    ankle = ANKLE[side].copy()
    ball = BALL[side].copy()
    spin = R(yaw=yaw)
    # Turn the foot about its ankle, then tilt it.
    ankle_at = Vector((x, -z + ankle.y, ankle.z))
    ball_at = ankle_at + spin @ (ball - ankle)
    side_axis = spin @ Vector((1, 0, 0))
    if lift <= 0.001 and tilt > 0:
        tip = Matrix.Rotation(math.radians(tilt), 3, side_axis)
        ankle_at = ball_at + tip @ (ankle_at - ball_at)
    else:
        tip = Matrix.Rotation(math.radians(tilt), 3, side_axis)
        ankle_at = ankle_at + Vector((0, 0, lift))
    turn_ = tip @ spin
    if roll:
        turn_ = Matrix.Rotation(math.radians(roll), 3, turn_ @ Vector((0, -1, 0))) @ turn_
    foot = CONTROLS[f"pe_{side}"]
    foot.location = ankle_at
    foot.rotation_quaternion = (turn_ @ rest.to_3x3()).to_quaternion()
    return ankle_at, spin


def apply(pose):
    reset_pose(pose.get("fing"))
    hx, hy, hz = pose["hips"]
    move("pelvis", C(hx, hy, hz))
    turn("pelvis", R(*pose["hipr"]))
    yaw, pitch, roll = pose["chest"]
    for name in ("spine_01", "spine_02", "spine_03"):
        turn(name, R(yaw / 3, pitch / 3, roll / 3))
    yaw, pitch, roll = pose["head"]
    turn("neck_01", R(yaw / 2, pitch / 2, roll / 2))
    turn("head", R(yaw / 2, pitch / 2, roll / 2))
    left, right = pose["sh"]
    turn("clavicle_l", R(roll=-left))
    turn("clavicle_r", R(roll=right))
    # A shoulder that comes forward turns its collarbone about the body's up.
    left, right = pose.get("reach", (0, 0))
    if left or right:
        turn("clavicle_l", R(yaw=-left))
        turn("clavicle_r", R(yaw=right))

    chest_at, chest_turn = turned("spine_03")
    hips_at, hips_turn = turned("pelvis")
    weights = pose.get("kw")
    for side, sign in (("l", 1), ("r", -1)):
        hand = pose[f"h{side}"]
        CONTROLS[f"mao_{side}"].location = chest_at + chest_turn @ C(*hand)
        elbow = pose[f"e{side}"] or (sign * 0.30, -0.45, -0.60)
        CONTROLS[f"cotovelo_{side}"].location = chest_at + chest_turn @ C(*elbow)
        ankle_at, spin = place_foot(side, pose[f"f{side}"])
        # Knees point where the toes do, a little outward, more when the pose says so; or where it
        # points them, from the hips, as much as `kw` says.
        out = pose["knee"] * sign
        pole = ankle_at + spin @ C(sign * 0.08 + out, 0.45, 0.9)
        knee = pose.get(f"k{side}")
        weight = (weights[0] if side == "l" else weights[1]) if weights is not None else (1.0 if knee is not None else 0.0)
        if knee is not None and weight > 0:
            pole = pole.lerp(hips_at + hips_turn @ C(*knee), weight)
        CONTROLS[f"joelho_{side}"].location = pole
    update()


# --- keys, baking and export ---------------------------------------------------------------------

KEYED_BONES = ["pelvis", "spine_01", "spine_02", "spine_03", "neck_01", "head", "clavicle_l", "clavicle_r", *FINGER_BONES]


def key(frame):
    for name in KEYED_BONES:
        pb = arm.pose.bones[name]
        pb.keyframe_insert("rotation_quaternion", frame=frame)
    arm.pose.bones["pelvis"].keyframe_insert("location", frame=frame)
    for control in CONTROLS.values():
        control.keyframe_insert("location", frame=frame)
        control.keyframe_insert("rotation_quaternion", frame=frame)


def curves_of(obj):
    """Every F-curve of an object's action, whatever the action layout of this Blender version."""
    data = obj.animation_data
    if not data or not data.action:
        return []
    action = data.action
    if hasattr(action, "fcurves") and len(action.fcurves) > 0:
        return list(action.fcurves)
    curves = []
    for layer in getattr(action, "layers", []):
        for strip in layer.strips:
            for bag in strip.channelbags:
                curves.extend(bag.fcurves)
    return curves


def finish_curves(interpolation, cyclic=True):
    for obj in [arm, *CONTROLS.values()]:
        for curve in curves_of(obj):
            if cyclic and not any(m.type == "CYCLES" for m in curve.modifiers):
                curve.modifiers.new("CYCLES")
            for point in curve.keyframe_points:
                point.interpolation = interpolation
            curve.update()


def clear_animation():
    for obj in [arm, *CONTROLS.values()]:
        if obj.animation_data and obj.animation_data.action:
            action = obj.animation_data.action
            obj.animation_data.action = None
            if action.users == 0:
                bpy.data.actions.remove(action)


def bake(name, last):
    """Bakes frames 0 to `last` into plain bone rotations and keeps them as an action called `name`."""
    scene.frame_start, scene.frame_end = 0, last
    bpy.ops.object.mode_set(mode="POSE")
    bpy.ops.pose.select_all(action="SELECT")
    bpy.ops.nla.bake(frame_start=0, frame_end=last, step=1, only_selected=False, visual_keying=True,
                     clear_constraints=False, clear_parents=False, use_current_action=False, clean_curves=False,
                     bake_types={"POSE"})
    bpy.ops.object.mode_set(mode="OBJECT")
    baked = arm.animation_data.action
    baked.name = name
    baked.use_fake_user = True
    arm.animation_data.action = None
    for control in CONTROLS.values():
        if control.animation_data and control.animation_data.action:
            old = control.animation_data.action
            control.animation_data.action = None
            if old.users == 0:
                bpy.data.actions.remove(old)
    for action in list(bpy.data.actions):
        if action is not baked and not action.use_fake_user and action.users == 0:
            bpy.data.actions.remove(action)
    return baked


def export(out, made):
    """Drops the controls and every other action, and writes the clips made to a GLB."""
    clear_animation()
    remove_constraints()
    for control in CONTROLS.values():
        bpy.data.objects.remove(control)
    CONTROLS.clear()
    reset_pose()
    for action in list(bpy.data.actions):
        if action not in made:
            bpy.data.actions.remove(action)
    print("acoes", [a.name for a in bpy.data.actions])
    bpy.ops.export_scene.gltf(filepath=out, export_format="GLB", export_animations=True, export_animation_mode="ACTIONS",
                              export_force_sampling=True, export_frame_step=1, export_anim_slide_to_zero=True, export_def_bones=False)
    print("pronto")


# --- previews ------------------------------------------------------------------------------------

VIEWS = {"frente": Vector((1.4, -3.4, 0.5)), "lado": Vector((-3.6, -0.5, 0.4))}


def preview(action, frames, path, size=(260, 360), views=("frente", "lado")):
    """
    Renders the mannequin at some frames of a clip, one image per frame and view, to look at a clip
    without leaving Blender: from the front and to its left, and from its right side.
    """
    if "previa_cam" not in bpy.data.objects:
        for engine in ("BLENDER_EEVEE", "BLENDER_EEVEE_NEXT", "BLENDER_WORKBENCH"):
            try:
                scene.render.engine = engine
                break
            except TypeError:
                pass
        world = bpy.data.worlds.new("previa")
        scene.world = world
        world.use_nodes = True
        background = next(n for n in world.node_tree.nodes if n.type == "BACKGROUND")
        background.inputs[0].default_value = (0.72, 0.75, 0.8, 1)
        sun = bpy.data.objects.new("previa_sol", bpy.data.lights.new("previa_sol", "SUN"))
        scene.collection.objects.link(sun)
        sun.data.energy = 3
        sun.rotation_euler = (math.radians(50), 0, math.radians(30))
        camera = bpy.data.objects.new("previa_cam", bpy.data.cameras.new("previa_cam"))
        scene.collection.objects.link(camera)
        camera.data.angle = math.radians(40)
        scene.camera = camera
    scene.render.resolution_x, scene.render.resolution_y = size
    # The baked clip alone moves the bones: the IK would pull them to wherever the controls are.
    constraints = [c for pb in arm.pose.bones for c in pb.constraints]
    for constraint in constraints:
        constraint.mute = True
    arm.animation_data_create()
    arm.animation_data.action = action
    if hasattr(arm.animation_data, "action_slot") and action.slots:
        arm.animation_data.action_slot = action.slots[0]
    folder = os.path.dirname(path)
    stem = os.path.splitext(os.path.basename(path))[0]
    camera = scene.camera
    target = Vector((0, 0, 0.95))
    for view in views:
        camera.location = target + VIEWS[view]
        camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()
        for i, frame in enumerate(frames):
            scene.frame_set(frame)
            scene.render.filepath = os.path.join(folder, f"{stem}_{view}_{i:02d}.png")
            bpy.ops.render.render(write_still=True)
    arm.animation_data.action = None
    for constraint in constraints:
        constraint.mute = False
