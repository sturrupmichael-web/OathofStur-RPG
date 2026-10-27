import * as THREE from 'three';
import { shared } from './dispose';
import { FLICKER } from './models';
import { textures } from './textures';

/**
 * Homestead furniture, one model per kind and tier. Each stands in a 1 x 1
 * tile with its back to -z (against the wall) and faces +z, into the room.
 * Tier 1 is plain pine, tier 2 oak, tier 3 dark yew (or stone, iron and gold
 * for the pieces that aren't wood).
 */

const WOOD = [0xb88d58, 0x8a5c2e, 0x5e2a1c];
const GOLD = 0xd8b048;
const IRON = 0x3c3a38;
const STONE = 0xb4ab9c;
const CLOTH = [0x6a7f9a, 0x4f7a4a, 0x8a2a32];

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, opts: { emissive?: number; map?: THREE.Texture; opacity?: number } = {}): THREE.Mesh {
  const mat = new THREE.MeshLambertMaterial({ color, emissive: opts.emissive ?? 0x000000, map: opts.map ?? null });
  if (opts.opacity !== undefined) Object.assign(mat, { transparent: true, opacity: opts.opacity, depthWrite: false });
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  m.castShadow = opts.opacity === undefined;
  m.receiveShadow = true;
  return m;
}
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (rt: number, rb: number, h: number, seg = 12) => new THREE.CylinderGeometry(rt, rb, h, seg);
const S = (r: number) => new THREE.SphereGeometry(r, 12, 8);

/** A flame that flickers, with a soft glow. */
function flame(x: number, y: number, z: number, size = 1): THREE.Mesh {
  const f = mesh(new THREE.ConeGeometry(0.022 * size, 0.07 * size, 8), 0xffc040, x, y, z, { emissive: 0xff8a00 });
  f.name = FLICKER;
  return f;
}

/** A candle on a little dish. */
function candle(x: number, y: number, z: number): THREE.Object3D[] {
  return [mesh(C(0.045, 0.05, 0.015), 0xc8a050, x, y + 0.008, z), mesh(C(0.02, 0.022, 0.12, 8), 0xf4eedc, x, y + 0.075, z), flame(x, y + 0.165, z)];
}

/** Four turned legs under a top at `h`: plain posts, or bulging turned ones for the better woods. */
function legs(g: THREE.Group, color: number, w: number, d: number, h: number, turned: boolean, map?: THREE.Texture): void {
  for (const x of [-w / 2, w / 2])
    for (const z of [-d / 2, d / 2]) {
      g.add(mesh(C(0.028, 0.024, h, 8), color, x, h / 2, z, { map }));
      if (turned) g.add(mesh(S(0.04), color, x, h * 0.55, z), mesh(C(0.036, 0.03, 0.05, 8), color, x, h - 0.04, z));
    }
}

/** Books on a shelf: a row of spines in varied colours and heights. */
function books(g: THREE.Group, y: number, z: number, width: number, seed: number): void {
  const colours = [0x8a2a2a, 0x2a4a7a, 0x3a6a3a, 0x7a5a2a, 0x5a2a6a, 0xa07a3a, 0x2a2a2a];
  let x = -width / 2 + 0.03;
  for (let n = 0; x < width / 2 - 0.05; n++) {
    const w = 0.035 + ((seed * 7 + n * 13) % 5) * 0.008;
    const h = 0.18 + ((seed * 3 + n * 11) % 4) * 0.025;
    const book = mesh(B(w, h, 0.2), colours[(seed + n * 3) % colours.length], x + w / 2, y + h / 2, z);
    if ((n + seed) % 9 === 4) book.rotation.z = 0.25;
    g.add(book);
    x += w + 0.006;
  }
}

function chair(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  if (tier === 1) {
    // A crude chair: a slab seat on splayed legs, two uprights and a single rail for a back.
    g.add(mesh(B(0.46, 0.05, 0.42), wood, 0, 0.42, 0.02, { map: planks }));
    for (const [x, z] of [[-0.19, -0.16], [0.19, -0.16], [-0.19, 0.18], [0.19, 0.18]]) {
      const leg = mesh(C(0.025, 0.03, 0.42, 6), wood, x, 0.2, z);
      leg.rotation.set(z * 0.3, 0, -x * 0.3);
      g.add(leg);
    }
    for (const x of [-0.19, 0.19]) g.add(mesh(C(0.024, 0.026, 0.5, 6), wood, x, 0.68, -0.17));
    g.add(mesh(B(0.42, 0.08, 0.035), wood, 0, 0.84, -0.17, { map: planks }));
    return;
  }
  // A proper chair: a framed seat, slatted back; the oak armchair is cushioned with arms.
  const seat = tier === 3 ? 0.4 : 0.44;
  legs(g, wood, 0.4, 0.36, seat, tier === 3);
  g.add(mesh(B(0.48, 0.05, 0.44), wood, 0, seat + 0.02, 0.0, { map: planks }));
  const backH = tier === 3 ? 0.62 : 0.52;
  for (const x of [-0.21, 0.21]) g.add(mesh(C(0.026, 0.028, backH, 8), wood, x, seat + backH / 2, -0.19));
  g.add(mesh(B(0.48, 0.07, 0.045), wood, 0, seat + backH - 0.02, -0.19, { map: planks }));
  if (tier === 2) for (const x of [-0.1, 0, 0.1]) g.add(mesh(B(0.04, backH - 0.12, 0.02), wood, x, seat + backH / 2, -0.19));
  else {
    // Cushions and a padded back in red cloth, rolled arms.
    g.add(mesh(B(0.42, 0.08, 0.38), CLOTH[2], 0, seat + 0.08, 0.02));
    g.add(mesh(B(0.38, backH - 0.14, 0.06), CLOTH[2], 0, seat + backH / 2 + 0.02, -0.16));
    for (const x of [-0.23, 0.23]) {
      g.add(mesh(C(0.022, 0.024, 0.22, 8), wood, x, seat + 0.13, 0.15));
      const arm = mesh(C(0.04, 0.04, 0.4, 10).rotateX(Math.PI / 2), wood, x, seat + 0.25, -0.02);
      g.add(arm);
    }
  }
}

function fireplace(g: THREE.Group, tier: number): void {
  const bricks = textures.bricks();
  if (tier === 1) {
    // A clay hearth: a low rounded clay surround open at the front.
    const clay = 0xb0704a;
    g.add(mesh(new THREE.CylinderGeometry(0.4, 0.44, 0.5, 18, 1, true, Math.PI * 0.2, Math.PI * 1.6).rotateY(Math.PI), clay, 0, 0.25, -0.1));
    g.add(mesh(C(0.44, 0.46, 0.06, 18), 0x8a5a3a, 0, 0.03, -0.1));
    g.add(mesh(new THREE.ConeGeometry(0.28, 0.6, 16, 1, true), clay, 0, 0.78, -0.18));
    g.add(mesh(C(0.1, 0.14, 0.6, 10), clay, 0, 1.3, -0.24));
  } else {
    // A fireplace: a brick chimney breast up the wall, an arched opening and a mantel shelf.
    const stone = tier === 3 ? 0xd2cabc : STONE;
    g.add(mesh(B(0.96, 1.9, 0.34), stone, 0, 0.95, -0.33, { map: bricks }));
    g.add(mesh(B(0.2, 0.62, 0.22), stone, -0.32, 0.31, -0.08, { map: bricks }), mesh(B(0.2, 0.62, 0.22), stone, 0.32, 0.31, -0.08, { map: bricks }));
    g.add(mesh(B(0.84, 0.16, 0.24), stone, 0, 0.68, -0.08, { map: bricks }));
    g.add(mesh(B(0.98, 0.05, 0.32), tier === 3 ? GOLD : 0x6a5a4a, 0, 0.79, -0.06, tier === 3 ? { emissive: 0x2a1c00 } : {}));
    g.add(mesh(B(0.5, 0.56, 0.1), 0x1a1612, 0, 0.3, -0.15));
    g.add(mesh(B(1.0, 0.04, 0.5), 0x7a7066, 0, 0.02, 0.0, { map: bricks }));
    if (tier === 3) {
      for (const x of [-0.42, 0.42]) g.add(mesh(C(0.035, 0.035, 0.6, 10), GOLD, x, 0.31, 0.04, { emissive: 0x2a1c00 }));
      g.add(...candle(-0.32, 0.815, -0.1), ...candle(0.32, 0.815, -0.1));
    } else g.add(mesh(C(0.05, 0.06, 0.12, 10), 0x5a7aa0, 0.28, 0.87, -0.12), mesh(B(0.1, 0.14, 0.03), 0xe8dcc0, -0.25, 0.88, -0.14));
  }
  // Logs and the fire.
  for (const [x, a] of [[-0.06, 0.4], [0.07, -0.4]]) {
    const log = mesh(C(0.04, 0.04, 0.3, 8).rotateZ(Math.PI / 2), 0x5a3a20, x, 0.07, tier === 1 ? -0.08 : -0.12);
    log.rotation.y = a;
    g.add(log);
  }
  const fire = mesh(new THREE.ConeGeometry(0.11, 0.24, 10), 0xff8a2a, 0, 0.2, tier === 1 ? -0.08 : -0.12, { emissive: 0xd04000 });
  fire.name = FLICKER;
  g.add(fire, mesh(new THREE.ConeGeometry(0.06, 0.16, 8), 0xffd060, 0, 0.18, tier === 1 ? -0.05 : -0.09, { emissive: 0xff9a00 }));
}

function bookcase(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  const h = 1.6;
  g.add(mesh(B(0.9, h, 0.04), shade(wood, 0.7), 0, h / 2, -0.38, { map: planks }));
  for (const x of [-0.43, 0.43]) g.add(mesh(B(0.04, h, 0.34), wood, x, h / 2, -0.22, { map: planks }));
  const shelves = [0.06, 0.45, 0.84, 1.23];
  for (const y of shelves) g.add(mesh(B(0.86, 0.035, 0.32), wood, 0, y, -0.22, { map: planks }));
  g.add(mesh(B(0.94, 0.06, 0.38), wood, 0, h, -0.21, { map: planks }));
  shelves.slice(0, 3).forEach((y, n) => books(g, y + 0.02, -0.24, 0.82, n + tier * 3));
  if (tier >= 2) g.add(mesh(B(0.94, 0.08, 0.04), shade(wood, 1.15), 0, h - 0.06, -0.04));
  if (tier === 3) {
    // A carved crest along the top.
    const crest = mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.04, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), wood, 0, h + 0.03, -0.2);
    crest.rotation.z = Math.PI / 2;
    g.add(crest, mesh(S(0.035), GOLD, 0, h + 0.12, -0.2, { emissive: 0x2a1c00 }));
  }
  // An ornament on the top shelf.
  g.add(mesh(C(0.05, 0.07, 0.16, 10), tier === 3 ? GOLD : 0x5a7aa0, 0.3, 1.33, -0.24));
}

function stove(g: THREE.Group, tier: number): void {
  const bricks = textures.bricks();
  if (tier === 1) {
    // A firepit: a ring of bricks, logs and a pot over the fire on a tripod.
    for (let n = 0; n < 10; n++) {
      const a = (n / 10) * Math.PI * 2;
      const b = mesh(B(0.14, 0.1, 0.09), 0x9a6a4a, Math.cos(a) * 0.3, 0.05, Math.sin(a) * 0.3, { map: bricks });
      b.rotation.y = -a;
      g.add(b);
    }
    for (const a of [0.3, 1.9, 3.5]) {
      const log = mesh(C(0.035, 0.035, 0.36, 8).rotateZ(Math.PI / 2), 0x5a3a20, 0, 0.05, 0);
      log.rotation.y = a;
      g.add(log);
    }
    for (const a of [0.5, 2.6, 4.7]) {
      const leg = mesh(C(0.012, 0.012, 0.85, 6), IRON, Math.cos(a) * 0.18, 0.4, Math.sin(a) * 0.18);
      leg.rotation.set(Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3);
      g.add(leg);
    }
    g.add(mesh(S(0.13).scale(1, 0.85, 1), 0x2a2a2a, 0, 0.42, 0), mesh(C(0.1, 0.1, 0.02, 12), 0x3a3a3a, 0, 0.53, 0));
    const fire = mesh(new THREE.ConeGeometry(0.12, 0.22, 10), 0xff8a2a, 0, 0.16, 0, { emissive: 0xd04000 });
    fire.name = FLICKER;
    g.add(fire);
    return;
  }
  if (tier === 2) {
    // An iron stove: a squat black box on feet, a firebox door and a pipe up the wall.
    g.add(mesh(B(0.7, 0.6, 0.56), IRON, 0, 0.42, -0.1));
    for (const x of [-0.3, 0.3]) for (const z of [-0.33, 0.13]) g.add(mesh(C(0.04, 0.03, 0.12, 8), IRON, x, 0.06, z));
    g.add(mesh(B(0.74, 0.04, 0.6), 0x2a2826, 0, 0.74, -0.1));
    g.add(mesh(B(0.32, 0.24, 0.03), 0x2a2826, -0.12, 0.38, 0.19), mesh(C(0.02, 0.02, 0.04, 8).rotateX(Math.PI / 2), 0xb0a080, 0.0, 0.38, 0.21));
    const glow = mesh(B(0.2, 0.05, 0.01), 0xff7a2a, -0.12, 0.3, 0.205, { emissive: 0xc02a00 });
    glow.name = FLICKER;
    g.add(glow, mesh(C(0.07, 0.07, 1.3, 12), IRON, 0.18, 1.38, -0.28), mesh(C(0.13, 0.11, 0.1, 12), 0x5a5a5a, -0.15, 0.81, -0.12), mesh(C(0.12, 0.12, 0.03, 12), 0x2a2a2a, 0.15, 0.77, 0.0));
    return;
  }
  // A grand range: a long brick cooker with an iron top, an oven door, a hood, and copper pots.
  g.add(mesh(B(0.96, 0.7, 0.66), 0x9a7a62, 0, 0.35, -0.12, { map: bricks }));
  g.add(mesh(B(1.0, 0.05, 0.7), IRON, 0, 0.72, -0.12));
  g.add(mesh(B(0.36, 0.3, 0.03), IRON, -0.2, 0.34, 0.215), mesh(B(0.3, 0.03, 0.03), 0xb08a40, -0.2, 0.52, 0.23));
  g.add(mesh(B(0.28, 0.18, 0.03), IRON, 0.25, 0.26, 0.215));
  const glow = mesh(B(0.24, 0.1, 0.01), 0xff7a2a, 0.25, 0.26, 0.23, { emissive: 0xc02a00 });
  glow.name = FLICKER;
  g.add(glow);
  g.add(mesh(B(0.96, 0.08, 0.4), 0x9a7a62, 0, 1.5, -0.26, { map: bricks }), mesh(new THREE.CylinderGeometry(0.22, 0.48, 0.5, 4, 1, true).rotateY(Math.PI / 4).scale(1.4, 1, 0.8), 0x9a7a62, 0, 1.22, -0.24));
  g.add(mesh(C(0.13, 0.11, 0.18, 14), 0xc87a40, -0.25, 0.84, -0.12), mesh(C(0.14, 0.14, 0.02, 14), 0xd88a50, -0.25, 0.94, -0.12));
  g.add(mesh(C(0.14, 0.13, 0.04, 14), 0xc87a40, 0.22, 0.76, 0.0), mesh(B(0.2, 0.02, 0.03), 0xc87a40, 0.42, 0.77, 0.0));
}

function larder(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  const h = 1.3;
  g.add(mesh(B(0.86, h, 0.44), wood, 0, h / 2, -0.2, { map: planks }));
  g.add(mesh(B(0.92, 0.05, 0.5), shade(wood, 0.8), 0, h + 0.02, -0.2));
  // Two doors with a gap down the middle, and knobs.
  for (const x of [-0.21, 0.21]) {
    g.add(mesh(B(0.4, h - 0.16, 0.025), shade(wood, 1.12), x, h / 2, 0.025, { map: planks }));
    g.add(mesh(S(0.025), tier === 3 ? GOLD : 0x2a2a2a, x > 0 ? x - 0.15 : x + 0.15, h / 2, 0.05));
  }
  if (tier === 3) {
    g.add(mesh(B(0.86, 0.14, 0.03), CLOTH[1], 0, h - 0.1, 0.04));
  }
  // Jars and a cheese on top.
  for (const [x, c] of [[-0.28, 0xc8b070], [-0.12, 0x9a5a3a], [0.05, 0x7a9a5a]] as const) g.add(mesh(C(0.06, 0.06, 0.16, 10), c, x, h + 0.12, -0.22), mesh(C(0.065, 0.065, 0.03, 10), 0xe8dcc0, x, h + 0.21, -0.22));
  g.add(mesh(C(0.1, 0.1, 0.08, 14), 0xe8c060, 0.27, h + 0.08, -0.2));
}

function table(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  legs(g, wood, 0.72, 0.62, 0.66, tier >= 2);
  g.add(mesh(B(0.92, 0.06, 0.82), wood, 0, 0.69, 0, { map: planks }));
  if (tier >= 2) g.add(mesh(B(0.8, 0.07, 0.7), shade(wood, 0.85), 0, 0.62, 0));
  if (tier === 3) g.add(mesh(B(0.3, 0.005, 0.84), CLOTH[2], 0, 0.725, 0), ...candle(0, 0.725, -0.1));
  // A loaf, a jug and a bowl.
  g.add(mesh(S(0.08).scale(1.4, 0.7, 1), 0xc8904a, -0.22, 0.76, 0.12), mesh(C(0.05, 0.06, 0.16, 10), 0x9a6a4a, 0.25, 0.8, -0.15), mesh(C(0.09, 0.05, 0.06, 12), 0xe8dcc0, 0.2, 0.75, 0.18));
}

function toolRack(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  g.add(mesh(B(0.9, 0.9, 0.04), wood, 0, 0.95, -0.4, { map: planks }));
  g.add(mesh(B(0.94, 0.05, 0.08), shade(wood, 0.8), 0, 1.42, -0.37), mesh(B(0.94, 0.05, 0.12), shade(wood, 0.8), 0, 0.5, -0.36));
  for (let n = 0; n < 5; n++) g.add(mesh(C(0.012, 0.012, 0.06, 6).rotateX(Math.PI / 2), 0x8a8a8a, -0.36 + n * 0.18, 1.25, -0.35));
  // Hammer, saw, knife; then tinderbox, spade, rake; then more.
  const hammer = new THREE.Group();
  hammer.add(mesh(C(0.016, 0.016, 0.3, 6), 0x7a5230, 0, -0.12, 0), mesh(B(0.12, 0.05, 0.05), 0x5a5a5a, 0, 0.03, 0));
  hammer.position.set(-0.36, 1.18, -0.33);
  const saw = new THREE.Group();
  saw.add(mesh(B(0.07, 0.3, 0.01), 0xc0c0c8, 0.02, -0.17, 0), mesh(B(0.1, 0.09, 0.03), 0x7a5230, 0, 0.0, 0));
  saw.position.set(-0.18, 1.18, -0.34);
  const knife = new THREE.Group();
  knife.add(mesh(B(0.025, 0.14, 0.008), 0xd0d0d8, 0, -0.1, 0), mesh(C(0.015, 0.015, 0.08, 6), 0x3a2a1a, 0, 0.02, 0));
  knife.position.set(0, 1.18, -0.34);
  g.add(hammer, saw, knife);
  if (tier >= 2) {
    const spade = new THREE.Group();
    spade.add(mesh(C(0.016, 0.016, 0.55, 6), 0x7a5230, 0, -0.25, 0), mesh(B(0.12, 0.16, 0.012), 0x8a8a8a, 0, -0.58, 0));
    spade.position.set(0.18, 1.18, -0.34);
    const rake = new THREE.Group();
    rake.add(mesh(C(0.014, 0.014, 0.6, 6), 0x7a5230, 0, -0.28, 0), mesh(B(0.18, 0.02, 0.02), 0x6a6a6a, 0, -0.6, 0));
    for (let n = 0; n < 5; n++) rake.add(mesh(B(0.01, 0.05, 0.01), 0x6a6a6a, -0.08 + n * 0.04, -0.63, 0));
    rake.position.set(0.36, 1.18, -0.34);
    g.add(spade, rake, mesh(B(0.1, 0.06, 0.06), 0x5a3a20, 0.3, 0.56, -0.3));
  }
  if (tier === 3) g.add(mesh(C(0.08, 0.07, 0.12, 12), 0x8a8a8a, -0.28, 0.6, -0.28), mesh(C(0.08, 0.06, 0.03, 12), 0x6a4a2a, -0.05, 0.54, -0.28), mesh(B(0.94, 0.04, 0.04), GOLD, 0, 1.45, -0.33, { emissive: 0x2a1c00 }));
}

function workbench(g: THREE.Group, tier: number): void {
  const wood = WOOD[Math.min(tier, 2) - 1];
  const planks = textures.planks();
  if (tier === 3) {
    // A steel frame under an oak top.
    for (const x of [-0.42, 0.42]) for (const z of [-0.22, 0.2]) g.add(mesh(B(0.05, 0.76, 0.05), 0x6a6e74, x, 0.38, z));
    for (const z of [-0.22, 0.2]) g.add(mesh(B(0.84, 0.04, 0.04), 0x6a6e74, 0, 0.18, z));
  } else legs(g, wood, 0.84, 0.42, 0.76, false, planks);
  g.add(mesh(B(0.98, 0.08, 0.56), wood, 0, 0.8, -0.02, { map: planks }));
  g.add(mesh(B(0.9, 0.03, 0.44), shade(wood, 0.85), 0, 0.2, -0.02));
  // A vice on the corner, a plank being worked, a mallet and shavings.
  g.add(mesh(B(0.14, 0.1, 0.12), tier === 3 ? 0x6a6e74 : IRON, 0.36, 0.89, 0.18), mesh(C(0.012, 0.012, 0.18, 6).rotateZ(Math.PI / 2), 0x9a9a9a, 0.36, 0.89, 0.27));
  const plank = mesh(B(0.5, 0.03, 0.12), 0xc8a070, -0.08, 0.855, 0.02, { map: planks });
  plank.rotation.y = 0.2;
  g.add(plank, mesh(B(0.1, 0.06, 0.06), 0x7a5230, -0.32, 0.87, -0.15), mesh(C(0.014, 0.014, 0.16, 6).rotateZ(Math.PI / 2), 0x7a5230, -0.2, 0.86, -0.15));
  for (let n = 0; n < 5; n++) g.add(mesh(new THREE.TorusGeometry(0.018, 0.006, 4, 8, Math.PI * 1.5), 0xe8c890, -0.3 + n * 0.12, 0.85, 0.15 - (n % 2) * 0.05));
}

function bed(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  const cloth = CLOTH[tier - 1];
  // Head against the wall, foot toward the room.
  g.add(mesh(B(0.84, 0.18, 0.92), wood, 0, 0.2, 0.0, { map: planks }));
  for (const x of [-0.4, 0.4]) for (const z of [-0.44, 0.44]) g.add(mesh(C(0.035, 0.035, tier === 3 ? 1.75 : z < 0 ? 0.75 : 0.42, 10), wood, x, tier === 3 ? 0.875 : z < 0 ? 0.375 : 0.21, z));
  g.add(mesh(B(0.84, 0.44, 0.05), wood, 0, 0.5, -0.45, { map: planks }), mesh(B(0.84, 0.18, 0.04), wood, 0, 0.33, 0.45, { map: planks }));
  // Mattress, a pillow and a blanket turned down.
  g.add(mesh(B(0.76, 0.1, 0.86), 0xe8e0cc, 0, 0.34, 0.0));
  g.add(mesh(S(0.14).scale(2.2, 0.5, 1), 0xf4eedc, 0, 0.42, -0.3));
  g.add(mesh(B(0.8, 0.06, 0.58), cloth, 0, 0.4, 0.13), mesh(B(0.8, 0.065, 0.1), shade(cloth, 1.3), 0, 0.41, -0.15));
  for (const x of [-0.4, 0.4]) g.add(mesh(B(0.02, 0.16, 0.58), cloth, x, 0.33, 0.13));
  if (tier === 3) {
    // A canopy over the four posts, with drapes tied back.
    for (const z of [-0.44, 0.44]) g.add(mesh(B(0.86, 0.06, 0.05), wood, 0, 1.72, z));
    for (const x of [-0.4, 0.4]) g.add(mesh(B(0.05, 0.06, 0.92), wood, x, 1.72, 0));
    g.add(mesh(B(0.84, 0.02, 0.9), shade(cloth, 0.9), 0, 1.75, 0));
    for (const x of [-0.38, 0.38]) for (const z of [-0.42, 0.42]) g.add(mesh(C(0.03, 0.07, 1.2, 8), shade(cloth, 0.95), x, 1.12, z));
    for (const x of [-0.4, 0.4]) for (const z of [-0.44, 0.44]) g.add(mesh(S(0.04), GOLD, x, 1.79, z, { emissive: 0x2a1c00 }));
  }
}

function wardrobe(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  const h = 1.7;
  g.add(mesh(B(0.84, h, 0.5), wood, 0, h / 2 + 0.06, -0.18, { map: planks }));
  for (const x of [-0.36, 0.36]) for (const z of [-0.38, 0.02]) g.add(mesh(S(0.045), wood, x, 0.04, z));
  g.add(mesh(B(0.9, 0.07, 0.56), shade(wood, 0.8), 0, h + 0.09, -0.18));
  for (const x of [-0.205, 0.205]) {
    g.add(mesh(B(0.39, h - 0.14, 0.025), shade(wood, 1.1), x, h / 2 + 0.06, 0.075, { map: planks }));
    g.add(mesh(B(0.3, h - 0.5, 0.012), shade(wood, 0.95), x, h / 2 + 0.06, 0.09));
    g.add(mesh(C(0.012, 0.012, 0.12, 6), tier === 3 ? GOLD : 0x2a2a2a, x > 0 ? x - 0.15 : x + 0.15, h / 2 + 0.06, 0.1));
  }
  if (tier === 3) g.add(mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.05, 16, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), wood, 0, h + 0.12, -0.0));
}

function altar(g: THREE.Group, tier: number): void {
  const bricks = textures.bricks();
  const planks = textures.planks();
  if (tier === 3) {
    // Gilded: white stone, gold edges, a gold cloth and sunburst.
    g.add(mesh(B(0.9, 0.12, 0.6), 0xd8d0c0, 0, 0.06, -0.05, { map: bricks }), mesh(B(0.78, 0.62, 0.48), 0xece4d4, 0, 0.43, -0.05));
    g.add(mesh(B(0.86, 0.06, 0.56), GOLD, 0, 0.77, -0.05, { emissive: 0x2a1c00 }), mesh(B(0.3, 0.64, 0.02), 0xd8b048, 0, 0.47, 0.2, { emissive: 0x2a1c00 }));
  } else {
    const wood = WOOD[tier];
    g.add(mesh(B(0.86, 0.72, 0.5), wood, 0, 0.38, -0.05, { map: planks }), mesh(B(0.92, 0.06, 0.56), shade(wood, 0.8), 0, 0.77, -0.05));
    g.add(mesh(B(0.88, 0.1, 0.02), shade(wood, 0.8), 0, 0.06, 0.2), mesh(B(0.32, 0.66, 0.02), CLOTH[tier === 1 ? 2 : 0], 0, 0.45, 0.21));
  }
  g.add(...candle(-0.3, 0.8, -0.15), ...candle(0.3, 0.8, -0.15));
  const sun = new THREE.Group();
  sun.add(mesh(new THREE.TorusGeometry(0.1, 0.016, 6, 18), GOLD, 0, 0, 0, { emissive: 0x2a1c00 }), mesh(new THREE.CircleGeometry(0.06, 14), 0xf0d070, 0, 0, 0, { emissive: 0x3a2a00 }));
  if (tier === 3) for (let n = 0; n < 8; n++) {
    const ray = mesh(B(0.012, 0.07, 0.01), GOLD, Math.sin((n / 8) * Math.PI * 2) * 0.15, Math.cos((n / 8) * Math.PI * 2) * 0.15, 0, { emissive: 0x2a1c00 });
    ray.rotation.z = -(n / 8) * Math.PI * 2;
    sun.add(ray);
  }
  sun.position.set(0, 0.96, -0.2);
  g.add(sun, mesh(C(0.012, 0.012, 0.16, 6), GOLD, 0, 0.86, -0.2));
}

function lamp(g: THREE.Group, tier: number): void {
  if (tier === 1) {
    // An iron candle stand: three feet, a pole, a drip tray and a fat candle.
    for (const a of [0, 2.1, 4.2]) {
      const foot = mesh(B(0.2, 0.025, 0.03), IRON, Math.cos(a) * 0.09, 0.015, Math.sin(a) * 0.09);
      foot.rotation.y = -a;
      g.add(foot);
    }
    g.add(mesh(C(0.016, 0.02, 1.15, 8), IRON, 0, 0.58, 0), mesh(C(0.09, 0.06, 0.03, 12), IRON, 0, 1.16, 0), mesh(C(0.04, 0.04, 0.16, 10), 0xf4eedc, 0, 1.25, 0), flame(0, 1.37, 0, 1.4));
    return;
  }
  // A lamp on a turned post: a glass lantern with a flame inside.
  const wood = tier === 3 ? WOOD[2] : WOOD[1];
  g.add(mesh(C(0.14, 0.17, 0.06, 14), wood, 0, 0.03, 0), mesh(C(0.03, 0.04, 1.0, 10), wood, 0, 0.55, 0), mesh(S(0.05), wood, 0, 0.35, 0));
  const metal = tier === 3 ? GOLD : IRON;
  g.add(mesh(C(0.09, 0.07, 0.04, 12), metal, 0, 1.06, 0, tier === 3 ? { emissive: 0x2a1c00 } : {}));
  g.add(mesh(C(0.08, 0.08, 0.2, 12), 0xfff0c0, 0, 1.18, 0, { opacity: 0.4, emissive: 0x7a5a20 }));
  for (let n = 0; n < 4; n++) g.add(mesh(B(0.012, 0.22, 0.012), metal, Math.cos((n / 4) * Math.PI * 2 + 0.78) * 0.085, 1.18, Math.sin((n / 4) * Math.PI * 2 + 0.78) * 0.085));
  g.add(mesh(new THREE.ConeGeometry(0.11, 0.1, 12), metal, 0, 1.33, 0, tier === 3 ? { emissive: 0x2a1c00 } : {}), mesh(new THREE.TorusGeometry(0.03, 0.008, 6, 12), metal, 0, 1.41, 0), flame(0, 1.17, 0, 1.3));
}

function desk(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  // A pedestal of drawers on one side, legs on the other.
  g.add(mesh(B(0.3, 0.72, 0.5), wood, 0.3, 0.36, -0.1, { map: planks }));
  for (const y of [0.18, 0.4, 0.6]) g.add(mesh(B(0.26, 0.17, 0.02), shade(wood, 1.12), 0.3, y, 0.16), mesh(S(0.018), tier === 3 ? GOLD : 0x2a2a2a, 0.3, y, 0.18));
  for (const z of [-0.3, 0.1]) g.add(mesh(C(0.025, 0.022, 0.72, 8), wood, -0.4, 0.36, z));
  g.add(mesh(B(0.96, 0.05, 0.58), wood, 0, 0.745, -0.1, { map: planks }));
  if (tier >= 2) g.add(mesh(B(0.96, 0.22, 0.12), wood, 0, 0.88, -0.34, { map: planks }), mesh(B(0.92, 0.02, 0.1), shade(wood, 1.15), 0, 0.99, -0.34));
  // Papers, an open book, an inkwell and a quill.
  const paper = mesh(B(0.2, 0.005, 0.26), 0xf0e8d0, -0.15, 0.775, -0.02);
  paper.rotation.y = 0.15;
  g.add(paper, mesh(B(0.3, 0.02, 0.2), 0x6a2a2a, 0.12, 0.78, -0.08), mesh(B(0.28, 0.01, 0.18), 0xf4eedc, 0.12, 0.795, -0.08));
  g.add(mesh(C(0.03, 0.035, 0.05, 10), 0x1a1a2a, -0.32, 0.795, -0.22));
  const quill = mesh(new THREE.ConeGeometry(0.02, 0.22, 6), 0xf4f0e8, -0.3, 0.88, -0.22);
  quill.rotation.z = 0.35;
  g.add(quill);
  if (tier === 3) g.add(...candle(0.38, 1.0, -0.34));
}

function portal(g: THREE.Group, tier: number): void {
  const frame = tier === 3 ? GOLD : WOOD[tier];
  const glow = [0x7ac8ff, 0x8aff9a, 0xc08aff][tier - 1];
  const bricks = textures.bricks();
  // A stepped stone base, an arched frame and a swirling glow across it.
  g.add(mesh(B(0.96, 0.08, 0.5), STONE, 0, 0.04, -0.1, { map: bricks }), mesh(B(0.84, 0.06, 0.4), shade(STONE, 1.08), 0, 0.11, -0.1, { map: bricks }));
  const opts = tier === 3 ? { emissive: 0x2a1c00 } : {};
  for (const x of [-0.36, 0.36]) g.add(mesh(B(0.1, 1.2, 0.14), frame, x, 0.74, -0.1, opts));
  const arch = mesh(new THREE.TorusGeometry(0.36, 0.06, 8, 24, Math.PI), frame, 0, 1.34, -0.1, opts);
  arch.scale.z = 1.2;
  g.add(arch);
  const surface = new THREE.Shape();
  surface.moveTo(-0.31, 0);
  surface.lineTo(0.31, 0);
  surface.lineTo(0.31, 1.2);
  surface.absarc(0, 1.2, 0.31, 0, Math.PI, false);
  surface.lineTo(-0.31, 0);
  const veil = mesh(new THREE.ShapeGeometry(surface, 16), glow, 0, 0.14, -0.1, { emissive: shade(glow, 0.5), opacity: 0.7 });
  (veil.material as THREE.MeshLambertMaterial).side = THREE.DoubleSide;
  veil.name = FLICKER;
  g.add(veil);
  // A spiral of brighter light in the middle.
  const swirl = mesh(new THREE.TorusGeometry(0.16, 0.02, 6, 30, Math.PI * 1.6), 0xffffff, 0, 0.84, -0.09, { emissive: glow, opacity: 0.8 });
  swirl.name = FLICKER;
  g.add(swirl, mesh(new THREE.TorusGeometry(0.08, 0.015, 6, 20, Math.PI * 1.5), 0xffffff, 0, 0.84, -0.085, { emissive: glow, opacity: 0.8 }));
  if (tier >= 2) for (const x of [-0.36, 0.36]) g.add(mesh(new THREE.OctahedronGeometry(0.06), glow, x, 1.42, -0.02, { emissive: shade(glow, 0.6) }));
}

function pool(g: THREE.Group, tier: number): void {
  const bricks = textures.bricks();
  const stone = tier === 3 ? 0xe4dccc : STONE;
  // A round stone basin with water in it.
  g.add(mesh(new THREE.CylinderGeometry(0.46, 0.48, 0.32, 24, 1, true), stone, 0, 0.16, 0, { map: bricks }));
  g.add(mesh(new THREE.TorusGeometry(0.46, 0.05, 8, 28).rotateX(Math.PI / 2), tier === 3 ? GOLD : shade(stone, 1.08), 0, 0.33, 0, tier === 3 ? { emissive: 0x2a1c00 } : {}));
  g.add(mesh(C(0.44, 0.44, 0.02, 24), 0x5a8ab8, 0, 0.26, 0, { emissive: 0x0a2440, opacity: 0.85 }));
  for (let n = 0; n < 3; n++) g.add(mesh(new THREE.TorusGeometry(0.1 + n * 0.1, 0.006, 4, 24).rotateX(Math.PI / 2), 0xdaf0ff, 0, 0.275, 0, { opacity: 0.45 }));
  if (tier >= 2) {
    // A pillar in the middle with a little spout.
    g.add(mesh(C(0.06, 0.08, 0.5, 12), stone, 0, 0.45, 0, { map: bricks }), mesh(C(0.14, 0.08, 0.08, 14), stone, 0, 0.72, 0));
    const fall = mesh(C(0.035, 0.07, 0.42, 10), 0xbfe4ff, 0, 0.5, 0, { emissive: 0x204060, opacity: 0.5 });
    fall.name = FLICKER;
    g.add(fall);
  }
  if (tier === 3) g.add(mesh(S(0.07), GOLD, 0, 0.83, 0, { emissive: 0x3a2a00 }));
  // Lily pads.
  g.add(mesh(new THREE.CircleGeometry(0.07, 10).rotateX(-Math.PI / 2), 0x4a8a3a, -0.22, 0.28, 0.16), mesh(new THREE.CircleGeometry(0.05, 10).rotateX(-Math.PI / 2), 0x5a9a4a, 0.2, 0.28, -0.2));
}

function bench(g: THREE.Group, tier: number): void {
  const wood = WOOD[tier - 1];
  const planks = textures.planks();
  for (const x of [-0.38, 0.38]) {
    g.add(mesh(B(0.06, 0.4, 0.36), wood, x, 0.2, 0.02, { map: planks }));
  }
  for (const z of [-0.1, 0.04, 0.18]) g.add(mesh(B(0.94, 0.04, 0.12), wood, 0, 0.42, z, { map: planks }));
  if (tier >= 2) {
    for (const x of [-0.38, 0.38]) g.add(mesh(B(0.06, 0.48, 0.05), wood, x, 0.66, -0.17));
    for (const y of [0.62, 0.8]) g.add(mesh(B(0.9, 0.08, 0.03), wood, 0, y, -0.17, { map: planks }));
  }
  if (tier === 3) for (const x of [-0.38, 0.38]) g.add(mesh(B(0.07, 0.04, 0.4), wood, x, 0.6, 0.0), mesh(S(0.03), GOLD, x, 0.92, -0.17, { emissive: 0x2a1c00 }));
}

const BUILDERS: Record<string, (g: THREE.Group, tier: number) => void> = {
  chair,
  fireplace,
  bookcase,
  stove,
  larder,
  table,
  tool_rack: toolRack,
  workbench,
  bed,
  wardrobe,
  altar,
  lamp,
  desk,
  portal,
  pool,
  bench,
};

const ghostMaterial = shared(new THREE.MeshBasicMaterial({ color: 0xd8ecff, transparent: true, opacity: 0.22, depthWrite: false }));
const chalkMaterial = shared(new THREE.MeshBasicMaterial({ color: 0xf0e8d0, transparent: true, opacity: 0.55, depthWrite: false }));

/**
 * A build spot as its owner sees it: the furniture built there; or a faint
 * ghost of the first piece that could go there; or, in a room that isn't
 * fitted out yet, a chalk square on the floor.
 */
export function buildFurniture(kind: string, tier: number, roomBuilt: boolean): THREE.Group {
  const g = new THREE.Group();
  const build = BUILDERS[kind];
  if (!build) return g;
  if (tier > 0) {
    build(g, tier);
    return g;
  }
  if (roomBuilt) {
    build(g, 1);
    g.traverse((o) => {
      if (!(o as THREE.Mesh).isMesh) return;
      const m = o as THREE.Mesh;
      (m.material as THREE.Material).dispose();
      m.material = ghostMaterial;
      m.castShadow = false;
      if (o.name === FLICKER) o.name = '';
    });
  }
  // The chalk outline, under a ghost too, so the space reads as one to build in.
  for (const [w, d, x, z] of [[0.86, 0.03, 0, -0.43], [0.86, 0.03, 0, 0.43], [0.03, 0.86, -0.43, 0], [0.03, 0.86, 0.43, 0]]) {
    const line = new THREE.Mesh(new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2), chalkMaterial);
    line.position.set(x, 0.012, z);
    g.add(line);
  }
  // Something solid to click, even where nothing is drawn yet.
  const hit = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.5, 0.9), new THREE.MeshBasicMaterial({ visible: false }));
  hit.position.y = 0.25;
  g.add(hit);
  return g;
}

function shade(c: number, f: number): number {
  const col = new THREE.Color(c).multiplyScalar(f);
  return col.getHex();
}
