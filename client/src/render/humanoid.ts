import * as THREE from 'three';
import type { CharacterStyle } from './character';
import { SkinBuilder, blend, blob, capsule, chain, ring, warp, type Layer, type Weights } from './skin';

/**
 * The skinned body every person, guard, goblin and skeleton is built from:
 * about 1.2 tiles tall, standing at the origin facing +Z. One smooth surface
 * per material, bent by bones at the joints, coloured per vertex.
 */

/** Where the bones sit in the bind pose (body space, y up). */
export const BODY = {
  hipsY: 0.62,
  hipX: 0.072,
  hipJoint: -0.03,
  thigh: 0.265,
  shin: 0.255,
  waist: 0.07,
  neck: 0.26,
  headBase: 0.06,
  shoulderX: 0.17,
  shoulderY: 0.235,
  upperArm: 0.225,
  forearm: 0.2,
};

/**
 * Where the bones sit: BODY for the built-in body, or a sculpted body's own
 * layout. `headCentre` is the middle of the head from the head bone, and
 * `headScale` sizes hair and hats to fit a head of another shape.
 */
export type BodyFrame = typeof BODY & {
  headCentre?: [number, number, number];
  headScale?: [number, number, number];
  /**
   * How far the head's surface is from its middle in direction `u`, for heads
   * not shaped like the built-in egg: smoothed outward, or (`tucked`) inward.
   */
  headRadius?: (u: THREE.Vector3, tucked?: boolean) => number;
  /** Hand-tuned nudges for a sculpted head's hair (and beard) and for each thing worn over it (see HeadFit). */
  fit?: { hair: HeadFit; hats: Record<Headwear, HeadFit> };
  /** For capes over a sculpted body: how far its back and front reach at each height, and how high its shoulders are. */
  torso?: { back: (y: number) => number; front: (y: number) => number; shoulderTop: number };
};

/**
 * A nudge for hair, hats and helms on a sculpted head, set by eye in the
 * fitting room: moved by x/y/z (right, up, forward), grown by `size` and then
 * by w/h/d along each axis, and tipped forward by `tilt` (radians), all about
 * the head's middle.
 */
export interface HeadFit {
  x: number;
  y: number;
  z: number;
  size: number;
  w: number;
  h: number;
  d: number;
  tilt: number;
}

/** The kinds of headwear, each fitted to a sculpted head on its own. */
export const HEADWEAR = ['helm', 'wizard', 'chef', 'hood', 'cap'] as const;
export type Headwear = (typeof HEADWEAR)[number];

export interface BodyBones {
  hips: THREE.Bone;
  skirt: THREE.Bone;
  torso: THREE.Bone;
  neck: THREE.Bone;
  head: THREE.Bone;
  eyes: THREE.Bone;
  shoulderL: THREE.Bone;
  shoulderR: THREE.Bone;
  elbowL: THREE.Bone;
  elbowR: THREE.Bone;
  handL: THREE.Bone;
  handR: THREE.Bone;
  hipL: THREE.Bone;
  hipR: THREE.Bone;
  kneeL: THREE.Bone;
  kneeR: THREE.Bone;
  ankleL: THREE.Bone;
  ankleR: THREE.Bone;
  frame: BodyFrame;
}

const SKIN = 0xd9a77e;
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** Head half-sizes and centre (body space). */
const HEAD = { rx: 0.074, ry: 0.1, rz: 0.084 };

/**
 * Shapes a point on a unit sphere into the head: a narrower jaw and chin, a
 * fuller back of the skull. Returns head-centre-relative coordinates.
 */
function headPoint(u: THREE.Vector3, grow = 1): THREE.Vector3 {
  let { x, y, z } = u;
  if (y < 0) {
    x *= 1 - 0.3 * y * y;
    if (z < 0) z *= 1 - 0.25 * y * y;
    else z *= 1 - 0.08 * y * y;
  }
  if (z < 0 && y > -0.3) z *= 1.08;
  // Flatter face, a little brow.
  if (z > 0.6) z = 0.6 + (z - 0.6) * 0.75;
  return new THREE.Vector3(x * HEAD.rx * grow, y * HEAD.ry * grow, z * HEAD.rz * grow);
}

/** The point on the face at unit coordinates (ux across, uy up), pushed out by `lift`. */
function facePoint(ux: number, uy: number, lift = 0): THREE.Vector3 {
  const uz = Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy));
  const p = headPoint(new THREE.Vector3(ux, uy, uz));
  return p.add(new THREE.Vector3(0, 0, lift));
}

/**
 * A shell around the head (hair, hood, helm). `keep(u)` says which parts of
 * the unit sphere show; the rest is tucked inside the head, which gives
 * hairlines and face openings without cutting geometry.
 */
function headShell(
  grow: number,
  keep: (u: THREE.Vector3) => boolean,
  shape?: (u: THREE.Vector3, p: THREE.Vector3) => void,
  point: (u: THREE.Vector3, grow: number) => THREE.Vector3 = headPoint,
): THREE.BufferGeometry {
  // Finer over a sculpted head, whose shape has more to follow.
  const fine = point !== headPoint;
  return warp(new THREE.SphereGeometry(1, fine ? 40 : 26, fine ? 28 : 18), (v) => {
    const u = v.clone();
    const shown = keep(u);
    // Hidden parts tuck inside the head, deeper below the jaw where a slim neck would let them show.
    const p = point(u, shown ? grow : 0.86 * Math.max(0.45, Math.min(1, 1 + (u.y + 0.1) * 1.5)));
    if (shown && shape) shape(u, p);
    v.copy(p);
  });
}

export function buildBody(s: CharacterStyle, parent: THREE.Object3D, opts: { transparent?: number; frame?: BodyFrame; sculpted?: boolean } = {}): BodyBones {
  const b = new SkinBuilder();
  const F: BodyFrame = opts.frame ?? BODY;
  // A sculpted body (see bodyModels.ts) brings its own skin, clothes and face; only hair, hats and gear are built here.
  const own = !opts.sculpted;
  const R = F.headRadius;
  // How much bigger than the built-in head this one is, along each axis.
  const hs = R
    ? new THREE.Vector3(R(new THREE.Vector3(1, 0, 0)) / HEAD.rx, R(new THREE.Vector3(0, 1, 0)) / HEAD.ry, R(new THREE.Vector3(0, 0, -1)) / HEAD.rz)
    : new THREE.Vector3(...(F.headScale ?? [1, 1, 1]));
  // A point on (or `grow` times out from) the head, from its middle: the built-in egg, or the sculpt's own shape.
  const hp = (u: THREE.Vector3, grow = 1): THREE.Vector3 => {
    if (!R) return headPoint(u, grow).multiply(hs);
    const n = u.clone().normalize();
    return n.multiplyScalar(grow < 1 ? R(n, true) * grow : R(n) * (1 + (grow - 1) * 0.8));
  };
  // A sculpted face has its eyes and brows higher up the head, so a wizard's brim sits higher to clear them.
  const WIZ_LIFT = 0.025;
  const fp = (ux: number, uy: number, lift = 0) => hp(new THREE.Vector3(ux, uy, Math.sqrt(Math.max(0, 1 - ux * ux - uy * uy)))).add(new THREE.Vector3(0, 0, lift));
  const shell = (grow: number, keep: (u: THREE.Vector3) => boolean, shape?: (u: THREE.Vector3, p: THREE.Vector3) => void) => headShell(grow, keep, shape, hp);
  const skin = s.skin ?? SKIN;
  const bulk = s.bulk ?? 1;
  const belly = s.belly ?? 0;
  const limb = s.bones ? 0.55 : 1;
  const bodyLayer: Layer = s.bodyMetal ? 'metal' : 'cloth';
  const legLayer: Layer = s.legsMetal ? 'metal' : 'cloth';
  // A woman's figure: narrower shoulders and waist, fuller hips, a bust, slimmer limbs.
  const fem = !!s.female && own;
  const figure = (py: number) => (fem ? lerpTable(FIGURE, py) : 1);
  const bust = (py: number) => (fem ? Math.max(0, 1 - Math.abs(py - 0.825) / 0.06) : 0);
  const slim = fem ? 0.92 : 1;

  // Skeleton
  const hips = b.bone('hips', null, 0, F.hipsY);
  const skirt = b.bone('skirt', hips, 0, 0.04);
  const torso = b.bone('torso', hips, 0, F.waist);
  const neck = b.bone('neck', torso, 0, F.neck);
  const head = b.bone('head', neck, 0, F.headBase);
  const headC = b.pos(head).add(new THREE.Vector3(...(F.headCentre ?? [0, 0.1, 0.004])));
  const eyeY = facePoint(0, 0.06).y;
  const eyes = b.bone('eyes', head, 0, headC.y - b.pos(head).y + eyeY, 0.07);
  const arms = ([-1, 1] as const).map((side) => {
    const shoulder = b.bone(side < 0 ? 'shoulderL' : 'shoulderR', torso, side * F.shoulderX * (own ? Math.sqrt(bulk) : 1) * (fem ? 0.88 : 1), F.shoulderY);
    const elbow = b.bone(side < 0 ? 'elbowL' : 'elbowR', shoulder, 0, -F.upperArm);
    const hand = b.bone(side < 0 ? 'handL' : 'handR', elbow, 0, -F.forearm);
    return { side, shoulder, elbow, hand };
  });
  const legs = ([-1, 1] as const).map((side) => {
    const hip = b.bone(side < 0 ? 'hipL' : 'hipR', hips, side * F.hipX, F.hipJoint);
    const knee = b.bone(side < 0 ? 'kneeL' : 'kneeR', hip, own ? -side * 0.003 : 0, -F.thigh, own ? 0.004 : 0);
    const ankle = b.bone(side < 0 ? 'ankleL' : 'ankleR', knee, own ? -side * 0.006 : 0, -F.shin, own ? -0.008 : 0);
    return { side, hip, knee, ankle };
  });
  const y = (bone: number) => b.pos(bone).y;
  const hipJ = y(legs[0].hip);
  const kneeJ = y(legs[0].knee);
  const ankleJ = y(legs[0].ankle);
  const torsoJ = y(torso);
  const shoulderJ = y(arms[0].shoulder);
  const elbowJ = y(arms[0].elbow);
  const wristJ = y(arms[0].hand);

  // Weights for anything round the trunk: the hips below the waist, the chest above.
  const trunkW = (py: number): Weights => blend(hips, torso, (py - (torsoJ - 0.03)) / 0.08);
  // Cloth over the thighs follows them a little, more toward the hem.
  const skirtW = (share: number) => (p: THREE.Vector3): Weights => {
    const down = clamp01((torsoJ - 0.02 - p.y) / 0.2);
    const side = clamp01(Math.abs(p.x) / 0.07);
    const thigh = down * share * side;
    const hang = down * (1 - share * side);
    return [
      [hips, 1 - down],
      [skirt, hang],
      [p.x < 0 ? legs[0].hip : legs[1].hip, thigh],
    ];
  };

  // Hips and seat, in trousers.
  const tr = s.trousers;
  if (!s.ghost && own) {
    b.tube(
      [0.745, 0.7, 0.64, 0.58, 0.545, 0.53].map((py, i) => ring(0, py, -0.004, [0.122, 0.124, 0.13, 0.128, 0.11, 0.07][i] * bulk * figure(py), [0.084, 0.086, 0.09, 0.092, 0.08, 0.05][i] * bulk, tr, [[hips, 1]])),
      {
        layer: legLayer,
        weigh: (p) => {
          const k = clamp01((0.6 - p.y) / 0.07) * clamp01(Math.abs(p.x) / 0.06) * 0.6;
          return [
            [hips, 1 - k],
            [p.x < 0 ? legs[0].hip : legs[1].hip, k],
          ];
        },
      },
    );

    // Legs: thigh, knee, calf, down into the boot.
    for (const { side, hip, knee, ankle } of legs) {
      const joints: [number, number][] = [
        [0, hips],
        [hipJ + 0.035, hip],
        [kneeJ, knee],
        [ankleJ + 0.01, ankle],
      ];
      const x = side * BODY.hipX;
      // [y, half-width, half-depth, forward]
      const shape: [number, number, number, number][] = [
        [0.68, 0.056, 0.064, 0],
        [0.6, 0.062, 0.07, 0.004],
        [0.52, 0.061, 0.066, 0.007],
        [0.48, 0.059, 0.063, 0.008],
        [0.44, 0.058, 0.062, 0.008],
        [0.37, 0.048, 0.052, 0.006],
        [kneeJ, 0.043, 0.047, 0.008],
        [0.28, 0.044, 0.05, -0.006],
        [0.22, 0.046, 0.054, -0.012],
        [0.15, 0.035, 0.04, -0.008],
        [0.09, 0.029, 0.032, -0.006],
        [0.06, 0.028, 0.03, -0.006],
      ];
      b.tube(
        shape.map(([py, rx, rz, z]) => ring(x - side * (0.7 - py) * 0.012, py, z, rx * limb * slim * (py > 0.5 ? Math.sqrt(bulk) : 1), rz * limb * slim, tr, chain(py, joints, 0.07))),
        { layer: legLayer, radial: 16 },
      );
      if (s.bones) {
        // Knobbly knees.
        b.rigid(blob(0.03, 0.03, 0.03, 10), knee, s.boots);
        continue;
      }
      // Boot shaft, with a turned-down cuff, and the foot.
      const cuff = s.bootCuff ?? s.boots;
      const boot: [number, number, number, number, number][] = [
        [0.245, 0.051, 0.057, -0.012, cuff],
        [0.215, 0.053, 0.06, -0.013, cuff],
        [0.205, 0.05, 0.057, -0.013, s.boots],
        [0.15, 0.04, 0.046, -0.009, s.boots],
        [0.09, 0.035, 0.039, -0.006, s.boots],
        [0.05, 0.036, 0.04, -0.004, s.boots],
      ];
      b.tube(
        boot.map(([py, rx, rz, z, c]) => ring(x - side * (0.7 - py) * 0.012, py, z, rx, rz, c, chain(py, joints, 0.07))),
        { radial: 16 },
      );
      const foot = warp(blob(0.041, 0.04, 0.083, 14), (p) => {
        if (p.y < -0.026) p.y = -0.026 - (p.y + 0.026) * 0.25; // flat sole
        if (p.z > 0) p.x *= 1 - 0.18 * (p.z / 0.083); // narrower toe
        p.y += p.z > 0.02 ? -0.008 * (p.z / 0.083) : 0;
        p.z += 0.035;
        p.y -= 0.038;
      });
      b.add(
        foot.translate(b.pos(ankle).x, b.pos(ankle).y, b.pos(ankle).z),
        (p) => (p.y < 0.008 ? shade(s.boots, 0.6) : s.boots),
        () => [[ankle, 1]],
      );
    }
  }

  // Torso: chest and shoulders, with a collar and an optional belly.
  const chest: [number, number, number, number][] = [
    [0.6, 0.122, 0.084, -0.004],
    [0.68, 0.127, 0.088, 0],
    [0.74, 0.13, 0.09, 0.004],
    [0.8, 0.142, 0.095, 0.01],
    [0.84, 0.156, 0.097, 0.013],
    [0.862, 0.172, 0.096, 0.012],
    [0.885, 0.196, 0.093, 0.01],
    [0.905, 0.21, 0.087, 0.005],
    [0.922, 0.198, 0.078, 0.001],
    [0.936, 0.17, 0.07, -0.003],
    [0.95, 0.125, 0.06, -0.005],
    [0.962, 0.08, 0.052, -0.006],
    [0.974, 0.04, 0.035, -0.006],
  ];
  const top = s.trim ?? s.tunic;
  if (own)
  b.tube(
    chest.map(([py, rx, rz, z]) => {
      const gut = belly * Math.max(0, 1 - Math.abs(py - 0.73) / 0.11);
      return ring(0, py, z + gut * 0.035 + bust(py) * 0.02, rx * bulk * figure(py) + gut * 0.02, rz * bulk + gut * 0.035 + bust(py) * 0.03, py > 0.955 ? top : s.tunic, trunkW(py));
    }),
    {
      layer: bodyLayer,
      radial: 28,
      // The shoulders are part of the torso, rounding over into the arm, and move with it.
      weigh: (p, w) => {
        const k = THREE.MathUtils.smoothstep(Math.abs(p.x), 0.09 * bulk * figure(0.9), 0.17 * bulk * figure(0.9)) * THREE.MathUtils.smoothstep(p.y, 0.8, 0.885) * 0.8;
        return k > 0 ? [...w.map(([bone, x]): [number, number] => [bone, x * (1 - k)]), [arms[p.x < 0 ? 0 : 1].shoulder, k]] : w;
      },
      paint: (p, c) => {
        if (s.bones && p.z > 0 && p.y > 0.72 && p.y < 0.9 && Math.abs(p.x) > 0.02) return Math.sin((p.y - 0.72) * 140) > 0.2 ? 0x3a3428 : c;
        return c;
      },
    },
  );

  // Skirt: a tunic hem flaring over the hips, or a robe to the ground.
  b.doubleSided();
  if (s.robe !== undefined) {
    const robe: [number, number, number][] = [
      [0.72, 0.13, 0.09],
      [0.62, 0.155, 0.112],
      [0.45, 0.185, 0.145],
      [0.25, 0.212, 0.168],
      [s.ghost ? 0.02 : 0.05, 0.228, 0.182],
    ];
    b.tube(
      robe.map(([py, rx, rz], i) => ring(0, py, -0.004, rx * bulk * figure(py), rz * bulk, i === robe.length - 1 && s.trim ? s.trim : s.robe!, [[hips, 1]])),
      { capStart: false, capEnd: false, radial: 24, weigh: skirtW(0.4) },
    );
  } else if (own) {
    const hem: [number, number, number][] = [
      [0.72, 0.131, 0.091],
      [0.64, 0.142, 0.1],
      [0.565, 0.152, 0.109],
      [0.53, 0.156, 0.112],
      [0.522, 0.157, 0.113],
      [0.5, 0.159, 0.115],
    ];
    b.tube(
      hem.map(([py, rx, rz]) => ring(0, py, -0.004, rx * bulk * figure(py), rz * bulk, s.tunic, [[hips, 1]])),
      { capStart: false, capEnd: false, radial: 24, layer: bodyLayer, weigh: skirtW(0.6), paint: (p, c) => (s.trim && p.y < 0.525 ? s.trim : c) },
    );
  }
  if (s.apron !== undefined) {
    const apron: [number, number, number, number][] = [
      [0.9, 0.12, 0.1, 0.012],
      [0.8, 0.148, 0.112, 0.012],
      [0.72, 0.14, 0.103, 0.006],
      [0.62, 0.155, 0.116, 0.006],
      [0.5, 0.168, 0.128, 0.006],
      [0.4, 0.174, 0.134, 0.006],
    ];
    b.tube(
      apron.map(([py, rx, rz, z]) => {
        const gut = belly * Math.max(0, 1 - Math.abs(py - 0.73) / 0.11);
        const cz = z + gut * 0.035 + bust(py) * 0.02;
        // Over a sculpted body, out in front of its own chest.
        const depth = Math.max(rz * bulk + gut * 0.035 + bust(py) * 0.03, F.torso ? F.torso.front(py) + 0.012 - cz : 0);
        return ring(0, py, cz, rx * bulk * figure(py) + gut * 0.02, depth, s.apron!, trunkW(py));
      }),
      { capStart: false, capEnd: false, arc: [0, 0.3], radial: 10, weigh: (p, w) => (p.y < torsoJ - 0.02 ? skirtW(0.5)(p) : w) },
    );
  }
  b.doubleSided(false);

  // Belt, buckle and pouch.
  if (s.belt !== undefined && own) {
    b.tube(
      [0.655, 0.665, 0.69, 0.7].map((py, i) => ring(0, py, 0, (0.13 + (i % 3 ? 0.006 : 0)) * bulk * figure(py), (0.091 + (i % 3 ? 0.006 : 0)) * bulk, s.belt!, trunkW(py))),
      { radial: 24 },
    );
    if (s.buckle !== undefined) b.add(new THREE.BoxGeometry(0.044, 0.034, 0.012).translate(0, 0.678, 0.098 * bulk), () => s.buckle!, () => [[hips, 1]], 'metal');
    if (s.pouch !== undefined) b.add(blob(0.03, 0.036, 0.022, 10).translate(0.112 * bulk * figure(0.64), 0.64, 0.05), () => s.pouch!, () => [[hips, 1]]);
  }

  // Arms: a sleeve from shoulder to wrist, then the hand.
  const sleeve = s.bones ? skin : s.tunic;
  for (const { side, shoulder, elbow, hand } of own ? arms : []) {
    const x = b.pos(shoulder).x;
    const joints: [number, number][] = [
      [0, torso],
      [shoulderJ + 0.005, shoulder],
      [elbowJ, elbow],
      [wristJ + 0.01, hand],
    ];
    const shape: [number, number, number, number][] = [
      // Starts inside the shoulder, so the torso's rounded shoulder covers the join.
      [0.905, 0.038, 0.04, 0],
      [0.885, 0.046, 0.048, 0],
      [0.85, 0.047, 0.048, 0],
      [0.8, 0.042, 0.044, 0],
      [0.74, 0.038, 0.039, 0],
      [elbowJ, 0.035, 0.037, -0.004],
      [0.66, 0.037, 0.037, 0.002],
      [0.6, 0.033, 0.031, 0.002],
      [0.55, 0.028, 0.026, 0],
      [0.54, 0.031, 0.029, 0],
      [0.51, 0.031, 0.029, 0],
    ];
    const cuff = s.trim && !s.bones ? s.trim : sleeve;
    b.tube(
      shape.map(([py, rx, rz, z]) => ring(x + side * (0.95 - py) * 0.01, py, z, rx * limb * slim * (py > 0.8 ? Math.sqrt(bulk) : 1), rz * limb * slim, py < 0.545 ? cuff : sleeve, chain(py, joints, 0.07))),
      { layer: bodyLayer, radial: 16 },
    );
    // A mitten of a hand, flat side to the leg, with a thumb in front.
    const hx = x + side * (0.95 - wristJ) * 0.01;
    const hand_: [number, number, number][] = [
      [wristJ + 0.03, 0.019, 0.022],
      [wristJ, 0.017, 0.025],
      [wristJ - 0.03, 0.018, 0.031],
      [wristJ - 0.06, 0.016, 0.03],
      [wristJ - 0.078, 0.012, 0.022],
      [wristJ - 0.086, 0.006, 0.012],
    ];
    b.tube(
      hand_.map(([py, rx, rz]) => ring(hx, py, 0.002, rx * (s.bones ? 0.8 : 1), rz, skin, chain(py, joints, 0.02))),
      { radial: 12 },
    );
    const thumb = capsule(0.009, 0.042, 8).rotateX(-0.5).rotateZ(side * 0.25);
    b.add(thumb.translate(hx - side * 0.006, wristJ - 0.012, 0.022), () => skin, () => [[hand, 1]]);
  }

  // Neck and head.
  if (own) {
  b.tube(
    [0.93, 0.97, 1.0, 1.03, 1.06].map((py) => ring(0, py, -0.004, 0.037 * (s.bones ? 0.7 : 1), 0.039 * (s.bones ? 0.7 : 1), skin, chain(-py, [[0, torso], [-(y(neck) + 0.01), neck], [-(y(head) + 0.02), head]], 0.04))),
    { radial: 12 },
  );
  const headGeo = warp(new THREE.SphereGeometry(1, 28, 20), (v) => v.copy(headPoint(v)));
  b.add(headGeo.translate(headC.x, headC.y, headC.z), () => skin, (p) => (p.y < headC.y - 0.06 ? blend(neck, head, (p.y - (headC.y - 0.1)) / 0.04) : [[head, 1]]));
  }

  // Shells and pieces on the head (already fitted to its shape), moved to its middle.
  const atHead = (geo: THREE.BufferGeometry) => geo.translate(headC.x, headC.y, headC.z);
  const onHead = (geo: THREE.BufferGeometry, at: THREE.Vector3, color: number, bone = head, layer: Layer = 'cloth') => {
    b.add(atHead(geo.scale(hs.x, hs.y, hs.z).translate(at.x, at.y, at.z)), () => color, () => [[bone, 1]], layer);
  };
  const hairColor = s.hair ?? 0x3a2a1a;
  // Hair hanging down the back follows the head, then the neck, then the shoulders.
  const hangs: [number, number][] = [
    [0, head],
    [y(head) - 0.01, neck],
    [y(neck), torso],
  ];

  // Face: eyes (on their own bone, to blink), brows, nose, mouth, ears.
  for (const side of own ? [-1, 1] : []) {
    const eye = fp(side * 0.38, 0.06);
    if (s.glowEyes !== undefined) {
      if (s.bones) onHead(blob(0.02, 0.019, 0.01, 10), eye.clone().add(new THREE.Vector3(0, 0, -0.002)), 0x1a1410);
      onHead(blob(0.011, 0.009, 0.006, 8), eye.clone().add(new THREE.Vector3(0, 0, 0.004)), s.glowEyes, eyes, 'glow');
      continue;
    }
    onHead(blob(0.0155, 0.0105, 0.007, 10).rotateZ(side * -0.08), eye.clone().add(new THREE.Vector3(0, 0, -0.002)), 0xf4efe6, eyes);
    onHead(blob(0.0075, 0.0085, 0.004, 8), eye.clone().add(new THREE.Vector3(side * -0.001, 0, 0.004)), 0x2a2018, eyes);
    if (fem) onHead(blob(0.017, 0.003, 0.006, 8).rotateZ(side * -0.2), eye.clone().add(new THREE.Vector3(side * 0.002, 0.009, 0.003)), 0x1a1410, eyes);
    const brow = fp(side * 0.4, 0.26, 0.004);
    onHead(blob(0.019, fem ? 0.0032 : 0.0045, 0.006, 8).rotateZ(side * (fem ? 0.2 : 0.12)), brow, s.beard ?? hairColor);
    const ear = hp(new THREE.Vector3(side * 0.98, 0.02, -0.1).normalize());
    if (s.pointyEars) {
      const point = new THREE.ConeGeometry(0.022, 0.11, 6).translate(0, 0.055, 0).rotateZ(-side * 1.15);
      onHead(point, ear.clone().add(new THREE.Vector3(side * 0.005, 0.005, 0)), skin);
    } else if (!s.bones) onHead(blob(0.011, 0.026, 0.018, 10), ear.clone().add(new THREE.Vector3(side * 0.004, 0, 0)), shade(skin, 0.94));
  }
  if (!own) {
    // The sculpted face is already there.
  } else if (s.bones) {
    // A grin of teeth, a dark nose hole, cheekbones.
    onHead(blob(0.032, 0.009, 0.008, 10), fp(0, -0.52, -0.002), 0xf4efe0);
    onHead(blob(0.007, 0.01, 0.006, 6), fp(0, -0.16, -0.003), 0x1a1410);
  } else {
    const nose = s.pointyEars
      ? capsule(0.016, 0.07, 8).rotateX(-Math.PI / 2 + 0.35)
      : warp(blob(0.012, 0.024, 0.015, 10), (p) => {
          if (p.y < 0) p.z += -p.y * 0.25;
        });
    onHead(nose, fp(0, -0.17, s.pointyEars ? 0.002 : 0.006), s.pointyEars ? shade(skin, 0.92) : skin);
    onHead(blob(0.019, fem ? 0.0055 : 0.0045, 0.006, 8), fp(0, -0.5, -0.001), fem ? blendHex(shade(skin, 0.72), 0xa0403a, 0.35) : shade(skin, 0.7));
  }

  // Hair, beard and hats are shells over the head.
  const fits = R ? F.fit : undefined;
  const fitTo = (fit: HeadFit | undefined) => {
    if (!fit) return;
    const turn = new THREE.Matrix4().makeRotationX(fit.tilt);
    const grow = new THREE.Vector3(fit.size * fit.w, fit.size * fit.h, fit.size * fit.d);
    const move = new THREE.Vector3(fit.x, fit.y, fit.z);
    b.place = (p, n) => {
      p.sub(headC).multiply(grow).applyMatrix4(turn).add(headC).add(move);
      n.divide(grow).applyMatrix4(turn).normalize();
    };
  };
  fitTo(fits?.hair);
  const bald = s.hairStyle === 'none' || s.hair === undefined;
  if (!bald) {
    // Hairline: high over the forehead, over the ears, low at the nape.
    const line = (u: THREE.Vector3) => (u.z > 0 ? 0.08 + 0.42 * Math.pow(u.z, 1.3) : 0.08 + 0.62 * u.z);
    // Long hair over a sculpted head: the back half of the shell unrolls down to the shoulders, following the head's outline.
    const sheet = s.hairStyle === 'long' && !!R;
    const hangsAt = (u: THREE.Vector3) => sheet && u.z < 0.08 && u.y < 0.05 && u.y > -0.92;
    const fall = 0.27 * hs.y;
    if (sheet) b.doubleSided();
    b.add(
      atHead(
        // Under a wizard's hat on a sculpted head, hair shows only below the brim.
        shell(1.08, (u) => (u.y > line(u) || hangsAt(u)) && !(R && s.hat === 'wizard' && hp(u).y > (0.04 + WIZ_LIFT) * hs.y), (u, p) => {
          if (!hangsAt(u)) return;
          const t = (0.05 - u.y) / 0.97;
          const round = hp(new THREE.Vector3(u.x, 0, u.z), 1.08 + 0.3 * t);
          // Shorter toward the sides, so the ends curve round.
          p.set(round.x, 0.05 * hs.y - t * fall * (1 - 0.35 * Math.abs(u.x) / Math.max(0.3, Math.hypot(u.x, u.z))), round.z - 0.01 * t);
        }),
      ),
      (p) => shade(hairColor, 0.9 + 0.1 * clamp01((p.y - headC.y) / 0.08 + 0.5)),
      (p) => (p.y < headC.y - 0.06 ? chain(p.y, hangs, 0.06) : [[head, 1]]),
    );
    b.doubleSided(false);
    if (s.hairStyle === 'long' && !sheet) {
      // Hair down the back to the shoulders.
      b.doubleSided();
      b.tube(
        [0.05, -0.05, -0.13, -0.21].map((dy, i) => {
          const py = headC.y + dy * hs.y;
          return ring(0, py, headC.z + (-0.012 - i * 0.012) * hs.z, (0.08 + i * 0.008) * hs.x, (0.088 + i * 0.004) * hs.z, hairColor, chain(py, hangs, 0.06));
        }),
        { arc: [Math.PI, 0.55], capStart: false, capEnd: false, radial: 10 },
      );
      b.doubleSided(false);
    }
    if (s.hairStyle === 'bun') {
      const dir = new THREE.Vector3(0, 0.62, -0.78).normalize();
      onHead(blob(0.038, 0.034, 0.034, 12), hp(dir).addScaledVector(dir, 0.022 * hs.y), hairColor);
    }
    if (s.hairStyle === 'ponytail') {
      // Tied at the back of the crown, hanging to between the shoulders.
      const knot = new THREE.Vector3(0, 0.36, -0.93).normalize();
      onHead(blob(0.022, 0.02, 0.02, 10), hp(knot).addScaledVector(knot, 0.01), shade(hairColor, 0.8));
      const tail: [number, number, number][] = [
        [headC.y + 0.04 * hs.y, 0.024, -0.095 * hs.z],
        [headC.y - 0.01 * hs.y, 0.028, -0.104 * hs.z],
        [headC.y - 0.07 * hs.y, 0.024, -0.098 * hs.z],
        [headC.y - 0.13 * hs.y, 0.017, -0.092 * hs.z],
        [headC.y - 0.18 * hs.y, 0.006, -0.09 * hs.z],
      ];
      b.tube(
        tail.map(([py, r, dz]) => ring(0, py, headC.z + dz, r, r * 0.9, hairColor, chain(py, hangs, 0.06))),
        { radial: 10 },
      );
    }
    if (s.hairStyle === 'spiky') {
      // Short tufts standing up off the crown.
      const up = new THREE.Vector3(0, 1, 0);
      for (const [ux, uy, uz] of SPIKES) {
        const dir = new THREE.Vector3(ux, uy, uz).normalize();
        const cone = new THREE.ConeGeometry(0.019, 0.05, 6).translate(0, 0.02, 0);
        cone.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
        const at = hp(dir, 1.02);
        b.add(atHead(cone.translate(at.x, at.y, at.z)), () => hairColor, () => [[head, 1]]);
      }
    }
  }
  if (s.beard !== undefined) {
    b.add(
      atHead(shell(1.07, (u) => u.y < -0.12 && u.z > -0.15 && !(u.y > -0.62 && u.y < -0.38 && Math.abs(u.x) < 0.3 && u.z > 0.5), (u, p) => {
        if (u.y < -0.5) p.y -= 0.012 * (-u.y - 0.5) * 4;
      })),
      () => s.beard!,
      () => [[head, 1]],
    );
    onHead(blob(0.03, 0.008, 0.01, 10), fp(0, -0.36, 0.004), s.beard);
  }
  const hat = s.hatColor ?? 0x555555;
  if (s.hat === 'cap') {
    fitTo(fits?.hats.cap);
    b.add(atHead(shell(1.11, (u) => u.y > 0.32 - u.z * 0.1)), () => hat, () => [[head, 1]]);
    onHead(blob(0.066, 0.006, 0.05, 14), hp(new THREE.Vector3(0, 0.54, 0.84)).add(new THREE.Vector3(0, 0, 0.018 * hs.z)), shade(hat, 0.85));
  }
  if (s.hat === 'chef') {
    fitTo(fits?.hats.chef);
    b.add(atHead(shell(1.1, (u) => u.y > 0.3)), () => hat, () => [[head, 1]]);
    b.tube(
      [0.075, 0.1, 0.13, 0.16, 0.17].map((dy, i) => ring(headC.x, headC.y + dy * hs.y, headC.z - 0.004, [0.07, 0.083, 0.095, 0.085, 0.03][i] * hs.x, [0.078, 0.09, 0.1, 0.09, 0.03][i] * hs.z, hat, [[head, 1]])),
      { radial: 16 },
    );
  }
  if (s.hat === 'wizard') {
    fitTo(fits?.hats.wizard);
    // A tall pointed hat with a wide brim, the tip bent back a little.
    // Over a sculpted head, only under the brim: the cone covers the crown.
    b.add(atHead(shell(1.1, (u) => u.y > (R ? 0.42 : 0.22) - u.z * 0.12 && (!R || hp(u).y < (0.04 + WIZ_LIFT) * hs.y))), () => hat, () => [[head, 1]]);
    const cone: [number, number, number][] = [
      [0.045, 0.15, 0],
      [0.055, 0.092, 0],
      [0.1, 0.075, -0.004],
      [0.16, 0.055, -0.012],
      [0.22, 0.036, -0.026],
      [0.27, 0.018, -0.046],
      [0.3, 0.004, -0.068],
    ];
    b.tube(
      // (A sculpted head is less round, so the band sits a little wider to clear it.)
      cone.map(([dy, r, dz], i) => {
        const k = R && (i === 1 || i === 2) ? 1.1 : 1;
        return ring(headC.x, headC.y + (dy + (R ? WIZ_LIFT : 0)) * hs.y, headC.z + (-0.006 + dz) * hs.z, r * hs.x * k, r * hs.z * k, i === 1 && s.trim !== undefined ? s.trim : hat, [[head, 1]]);
      }),
      { radial: 18 },
    );
  }
  if (s.helm !== undefined) {
    fitTo(fits?.hats.helm);
    // An open-faced helm with a nose guard and a rim.
    b.add(
      atHead(shell(1.12, (u) => u.y > (R ? -0.22 : -0.35) && !(u.z > 0.55 && u.y < 0.25 && Math.abs(u.x) < 0.62))),
      (p) => (p.y > headC.y + 0.095 ? shade(s.helm!, 1.15) : s.helm!),
      () => [[head, 1]],
      'metal',
    );
    onHead(new THREE.BoxGeometry(0.018, 0.075, 0.012), fp(0, 0.1, 0.009), s.helm, head, 'metal');
    // The crest: a ridge along the top, following the helm's curve.
    if (R) {
      const ridge = [0.95, 0.6, 0.2, -0.2, -0.6, -1.0].map((a) => hp(new THREE.Vector3(0, Math.cos(a), Math.sin(a)), 1.13));
      b.add(atHead(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(ridge), 16, 0.009, 6)), () => shade(s.helm!, 0.85), () => [[head, 1]], 'metal');
    }
    else onHead(new THREE.BoxGeometry(0.012, 0.02, 0.15), new THREE.Vector3(0, hp(new THREE.Vector3(0, 1, 0), 1.12).y - 0.007 * hs.y, -0.01 * hs.z), shade(s.helm, 0.85), head, 'metal');
  }
  if (s.hat === 'hood') {
    fitTo(fits?.hats.hood);
    // A hood over the head and down onto the shoulders, open at the face.
    b.doubleSided();
    b.add(
      atHead(shell(1.16, (u) => !(u.z > 0.42 && u.y < 0.55 && Math.abs(u.x) < 0.75) && !(R && u.y < -0.55 && u.z > 0.1), (u, p) => {
        if (u.y < -0.3) {
          const k = (-u.y - 0.3) / 0.7;
          p.y -= k * 0.05;
          p.x *= 1 + k * 0.35;
          p.z = p.z * (1 + k * 0.3) - k * 0.01;
        }
        if (u.y > 0.7 && u.z < -0.2) p.z -= (u.y - 0.7) * 0.06; // a little peak at the back
      })),
      () => hat,
      (p) => (p.y < headC.y - 0.07 ? blend(neck, head, (p.y - (headC.y - 0.13)) / 0.06) : [[head, 1]]),
    );
    b.doubleSided(false);
  }

  b.place = null;
  b.build(parent, hips, { transparent: opts.transparent });
  const bones = b.bones;
  return {
    hips: bones[hips],
    skirt: bones[skirt],
    torso: bones[torso],
    neck: bones[neck],
    head: bones[head],
    eyes: bones[eyes],
    shoulderL: bones[arms[0].shoulder],
    shoulderR: bones[arms[1].shoulder],
    elbowL: bones[arms[0].elbow],
    elbowR: bones[arms[1].elbow],
    handL: bones[arms[0].hand],
    handR: bones[arms[1].hand],
    hipL: bones[legs[0].hip],
    hipR: bones[legs[1].hip],
    kneeL: bones[legs[0].knee],
    kneeR: bones[legs[1].knee],
    ankleL: bones[legs[0].ankle],
    ankleR: bones[legs[1].ankle],
    frame: F,
  };
}

/** Body width by height for a woman's figure, as a multiple of the usual. */
const FIGURE: [number, number][] = [
  [0.5, 1.07],
  [0.6, 1.06],
  [0.66, 0.97],
  [0.72, 0.9],
  [0.8, 0.92],
  [0.86, 0.88],
  [1, 0.88],
];

/** Directions of the tufts on spiky hair, on the unit head. */
const SPIKES: [number, number, number][] = [
  [0, 1, 0.1],
  [0.35, 0.9, 0.35],
  [-0.35, 0.9, 0.35],
  [0.5, 0.8, -0.2],
  [-0.5, 0.8, -0.2],
  [0, 0.85, -0.5],
  [0, 0.8, 0.6],
  [0.6, 0.6, 0.2],
  [-0.6, 0.6, 0.2],
];

function lerpTable(table: [number, number][], x: number): number {
  if (x <= table[0][0]) return table[0][1];
  for (let i = 1; i < table.length; i++) {
    const [x1, y1] = table[i];
    const [x0, y0] = table[i - 1];
    if (x <= x1) return y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return table[table.length - 1][1];
}

function blendHex(a: number, b: number, k: number): number {
  return new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();
}

function shade(hex: number, k: number): number {
  return new THREE.Color(hex).multiplyScalar(k).getHex();
}
