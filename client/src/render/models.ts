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
  copper_rock: rockParts(0xd07a3a),
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

/** Stations face +Z (toward the open tile in front of them). */
export function buildStation(defKey: string): THREE.Group {
  const g = new THREE.Group();
  const bricks = textures.bricks();
  switch (defKey) {
    case 'bank_chest': {
      g.add(
        mesh(B(0.82, 0.42, 0.56), 0x7a4f26, 0, 0.23, 0, { map: textures.planks() }),
        mesh(C(0.29, 0.29, 0.84, 12, ).rotateZ(Math.PI / 2), 0x8f5d2e, 0, 0.44, 0, { map: textures.planks() }),
        mesh(B(0.1, 0.68, 0.6), 0x3a3a40, -0.3, 0.32, 0),
        mesh(B(0.1, 0.68, 0.6), 0x3a3a40, 0.3, 0.32, 0),
        mesh(B(0.16, 0.18, 0.06), 0xe0bb4a, 0, 0.38, 0.3, { emissive: 0x2a1c00 }),
        mesh(B(0.04, 0.07, 0.02), 0x222222, 0, 0.36, 0.335),
        mesh(B(0.9, 0.04, 0.62), 0x3a3a40, 0, 0.03, 0),
      );
      for (const x of [-0.3, 0.3]) for (const z of [-0.2, 0.2]) g.add(mesh(new THREE.SphereGeometry(0.025, 6, 4), 0xd4a73a, x, 0.3, z + Math.sign(z) * 0.11));
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

interface FigureStyle {
  body: number;
  legs: number;
  boots?: number;
  belt?: number;
  hair?: number;
  hat?: 'tall' | 'cap' | 'hood';
  hatColor?: number;
  staff?: boolean;
  apron?: number;
  robe?: boolean;
  beard?: number;
  holding?: 'scroll' | 'ladle' | 'sword';
}

const FIGURES: Record<string, FigureStyle> = {
  player: { body: 0x2f5fb3, legs: 0x4a3b2a, boots: 0x3a2618, belt: 0x6b4a2b, hair: 0x5a3a1e },
  other_player: { body: 0xb3412f, legs: 0x3a3a3a, boots: 0x2a2a2a, belt: 0x222222, hair: 0x2b2b2b },
  town_guide: { body: 0x2e8b57, legs: 0x3b5a3b, boots: 0x4a3020, belt: 0x8a6a3a, hat: 'cap', hatColor: 0x1f6b3f, hair: 0x9a6a3a, holding: 'scroll' },
  shopkeeper: { body: 0x7b3fa0, legs: 0x3d2b4d, boots: 0x3a2618, apron: 0xd9ccaa, hair: 0x8a6a3a, beard: 0x8a6a3a },
  elder_maren: { body: 0x8a8fb0, legs: 0x8a8fb0, robe: true, hair: 0xd8d8d8, hat: 'hood', hatColor: 0x6a6f90, staff: true },
  cook_tobin: { body: 0xf3f3f3, legs: 0x555555, boots: 0x2a2a2a, apron: 0xffffff, hat: 'tall', hatColor: 0xffffff, beard: 0x5a3a1e, holding: 'ladle' },
};

/** A simple humanoid ~1.1 tiles tall, facing +Z. */
export function buildFigure(styleKey: string): THREE.Group {
  const s = FIGURES[styleKey] ?? FIGURES.other_player;
  const g = new THREE.Group();
  const skin = 0xe0b48a;
  if (s.robe) {
    g.add(mesh(C(0.2, 0.3, 0.62, 10), s.body, 0, 0.31));
  } else {
    g.add(mesh(B(0.11, 0.36, 0.13), s.legs, -0.08, 0.2), mesh(B(0.11, 0.36, 0.13), s.legs, 0.08, 0.2));
    if (s.boots) g.add(mesh(B(0.12, 0.08, 0.17), s.boots, -0.08, 0.04, 0.02), mesh(B(0.12, 0.08, 0.17), s.boots, 0.08, 0.04, 0.02));
  }
  g.add(
    mesh(C(0.16, 0.19, 0.42, 10), s.body, 0, 0.6),
    mesh(new THREE.SphereGeometry(0.17, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), s.body, 0, 0.78), // shoulders
    mesh(B(0.08, 0.36, 0.09), s.body, -0.22, 0.6),
    mesh(B(0.08, 0.36, 0.09), s.body, 0.22, 0.6),
    mesh(new THREE.SphereGeometry(0.045, 6, 4), skin, -0.22, 0.4),
    mesh(new THREE.SphereGeometry(0.045, 6, 4), skin, 0.22, 0.4),
    mesh(C(0.05, 0.06, 0.08, 6), skin, 0, 0.86),
    mesh(new THREE.SphereGeometry(0.14, 12, 10), skin, 0, 0.99),
    mesh(new THREE.SphereGeometry(0.022, 6, 4), 0x222222, -0.05, 1.0, 0.125),
    mesh(new THREE.SphereGeometry(0.022, 6, 4), 0x222222, 0.05, 1.0, 0.125),
    mesh(new THREE.ConeGeometry(0.025, 0.05, 4).rotateX(Math.PI / 2), 0xd09a70, 0, 0.97, 0.15),
  );
  if (s.belt) g.add(mesh(C(0.175, 0.18, 0.05, 10), s.belt, 0, 0.42), mesh(B(0.06, 0.05, 0.02), 0xd4a73a, 0, 0.42, 0.18));
  if (s.apron) g.add(mesh(B(0.26, 0.42, 0.02), s.apron, 0, 0.5, 0.17));
  if (s.hair) g.add(mesh(new THREE.SphereGeometry(0.148, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2.2), s.hair, 0, 1.0, -0.012));
  if (s.beard) g.add(mesh(new THREE.SphereGeometry(0.1, 8, 6, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), s.beard, 0, 0.93, 0.06));
  if (s.hat === 'cap') g.add(mesh(C(0.15, 0.16, 0.08), s.hatColor!, 0, 1.1), mesh(B(0.2, 0.02, 0.1), s.hatColor!, 0, 1.07, 0.12));
  if (s.hat === 'tall') g.add(mesh(C(0.13, 0.11, 0.08), s.hatColor!, 0, 1.1), mesh(new THREE.SphereGeometry(0.17, 10, 8), s.hatColor!, 0, 1.25));
  if (s.hat === 'hood') g.add(mesh(new THREE.SphereGeometry(0.17, 12, 8, 0, Math.PI * 2, 0, Math.PI / 1.7), s.hatColor!, 0, 0.99, -0.03));
  if (s.staff) {
    g.add(mesh(C(0.025, 0.03, 1.25, 6), 0x7a5230, 0.3, 0.62, 0.08));
    g.add(mesh(new THREE.OctahedronGeometry(0.06), 0x8fe0ff, 0.3, 1.3, 0.08, { emissive: 0x2a6aa0 }));
  }
  if (s.holding === 'scroll') g.add(mesh(C(0.035, 0.035, 0.24, 8).rotateZ(Math.PI / 2), 0xeee0b8, 0.24, 0.42, 0.08));
  if (s.holding === 'ladle') g.add(mesh(C(0.012, 0.012, 0.32, 5), 0x8a6a3a, 0.24, 0.5, 0.06), mesh(new THREE.SphereGeometry(0.05, 6, 4, 0, Math.PI * 2, Math.PI / 2, Math.PI / 2), 0x9a9a9a, 0.24, 0.35, 0.06));
  return g;
}
