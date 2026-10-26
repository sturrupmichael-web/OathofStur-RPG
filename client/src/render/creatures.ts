import * as THREE from 'three';

/**
 * Four-, six- and eight-legged monsters and birds, built from primitives
 * like the humanoids in character.ts. Humanoid monsters (goblins, skeletons,
 * guards) use the character rig instead; see CHARACTER_STYLES.
 */

export type CreatureKind = 'cow' | 'desert_lizard' | 'scorpion' | 'cave_creeper' | 'crimson_swift' | 'cinder_drake';

interface Leg {
  hip: THREE.Group;
  knee: THREE.Group | null;
  /** -1 left, 1 right. */
  side: number;
  /** Walk-cycle offset in radians, so legs move in a gait. */
  offset: number;
  /** Resting sideways splay (radians about z). */
  splay: number;
}

export interface CreatureRig {
  kind: CreatureKind;
  root: THREE.Group;
  /** Everything; rolls over when the creature dies. */
  body: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  legs: Leg[];
  /** Tail segments from the body outward. */
  tail: THREE.Group[];
  /** Pincers or wings, mirrored left/right. */
  arms: THREE.Group[];
  /** Neck segments from the shoulders to the head (the drake). */
  neck: THREE.Group[];
  /** Lower jaw, which opens to bite and breathe. */
  jaw: THREE.Group | null;
  /** Where fire leaves the mouth, for the breath effect. */
  mouth: THREE.Object3D | null;
  phase: number;
  walk: number;
  oneShot: { kind: string; start: number } | null;
  fallen: number;
  seed: number;
}

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = color * 31 + emissive;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive, flatShading: true });
    materials.set(key, m);
  }
  return m;
}

function part(parent: THREE.Object3D, geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive));
  m.position.set(x, y, z);
  m.castShadow = true;
  parent.add(m);
  return m;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** A limb segment hanging straight down from its pivot. */
function limb(length: number, r0: number, r1: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, length, 6).translate(0, -length / 2, 0);
}

function base(kind: CreatureKind, seed: number): CreatureRig {
  const root = new THREE.Group();
  const body = pivot(root, 0, 0);
  const torso = pivot(body, 0, 0);
  const head = pivot(torso, 0, 0);
  return { kind, root, body, torso, head, legs: [], tail: [], arms: [], neck: [], jaw: null, mouth: null, phase: 0, walk: 0, oneShot: null, fallen: 0, seed };
}

function cow(seed: number): CreatureRig {
  const r = base('cow', seed);
  const hide = 0xf0ece2;
  const patch = 0x2a2420;
  r.torso.position.y = 0.62;
  part(r.torso, new THREE.SphereGeometry(0.3, 12, 8).scale(0.78, 0.82, 1.55), hide);
  for (const [x, y, z, s] of [[0.2, 0.06, 0.1, 0.13], [-0.21, 0.02, -0.18, 0.16], [0.18, 0.1, -0.28, 0.1], [-0.12, 0.2, 0.2, 0.11]]) {
    part(r.torso, new THREE.SphereGeometry(s, 8, 6).scale(0.5, 1, 1.3), patch, x, y, z);
  }
  part(r.torso, new THREE.SphereGeometry(0.08, 8, 6), 0xe8a0a0, 0, -0.22, -0.18); // udder
  r.head.position.set(0, 0.12, 0.44);
  part(r.head, new THREE.BoxGeometry(0.2, 0.22, 0.26), hide, 0, 0, 0.06);
  part(r.head, new THREE.BoxGeometry(0.18, 0.13, 0.1), 0xd8a090, 0, -0.06, 0.22); // muzzle
  part(r.head, new THREE.BoxGeometry(0.16, 0.08, 0.1), patch, 0, 0.08, 0.08);
  for (const side of [-1, 1]) {
    part(r.head, new THREE.ConeGeometry(0.025, 0.12, 5).rotateZ(-side * 1.1), 0xe8e0c8, side * 0.13, 0.12, 0.02);
    part(r.head, new THREE.BoxGeometry(0.1, 0.03, 0.06), hide, side * 0.15, 0.05, -0.02);
    part(r.head, new THREE.BoxGeometry(0.025, 0.025, 0.01), 0x111111, side * 0.08, 0.04, 0.2);
  }
  for (const [x, z, offset] of [[-0.14, 0.3, 0], [0.14, 0.3, Math.PI], [-0.14, -0.32, Math.PI], [0.14, -0.32, 0]] as const) {
    const hip = pivot(r.torso, x, -0.12, z);
    part(hip, limb(0.34, 0.06, 0.045), hide);
    const knee = pivot(hip, 0, -0.34);
    part(knee, limb(0.16, 0.045, 0.04), hide);
    part(knee, new THREE.BoxGeometry(0.08, 0.05, 0.09), 0x2a2420, 0, -0.16, 0.01);
    r.legs.push({ hip, knee, side: Math.sign(x), offset, splay: 0 });
  }
  const tail = pivot(r.torso, 0, 0.14, -0.46);
  part(tail, limb(0.38, 0.02, 0.015), hide);
  part(tail, new THREE.SphereGeometry(0.045, 6, 5), patch, 0, -0.4, 0);
  tail.rotation.x = 0.25;
  r.tail.push(tail);
  return r;
}

function lizard(seed: number): CreatureRig {
  const r = base('desert_lizard', seed);
  const skin = 0xc49a5a;
  const stripe = 0x7a5a2a;
  r.torso.position.y = 0.17;
  part(r.torso, new THREE.SphereGeometry(0.14, 10, 6).scale(0.9, 0.55, 2.4), skin);
  for (let i = -2; i <= 2; i++) part(r.torso, new THREE.BoxGeometry(0.2 - Math.abs(i) * 0.03, 0.02, 0.04), stripe, 0, 0.07, i * 0.1);
  r.head.position.set(0, 0.02, 0.34);
  part(r.head, new THREE.ConeGeometry(0.08, 0.26, 6).rotateX(Math.PI / 2).scale(1, 0.55, 1), skin, 0, 0, 0.1);
  for (const side of [-1, 1]) part(r.head, new THREE.SphereGeometry(0.022, 6, 4), 0xf0d040, side * 0.055, 0.03, 0.04, 0x302000);
  for (const [x, z, offset] of [[-1, 0.2, 0], [1, 0.2, Math.PI], [-1, -0.18, Math.PI], [1, -0.18, 0]] as const) {
    const hip = pivot(r.torso, x * 0.1, 0, z);
    hip.rotation.z = x * 1.1;
    part(hip, limb(0.14, 0.03, 0.025), skin);
    const knee = pivot(hip, 0, -0.14);
    knee.rotation.z = -x * 1.4;
    part(knee, limb(0.1, 0.025, 0.02), skin);
    r.legs.push({ hip, knee, side: x, offset, splay: x * 1.1 });
  }
  let parent: THREE.Object3D = r.torso;
  let z = -0.32;
  for (let i = 0; i < 4; i++) {
    const seg = pivot(parent, 0, 0, z);
    const len = 0.18 - i * 0.02;
    part(seg, new THREE.ConeGeometry(0.06 - i * 0.012, len, 6).rotateX(-Math.PI / 2).translate(0, 0, -len / 2), i % 2 ? stripe : skin);
    r.tail.push(seg);
    parent = seg;
    z = -len;
  }
  return r;
}

function scorpion(seed: number): CreatureRig {
  const r = base('scorpion', seed);
  const shell = 0x8a4a22;
  const dark = 0x4a2412;
  r.torso.position.y = 0.16;
  part(r.torso, new THREE.SphereGeometry(0.16, 10, 6).scale(1, 0.45, 1.6), shell);
  for (let i = 0; i < 3; i++) part(r.torso, new THREE.BoxGeometry(0.26 - i * 0.04, 0.03, 0.05), dark, 0, 0.065, -0.05 - i * 0.08);
  r.head.position.set(0, 0, 0.24);
  part(r.head, new THREE.SphereGeometry(0.09, 8, 6).scale(1.2, 0.5, 0.9), shell);
  for (const side of [-1, 1]) part(r.head, new THREE.SphereGeometry(0.018, 6, 4), 0x111111, side * 0.04, 0.04, 0.05);
  // Pincers on jointed arms.
  for (const side of [-1, 1]) {
    const arm = pivot(r.head, side * 0.08, 0, 0.02);
    arm.rotation.y = side * 0.5;
    part(arm, new THREE.CylinderGeometry(0.025, 0.03, 0.2, 6).rotateX(Math.PI / 2).translate(0, 0, 0.1), shell);
    const claw = pivot(arm, 0, 0, 0.2);
    claw.rotation.y = -side * 0.9;
    part(claw, new THREE.SphereGeometry(0.06, 8, 6).scale(0.8, 0.5, 1.4), shell, 0, 0, 0.07);
    part(claw, new THREE.ConeGeometry(0.02, 0.1, 4).rotateX(Math.PI / 2), dark, side * 0.025, 0, 0.17);
    part(claw, new THREE.ConeGeometry(0.02, 0.1, 4).rotateX(Math.PI / 2), dark, -side * 0.025, 0, 0.17);
    r.arms.push(arm);
  }
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      const hip = pivot(r.torso, side * 0.12, 0, 0.12 - i * 0.09);
      hip.rotation.z = side * 1.2;
      hip.rotation.y = side * (0.3 - i * 0.25);
      part(hip, limb(0.13, 0.018, 0.015), dark);
      const knee = pivot(hip, 0, -0.13);
      knee.rotation.z = -side * 1.6;
      part(knee, limb(0.12, 0.015, 0.008), dark);
      r.legs.push({ hip, knee, side, offset: (i + (side > 0 ? 1 : 0)) * Math.PI, splay: side * 1.2 });
    }
  }
  // Tail: five segments curling up over the back, stinger last.
  let parent: THREE.Object3D = r.torso;
  let z = -0.24;
  for (let i = 0; i < 5; i++) {
    const seg = pivot(parent, 0, 0, z);
    part(seg, new THREE.SphereGeometry(0.055 - i * 0.004, 8, 6).scale(1, 0.9, 1.3), i === 4 ? dark : shell, 0, 0, -0.05);
    if (i === 4) part(seg, new THREE.ConeGeometry(0.025, 0.12, 5).rotateX(-Math.PI / 2 - 0.9), 0x1a1008, 0, -0.03, -0.12);
    r.tail.push(seg);
    parent = seg;
    z = -0.1;
  }
  return r;
}

function creeper(seed: number): CreatureRig {
  const r = base('cave_creeper', seed);
  const shell = 0x3a3046;
  const leg = 0x2a2232;
  r.body.scale.setScalar(1.35);
  r.torso.position.y = 0.3;
  part(r.torso, new THREE.SphereGeometry(0.17, 12, 8).scale(1, 0.85, 1.25), 0x4a3a5a, 0, 0.06, -0.22);
  part(r.torso, new THREE.SphereGeometry(0.06, 8, 6).scale(2.4, 0.4, 1), 0x8a6aa0, 0, 0.2, -0.24); // markings
  part(r.torso, new THREE.SphereGeometry(0.11, 10, 6).scale(1, 0.75, 1.1), shell);
  r.head.position.set(0, 0.0, 0.11);
  for (const [x, y] of [[-0.03, 0.04], [0.03, 0.04], [-0.06, 0.02], [0.06, 0.02]]) part(r.head, new THREE.SphereGeometry(0.016, 6, 4), 0xff5a5a, x, y, 0.02, 0x801010);
  for (const side of [-1, 1]) part(r.head, new THREE.ConeGeometry(0.018, 0.08, 4).rotateX(Math.PI - 0.3), 0xd8d0c0, side * 0.03, -0.05, 0.03);
  for (let i = 0; i < 4; i++) {
    for (const side of [-1, 1]) {
      // Each leg arches up and out from the body, then down to the ground.
      const hip = pivot(r.torso, side * 0.08, 0.02, 0.06 - i * 0.05);
      hip.rotation.z = side * 2.2;
      hip.rotation.y = side * (0.7 - i * 0.45);
      part(hip, limb(0.24, 0.022, 0.018), leg);
      const knee = pivot(hip, 0, -0.24);
      knee.rotation.z = -side * 1.8;
      part(knee, limb(0.42, 0.018, 0.006), leg);
      r.legs.push({ hip, knee, side, offset: (i + (side > 0 ? 1 : 0)) * Math.PI, splay: side * 2.2 });
    }
  }
  return r;
}

function swift(seed: number): CreatureRig {
  const r = base('crimson_swift', seed);
  const red = 0xc8262a;
  r.torso.position.y = 0.95;
  part(r.torso, new THREE.SphereGeometry(0.08, 10, 8).scale(0.9, 0.85, 1.7), red);
  part(r.torso, new THREE.SphereGeometry(0.06, 8, 6).scale(0.9, 0.7, 1.4), 0xf0d8c0, 0, -0.03, 0.03);
  r.head.position.set(0, 0.04, 0.13);
  part(r.head, new THREE.SphereGeometry(0.055, 8, 6), 0x8a1418);
  part(r.head, new THREE.ConeGeometry(0.018, 0.07, 4).rotateX(Math.PI / 2), 0xf0c040, 0, -0.01, 0.07);
  for (const side of [-1, 1]) part(r.head, new THREE.SphereGeometry(0.012, 5, 4), 0x111111, side * 0.035, 0.015, 0.035);
  for (const side of [-1, 1]) {
    const wing = pivot(r.torso, side * 0.06, 0.03, 0);
    const shape = new THREE.Shape([new THREE.Vector2(0, 0.06), new THREE.Vector2(0.28, 0.0), new THREE.Vector2(0.24, -0.05), new THREE.Vector2(0, -0.07)]);
    const geo = new THREE.ShapeGeometry(shape).rotateX(-Math.PI / 2);
    if (side < 0) geo.scale(-1, 1, 1);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: 0x9a1a1e, side: THREE.DoubleSide }));
    m.castShadow = true;
    wing.add(m);
    r.arms.push(wing);
  }
  const tail = pivot(r.torso, 0, 0, -0.12);
  const fan = new THREE.Mesh(new THREE.ShapeGeometry(new THREE.Shape([new THREE.Vector2(0, 0), new THREE.Vector2(0.06, -0.14), new THREE.Vector2(-0.06, -0.14)])).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x7a1216, side: THREE.DoubleSide }));
  tail.add(fan);
  r.tail.push(tail);
  return r;
}


/**
 * The Cinder Drake: a coal-dark drake twice a man's height, with glowing
 * cracks along its flanks, a long neck, folded wings and a spaded tail.
 */
function drake(seed: number): CreatureRig {
  const r = base('cinder_drake', seed);
  // Built at about a man's height, then scaled up to tower over one.
  r.body.scale.setScalar(1.55);
  const hide = 0x3a1a14;
  const plate = 0x5a2618;
  const belly = 0xa8582a;
  const ember = 0xff7a1a;
  const horn = 0xd8c8a8;
  const membrane = 0x7a2a1a;
  r.torso.position.y = 0.95;
  // Set back on its tile, so the head (not the chest) is over whoever it fights next to.
  r.torso.position.z = -0.45;
  part(r.torso, new THREE.SphereGeometry(0.36, 14, 10).scale(1, 0.85, 1.75), hide);
  part(r.torso, new THREE.SphereGeometry(0.3, 12, 8).scale(0.95, 0.55, 1.6), belly, 0, -0.12, 0.04);
  // Cracks of fire along the flanks.
  for (const side of [-1, 1]) {
    for (let i = 0; i < 4; i++) {
      part(r.torso, new THREE.BoxGeometry(0.02, 0.05 + (i % 2) * 0.03, 0.16), ember, side * 0.35, 0.04 - i * 0.03, 0.28 - i * 0.2, 0xff4a00);
    }
  }
  // Spines down the back.
  for (let i = 0; i < 7; i++) part(r.torso, new THREE.ConeGeometry(0.045, 0.16 - i * 0.012, 5), plate, 0, 0.3 - i * 0.015, 0.45 - i * 0.16);

  // Neck: three segments rising forward from the shoulders.
  let parent: THREE.Object3D = r.torso;
  let y = 0.12;
  let z = 0.5;
  for (let i = 0; i < 3; i++) {
    const seg = pivot(parent, 0, y, z);
    seg.rotation.x = -0.5 + i * 0.25;
    part(seg, new THREE.CylinderGeometry(0.12 - i * 0.015, 0.15 - i * 0.015, 0.3, 8).rotateX(Math.PI / 2).translate(0, 0, 0.15), i % 2 ? plate : hide);
    part(seg, new THREE.ConeGeometry(0.035, 0.1, 4), plate, 0, 0.12 - i * 0.01, 0.12);
    r.neck.push(seg);
    parent = seg;
    y = 0;
    z = 0.28;
  }
  // Head at the end of the neck.
  parent.add(r.head);
  r.head.position.set(0, 0.02, 0.3);
  r.head.rotation.x = 0.35;
  part(r.head, new THREE.BoxGeometry(0.22, 0.16, 0.26), hide, 0, 0.02, 0.02);
  part(r.head, new THREE.BoxGeometry(0.16, 0.1, 0.24), plate, 0, 0.02, 0.24); // snout
  for (const side of [-1, 1]) {
    part(r.head, new THREE.SphereGeometry(0.03, 6, 5), 0xffd040, side * 0.1, 0.07, 0.08, 0xffa000); // eyes
    part(r.head, new THREE.ConeGeometry(0.03, 0.26, 5).rotateX(-Math.PI / 2 - 0.5), horn, side * 0.08, 0.12, -0.1);
    part(r.head, new THREE.ConeGeometry(0.02, 0.14, 4).rotateX(-Math.PI / 2 - 0.2).rotateZ(side * 0.6), horn, side * 0.12, 0.02, -0.08);
    part(r.head, new THREE.SphereGeometry(0.015, 5, 4), 0x1a0a06, side * 0.04, 0.06, 0.36); // nostrils
  }
  const jaw = pivot(r.head, 0, -0.05, 0.08);
  part(jaw, new THREE.BoxGeometry(0.14, 0.05, 0.26), belly, 0, -0.02, 0.12);
  for (const side of [-1, 1]) part(jaw, new THREE.ConeGeometry(0.012, 0.05, 4), 0xf0e8d8, side * 0.05, 0.02, 0.2);
  r.jaw = jaw;
  const mouth = new THREE.Object3D();
  mouth.position.set(0, 0, 0.4);
  r.head.add(mouth);
  r.mouth = mouth;

  // Legs: thick thighs, a backward knee and clawed feet.
  for (const [x, z, offset] of [[-0.24, 0.36, 0], [0.24, 0.36, Math.PI], [-0.24, -0.34, Math.PI], [0.24, -0.34, 0]] as const) {
    const hip = pivot(r.torso, x, -0.12, z);
    part(hip, new THREE.SphereGeometry(0.14, 8, 6).scale(0.8, 1.2, 1), hide, 0, -0.08, 0);
    part(hip, limb(0.42, 0.11, 0.07), hide);
    const knee = pivot(hip, 0, -0.42);
    knee.rotation.x = z > 0 ? -0.2 : 0.3;
    part(knee, limb(0.36, 0.07, 0.05), plate);
    for (const dx of [-0.05, 0, 0.05]) part(knee, new THREE.ConeGeometry(0.02, 0.1, 4).rotateX(Math.PI / 2), horn, dx, -0.38, 0.08);
    r.legs.push({ hip, knee, side: Math.sign(x), offset, splay: 0 });
  }

  // Wings: a bony arm with a membrane fanned behind it, folded along the back at rest.
  for (const side of [-1, 1]) {
    const wing = pivot(r.torso, side * 0.24, 0.24, 0.24);
    part(wing, new THREE.CylinderGeometry(0.03, 0.04, 0.9, 6).rotateZ(Math.PI / 2).translate(side * 0.45, 0, 0), plate);
    part(wing, new THREE.ConeGeometry(0.03, 0.14, 4).rotateZ(-side * Math.PI / 2), horn, side * 0.92, 0, 0);
    const shape = new THREE.Shape([
      new THREE.Vector2(0, 0),
      new THREE.Vector2(0.9, 0),
      new THREE.Vector2(0.75, -0.35),
      new THREE.Vector2(0.55, -0.22),
      new THREE.Vector2(0.4, -0.6),
      new THREE.Vector2(0.2, -0.38),
      new THREE.Vector2(0, -0.55),
    ]);
    // Laid flat with the membrane trailing behind the arm.
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    if (side < 0) geo.scale(-1, 1, 1);
    const m = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: membrane, side: THREE.DoubleSide, flatShading: true }));
    m.castShadow = true;
    wing.add(m);
    r.arms.push(wing);
  }

  // Tail: six tapering segments ending in a spade.
  parent = r.torso;
  z = -0.58;
  for (let i = 0; i < 6; i++) {
    const seg = pivot(parent, 0, i === 0 ? -0.02 : 0, z);
    const len = 0.26 - i * 0.02;
    part(seg, new THREE.ConeGeometry(0.11 - i * 0.016, len, 7).rotateX(-Math.PI / 2).translate(0, 0, -len / 2), i % 2 ? plate : hide);
    if (i < 5) part(seg, new THREE.ConeGeometry(0.025, 0.08, 4), plate, 0, 0.08 - i * 0.012, -len / 2);
    else part(seg, new THREE.ConeGeometry(0.1, 0.18, 4).rotateX(-Math.PI / 2).scale(1, 0.25, 1), plate, 0, 0, -len - 0.06);
    r.tail.push(seg);
    parent = seg;
    z = -len;
  }
  return r;
}

const BUILDERS: Record<CreatureKind, (seed: number) => CreatureRig> = {
  cow,
  desert_lizard: lizard,
  scorpion,
  cave_creeper: creeper,
  crimson_swift: swift,
  cinder_drake: drake,
};

export function isCreature(defKey: string): defKey is CreatureKind {
  return defKey in BUILDERS;
}

export function buildCreature(kind: CreatureKind, seed: number): CreatureRig {
  const rig = BUILDERS[kind](seed);
  rig.root.traverse((o) => (o.castShadow = true));
  return rig;
}

/** How long each one-off move takes (ms). Anything not listed is an attack lunge. */
const SHOT_MS: Record<string, number> = { sting: 750, butt: 700, bite: 550, peck: 500, block: 400 };
/** The drake is big and slow: its moves take longer. */
const DRAKE_SHOT_MS: Record<string, number> = { bite: 750, breath: 1400, block: 550 };
/** When, in a breath, the fire is coming out (fractions of the move). */
export const BREATH_FIRE = { from: 0.3, to: 0.92 };

export function shotMs(rig: CreatureRig, kind: string): number {
  return (rig.kind === 'cinder_drake' ? DRAKE_SHOT_MS[kind] : SHOT_MS[kind]) ?? 600;
}

export function playCreature(rig: CreatureRig, kind: string, now: number): void {
  if (kind !== 'death') rig.oneShot = { kind, start: now };
}

export function creatureBusy(rig: CreatureRig, now: number): boolean {
  return !!rig.oneShot && now - rig.oneShot.start < shotMs(rig, rig.oneShot.kind);
}

/** Gait, idle motion, attacks and death for every creature kind. */
export function animateCreature(rig: CreatureRig, dt: number, now: number, moving: boolean, speed = 1, fighting = false, dead = false): void {
  rig.walk += ((moving ? 1 : 0) - rig.walk) * Math.min(1, dt * 8);
  const stride = rig.kind === 'cinder_drake' ? 1.5 : rig.kind === 'cow' ? 1.2 : 0.6; // seconds per cycle: little legs scurry
  if (rig.walk > 0.01) rig.phase += (dt * Math.PI * 2 * speed) / stride;
  if (rig.kind === 'cinder_drake') return animateDrake(rig, dt, now, fighting, dead);
  const w = rig.walk;
  const t = now / 1000 + rig.seed;

  // Legs: each swings forward and back on its own offset; the knee lifts on the forward swing.
  for (const leg of rig.legs) {
    const s = Math.sin(rig.phase + leg.offset);
    if (leg.splay) {
      leg.hip.rotation.y = (leg.hip.userData.restY ??= leg.hip.rotation.y) + s * 0.35 * w;
      leg.hip.rotation.z = leg.splay - Math.max(0, s) * 0.3 * w * leg.side;
    } else {
      leg.hip.rotation.x = -s * 0.45 * w;
      if (leg.knee) leg.knee.rotation.x = Math.max(0, Math.cos(rig.phase + leg.offset)) * 0.6 * w;
    }
  }

  // Idle life: breathing, a swishing tail, a head that looks about.
  const idle = 1 - w;
  rig.torso.scale.y = 1 + Math.sin(t * 2) * 0.015 * idle;
  rig.head.rotation.y = Math.sin(t * 0.5) * 0.3 * idle * Math.max(0, Math.sin(t * 0.17));
  rig.head.rotation.x = 0;
  rig.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * 2.2 - i * 0.6) * (rig.kind === 'cow' ? 0.35 : 0.15) * (1 + w);
    seg.rotation.x = rig.kind === 'cow' ? 0.25 : 0;
  });
  rig.body.position.set(0, 0, 0);
  rig.torso.rotation.set(0, 0, 0);
  rig.arms.forEach((arm) => (arm.rotation.y = arm.userData.restY ??= arm.rotation.y));

  if (rig.kind === 'scorpion') {
    // Tail held curled over the back, ready; pincers open and close.
    rig.tail.forEach((seg, i) => (seg.rotation.x = -0.55 - (fighting ? 0.1 : 0) + Math.sin(t * 1.5 + i) * 0.03));
    rig.arms.forEach((arm, k) => (arm.rotation.x = Math.sin(t * 3 + k) * 0.08));
  }
  if (rig.kind === 'crimson_swift') {
    // Always on the wing: fast flaps, bobbing flight.
    const flap = Math.sin(t * 22) * 0.9;
    rig.arms.forEach((wing, k) => (wing.rotation.z = (k === 0 ? -1 : 1) * flap));
    rig.body.position.y = Math.sin(t * 2.4) * 0.08;
    rig.torso.rotation.x = -0.15 * w;
  }
  if (rig.kind === 'cave_creeper') rig.torso.position.y = 0.3 + (fighting ? Math.sin(t * 6) * 0.015 : 0);

  // One-off moves.
  if (rig.oneShot) {
    const ms = shotMs(rig, rig.oneShot.kind);
    const u = (now - rig.oneShot.start) / ms;
    if (u >= 1) rig.oneShot = null;
    else if (u >= 0) {
      const k = Math.sin(u * Math.PI);
      const kind = rig.oneShot.kind;
      if (kind === 'block') rig.body.position.z = -0.08 * k;
      else if (kind === 'sting') {
        // Rear back, then whip the stinger over the head.
        const whip = u < 0.4 ? -u / 0.4 : Math.sin(((u - 0.4) / 0.6) * Math.PI);
        rig.tail.forEach((seg) => (seg.rotation.x -= 0.25 * whip));
        rig.torso.rotation.x = 0.15 * whip;
        rig.body.position.z = 0.06 * whip;
      } else if (kind === 'butt') {
        rig.head.rotation.x = 0.6 * k;
        rig.body.position.z = 0.18 * (u < 0.5 ? -k * 0.4 : k);
      } else if (kind === 'peck') {
        rig.body.position.z = 0.35 * k;
        rig.body.position.y -= 0.35 * k;
        rig.torso.rotation.x = 0.5 * k;
      } else {
        // Bite: a quick lunge with the head snapping down.
        rig.body.position.z = 0.15 * k;
        rig.head.rotation.x = 0.35 * k;
        rig.arms.forEach((arm, i) => (arm.rotation.y += (i === 0 ? -1 : 1) * 0.3 * k));
      }
    }
  }

  // Death: roll onto the side (birds drop out of the air first).
  rig.fallen += ((dead ? 1 : 0) - rig.fallen) * Math.min(1, dt * (dead ? 4 : 8));
  if (rig.fallen > 0.001) {
    const f = rig.fallen;
    rig.body.rotation.z = (Math.PI / 2) * f * (rig.kind === 'cow' ? 1 : 1.9);
    rig.body.position.y += rig.kind === 'crimson_swift' ? -0.85 * f : rig.kind === 'cow' ? 0.25 * f : 0.05 * f;
    rig.legs.forEach((leg) => (leg.hip.rotation.x = 0.4 * f));
    if (rig.kind === 'crimson_swift') rig.arms.forEach((wing, k) => (wing.rotation.z = (k === 0 ? -1 : 1) * 0.2 * f));
  } else rig.body.rotation.z = 0;
}

/** Rest angle of a part, remembered the first time it's animated. */
function rest(o: THREE.Object3D, axis: 'x' | 'y' | 'z'): number {
  const key = `rest${axis}`;
  return (o.userData[key] ??= o.rotation[axis]) as number;
}

/**
 * The drake's own motion: a heavy four-legged walk, a swaying neck, wings
 * folded at rest and half-spread to fight, a bite, a rearing fire breath,
 * wings thrown up to block, and a collapse onto its side.
 */
function animateDrake(rig: CreatureRig, dt: number, now: number, fighting: boolean, dead: boolean): void {
  const w = rig.walk;
  const idle = 1 - w;
  const t = now / 1000 + rig.seed;

  for (const leg of rig.legs) {
    const s = Math.sin(rig.phase + leg.offset);
    leg.hip.rotation.x = -s * 0.38 * w;
    if (leg.knee) leg.knee.rotation.x = rest(leg.knee, 'x') + Math.max(0, Math.cos(rig.phase + leg.offset)) * 0.5 * w;
  }
  rig.body.position.set(0, Math.abs(Math.cos(rig.phase)) * 0.05 * w, 0);
  rig.body.rotation.set(0, 0, 0);
  rig.torso.rotation.set(0, Math.sin(rig.phase) * 0.05 * w, 0);
  rig.torso.scale.y = 1 + Math.sin(t * 1.3) * 0.025;

  // Neck sways and looks about; held lower and steadier when fighting.
  const guard = fighting ? 1 : 0;
  rig.neck.forEach((seg, i) => {
    seg.rotation.x = rest(seg, 'x') + Math.sin(t * 0.9 + i * 0.6) * 0.04 + guard * (i === 0 ? 0.25 : -0.05);
    seg.rotation.y = Math.sin(t * 0.35) * 0.14 * idle * (1 - guard) * ((i + 1) / 3);
  });
  rig.head.rotation.x = rest(rig.head, 'x') + guard * 0.1;
  if (rig.jaw) rig.jaw.rotation.x = 0.04 + Math.max(0, Math.sin(t * 0.8)) * 0.06 + guard * 0.08;

  // Wings: folded along the back, half open and beating slowly in a fight.
  const open = 0.15 + 0.45 * guard;
  rig.arms.forEach((wing, k) => {
    const side = k === 0 ? -1 : 1;
    const beat = Math.sin(t * (fighting ? 3 : 1.2) + k * 0.2) * (fighting ? 0.18 : 0.03);
    wing.rotation.y = side * (1.25 - open * 1.6);
    wing.rotation.z = side * (0.35 + open * 0.4 + beat);
    wing.rotation.x = 0;
  });

  rig.tail.forEach((seg, i) => {
    seg.rotation.y = Math.sin(t * (fighting ? 2.4 : 1.1) - i * 0.5) * (0.12 + guard * 0.1) * (1 + w);
    seg.rotation.x = i === 0 ? 0.12 : -0.04;
  });

  if (rig.oneShot) {
    const ms = shotMs(rig, rig.oneShot.kind);
    const u = (now - rig.oneShot.start) / ms;
    if (u >= 1) rig.oneShot = null;
    else if (u >= 0) {
      const k = Math.sin(u * Math.PI);
      const kind = rig.oneShot.kind;
      if (kind === 'breath') {
        // Rear back and draw breath, then thrust the head forward and pour out fire.
        const draw = u < BREATH_FIRE.from ? Math.sin((u / BREATH_FIRE.from) * (Math.PI / 2)) : 1 - (u - BREATH_FIRE.from) / (1 - BREATH_FIRE.from);
        const pour = u < BREATH_FIRE.from ? 0 : Math.sin(((u - BREATH_FIRE.from) / (1 - BREATH_FIRE.from)) * Math.PI);
        rig.neck[0].rotation.x += -0.55 * draw * (u < BREATH_FIRE.from ? 1 : 0) + 0.3 * pour;
        rig.neck[1].rotation.x += -0.2 * draw * (u < BREATH_FIRE.from ? 1 : 0) + 0.1 * pour;
        rig.head.rotation.x += -0.3 * draw * (u < BREATH_FIRE.from ? 1 : 0) - 0.1 * pour;
        rig.torso.rotation.x = -0.12 * draw * (u < BREATH_FIRE.from ? 1 : 0) + 0.05 * pour;
        rig.torso.scale.y += 0.05 * (u < BREATH_FIRE.from ? draw : 0);
        if (rig.jaw) rig.jaw.rotation.x = 0.1 + 0.75 * pour;
        rig.arms.forEach((wing, i) => (wing.rotation.z += (i === 0 ? -1 : 1) * 0.35 * pour));
      } else if (kind === 'block') {
        // Wings thrown up and forward like a shield, the body flinching back.
        rig.arms.forEach((wing, i) => {
          const side = i === 0 ? -1 : 1;
          wing.rotation.y += -side * 0.9 * k;
          wing.rotation.z += side * 0.3 * k;
        });
        rig.body.position.z = -0.1 * k;
        rig.neck[0].rotation.x -= 0.25 * k;
      } else {
        // Bite: the neck snaps forward and down, jaws wide.
        const strike = u < 0.35 ? -u / 0.35 : Math.sin(((u - 0.35) / 0.65) * Math.PI);
        rig.neck[0].rotation.x += 0.45 * strike;
        rig.neck[1].rotation.x += 0.15 * strike;
        rig.head.rotation.x += 0.2 * strike;
        rig.body.position.z = 0.15 * Math.max(0, strike);
        if (rig.jaw) rig.jaw.rotation.x = 0.1 + 0.6 * k * (u < 0.6 ? 1 : 1 - (u - 0.6) / 0.4);
      }
    }
  }

  // Death: the legs give, it rolls onto its side, wings slumped and neck down.
  rig.fallen += ((dead ? 1 : 0) - rig.fallen) * Math.min(1, dt * (dead ? 2.5 : 8));
  if (rig.fallen > 0.001) {
    const f = rig.fallen;
    rig.body.rotation.z = (Math.PI / 2) * 0.85 * f;
    rig.body.position.y += 0.3 * f;
    rig.legs.forEach((leg) => (leg.hip.rotation.x = 0.3 * f));
    rig.neck.forEach((seg) => (seg.rotation.x += 0.35 * f));
    if (rig.jaw) rig.jaw.rotation.x = 0.35 * f;
    rig.arms.forEach((wing, i) => (wing.rotation.z = (i === 0 ? -1 : 1) * -0.3 * f));
  }
}
