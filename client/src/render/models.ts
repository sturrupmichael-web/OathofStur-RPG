import * as THREE from 'three';
import { textures } from './textures';

/** Metal colour of dropped gear and bars, from the item's first word. */
const GROUND_METALS: Record<string, number> = {
  bronze: 0xc88a4a,
  iron: 0x9a9ca4,
  steel: 0xc9d3dd,
  cobalt: 0x4a6fc4,
  verdite: 0x3a6e50,
  glacite: 0xa8dcef,
  duskfang: 0xd8ccb4,
};
const groundMetal = (itemId: string): number | undefined => GROUND_METALS[itemId.split('_')[0]];

/**
 * Procedural placeholder models. Everything is built from primitives so the
 * game ships with zero external art.
 */

export interface PartStyle {
  geometry: THREE.BufferGeometry;
  color: number;
  emissive?: number;
  position: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
  /** How much each instance's tint may vary (0 = none). */
  vary?: number;
  /** Fishing ripples animate; everything else is static. */
  ripple?: boolean;
  transparent?: boolean;
  map?: () => THREE.Texture;
}

const trunk = (r: number, h: number) => new THREE.CylinderGeometry(r * 0.7, r, h, 7);
const blob = (r: number, detail = 1) => new THREE.IcosahedronGeometry(r, detail);
const ring = (r: number) => new THREE.TorusGeometry(r, 0.03, 4, 24).rotateX(Math.PI / 2);
const root = new THREE.ConeGeometry(0.07, 0.35, 4).rotateZ(Math.PI / 2.4);

/** Three angled roots around a trunk base. */
const roots = (color: number, spread: number): PartStyle[] =>
  [0, 2.1, 4.2].map((a) => ({
    geometry: root,
    color,
    position: [Math.cos(a) * spread, 0.05, Math.sin(a) * spread] as [number, number, number],
    rotation: [0, -a, 0] as [number, number, number],
  }));

const limb = new THREE.CylinderGeometry(0.035, 0.06, 1, 5).translate(0, 0.5, 0);

/** A branch leaving the trunk at height `y`, leaning out toward angle `a`. */
const branch = (color: number, out: number, y: number, a: number, len: number, r = 0.05): PartStyle => ({
  geometry: limb,
  color,
  position: [Math.cos(a) * out * 0.3, y, Math.sin(a) * out * 0.3],
  rotation: [Math.sin(a) * 0.9, 0, -Math.cos(a) * 0.9],
  scale: [r / 0.05, len, r / 0.05],
  vary: 0.08,
});

/**
 * A rounded crown of leaf clumps around `y`: one big core, a ring of six
 * around its waist and a cap. `r` is the core's radius; `flat` squashes it.
 */
function canopy(colors: number[], y: number, r: number, flat: number, emissive?: number[]): PartStyle[] {
  const c = (k: number) => colors[k % colors.length];
  const e = (k: number) => emissive?.[k % emissive.length];
  const parts: PartStyle[] = [{ geometry: blob(r), color: c(0), emissive: e(0), position: [0, y, 0], scale: [1.15, flat, 1.15], vary: 0.12 }];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2 + 0.4;
    const rr = r * (0.62 + (k % 3) * 0.08);
    parts.push({
      geometry: blob(rr),
      color: c(k + 1),
      emissive: e(k + 1),
      position: [Math.cos(a) * r * 0.85, y - r * 0.15 + (k % 2) * r * 0.25, Math.sin(a) * r * 0.85],
      scale: [1, flat, 1],
      vary: 0.14,
    });
  }
  parts.push({ geometry: blob(r * 0.6), color: c(3), emissive: e(3), position: [0.05, y + r * 0.7, 0.03], scale: [1, flat, 1], vary: 0.14 });
  return parts;
}

const rockChunk = new THREE.DodecahedronGeometry(0.3, 0);
const nugget = new THREE.OctahedronGeometry(0.08, 0);

const rockParts = (ore: number, emissive?: number): PartStyle[] => [
  { geometry: rockChunk, color: 0x7d776e, position: [0, 0.2, 0], scale: [1.25, 0.85, 1.1], vary: 0.12, map: textures.rock },
  { geometry: rockChunk, color: 0x6f6a62, position: [0.22, 0.13, 0.18], scale: [0.7, 0.55, 0.7], vary: 0.12, map: textures.rock },
  { geometry: rockChunk, color: 0x847e74, position: [-0.2, 0.12, 0.16], scale: [0.6, 0.5, 0.65], vary: 0.12, map: textures.rock },
  ...([
    [0.14, 0.42, 0.06, 1],
    [-0.17, 0.33, -0.12, 0.85],
    [0.03, 0.31, 0.28, 0.75],
    [0.3, 0.24, 0.1, 0.7],
    [-0.26, 0.2, 0.22, 0.65],
    [-0.02, 0.45, -0.18, 0.7],
  ] as const).map(([x, y, z, s]) => ({ geometry: nugget, color: ore, emissive, position: [x, y, z] as [number, number, number], scale: [s, s, s] as [number, number, number] })),
];

const bubble = new THREE.SphereGeometry(0.035, 6, 4);
const fishingParts = (deep: boolean): PartStyle[] => [
  { geometry: ring(0.32), color: deep ? 0xbfe3ff : 0xe8f6ff, position: [0, -0.15, 0], ripple: true, transparent: true },
  { geometry: ring(0.2), color: 0xffffff, position: [0.1, -0.15, -0.06], ripple: true, transparent: true },
  { geometry: ring(0.12), color: 0xffffff, position: [-0.14, -0.15, 0.1], ripple: true, transparent: true },
  { geometry: bubble, color: 0xffffff, position: [0.05, -0.12, 0.05], ripple: true, transparent: true },
  { geometry: bubble, color: 0xffffff, position: [-0.08, -0.12, -0.1], ripple: true, transparent: true },
  // A darting fish shadow under the surface.
  { geometry: new THREE.SphereGeometry(0.09, 6, 4), color: deep ? 0x10304f : 0x1d4a6e, position: [0, -0.24, 0], scale: [1.8, 0.4, 0.7], ripple: true, transparent: true },
];

export const RESOURCE_STYLES: Record<string, PartStyle[]> = {
  // Trees stand two to three times a person's height. Big trees (2 x 2) are
  // these same models drawn larger by EntityLayer.
  tree: [
    { geometry: trunk(0.13, 1.5), color: 0x6b4a2b, position: [0, 0.75, 0], vary: 0.1 },
    ...roots(0x5f4126, 0.13),
    branch(0x6b4a2b, 0.16, 1.25, 0.5, 0.8),
    branch(0x6b4a2b, -0.14, 1.4, -2.4, 0.7),
    ...canopy([0x3f8f3a, 0x4a9a40, 0x37803a, 0x52a347], 1.85, 0.5, 0.95),
  ],
  // Plain 'tree' nodes are drawn as one of these too, picked per tile, so a
  // wood is a mix: birch, pine and beech among the broadleaves.
  tree_birch: [
    { geometry: trunk(0.09, 2.0), color: 0xe8e4da, position: [0, 1.0, 0], vary: 0.05 },
    ...[0.45, 0.8, 1.15, 1.5].map((y, k) => ({ geometry: new THREE.CylinderGeometry(0.075, 0.08, 0.05, 7), color: 0x2a2826, position: [0, y, 0] as [number, number, number], rotation: [0, k, 0.08 * (k % 2 ? 1 : -1)] as [number, number, number] })),
    ...roots(0xcfcac0, 0.09),
    branch(0xd8d4ca, 0.1, 1.5, 0.9, 0.6, 0.035),
    branch(0xd8d4ca, -0.1, 1.7, -2.2, 0.5, 0.03),
    ...canopy([0x8cbf4a, 0x9ccc58, 0x7fb243, 0xa8d462], 2.2, 0.42, 1.2),
  ],
  tree_pine: [
    { geometry: trunk(0.12, 1.2), color: 0x5a3a24, position: [0, 0.6, 0], vary: 0.08 },
    ...roots(0x4e3220, 0.12),
    { geometry: new THREE.ConeGeometry(0.62, 0.9, 7), color: 0x2f5a3c, position: [0, 1.0, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.5, 0.85, 7), color: 0x346444, position: [0, 1.5, 0], rotation: [0, 0.4, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.38, 0.8, 7), color: 0x3a6c4a, position: [0, 1.95, 0], rotation: [0, 0.8, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.24, 0.7, 6), color: 0x40744f, position: [0, 2.4, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.04, 0.3, 4), color: 0x40744f, position: [0, 2.85, 0] },
  ],
  tree_beech: [
    { geometry: trunk(0.17, 1.3), color: 0x8a8a80, position: [0, 0.65, 0], vary: 0.06 },
    ...roots(0x7a7a70, 0.17),
    branch(0x8a8a80, 0.2, 1.1, 0.6, 0.9, 0.06),
    branch(0x8a8a80, -0.2, 1.2, 3.0, 0.85, 0.055),
    ...canopy([0x6a8a2a, 0x8a8a2e, 0x5f7f28, 0x9a7a30], 1.75, 0.6, 0.7),
  ],
  oak_tree: [
    { geometry: trunk(0.22, 1.3), color: 0x5e3f24, position: [0, 0.65, 0], vary: 0.08 },
    ...roots(0x553820, 0.22),
    branch(0x5e3f24, 0.25, 1.15, 0.3, 1.0, 0.07),
    branch(0x5e3f24, -0.22, 1.2, 2.6, 0.9, 0.06),
    branch(0x5e3f24, 0.05, 1.3, -1.6, 0.8, 0.05),
    ...canopy([0x5d7f2b, 0x6a8c32, 0x547628, 0x678a30], 1.8, 0.62, 0.75),
  ],
  willow_tree: [
    { geometry: trunk(0.16, 1.5), color: 0x6f5a3a, position: [0, 0.75, 0], rotation: [0.06, 0, 0.05], vary: 0.08 },
    ...roots(0x5f4a2f, 0.16),
    { geometry: blob(0.5), color: 0x93b552, position: [0, 1.85, 0], scale: [1.15, 0.7, 1.15], vary: 0.1 },
    { geometry: blob(0.3), color: 0x9fc05e, position: [0.05, 2.15, 0.05], vary: 0.1 },
    // Drooping fronds in two rings, the outer one reaching almost to the ground.
    ...[0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((k) => {
      const a = (k / 11) * Math.PI * 2;
      const outer = k % 2 === 0;
      const r = outer ? 0.55 : 0.36;
      const len = outer ? 1.35 : 1.0;
      return {
        geometry: new THREE.ConeGeometry(0.13, 1, 4).rotateX(Math.PI),
        color: outer ? 0x86a84a : 0x7c9e44,
        position: [Math.cos(a) * r, 1.85 - len / 2, Math.sin(a) * r] as [number, number, number],
        scale: [1, len, 1] as [number, number, number],
        rotation: [Math.sin(a) * 0.12, 0, -Math.cos(a) * 0.12] as [number, number, number],
        vary: 0.12,
      };
    }),
  ],
  yew_tree: [
    { geometry: trunk(0.18, 1.0), color: 0x3f2b1a, position: [0, 0.5, 0], vary: 0.08 },
    ...roots(0x35241a, 0.18),
    { geometry: new THREE.ConeGeometry(0.72, 1.0, 9), color: 0x1d4a2e, position: [0, 1.05, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.6, 0.95, 9), color: 0x22553a, position: [0, 1.55, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.48, 0.9, 9), color: 0x276042, position: [0, 2.02, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.34, 0.8, 8), color: 0x2c6a48, position: [0, 2.45, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.18, 0.55, 8), color: 0x317250, position: [0, 2.85, 0], vary: 0.1 },
  ],
  dead_tree: [
    { geometry: trunk(0.14, 1.8), color: 0x5a5048, position: [0, 0.9, 0], vary: 0.12 },
    ...roots(0x4e463e, 0.14),
    { geometry: new THREE.CylinderGeometry(0.03, 0.07, 0.9, 5), color: 0x5a5048, position: [0.26, 1.55, 0], rotation: [0, 0, -0.8], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.025, 0.06, 0.75, 5), color: 0x544a42, position: [-0.22, 1.7, 0.08], rotation: [0.3, 0, 0.9], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.02, 0.05, 0.7, 5), color: 0x5a5048, position: [0.03, 1.85, -0.22], rotation: [-0.8, 0, 0.1], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.015, 0.035, 0.45, 4), color: 0x4e463e, position: [0.55, 1.95, 0], rotation: [0, 0, -0.2] },
    { geometry: new THREE.CylinderGeometry(0.012, 0.03, 0.4, 4), color: 0x4e463e, position: [-0.05, 1.95, 0.2], rotation: [0.5, 0, -0.3] },
  ],
  // Felled trees wait as stumps until they grow back.
  tree_stump: [
    { geometry: trunk(0.15, 0.2), color: 0x6b4a2b, position: [0, 0.1, 0], vary: 0.1 },
    { geometry: new THREE.CylinderGeometry(0.105, 0.105, 0.01, 7), color: 0xd9b47c, position: [0, 0.205, 0] },
    ...roots(0x5f4126, 0.14),
  ],
  dead_tree_stump: [
    { geometry: trunk(0.15, 0.24), color: 0x5a5048, position: [0, 0.12, 0], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.105, 0.105, 0.01, 7), color: 0xc9bfae, position: [0, 0.245, 0] },
    ...roots(0x4e463e, 0.14),
  ],
  copper_rock: rockParts(0xd07a3a),
  // Mined-out rocks: the same stone with the ore gone.
  copper_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  tin_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  iron_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  coal_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  tin_rock: rockParts(0xd4d8e0),
  iron_rock: rockParts(0x9a5238),
  coal_rock: rockParts(0x1c1c1c),
  gold_rock: rockParts(0xf0c840),
  cobalt_rock: rockParts(0x3a5ad0),
  verdite_rock: rockParts(0x2f8a5a),
  glacite_rock: rockParts(0x8fe0ff, 0x2a8ad0),
  gold_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  cobalt_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  verdite_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  glacite_rock_stump: rockParts(0x6f6a62).slice(0, 3),
  // Starwood: pale bark and a canopy with a faint light in it.
  starwood_tree: [
    { geometry: trunk(0.16, 1.6), color: 0xd8d0c0, position: [0, 0.8, 0], vary: 0.06 },
    ...roots(0xc8c0b0, 0.16),
    branch(0xd8d0c0, 0.18, 1.35, 1.2, 0.8),
    ...canopy([0x7fd8c8, 0x9fe8dc, 0x6fc8bc, 0xcdf6ef], 2.05, 0.52, 0.95, [0x16483f, 0x1d5a50, 0x16483f, 0x2a7a6c]),
  ],
  oak_tree_stump: [
    { geometry: trunk(0.2, 0.22), color: 0x5e3f24, position: [0, 0.11, 0], vary: 0.08 },
    { geometry: new THREE.CylinderGeometry(0.14, 0.14, 0.01, 7), color: 0xd9b47c, position: [0, 0.225, 0] },
    ...roots(0x553820, 0.2),
  ],
  willow_tree_stump: [
    { geometry: trunk(0.16, 0.22), color: 0x6f5a3a, position: [0, 0.11, 0], vary: 0.08 },
    { geometry: new THREE.CylinderGeometry(0.115, 0.115, 0.01, 7), color: 0xd9c08c, position: [0, 0.225, 0] },
    ...roots(0x5f4a2f, 0.16),
  ],
  yew_tree_stump: [
    { geometry: trunk(0.18, 0.24), color: 0x3f2b1a, position: [0, 0.12, 0], vary: 0.08 },
    { geometry: new THREE.CylinderGeometry(0.13, 0.13, 0.01, 7), color: 0xb08a5c, position: [0, 0.245, 0] },
    ...roots(0x35241a, 0.18),
  ],
  starwood_tree_stump: [
    { geometry: trunk(0.17, 0.24), color: 0xd8d0c0, position: [0, 0.12, 0], vary: 0.06 },
    { geometry: new THREE.CylinderGeometry(0.12, 0.12, 0.01, 7), color: 0xcdf6ef, emissive: 0x2a7a6c, position: [0, 0.245, 0] },
    ...roots(0xc8c0b0, 0.17),
  ],
  shallow_fishing_spot: fishingParts(false),
  deep_fishing_spot: fishingParts(true),
};

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opts: { emissive?: number; map?: THREE.Texture } = {}): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? 0x000000, map: opts.map ?? null });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
/** A colour a little lighter or darker. */
const shadeOf = (c: number, f: number) => new THREE.Color(c).multiplyScalar(f).getHex();
const C = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Glowing parts that flicker (furnace mouth, range fire). Renderer animates them. */
export const FLICKER = 'flicker';
/** The homestead gate's leaf, which swings open as someone goes through. */
export const GATE_LEAF = 'gate-leaf';

/** The object on the tile at an offset, or its terrain if it has none, for props that span tiles. */
export type NeighbourLookup = (dx: number, dy: number) => string | null;

/** Stations and props face +Z (toward the open tile in front of them). `tint` colours a glyph shrine's glow. */
export function buildStation(defKey: string, near: NeighbourLookup = () => null, seed = 0, tint = 0x9ad8ff): THREE.Group {
  const k = Math.floor(seed * 1e6);
  const g = new THREE.Group();
  const bricks = textures.bricks();
  const planks = textures.planks();
  switch (defKey) {
    case 'bank_booth': {
      // Counter with a brass grille; neighbouring booths join into one long counter.
      g.add(
        mesh(B(1.0, 0.72, 0.6), 0x6e4526, 0, 0.36, 0, { map: planks }),
        mesh(B(1.04, 0.06, 0.66), 0x4a2f1a, 0, 0.75, 0),
        mesh(B(1.0, 0.1, 0.08), 0x3a2416, 0, 1.55, 0.02),
      );
      for (const x of [-0.45, 0.45]) g.add(mesh(B(0.08, 0.84, 0.08), 0x4a2f1a, x, 1.16, 0.02));
      for (let n = -2; n <= 2; n++) g.add(mesh(C(0.012, 0.012, 0.7, 5), 0xd4a73a, n * 0.16, 1.15, 0.02, { emissive: 0x2a1c00 }));
      g.add(mesh(B(0.3, 0.02, 0.2), 0xe8e0c8, 0.15, 0.79, 0.12), mesh(C(0.04, 0.04, 0.05, 8), 0xe8c04a, -0.2, 0.8, 0.1, { emissive: 0x2a1c00 }));
      break;
    }
    case 'market_stall': {
      const awning = [0xc0392b, 0x2f6a9a, 0x3f8a3a, 0xd4a020][k % 4];
      g.add(mesh(B(0.92, 0.6, 0.5), 0x7a5230, 0, 0.3, 0.12, { map: planks }), mesh(B(0.98, 0.05, 0.56), 0x5a3a20, 0, 0.62, 0.12));
      for (const x of [-0.44, 0.44]) for (const z of [-0.36, 0.34]) g.add(mesh(B(0.06, z < 0 ? 1.5 : 1.25, 0.06), 0x5a3a20, x, z < 0 ? 0.75 : 0.62, z));
      // Striped awning sloping toward the customer.
      for (let n = 0; n < 5; n++) {
        const stripe = mesh(B(0.2, 0.03, 0.86), n % 2 ? 0xf2ead8 : awning, -0.4 + n * 0.2, 1.38, -0.01);
        stripe.rotation.x = 0.28;
        g.add(stripe);
      }
      // Goods: produce, pots and cloth bolts.
      const goods = [0xd04a2a, 0xe8b030, 0x6a9a3a, 0x8a5a3a, 0xc8b8e8];
      for (let n = 0; n < 5; n++) g.add(mesh(new THREE.SphereGeometry(0.06, 6, 4), goods[(n * 3 + k) % goods.length], -0.32 + n * 0.16, 0.7, 0.18));
      g.add(mesh(C(0.06, 0.05, 0.14, 8), 0x9a6a4a, 0.3, 0.71, 0.0), mesh(C(0.05, 0.05, 0.3, 8).rotateZ(Math.PI / 2), 0x7a4a8a, -0.2, 0.69, 0.0));
      break;
    }
    case 'altar': {
      g.add(
        mesh(B(0.9, 0.12, 0.6), 0x8a8478, 0, 0.06, 0, { map: bricks }),
        mesh(B(0.76, 0.6, 0.48), 0xd8d0c0, 0, 0.42, 0),
        mesh(B(0.84, 0.06, 0.56), 0xe8e0d0, 0, 0.75, 0),
        mesh(B(0.3, 0.62, 0.02), 0x7a2a3a, 0, 0.47, 0.26),
        mesh(B(0.3, 0.02, 0.56), 0x7a2a3a, 0, 0.785, 0),
      );
      for (const x of [-0.3, 0.3]) {
        g.add(mesh(C(0.025, 0.03, 0.18, 6), 0xf4eedc, x, 0.87, -0.1));
        const flame = mesh(new THREE.ConeGeometry(0.02, 0.06, 5), 0xffc040, x, 0.99, -0.1, { emissive: 0xff8a00 });
        flame.name = FLICKER;
        g.add(flame);
      }
      g.add(mesh(new THREE.TorusGeometry(0.09, 0.015, 5, 16), 0xe0bb4a, 0, 0.93, -0.12, { emissive: 0x2a1c00 }));
      break;
    }
    case 'statue': {
      const fountain = near(1, 0) === 'water' && near(-1, 0) === 'water';
      if (fountain) {
        // A 3x3 basin rim around the pool, then the statue rising from the water.
        for (const [x, z, w, d] of [[0, -1.45, 3.1, 0.2], [0, 1.45, 3.1, 0.2], [-1.45, 0, 0.2, 2.7], [1.45, 0, 0.2, 2.7]]) g.add(mesh(B(w, 0.75, d), 0xb0a898, x, 0.42, z, { map: bricks }));
        g.add(mesh(C(0.32, 0.4, 0.7, 10), 0xb0a898, 0, 0.35, 0, { map: bricks }), mesh(C(0.5, 0.42, 0.08, 14), 0xc8c0b0, 0, 0.72, 0));
      } else {
        g.add(mesh(B(0.7, 0.5, 0.7), 0xb0a898, 0, 0.25, 0, { map: bricks }), mesh(B(0.78, 0.06, 0.78), 0xc8c0b0, 0, 0.52, 0));
      }
      // A robed figure holding a sun disc aloft.
      const stone = 0xd8d4c8;
      const base = fountain ? 0.76 : 0.55;
      g.add(
        mesh(C(0.14, 0.24, 0.7, 9), stone, 0, base + 0.35, 0),
        mesh(C(0.1, 0.14, 0.24, 9), stone, 0, base + 0.82, 0),
        mesh(new THREE.SphereGeometry(0.1, 9, 7), stone, 0, base + 1.03, 0),
        mesh(C(0.035, 0.04, 0.42, 6), stone, 0.12, base + 1.0, 0, {}),
        mesh(new THREE.TorusGeometry(0.12, 0.03, 6, 16), 0xe0bb4a, 0.2, base + 1.28, 0, { emissive: 0x2a1c00 }),
      );
      (g.children[g.children.length - 2] as THREE.Mesh).rotation.z = -0.35;
      break;
    }
    case 'standing_stone': {
      const h = 1.3 + (k % 5) * 0.12;
      const stone = mesh(B(0.42, h, 0.3), 0x8a8a84, 0, h / 2 - 0.05, 0, { map: textures.rock() });
      stone.rotation.set(((k % 7) - 3) * 0.02, (k % 11) * 0.3, ((k % 5) - 2) * 0.03);
      g.add(stone, mesh(new THREE.DodecahedronGeometry(0.18, 0), 0x7a7a74, 0.05, h - 0.1, 0, { map: textures.rock() }));
      // Lichen patches
      g.add(mesh(B(0.2, 0.25, 0.02), 0x9aa86a, 0.06, 0.5, 0.16), mesh(B(0.15, 0.18, 0.02), 0xb0a860, -0.1, 0.9, 0.16));
      break;
    }
    case 'log_pile': {
      // Pyramid of logs: four, three, two.
      let row = 0;
      for (const n of [4, 3, 2]) {
        for (let k = 0; k < n; k++) {
          const log = mesh(C(0.11, 0.11, 0.86, 8).rotateX(Math.PI / 2), 0x7a5230, (k - (n - 1) / 2) * 0.22, 0.11 + row * 0.19, 0);
          // Pale end grain pokes just past the bark.
          g.add(log, mesh(C(0.09, 0.09, 0.87, 8).rotateX(Math.PI / 2), 0xd8b080, (k - (n - 1) / 2) * 0.22, 0.11 + row * 0.19, 0.0));
        }
        row++;
      }
      break;
    }
    case 'hide_tent': {
      // One tent per block of tent tiles, built by its north-west tile.
      if (near(-1, 0) === 'hide_tent' || near(0, -1) === 'hide_tent') break;
      let w = 1;
      let d = 1;
      while (near(w, 0) === 'hide_tent') w++;
      while (near(0, d) === 'hide_tent') d++;
      const cx = (w - 1) / 2;
      const cz = (d - 1) / 2;
      const tent = new THREE.Mesh(new THREE.ConeGeometry(Math.max(w, d) * 0.62, 1.7, 7), new THREE.MeshLambertMaterial({ color: 0x9a7a52, flatShading: true }));
      tent.position.set(cx, 0.85, cz);
      tent.castShadow = tent.receiveShadow = true;
      g.add(tent);
      for (let n = 0; n < 4; n++) {
        const a = (n / 4) * Math.PI * 2 + 0.4;
        const pole = mesh(C(0.025, 0.03, 0.6, 5), 0x4a3020, cx + Math.cos(a) * 0.12, 1.75, cz + Math.sin(a) * 0.12);
        pole.rotation.set(Math.sin(a) * 0.4, 0, -Math.cos(a) * 0.4);
        g.add(pole);
      }
      // Dark doorway flap and painted band.
      g.add(mesh(new THREE.CircleGeometry(0.3, 3), 0x2a1c12, cx, 0.32, cz + Math.max(w, d) * 0.5));
      g.add(mesh(new THREE.TorusGeometry(Math.max(w, d) * 0.43, 0.03, 4, 7).rotateX(Math.PI / 2), 0x8a2a1a, cx, 0.55, cz));
      g.userData.span = [w, d];
      break;
    }
    case 'fire': {
      // A small heap of burning logs, fresh from the tinderbox.
      for (let n = 0; n < 3; n++) {
        const log = mesh(C(0.05, 0.055, 0.44, 6), n % 2 ? 0x5a3a20 : 0x6b4a2b, 0, 0.07, 0);
        log.rotation.set(Math.PI / 2, (n / 3) * Math.PI, 0);
        log.position.y = 0.06 + n * 0.035;
        g.add(log);
      }
      g.add(mesh(new THREE.CircleGeometry(0.28, 10).rotateX(-Math.PI / 2), 0x2a2420, 0, 0.015, 0));
      for (const [s, x, z] of [[1.15, 0, 0], [0.8, 0.09, 0.05], [0.7, -0.08, -0.05], [0.55, 0.02, 0.1]]) {
        const flame = mesh(new THREE.ConeGeometry(0.12 * s, 0.5 * s, 6).translate(0, 0.25 * s, 0), 0xffa030, x, 0.1, z, { emissive: 0xff5a00 });
        flame.name = FLICKER;
        g.add(flame);
      }
      break;
    }
    case 'campfire': {
      for (let n = 0; n < 8; n++) {
        const a = (n / 8) * Math.PI * 2;
        g.add(mesh(new THREE.DodecahedronGeometry(0.09, 0), 0x6a6660, Math.cos(a) * 0.32, 0.06, Math.sin(a) * 0.32, { map: textures.rock() }));
      }
      for (let n = 0; n < 4; n++) {
        const log = mesh(C(0.045, 0.05, 0.5, 6), 0x4a3020, 0, 0.12, 0);
        log.rotation.set(Math.PI / 2 - 0.5, (n / 4) * Math.PI * 2, 0);
        g.add(log);
      }
      g.add(mesh(new THREE.CircleGeometry(0.25, 10).rotateX(-Math.PI / 2), 0x2a2420, 0, 0.02, 0));
      for (const [s, x, z] of [[1, 0, 0], [0.7, 0.07, 0.05], [0.6, -0.06, -0.04]]) {
        const flame = mesh(new THREE.ConeGeometry(0.11 * s, 0.42 * s, 6).translate(0, 0.21 * s, 0), 0xffa030, x, 0.1, z, { emissive: 0xff5a00 });
        flame.name = FLICKER;
        g.add(flame);
      }
      // Spit with a roast over the fire.
      for (const x of [-0.36, 0.36]) g.add(mesh(C(0.02, 0.02, 0.62, 5), 0x3a2416, x, 0.31, 0));
      g.add(mesh(C(0.015, 0.015, 0.8, 5).rotateZ(Math.PI / 2), 0x3a3a3a, 0, 0.6, 0), mesh(new THREE.SphereGeometry(0.1, 7, 5), 0x7a3a1a, 0, 0.6, 0));
      (g.children[g.children.length - 1] as THREE.Mesh).scale.set(1.5, 0.9, 0.9);
      break;
    }
    case 'goblin_totem': {
      g.add(mesh(C(0.1, 0.13, 1.7, 7), 0x5a3d22, 0, 0.85, 0, { map: planks }));
      const faces = [0x8a3a2a, 0x3a6a3a, 0xc0a040];
      faces.forEach((c, n) => {
        g.add(mesh(B(0.3, 0.3, 0.28), c, 0, 0.45 + n * 0.42, 0));
        for (const x of [-0.07, 0.07]) g.add(mesh(B(0.06, 0.05, 0.02), 0x111111, x, 0.5 + n * 0.42, 0.145));
        g.add(mesh(B(0.14, 0.04, 0.02), 0xe8e0c8, 0, 0.4 + n * 0.42, 0.145));
      });
      g.add(mesh(new THREE.SphereGeometry(0.11, 8, 6), 0xf0e8d4, 0, 1.8, 0));
      for (const x of [-0.04, 0.04]) g.add(mesh(new THREE.SphereGeometry(0.025, 5, 4), 0x111111, x, 1.82, 0.09));
      for (const s of [-1, 1]) {
        const horn = mesh(new THREE.ConeGeometry(0.035, 0.2, 5), 0xd8d0b8, s * 0.12, 1.88, 0);
        horn.rotation.z = -s * 0.9;
        g.add(horn);
        const feather = mesh(B(0.04, 0.3, 0.01), s < 0 ? 0xc0392b : 0x2a2a2a, s * 0.18, 1.35, 0.05);
        feather.rotation.z = s * 0.4;
        g.add(feather);
      }
      break;
    }
    case 'furnace': {
      g.add(
        mesh(B(0.94, 0.9, 0.86), 0x8a7a6a, 0, 0.45, 0, { map: bricks }),
        mesh(B(1.0, 0.1, 0.92), 0x5b514a, 0, 0.95, 0, { map: bricks }),
        mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.06, 12, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), 0x3a3230, 0, 0.42, 0.43),
        mesh(B(0.56, 0.08, 0.12), 0x5b514a, 0, 0.66, 0.45),
        mesh(B(0.7, 0.06, 0.2), 0x3a3a3a, 0, 0.12, 0.48),
      );
      const fire = mesh(B(0.38, 0.28, 0.04), 0xffa030, 0, 0.32, 0.44, { emissive: 0xff5a00 });
      fire.name = FLICKER;
      g.add(fire);
      // Ore bucket and bellows beside it
      g.add(mesh(C(0.11, 0.09, 0.18), 0x5a5a5a, 0.42, 0.09, 0.4), mesh(B(0.16, 0.05, 0.3), 0x7a4f26, -0.42, 0.3, 0.38));
      break;
    }
    case 'anvil': {
      g.add(
        mesh(C(0.24, 0.3, 0.36, 9), 0x6b4a2b, 0, 0.18, 0, { map: textures.planks() }),
        mesh(B(0.34, 0.1, 0.22), 0x3b3d42, 0, 0.4, 0),
        mesh(B(0.2, 0.08, 0.16), 0x3b3d42, 0, 0.48, 0),
        mesh(B(0.64, 0.13, 0.26), 0x4a4c52, 0, 0.58, 0),
        mesh(new THREE.ConeGeometry(0.09, 0.26, 8).rotateZ(-Math.PI / 2), 0x4a4c52, 0.44, 0.59, 0),
        mesh(B(0.2, 0.02, 0.2), 0x6a6c72, -0.18, 0.655, 0),
        // Hammer resting on top
        mesh(B(0.04, 0.04, 0.3), 0x7a5230, 0.05, 0.67, 0.05),
        mesh(B(0.12, 0.07, 0.07), 0x2a2a2e, 0.05, 0.68, -0.1),
      );
      break;
    }
    case 'range': {
      g.add(
        mesh(B(0.92, 0.62, 0.82), 0x8a7a6a, 0, 0.31, 0, { map: bricks }),
        mesh(B(0.96, 0.06, 0.86), 0x2a2a2a, 0, 0.65, 0),
        mesh(B(0.5, 0.26, 0.04), 0x2a2a2a, 0, 0.3, 0.42),
        mesh(B(0.3, 0.03, 0.03), 0x9a9a9a, 0, 0.46, 0.45),
        // Pot and pan on the hob
        mesh(C(0.14, 0.12, 0.18), 0x3a3a3a, -0.2, 0.77, -0.05),
        mesh(C(0.15, 0.13, 0.02), 0x5a7aa0, -0.2, 0.85, -0.05),
        mesh(C(0.13, 0.12, 0.03), 0x2b2b2b, 0.22, 0.7, 0.05),
        mesh(B(0.2, 0.02, 0.03), 0x2b2b2b, 0.4, 0.71, 0.05),
      );
      const fire = mesh(B(0.38, 0.14, 0.03), 0xff7a2a, 0, 0.24, 0.43, { emissive: 0xc02a00 });
      fire.name = FLICKER;
      g.add(fire);
      break;
    }
    case 'gravestone': {
      const stone = mesh(B(0.44, 0.62, 0.12), 0x9a958c, 0, 0.31, 0, { map: bricks });
      stone.rotation.z = (k % 7) * 0.012 - 0.04;
      g.add(stone, mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 10, 1, false, 0, Math.PI).rotateX(Math.PI / 2), 0x9a958c, 0, 0.62, 0));
      g.add(mesh(B(0.56, 0.08, 0.3), 0x7f7a72, 0, 0.04, 0, { map: bricks }));
      for (const y of [0.42, 0.34, 0.26]) g.add(mesh(B(0.22, 0.02, 0.01), 0x6a665e, 0, y, 0.065));
      break;
    }
    case 'cactus': {
      g.add(mesh(C(0.16, 0.2, 1.1, 9), 0x3f7a42, 0, 0.55, 0));
      g.add(mesh(new THREE.SphereGeometry(0.16, 9, 6), 0x47884a, 0, 1.1, 0));
      for (const side of [-1, 1]) {
        if ((k >> (side > 0 ? 1 : 2)) % 3 === 0) continue;
        const arm = mesh(C(0.08, 0.09, 0.42, 7), 0x3f7a42, side * 0.2, 0.62, 0);
        arm.rotation.z = -side * 1.1;
        g.add(arm, mesh(C(0.08, 0.085, 0.32, 7), 0x47884a, side * 0.37, 0.84, 0));
        g.add(mesh(new THREE.SphereGeometry(0.085, 8, 5), 0x47884a, side * 0.37, 1.0, 0));
      }
      // A few spines, and a flower on some.
      for (let n = 0; n < 6; n++) g.add(mesh(new THREE.ConeGeometry(0.012, 0.07, 4).rotateX(Math.PI / 2), 0xe8e0c8, Math.cos(n) * 0.17, 0.3 + n * 0.12, Math.sin(n) * 0.17));
      if (k % 3 === 0) g.add(mesh(new THREE.IcosahedronGeometry(0.07, 0), 0xe8505b, 0, 1.24, 0));
      break;
    }
    case 'palm_tree': {
      const bend = ((k % 5) - 2) * 0.05;
      for (let n = 0; n < 5; n++) {
        const seg = mesh(C(0.1 - n * 0.008, 0.12 - n * 0.008, 0.42, 7), 0x8a6a42, bend * n * 0.5, 0.21 + n * 0.4, 0, { map: planks });
        seg.rotation.z = -bend;
        g.add(seg);
      }
      const top: [number, number, number] = [bend * 2.2, 2.1, 0];
      for (let n = 0; n < 7; n++) {
        const a = (n / 7) * Math.PI * 2;
        const frond = mesh(new THREE.ConeGeometry(0.1, 0.9, 4), 0x4f8f3a, top[0] + Math.cos(a) * 0.35, top[1] - 0.1, top[2] + Math.sin(a) * 0.35);
        frond.rotation.set(Math.sin(a) * 1.1, -a, -Math.cos(a) * 1.1);
        g.add(frond);
      }
      for (const [dx, dz] of [[0.08, 0.05], [-0.07, 0.06], [0.01, -0.09]]) g.add(mesh(new THREE.SphereGeometry(0.06, 7, 5), 0x8a6a2a, top[0] + dx, top[1] - 0.12, top[2] + dz));
      break;
    }
    case 'aether_stone': {
      // A seam of pale stone, crystals of aether showing through.
      g.add(mesh(new THREE.DodecahedronGeometry(0.34, 0), 0x6f6a62, 0, 0.22, 0, { map: textures.rock() }));
      for (const [x, y, z] of [[0.1, 0.42, 0.04], [-0.14, 0.34, -0.1], [0.04, 0.3, 0.26]] as const) {
        g.add(mesh(new THREE.OctahedronGeometry(0.1, 0), 0xcfe8ff, x, y, z, { emissive: 0x2a4a7a }));
      }
      break;
    }
    case 'glyph_shrine': {
      g.add(
        mesh(new THREE.CylinderGeometry(0.44, 0.5, 0.14, 12), 0x8a8478, 0, 0.07, 0, { map: bricks }),
        mesh(new THREE.CylinderGeometry(0.3, 0.34, 0.62, 10), 0xd8d0c0, 0, 0.45, 0, { map: bricks }),
        mesh(new THREE.CylinderGeometry(0.4, 0.36, 0.1, 12), 0xe8e0d0, 0, 0.8, 0),
        mesh(new THREE.TorusGeometry(0.22, 0.03, 6, 18).rotateX(Math.PI / 2), tint, 0, 0.92, 0, { emissive: new THREE.Color(tint).multiplyScalar(0.35).getHex() }),
        mesh(new THREE.OctahedronGeometry(0.14, 0), new THREE.Color(tint).lerp(new THREE.Color(0xffffff), 0.5).getHex(), 0, 1.1, 0, { emissive: new THREE.Color(tint).multiplyScalar(0.5).getHex() }),
      );
      break;
    }
    case 'spinning_wheel': {
      g.add(mesh(B(0.5, 0.06, 0.3), 0x7a5230, 0, 0.3, 0, { map: planks }));
      for (const x of [-0.2, 0.2]) for (const z of [-0.1, 0.1]) g.add(mesh(C(0.025, 0.03, 0.3, 6), 0x6b4a2b, x, 0.15, z));
      const wheel = mesh(new THREE.TorusGeometry(0.26, 0.025, 5, 16), 0x8a6240, -0.12, 0.56, 0);
      g.add(wheel, mesh(C(0.03, 0.03, 0.1, 6).rotateX(Math.PI / 2), 0x5a3a20, -0.12, 0.56, 0));
      for (let n = 0; n < 6; n++) {
        const spoke = mesh(B(0.02, 0.5, 0.02), 0x8a6240, -0.12, 0.56, 0);
        spoke.rotation.z = (n / 6) * Math.PI;
        g.add(spoke);
      }
      g.add(mesh(C(0.05, 0.05, 0.22, 8), 0xe8e0c8, 0.18, 0.46, 0), mesh(C(0.02, 0.02, 0.34, 6), 0x6b4a2b, 0.18, 0.64, 0));
      break;
    }
    case 'farming_patch': {
      g.add(mesh(B(0.96, 0.08, 0.96), 0x5a4330, 0, 0.04, 0));
      for (const z of [-0.28, 0, 0.28]) g.add(mesh(B(0.9, 0.06, 0.16), 0x6b5038, 0, 0.09, z));
      for (const x of [-0.46, 0.46]) g.add(mesh(B(0.04, 0.16, 0.96), 0x7a5230, x, 0.08, 0, { map: planks }));
      break;
    }
    case 'homestead_gate': {
      // A field gate in the fence: two stout posts, short rails out to the fence posts on either
      // side, and a braced plank leaf hung from the left post (named so it can swing open).
      const wood = 0x7a5432;
      for (const x of [-0.46, 0.46]) g.add(mesh(B(0.14, 1.05, 0.14), wood, x, 0.42, 0, { map: planks }), mesh(new THREE.ConeGeometry(0.1, 0.12, 4).rotateY(Math.PI / 4), 0x6a4428, x, 1.0, 0));
      for (const x of [-0.72, 0.72]) for (const y of [0.3, 0.6]) g.add(mesh(B(0.5, 0.06, 0.05), 0x8a6240, x, y, 0));
      const leaf = new THREE.Group();
      leaf.name = GATE_LEAF;
      // Paler, fresher wood than the weathered fence, so the gate stands out in it.
      for (const y of [0.2, 0.41, 0.62, 0.83]) leaf.add(mesh(B(0.8, 0.075, 0.04), 0xc29a64, 0.42, y, 0, { map: planks }));
      for (const x of [0.06, 0.78]) leaf.add(mesh(B(0.07, 0.72, 0.045), 0xb08a56, x, 0.52, 0));
      const brace = mesh(B(0.07, 0.9, 0.035), 0xb08a56, 0.42, 0.52, 0.01);
      brace.rotation.z = -0.95;
      leaf.add(brace, mesh(B(0.12, 0.05, 0.06), 0x2a2a2a, 0.04, 0.3, 0), mesh(B(0.12, 0.05, 0.06), 0x2a2a2a, 0.04, 0.7, 0), mesh(C(0.02, 0.02, 0.1, 6), 0x2a2a2a, 0.8, 0.5, 0.05));
      leaf.position.x = -0.42;
      g.add(leaf);
      break;
    }
    case 'cave_entrance': {
      g.add(mesh(new THREE.DodecahedronGeometry(0.7, 0), 0x6f6a62, 0, 0.3, -0.2, { map: textures.rock() }));
      g.add(mesh(new THREE.CylinderGeometry(0.34, 0.4, 0.9, 10, 1, false, 0, Math.PI).rotateY(Math.PI), 0x15120f, 0, 0.44, 0.12));
      g.add(mesh(new THREE.DodecahedronGeometry(0.22, 0), 0x7d776e, -0.5, 0.14, 0.3, { map: textures.rock() }));
      g.add(mesh(new THREE.DodecahedronGeometry(0.18, 0), 0x7d776e, 0.52, 0.12, 0.34, { map: textures.rock() }));
      break;
    }
    case 'training_dummy': {
      g.add(mesh(C(0.07, 0.09, 1.0, 7), 0x7a5230, 0, 0.5, 0, { map: planks }));
      g.add(mesh(B(0.7, 0.07, 0.07), 0x7a5230, 0, 0.95, 0));
      g.add(mesh(new THREE.SphereGeometry(0.17, 8, 6), 0xd9ccaa, 0, 1.2, 0));
      g.add(mesh(B(0.34, 0.44, 0.2), 0xc8b48a, 0, 0.88, 0));
      for (const r of [0.12, 0.08, 0.04]) g.add(mesh(new THREE.TorusGeometry(r, 0.012, 4, 14), 0xc0392b, 0, 0.9, 0.11));
      break;
    }
    case 'archery_target': {
      for (const x of [-0.22, 0.22]) {
        const leg = mesh(C(0.035, 0.04, 1.1, 6), 0x7a5230, x, 0.5, 0.12);
        leg.rotation.x = 0.25;
        g.add(leg);
      }
      const rings = [0xf2ead8, 0x2a2a2a, 0x2f6a9a, 0xc0392b, 0xe8c04a];
      rings.forEach((c, n) => g.add(mesh(new THREE.CylinderGeometry(0.42 - n * 0.08, 0.42 - n * 0.08, 0.06 + n * 0.005, 14).rotateX(Math.PI / 2), c, 0, 0.95, -0.02 + n * 0.01)));
      g.add(mesh(C(0.012, 0.012, 0.3, 5).rotateX(Math.PI / 2), 0xe8e0c8, 0.08, 1.0, 0.16));
      break;
    }
    case 'well': {
      // A round stone well with a little shingled roof and a bucket on a winch.
      const ring = new THREE.CylinderGeometry(0.42, 0.45, 0.62, 16, 1, true);
      g.add(mesh(ring, 0x9a948a, 0, 0.31, 0, { map: bricks }));
      (g.children[0] as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color: 0x9a948a, map: bricks, side: THREE.DoubleSide });
      g.add(mesh(new THREE.TorusGeometry(0.43, 0.06, 6, 18).rotateX(Math.PI / 2), 0xb0a898, 0, 0.62, 0));
      g.add(mesh(C(0.38, 0.38, 0.02, 16), 0x22364e, 0, 0.36, 0, { emissive: 0x050a14 }));
      for (const x of [-0.4, 0.4]) g.add(mesh(B(0.08, 1.1, 0.08), 0x6b4a2b, x, 0.85, 0));
      g.add(mesh(C(0.04, 0.04, 0.84, 6).rotateZ(Math.PI / 2), 0x7a5230, 0, 1.15, 0));
      for (const side of [-1, 1]) {
        const roof = mesh(B(1.0, 0.04, 0.42), 0x7a4a2e, 0, 1.5, side * 0.17, { map: textures.shingles() });
        roof.rotation.x = side * 0.75;
        g.add(roof);
      }
      g.add(mesh(C(0.006, 0.006, 0.45, 4), 0xd8cfb4, 0.05, 0.92, 0));
      g.add(mesh(C(0.07, 0.055, 0.12, 8), 0x7a5230, 0.05, 0.66, 0, { map: planks }));
      g.add(mesh(B(0.04, 0.18, 0.04), 0x6b4a2b, 0.46, 1.08, 0.06));
      break;
    }
    case 'cart': {
      // A handcart: plank bed on two spoked wheels, shafts resting on the ground, a load of sacks.
      const tilt = new THREE.Group();
      tilt.rotation.x = -0.12;
      tilt.position.y = 0.05;
      tilt.add(mesh(B(0.62, 0.06, 0.9), 0x8a6238, 0, 0.42, 0, { map: planks }));
      for (const x of [-0.31, 0.31]) tilt.add(mesh(B(0.04, 0.2, 0.9), 0x7a5230, x, 0.54, 0, { map: planks }));
      for (const z of [-0.45, 0.45]) tilt.add(mesh(B(0.62, 0.2, 0.04), 0x7a5230, 0, 0.54, z, { map: planks }));
      for (const x of [-0.2, 0.2]) {
        const shaft = mesh(B(0.05, 0.05, 0.75), 0x6b4a2b, x, 0.3, 0.75);
        shaft.rotation.x = 0.45;
        tilt.add(shaft);
      }
      const sacks = [0xc8b48a, 0xb8a47a, 0xd4c49a];
      for (let n = 0; n < 3; n++) tilt.add(mesh(new THREE.SphereGeometry(0.15, 8, 6), sacks[(n + k) % 3], -0.12 + (n % 2) * 0.22, 0.6, -0.25 + n * 0.22));
      (tilt.children[tilt.children.length - 1] as THREE.Mesh).scale.set(1, 0.8, 1.2);
      tilt.add(mesh(B(0.22, 0.2, 0.22), 0xa07a48, 0.14, 0.63, 0.24, { map: planks }));
      g.add(tilt);
      for (const x of [-0.38, 0.38]) {
        g.add(mesh(new THREE.TorusGeometry(0.26, 0.035, 6, 16).rotateY(Math.PI / 2), 0x5a3d22, x, 0.28, -0.05));
        for (let n = 0; n < 4; n++) {
          const spoke = mesh(B(0.025, 0.5, 0.025), 0x6b4a2b, x, 0.28, -0.05);
          spoke.rotation.x = (n / 4) * Math.PI;
          g.add(spoke);
        }
        g.add(mesh(C(0.05, 0.05, 0.06, 8).rotateZ(Math.PI / 2), 0x3a3a3a, x, 0.28, -0.05));
      }
      break;
    }
    case 'barrels': {
      // Two or three barrels and a crate, banded with iron.
      const barrel = (x: number, z: number, y = 0, lying = false) => {
        const b = new THREE.Group();
        b.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.48, 12), 0x8a5a32, 0, 0, 0, { map: planks }));
        b.add(mesh(new THREE.CylinderGeometry(0.17, 0.17, 0.3, 12, 1, true), 0x7a4e2a, 0, 0, 0, { map: planks }));
        for (const by of [-0.17, 0.17]) b.add(mesh(new THREE.TorusGeometry(0.162, 0.012, 4, 14).rotateX(Math.PI / 2), 0x3a3a3a, 0, by, 0));
        b.position.set(x, y + (lying ? 0.17 : 0.24), z);
        if (lying) b.rotation.z = Math.PI / 2;
        g.add(b);
      };
      barrel(-0.2, -0.12);
      barrel(0.18, -0.18);
      if (k % 2) barrel(0.0, 0.25, 0, true);
      else g.add(mesh(B(0.32, 0.3, 0.32), 0xa07a48, 0.05, 0.15, 0.22, { map: planks }));
      if (k % 3 === 0) g.add(mesh(B(0.26, 0.24, 0.26), 0x9a7040, -0.2, 0.6, -0.12, { map: planks }));
      break;
    }
    case 'boulder': {
      // Weathered stone in a few shapes: one big rock, a cluster, or a flat slab; mossy in the green.
      const sandy = near(1, 0) === 'sand' || near(-1, 0) === 'sand';
      const ash = near(1, 0) === 'scorched_earth' || near(-1, 0) === 'scorched_earth';
      const tone = sandy ? 0xb89a70 : ash ? 0x5a5550 : 0x8a867e;
      const rock = textures.rock();
      const lump = (r: number, x: number, y: number, z: number, sx: number, sy: number, sz: number, c = tone) => {
        const m = mesh(new THREE.DodecahedronGeometry(r, 1), c, x, y, z, { map: rock });
        m.scale.set(sx, sy, sz);
        m.rotation.y = (k % 13) * 0.5;
        (m.material as THREE.MeshLambertMaterial).flatShading = true;
        g.add(m);
        return m;
      };
      const shape = k % 4;
      if (shape === 0) lump(0.42, 0, 0.28, 0, 1.1, 0.8, 0.95);
      else if (shape === 1) {
        lump(0.3, -0.12, 0.2, -0.05, 1, 0.85, 1);
        lump(0.22, 0.22, 0.14, 0.1, 1, 0.8, 1, shadeOf(tone, 0.9));
        lump(0.14, -0.05, 0.08, 0.3, 1, 0.7, 1, shadeOf(tone, 1.08));
      } else if (shape === 2) lump(0.45, 0, 0.14, 0, 1.15, 0.38, 0.9);
      else {
        lump(0.36, 0, 0.32, 0, 0.8, 1.1, 0.8);
        lump(0.16, 0.28, 0.1, 0.15, 1, 0.7, 1, shadeOf(tone, 0.9));
      }
      if (!sandy && !ash && k % 3 !== 0) {
        const moss = mesh(new THREE.SphereGeometry(0.3, 8, 4, 0, Math.PI * 2, 0, Math.PI / 3), 0x5d7a3a, 0, shape === 2 ? 0.08 : 0.24, 0);
        moss.scale.set(1, 0.6, 0.9);
        g.add(moss);
      }
      break;
    }
    default:
      g.add(mesh(B(0.7, 0.7, 0.7), 0xff00ff, 0, 0.35));
  }
  return g;
}

/** Small models for items lying on the ground. */
/** Potion colours on the ground, by the first word of the potion's id. */
const POTION_TINTS: Record<string, number> = { attack: 0xe8a030, strength: 0xc8443a, devotion: 0x9fd4ff, defence: 0x4aa05a, ranging: 0x3aa8b0, fireward: 0xa050c8 };

export function buildGroundItem(itemId: string): THREE.Group {
  const g = new THREE.Group();
  if (itemId.endsWith('logs')) {
    const bark = itemId === 'ashwood_logs' ? 0x8d857c : 0x6b4a2b;
    const wood = itemId === 'ashwood_logs' ? 0xece3d2 : 0xd9b47c;
    const log = new THREE.CylinderGeometry(0.07, 0.07, 0.42, 7).rotateZ(Math.PI / 2);
    for (const [x, y, z] of [[0, 0.07, -0.07], [0, 0.07, 0.07], [0, 0.19, 0]] as const) {
      g.add(mesh(log, bark, x, y, z));
      g.add(mesh(new THREE.CircleGeometry(0.066, 7).rotateY(Math.PI / 2), wood, x + 0.211, y, z));
    }
  } else if (itemId === 'ashes') {
    g.add(mesh(new THREE.SphereGeometry(0.16, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), 0x8a8580, 0, 0, 0));
    g.add(mesh(new THREE.DodecahedronGeometry(0.035, 0), 0x2a2420, 0.06, 0.04, 0.02));
  } else if (itemId === 'tinderbox') {
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.05, 0.08), 0x6a4a2a, 0, 0.025, 0));
  } else if (itemId.endsWith('_arrow') || itemId === 'arrow_shaft') {
    // A few arrows scattered where they fell.
    const head = itemId === 'arrow_shaft' ? undefined : groundMetal(itemId);
    for (const [x, z, r] of [[0, 0, 0.3], [0.04, 0.07, -0.4], [-0.05, -0.06, 0.9]] as const) {
      const arrow = new THREE.Group();
      arrow.add(mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.42, 4).rotateZ(Math.PI / 2), 0xb08a5a, 0, 0, 0));
      if (head) arrow.add(mesh(new THREE.ConeGeometry(0.018, 0.05, 4).rotateZ(-Math.PI / 2), head, 0.23, 0, 0));
      if (itemId !== 'arrow_shaft') arrow.add(mesh(new THREE.BoxGeometry(0.08, 0.03, 0.004), 0xe8e2d4, -0.17, 0, 0));
      arrow.position.set(x, 0.015, z);
      arrow.rotation.y = r;
      g.add(arrow);
    }
  } else if (/(short|long)bow/.test(itemId)) {
    const wood = { oak: 0xa87a44, willow: 0xc2a265, yew: 0x7a3f22 }[itemId.split('_')[0]] ?? 0x8a5a2e;
    const half = itemId.includes('longbow') ? 0.3 : 0.22;
    const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-half, 0.02, 0.05), new THREE.Vector3(0, 0.02, -0.08), new THREE.Vector3(half, 0.02, 0.05));
    g.add(mesh(new THREE.TubeGeometry(curve, 12, 0.012, 5), wood, 0, 0, 0));
    if (!itemId.endsWith('_u')) g.add(mesh(new THREE.CylinderGeometry(0.003, 0.003, half * 2, 3).rotateZ(Math.PI / 2), 0xe8e2cc, 0, 0.02, 0.05));
  } else if (itemId.endsWith('axe')) {
    const head = groundMetal(itemId) ?? 0xb8793a;
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.5, 6).rotateZ(Math.PI / 2), 0x7a5230, 0, 0.03, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.03, 0.15), head, 0.2, 0.04, 0.06));
  } else if (itemId.endsWith('_ore') || itemId === 'coal') {
    const fleck = { copper_ore: 0xd07a3a, tin_ore: 0xd4d8e0, iron_ore: 0x9a5238, gold_ore: 0xe8c040, cobalt_ore: 0x3a5ec8, verdite_ore: 0x2e8a58, glacite_ore: 0xa8e0f4 }[itemId] ?? 0x1c1c1c;
    g.add(mesh(new THREE.DodecahedronGeometry(0.1, 0), itemId === 'coal' ? 0x222222 : 0x7d776e, 0, 0.08, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.04, 0), fleck, 0.05, 0.14, 0.03));
  } else if (itemId.endsWith('_bar')) {
    const color = itemId === 'gold_bar' ? 0xe8c040 : (groundMetal(itemId) ?? 0xc9d3dd);
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), color, 0, 0.035, 0));
  } else if (/minnows|perch|pike|fish/.test(itemId)) {
    const color = itemId === 'burnt_fish' ? 0x2a2420 : itemId.startsWith('raw') ? 0x8fa9b8 : 0xc99a52;
    g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6).scale(2.2, 0.6, 1), color, 0, 0.04, 0));
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.08, 4).rotateZ(Math.PI / 2), color, -0.18, 0.04, 0));
  } else if (itemId.endsWith('dagger') || itemId.endsWith('sword') || itemId === 'duskfang') {
    const color = groundMetal(itemId) ?? 0xc9d3dd;
    const len = itemId.endsWith('sword') ? 0.42 : 0.22;
    g.add(mesh(new THREE.BoxGeometry(len, 0.012, 0.04), color, len / 2, 0.02, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.02, 0.12), 0x6b5a3a, 0, 0.02, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6).rotateZ(Math.PI / 2), 0x5a3a20, -0.06, 0.02, 0));
  } else if (/_(helm|chainbody|platelegs|shield)$/.test(itemId)) {
    const color = groundMetal(itemId) ?? 0xc9d3dd;
    if (itemId.endsWith('helm')) g.add(mesh(new THREE.SphereGeometry(0.12, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), color, 0, 0, 0));
    else if (itemId.endsWith('chainbody')) g.add(mesh(new THREE.BoxGeometry(0.34, 0.05, 0.3), color, 0, 0.025, 0));
    else if (itemId.endsWith('platelegs')) {
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.34), color, -0.06, 0.025, 0));
      g.add(mesh(new THREE.BoxGeometry(0.1, 0.05, 0.34), color, 0.06, 0.025, 0.02));
    } else g.add(mesh(new THREE.CylinderGeometry(0.15, 0.15, 0.03, 4).scale(0.8, 1, 1.25), color, 0, 0.015, 0));
  } else if (itemId === 'raw_beef' || itemId === 'beef' || itemId === 'burnt_meat') {
    const color = itemId === 'raw_beef' ? 0xc8424a : itemId === 'beef' ? 0x8a4a24 : 0x2a2018;
    g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6).scale(1.3, 0.55, 1), color, 0, 0.05, 0));
  } else if (itemId === 'wolf_pelt') {
    g.add(mesh(new THREE.BoxGeometry(0.42, 0.02, 0.28), 0x9aa0a6, 0, 0.012, 0));
    g.add(mesh(new THREE.BoxGeometry(0.3, 0.024, 0.08), 0xd8dce0, 0.02, 0.014, 0.02));
  } else if (itemId === 'cowhide') {
    g.add(mesh(new THREE.BoxGeometry(0.4, 0.015, 0.3), 0xf0ece2, 0, 0.01, 0));
    g.add(mesh(new THREE.BoxGeometry(0.12, 0.018, 0.1), 0x2a2420, 0.06, 0.012, 0.04));
  } else if (itemId === 'crimson_feathers') {
    for (const a of [0, 0.7]) g.add(mesh(new THREE.ConeGeometry(0.03, 0.22, 4).rotateZ(Math.PI / 2).rotateY(a), 0xc8262a, 0, 0.02, 0));
  } else if (itemId === 'lizard_scales') {
    for (const [x, z] of [[0, 0], [0.06, 0.04], [-0.05, 0.05]]) g.add(mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.01, 6), 0xd8b050, x, 0.01, z));
  } else if (/^(grimy_)?(sunleaf|marshwort|duskroot|silverfern|hawkweed|emberbloom)$/.test(itemId)) {
    // A small bundle of leaves; grimy ones are muddier.
    const leaf = { sunleaf: 0xe8c840, marshwort: 0x5a8a3a, duskroot: 0x5a3a5a, silverfern: 0xb8c8c8, hawkweed: 0x8aa83a, emberbloom: 0xd8402a }[itemId.replace('grimy_', '')]!;
    const color = itemId.startsWith('grimy') ? new THREE.Color(leaf).lerp(new THREE.Color(0x5a4a2a), 0.45).getHex() : leaf;
    for (const a of [0, 1.3, 2.6, 3.9, 5.2]) {
      const blade = mesh(new THREE.SphereGeometry(0.05, 6, 4).scale(1.8, 0.3, 0.8), color, Math.cos(a) * 0.06, 0.02, Math.sin(a) * 0.06);
      blade.rotation.y = -a;
      g.add(blade);
    }
  } else if (itemId.startsWith('vial') || itemId.includes('potion')) {
    const glass = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.05, 0.14, 10), new THREE.MeshLambertMaterial({ color: 0xcfe8f0, transparent: true, opacity: 0.45 }));
    glass.position.y = 0.07;
    g.add(glass);
    const liquid = itemId === 'vial' ? null : itemId === 'vial_of_water' ? 0x9fc8e8 : itemId.endsWith('_unf') ? 0x8aa060 : POTION_TINTS[itemId.split('_')[0]];
    if (liquid) g.add(mesh(new THREE.CylinderGeometry(0.04, 0.045, 0.09, 10), liquid, 0, 0.048, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.022, 0.02, 0.03, 8), 0x9a7448, 0, 0.155, 0));
  } else if (itemId.endsWith('bones')) {
    const color = itemId === 'drake_bones' ? 0x5a4a40 : 0xe8e0c8;
    const k = itemId === 'bones' ? 1 : 1.3;
    for (const [x, z, r] of [[0, 0, 0.4], [0.05, 0.06, -0.6]] as const) {
      const bone = new THREE.Group();
      bone.add(mesh(new THREE.CylinderGeometry(0.016 * k, 0.016 * k, 0.2 * k, 6).rotateZ(Math.PI / 2), color, 0, 0, 0));
      for (const end of [-0.1 * k, 0.1 * k]) bone.add(mesh(new THREE.SphereGeometry(0.026 * k, 6, 5), color, end, 0, 0));
      bone.position.set(x, 0.025 * k, z);
      bone.rotation.y = r;
      g.add(bone);
    }
  } else if (itemId === 'cow_horn' || itemId === 'scorpion_stinger') {
    const horn = mesh(new THREE.ConeGeometry(0.035, 0.24, 7).rotateZ(Math.PI / 2 + 0.3), itemId === 'cow_horn' ? 0xe8dcbc : 0x8a5a2a, 0, 0.04, 0);
    g.add(horn);
  } else if (itemId === 'spirit_dust') {
    g.add(mesh(new THREE.SphereGeometry(0.12, 9, 5, 0, Math.PI * 2, 0, Math.PI / 2).scale(1, 0.35, 1), 0xdfe6f0, 0, 0, 0));
  } else if (itemId === 'coins') {
    for (const [x, z] of [[0, 0], [0.06, 0.04], [-0.04, 0.05]]) g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), 0xf0c840, x, 0.01, z));
  } else {
    g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), 0xa08454, 0, 0.1, 0));
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}
