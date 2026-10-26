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
  holding?: 'staff' | 'scroll' | 'ladle' | 'club';
  /** Worn and wielded gear, as metal colours. */
  helm?: number;
  shield?: number;
  weapon?: { kind: WeaponKind; color: number };
  /** Overall size; goblins are small. */
  scale?: number;
  /** Eyes that glow this colour (skeletons, spirits). */
  glowEyes?: number;
  /** A ghost: see-through, no legs, drifting. */
  ghost?: boolean;
  /** Bare bones: ribs over the chest, no nose or ears. */
  bones?: boolean;
}

type WeaponKind = 'dagger' | 'sword' | 'scimitar' | 'axe' | 'pickaxe';

/** Colours for each metal tier, used on worn gear. */
export const METALS: Record<string, number> = { bronze: 0xb8793a, iron: 0x7d7f86, steel: 0xb4bec8 };

/**
 * A look with gear on top: helmets and shields are added, a chainbody
 * replaces the tunic and platelegs the trousers.
 */
export function withGear(base: CharacterStyle, gear: Partial<Record<string, string>> | undefined): CharacterStyle {
  if (!gear) return base;
  const metal = (id: string | undefined) => (id ? METALS[id.split('_')[0]] : undefined);
  const s: CharacterStyle = { ...base };
  if (gear.helmet) [s.helm, s.hat, s.hairStyle] = [metal(gear.helmet), undefined, 'none'];
  if (gear.shield) s.shield = metal(gear.shield);
  if (gear.body) [s.tunic, s.trim] = [shadeHex(metal(gear.body)!, 0.82), metal(gear.body)];
  if (gear.legs) [s.trousers, s.bootCuff] = [shadeHex(metal(gear.legs)!, 0.9), undefined];
  if (gear.weapon) s.weapon = { kind: weaponKind(gear.weapon), color: metal(gear.weapon) ?? 0x9a9ca4 };
  return s;
}

function weaponKind(itemId: string): WeaponKind {
  if (itemId.endsWith('pickaxe')) return 'pickaxe';
  if (itemId.endsWith('axe')) return 'axe';
  return itemId.endsWith('dagger') ? 'dagger' : 'sword';
}

function shadeHex(hex: number, k: number): number {
  const c = new THREE.Color(hex).multiplyScalar(k);
  return c.getHex();
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
  aldric: {
    tunic: 0x6b3a22,
    trousers: 0x3a2a1e,
    boots: 0x2a1a10,
    apron: 0x4a3a2a,
    belt: 0x2a1a10,
    buckle: 0xb8bcc4,
    hair: 0x2b2018,
    hairStyle: 'short',
    beard: 0x2b2018,
  },
  banker: {
    tunic: 0x1f3f6a,
    trim: 0xd4a73a,
    trousers: 0x1a1a2a,
    boots: 0x1a1a1a,
    belt: 0x2a2a2a,
    buckle: 0xd4a73a,
    hair: 0x4a4a4a,
    hairStyle: 'short',
    holding: 'scroll',
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
  priest: {
    tunic: 0xe8e2d0,
    trim: 0xd4a73a,
    trousers: 0x6a6252,
    boots: 0x3a3028,
    robe: 0xf0ead8,
    belt: 0x8a7a52,
    hair: 0x8a8a8a,
    hairStyle: 'short',
    hat: 'hood',
    hatColor: 0xe8e2d0,
  },
  noble: {
    tunic: 0x5b2a6a,
    trim: 0xe8c04a,
    trousers: 0x2a1a3a,
    boots: 0x2a1a10,
    robe: 0x6b3a7a,
    belt: 0x3a2a1a,
    buckle: 0xe8c04a,
    hair: 0x3a2a1a,
    hairStyle: 'short',
    cape: 0x7a1f3a,
  },
  guard: {
    tunic: 0x8a8f99,
    trim: 0xd4a73a,
    trousers: 0x3a3f49,
    boots: 0x2a2a2a,
    belt: 0x2a2a2a,
    buckle: 0xb8bcc4,
    hair: 0x3a2a1a,
    hairStyle: 'short',
    hat: 'cap',
    hatColor: 0x9aa0aa,
    holding: 'staff',
  },
  ranger: {
    tunic: 0x3f6a3a,
    trim: 0x8a6a3a,
    trousers: 0x4a3a28,
    boots: 0x2f2318,
    belt: 0x5b3a20,
    pouch: 0x7a5230,
    hair: 0x6a4a2a,
    hairStyle: 'short',
    hat: 'hood',
    hatColor: 0x35592f,
  },
  goblin: {
    tunic: 0x6b5a3a,
    trousers: 0x4a3a28,
    boots: 0x3a2a1a,
    belt: 0x2a1a10,
    skin: 0x7fa64a,
    hairStyle: 'none',
    holding: 'club',
    scale: 0.78,
  },
  skeleton: {
    tunic: 0xe6dfc8,
    trousers: 0xe6dfc8,
    boots: 0xd8d0b8,
    skin: 0xe6dfc8,
    hairStyle: 'none',
    glowEyes: 0xff5a2a,
    bones: true,
    weapon: { kind: 'sword', color: 0x7a6a5a },
  },
  falcrest_guard: {
    tunic: 0x6a6f7a,
    trim: 0x2f4f8a,
    trousers: 0x3a3f49,
    boots: 0x2a2a2a,
    belt: 0x2a2a2a,
    buckle: 0xd4a73a,
    hair: 0x3a2a1a,
    hairStyle: 'none',
    helm: 0x8a8f99,
    shield: 0x2f4f8a,
    weapon: { kind: 'sword', color: 0x9a9ca4 },
    cape: 0x2f4f8a,
  },
  desert_bandit: {
    tunic: 0xc8a878,
    trim: 0x8a2c2c,
    trousers: 0x6a5238,
    boots: 0x4a3020,
    belt: 0x8a2c2c,
    skin: 0xb07a52,
    hair: 0x1a1410,
    hairStyle: 'short',
    beard: 0x1a1410,
    hat: 'hood',
    hatColor: 0xd8c8a0,
    weapon: { kind: 'scimitar', color: 0xb4bec8 },
  },
  storm_druid: {
    tunic: 0x3a4a6a,
    trim: 0x8fd0ff,
    trousers: 0x2a3348,
    boots: 0x2a2a2a,
    robe: 0x34405e,
    belt: 0x8fd0ff,
    hair: 0xc8c8c8,
    hairStyle: 'long',
    beard: 0xc8c8c8,
    hat: 'hood',
    hatColor: 0x2a3550,
    holding: 'staff',
  },
  wailing_spirit: {
    tunic: 0xbfd8e8,
    trousers: 0xbfd8e8,
    boots: 0xbfd8e8,
    robe: 0xa8c8dc,
    skin: 0xd8eaf4,
    hair: 0xe8f4fa,
    hairStyle: 'long',
    glowEyes: 0x6ae0ff,
    ghost: true,
  },
  farmer: {
    tunic: 0xc8a85a,
    trousers: 0x6a5a3a,
    boots: 0x4a3020,
    apron: 0xd9ccaa,
    belt: 0x6a4a2a,
    hair: 0xc8b070,
    hairStyle: 'short',
    hat: 'cap',
    hatColor: 0xd8c070,
  },
};

/**
 * The look an NPC gets from what the map calls them. The world has dozens of
 * named people, so they share a handful of looks rather than one each.
 */
const STYLE_BY_ROLE: Record<string, string> = {
  Shopkeeper: 'shopkeeper',
  'Stall holder': 'shopkeeper',
  'Trade clerk': 'banker',
  Banker: 'banker',
  Librarian: 'elder_maren',
  Priest: 'priest',
  Swordsmith: 'aldric',
  Smith: 'aldric',
  Smelter: 'aldric',
  Armourer: 'aldric',
  'Scimitar seller': 'aldric',
  Tanner: 'aldric',
  'Sawmill operator': 'aldric',
  Shipwright: 'aldric',
  Barkeep: 'cook_tobin',
  'Head chef': 'cook_tobin',
  'Castle cook': 'cook_tobin',
  Apothecary: 'elder_maren',
  'Herb witch': 'elder_maren',
  'Glyph merchant': 'elder_maren',
  'Glyphcraft tutor': 'elder_maren',
  'Master crafter': 'shopkeeper',
  'Gem trader': 'shopkeeper',
  Fletcher: 'ranger',
  'Hunter supplier': 'ranger',
  'Range master': 'ranger',
  'Fishing supplier': 'ranger',
  'Farming supplier': 'farmer',
  'Farming tools': 'farmer',
  'Agility trainer': 'guard',
  'Combat instructor': 'guard',
  'Bounty master': 'guard',
  Archaeologist: 'town_guide',
  'Estate agent': 'town_guide',
  'Ruler of Kelmoor': 'noble',
  'Ruler of Qadir': 'noble',
  'Lord of Falcrest': 'noble',
  'Lord of Brightwater': 'noble',
};

/** Which look to build for an NPC: their own if they have one, else their role's. */
export function styleForNpc(key: string, role: string | undefined): string {
  if (CHARACTER_STYLES[key]) return key;
  if (role && STYLE_BY_ROLE[role]) return STYLE_BY_ROLE[role];
  if (role?.includes('guard')) return 'guard';
  return 'town_guide';
}

export interface CharacterRig {
  root: THREE.Group;
  /** Everything above the feet; tips over when the character dies. */
  body: THREE.Group;
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
  /** Tools held while working (axe, pickaxe, net...), each hidden until used. Players only. */
  tools: Map<string, THREE.Object3D>;
  /** 0 = not working, 1 = fully into the activity's pose; eased like `walk`. */
  work: number;
  /** The activity being animated; kept while `work` eases back to 0. */
  activity: string | null;
  /** Walk cycle angle in radians. */
  phase: number;
  /** 0 = standing, 1 = full walk; eased so starts and stops blend. */
  walk: number;
  /** Per-character offset so idle motion isn't in sync. */
  seed: number;
  /** Wielded weapon, hidden while a tool is out. */
  weapon: THREE.Object3D | null;
  /** A one-off animation (attack, block, eat) playing over everything else. */
  oneShot: { kind: string; start: number } | null;
  /** 0 = standing, 1 = lying dead. */
  fallen: number;
  ghost: boolean;
}

// Proportions: about 1.2 tiles tall and seven heads high.
const HIP_Y = 0.61;
const THIGH = 0.29;
const SHIN = 0.27;
const WAIST = 0.06;
const TORSO = 0.3;
const UPPER_ARM = 0.24;
const FOREARM = 0.21;

const materials = new Map<string, THREE.MeshLambertMaterial>();
function mat(color: number, emissive = 0, doubleSided = false): THREE.MeshLambertMaterial {
  const key = `${color}|${emissive}|${doubleSided}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({ color, emissive, side: doubleSided ? THREE.DoubleSide : THREE.FrontSide });
    materials.set(key, m);
  }
  return m;
}

function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, emissive = 0): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}

/**
 * One ring of a body-part profile: height, half-width (x), half-depth (z)
 * and an optional forward offset (z), so a calf can bulge backward or a jaw
 * jut forward. Elliptical cross-sections read as human instead of tubes.
 */
type Ring = [y: number, halfWidth: number, halfDepth: number, zOffset?: number];

function profiled(rings: Ring[], radial = 12, open = false): THREE.BufferGeometry {
  const positions: number[] = [];
  const indices: number[] = [];
  for (const [y, hw, hd, zo = 0] of rings) {
    for (let k = 0; k < radial; k++) {
      const a = (k / radial) * Math.PI * 2;
      positions.push(Math.sin(a) * hw, y, Math.cos(a) * hd + zo);
    }
  }
  for (let r = 0; r < rings.length - 1; r++) {
    for (let k = 0; k < radial; k++) {
      const a = r * radial + k;
      const b = r * radial + ((k + 1) % radial);
      const c = a + radial;
      const d = b + radial;
      if (rings[r + 1][0] > rings[r][0]) indices.push(a, b, d, a, d, c);
      else indices.push(a, d, b, a, c, d);
    }
  }
  if (!open) {
    // Cap both ends with a centre vertex.
    for (const [ri, flip] of [[0, true], [rings.length - 1, false]] as const) {
      const [y, , , zo = 0] = rings[ri];
      const centre = positions.length / 3;
      positions.push(0, y, zo);
      const up = rings[rings.length - 1][0] > rings[0][0];
      for (let k = 0; k < radial; k++) {
        const a = ri * radial + k;
        const b = ri * radial + ((k + 1) % radial);
        if (flip === up) indices.push(centre, b, a);
        else indices.push(centre, a, b);
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function pivot(parent: THREE.Object3D, x: number, y: number, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

// Shared body-part shapes (y = 0 at the joint they hang from or sit on).
const SHAPES = {
  pelvis: profiled([[-0.09, 0.1, 0.07], [-0.05, 0.128, 0.082], [0.0, 0.13, 0.083], [0.06, 0.118, 0.078]]),
  torso: profiled([
    [0, 0.118, 0.078],
    [0.06, 0.124, 0.08, 0.004],
    [0.13, 0.148, 0.092, 0.01],
    [0.2, 0.162, 0.094, 0.008],
    [0.25, 0.165, 0.084],
    [0.285, 0.13, 0.066, -0.005],
    [TORSO, 0.06, 0.05, -0.005],
  ], 14),
  neck: profiled([[0, 0.036, 0.038], [0.08, 0.032, 0.034, 0.004]], 10),
  head: profiled([
    [0.0, 0.026, 0.026, 0.035],
    [0.02, 0.048, 0.05, 0.028],
    [0.045, 0.062, 0.068, 0.014],
    [0.08, 0.07, 0.08, 0.004],
    [0.115, 0.073, 0.084, 0],
    [0.145, 0.068, 0.08, -0.004],
    [0.17, 0.052, 0.064, -0.008],
    [0.188, 0.026, 0.034, -0.01],
    [0.194, 0.004, 0.004, -0.01],
  ], 14),
  hair: profiled([
    [0.09, 0.077, 0.089, -0.006],
    [0.12, 0.08, 0.091, -0.005],
    [0.15, 0.075, 0.087, -0.008],
    [0.175, 0.058, 0.07, -0.01],
    [0.194, 0.032, 0.042, -0.012],
    [0.203, 0.004, 0.004, -0.012],
  ], 14),
  thigh: profiled([[-THIGH, 0.044, 0.048], [-0.2, 0.054, 0.058, 0.004], [-0.07, 0.066, 0.072, 0.006], [0, 0.066, 0.07]]),
  shin: profiled([[-SHIN, 0.032, 0.034], [-0.19, 0.038, 0.044, -0.006], [-0.1, 0.048, 0.056, -0.012], [0, 0.044, 0.048]]),
  boot: profiled([[-SHIN - 0.005, 0.042, 0.044], [-0.16, 0.047, 0.05, -0.004], [-0.11, 0.054, 0.058, -0.008]]),
  upperArm: profiled([[-UPPER_ARM, 0.033, 0.034], [-0.12, 0.042, 0.042], [0, 0.048, 0.05]]),
  forearm: profiled([[-FOREARM, 0.026, 0.02], [-0.12, 0.036, 0.032], [0, 0.036, 0.034]]),
  cuff: profiled([[-FOREARM + 0.005, 0.031, 0.026], [-FOREARM + 0.04, 0.034, 0.03]]),
  hand: (() => {
    const g = new THREE.BoxGeometry(0.045, 0.085, 0.026);
    g.translate(0, -0.045, 0);
    return g;
  })(),
  thumb: new THREE.BoxGeometry(0.016, 0.04, 0.018),
  foot: profiled([[-0.03, 0.038, 0.035, 0.0], [0.03, 0.04, 0.08, 0.04], [0.05, 0.036, 0.075, 0.035]]),
  hem: profiled([[0.02, 0.124, 0.084], [-0.06, 0.14, 0.095], [-0.13, 0.152, 0.104]], 14, true),
  robe: profiled([[0.02, 0.124, 0.084], [-0.2, 0.17, 0.13], [-0.56, 0.22, 0.17]], 16, true),
};

/** Builds a character from a named look or a look of its own; `tools` gives it the skilling tools players carry. */
export function buildCharacter(style: string | CharacterStyle, seed: number, tools_ = false): CharacterRig {
  const s = typeof style === 'string' ? (CHARACTER_STYLES[style] ?? CHARACTER_STYLES.other_player) : style;
  const skin = s.skin ?? 0xd9a77e;
  const root = new THREE.Group();
  const body = pivot(root, 0, 0);
  if (s.scale) body.scale.setScalar(s.scale);
  const hips = pivot(body, 0, HIP_Y);

  hips.add(part(SHAPES.pelvis, s.trousers));

  // Legs: hip -> thigh -> knee -> shin/boot -> foot
  const legs = ([-1, 1] as const).map((side) => {
    const hip = pivot(hips, side * 0.07, -0.03);
    hip.add(part(SHAPES.thigh, s.trousers));
    const knee = pivot(hip, 0, -THIGH);
    knee.add(part(SHAPES.shin, s.trousers));
    knee.add(part(SHAPES.boot, s.boots));
    if (s.bootCuff) knee.add(part(profiled([[-0.115, 0.056, 0.06, -0.008], [-0.095, 0.058, 0.062, -0.008]]), s.bootCuff));
    knee.add(part(SHAPES.foot, s.boots, 0, -0.26, 0.0));
    return { hip, knee };
  });

  // Torso from the waist up, with the tunic hem flaring over the hips.
  const torso = pivot(hips, 0, WAIST);
  torso.add(part(SHAPES.torso, s.tunic));
  const hem = new THREE.Mesh(s.robe ? SHAPES.robe : SHAPES.hem, mat(s.robe ?? s.tunic, 0, true));
  hem.castShadow = true;
  hips.add(hem);
  hem.position.y = WAIST;
  const robe = s.robe ? hem : null;
  if (s.trim) {
    torso.add(part(profiled([[0.0, 0.122, 0.082], [0.025, 0.124, 0.083]], 14), s.trim));
    hips.add(part(profiled([[WAIST - 0.13, 0.154, 0.106], [WAIST - 0.115, 0.152, 0.104]], 14), s.trim));
    torso.add(part(new THREE.BoxGeometry(0.03, 0.2, 0.012), s.trim, 0, 0.17, 0.097));
  }
  if (s.belt) {
    torso.add(part(profiled([[-0.005, 0.124, 0.084], [0.03, 0.126, 0.086]], 14), s.belt));
    if (s.buckle) torso.add(part(new THREE.BoxGeometry(0.045, 0.032, 0.012), s.buckle, 0, 0.012, 0.088, 0x1a1200));
    if (s.pouch) torso.add(part(new THREE.BoxGeometry(0.055, 0.065, 0.035), s.pouch, 0.11, -0.03, 0.06));
  }
  if (s.apron) {
    torso.add(part(new THREE.BoxGeometry(0.2, 0.24, 0.01), s.apron, 0, 0.1, 0.096));
    hips.add(part(new THREE.BoxGeometry(0.23, 0.28, 0.01), s.apron, 0, WAIST - 0.12, 0.1));
  }

  // Neck and head
  const neck = pivot(torso, 0, TORSO - 0.02);
  neck.add(part(SHAPES.neck, skin));
  const head = pivot(neck, 0, 0.065);
  head.add(part(SHAPES.head, skin));
  const ear = new THREE.BoxGeometry(0.014, 0.04, 0.028);
  head.add(part(ear, skin, -0.073, 0.095, -0.005), part(ear, skin, 0.073, 0.095, -0.005));
  for (const x of [-0.03, 0.03]) {
    if (s.glowEyes !== undefined) {
      if (s.bones) head.add(part(new THREE.BoxGeometry(0.034, 0.03, 0.01), 0x1a1410, x, 0.104, 0.078));
      head.add(part(new THREE.BoxGeometry(0.014, 0.012, 0.012), s.glowEyes, x, 0.104, 0.082, s.glowEyes));
      continue;
    }
    head.add(part(new THREE.BoxGeometry(0.022, 0.011, 0.006), 0xf4efe6, x, 0.104, 0.08));
    head.add(part(new THREE.BoxGeometry(0.01, 0.011, 0.007), 0x2a2018, x, 0.104, 0.081));
    head.add(part(new THREE.BoxGeometry(0.03, 0.007, 0.01), s.hair ?? 0x3a2a1a, x, 0.122, 0.079));
  }
  if (s.bones) {
    // Grinning teeth and a ribcage over the chest.
    head.add(part(new THREE.BoxGeometry(0.06, 0.016, 0.01), 0xf4efe0, 0, 0.045, 0.074));
    for (let k = 0; k < 4; k++) torso.add(part(profiled([[0.08 + k * 0.045, 0.15 - k * 0.006, 0.096], [0.095 + k * 0.045, 0.152 - k * 0.006, 0.098]], 14), 0x3a3428));
    torso.add(part(new THREE.BoxGeometry(0.03, 0.22, 0.012), 0xf4efe0, 0, 0.16, 0.099));
  } else {
    const nose = new THREE.ConeGeometry(0.013, 0.045, 4).rotateX(Math.PI / 2 + 0.5);
    head.add(part(nose, skin, 0, 0.082, 0.088));
    head.add(part(new THREE.BoxGeometry(0.03, 0.006, 0.006), 0x9a5a4a, 0, 0.05, 0.072));
  }
  if (s.skin === CHARACTER_STYLES.goblin.skin) {
    // Long pointed ears and a big nose.
    for (const side of [-1, 1]) head.add(part(new THREE.ConeGeometry(0.02, 0.1, 4).rotateZ(-side * 1.2), skin, side * 0.1, 0.11, -0.01));
    head.add(part(new THREE.ConeGeometry(0.02, 0.07, 5).rotateX(Math.PI / 2 + 0.3), skin, 0, 0.08, 0.1));
  }
  if (s.hair && s.hairStyle !== 'none') {
    head.add(part(SHAPES.hair, s.hair));
    // Back of the head down to the nape.
    head.add(part(profiled([[0.04, 0.064, 0.05, -0.04], [0.1, 0.076, 0.06, -0.035]], 12), s.hair));
    if (s.hairStyle === 'long') head.add(part(new THREE.BoxGeometry(0.15, 0.16, 0.04), s.hair, 0, 0.02, -0.07));
    if (s.hairStyle === 'bun') head.add(part(new THREE.SphereGeometry(0.035, 8, 6), s.hair, 0, 0.17, -0.08));
  }
  if (s.beard) head.add(part(profiled([[0.0, 0.03, 0.03, 0.04], [0.03, 0.055, 0.05, 0.03], [0.07, 0.068, 0.07, 0.012]], 12), s.beard));
  if (s.hat === 'cap') {
    head.add(part(profiled([[0.15, 0.08, 0.092, -0.004], [0.2, 0.065, 0.078, -0.006], [0.215, 0.002, 0.002, -0.006]], 12), s.hatColor!));
    head.add(part(new THREE.BoxGeometry(0.12, 0.008, 0.06), s.hatColor!, 0, 0.155, 0.1));
  }
  if (s.hat === 'chef') {
    head.add(part(profiled([[0.15, 0.08, 0.09], [0.2, 0.078, 0.088]], 12), s.hatColor!));
    head.add(part(profiled([[0.2, 0.08, 0.088], [0.25, 0.1, 0.1], [0.29, 0.09, 0.09], [0.305, 0.01, 0.01]], 12), s.hatColor!));
  }
  if (s.helm !== undefined) {
    head.add(part(profiled([[0.06, 0.082, 0.094, -0.004], [0.13, 0.083, 0.095, -0.004], [0.18, 0.068, 0.08, -0.006], [0.215, 0.03, 0.036, -0.008], [0.224, 0.002, 0.002, -0.008]], 12), s.helm));
    head.add(part(new THREE.BoxGeometry(0.02, 0.07, 0.02), s.helm, 0, 0.09, 0.094)); // nose guard
    head.add(part(new THREE.BoxGeometry(0.17, 0.016, 0.17), shadeHex(s.helm, 0.8), 0, 0.13, -0.004));
  }
  if (s.hat === 'hood') head.add(part(profiled([[0.02, 0.085, 0.07, -0.04], [0.1, 0.088, 0.1, -0.008], [0.17, 0.07, 0.08, -0.012], [0.215, 0.004, 0.004, -0.015]], 14), s.hatColor!));

  // Arms: shoulder -> upper arm -> elbow -> forearm -> hand
  const arms = ([-1, 1] as const).map((side) => {
    const shoulder = pivot(torso, side * 0.165, TORSO - 0.05);
    shoulder.add(part(profiled([[-0.05, 0.048, 0.05], [0.0, 0.055, 0.056], [0.03, 0.035, 0.04]], 10), s.tunic));
    shoulder.add(part(SHAPES.upperArm, s.tunic));
    const elbow = pivot(shoulder, 0, -UPPER_ARM);
    elbow.add(part(SHAPES.forearm, s.tunic));
    if (s.trim) elbow.add(part(SHAPES.cuff, s.trim));
    const hand = pivot(elbow, 0, -FOREARM);
    hand.add(part(SHAPES.hand, skin));
    hand.add(part(SHAPES.thumb, skin, -side * 0.026, -0.03, 0.01));
    return { shoulder, elbow, hand };
  });

  // Held item in the right hand
  const grip = arms[1].hand;
  if (s.holding === 'staff') {
    grip.add(part(new THREE.CylinderGeometry(0.016, 0.02, 1.3, 6), 0x7a5230, 0, 0.12, 0.02));
    grip.add(part(new THREE.OctahedronGeometry(0.05), 0x8fe0ff, 0, 0.8, 0.02, 0x2a6aa0));
  }
  if (s.holding === 'scroll') grip.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 8).rotateX(Math.PI / 2), 0xeee0b8, 0, -0.06, 0.03));
  if (s.holding === 'ladle') {
    grip.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 5), 0x8a6a3a, 0, -0.12, 0.02));
    grip.add(part(new THREE.SphereGeometry(0.04, 8, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x9a9a9a, 0, -0.26, 0.02));
  }

  if (s.holding === 'club') {
    const club = new THREE.Group();
    club.add(part(new THREE.CylinderGeometry(0.045, 0.02, 0.42, 6).translate(0, 0.21, 0), 0x6b4a2b));
    club.rotation.x = Math.PI / 2 + 0.5;
    club.position.set(0, -0.06, 0.02);
    grip.add(club);
  }
  let weapon: THREE.Object3D | null = null;
  if (s.weapon) {
    weapon = buildBlade(s.weapon.kind, s.weapon.color);
    grip.add(weapon);
  }
  if (s.shield !== undefined) {
    const kite = new THREE.Shape([new THREE.Vector2(0, 0.17), new THREE.Vector2(0.12, 0.1), new THREE.Vector2(0.1, -0.06), new THREE.Vector2(0, -0.2), new THREE.Vector2(-0.1, -0.06), new THREE.Vector2(-0.12, 0.1)]);
    const geo = new THREE.ExtrudeGeometry(kite, { depth: 0.02, bevelEnabled: false }).rotateY(-Math.PI / 2);
    const board = part(geo, s.shield, -0.06, -0.11, 0.02);
    board.add(part(new THREE.SphereGeometry(0.03, 8, 6), shadeHex(s.shield, 1.25), -0.022, 0.0, 0));
    arms[0].elbow.add(board);
  }

  // Players carry a tool for each activity; only the one in use shows.
  const tools = new Map<string, THREE.Object3D>();
  if (tools_) {
    for (const [key, build] of Object.entries(TOOL_MODELS)) {
      const tool = build();
      tool.visible = false;
      grip.add(tool);
      tools.set(key, tool);
    }
  }

  // Cape hangs from the shoulders and trails when walking.
  let cape: THREE.Group | null = null;
  if (s.cape) {
    cape = pivot(torso, 0, TORSO - 0.03, -0.085);
    const cloth = new THREE.PlaneGeometry(0.3, 0.68, 4, 6).translate(0, -0.34, 0);
    const pos = cloth.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i) / 0.68;
      const x = pos.getX(i) * (0.95 + t * 0.4);
      pos.setX(i, x);
      pos.setZ(i, -Math.abs(x) * 0.35 - t * 0.02);
    }
    cloth.computeVertexNormals();
    const capeMesh = new THREE.Mesh(cloth, mat(s.cape, 0, true));
    capeMesh.castShadow = true;
    cape.add(capeMesh);
    torso.add(part(new THREE.BoxGeometry(0.26, 0.025, 0.04), s.trim ?? s.cape, 0, TORSO - 0.035, -0.07));
  }

  const ghost = !!s.ghost;
  if (ghost) {
    // See-through and legless: the robe trails into nothing.
    for (const leg of legs) leg.hip.visible = false;
    root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const material = (m.material as THREE.MeshLambertMaterial).clone();
      material.transparent = true;
      material.opacity = 0.55;
      material.depthWrite = false;
      material.emissive = new THREE.Color(0x1a3040);
      m.material = material;
      m.castShadow = false;
    });
  } else root.traverse((o) => (o.castShadow = true));
  return {
    root,
    body,
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
    tools,
    work: 0,
    activity: null,
    phase: 0,
    walk: 0,
    seed,
    weapon,
    oneShot: null,
    fallen: 0,
    ghost,
  };
}

/** A blade held in the right hand, pointing forward and a little down at rest. */
function buildBlade(kind: WeaponKind, color: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'axe' || kind === 'pickaxe') {
    // The same shapes as the skilling tools, with the head in the metal's colour.
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.44, 6).translate(0, 0.16, 0), 0x7a5230, 0, 0, 0.02));
    if (kind === 'axe') g.add(part(new THREE.BoxGeometry(0.02, 0.09, 0.12), color, 0, 0.33, 0.08));
    else {
      const pick = new THREE.Group();
      pick.position.set(0, 0.37, 0.02);
      pick.add(part(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(Math.PI / 2).translate(0, 0, 0.085), color));
      pick.add(part(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.085), color));
      g.add(pick);
    }
    g.rotation.x = Math.PI / 2 + 0.45;
    return g;
  }
  const length = kind === 'dagger' ? 0.22 : 0.5;
  g.add(part(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 6), 0x5a3a20, 0, -0.01, 0.02));
  g.add(part(new THREE.BoxGeometry(0.03, 0.022, kind === 'dagger' ? 0.08 : 0.14), 0x6b5a3a, 0, 0.045, 0.02));
  const blade = new THREE.BoxGeometry(0.012, length, 0.045).translate(0, 0.055 + length / 2, 0.02);
  if (kind === 'scimitar') {
    // Curve the blade back toward the tip.
    const pos = blade.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = (pos.getY(i) - 0.055) / length;
      pos.setZ(i, pos.getZ(i) - t * t * 0.12);
    }
    blade.computeVertexNormals();
  }
  // A narrowing point.
  const tip = new THREE.ConeGeometry(0.025, 0.07, 4).scale(0.5, 1, 1).translate(0, 0.055 + length + 0.035, kind === 'scimitar' ? -0.1 : 0.02);
  g.add(part(blade, color, 0, 0, 0, 0x101010), part(tip, color));
  g.rotation.x = Math.PI / 2 + 0.45;
  return g;
}

/** One full stride (two steps) per 1.2 s, matching one tile per 0.6 s tick. */
const STRIDE_RATE = (Math.PI * 2) / 1.2;

/**
 * Advance a rig. `moving` says whether the entity is between tiles this
 * frame; `speed` scales the stride (diagonal steps cover more ground).
 */
/** Tool models, built from primitives, held in the right hand with the handle along the forearm. */
const TOOL_MODELS: Record<string, () => THREE.Group> = {
  axe: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.42, 6), 0x7a5230, 0, -0.04, 0.02));
    g.add(part(new THREE.BoxGeometry(0.02, 0.09, 0.12), 0xb8793a, 0, 0.13, 0.08));
    g.rotation.x = Math.PI / 2;
    return g;
  },
  pickaxe: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.46, 6), 0x7a5230, 0, -0.02, 0.02));
    const head = new THREE.Group();
    head.position.set(0, 0.19, 0.02);
    head.add(part(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(Math.PI / 2).translate(0, 0, 0.085), 0x8a8c92));
    head.add(part(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.085), 0x8a8c92));
    head.rotation.x = 0.25;
    g.add(head);
    g.rotation.x = Math.PI / 2;
    return g;
  },
  hammer: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.012, 0.014, 0.26, 6), 0x7a5230, 0, 0.02, 0.02));
    g.add(part(new THREE.BoxGeometry(0.05, 0.05, 0.11), 0x6c6e74, 0, 0.15, 0.03));
    g.rotation.x = Math.PI / 2;
    return g;
  },
  net: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.012, 0.014, 0.5, 6), 0x7a5230, 0, 0.12, 0.02));
    const hoop = new THREE.Mesh(new THREE.TorusGeometry(0.11, 0.008, 4, 16), mat(0xd8cfb4));
    hoop.position.set(0, 0.47, 0.02);
    hoop.rotation.y = Math.PI / 2;
    g.add(hoop);
    const netting = new THREE.MeshLambertMaterial({ color: 0xe8e0c8, transparent: true, opacity: 0.55, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.16, 8, 1, true), netting);
    mesh.rotation.z = Math.PI / 2;
    mesh.position.set(0.08, 0.47, 0.02);
    g.add(mesh);
    g.rotation.x = Math.PI / 2;
    return g;
  },
  rod: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.006, 0.014, 0.95, 6).translate(0, 0.4, 0), 0x6b4a2b, 0, 0, 0.02));
    g.add(part(new THREE.CylinderGeometry(0.025, 0.025, 0.03, 8).rotateZ(Math.PI / 2), 0x555555, 0.02, 0.02, 0.02));
    // The line hangs from the tip.
    const line = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.7, 3).translate(0, -0.35, 0), mat(0xeeeeee));
    line.name = 'fishing-line';
    line.position.set(0, 0.87, 0.02);
    g.add(line);
    g.rotation.x = Math.PI / 2 - 0.55;
    return g;
  },
  pan: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.01, 0.012, 0.2, 6), 0x2a2a2a, 0, 0.02, 0.02));
    g.add(part(new THREE.CylinderGeometry(0.09, 0.08, 0.025, 12), 0x3a3a3a, 0, 0.2, 0.02));
    g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8), 0xc99a52, 0.01, 0.215, 0.02));
    g.rotation.x = Math.PI / 2;
    return g;
  },
};

/** Which tool each activity shows in the hand. */
const ACTIVITY_TOOL: Record<string, string | undefined> = { chop: 'axe', mine: 'pickaxe', smith: 'hammer', net: 'net', rod: 'rod', cook: 'pan' };

type Pose = Partial<{
  shoulderLx: number;
  shoulderLz: number;
  shoulderRx: number;
  shoulderRz: number;
  elbowL: number;
  elbowR: number;
  torsoX: number;
  torsoY: number;
  hipsY: number;
  hipL: number;
  hipR: number;
  kneeL: number;
  kneeR: number;
  headX: number;
}>;

/** A swing: slow wind-up to 1 over the first `windUp` of the cycle, then a fast drop to 0. */
const swing = (u: number, windUp: number) => (u < windUp ? Math.sin((u / windUp) * Math.PI * 0.5) : 1 - Math.pow((u - windUp) / (1 - windUp), 0.5));

/**
 * Each activity is a looping pose: `u` runs 0..1 over its period (ms).
 * Angles are in radians; negative shoulder x raises the arm forward.
 */
const ACTIVITIES: Record<string, { period: number; pose: (u: number) => Pose }> = {
  // Axe: wind up over the shoulder, then a twisting chop.
  chop: {
    period: 1200,
    pose: (u) => {
      const lift = swing(u, 0.65);
      return { shoulderRx: -0.5 - 2.1 * lift, shoulderRz: 0.25, elbowR: -0.25 - 0.6 * lift, shoulderLx: -0.6 - 0.8 * lift, elbowL: -0.5, torsoY: -0.25 * lift, torsoX: 0.15 - 0.15 * lift };
    },
  },
  // Pickaxe: both hands overhead, then a hard strike down, bending at the knees.
  mine: {
    period: 1200,
    pose: (u) => {
      const lift = swing(u, 0.6);
      const strike = 1 - lift;
      return {
        shoulderRx: -0.6 - 2.5 * lift,
        shoulderLx: -0.6 - 2.3 * lift,
        shoulderRz: 0.08,
        shoulderLz: -0.08,
        elbowR: -0.2 - 0.5 * lift,
        elbowL: -0.25 - 0.5 * lift,
        torsoX: 0.38 * strike - 0.08 * lift,
        hipsY: -0.05 * strike,
        hipL: -0.3 * strike,
        hipR: -0.3 * strike,
        kneeL: 0.55 * strike,
        kneeR: 0.55 * strike,
        headX: 0.2 * strike,
      };
    },
  },
  // Hammer: quick short taps on the anvil, the other hand holding the work.
  smith: {
    period: 600,
    pose: (u) => {
      const lift = swing(u, 0.55);
      return { shoulderRx: -0.85 - 0.75 * lift, elbowR: -0.7 - 0.5 * lift, shoulderRz: 0.12, shoulderLx: -0.75, elbowL: -0.85, torsoX: 0.28, headX: 0.25 };
    },
  },
  // Net: crouched at the water's edge, sweeping the net side to side.
  net: {
    period: 2400,
    pose: (u) => {
      const sweep = Math.sin(u * Math.PI * 2);
      return {
        shoulderRx: -0.75 + 0.15 * Math.cos(u * Math.PI * 4),
        shoulderLx: -0.7,
        elbowR: -0.3,
        elbowL: -0.6,
        torsoX: 0.45,
        torsoY: 0.35 * sweep,
        hipsY: -0.14,
        hipL: -0.85,
        hipR: -0.6,
        kneeL: 1.3,
        kneeR: 1.0,
        headX: 0.3,
      };
    },
  },
  // Rod: standing still with the line out, small twitches and a tug each cycle.
  rod: {
    period: 3000,
    pose: (u) => {
      const tug = u > 0.85 ? Math.sin(((u - 0.85) / 0.15) * Math.PI) : 0;
      const bob = Math.sin(u * Math.PI * 6) * 0.04;
      return { shoulderRx: -0.95 + bob - 0.45 * tug, shoulderLx: -0.75 + bob - 0.3 * tug, elbowR: -0.55, elbowL: -0.9, shoulderLz: -0.25, torsoX: -0.06 + 0.06 * tug };
    },
  },
  // Pan over the range: shake it, flip once a cycle.
  cook: {
    period: 1600,
    pose: (u) => {
      const shake = Math.sin(u * Math.PI * 8) * 0.06;
      const flip = u < 0.2 ? Math.sin((u / 0.2) * Math.PI) : 0;
      return { shoulderRx: -1.0 + shake - 0.35 * flip, elbowR: -0.5 + 0.3 * flip, shoulderLx: -0.55, elbowL: -1.1, torsoX: 0.18, headX: 0.25 };
    },
  },
  // Squared up to a fight: guard raised, knees soft, a slight sway.
  fight: {
    period: 1800,
    pose: (u) => {
      const sway = Math.sin(u * Math.PI * 2) * 0.05;
      return { shoulderRx: -0.75 + sway, elbowR: -0.95, shoulderRz: 0.15, shoulderLx: -0.6 - sway, elbowL: -1.25, shoulderLz: -0.1, hipL: -0.22, hipR: 0.12, kneeL: 0.22, kneeR: 0.16, hipsY: -0.02, torsoY: -0.12 };
    },
  },
  // Feeding the furnace: lean in and push the ore forward with both hands.
  smelt: {
    period: 1800,
    pose: (u) => {
      const push = Math.max(0, Math.sin(u * Math.PI * 2));
      return { shoulderRx: -0.7 - 0.6 * push, shoulderLx: -0.7 - 0.6 * push, elbowR: -0.9 + 0.6 * push, elbowL: -0.9 + 0.6 * push, torsoX: 0.2 + 0.2 * push, headX: 0.15, hipL: -0.15 * push, kneeL: 0.25 * push };
    },
  },
};

/**
 * One-off moves, `u` running 0..1 over `ms`. Poses blend in and out at the
 * ends, so they sit on top of standing, walking or fighting stances.
 */
const ONE_SHOTS: Record<string, { ms: number; pose: (u: number) => Pose }> = {
  // Fists: pull back, then a straight jab.
  punch: {
    ms: 550,
    pose: (u) => {
      const jab = u < 0.4 ? -u / 0.4 : Math.sin(((u - 0.4) / 0.6) * Math.PI);
      return { shoulderRx: -1.2 - 0.35 * jab, elbowR: -1.6 + 1.5 * Math.max(0, jab), shoulderLx: -1.1, elbowL: -1.7, torsoY: 0.3 * jab - 0.15, torsoX: 0.1 };
    },
  },
  // Dagger: tuck the blade, then a lunging thrust.
  stab: {
    ms: 600,
    pose: (u) => {
      const thrust = u < 0.35 ? -u / 0.35 : Math.sin(((u - 0.35) / 0.65) * Math.PI);
      return {
        shoulderRx: -1.3 - 0.25 * thrust,
        elbowR: -1.5 + 1.45 * Math.max(0, thrust),
        shoulderLx: -0.3,
        elbowL: -0.6,
        torsoX: 0.12 + 0.18 * thrust,
        torsoY: 0.25 * thrust,
        hipL: -0.45 * Math.max(0, thrust),
        kneeL: 0.35 * Math.max(0, thrust),
        hipR: 0.25 * Math.max(0, thrust),
      };
    },
  },
  // Sword: raise it high over the right shoulder, then cut down and across.
  slash: {
    ms: 700,
    pose: (u) => {
      const lift = swing(u, 0.45);
      const cut = 1 - lift;
      return {
        shoulderRx: -0.6 - 2.3 * lift,
        shoulderRz: 0.5 * lift - 0.35 * cut * Math.sin(u * Math.PI),
        elbowR: -0.3 - 0.7 * lift,
        shoulderLx: -0.4,
        elbowL: -0.7,
        torsoY: -0.45 * lift + 0.4 * cut * Math.sin(u * Math.PI),
        torsoX: 0.25 * cut * Math.sin(u * Math.PI),
      };
    },
  },
  // Monsters with a club or blade: a heavy overhead blow.
  swing: {
    ms: 700,
    pose: (u) => {
      const lift = swing(u, 0.55);
      return { shoulderRx: -0.4 - 2.6 * lift, elbowR: -0.2 - 0.6 * lift, shoulderLx: -0.5, elbowL: -0.4, torsoX: 0.3 * (1 - lift) - 0.1 * lift };
    },
  },
  // A spirit's wail: arms flung up and out, head back.
  wail: {
    ms: 900,
    pose: (u) => {
      const k = Math.sin(u * Math.PI);
      return { shoulderRx: -2.4 * k, shoulderLx: -2.4 * k, shoulderRz: 0.6 * k, shoulderLz: -0.6 * k, elbowR: -0.2, elbowL: -0.2, headX: -0.5 * k, torsoX: -0.2 * k };
    },
  },
  // Taking a hit: guard up and flinch back.
  block: {
    ms: 450,
    pose: (u) => {
      const k = Math.sin(u * Math.PI);
      return { shoulderLx: -1.3 * k, elbowL: -1.3 * k, shoulderLz: 0.3 * k, torsoX: -0.18 * k, headX: -0.15 * k, hipsY: -0.02 * k };
    },
  },
  // Food to the mouth, a couple of chews.
  eat: {
    ms: 1100,
    pose: (u) => {
      const k = Math.min(1, Math.sin(u * Math.PI) * 1.6);
      return { shoulderRx: -1.25 * k, shoulderRz: -0.35 * k, elbowR: -2.1 * k, headX: -0.1 * k + Math.sin(u * Math.PI * 6) * 0.04 * k };
    },
  },
};

/** Starts a one-off animation. Unknown kinds (a monster's bite on a humanoid rig) fall back to a swing. */
export function playCharacter(rig: CharacterRig, kind: string, now: number): void {
  if (kind === 'death') return; // handled by the `dead` flag
  rig.oneShot = { kind: ONE_SHOTS[kind] ? kind : 'swing', start: now };
}

/** Whether a one-off animation is still playing, so a block doesn't cut off an attack. */
export function characterBusy(rig: CharacterRig, now: number): boolean {
  return !!rig.oneShot && now - rig.oneShot.start < ONE_SHOTS[rig.oneShot.kind].ms;
}

export function animateCharacter(rig: CharacterRig, dt: number, now: number, moving: boolean, speed = 1, activity: string | null = null, dead = false): void {
  rig.walk += ((moving ? 1 : 0) - rig.walk) * Math.min(1, dt * 8);
  if (rig.walk > 0.01) rig.phase += dt * STRIDE_RATE * speed;
  else rig.phase = 0;
  const w = rig.walk;
  const idle = 1 - w;
  const t = now / 1000 + rig.seed;
  const s = Math.sin(rig.phase);
  const c = Math.cos(rig.phase);

  // Legs swing opposite each other; the knee bends as the leg passes under.
  rig.hipL.rotation.x = -s * 0.5 * w;
  rig.hipR.rotation.x = s * 0.5 * w;
  rig.kneeL.rotation.x = Math.max(0, c) * 0.8 * w + 0.02;
  rig.kneeR.rotation.x = Math.max(0, -c) * 0.8 * w + 0.02;

  // Arms counter-swing; elbows stay a little bent.
  const breathe = Math.sin(t * 1.8) * 0.03 * idle;
  rig.shoulderL.rotation.x = s * 0.5 * w + breathe;
  rig.shoulderR.rotation.x = -s * 0.5 * w + breathe;
  rig.shoulderL.rotation.z = -0.06 - 0.02 * idle;
  rig.shoulderR.rotation.z = 0.06 + 0.02 * idle;
  rig.elbowL.rotation.x = -0.12 - 0.35 * w - Math.max(0, s) * 0.3 * w;
  rig.elbowR.rotation.x = -0.12 - 0.35 * w - Math.max(0, -s) * 0.3 * w;

  // Body: bob twice per stride, lean into the walk, slight twist, breathing at rest.
  rig.hips.position.y = HIP_Y + Math.abs(c) * 0.035 * w - 0.01 * w;
  rig.hips.rotation.y = s * 0.12 * w;
  rig.torso.rotation.y = -s * 0.2 * w;
  rig.torso.rotation.x = 0.08 * w;
  rig.torso.scale.y = 1 + Math.sin(t * 1.8) * 0.012 * idle;
  rig.head.rotation.y = s * 0.08 * w + Math.sin(t * 0.45) * 0.35 * idle * Math.max(0, Math.sin(t * 0.13));
  rig.head.rotation.x = -0.05 * w + Math.sin(t * 0.7) * 0.03 * idle;

  // Working: blend from the walk/idle pose into the activity's pose.
  const target = activity && !moving ? activity : null;
  if (target) rig.activity = target;
  rig.work += ((target ? 1 : 0) - rig.work) * Math.min(1, dt * 10);
  const shown = rig.work > 0.05 ? rig.activity : null;
  for (const [key, tool] of rig.tools) tool.visible = !!shown && ACTIVITY_TOOL[shown] === key;
  if (rig.weapon) rig.weapon.visible = !(shown && ACTIVITY_TOOL[shown]);
  const anim = rig.activity ? ACTIVITIES[rig.activity] : undefined;
  if (anim && rig.work > 0.01) {
    const u = ((now + rig.seed * 1000) % anim.period) / anim.period;
    applyPose(rig, anim.pose(u), rig.work);
  } else if (rig.work <= 0.01) rig.activity = null;

  // A one-off move on top, eased in and out over its first and last fifth.
  if (rig.oneShot) {
    const shot = ONE_SHOTS[rig.oneShot.kind];
    const u = (now - rig.oneShot.start) / shot.ms;
    if (u >= 1) rig.oneShot = null;
    else if (u >= 0) applyPose(rig, shot.pose(u), Math.min(1, u * 5, (1 - u) * 5));
  }

  // Dying: knees give, then a fall onto the back. Ghosts sink and fade instead.
  rig.fallen += ((dead ? 1 : 0) - rig.fallen) * Math.min(1, dt * (dead ? 3 : 8));
  if (rig.ghost) {
    rig.body.position.y = 0.18 + Math.sin(now / 600 + rig.seed) * 0.05 - rig.fallen * 0.8;
    rig.body.rotation.x = 0;
  } else {
    const f = rig.fallen;
    rig.body.rotation.x = -Math.PI / 2 * Math.max(0, (f - 0.25) / 0.75);
    rig.body.position.y = 0.1 * f;
    rig.body.position.z = -0.25 * f;
    if (f > 0.01) {
      rig.kneeL.rotation.x += 0.9 * Math.sin(f * Math.PI);
      rig.kneeR.rotation.x += 0.7 * Math.sin(f * Math.PI);
      rig.shoulderL.rotation.z -= 0.9 * f;
      rig.shoulderR.rotation.z += 0.9 * f;
    }
  }

  if (rig.cape) rig.cape.rotation.x = 0.06 + 0.45 * w + Math.sin(rig.phase * 2) * 0.06 * w + Math.sin(t * 1.3) * 0.02;
  if (rig.robe) rig.robe.rotation.z = s * 0.06 * w;
}

/** Blends a rig toward a pose by `k` (0 = untouched, 1 = exactly the pose). */
function applyPose(rig: CharacterRig, p: Pose, k: number): void {
  {
    const mix = (obj: { x: number } | { y: number } | { z: number }, axis: 'x' | 'y' | 'z', to: number | undefined) => {
      if (to === undefined) return;
      const o = obj as Record<string, number>;
      o[axis] += (to - o[axis]) * k;
    };
    mix(rig.shoulderR.rotation, 'x', p.shoulderRx);
    mix(rig.shoulderR.rotation, 'z', p.shoulderRz);
    mix(rig.shoulderL.rotation, 'x', p.shoulderLx);
    mix(rig.shoulderL.rotation, 'z', p.shoulderLz);
    mix(rig.elbowR.rotation, 'x', p.elbowR);
    mix(rig.elbowL.rotation, 'x', p.elbowL);
    mix(rig.torso.rotation, 'x', p.torsoX);
    mix(rig.torso.rotation, 'y', p.torsoY);
    mix(rig.hipL.rotation, 'x', p.hipL);
    mix(rig.hipR.rotation, 'x', p.hipR);
    mix(rig.kneeL.rotation, 'x', p.kneeL);
    mix(rig.kneeR.rotation, 'x', p.kneeR);
    mix(rig.head.rotation, 'x', p.headX);
    if (p.hipsY !== undefined) rig.hips.position.y += p.hipsY * k;
  }
}
