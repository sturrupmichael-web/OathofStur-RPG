import * as THREE from 'three';
import { textures } from './textures';

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
  tree: [
    { geometry: trunk(0.12, 0.75), color: 0x6b4a2b, position: [0, 0.37, 0], vary: 0.1 },
    ...roots(0x5f4126, 0.12),
    { geometry: blob(0.36), color: 0x3f8f3a, position: [0, 1.0, 0], vary: 0.14 },
    { geometry: blob(0.27), color: 0x4a9a40, position: [0.2, 1.12, 0.08], vary: 0.14 },
    { geometry: blob(0.25), color: 0x37803a, position: [-0.17, 1.15, -0.1], vary: 0.14 },
    { geometry: blob(0.22), color: 0x52a347, position: [0.02, 1.32, 0.02], vary: 0.14 },
  ],
  oak_tree: [
    { geometry: trunk(0.18, 0.85), color: 0x5e3f24, position: [0, 0.42, 0], vary: 0.08 },
    ...roots(0x553820, 0.18),
    { geometry: new THREE.CylinderGeometry(0.04, 0.06, 0.5, 5), color: 0x5e3f24, position: [0.2, 0.85, 0], rotation: [0, 0, -0.9] },
    { geometry: blob(0.44), color: 0x5d7f2b, position: [0, 1.15, 0], scale: [1.15, 0.8, 1.1], vary: 0.12 },
    { geometry: blob(0.34), color: 0x6a8c32, position: [0.32, 1.08, 0.1], vary: 0.12 },
    { geometry: blob(0.32), color: 0x547628, position: [-0.3, 1.12, -0.12], vary: 0.12 },
    { geometry: blob(0.3), color: 0x678a30, position: [0.05, 1.42, -0.05], vary: 0.12 },
  ],
  willow_tree: [
    { geometry: trunk(0.14, 0.95), color: 0x6f5a3a, position: [0, 0.47, 0], vary: 0.08 },
    ...roots(0x5f4a2f, 0.14),
    { geometry: blob(0.42), color: 0x93b552, position: [0, 1.15, 0], scale: [1.1, 0.75, 1.1], vary: 0.1 },
    // Drooping fronds
    ...[0, 1, 2, 3, 4, 5, 6].map((k) => {
      const a = (k / 7) * Math.PI * 2;
      return {
        geometry: new THREE.ConeGeometry(0.11, 0.85, 4).rotateX(Math.PI),
        color: 0x86a84a,
        position: [Math.cos(a) * 0.38, 0.78, Math.sin(a) * 0.38] as [number, number, number],
        vary: 0.12,
      };
    }),
  ],
  yew_tree: [
    { geometry: trunk(0.16, 0.8), color: 0x3f2b1a, position: [0, 0.4, 0], vary: 0.08 },
    ...roots(0x35241a, 0.16),
    { geometry: new THREE.ConeGeometry(0.58, 0.9, 8), color: 0x1d4a2e, position: [0, 0.95, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.47, 0.8, 8), color: 0x22553a, position: [0, 1.35, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.34, 0.7, 8), color: 0x276042, position: [0, 1.72, 0], vary: 0.1 },
    { geometry: new THREE.ConeGeometry(0.18, 0.45, 8), color: 0x2c6a48, position: [0, 2.05, 0], vary: 0.1 },
  ],
  dead_tree: [
    { geometry: trunk(0.13, 1.1), color: 0x5a5048, position: [0, 0.55, 0], vary: 0.12 },
    ...roots(0x4e463e, 0.13),
    { geometry: new THREE.CylinderGeometry(0.03, 0.06, 0.6, 5), color: 0x5a5048, position: [0.18, 1.05, 0], rotation: [0, 0, -0.8], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.025, 0.05, 0.5, 5), color: 0x544a42, position: [-0.15, 1.15, 0.05], rotation: [0.3, 0, 0.9], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.02, 0.04, 0.45, 5), color: 0x5a5048, position: [0.02, 1.25, -0.14], rotation: [-0.8, 0, 0.1], vary: 0.12 },
    { geometry: new THREE.CylinderGeometry(0.015, 0.03, 0.3, 4), color: 0x4e463e, position: [0.36, 1.32, 0], rotation: [0, 0, -0.2] },
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
  starsteel_rock: rockParts(0x8fe0ff, 0x2a8ad0),
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


const C = (rt: number, rb: number, h: number, seg = 10) => new THREE.CylinderGeometry(rt, rb, h, seg);

/** Glowing parts that flicker (furnace mouth, range fire). Renderer animates them. */
export const FLICKER = 'flicker';

/** The object on the tile at an offset, or its terrain if it has none, for props that span tiles. */
export type NeighbourLookup = (dx: number, dy: number) => string | null;

/** Stations and props face +Z (toward the open tile in front of them). */
export function buildStation(defKey: string, near: NeighbourLookup = () => null, seed = 0): THREE.Group {
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
    default:
      g.add(mesh(B(0.7, 0.7, 0.7), 0xff00ff, 0, 0.35));
  }
  return g;
}

/** Small models for items lying on the ground. */
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
  } else if (itemId.endsWith('axe')) {
    const head = itemId === 'iron_axe' ? 0x7d7f86 : itemId === 'steel_axe' ? 0xa9b3bd : 0xb8793a;
    g.add(mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.5, 6).rotateZ(Math.PI / 2), 0x7a5230, 0, 0.03, 0));
    g.add(mesh(new THREE.BoxGeometry(0.1, 0.03, 0.15), head, 0.2, 0.04, 0.06));
  } else if (itemId.endsWith('_ore') || itemId === 'coal') {
    const fleck = { copper_ore: 0xd07a3a, tin_ore: 0xd4d8e0, iron_ore: 0x9a5238 }[itemId] ?? 0x1c1c1c;
    g.add(mesh(new THREE.DodecahedronGeometry(0.1, 0), itemId === 'coal' ? 0x222222 : 0x7d776e, 0, 0.08, 0));
    g.add(mesh(new THREE.OctahedronGeometry(0.04, 0), fleck, 0.05, 0.14, 0.03));
  } else if (itemId.endsWith('_bar')) {
    const color = itemId === 'bronze_bar' ? 0xc88a4a : itemId === 'iron_bar' ? 0x8a8c92 : 0xc9d3dd;
    g.add(mesh(new THREE.BoxGeometry(0.26, 0.07, 0.1), color, 0, 0.035, 0));
  } else if (/minnows|perch|pike|fish/.test(itemId)) {
    const color = itemId === 'burnt_fish' ? 0x2a2420 : itemId.startsWith('raw') ? 0x8fa9b8 : 0xc99a52;
    g.add(mesh(new THREE.SphereGeometry(0.07, 8, 6).scale(2.2, 0.6, 1), color, 0, 0.04, 0));
    g.add(mesh(new THREE.ConeGeometry(0.05, 0.08, 4).rotateZ(Math.PI / 2), color, -0.18, 0.04, 0));
  } else if (itemId.endsWith('dagger') || itemId.endsWith('sword')) {
    const color = itemId.startsWith('bronze') ? 0xc88a4a : itemId.startsWith('iron') ? 0x9a9ca4 : 0xc9d3dd;
    const len = itemId.endsWith('sword') ? 0.42 : 0.22;
    g.add(mesh(new THREE.BoxGeometry(len, 0.012, 0.04), color, len / 2, 0.02, 0));
    g.add(mesh(new THREE.BoxGeometry(0.03, 0.02, 0.12), 0x6b5a3a, 0, 0.02, 0));
    g.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.1, 6).rotateZ(Math.PI / 2), 0x5a3a20, -0.06, 0.02, 0));
  } else if (itemId === 'coins') {
    for (const [x, z] of [[0, 0], [0.06, 0.04], [-0.04, 0.05]]) g.add(mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.012, 10), 0xf0c840, x, 0.01, z));
  } else {
    g.add(mesh(new THREE.IcosahedronGeometry(0.12, 0), 0xa08454, 0, 0.1, 0));
  }
  g.traverse((o) => (o.castShadow = true));
  return g;
}
