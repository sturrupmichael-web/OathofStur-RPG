import * as THREE from 'three';
import { shared } from './dispose';
import { BODY, buildBody } from './humanoid';
import { paint, vertexMaterial } from './skin';

/**
 * Procedural people (~1.2 tiles tall, facing +Z) and their animation. The
 * body is one skinned mesh (see humanoid.ts), so a walk cycle is just a few
 * bone rotations per frame. Purely visual: the simulation only knows tiles.
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
  /** Broader (above 1) or slighter build. */
  bulk?: number;
  /** A round belly, 0..1. */
  belly?: number;
  /** Long pointed ears and a long nose (goblins). */
  pointyEars?: boolean;
  /** Wearing a chainbody or platelegs: shiny instead of cloth. */
  bodyMetal?: boolean;
  legsMetal?: boolean;
}

type WeaponKind = 'dagger' | 'sword' | 'scimitar' | 'axe' | 'pickaxe' | 'shortbow' | 'longbow';

/** Bow wood by the log it was carved from. */
const BOW_WOOD: Record<string, number> = { oak: 0xa87a44, willow: 0xc2a265, yew: 0x7a3f22 };

/** Colours for each metal tier, used on worn gear. */
export const METALS: Record<string, number> = { bronze: 0xb8793a, iron: 0x7d7f86, steel: 0xb4bec8, cinder: 0x6a2418, drakescale: 0xa8401e };

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
  if (gear.body) [s.tunic, s.trim, s.bodyMetal] = [shadeHex(metal(gear.body)!, 0.82), metal(gear.body), true];
  if (gear.legs) [s.trousers, s.bootCuff, s.legsMetal] = [shadeHex(metal(gear.legs)!, 0.9), undefined, true];
  if (gear.weapon) {
    const kind = weaponKind(gear.weapon);
    const bow = kind === 'shortbow' || kind === 'longbow';
    s.weapon = { kind, color: bow ? (BOW_WOOD[gear.weapon.split('_')[0]] ?? 0x8a5a2e) : (metal(gear.weapon) ?? 0x9a9ca4) };
  }
  return s;
}

function weaponKind(itemId: string): WeaponKind {
  if (itemId.endsWith('shortbow')) return 'shortbow';
  if (itemId.endsWith('longbow')) return 'longbow';
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
    bulk: 1.08,
    belly: 0.7,
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
    bulk: 1.14,
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
    bulk: 1.1,
    belly: 1,
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
    belly: 0.4,
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
    bulk: 1.08,
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
    pointyEars: true,
    bulk: 0.95,
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
    bulk: 1.08,
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
    belly: 0.3,
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
  hips: THREE.Object3D;
  /** The hang of a tunic hem or robe, swaying with the walk. */
  skirt: THREE.Object3D;
  torso: THREE.Object3D;
  neck: THREE.Object3D;
  head: THREE.Object3D;
  /** Both eyes; squashed flat to blink. */
  eyes: THREE.Object3D;
  shoulderL: THREE.Object3D;
  shoulderR: THREE.Object3D;
  elbowL: THREE.Object3D;
  elbowR: THREE.Object3D;
  handL: THREE.Object3D;
  handR: THREE.Object3D;
  hipL: THREE.Object3D;
  hipR: THREE.Object3D;
  kneeL: THREE.Object3D;
  kneeR: THREE.Object3D;
  ankleL: THREE.Object3D;
  ankleR: THREE.Object3D;
  cape: THREE.Group | null;
  robe: boolean;
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
  /** How far the character still has to turn (radians, eased): the head leads and the feet shuffle. */
  turn: number;
  /** When the next blink starts (ms). */
  blinkAt: number;
  /** Per-character offset so idle motion isn't in sync. */
  seed: number;
  /** Wielded weapon, hidden while a tool is out. */
  weapon: THREE.Object3D | null;
  /** Holds a bow, so fights from a drawn stance. */
  archer: boolean;
  /** A one-off animation (attack, block, eat) playing over everything else. */
  oneShot: { kind: string; start: number } | null;
  /** 0 = standing, 1 = lying dead. */
  fallen: number;
  ghost: boolean;
}

const materials = new Map<string, THREE.Material>();
function mat(color: number, emissive = 0, metal = false): THREE.Material {
  const key = `${color}|${emissive}|${metal}`;
  let m = materials.get(key);
  if (!m) {
    m = shared(metal ? new THREE.MeshPhongMaterial({ color, emissive, shininess: 70, specular: 0x777777 }) : new THREE.MeshLambertMaterial({ color, emissive }));
    materials.set(key, m);
  }
  return m;
}

/** A loose part (tool, weapon, shield): smooth unless it's a box. */
function part(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, emissive = 0, metal = false): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat(color, emissive, metal));
  m.position.set(x, y, z);
  m.castShadow = true;
  return m;
}
const metalPart = (geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0) => part(geo, color, x, y, z, 0, true);

/** Builds a character from a named look or a look of its own; `tools` gives it the skilling tools players carry. */
export function buildCharacter(style: string | CharacterStyle, seed: number, tools_ = false): CharacterRig {
  const s = typeof style === 'string' ? (CHARACTER_STYLES[style] ?? CHARACTER_STYLES.other_player) : style;
  const root = new THREE.Group();
  const body = new THREE.Group();
  root.add(body);
  if (s.scale) body.scale.setScalar(s.scale);
  const ghost = !!s.ghost;
  const bones = buildBody(s, body, { transparent: ghost ? 0.55 : undefined });

  // Held item in the right hand
  const grip = bones.handR;
  if (s.holding === 'staff') {
    grip.add(part(new THREE.CylinderGeometry(0.016, 0.02, 1.3, 7), 0x7a5230, 0, 0.12, 0.02));
    grip.add(part(new THREE.OctahedronGeometry(0.05), 0x8fe0ff, 0, 0.8, 0.02, 0x2a6aa0));
  }
  if (s.holding === 'scroll') {
    grip.add(part(new THREE.CylinderGeometry(0.022, 0.022, 0.18, 10).rotateX(Math.PI / 2), 0xeee0b8, 0, -0.06, 0.03));
    for (const z of [-0.06, 0.12]) grip.add(part(new THREE.CylinderGeometry(0.026, 0.026, 0.012, 10).rotateX(Math.PI / 2), 0x8a6a3a, 0, -0.06, z));
  }
  if (s.holding === 'ladle') {
    grip.add(part(new THREE.CylinderGeometry(0.008, 0.008, 0.28, 6), 0x8a6a3a, 0, -0.12, 0.02));
    grip.add(metalPart(new THREE.SphereGeometry(0.04, 10, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x9a9a9a, 0, -0.26, 0.02));
  }
  if (s.holding === 'club') {
    const club = new THREE.Group();
    club.add(part(new THREE.CylinderGeometry(0.045, 0.02, 0.42, 7).translate(0, 0.21, 0), 0x6b4a2b));
    club.add(part(new THREE.SphereGeometry(0.047, 8, 6).translate(0, 0.42, 0), 0x5a3c22));
    club.rotation.x = Math.PI / 2 + 0.5;
    club.position.set(0, -0.06, 0.02);
    grip.add(club);
  }
  let weapon: THREE.Object3D | null = null;
  const archer = s.weapon?.kind === 'shortbow' || s.weapon?.kind === 'longbow';
  if (s.weapon && archer) {
    // A bow rides in the left hand, with a quiver of arrows on the back.
    weapon = buildBow(s.weapon.kind === 'longbow' ? 0.56 : 0.4, s.weapon.color);
    bones.handL.add(weapon);
    bones.torso.add(buildQuiver(s.bulk ?? 1));
  } else if (s.weapon) {
    weapon = buildBlade(s.weapon.kind, s.weapon.color);
    grip.add(weapon);
  }
  if (s.shield !== undefined) {
    const kite = new THREE.Shape([new THREE.Vector2(0, 0.17), new THREE.Vector2(0.12, 0.1), new THREE.Vector2(0.1, -0.06), new THREE.Vector2(0, -0.2), new THREE.Vector2(-0.1, -0.06), new THREE.Vector2(-0.12, 0.1)]);
    const geo = new THREE.ExtrudeGeometry(kite, { depth: 0.014, bevelEnabled: true, bevelThickness: 0.006, bevelSize: 0.008, bevelSegments: 2 }).rotateY(-Math.PI / 2);
    const board = metalPart(geo, s.shield, -0.06, -0.11, 0.02);
    board.add(metalPart(new THREE.SphereGeometry(0.03, 10, 8), shadeHex(s.shield, 1.25), -0.026, 0.0, 0));
    bones.elbowL.add(board);
  }

  // Players carry a tool for each activity; only the one in use shows.
  const tools = new Map<string, THREE.Object3D>();
  if (tools_) {
    for (const [key, build] of Object.entries(TOOL_MODELS)) {
      const tool = build();
      tool.visible = false;
      (OFFHAND_TOOLS.has(key) ? bones.handL : grip).add(tool);
      tools.set(key, tool);
    }
  }

  // Cape hangs from the shoulders and trails when walking.
  let cape: THREE.Group | null = null;
  if (s.cape) {
    cape = new THREE.Group();
    cape.position.set(0, BODY.shoulderY - 0.01, -0.088 * (s.bulk ?? 1));
    bones.torso.add(cape);
    const cloth = new THREE.PlaneGeometry(0.3, 0.66, 6, 10).translate(0, -0.33, 0);
    const pos = cloth.attributes.position;
    for (let i = 0; i < pos.count; i++) {
      const t = -pos.getY(i) / 0.66;
      const x = pos.getX(i) * (0.95 + t * 0.45);
      pos.setX(i, x);
      // Wrapped round the shoulders at the top, with soft folds lower down.
      pos.setZ(i, -x * x * (2.4 - t * 1.6) - t * 0.02 + Math.sin(x * 40) * 0.008 * t);
    }
    cloth.computeVertexNormals();
    const trim = s.trim ?? shadeHex(s.cape, 0.7);
    const capeMesh = new THREE.Mesh(paint(cloth, (p) => (p.y < -0.63 ? trim : shadeHex(s.cape!, 0.9 + 0.1 * (1 + p.y / 0.66)))), vertexMaterial('cloth', true));
    capeMesh.castShadow = true;
    cape.add(capeMesh);
  }

  root.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh || (m as THREE.SkinnedMesh).isSkinnedMesh) return;
    if (!ghost) m.castShadow = true;
    else {
      // See-through like the rest of the spirit.
      const material = (m.material as THREE.MeshLambertMaterial).clone();
      Object.assign(material, { transparent: true, opacity: 0.55, depthWrite: false });
      m.material = material;
      m.castShadow = false;
    }
  });
  return {
    root,
    body,
    ...bones,
    cape,
    robe: s.robe !== undefined,
    tools,
    work: 0,
    activity: null,
    phase: 0,
    walk: 0,
    turn: 0,
    blinkAt: 1500 + (seed % 1) * 3000,
    seed,
    weapon,
    archer,
    oneShot: null,
    fallen: 0,
    ghost,
  };
}

/**
 * A bow in the left hand. Its stave runs along the hand's z axis, so it
 * stands upright once the arm is raised to aim; the tips sweep back toward
 * the archer and the string runs straight between them.
 */
function buildBow(half: number, wood: number): THREE.Group {
  const g = new THREE.Group();
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= 16; i++) {
    const t = i / 8 - 1;
    points.push(new THREE.Vector3(0, 0.16 * half * t * t + 0.04 * half * Math.pow(Math.abs(t), 4), t * half));
  }
  const stave = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points), 24, 0.013, 6);
  // Thicker at the grip, fine at the tips.
  const pos = stave.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const k = 1 - 0.45 * Math.min(1, Math.abs(pos.getZ(i)) / half);
    pos.setX(i, pos.getX(i) * k);
    const y0 = 0.16 * half * (pos.getZ(i) / half) ** 2;
    pos.setY(i, y0 + (pos.getY(i) - y0) * k);
  }
  stave.computeVertexNormals();
  g.add(part(stave, wood));
  g.add(part(new THREE.CylinderGeometry(0.018, 0.018, 0.09, 8).rotateX(Math.PI / 2), 0x4a3020));
  const tipY = 0.2 * half;
  const string = new THREE.Mesh(new THREE.CylinderGeometry(0.0025, 0.0025, half * 2, 3).rotateX(Math.PI / 2), mat(0xe8e2cc));
  string.position.set(0, tipY, 0);
  string.name = 'bowstring';
  g.add(string);
  g.position.set(0, -0.06, 0.01);
  // Tipped a little so it hangs forward and down at rest, and stands near upright when drawn.
  g.rotation.x = 0.3;
  return g;
}

/** A leather quiver slung over the right shoulder, a few fletchings showing. */
function buildQuiver(bulk: number): THREE.Group {
  const g = new THREE.Group();
  g.add(part(new THREE.CylinderGeometry(0.045, 0.036, 0.38, 10, 1, true), 0x6b4428));
  g.add(part(new THREE.CylinderGeometry(0.036, 0.036, 0.01, 10).translate(0, -0.19, 0), 0x4e301c));
  g.add(part(new THREE.TorusGeometry(0.045, 0.007, 4, 12).rotateX(Math.PI / 2).translate(0, 0.17, 0), 0x3e2616));
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const x = Math.cos(a) * 0.022;
    const z = Math.sin(a) * 0.022;
    g.add(part(new THREE.CylinderGeometry(0.004, 0.004, 0.1, 4).translate(0, 0.22, 0), 0xb08a5a, x, 0, z));
    g.add(part(new THREE.BoxGeometry(0.003, 0.06, 0.024).translate(0, 0.25, 0), i % 2 ? 0xd8d2c4 : 0xa83a2a, x, 0, z));
  }
  g.position.set(0.07, BODY.shoulderY - 0.2, -0.1 * bulk);
  g.rotation.set(-0.12, 0, -0.42);
  return g;
}

/** A blade held in the right hand, pointing forward and a little down at rest. */
function buildBlade(kind: WeaponKind, color: number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'axe' || kind === 'pickaxe') {
    // The same shapes as the skilling tools, with the head in the metal's colour.
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.44, 6).translate(0, 0.16, 0), 0x7a5230, 0, 0, 0.02));
    if (kind === 'axe') g.add(metalPart(new THREE.BoxGeometry(0.02, 0.09, 0.12), color, 0, 0.33, 0.08));
    else {
      const pick = new THREE.Group();
      pick.position.set(0, 0.37, 0.02);
      pick.add(metalPart(new THREE.ConeGeometry(0.018, 0.17, 6).rotateX(Math.PI / 2).translate(0, 0, 0.085), color));
      pick.add(metalPart(new THREE.ConeGeometry(0.018, 0.17, 6).rotateX(-Math.PI / 2).translate(0, 0, -0.085), color));
      g.add(pick);
    }
    g.rotation.x = Math.PI / 2 + 0.45;
    return g;
  }
  const length = kind === 'dagger' ? 0.22 : 0.5;
  g.add(part(new THREE.CylinderGeometry(0.014, 0.016, 0.1, 6), 0x5a3a20, 0, -0.01, 0.02));
  g.add(metalPart(new THREE.BoxGeometry(0.03, 0.022, kind === 'dagger' ? 0.08 : 0.14), 0x8a7a52, 0, 0.045, 0.02));
  g.add(metalPart(new THREE.SphereGeometry(0.018, 8, 6), 0x8a7a52, 0, -0.065, 0.02));
  const blade = new THREE.BoxGeometry(0.012, length, 0.045, 1, 8, 1).translate(0, 0.055 + length / 2, 0.02);
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
  g.add(metalPart(blade, color), metalPart(tip, color));
  g.rotation.x = Math.PI / 2 + 0.45;
  return g;
}

/** One full stride (two steps) per 1.2 s, matching one tile per 0.6 s tick. */
const STRIDE_RATE = (Math.PI * 2) / 1.2;

/** Tool models, built from primitives, held in the right hand with the handle along the forearm. */
const TOOL_MODELS: Record<string, () => THREE.Group> = {
  axe: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.42, 6), 0x7a5230, 0, -0.04, 0.02));
    g.add(metalPart(new THREE.BoxGeometry(0.02, 0.09, 0.12), 0xb8793a, 0, 0.13, 0.08));
    g.rotation.x = Math.PI / 2;
    return g;
  },
  pickaxe: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.014, 0.017, 0.46, 6), 0x7a5230, 0, -0.02, 0.02));
    const head = new THREE.Group();
    head.position.set(0, 0.19, 0.02);
    head.add(metalPart(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(Math.PI / 2).translate(0, 0, 0.085), 0x8a8c92));
    head.add(metalPart(new THREE.ConeGeometry(0.018, 0.17, 5).rotateX(-Math.PI / 2).translate(0, 0, -0.085), 0x8a8c92));
    head.rotation.x = 0.25;
    g.add(head);
    g.rotation.x = Math.PI / 2;
    return g;
  },
  hammer: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.012, 0.014, 0.26, 6), 0x7a5230, 0, 0.02, 0.02));
    g.add(metalPart(new THREE.BoxGeometry(0.05, 0.05, 0.11), 0x6c6e74, 0, 0.15, 0.03));
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
  tinderbox: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.BoxGeometry(0.05, 0.03, 0.07), 0x6a4a2a, 0, -0.03, 0.03));
    g.add(metalPart(new THREE.BoxGeometry(0.012, 0.02, 0.06), 0x7d7f86, 0, -0.005, 0.03));
    return g;
  },
  knife: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.011, 0.012, 0.08, 6), 0x5a3a20, 0, -0.01, 0.02));
    g.add(metalPart(new THREE.BoxGeometry(0.006, 0.09, 0.022).translate(0, 0.075, 0.025), 0xc8ccd2));
    g.rotation.x = Math.PI / 2 + 0.3;
    return g;
  },
  // The piece being whittled, held in the left hand.
  stave: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.02, 0.024, 0.34, 7), 0xa07444, 0, 0.06, 0.02));
    g.add(part(new THREE.CylinderGeometry(0.0205, 0.0205, 0.01, 7).translate(0, 0.23, 0), 0xe0c08a, 0, 0, 0.02));
    g.rotation.set(Math.PI / 2, 0, -1.5);
    return g;
  },
  pan: () => {
    const g = new THREE.Group();
    g.add(part(new THREE.CylinderGeometry(0.01, 0.012, 0.2, 6), 0x2a2a2a, 0, 0.02, 0.02));
    g.add(metalPart(new THREE.CylinderGeometry(0.09, 0.08, 0.025, 16), 0x3a3a3a, 0, 0.2, 0.02));
    g.add(part(new THREE.CylinderGeometry(0.035, 0.035, 0.012, 8), 0xc99a52, 0.01, 0.215, 0.02));
    g.rotation.x = Math.PI / 2;
    return g;
  },
};

/** Which tool each activity shows in the hand. */
const ACTIVITY_TOOL: Record<string, string | undefined> = { chop: 'axe', mine: 'pickaxe', smith: 'hammer', net: 'net', rod: 'rod', cook: 'pan', fletch: 'knife', light: 'tinderbox' };
/** What each activity holds in the left hand too, if anything. */
const ACTIVITY_OFFHAND: Record<string, string | undefined> = { fletch: 'stave' };
const OFFHAND_TOOLS = new Set(Object.values(ACTIVITY_OFFHAND));

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
  // Whittling: head down over the work, the knife drawn along it in short strokes, shavings away from the body.
  fletch: {
    period: 1200,
    pose: (u) => {
      const stroke = u < 0.7 ? u / 0.7 : 1 - (u - 0.7) / 0.3;
      return {
        shoulderRx: -0.5 - 0.2 * stroke,
        shoulderRz: -0.3 + 0.15 * stroke,
        elbowR: -1.45 + 0.4 * stroke,
        shoulderLx: -0.55,
        shoulderLz: 0.35,
        elbowL: -1.35,
        torsoX: 0.22,
        headX: 0.42,
        hipsY: -0.01,
      };
    },
  },
  // Down on one knee over the logs, striking the tinderbox; a quick flick of the wrist each time.
  light: {
    period: 900,
    pose: (u) => {
      const strike = u < 0.5 ? Math.sin(u * Math.PI) : 1 - Math.pow((u - 0.5) / 0.5, 0.4);
      return {
        hipsY: -0.3,
        hipL: -1.5,
        kneeL: 1.6,
        hipR: 0.15,
        kneeR: 1.75,
        torsoX: 0.5,
        headX: 0.4,
        shoulderRx: -0.75 - 0.35 * strike,
        shoulderRz: -0.1,
        elbowR: -0.5 - 0.4 * strike,
        shoulderLx: -0.7,
        shoulderLz: 0.12,
        elbowL: -0.45,
      };
    },
  },
  // Bow up and half drawn between shots, the eyes on the target.
  aim: {
    period: 2000,
    pose: (u) => {
      const sway = Math.sin(u * Math.PI * 2) * 0.03;
      return { shoulderLx: -1.4 + sway, shoulderLz: 0.1, elbowL: -0.1, shoulderRx: -0.15 + sway, shoulderRz: 1.45, elbowR: -2.5, torsoY: 0.5, hipL: -0.15, kneeL: 0.12, hipR: 0.1, headX: 0.04 };
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

/** Where a work cycle is (0..1) right now, matching the pose shown, or null for no such activity. */
export function activityPhase(rig: CharacterRig, activity: string, now: number): number | null {
  const anim = ACTIVITIES[activity];
  return anim ? ((now + rig.seed * 1000) % anim.period) / anim.period : null;
}

/** How long a bow shot takes, and where in it the arrow leaves the string. */
export const SHOOT_MS = 900;
export const SHOOT_RELEASE = 0.6;

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
  // Bow: raise it, draw the string back to the cheek, hold, loose, and the hand flies back.
  shoot: {
    ms: SHOOT_MS,
    pose: (u) => {
      const raise = Math.min(1, u / 0.25);
      // Hand to the string at the bow, then back to the cheek.
      const draw = u < SHOOT_RELEASE ? Math.min(1, Math.max(0, (u - 0.2) / 0.3)) : 1;
      const follow = u >= SHOOT_RELEASE ? Math.sin(((u - SHOOT_RELEASE) / (1 - SHOOT_RELEASE)) * Math.PI * 0.5) : 0;
      const mix = (a: number, b: number) => a + (b - a) * draw;
      return {
        shoulderLx: -0.4 - 1.0 * raise,
        shoulderLz: 0.1 * raise,
        elbowL: -0.1,
        shoulderRx: mix(-0.4 - 0.95 * raise, -0.15),
        shoulderRz: mix(0.2 * raise, 1.45) + 0.2 * follow,
        elbowR: mix(-0.4, -2.5) + 0.7 * follow,
        torsoY: 0.5 * raise,
        headX: 0.04,
        hipL: -0.15 * raise,
        kneeL: 0.12 * raise,
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
  // Talking: an open hand out and a nod, the other hand moving with the words.
  talk: {
    ms: 1500,
    pose: (u) => {
      const k = Math.min(1, Math.sin(u * Math.PI) * 1.5);
      const beat = Math.sin(u * Math.PI * 5);
      return {
        shoulderRx: -0.75 * k - 0.15 * beat * k,
        shoulderRz: 0.25 * k,
        elbowR: -0.9 * k,
        shoulderLx: -0.35 * k + 0.12 * beat * k,
        elbowL: -0.7 * k,
        headX: 0.08 * Math.sin(u * Math.PI * 4) * k,
        torsoY: 0.06 * beat * k,
      };
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

/**
 * Advance a rig. `moving` says whether the entity is between tiles this
 * frame; `speed` scales the stride (diagonal steps cover more ground).
 * `turn` is how far it still has to turn to face where it's going.
 */
export function animateCharacter(rig: CharacterRig, dt: number, now: number, moving: boolean, speed = 1, activity: string | null = null, dead = false, turn = 0): void {
  rig.walk += ((moving ? 1 : 0) - rig.walk) * Math.min(1, dt * 7);
  rig.turn += (turn - rig.turn) * Math.min(1, dt * 10);
  // Turning on the spot: a couple of small steps rather than spinning on a pin.
  const shuffle = moving || dead ? 0 : Math.min(1, Math.max(0, Math.abs(rig.turn) - 0.25) * 2) * (1 - rig.work);
  const w = Math.max(rig.walk, shuffle * 0.35);
  if (w > 0.01) rig.phase += dt * STRIDE_RATE * (moving ? speed : 1.4);
  else rig.phase = 0;
  const idle = 1 - rig.walk;
  const t = now / 1000 + rig.seed;
  const s = Math.sin(rig.phase);
  const c = Math.cos(rig.phase);

  // Legs swing opposite each other. A leg bends most as it swings through,
  // a little as it takes the weight, and the hips dip as the legs part.
  rig.hipL.rotation.set(-s * 0.48 * w, 0, 0);
  rig.hipR.rotation.set(s * 0.48 * w, 0, 0);
  rig.kneeL.rotation.x = (Math.pow(Math.max(0, c), 1.4) * 1.0 + Math.max(0, -c) * 0.12) * w + 0.03;
  rig.kneeR.rotation.x = (Math.pow(Math.max(0, -c), 1.4) * 1.0 + Math.max(0, c) * 0.12) * w + 0.03;
  // Push off the toes as a leg leaves the ground; land on the heel.
  const toeL = Math.max(0, -s) * Math.max(0, c + 0.3) * 0.7 * w - Math.max(0, s) * Math.max(0, 0.3 - c) * 0.25 * w;
  const toeR = Math.max(0, s) * Math.max(0, -c + 0.3) * 0.7 * w - Math.max(0, -s) * Math.max(0, 0.3 + c) * 0.25 * w;

  // Weight shifts from foot to foot at rest, slowly; side to side when walking.
  const shift = Math.sin(t * 0.55) * idle;
  rig.hips.position.set(0.012 * c * w + 0.014 * shift, BODY.hipsY - (0.008 + 0.034 * s * s) * w - 0.004 * Math.abs(shift), 0);
  rig.hips.rotation.set(0, s * 0.14 * w, 0.05 * c * w + 0.035 * shift);
  rig.kneeL.rotation.x += 0.1 * Math.max(0, shift);
  rig.kneeR.rotation.x += 0.1 * Math.max(0, -shift);
  // Legs hang straight down whatever the pelvis does.
  rig.hipL.rotation.z = rig.hipR.rotation.z = -rig.hips.rotation.z;

  // Chest counter-twists, leans into the walk and breathes at rest.
  const breathe = Math.sin(t * 1.7);
  rig.torso.rotation.set(0.07 * w * Math.min(speed, 1.2) + breathe * 0.012 * idle, -s * 0.26 * w + rig.turn * 0.12, -0.07 * c * w - 0.04 * shift);
  rig.neck.rotation.set(-0.03 * w, 0, 0.03 * shift);

  // Arms counter-swing; elbows bend more as the arm comes forward.
  rig.shoulderL.rotation.set(s * 0.42 * w + breathe * 0.02 * idle, 0, -0.07 - 0.02 * idle);
  rig.shoulderR.rotation.set(-s * 0.42 * w + breathe * 0.02 * idle, 0, 0.07 + 0.02 * idle);
  rig.elbowL.rotation.x = -0.14 - 0.25 * w - Math.max(0, -s) * 0.4 * w;
  rig.elbowR.rotation.x = -0.14 - 0.25 * w - Math.max(0, s) * 0.4 * w;
  rig.handL.rotation.set(-0.1 * w, 0, 0);
  rig.handR.rotation.set(-0.1 * w, 0, 0);

  // Head: steady while walking, glancing about at rest, leading any turn.
  const glance = Math.sin(t * 0.45) * 0.4 * idle * Math.max(0, Math.sin(t * 0.13));
  rig.head.rotation.set(-0.04 * w + Math.sin(t * 0.7) * 0.03 * idle, s * 0.1 * w + glance + Math.max(-0.6, Math.min(0.6, rig.turn)) * 0.45, 0);

  // Blink every few seconds.
  if (now > rig.blinkAt + 140) rig.blinkAt = now + 1800 + ((Math.sin(rig.blinkAt * 0.017 + rig.seed) + 1) / 2) * 3800;
  rig.eyes.scale.y = now > rig.blinkAt ? 0.12 : 1;

  // Working: blend from the walk/idle pose into the activity's pose.
  const target = activity && !moving ? activity : null;
  if (target) rig.activity = target;
  rig.work += ((target ? 1 : 0) - rig.work) * Math.min(1, dt * 10);
  const shown = rig.work > 0.05 ? rig.activity : null;
  for (const [key, tool] of rig.tools) tool.visible = !!shown && (ACTIVITY_TOOL[shown] === key || ACTIVITY_OFFHAND[shown] === key);
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
      if (dead) rig.eyes.scale.y = 0.12;
    }
  }

  // Feet stay flat on the ground whatever the legs are doing, bar the toe push.
  rig.ankleL.rotation.x = -(rig.hipL.rotation.x + rig.kneeL.rotation.x + rig.hips.rotation.x) * 0.9 + toeL;
  rig.ankleR.rotation.x = -(rig.hipR.rotation.x + rig.kneeR.rotation.x + rig.hips.rotation.x) * 0.9 + toeR;

  if (rig.cape) rig.cape.rotation.x = 0.06 + 0.24 * rig.walk + Math.sin(rig.phase * 2) * 0.06 * w + Math.sin(t * 1.3) * 0.02;
  // Hems trail behind and sway with the hips.
  rig.skirt.rotation.set((rig.robe ? 0.1 : 0.06) * rig.walk, 0, s * 0.05 * w);
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
