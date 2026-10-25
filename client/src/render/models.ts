import * as THREE from 'three';

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
  /** Fishing ripples animate; everything else is static. */
  ripple?: boolean;
  transparent?: boolean;
}

const trunk = (r: number, h: number) => new THREE.CylinderGeometry(r * 0.75, r, h, 6);
const blob = (r: number) => new THREE.IcosahedronGeometry(r, 0);
const rock = new THREE.DodecahedronGeometry(0.38, 0);
const nugget = new THREE.DodecahedronGeometry(0.13, 0);
const ring = (r: number) => new THREE.TorusGeometry(r, 0.035, 4, 20).rotateX(Math.PI / 2);

const rockParts = (ore: number, emissive?: number): PartStyle[] => [
  { geometry: rock, color: 0x7a746b, position: [0, 0.22, 0], scale: [1.05, 0.75, 1] },
  { geometry: nugget, color: ore, emissive, position: [0.13, 0.43, 0.06] },
  { geometry: nugget, color: ore, emissive, position: [-0.16, 0.34, -0.1], scale: [0.8, 0.8, 0.8] },
  { geometry: nugget, color: ore, emissive, position: [0.02, 0.3, 0.24], scale: [0.7, 0.7, 0.7] },
];

const fishingParts = (deep: boolean): PartStyle[] => [
  { geometry: ring(0.3), color: deep ? 0xbfe3ff : 0xe8f6ff, position: [0, -0.15, 0], ripple: true, transparent: true },
  { geometry: ring(0.16), color: 0xffffff, position: [0.08, -0.15, -0.05], ripple: true, transparent: true },
];

export const RESOURCE_STYLES: Record<string, PartStyle[]> = {
  tree: [
    { geometry: trunk(0.12, 0.7), color: 0x6b4a2b, position: [0, 0.35, 0] },
    { geometry: blob(0.42), color: 0x3f8f3a, position: [0, 1.0, 0] },
  ],
  oak_tree: [
    { geometry: trunk(0.17, 0.75), color: 0x5e3f24, position: [0, 0.37, 0] },
    { geometry: blob(0.56), color: 0x5d7f2b, position: [0, 1.1, 0], scale: [1, 0.8, 1] },
  ],
  willow_tree: [
    { geometry: trunk(0.13, 0.8), color: 0x6f5a3a, position: [0, 0.4, 0] },
    { geometry: blob(0.5), color: 0x93b552, position: [0, 0.95, 0], scale: [1.05, 1.35, 1.05] },
  ],
  yew_tree: [
    { geometry: trunk(0.15, 0.8), color: 0x3f2b1a, position: [0, 0.4, 0] },
    { geometry: new THREE.ConeGeometry(0.5, 1.2, 7), color: 0x1f4d30, position: [0, 1.1, 0] },
    { geometry: new THREE.ConeGeometry(0.38, 0.9, 7), color: 0x24583a, position: [0, 1.65, 0] },
  ],
  copper_rock: rockParts(0xc4773b),
  tin_rock: rockParts(0xc9ccd4),
  iron_rock: rockParts(0x8a4f3a),
  coal_rock: rockParts(0x222222),
  starsteel_rock: rockParts(0x7fd4ff, 0x1d6fa8),
  shallow_fishing_spot: fishingParts(false),
  deep_fishing_spot: fishingParts(true),
};

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, emissive?: number): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: emissive ?? 0x000000 });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}

const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

export function buildStation(defKey: string): THREE.Group {
  const g = new THREE.Group();
  switch (defKey) {
    case 'bank_chest':
      g.add(
        mesh(B(0.8, 0.45, 0.55), 0x7a4f26, 0, 0.225),
        mesh(B(0.84, 0.14, 0.59), 0x8f5d2e, 0, 0.52),
        mesh(B(0.86, 0.07, 0.1), 0xd4a73a, 0, 0.4, 0),
        mesh(B(0.12, 0.14, 0.04), 0xe0bb4a, 0, 0.36, 0.3),
      );
      break;
    case 'furnace':
      g.add(
        mesh(B(0.9, 0.95, 0.85), 0x6e6259, 0, 0.475),
        mesh(B(0.42, 0.3, 0.05), 0xff7a1a, 0, 0.3, 0.43, 0xff5a00),
        mesh(B(0.3, 0.7, 0.3), 0x5b514a, 0.2, 1.3, -0.15),
      );
      break;
    case 'anvil':
      g.add(
        mesh(new THREE.CylinderGeometry(0.22, 0.28, 0.35, 8), 0x5a3d22, 0, 0.175),
        mesh(B(0.62, 0.16, 0.26), 0x3b3d42, 0, 0.45),
        mesh(B(0.3, 0.1, 0.18), 0x3b3d42, 0, 0.36),
        mesh(new THREE.ConeGeometry(0.08, 0.22, 6).rotateZ(-Math.PI / 2), 0x3b3d42, 0.41, 0.46),
      );
      break;
    case 'range':
      g.add(
        mesh(B(0.9, 0.6, 0.8), 0x4d4a47, 0, 0.3),
        mesh(B(0.92, 0.06, 0.82), 0x262626, 0, 0.63),
        mesh(B(0.5, 0.18, 0.05), 0xd83a1a, 0, 0.25, 0.41, 0xa01a00),
        mesh(B(0.2, 0.06, 0.2), 0x777777, 0.2, 0.68, 0.1),
      );
      break;
    default:
      g.add(mesh(B(0.7, 0.7, 0.7), 0xff00ff, 0, 0.35));
  }
  return g;
}

interface FigureStyle {
  body: number;
  legs: number;
  hair?: number;
  hat?: 'tall' | 'cap';
  hatColor?: number;
  staff?: boolean;
}

const FIGURES: Record<string, FigureStyle> = {
  player: { body: 0x2f5fb3, legs: 0x4a3b2a, hair: 0x5a3a1e },
  other_player: { body: 0xb3412f, legs: 0x3a3a3a, hair: 0x2b2b2b },
  town_guide: { body: 0x2e8b57, legs: 0x3b5a3b, hat: 'cap', hatColor: 0x1f6b3f },
  shopkeeper: { body: 0x7b3fa0, legs: 0x3d2b4d, hair: 0x8a6a3a },
  elder_maren: { body: 0xe8e2d0, legs: 0xcfc6ad, hair: 0xd8d8d8, staff: true },
  cook_tobin: { body: 0xf3f3f3, legs: 0x555555, hat: 'tall', hatColor: 0xffffff },
};

/** A simple humanoid ~1.1 tiles tall, facing +Z. */
export function buildFigure(styleKey: string): THREE.Group {
  const s = FIGURES[styleKey] ?? FIGURES.other_player;
  const g = new THREE.Group();
  const skin = 0xe0b48a;
  g.add(
    mesh(B(0.11, 0.38, 0.13), s.legs, -0.08, 0.19),
    mesh(B(0.11, 0.38, 0.13), s.legs, 0.08, 0.19),
    mesh(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 8), s.body, 0, 0.6),
    mesh(B(0.09, 0.38, 0.1), s.body, -0.24, 0.6),
    mesh(B(0.09, 0.38, 0.1), s.body, 0.24, 0.6),
    mesh(new THREE.SphereGeometry(0.14, 10, 8), skin, 0, 0.97),
    mesh(B(0.05, 0.03, 0.02), 0x222222, 0, 0.99, 0.135), // eyes, so facing reads
  );
  if (s.hair) g.add(mesh(new THREE.SphereGeometry(0.145, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), s.hair, 0, 1.0, -0.01));
  if (s.hat === 'cap') g.add(mesh(new THREE.CylinderGeometry(0.15, 0.16, 0.08, 10), s.hatColor!, 0, 1.08));
  if (s.hat === 'tall') g.add(mesh(new THREE.CylinderGeometry(0.15, 0.12, 0.3, 10), s.hatColor!, 0, 1.2));
  if (s.staff) g.add(mesh(new THREE.CylinderGeometry(0.025, 0.03, 1.2, 6), 0x7a5230, 0.32, 0.6, 0.05));
  return g;
}
