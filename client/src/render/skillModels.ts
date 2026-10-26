import * as THREE from 'three';
import type { ObstacleType, PatchKind, PatchView } from '@rpg/shared';
import { textures } from './textures';

/**
 * Models for Agility, Glyphcraft and Farming: obstacles, patches and their
 * crops, and the items those skills drop on the ground.
 */

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opts: { emissive?: number; map?: THREE.Texture; side?: THREE.Side } = {}): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? 0x000000, map: opts.map ?? null, side: opts.side ?? THREE.FrontSide });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** A pole from one point to another. */
function pole(from: THREE.Vector3, to: THREE.Vector3, r: number, color: number, map?: THREE.Texture): THREE.Mesh {
  const dir = to.clone().sub(from);
  const m = mesh(C(r, r, dir.length(), 6), color, 0, 0, 0, { map });
  m.position.copy(from).addScaledVector(dir, 0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
  return m;
}

/** Each glyph's colour, for its shrine's glow, its item and its icon. */
export const GLYPH_COLOURS: Record<string, number> = {
  wind: 0xbfe6f0,
  thought: 0xd8a8e8,
  tide: 0x4a8ad8,
  root: 0x9a7a4a,
  ember: 0xe8602a,
  vigour: 0xe8d84a,
  bloom: 0x6ac85a,
  star: 0xf4f4ff,
  storm: 0x8aa0ff,
  dusk: 0x6a4a9a,
  oath: 0xe8c060,
  crimson: 0xc82a3a,
};

/** Name of the swinging part of a rope swing, turned while someone swings on it. */
export const ROPE = 'rope-pivot';

/**
 * An agility obstacle, built along +Z (the way it is crossed) and centred on
 * its tile; the tiles you start and land on are at z = -1 and z = +1.
 */
export function buildObstacle(type: ObstacleType): THREE.Group {
  const g = new THREE.Group();
  const planks = textures.planks();
  const bricks = textures.bricks();
  const wood = 0x8a6240;
  const rope = 0xc8b48a;
  const mud = (len: number) => mesh(B(0.95, 0.03, len), 0x4a3a28, 0, 0.015, 0);
  switch (type) {
    case 'log': {
      g.add(mud(1.1));
      g.add(mesh(C(0.09, 0.1, 2.0, 9).rotateX(Math.PI / 2), 0x7a5a38, 0, 0.33, 0, { map: planks }));
      for (const z of [-0.85, 0.85]) {
        for (const s of [-1, 1]) {
          const leg = mesh(B(0.05, 0.42, 0.05), wood, s * 0.1, 0.19, z);
          leg.rotation.z = s * 0.35;
          g.add(leg);
        }
      }
      break;
    }
    case 'hurdle': {
      for (const x of [-0.45, 0.45]) g.add(mesh(C(0.035, 0.04, 0.62), wood, x, 0.31, 0), mesh(B(0.08, 0.05, 0.3), wood, x, 0.025, 0));
      g.add(mesh(B(0.95, 0.07, 0.05), 0xe8e0c8, 0, 0.55, 0, { map: planks }), mesh(B(0.95, 0.05, 0.04), 0xc0392b, 0, 0.3, 0));
      break;
    }
    case 'net': {
      const top = 1.6;
      for (const x of [-0.5, 0.5]) {
        g.add(pole(new THREE.Vector3(x, 0, -0.8), new THREE.Vector3(x, top, 0), 0.04, wood));
        g.add(pole(new THREE.Vector3(x, 0, 0.8), new THREE.Vector3(x, top, 0), 0.04, wood));
      }
      g.add(mesh(C(0.045, 0.045, 1.1).rotateZ(Math.PI / 2), wood, 0, top, 0));
      for (const side of [-1, 1]) {
        for (let n = -3; n <= 3; n++) g.add(pole(new THREE.Vector3(n * 0.13, 0.02, side * 0.78), new THREE.Vector3(n * 0.13, top, 0), 0.008, rope));
        for (let k = 1; k <= 6; k++) {
          const f = k / 7;
          g.add(mesh(C(0.008, 0.008, 0.95, 4).rotateZ(Math.PI / 2), rope, 0, f * top, side * 0.78 * (1 - f)));
        }
      }
      break;
    }
    case 'rope': {
      g.add(mesh(B(0.95, 0.03, 1.2), 0x3a4a3a, 0, 0.015, 0));
      for (const x of [-0.7, 0.7]) g.add(mesh(C(0.06, 0.07, 2.75), wood, x, 1.37, 0, { map: planks }));
      g.add(mesh(B(1.55, 0.1, 0.1), wood, 0, 2.7, 0, { map: planks }));
      const pivot = new THREE.Group();
      pivot.name = ROPE;
      pivot.position.set(0, 2.65, 0);
      pivot.add(mesh(C(0.018, 0.018, 2.0, 5).translate(0, -1.0, 0), rope));
      pivot.add(mesh(new THREE.SphereGeometry(0.05, 6, 5), rope, 0, -1.95, 0));
      g.add(pivot);
      break;
    }
    case 'stones': {
      g.add(mesh(new THREE.CylinderGeometry(0.5, 0.5, 0.03, 16).scale(1, 1, 1.9), 0x3a5a6a, 0, 0.015, 0));
      for (const z of [-0.62, 0, 0.62]) {
        g.add(mesh(C(0.16, 0.18, 0.3, 9), 0x7a5a38, 0, 0.15, z, { map: planks }));
        g.add(mesh(C(0.155, 0.155, 0.01, 9), 0xd9b47c, 0, 0.305, z));
      }
      break;
    }
    case 'pipe': {
      g.add(mesh(new THREE.CylinderGeometry(0.36, 0.36, 1.7, 16, 1, true).rotateX(Math.PI / 2), 0x7d776e, 0, 0.37, 0, { side: THREE.DoubleSide, map: textures.rock() }));
      for (const z of [-0.85, 0.85]) g.add(mesh(new THREE.TorusGeometry(0.36, 0.04, 6, 16), 0x5a5550, 0, 0.37, z));
      for (const z of [-0.5, 0.5]) g.add(mesh(B(0.8, 0.06, 0.12), wood, 0, 0.03, z));
      break;
    }
    case 'bars': {
      const h = 1.95;
      for (const x of [-0.45, 0.45]) {
        for (const z of [-0.9, 0.9]) g.add(mesh(C(0.04, 0.05, h), wood, x, h / 2, z, { map: planks }));
        g.add(mesh(B(0.06, 0.06, 1.9), wood, x, h, 0));
      }
      for (let n = -3; n <= 3; n++) g.add(mesh(C(0.018, 0.018, 0.9, 6).rotateZ(Math.PI / 2), 0x8a8c92, 0, h + 0.02, n * 0.27));
      break;
    }
    case 'wall': {
      g.add(mesh(B(0.95, 0.72, 0.4), 0x9a948a, 0, 0.36, 0, { map: bricks }), mesh(B(1.0, 0.06, 0.46), 0x8a8478, 0, 0.75, 0));
      break;
    }
  }
  return g;
}

/** A tiny seeded random, so a patch looks the same each time it is rebuilt. */
function seeded(seed: number): () => number {
  let a = Math.floor(seed * 1e6) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HERB_LEAVES: Record<string, number> = { sunleaf: 0xd8c040, marshwort: 0x4f8a3a, duskroot: 0x5a3a5a, silverfern: 0xa8c0c0, hawkweed: 0x7a9a32, emberbloom: 0x7a8a2a };
const HERB_FLOWERS: Record<string, number> = { sunleaf: 0xffe060, marshwort: 0xe8e8f0, duskroot: 0x9a5ab0, silverfern: 0xe0f0ff, hawkweed: 0xf0c020, emberbloom: 0xff5020 };

/** One plant of a crop, `g` grown (0..1). `leaf` is the leaf colour after any sickness. */
function plant(crop: string, g: number, leaf: (c: number) => number, grown: boolean): THREE.Group {
  const p = new THREE.Group();
  const s = 0.35 + 0.65 * g;
  const green = leaf(0x4f9a3a);
  switch (crop) {
    case 'potato':
      for (const [x, z] of [[0, 0], [0.06, 0.05], [-0.05, 0.04], [0.02, -0.06]]) p.add(mesh(new THREE.IcosahedronGeometry(0.07 * s, 0), green, x * s, 0.08 * s, z * s));
      if (grown) for (const x of [-0.09, 0.1]) p.add(mesh(new THREE.SphereGeometry(0.04, 6, 5).scale(1.2, 0.8, 1), 0xa07a4a, x, 0.02, 0.06));
      break;
    case 'onion':
      for (let n = 0; n < 4; n++) {
        const blade = mesh(new THREE.ConeGeometry(0.015, 0.32 * s, 4), green, Math.cos(n * 1.6) * 0.02, 0.16 * s, Math.sin(n * 1.6) * 0.02);
        blade.rotation.set(Math.sin(n * 2.1) * 0.25, 0, Math.cos(n * 2.1) * 0.25);
        p.add(blade);
      }
      if (grown) p.add(mesh(new THREE.SphereGeometry(0.06, 8, 6).scale(1, 0.85, 1), 0xe8d8a8, 0, 0.04, 0));
      break;
    case 'cabbage':
      p.add(mesh(new THREE.SphereGeometry(0.11 * s, 8, 6).scale(1, 0.8, 1), leaf(0x7ab84a), 0, 0.08 * s, 0));
      for (let n = 0; n < 5; n++) {
        const outer = mesh(new THREE.SphereGeometry(0.08 * s, 6, 4).scale(1.3, 0.35, 1), green, Math.cos(n * 1.26) * 0.09 * s, 0.03, Math.sin(n * 1.26) * 0.09 * s);
        outer.rotation.y = -n * 1.26;
        p.add(outer);
      }
      break;
    case 'tomato':
      p.add(mesh(C(0.008, 0.008, 0.55 * s, 4), 0x9a7448, 0.04, 0.27 * s, 0));
      for (let n = 0; n < 4; n++) p.add(mesh(new THREE.IcosahedronGeometry(0.06 * s, 0), green, Math.cos(n * 1.7) * 0.05, (0.12 + n * 0.1) * s, Math.sin(n * 1.7) * 0.05));
      if (g > 0.6) for (let n = 0; n < 3; n++) p.add(mesh(new THREE.SphereGeometry(0.03, 7, 5), grown ? 0xd8302a : 0x8ab84a, Math.cos(n * 2.1) * 0.07, (0.15 + n * 0.09) * s, Math.sin(n * 2.1) * 0.07));
      break;
    case 'sweetcorn':
      p.add(mesh(C(0.014, 0.018, 0.9 * s, 5), leaf(0x6aa83a), 0, 0.45 * s, 0));
      for (let n = 0; n < 4; n++) {
        const blade = mesh(new THREE.ConeGeometry(0.02, 0.32 * s, 3), green, 0, (0.2 + n * 0.17) * s, 0);
        blade.rotation.set(0.9, n * 1.9, 0);
        blade.position.x = Math.sin(n * 1.9) * 0.08;
        blade.position.z = Math.cos(n * 1.9) * 0.08;
        p.add(blade);
      }
      if (grown) p.add(mesh(new THREE.CylinderGeometry(0.025, 0.02, 0.14, 6), 0xf0d040, 0.035, 0.55, 0));
      break;
    case 'strawberry':
      for (let n = 0; n < 5; n++) p.add(mesh(new THREE.SphereGeometry(0.05 * s, 6, 4).scale(1.2, 0.4, 1), green, Math.cos(n * 1.26) * 0.06 * s, 0.04, Math.sin(n * 1.26) * 0.06 * s));
      if (grown) for (let n = 0; n < 4; n++) p.add(mesh(new THREE.ConeGeometry(0.022, 0.04, 6).rotateX(Math.PI), 0xe02a3a, Math.cos(n * 1.6 + 0.4) * 0.09, 0.03, Math.sin(n * 1.6 + 0.4) * 0.09));
      break;
    case 'watermelon':
      for (let n = 0; n < 4; n++) {
        const vine = mesh(new THREE.SphereGeometry(0.06 * s, 6, 4).scale(1.6, 0.3, 0.8), green, Math.cos(n * 1.6) * 0.1 * s, 0.03, Math.sin(n * 1.6) * 0.1 * s);
        vine.rotation.y = -n * 1.6;
        p.add(vine);
      }
      if (g > 0.5) p.add(mesh(new THREE.SphereGeometry(0.13 * (grown ? 1 : 0.6), 10, 8).scale(1.25, 0.9, 1), 0x3a7a2a, 0, 0.1 * (grown ? 1 : 0.6), 0, { map: textures.planks() }));
      break;
    default: {
      // Herbs: a leafy clump in the herb's colour, flowering when grown.
      const leafColour = leaf(HERB_LEAVES[crop] ?? 0x5a8a3a);
      for (let n = 0; n < 6; n++) {
        const l = mesh(new THREE.SphereGeometry(0.04 * s, 6, 4).scale(0.6, 1.8, 0.3), leafColour, Math.cos(n) * 0.05 * s, 0.07 * s, Math.sin(n) * 0.05 * s);
        l.rotation.set(Math.sin(n) * 0.6, n, Math.cos(n) * 0.6);
        p.add(l);
      }
      if (grown) for (let n = 0; n < 3; n++) p.add(mesh(new THREE.SphereGeometry(0.022, 6, 5), HERB_FLOWERS[crop] ?? 0xffffff, Math.cos(n * 2.1) * 0.04, 0.16, Math.sin(n * 2.1) * 0.04));
    }
  }
  return p;
}

/**
 * A farming patch as one player sees it: bare or composted soil, weeds, or a
 * crop at its stage, yellowed when diseased and brown and drooping when dead.
 */
export function buildPatch(kind: PatchKind, view: PatchView | undefined, seed: number): THREE.Group {
  const g = new THREE.Group();
  const rnd = seeded(seed + 0.17);
  const soil = view?.compost ? 0x3e2c1e : 0x5a4330;
  g.add(mesh(B(0.96, 0.08, 0.96), soil, 0, 0.04, 0));
  for (const z of [-0.28, 0, 0.28]) g.add(mesh(B(0.9, 0.06, 0.16), view?.compost ? 0x4a3424 : 0x6b5038, 0, 0.09, z));
  for (const x of [-0.46, 0.46]) g.add(mesh(B(0.04, 0.16, 0.96), 0x7a5230, x, 0.08, 0, { map: textures.planks() }));
  const weeds = view ? view.weeds : 3;
  if (!view?.crop) {
    for (let n = 0; n < weeds * 6; n++) {
      const tuft = new THREE.Group();
      for (let b = 0; b < 3; b++) {
        const blade = mesh(new THREE.ConeGeometry(0.02, 0.16 + rnd() * 0.14, 3), [0x5a7a2a, 0x6a8a32, 0x4a6a2a][b], 0, 0.1, 0);
        blade.rotation.set((rnd() - 0.5) * 0.8, rnd() * 3, (rnd() - 0.5) * 0.8);
        tuft.add(blade);
      }
      tuft.position.set((rnd() - 0.5) * 0.8, 0.08, (rnd() - 0.5) * 0.8);
      g.add(tuft);
    }
    return g;
  }
  const grown = view.stage === view.stages && !view.dead;
  const growth = view.stages ? (view.stage ?? 0) / view.stages : 0;
  const sick = (c: number) => new THREE.Color(c).lerp(new THREE.Color(0x9a8a3a), 0.55).getHex();
  const leaf = view.dead ? () => 0x6a5038 : view.diseased ? sick : (c: number) => c;
  const spots = kind === 'allotment' ? [[-0.24, -0.24], [0.24, -0.24], [-0.24, 0.24], [0.24, 0.24]] : [[-0.22, -0.18], [0.22, -0.12], [0, 0.22]];
  for (const [x, z] of spots) {
    const p = plant(view.crop, Math.max(0.12, growth), leaf, grown);
    p.position.set(x, 0.1, z);
    p.rotation.y = rnd() * Math.PI * 2;
    if (view.dead) {
      p.rotation.x = 0.5;
      p.scale.set(1, 0.6, 1);
    }
    g.add(p);
  }
  return g;
}

/** Ground models for the items these skills bring, or null for anything else. */
export function buildSkillItem(itemId: string): THREE.Group | null {
  const g = new THREE.Group();
  const glyph = /^(\w+)_glyph$/.exec(itemId)?.[1];
  if (itemId === 'aether_shard') {
    g.add(mesh(new THREE.OctahedronGeometry(0.07, 0).scale(0.8, 1.4, 0.8), 0xcfe8ff, 0, 0.09, 0, { emissive: 0x2a4a7a }));
  } else if (glyph && GLYPH_COLOURS[glyph] !== undefined) {
    for (const [x, z] of [[0, 0], [0.08, 0.05], [-0.07, 0.06]]) {
      g.add(mesh(C(0.05, 0.055, 0.03, 10), 0xd8d0c0, x, 0.015, z));
      g.add(mesh(C(0.025, 0.025, 0.005, 6), GLYPH_COLOURS[glyph], x, 0.033, z, { emissive: GLYPH_COLOURS[glyph] & 0x3f3f3f }));
    }
  } else if (itemId === 'rake' || itemId === 'spade' || itemId === 'seed_dibber') {
    const len = itemId === 'seed_dibber' ? 0.2 : 0.75;
    g.add(mesh(C(0.014, 0.016, len, 6).rotateZ(Math.PI / 2), 0x8a6a42, 0, 0.02, 0));
    if (itemId === 'rake') g.add(mesh(B(0.04, 0.03, 0.24), 0x6c6e74, len / 2, 0.02, 0));
    if (itemId === 'spade') g.add(mesh(B(0.16, 0.012, 0.13), 0x8a8c92, len / 2 + 0.07, 0.01, 0));
  } else if (itemId === 'bucket' || itemId === 'compost') {
    g.add(mesh(C(0.1, 0.085, 0.16, 12), 0x8a6240, 0, 0.08, 0));
    g.add(mesh(C(0.09, 0.09, 0.01, 12), itemId === 'compost' ? 0x3a2a1a : 0x2a2018, 0, 0.15, 0));
  } else if (itemId === 'plant_cure') {
    const glass = new THREE.Mesh(C(0.045, 0.05, 0.14, 10), new THREE.MeshLambertMaterial({ color: 0xcfe8f0, transparent: true, opacity: 0.45 }));
    glass.position.y = 0.07;
    g.add(glass, mesh(C(0.04, 0.045, 0.09, 10), 0x6ad84a, 0, 0.048, 0), mesh(C(0.022, 0.02, 0.03, 8), 0x9a7448, 0, 0.155, 0));
  } else if (itemId.endsWith('_seed')) {
    g.add(mesh(new THREE.SphereGeometry(0.08, 8, 6).scale(1, 0.8, 1), 0xc8b48a, 0, 0.06, 0));
    g.add(mesh(C(0.03, 0.05, 0.05, 8), 0xb8a47a, 0, 0.13, 0));
  } else if (itemId === 'potato' || itemId === 'baked_potato') {
    g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6).scale(1.3, 0.8, 1), itemId === 'potato' ? 0xa07a4a : 0x8a5a2a, 0, 0.05, 0));
  } else if (itemId === 'onion') {
    g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6), 0xd8b878, 0, 0.07, 0), mesh(new THREE.ConeGeometry(0.02, 0.06, 5), 0x8a9a4a, 0, 0.15, 0));
  } else if (itemId === 'cabbage') {
    g.add(mesh(new THREE.SphereGeometry(0.11, 9, 7), 0x7ab84a, 0, 0.1, 0));
  } else if (itemId === 'tomato') {
    g.add(mesh(new THREE.SphereGeometry(0.06, 9, 7).scale(1, 0.85, 1), 0xd8302a, 0, 0.05, 0), mesh(new THREE.ConeGeometry(0.025, 0.02, 5), 0x4f8a3a, 0, 0.105, 0));
  } else if (itemId === 'sweetcorn' || itemId === 'cooked_sweetcorn') {
    g.add(mesh(C(0.04, 0.035, 0.24, 8).rotateZ(Math.PI / 2), itemId === 'sweetcorn' ? 0xf0d040 : 0xe8b030, 0, 0.04, 0));
    if (itemId === 'sweetcorn') g.add(mesh(new THREE.ConeGeometry(0.05, 0.16, 6).rotateZ(Math.PI / 2), 0x8ab84a, -0.17, 0.04, 0));
  } else if (itemId === 'strawberry') {
    g.add(mesh(new THREE.ConeGeometry(0.04, 0.08, 7).rotateX(Math.PI), 0xe02a3a, 0, 0.045, 0));
  } else if (itemId === 'watermelon') {
    g.add(mesh(new THREE.SphereGeometry(0.15, 10, 8).scale(1.3, 0.9, 1), 0x3a7a2a, 0, 0.13, 0));
  } else return null;
  g.traverse((o) => (o.castShadow = true));
  return g;
}
