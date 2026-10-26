import * as THREE from 'three';

/**
 * Jointed procedural humanoid (~1.15 tiles tall, facing +Z) and its
 * animation. Limbs hang from pivot groups, so a walk cycle is just a few
 * rotations per frame. Purely visual: the simulation only knows tiles.
 */

export interface CharacterStyle {
  tunic: number;
  trim?: number;
  trousers: number;
  boots: number;
  bootCuff?: number;
  belt?: number;
  buckle?: number;
  pouch?: number;
  skin?: number;
  hair?: number;
  hairStyle?: 'short' | 'long' | 'bun' | 'none';
  beard?: number;
  cape?: number;
  hat?: 'cap' | 'chef' | 'hood';
  hatColor?: number;
  apron?: number;
  robe?: number;
  /** Item carried in the right hand. */
  holding?: 'staff' | 'scroll' | 'ladle';
}

export const CHARACTER_STYLES: Record<string, CharacterStyle> = {
  player: {
    tunic: 0x2f5fb3,
    trim: 0xd4a73a,
    trousers: 0x5a4632,
    boots: 0x3a2618,
    bootCuff: 0x6b4a2b,
    belt: 0x5b3a20,
    buckle: 0xe0bb4a,
    pouch: 0x7a5230,
    hair: 0x5a3a1e,
    hairStyle: 'short',
    cape: 0x8a2c2c,
  },
  other_player: {
    tunic: 0xb3412f,
    trim: 0xe8e2d0,
    trousers: 0x3a3a3a,
    boots: 0x2a2a2a,
    belt: 0x222222,
    buckle: 0xb8bcc4,
    hair: 0x2b2b2b,
    hairStyle: 'short',
  },
  town_guide: {
    tunic: 0x2e8b57,
    trim: 0xe0d0a0,
    trousers: 0x3b5a3b,
    boots: 0x4a3020,
    belt: 0x8a6a3a,
    buckle: 0xd4a73a,
    pouch: 0x8a6a3a,
    hair: 0x9a6a3a,
    hairStyle: 'short',
    hat: 'cap',
    hatColor: 0x1f6b3f,
    holding: 'scroll',
  },
  shopkeeper: {
    tunic: 0x7b3fa0,
    trim: 0xd4a73a,
    trousers: 0x3d2b4d,
    boots: 0x3a2618,
    apron: 0xd9ccaa,
    hair: 0x8a6a3a,
    hairStyle: 'short',
    beard: 0x8a6a3a,
  },
  elder_maren: {
    tunic: 0x8a8fb0,
    trim: 0xd8d0b0,
    trousers: 0x6a6f90,
    boots: 0x4a4a5a,
    robe: 0x7c81a3,
    belt: 0xd8d0b0,
    hair: 0xd8d8d8,
    hairStyle: 'bun',
    hat: 'hood',
    hatColor: 0x5f6488,
    holding: 'staff',
  },
  cook_tobin: {
    tunic: 0xf3f3f3,
    trousers: 0x555555,
    boots: 0x2a2a2a,
    apron: 0xffffff,
    hair: 0x5a3a1e,
    hairStyle: 'short',
    beard: 0x5a3a1e,
    hat: 'chef',
    hatColor: 0xffffff,
    holding: 'ladle',
  },
};

export interface CharacterRig {
  root: THREE.Group;
  hips: THREE.Group;
  torso: THREE.Group;
  head: THREE.Group;
  shoulderL: THREE.Group;
  shoulderR: THREE.Group;
  elbowL: THREE.Group;
  elbowR: THREE.Group;
  hipL: THREE.Group;
  hipR: THREE.Group;
  kneeL: THREE.Group;
  kneeR: THREE.Group;
  cape: THREE.Group | null;
  robe: THREE.Object3D | null;
  /** Walk cycle angle in radians. */
  phase: number;
  /** 0 = standing, 1 = full walk; eased so starts and stops blend. */
  walk: number;
  /** Per-character offset so idle motion isn't in sync. */
  seed: number;
}

const HIP_Y = 0.5;
const THIGH = 0.24;
const SHIN = 0.22;
const TORSO = 0.34;
const UPPER_ARM = 0.2;
const FOREARM = 0.18;

const materials = new Map<number, THREE.MeshLambertMaterial>();
function mat(color: number, emissive = 0): THREE.MeshLambertMaterial {
  const key = color * 31 + emissive;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive });
    materials.set(key, m);
  }
  return m;
}

function scaled<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T {
  o.scale.set(x, y, z);
  return o;
}

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/** A tapered limb segment hanging down from its pivot. */
function limb(rTop: number, rBottom: number, length: number, color: number): THREE.Mesh {
  const geo = new THREE.CapsuleGeometry((rTop + rBottom) / 2, length - (rTop + rBottom), 3, 8);
  geo.translate(0, -length / 2, 0);
  return part(geo, color);
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

export function buildCharacter(styleKey: string, seed: number): CharacterRig {
  const s = CHARACTER_STYLES[styleKey] ?? CHARACTER_STYLES.other_player;
  const skin = s.skin ?? 0xe0b48a;
  const root = new THREE.Group();
  const hips = pivot(root, 0, HIP_Y);

  // Pelvis and belt
  hips.add(part(new THREE.CylinderGeometry(0.15, 0.13, 0.12, 10), s.trousers, 0, -0.02));
  if (s.belt) {
    hips.add(part(new THREE.CylinderGeometry(0.162, 0.162, 0.05, 12), s.belt, 0, 0.05));
    if (s.buckle) hips.add(part(new THREE.BoxGeometry(0.06, 0.045, 0.02), s.buckle, 0, 0.05, 0.16, 0x1a1200));
    if (s.pouch) hips.add(part(new THREE.BoxGeometry(0.07, 0.08, 0.05), s.pouch, 0.13, 0.0, 0.08));
  }

  // Legs: hip -> thigh -> knee -> shin -> foot
  const legs = ([-1, 1] as const).map((side) => {
    const hip = pivot(hips, side * 0.075, -0.02);
    hip.add(limb(0.065, 0.055, THIGH, s.trousers));
    const knee = pivot(hip, 0, -THIGH);
    knee.add(limb(0.052, 0.045, SHIN, s.boots));
    if (s.bootCuff) knee.add(part(new THREE.CylinderGeometry(0.058, 0.055, 0.04, 8), s.bootCuff, 0, -0.04));
    const foot = new THREE.BoxGeometry(0.09, 0.06, 0.17);
    knee.add(part(foot, s.boots, 0, -SHIN - 0.0, 0.035));
    return { hip, knee };
  });

  const robe = s.robe ? part(new THREE.CylinderGeometry(0.17, 0.3, 0.5, 12, 1, true), s.robe, 0, -0.23) : null;
  if (robe) {
    (robe.material as THREE.Material).side = THREE.DoubleSide;
    hips.add(robe);
  }

  // Torso, built upward from the hips.
  const torso = pivot(hips, 0, 0.06);
  torso.add(part(new THREE.CylinderGeometry(0.17, 0.15, TORSO, 12).translate(0, TORSO / 2, 0), s.tunic));
  torso.add(scaled(part(new THREE.SphereGeometry(0.172, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), s.tunic, 0, TORSO - 0.02), 1, 0.45, 0.9));
  if (s.trim) {
    torso.add(part(new THREE.CylinderGeometry(0.153, 0.153, 0.035, 12), s.trim, 0, 0.015));
    torso.add(part(new THREE.BoxGeometry(0.04, TORSO * 0.75, 0.02), s.trim, 0, TORSO * 0.55, 0.16));
  }
  if (s.apron) torso.add(part(new THREE.BoxGeometry(0.26, 0.4, 0.02), s.apron, 0, 0.02, 0.165));

  // Head
  const neck = pivot(torso, 0, TORSO + 0.02);
  neck.add(part(new THREE.CylinderGeometry(0.05, 0.06, 0.07, 8), skin, 0, 0.02));
  const head = pivot(neck, 0, 0.14);
  head.add(part(new THREE.SphereGeometry(0.135, 14, 12), skin));
  head.add(scaled(part(new THREE.SphereGeometry(0.035, 8, 6), skin, -0.13, 0, 0), 0.5, 1, 0.8));
  head.add(scaled(part(new THREE.SphereGeometry(0.035, 8, 6), skin, 0.13, 0, 0), 0.5, 1, 0.8));
  for (const x of [-0.048, 0.048]) {
    head.add(part(new THREE.SphereGeometry(0.024, 8, 6), 0xffffff, x, 0.015, 0.118));
    head.add(part(new THREE.SphereGeometry(0.014, 6, 4), 0x2a2018, x, 0.015, 0.136));
    head.add(part(new THREE.BoxGeometry(0.05, 0.012, 0.015), s.hair ?? 0x3a2a1a, x, 0.05, 0.125));
  }
  head.add(part(new THREE.ConeGeometry(0.022, 0.05, 5).rotateX(Math.PI / 2), 0xd09a70, 0, -0.01, 0.145));
  head.add(part(new THREE.BoxGeometry(0.05, 0.01, 0.01), 0x9a5a4a, 0, -0.055, 0.125));
  if (s.hair && s.hairStyle !== 'none') {
    head.add(part(new THREE.SphereGeometry(0.143, 14, 8, 0, Math.PI * 2, 0, Math.PI / 2.1), s.hair, 0, 0.012, -0.01));
    head.add(part(new THREE.BoxGeometry(0.2, 0.04, 0.05), s.hair, 0, 0.085, 0.1).rotateX(-0.3)); // fringe
    if (s.hairStyle === 'long') head.add(part(new THREE.BoxGeometry(0.24, 0.2, 0.08), s.hair, 0, -0.06, -0.09));
    if (s.hairStyle === 'bun') head.add(part(new THREE.SphereGeometry(0.06, 8, 6), s.hair, 0, 0.06, -0.15));
  }
  if (s.beard) head.add(part(new THREE.SphereGeometry(0.1, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), s.beard, 0, -0.03, 0.05));
  if (s.hat === 'cap') {
    head.add(part(new THREE.CylinderGeometry(0.145, 0.15, 0.07, 12), s.hatColor!, 0, 0.11));
    head.add(part(new THREE.BoxGeometry(0.18, 0.015, 0.1), s.hatColor!, 0, 0.08, 0.13));
  }
  if (s.hat === 'chef') {
    head.add(part(new THREE.CylinderGeometry(0.13, 0.12, 0.09, 12), s.hatColor!, 0, 0.12));
    head.add(scaled(part(new THREE.SphereGeometry(0.16, 12, 8), s.hatColor!, 0, 0.24), 1, 0.8, 1));
  }
  if (s.hat === 'hood') head.add(part(new THREE.SphereGeometry(0.165, 14, 8, 0, Math.PI * 2, 0, Math.PI / 1.65), s.hatColor!, 0, 0.0, -0.025));

  // Arms: shoulder -> upper arm -> elbow -> forearm -> hand
  const arms = ([-1, 1] as const).map((side) => {
    const shoulder = pivot(torso, side * 0.205, TORSO - 0.04);
    shoulder.add(part(new THREE.SphereGeometry(0.06, 8, 6), s.tunic));
    shoulder.add(limb(0.05, 0.045, UPPER_ARM, s.tunic));
    const elbow = pivot(shoulder, 0, -UPPER_ARM);
    elbow.add(limb(0.042, 0.036, FOREARM, s.tunic));
    if (s.trim) elbow.add(part(new THREE.CylinderGeometry(0.045, 0.045, 0.03, 8), s.trim, 0, -FOREARM + 0.04));
    elbow.add(part(new THREE.SphereGeometry(0.04, 8, 6), skin, 0, -FOREARM - 0.02));
    return { shoulder, elbow };
  });

  // Held item in the right hand
  const hand = arms[1].elbow;
  if (s.holding === 'staff') {
    hand.add(part(new THREE.CylinderGeometry(0.022, 0.026, 1.25, 6), 0x7a5230, 0, -FOREARM + 0.15, 0.02));
    hand.add(part(new THREE.OctahedronGeometry(0.06), 0x8fe0ff, 0, -FOREARM + 0.8, 0.02, 0x2a6aa0));
  }
  if (s.holding === 'scroll') hand.add(part(new THREE.CylinderGeometry(0.03, 0.03, 0.22, 8).rotateX(Math.PI / 2), 0xeee0b8, 0, -FOREARM - 0.02, 0.06));
  if (s.holding === 'ladle') {
    hand.add(part(new THREE.CylinderGeometry(0.01, 0.01, 0.3, 5), 0x8a6a3a, 0, -FOREARM - 0.1, 0.02));
    hand.add(part(new THREE.SphereGeometry(0.05, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x9a9a9a, 0, -FOREARM - 0.26, 0.02));
  }

  // Cape hangs from the shoulders and trails when walking.
  let cape: THREE.Group | null = null;
  if (s.cape) {
    cape = pivot(torso, 0, TORSO - 0.01, -0.15);
    const cloth = new THREE.PlaneGeometry(0.34, 0.62, 1, 4).translate(0, -0.31, 0);
    // Taper and curve the cloth slightly.
    const pos = cloth.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const t = -y / 0.62;
      pos.setX(i, pos.getX(i) * (0.85 + t * 0.35));
      pos.setZ(i, -Math.abs(pos.getX(i)) * 0.25);
    }
    cloth.computeVertexNormals();
    const capeMesh = new THREE.Mesh(cloth, new THREE.MeshLambertMaterial({ color: s.cape, side: THREE.DoubleSide }));
    capeMesh.castShadow = true;
    cape.add(capeMesh);
    torso.add(part(new THREE.BoxGeometry(0.3, 0.04, 0.05), s.trim ?? s.cape, 0, TORSO - 0.01, -0.12));
  }

  root.traverse((o) => (o.castShadow = true));
  return {
    root,
    hips,
    torso,
    head,
    shoulderL: arms[0].shoulder,
    shoulderR: arms[1].shoulder,
    elbowL: arms[0].elbow,
    elbowR: arms[1].elbow,
    hipL: legs[0].hip,
    hipR: legs[1].hip,
    kneeL: legs[0].knee,
    kneeR: legs[1].knee,
    cape,
    robe,
    phase: 0,
    walk: 0,
    seed,
  };
}

/** One full stride (two steps) per 1.2 s, matching one tile per 0.6 s tick. */
const STRIDE_RATE = (Math.PI * 2) / 1.2;

/**
 * Advance a rig. `moving` says whether the entity is between tiles this
 * frame; `speed` scales the stride (diagonal steps cover more ground).
 */
export function animateCharacter(rig: CharacterRig, dt: number, now: number, moving: boolean, speed = 1): void {
  rig.walk += ((moving ? 1 : 0) - rig.walk) * Math.min(1, dt * 8);
  if (rig.walk > 0.01) rig.phase += dt * STRIDE_RATE * speed;
  else rig.phase = 0;
  const w = rig.walk;
  const idle = 1 - w;
  const t = now / 1000 + rig.seed;
  const s = Math.sin(rig.phase);
  const c = Math.cos(rig.phase);

  // Legs swing opposite each other; the knee bends as the leg passes under.
  rig.hipL.rotation.x = -s * 0.55 * w;
  rig.hipR.rotation.x = s * 0.55 * w;
  rig.kneeL.rotation.x = Math.max(0, c) * 0.8 * w + 0.02;
  rig.kneeR.rotation.x = Math.max(0, -c) * 0.8 * w + 0.02;

  // Arms counter-swing; elbows stay a little bent.
  const breathe = Math.sin(t * 1.8) * 0.03 * idle;
  rig.shoulderL.rotation.x = s * 0.5 * w + breathe;
  rig.shoulderR.rotation.x = -s * 0.5 * w + breathe;
  rig.shoulderL.rotation.z = -0.08 - 0.04 * idle;
  rig.shoulderR.rotation.z = 0.08 + 0.04 * idle;
  rig.elbowL.rotation.x = -0.25 - 0.35 * w - Math.max(0, s) * 0.3 * w;
  rig.elbowR.rotation.x = -0.25 - 0.35 * w - Math.max(0, -s) * 0.3 * w;

  // Body: bob twice per stride, lean into the walk, slight twist, breathing at rest.
  rig.hips.position.y = HIP_Y + Math.abs(c) * 0.035 * w - 0.01 * w;
  rig.hips.rotation.y = s * 0.12 * w;
  rig.torso.rotation.y = -s * 0.2 * w;
  rig.torso.rotation.x = 0.08 * w;
  rig.torso.scale.y = 1 + Math.sin(t * 1.8) * 0.012 * idle;
  rig.head.rotation.y = s * 0.08 * w + Math.sin(t * 0.45) * 0.35 * idle * Math.max(0, Math.sin(t * 0.13));
  rig.head.rotation.x = -0.05 * w + Math.sin(t * 0.7) * 0.03 * idle;

  if (rig.cape) rig.cape.rotation.x = 0.06 + 0.45 * w + Math.sin(rig.phase * 2) * 0.06 * w + Math.sin(t * 1.3) * 0.02;
  if (rig.robe) rig.robe.rotation.z = s * 0.06 * w;
}
