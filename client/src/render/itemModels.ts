import * as THREE from 'three';
import { GLYPH_COLOURS } from './skillModels';

/**
 * One model per item, used both for the item lying on the ground and, drawn
 * from the game's camera angle, for its icon in the pack, bank and shops, so
 * an item always looks the same wherever it turns up.
 *
 * Models lie on y = 0 with their long side along x, at their size in the
 * world (a tile is 1 across). Everything is built from primitives.
 */

interface Look {
  emissive?: number;
  /** Shiny, for metal and glass. */
  shine?: number;
  opacity?: number;
  map?: THREE.Texture;
  side?: THREE.Side;
}

function mesh(geo: THREE.BufferGeometry, color: number, x = 0, y = 0, z = 0, look: Look = {}): THREE.Mesh {
  const params = {
    color,
    emissive: look.emissive ?? 0x000000,
    map: look.map ?? null,
    side: look.side ?? THREE.FrontSide,
    transparent: look.opacity !== undefined,
    opacity: look.opacity ?? 1,
    depthWrite: look.opacity === undefined,
  };
  const mat = look.shine ? new THREE.MeshPhongMaterial({ ...params, shininess: look.shine, specular: 0x5a5a5a }) : new THREE.MeshLambertMaterial(params);
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

const METAL = 50;
const B = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);
const C = (rt: number, rb: number, h: number, seg = 8) => new THREE.CylinderGeometry(rt, rb, h, seg);
const S = (r: number, w = 10, h = 7) => new THREE.SphereGeometry(r, w, h);
/** A cylinder lying along x. */
const rod = (r: number, len: number, seg = 7, r2 = r) => C(r2, r, len, seg).rotateZ(-Math.PI / 2);

/** A flat outline (x across, y away from the viewer) given thickness, lying on the ground. */
function slab(points: readonly (readonly [number, number])[], depth: number, bevel = 0.004, curve = false): THREE.BufferGeometry {
  const shape = new THREE.Shape();
  points.forEach(([x, y], i) => (i ? shape.lineTo(x, y) : shape.moveTo(x, y)));
  return slabOf(shape, depth, bevel, curve ? 10 : 1);
}

function slabOf(shape: THREE.Shape, depth: number, bevel = 0.004, curveSegments = 10): THREE.BufferGeometry {
  const geo = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: bevel > 0, bevelThickness: bevel, bevelSize: bevel, bevelSegments: 1, curveSegments });
  return geo.rotateX(-Math.PI / 2).translate(0, bevel, 0);
}

/** A tube along a curve, thinning from r0 at the start to r1 at the end. */
function horn(points: THREE.Vector3[], r0: number, r1: number, radial = 7): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points);
  const segs = 16;
  const geo = new THREE.TubeGeometry(curve, segs, 1, radial, false);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const p = new THREE.Vector3();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const centre = curve.getPointAt(t);
    const r = r0 + (r1 - r0) * t;
    for (let j = 0; j <= radial; j++) {
      const k = i * (radial + 1) + j;
      p.fromBufferAttribute(pos, k).sub(centre).multiplyScalar(r).add(centre);
      pos.setXYZ(k, p.x, p.y, p.z);
    }
  }
  geo.computeVertexNormals();
  return geo;
}

/** Puts a part at a place and turn, then returns it. */
function place<T extends THREE.Object3D>(o: T, x: number, y: number, z: number, ry = 0, rx = 0, rz = 0): T {
  o.position.set(x, y, z);
  o.rotation.set(rx, ry, rz);
  return o;
}

const group = (...parts: THREE.Object3D[]) => {
  const g = new THREE.Group();
  g.add(...parts);
  return g;
};

const lighter = (c: number, k: number) => new THREE.Color(c).lerp(new THREE.Color(0xffffff), k).getHex();
const darker = (c: number, k: number) => new THREE.Color(c).multiplyScalar(1 - k).getHex();
const mix = (a: number, b: number, k: number) => new THREE.Color(a).lerp(new THREE.Color(b), k).getHex();

const WOOD = 0x7a5230;
const LEATHER = 0x5a3a22;

/** Colour of metal gear, tools and bars, from the item's first word. */
const METALS: Record<string, number> = {
  bronze: 0xc0844a,
  iron: 0x8e9098,
  steel: 0xc4ccd6,
  gold: 0xe8b830,
  cobalt: 0x4a6fc4,
  verdite: 0x3a7a58,
  glacite: 0x9ed6ec,
};
const metalOf = (itemId: string): number => METALS[itemId.split('_')[0]] ?? 0xc4ccd6;

// --- Tools and weapons ---------------------------------------------------------

/** Wooden haft along x from -len/2, with the business end at +x. */
function haft(len: number, r = 0.017, color = WOOD): THREE.Mesh {
  return mesh(rod(r, len, 7, r * 1.15), color, 0, r, 0);
}

function axe(metal: number): THREE.Group {
  // A bearded blade off one side of the eye, flaring to a curved edge.
  const head = new THREE.Shape();
  head.moveTo(-0.03, 0.035);
  head.lineTo(0.03, 0.035);
  head.lineTo(0.032, -0.03);
  head.quadraticCurveTo(0.06, -0.08, 0.085, -0.15);
  head.quadraticCurveTo(0.0, -0.19, -0.085, -0.15);
  head.quadraticCurveTo(-0.06, -0.08, -0.032, -0.03);
  head.lineTo(-0.03, 0.035);
  const edge = new THREE.Shape();
  edge.moveTo(0.085, -0.15);
  edge.quadraticCurveTo(0.0, -0.19, -0.085, -0.15);
  edge.quadraticCurveTo(0.0, -0.162, 0.072, -0.127);
  edge.lineTo(0.085, -0.15);
  return group(haft(0.5), mesh(slabOf(head, 0.03, 0.006), metal, 0.215, 0.004, 0, { shine: METAL }), mesh(slabOf(edge, 0.032, 0.006), lighter(metal, 0.45), 0.215, 0.004, 0, { shine: METAL }));
}

function pickaxe(metal: number): THREE.Group {
  // Two spikes sweeping back from the eye, thick at the middle and sharp at the ends.
  const g = group(haft(0.5), mesh(B(0.055, 0.055, 0.065), darker(metal, 0.15), 0.215, 0.03, 0, { shine: METAL }));
  for (const s of [-1, 1]) {
    g.add(mesh(horn([new THREE.Vector3(0.235, 0.032, 0), new THREE.Vector3(0.23, 0.032, s * 0.09), new THREE.Vector3(0.19, 0.03, s * 0.17), new THREE.Vector3(0.14, 0.026, s * 0.21)], 0.028, 0.003, 8), s > 0 ? metal : lighter(metal, 0.08), 0, 0, 0, { shine: METAL }));
  }
  return g;
}

function hammer(head: number, pick = false): THREE.Group {
  const g = group(haft(0.34, 0.015), mesh(B(0.06, 0.055, 0.15), head, 0.16, 0.03, 0, { shine: METAL }));
  g.add(mesh(B(0.064, 0.059, 0.035), darker(head, 0.25), 0.16, 0.03, 0.06, { shine: METAL }));
  if (pick) g.add(place(mesh(new THREE.ConeGeometry(0.026, 0.1, 4), head, 0, 0, 0, { shine: METAL }), 0.16, 0.03, -0.12, 0, -Math.PI / 2));
  else g.add(mesh(B(0.064, 0.059, 0.035), darker(head, 0.25), 0.16, 0.03, -0.06, { shine: METAL }));
  return g;
}

/** A blade pointing along +x from a crossguard at x = 0. */
function blade(metal: number, len: number, opts: { width?: number; guard?: number; grip?: number; pommel?: number; edge?: number; curve?: boolean } = {}): THREE.Group {
  const w = opts.width ?? (len > 0.3 ? 0.032 : 0.028);
  const outline: [number, number][] = opts.curve
    ? [[0, -w], [len * 0.5, -w * 1.1], [len * 0.85, -w * 0.4], [len, w * 0.9], [len * 0.7, w * 0.7], [len * 0.3, w], [0, w]]
    : [[0, -w], [len * 0.82, -w * 0.85], [len, 0], [len * 0.82, w * 0.85], [0, w]];
  const g = group(mesh(slab(outline, 0.008, 0.004), metal, 0, 0.004, 0, { shine: METAL }));
  // The fuller: a darker groove down the middle.
  if (!opts.curve) g.add(mesh(slab([[0.02, -w * 0.18], [len * 0.7, -w * 0.12], [len * 0.7, w * 0.12], [0.02, w * 0.18]], 0.002, 0), opts.edge ?? darker(metal, 0.25), 0, 0.016, 0, { shine: METAL, emissive: opts.edge ? opts.edge & 0x7f3f1f : 0 }));
  const guardW = opts.guard ?? 0.075;
  g.add(mesh(B(0.022, 0.024, guardW * 2), opts.pommel ?? 0x7a6a4a, -0.008, 0.014, 0, { shine: 30 }));
  const grip = opts.grip ?? (len > 0.3 ? 0.11 : 0.075);
  g.add(mesh(rod(0.013, grip, 7), LEATHER, -0.02 - grip / 2, 0.014, 0));
  g.add(mesh(S(0.02, 8, 6), opts.pommel ?? 0x7a6a4a, -0.03 - grip, 0.016, 0, { shine: 30 }));
  return g;
}

function knife(): THREE.Group {
  const g = group(mesh(slab([[0, -0.016], [0.12, -0.012], [0.15, 0.012], [0, 0.016]], 0.006, 0.003), 0xc4ccd6, 0, 0.003, 0, { shine: METAL }));
  g.add(mesh(slab([[-0.1, -0.017], [0.0, -0.019], [0.0, 0.019], [-0.1, 0.017]], 0.018, 0.006, false), 0x5a3a20, 0, 0.0, 0));
  g.add(mesh(rod(0.004, 0.003), 0xc8c8c8, -0.03, 0.026, 0));
  return g;
}

function staff(orb: number | null): THREE.Group {
  const g = group(mesh(rod(0.026, 0.95, 8, 0.032), 0x6b4428, 0, 0.032, 0));
  g.add(mesh(rod(0.034, 0.05, 8), 0x55575c, -0.46, 0.034, 0, { shine: METAL }));
  if (orb === null) g.add(mesh(S(0.05, 10, 8), 0x8a5a32, 0.49, 0.045, 0));
  else {
    // Three prongs cradling the orb.
    for (const a of [0, 2.1, 4.2]) {
      g.add(mesh(horn([new THREE.Vector3(0.45, 0.06, 0), new THREE.Vector3(0.5, 0.07 + Math.sin(a) * 0.07, Math.cos(a) * 0.07), new THREE.Vector3(0.6, 0.07 + Math.sin(a) * 0.055, Math.cos(a) * 0.055)], 0.016, 0.006), 0x6b4428));
    }
    g.add(mesh(S(0.075, 16, 12), orb, 0.56, 0.08, 0, { emissive: darker(orb, 0.55), shine: 80 }));
  }
  return g;
}

function bow(wood: number, long: boolean, strung: boolean): THREE.Group {
  const half = long ? 0.32 : 0.23;
  const bend = long ? 0.11 : 0.09;
  const limb = new THREE.QuadraticBezierCurve3(new THREE.Vector3(-half, 0.016, bend * 0.15), new THREE.Vector3(0, 0.016, -bend * 1.85), new THREE.Vector3(half, 0.016, bend * 0.15));
  const pts = limb.getPoints(12);
  const g = group(mesh(horn(pts.slice(0, 7), 0.008, 0.016), wood), mesh(horn(pts.slice(6), 0.016, 0.008), wood));
  // Leather grip at the middle, horn tips at the ends.
  const mid = limb.getPoint(0.5);
  g.add(mesh(rod(0.02, 0.07, 7), LEATHER, mid.x, 0.018, mid.z));
  for (const s of [-1, 1]) g.add(mesh(S(0.011, 7, 5), 0xe8dcc0, s * half, 0.016, bend * 0.15));
  if (strung) g.add(mesh(rod(0.0025, half * 2, 4), 0xf0ead6, 0, 0.016, bend * 0.15));
  return g;
}

function arrow(head: number | null, fletch: number | null = 0xe8e2d4): THREE.Group {
  const g = group(mesh(rod(0.006, 0.36, 5), 0xb08a5a, 0, 0.008, 0));
  if (head !== null) g.add(place(mesh(new THREE.ConeGeometry(0.016, 0.05, 4), head, 0, 0, 0, { shine: METAL }), 0.2, 0.008, 0, 0, Math.PI / 4, -Math.PI / 2));
  if (fletch !== null) {
    for (const a of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
      const vane = mesh(slab([[0, 0], [0.08, 0], [0.065, 0.02], [0.0, 0.02]], 0.001, 0), fletch, 0, 0, 0, { side: THREE.DoubleSide });
      vane.geometry.rotateX(Math.PI / 2);
      const holder = place(group(vane), -0.17, 0.008, 0, 0, a);
      g.add(holder);
    }
  }
  return g;
}

/** A small loose bundle of something long. */
function bundle(make: () => THREE.Object3D, lay: readonly (readonly [number, number, number])[]): THREE.Group {
  return group(...lay.map(([x, z, r], i) => place(make(), x, i * 0.012, z, r)));
}
const FAN = [[0, -0.03, 0.15], [0.01, 0.0, -0.05], [-0.01, 0.035, -0.25]] as const;

function arrowhead(metal: number): THREE.Mesh {
  return mesh(slab([[0, 0.045], [0.022, -0.012], [0.006, -0.002], [0.006, -0.02], [-0.006, -0.02], [-0.006, -0.002], [-0.022, -0.012]], 0.006, 0.003), metal, 0, 0, 0, { shine: METAL });
}

function feather(color: number): THREE.Group {
  const shape = new THREE.Shape();
  shape.moveTo(-0.11, 0);
  shape.quadraticCurveTo(-0.02, 0.05, 0.11, 0.008);
  shape.quadraticCurveTo(0.0, -0.035, -0.11, 0);
  return group(mesh(slabOf(shape, 0.003, 0.002), color), mesh(rod(0.0025, 0.24, 4), lighter(color, 0.5), 0, 0.006, 0.0));
}

// --- Armour --------------------------------------------------------------------

function helm(metal: number, crest?: number): THREE.Group {
  const dome = mesh(new THREE.SphereGeometry(0.12, 16, 9, 0, Math.PI * 2, 0, Math.PI / 2), metal, 0, 0.02, 0, { shine: METAL, side: THREE.DoubleSide });
  dome.scale.set(1, 1.05, 1.1);
  const rim = mesh(new THREE.TorusGeometry(0.12, 0.012, 6, 20).rotateX(Math.PI / 2).scale(1, 1, 1.1), darker(metal, 0.3), 0, 0.022, 0, { shine: METAL });
  const nose = mesh(B(0.024, 0.09, 0.012), darker(metal, 0.3), 0.132, 0.03, 0, { shine: METAL });
  nose.geometry.rotateY(Math.PI / 2);
  nose.rotation.z = -0.15;
  // The ridge over the top.
  const ridge = mesh(new THREE.TorusGeometry(0.122, 0.009, 5, 14, Math.PI).rotateY(Math.PI / 2), lighter(metal, 0.15), 0, 0.02, 0, { shine: METAL });
  const g = group(dome, rim, place(nose, 0, 0, 0), ridge);
  ridge.scale.set(1.1, 1.05, 1);
  ridge.rotation.y = Math.PI / 2;
  if (crest !== undefined) g.add(mesh(B(0.22, 0.04, 0.014).translate(0, 0.0, 0), crest, 0, 0.145, 0));
  return g;
}

function chainbody(metal: number): THREE.Group {
  // A mail shirt laid out flat: shoulders and short sleeves away from the viewer.
  const outline = [[-0.13, 0.15], [-0.05, 0.17], [0.0, 0.14], [0.05, 0.17], [0.13, 0.15], [0.2, 0.07], [0.16, 0.035], [0.11, 0.07], [0.11, -0.16], [-0.11, -0.16], [-0.11, 0.07], [-0.16, 0.035], [-0.2, 0.07]] as const;
  const g = group(mesh(slab(outline, 0.025, 0.008), metal, 0, 0, 0, { shine: 30 }));
  // Rows of rings, as ridges across the chest.
  for (let i = 0; i < 6; i++) g.add(mesh(B(0.21, 0.004, 0.006), darker(metal, 0.35), 0, 0.038, -0.13 + i * 0.045, { shine: 30 }));
  g.add(mesh(new THREE.TorusGeometry(0.045, 0.01, 5, 12, Math.PI).rotateX(-Math.PI / 2), darker(metal, 0.3), 0, 0.037, -0.13, { shine: 30 }));
  g.add(mesh(B(0.23, 0.012, 0.025), darker(metal, 0.3), 0, 0.037, 0.15, { shine: 30 }));
  g.rotation.y = Math.PI / 2;
  return group(g);
}

function platelegs(metal: number): THREE.Group {
  // Two plated legs splayed a little from a belted waist, laid out flat.
  const g = group(mesh(B(0.24, 0.05, 0.06), metal, 0, 0.028, -0.17, { shine: METAL }), mesh(B(0.25, 0.016, 0.03), darker(metal, 0.35), 0, 0.058, -0.185, { shine: METAL }));
  for (const s of [-1, 1]) {
    const leg = group(mesh(slab([[-0.055, 0], [0.055, 0], [0.045, 0.34], [-0.045, 0.34]], 0.035, 0.009), metal, 0, 0, 0, { shine: METAL }));
    const knee = mesh(S(0.036, 10, 6), lighter(metal, 0.15), 0, 0.045, -0.16, { shine: METAL });
    knee.scale.set(1, 0.4, 1);
    leg.add(knee, mesh(B(0.004, 0.004, 0.3), darker(metal, 0.35), 0, 0.054, -0.17));
    g.add(place(leg, s * 0.062, 0, -0.15, s * -0.08));
  }
  g.rotation.y = Math.PI / 2;
  return group(g);
}

function kiteShield(face: number, rim: number, boss: number, extra?: (g: THREE.Group) => void): THREE.Group {
  const kite = (k: number) => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.16 * k);
    s.quadraticCurveTo(0.14 * k, 0.15 * k, 0.15 * k, 0.07 * k);
    s.quadraticCurveTo(0.13 * k, -0.08 * k, 0, -0.2 * k);
    s.quadraticCurveTo(-0.13 * k, -0.08 * k, -0.15 * k, 0.07 * k);
    s.quadraticCurveTo(-0.14 * k, 0.15 * k, 0, 0.16 * k);
    return s;
  };
  const g = group(mesh(slabOf(kite(1), 0.02, 0.006), rim, 0, 0, 0, { shine: METAL }), mesh(slabOf(kite(0.86), 0.01, 0.006), face, 0, 0.022, 0.0, { shine: METAL }));
  const b = mesh(S(0.034, 12, 7), boss, 0, 0.035, -0.015, { shine: METAL });
  b.scale.set(1, 0.55, 1);
  g.add(b);
  extra?.(g);
  g.rotation.y = Math.PI / 2;
  return group(g);
}

// --- Cloth ---------------------------------------------------------------------

function wizardHat(cloth: number, trim: number, stars: boolean): THREE.Group {
  const g = group(mesh(C(0.15, 0.155, 0.012, 20), cloth, 0, 0.006, 0));
  const cone = mesh(horn([new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, 0.12, 0), new THREE.Vector3(0.02, 0.22, 0), new THREE.Vector3(0.07, 0.27, 0)], 0.075, 0.006, 12), cloth);
  g.add(cone, mesh(C(0.077, 0.08, 0.025, 16), trim, 0, 0.024, 0));
  if (stars) for (const [x, y, z] of [[0.05, 0.09, 0.03], [-0.03, 0.13, 0.04], [0.02, 0.17, -0.04]]) g.add(mesh(S(0.009, 6, 4), 0xffe070, x, y, z, { emissive: 0x6a5010 }));
  return g;
}

function robe(cloth: number, trim: number, stars: boolean): THREE.Group {
  const outline = [[-0.07, 0.18], [0.07, 0.18], [0.2, 0.1], [0.17, 0.05], [0.11, 0.08], [0.13, -0.18], [-0.13, -0.18], [-0.11, 0.08], [-0.17, 0.05], [-0.2, 0.1]] as const;
  const g = group(mesh(slab(outline, 0.022, 0.008), cloth));
  g.add(mesh(B(0.27, 0.006, 0.02), trim, 0, 0.034, -0.168), mesh(B(0.012, 0.006, 0.3), trim, 0, 0.034, 0.0));
  g.add(mesh(new THREE.TorusGeometry(0.04, 0.009, 5, 12, Math.PI).rotateX(-Math.PI / 2), trim, 0, 0.033, 0.18));
  if (stars) for (const [x, z] of [[0.06, 0.06], [-0.06, -0.05], [0.07, -0.1]]) g.add(mesh(S(0.009, 6, 4), 0xffe070, x, 0.034, z, { emissive: 0x6a5010 }));
  g.rotation.y = Math.PI / 2;
  return group(g);
}

function skirt(cloth: number, trim: number): THREE.Group {
  const g = group(mesh(slab([[-0.09, -0.18], [0.09, -0.18], [0.14, 0.18], [-0.14, 0.18]], 0.022, 0.008), cloth));
  g.add(mesh(B(0.19, 0.008, 0.025), trim, 0, 0.034, -0.17), mesh(B(0.28, 0.008, 0.02), trim, 0, 0.034, 0.165));
  for (const s of [-1, 1]) g.add(place(mesh(B(0.006, 0.006, 0.33), darker(cloth, 0.3), 0, 0, 0), s * 0.04, 0.032, 0, s * -0.1));
  g.rotation.y = Math.PI / 2;
  return group(g);
}

// --- Resources ----------------------------------------------------------------

function logs(bark: number, wood: number, glow = false): THREE.Group {
  const g = new THREE.Group();
  for (const [y, z, len] of [[0.055, -0.058, 0.44], [0.055, 0.058, 0.4], [0.15, 0, 0.42]] as const) {
    g.add(mesh(rod(0.056, len, 9), bark, 0, y, z));
    for (const s of [-1, 1]) {
      const end = mesh(new THREE.CircleGeometry(0.052, 9).rotateY((s * Math.PI) / 2), wood, (s * len) / 2 + s * 0.001, y, z, glow ? { emissive: darker(wood, 0.6) } : {});
      g.add(end, mesh(new THREE.RingGeometry(0.022, 0.028, 9).rotateY((s * Math.PI) / 2), darker(wood, 0.25), (s * len) / 2 + s * 0.002, y, z));
    }
    // A knot or two in the bark.
    g.add(mesh(S(0.014, 6, 4), darker(bark, 0.3), len * 0.18, y + 0.05, z));
  }
  return g;
}

/** A rough lump of rock, the same lump every time for the same seed. */
function lump(r: number, seed: number, detail = 1): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(r, detail);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const n = Math.sin(v.x * 91 + seed) * Math.cos(v.y * 57 - seed * 2) * Math.sin(v.z * 73 + seed * 3);
    v.multiplyScalar(1 + n * 0.22);
    pos.setXYZ(i, v.x, v.y * 0.75, v.z);
  }
  geo.computeVertexNormals();
  return geo.toNonIndexed();
}

function ore(fleck: number | null): THREE.Group {
  const g = group(mesh(lump(0.1, 3), fleck === null ? 0x262626 : 0x7a746c, 0, 0.07, 0, fleck === null ? { shine: 20 } : {}));
  if (fleck === null) {
    g.add(mesh(lump(0.06, 7), 0x2e2e2e, 0.1, 0.04, 0.05, { shine: 20 }), mesh(lump(0.05, 11), 0x222222, -0.06, 0.035, 0.09, { shine: 20 }));
    return g;
  }
  for (const [x, y, z, s] of [[0.02, 0.135, 0.02, 1.2], [-0.05, 0.115, 0.05, 1], [0.03, 0.11, -0.06, 1.1], [0.08, 0.085, 0.03, 0.9], [-0.06, 0.1, -0.04, 0.85], [0.0, 0.08, 0.09, 0.8]] as const) {
    const crystal = mesh(new THREE.OctahedronGeometry(0.03 * s, 0), fleck, x, y, z, { shine: METAL, emissive: darker(fleck, 0.85) });
    crystal.rotation.set(x * 20, y * 30, z * 10);
    g.add(crystal);
  }
  return g;
}

function bar(metal: number): THREE.Group {
  // An ingot: narrower on top than at the base.
  const geo = B(0.24, 0.07, 0.1);
  const pos = geo.attributes.position as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) if (pos.getY(i) > 0) pos.setXYZ(i, pos.getX(i) * 0.82, pos.getY(i), pos.getZ(i) * 0.7);
  geo.computeVertexNormals();
  return group(mesh(geo, metal, 0, 0.035, 0, { shine: 70 }));
}

function plank(wood: number): THREE.Group {
  const g = new THREE.Group();
  for (const [y, z, r] of [[0.015, 0.0, 0.0], [0.045, 0.02, 0.12]] as const) {
    const board = group(mesh(B(0.46, 0.03, 0.1), wood));
    for (const k of [-0.025, 0.012, 0.03]) board.add(mesh(B(0.4, 0.002, 0.004), darker(wood, 0.25), 0.01, 0.016, k));
    g.add(place(board, 0, y, z, r));
  }
  return g;
}

// --- Food ---------------------------------------------------------------------

function fish(body: number, belly: number, len = 0.28, stripes: number | null = null, spots: number | null = null): THREE.Group {
  const r = len * 0.2;
  const torso = mesh(S(r, 14, 9), body, 0, r * 0.62, 0, { shine: 30 });
  torso.scale.set(2.3, 0.62, 1);
  const under = mesh(S(r * 0.92, 12, 7), belly, 0, r * 0.5, 0.0);
  under.scale.set(2.1, 0.5, 0.95);
  const tail = mesh(slab([[0.03, 0], [-len * 0.2, -len * 0.16], [-len * 0.15, 0], [-len * 0.2, len * 0.16]], 0.008, 0.003), darker(body, 0.15));
  const fin = mesh(slab([[-len * 0.12, 0], [len * 0.1, 0], [-len * 0.02, len * 0.09]], 0.004, 0.002), darker(body, 0.2));
  fin.geometry.rotateX(Math.PI / 2);
  const g = group(torso, under, place(tail, -len * 0.4, r * 0.45, 0), place(fin, 0, r * 1.15, 0));
  for (const s of [-1, 1]) g.add(mesh(S(r * 0.18, 7, 5), 0x111111, len * 0.33, r * 0.75, s * r * 0.6, { shine: 90 }));
  // Bands over the back, hugging the body.
  if (stripes !== null) {
    for (const x of [-0.18, 0, 0.18]) {
      const band = mesh(new THREE.TorusGeometry(r * 0.99, r * 0.07, 4, 14, Math.PI).rotateY(Math.PI / 2), stripes, x * len, r * 0.62, 0);
      band.scale.set(1, 0.62 * (1 - Math.abs(x)), 1 - Math.abs(x));
      g.add(band);
    }
  }
  if (spots !== null) for (const [x, z] of [[0.02, 0.6], [-0.04, -0.55], [0.06, -0.5], [-0.08, 0.5]]) g.add(mesh(S(r * 0.14, 6, 4), spots, x * len * 3, r * 0.95, z * r));
  return g;
}

/** A joint of meat on the bone, with a cap of fat over the top. */
function haunch(meat: number, fat: number, bone: number): THREE.Group {
  const flesh = mesh(lump(0.09, 9, 2), meat, 0, 0.055, 0);
  flesh.scale.set(1.45, 0.85, 1.05);
  const cap = mesh(new THREE.SphereGeometry(0.06, 12, 6, 0, Math.PI * 2, 0, Math.PI / 3), fat, -0.06, 0.075, -0.02);
  cap.scale.set(1.3, 0.9, 1.2);
  const g = group(flesh, cap, mesh(rod(0.016, 0.12, 7), bone, 0.15, 0.05, 0));
  for (const s of [-1, 1]) g.add(mesh(S(0.024, 8, 6), bone, 0.215, 0.05, s * 0.016));
  return g;
}

/** A hide pegged out flat, with patches of a second colour. */
function hide(base: number, patch: number, patches: readonly (readonly [number, number, number])[]): THREE.Group {
  const outline = [[-0.2, 0.1], [-0.12, 0.13], [-0.06, 0.1], [0.06, 0.11], [0.13, 0.14], [0.2, 0.09], [0.17, 0.0], [0.21, -0.1], [0.12, -0.13], [0.0, -0.1], [-0.12, -0.14], [-0.2, -0.1], [-0.17, 0.0]] as const;
  const g = group(mesh(slab(outline, 0.012, 0.005), base));
  for (const [x, z, r] of patches) {
    const p = mesh(C(r, r, 0.004, 9), patch, x, 0.02, z);
    p.scale.set(1.3, 1, 0.9);
    g.add(p);
  }
  return g;
}

// --- Herblore -----------------------------------------------------------------

const POTIONS: Record<string, number> = { attack: 0xe8a030, strength: 0xc8443a, devotion: 0x9fd4ff, defence: 0x4aa05a, ranging: 0x3aa8b0, fireward: 0xa050c8 };
const HERBS: Record<string, number> = { sunleaf: 0xe8c840, marshwort: 0x5a8a3a, duskroot: 0x6a3a6a, silverfern: 0xb8c8c8, hawkweed: 0x8aa83a, emberbloom: 0xd8402a };
const MUD = 0x5a4a2a;

function vial(liquid: number | null, level: number): THREE.Group {
  const g = new THREE.Group();
  if (liquid !== null && level > 0) {
    const h = 0.11 * level;
    g.add(mesh(C(0.05, 0.054, h, 14), liquid, 0, 0.004 + h / 2, 0, { emissive: darker(liquid, 0.6) }));
  }
  const glass = new THREE.LatheGeometry([[0.0, 0], [0.056, 0.002], [0.06, 0.03], [0.058, 0.1], [0.03, 0.13], [0.024, 0.15], [0.03, 0.16]].map(([x, y]) => new THREE.Vector2(x, y)), 16);
  g.add(mesh(glass, 0xdcf0f8, 0, 0, 0, { opacity: liquid === null ? 0.45 : 0.22, shine: 120, side: THREE.DoubleSide }));
  g.add(mesh(C(0.024, 0.021, 0.035, 10), 0x9a7448, 0, 0.165, 0));
  return g;
}

function herb(leaf: number, grimy: boolean): THREE.Group {
  const colour = grimy ? mix(leaf, MUD, 0.45) : leaf;
  const g = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.quadraticCurveTo(0.05, 0.035, 0.13, 0);
  shape.quadraticCurveTo(0.05, -0.035, 0, 0);
  const stem = grimy ? 0x4a3a22 : 0x4a6a22;
  g.add(mesh(rod(0.005, 0.2, 5), stem, -0.04, 0.006, 0));
  [[-0.1, 0.7], [-0.06, -0.6], [-0.02, 0.5], [0.02, -0.4], [0.06, 0]].forEach(([x, a], i) => {
    const l = mesh(slabOf(shape, 0.003, 0.002), i % 2 ? colour : lighter(colour, 0.08));
    g.add(place(l, x, 0.008 + i * 0.002, 0, a));
  });
  if (grimy) for (const [x, z] of [[-0.02, 0.03], [0.07, -0.02], [-0.07, -0.03], [0.1, 0.01]]) g.add(mesh(S(0.009, 5, 4), 0x3a2e18, x, 0.014, z));
  return g;
}

// --- Farming ------------------------------------------------------------------

const striped = (() => {
  let tex: THREE.CanvasTexture | null = null;
  return () => {
    if (tex) return tex;
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 8;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#3f8a2c';
    ctx.fillRect(0, 0, 64, 8);
    ctx.fillStyle = '#245c18';
    for (let i = 0; i < 8; i++) ctx.fillRect(i * 8 + 1, 0, 4, 8);
    tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.shared = true;
    return tex;
  };
})();

const PRODUCE: Record<string, () => THREE.Group> = {
  potato: () => {
    const g = group(mesh(lump(0.065, 5, 2), 0xa8804a, 0, 0.04, 0));
    g.children[0].scale.set(1.45, 1, 1);
    for (const [x, z] of [[0.03, 0.04], [-0.05, 0.03], [0.06, -0.03]]) g.add(mesh(S(0.007, 5, 4), 0x6a4a22, x, 0.07, z));
    return g;
  },
  baked_potato: () => {
    const g = PRODUCE.potato();
    (g.children[0] as THREE.Mesh).material = new THREE.MeshLambertMaterial({ color: 0x7a4a22 });
    g.add(mesh(B(0.08, 0.012, 0.03), 0xf4e8b0, 0, 0.082, 0), mesh(B(0.03, 0.012, 0.03), 0xffe060, 0.01, 0.092, 0));
    return g;
  },
  onion: () => {
    const bulb = mesh(new THREE.LatheGeometry([[0, 0], [0.04, 0.01], [0.065, 0.05], [0.05, 0.1], [0.012, 0.135], [0, 0.14]].map(([x, y]) => new THREE.Vector2(x, y)), 12), 0xd8b070);
    return group(bulb, mesh(new THREE.ConeGeometry(0.012, 0.07, 5), 0x8aa84a, 0, 0.17, 0), mesh(C(0.02, 0.01, 0.01, 6), 0xe8dcc0, 0, 0.004, 0));
  },
  cabbage: () => {
    const g = group(mesh(S(0.08, 12, 9), 0x9ad06a, 0, 0.085, 0));
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const leaf = mesh(new THREE.SphereGeometry(0.075, 10, 7, 0, Math.PI, 0, Math.PI / 2), i % 2 ? 0x6aa840 : 0x7ab84a, Math.cos(a) * 0.04, 0.05, Math.sin(a) * 0.04, { side: THREE.DoubleSide });
      leaf.rotation.set(Math.PI / 2 - 0.5, -a + Math.PI / 2, 0, 'YXZ');
      g.add(leaf);
    }
    return g;
  },
  tomato: () => {
    const t = mesh(S(0.06, 12, 9), 0xd8302a, 0, 0.05, 0, { shine: 60 });
    t.scale.set(1, 0.85, 1);
    const g = group(t);
    for (let i = 0; i < 5; i++) g.add(place(mesh(B(0.035, 0.004, 0.01), 0x4a8a3a, 0, 0, 0), 0, 0.1, 0, (i / 5) * Math.PI * 2).translateX(0.015));
    g.add(mesh(C(0.004, 0.005, 0.02, 5), 0x3a6a2a, 0, 0.11, 0));
    return g;
  },
  sweetcorn: () => {
    const g = group(mesh(rod(0.034, 0.22, 10, 0.026), 0xf0d040, 0, 0.034, 0));
    for (let i = 0; i < 6; i++) g.add(mesh(B(0.17, 0.002, 0.002), 0xc8a020, 0.01, 0.034 + Math.sin(i) * 0.033, Math.cos(i) * 0.033));
    for (const s of [-1, 1]) g.add(place(mesh(slab([[0, -0.02], [0.18, 0], [0, 0.02]], 0.003, 0.002), 0x8ab84a), -0.11, 0.03, s * 0.025, s * -0.35, 0, 0.15));
    return g;
  },
  cooked_sweetcorn: () => {
    const g = group(mesh(rod(0.034, 0.22, 10, 0.026), 0xe8a828, 0, 0.034, 0));
    for (let i = 0; i < 6; i++) g.add(mesh(B(0.17, 0.002, 0.002), 0xb07818, 0.01, 0.034 + Math.sin(i) * 0.033, Math.cos(i) * 0.033));
    g.add(mesh(S(0.012, 6, 4), 0x6a3a10, 0.04, 0.066, 0.0), mesh(S(0.01, 6, 4), 0x6a3a10, -0.05, 0.062, 0.01));
    return g;
  },
  strawberry: () => {
    const berry = mesh(new THREE.LatheGeometry([[0, 0], [0.03, 0.02], [0.046, 0.06], [0.04, 0.085], [0, 0.09]].map(([x, y]) => new THREE.Vector2(x, y)), 12), 0xe02a3a, 0, 0, 0, { shine: 60 });
    const g = group(berry);
    for (let i = 0; i < 9; i++) {
      const a = i * 2.4;
      const y = 0.02 + (i % 3) * 0.02;
      const r = 0.032 + (i % 3) * 0.006;
      g.add(mesh(S(0.004, 4, 3), 0xffe08a, Math.cos(a) * r, y, Math.sin(a) * r));
    }
    for (let i = 0; i < 5; i++) g.add(place(mesh(B(0.03, 0.004, 0.01), 0x4a8a3a), 0, 0.09, 0, (i / 5) * Math.PI * 2).translateX(0.015));
    const out = group(g);
    g.rotation.z = Math.PI / 2;
    g.position.y = 0.045;
    return out;
  },
  watermelon: () => {
    const m = mesh(S(0.13, 16, 10), 0xffffff, 0, 0.11, 0, { map: striped() });
    m.scale.set(1.35, 0.85, 1);
    return group(m, mesh(C(0.006, 0.008, 0.03, 5), 0x6a5a2a, 0.17, 0.12, 0));
  },
};

function seedPacket(crop: string): THREE.Group {
  const g = group(mesh(B(0.17, 0.012, 0.22), 0xe8dcbc, 0, 0.006, 0), mesh(B(0.17, 0.014, 0.04), 0xc8b48a, 0, 0.007, -0.09));
  const picture = PRODUCE[crop]();
  picture.scale.setScalar(0.65);
  picture.position.set(0, 0.012, 0.02);
  g.add(picture);
  g.rotation.y = Math.PI / 2;
  return group(g);
}

function herbSeeds(colour: number): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z, a] of [[0, 0, 0.3], [0.035, 0.02, 1.2], [-0.03, 0.025, 2.1], [0.01, -0.035, 0.8], [-0.035, -0.02, 2.6], [0.045, -0.025, 1.7]] as const) {
    const s = mesh(S(0.016, 7, 5), colour, x, 0.01, z);
    s.scale.set(1.4, 0.6, 0.9);
    s.rotation.y = a;
    g.add(s);
  }
  return g;
}

// --- Glyphcraft ---------------------------------------------------------------

/** Each glyph's mark, as an SVG path on a 36-unit square. */
const GLYPH_MARKS: Record<string, string> = {
  wind: 'M11 15 Q18 11 25 15 M11 19 Q18 15 25 19 M13 23 Q18 20 23 23',
  thought: 'M18 10 L18 26 M12 14 L24 22 M24 14 L12 22',
  tide: 'M10 20 Q14 14 18 20 Q22 26 26 20',
  root: 'M18 10 L18 20 M18 20 L12 26 M18 20 L24 26 M18 16 L14 13',
  ember: 'M18 9 Q24 15 21 22 Q19 26 18 27 Q13 23 15 17 Q17 20 18 18 Q16 13 18 9 Z',
  vigour: 'M18 26 Q10 20 12 14 Q15 11 18 15 Q21 11 24 14 Q26 20 18 26 Z',
  bloom: 'M18 26 L18 16 M18 16 Q12 14 13 9 Q18 10 18 16 Q18 10 23 9 Q24 14 18 16',
  star: 'M18 9 L20 16 L27 18 L20 20 L18 27 L16 20 L9 18 L16 16 Z',
  storm: 'M20 8 L13 19 L18 19 L15 28 L24 16 L19 16 Z',
  dusk: 'M22 10 Q12 12 13 19 Q14 26 23 26 Q16 23 16 18 Q16 13 22 10 Z',
  oath: 'M12 12 L24 12 L24 24 L12 24 Z M12 12 L24 24 M24 12 L12 24',
  crimson: 'M18 9 Q26 18 18 27 Q10 18 18 9 Z M18 14 L18 22',
};
const glyphFaces = new Map<string, THREE.CanvasTexture>();
function glyphFace(glyph: string): THREE.CanvasTexture {
  let tex = glyphFaces.get(glyph);
  if (tex) return tex;
  const c = document.createElement('canvas');
  c.width = c.height = 72;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#d8d0c0';
  ctx.fillRect(0, 0, 72, 72);
  ctx.scale(2, 2);
  ctx.strokeStyle = `#${GLYPH_COLOURS[glyph].toString(16).padStart(6, '0')}`;
  ctx.lineWidth = 2.6;
  ctx.lineCap = ctx.lineJoin = 'round';
  ctx.stroke(new Path2D(GLYPH_MARKS[glyph]));
  tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.userData.shared = true;
  glyphFaces.set(glyph, tex);
  return tex;
}

function glyphStone(glyph: string): THREE.Group {
  const g = new THREE.Group();
  for (const [x, z, r] of [[0.0, 0.0, 0.3], [0.09, -0.07, 1.4], [-0.08, -0.06, 2.6]] as const) {
    const stone = group(mesh(C(0.055, 0.06, 0.03, 14), 0xc8c0b0, 0, 0.015, 0));
    const face = mesh(new THREE.CircleGeometry(0.05, 14).rotateX(-Math.PI / 2), 0xffffff, 0, 0.0305, 0, { map: glyphFace(glyph), emissive: darker(GLYPH_COLOURS[glyph], 0.8) });
    face.geometry.rotateY(-Math.PI / 4);
    stone.add(face);
    g.add(place(stone, x, 0, z, r));
  }
  return g;
}

// --- Everything else ----------------------------------------------------------

function bones(color: number, k: number, fleck?: number): THREE.Group {
  const one = () => {
    const b = group(mesh(rod(0.016 * k, 0.2 * k, 7), color));
    for (const e of [-0.1 * k, 0.1 * k]) for (const s of [-1, 1]) b.add(mesh(S(0.022 * k, 7, 5), color, e, 0, s * 0.014 * k));
    if (fleck !== undefined) b.add(mesh(S(0.008 * k, 5, 4), fleck, 0.02, 0.014 * k, 0, { emissive: darker(fleck, 0.3) }));
    b.position.y = 0.024 * k;
    return b;
  };
  return group(place(one(), 0, 0, -0.025, 0.4), place(one(), 0.02, 0.008, 0.035, -0.6));
}

function coins(): THREE.Group {
  const g = new THREE.Group();
  const coin = (x: number, y: number, z: number, tx = 0, tz = 0) => {
    const c = group(mesh(C(0.04, 0.04, 0.01, 14), 0xf0c840, 0, 0, 0, { shine: 80 }), mesh(C(0.026, 0.026, 0.012, 12), 0xd8a828, 0, 0, 0, { shine: 80 }));
    g.add(place(c, x, y, z, 0, tx, tz));
  };
  coin(0, 0.005, 0);
  coin(0.07, 0.005, 0.03);
  coin(-0.05, 0.005, 0.06);
  coin(0.0, 0.015, 0.0);
  coin(0.03, 0.03, -0.01, 0.2, 0.1);
  coin(-0.065, 0.007, -0.04);
  coin(0.07, 0.012, -0.05, 0, 0.25);
  return g;
}

function sack(cloth: number, fill: number | null): THREE.Group {
  const body = mesh(new THREE.LatheGeometry([[0, 0], [0.09, 0.01], [0.11, 0.06], [0.1, 0.12], [0.05, 0.16], [0.03, 0.175]].map(([x, y]) => new THREE.Vector2(x, y)), 14), cloth);
  const g = group(body, mesh(new THREE.TorusGeometry(0.033, 0.008, 5, 12).rotateX(Math.PI / 2), darker(cloth, 0.35), 0, 0.172, 0));
  const top = mesh(new THREE.ConeGeometry(0.05, 0.05, 8).rotateX(Math.PI), cloth, 0, 0.205, 0);
  g.add(top);
  if (fill !== null) for (const [x, z] of [[0.02, 0.01], [-0.015, 0.015], [0.0, -0.02]]) g.add(mesh(S(0.012, 6, 4), fill, x, 0.2, z));
  return g;
}

const QUEST_ITEMS: Record<string, () => THREE.Group> = {
  sunspire_seal: () => {
    const g = group(mesh(C(0.1, 0.1, 0.022, 24), 0xe8b830, 0, 0.011, 0, { shine: 80 }), mesh(new THREE.TorusGeometry(0.075, 0.006, 5, 24).rotateX(Math.PI / 2), 0x9a7418, 0, 0.024, 0, { shine: 80 }));
    const star = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const r = i % 2 ? 0.024 : 0.06;
      const a = (i / 10) * Math.PI * 2;
      if (i) star.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      else star.moveTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    g.add(mesh(slabOf(star, 0.006, 0.002), 0xfff0a8, 0, 0.022, 0, { shine: 80, emissive: 0x3a3010 }));
    return g;
  },
  barrow_circlet: () => {
    const band = mesh(new THREE.TorusGeometry(0.1, 0.012, 6, 24).rotateX(Math.PI / 2), 0x7a8a4a, 0, 0.012, 0, { shine: METAL });
    const g = group(band);
    for (let i = 0; i < 5; i++) {
      const a = -Math.PI / 2 + (i - 2) * 0.45;
      const spike = place(mesh(new THREE.ConeGeometry(0.016, i === 2 ? 0.07 : 0.045, 4), 0x7a8a4a, 0, 0, 0, { shine: METAL }), Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1, 0, 0, 0);
      spike.rotation.set(Math.sin(a) * -1.2, 0, Math.cos(a) * 1.2);
      g.add(spike);
    }
    g.add(mesh(S(0.018, 9, 7), 0x5a7a9a, 0, 0.03, -0.1, { shine: 100, emissive: 0x101a2a }));
    return g;
  },
  lucky_lure: () => {
    const body = mesh(S(0.04, 12, 8), 0xd8a83a, 0, 0.02, 0, { shine: 90 });
    body.scale.set(2, 0.45, 1);
    const g = group(body, mesh(slab([[0, 0], [0.05, -0.035], [0.04, 0], [0.05, 0.035]], 0.006, 0.002), 0xc89a2a, -0.1, 0.017, 0, { shine: 90 }));
    g.add(mesh(S(0.009, 6, 5), 0x2a1a0a, 0.05, 0.03, 0.02), mesh(B(0.04, 0.003, 0.012), 0xf0d070, 0.0, 0.039, 0));
    g.add(mesh(horn([new THREE.Vector3(0.08, 0.02, 0), new THREE.Vector3(0.12, 0.02, 0), new THREE.Vector3(0.14, 0.02, 0.03), new THREE.Vector3(0.12, 0.02, 0.045)], 0.003, 0.002, 5), 0x8a8c92, 0, 0, 0, { shine: METAL }));
    return g;
  },
  tamsins_horn: () => {
    const g = group(mesh(horn([new THREE.Vector3(-0.15, 0.03, 0.05), new THREE.Vector3(-0.05, 0.035, -0.02), new THREE.Vector3(0.06, 0.035, -0.03), new THREE.Vector3(0.15, 0.03, 0.03)], 0.01, 0.045, 10), 0xc8a870));
    g.add(mesh(rod(0.013, 0.02, 8), 0x2a1a0a, -0.155, 0.03, 0.052), mesh(new THREE.TorusGeometry(0.028, 0.006, 5, 12).rotateY(Math.PI / 2), 0x8a6a3a, 0.02, 0.035, -0.033, { shine: METAL }));
    return g;
  },
  drake_scale: () => {
    const s = new THREE.Shape();
    s.moveTo(0, 0.12);
    s.quadraticCurveTo(0.11, 0.08, 0.1, -0.02);
    s.quadraticCurveTo(0.08, -0.1, 0, -0.13);
    s.quadraticCurveTo(-0.08, -0.1, -0.1, -0.02);
    s.quadraticCurveTo(-0.11, 0.08, 0, 0.12);
    const g = group(mesh(slabOf(s, 0.015, 0.008), 0x5a2018, 0, 0, 0, { shine: 60 }), mesh(slabOf(s, 0.004, 0).scale(0.75, 1, 0.75), 0x8a3018, 0, 0.022, 0, { shine: 60 }));
    g.add(mesh(B(0.006, 0.004, 0.17), 0xff8a2a, 0, 0.028, 0, { emissive: 0x8a3008 }));
    g.rotation.y = Math.PI / 2;
    return group(g);
  },
  contract_stone: () => {
    const g = group(mesh(slab([[-0.08, -0.11], [0.08, -0.11], [0.085, 0.08], [0.05, 0.11], [-0.05, 0.11], [-0.085, 0.08]], 0.03, 0.01), 0x8a8a84));
    for (let i = 0; i < 3; i++) g.add(mesh(B(i === 2 ? 0.07 : 0.11, 0.003, 0.01), 0x3a3a36, i === 2 ? -0.02 : 0, 0.042, -0.06 + i * 0.04));
    g.add(mesh(C(0.022, 0.024, 0.01, 12), 0xc8402a, 0.04, 0.045, 0.06, { shine: 50 }));
    g.rotation.y = Math.PI / 2;
    return group(g);
  },
  scent_mask: () => {
    const s = new THREE.Shape();
    s.moveTo(-0.12, 0.04);
    s.quadraticCurveTo(0, 0.08, 0.12, 0.04);
    s.quadraticCurveTo(0.12, -0.06, 0, -0.1);
    s.quadraticCurveTo(-0.12, -0.06, -0.12, 0.04);
    const g = group(mesh(slabOf(s, 0.02, 0.008), 0x6a7a4a));
    for (const x of [-0.05, 0.05]) {
      const eye = mesh(C(0.025, 0.025, 0.004, 10), 0x1a1a14, x, 0.038, -0.01);
      eye.scale.set(1.3, 1, 0.8);
      g.add(eye);
    }
    const snout = mesh(S(0.038, 9, 6), 0x8a9a64, 0, 0.03, 0.055);
    snout.scale.set(1, 0.8, 1);
    g.add(snout, mesh(rod(0.004, 0.3), 0x5a3e22, 0, 0.01, -0.03));
    g.rotation.y = Math.PI / 2;
    return group(g);
  },
  salt_sack: () => sack(0xe8e2d0, 0xffffff),
  bolt_of_cloth: () => {
    const g = group(mesh(rod(0.06, 0.3, 14), 0xd8c8a0, 0, 0.06, 0), mesh(B(0.3, 0.004, 0.18), 0xc8b48a, 0, 0.003, 0.09));
    for (const s of [-1, 1]) g.add(mesh(new THREE.CircleGeometry(0.06, 14).rotateY((s * Math.PI) / 2), 0xbfa878, s * 0.151, 0.06, 0), mesh(new THREE.RingGeometry(0.02, 0.026, 12).rotateY((s * Math.PI) / 2), 0x8a7650, s * 0.152, 0.06, 0));
    return g;
  },
  limestone_brick: () => {
    const g = group(mesh(B(0.24, 0.09, 0.12), 0xe4dcc2, 0, 0.045, 0));
    for (const [x, z] of [[0.05, 0.061], [-0.07, 0.061], [0.0, -0.061]]) g.add(mesh(S(0.008, 5, 4), 0xa89e80, x, 0.05, z));
    return g;
  },
  steel_nails: () =>
    bundle(() => group(mesh(rod(0.005, 0.12, 6), 0xc4ccd6, 0, 0.006, 0, { shine: METAL }), mesh(C(0.012, 0.012, 0.004, 8).rotateZ(Math.PI / 2), 0xb0b8c2, -0.061, 0.006, 0, { shine: METAL }), place(mesh(new THREE.ConeGeometry(0.005, 0.015, 6), 0xc4ccd6, 0, 0, 0, { shine: METAL }), 0.067, 0.006, 0, 0, 0, -Math.PI / 2)), [[0, -0.03, 0.3], [0.02, 0.01, -0.2], [-0.01, 0.04, 0.6], [0.01, -0.005, 1.3]]),
  saw: () => {
    const g = group(mesh(slab([[-0.08, 0.05], [0.24, 0.025], [0.24, -0.01], [-0.08, -0.05]], 0.004, 0.002), 0xc0c8d0, 0, 0, 0, { shine: METAL }));
    for (let i = 0; i < 12; i++) {
      const x = -0.07 + i * 0.026;
      g.add(mesh(slab([[x, 0], [x + 0.013, 0.012], [x + 0.026, 0]], 0.004, 0.0), 0x8a9098, 0, 0, 0.0 - (-0.05 + (x + 0.08) * 0.125) - 0.01, { shine: METAL }));
    }
    g.add(mesh(slab([[-0.17, 0.06], [-0.08, 0.06], [-0.08, -0.06], [-0.17, -0.06]], 0.03, 0.01), WOOD, 0, 0, 0), mesh(C(0.016, 0.016, 0.05, 10), 0x2a1a0c, -0.125, 0.0, 0));
    g.rotation.y = Math.PI;
    return group(g);
  },
  tinderbox: () => {
    const g = group(mesh(B(0.14, 0.05, 0.09), 0x7a5230, 0, 0.025, 0), mesh(B(0.146, 0.015, 0.096), 0x5a3a20, 0, 0.055, 0));
    g.add(mesh(B(0.04, 0.008, 0.02), 0xc8a040, 0, 0.065, 0.048, { shine: METAL }));
    // Flint and steel set beside it.
    g.add(mesh(lump(0.022, 4), 0x9aa0a8, 0.11, 0.015, 0.04), mesh(slab([[0, 0], [0.06, 0], [0.06, 0.02], [0, 0.02]], 0.006, 0.002), 0x55575c, 0.09, 0, -0.05, { shine: METAL }));
    return g;
  },
  ashes: () => {
    const heap = mesh(new THREE.SphereGeometry(0.15, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0x8a8580);
    heap.scale.set(1, 0.32, 1);
    const g = group(heap);
    for (const [x, z, k] of [[0.05, 0.02, 1], [-0.04, -0.04, 0.8], [0.0, 0.07, 0.7]]) g.add(mesh(lump(0.02 * k, x * 30), 0x2a2420, x, 0.03, z));
    for (const [x, z] of [[-0.06, 0.05], [0.07, -0.05]]) g.add(mesh(S(0.012, 6, 4), 0xc8c4bc, x, 0.025, z));
    return g;
  },
  bowstring: () => {
    const g = new THREE.Group();
    for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(0.075 - i * 0.008, 0.004, 4, 24).rotateX(Math.PI / 2), 0xece6d2, i * 0.008, 0.005 + i * 0.006, i * 0.004));
    g.add(mesh(rod(0.004, 0.09), 0xece6d2, 0.11, 0.005, 0.0));
    return g;
  },
  fishing_bait: () => {
    const pot = mesh(C(0.07, 0.06, 0.08, 14), 0x8a6a46, 0, 0.04, 0);
    const g = group(pot, mesh(C(0.064, 0.064, 0.004, 14), 0x4a3018, 0, 0.081, 0));
    for (let i = 0; i < 3; i++) g.add(place(mesh(new THREE.TorusGeometry(0.022, 0.006, 5, 10, Math.PI * 1.2), 0xd98a8a), -0.02 + i * 0.02, 0.085, -0.01 + (i % 2) * 0.02, i, Math.PI / 2 - 0.4));
    return g;
  },
  small_net: () => {
    const g = group(mesh(rod(0.013, 0.24, 7), WOOD, -0.18, 0.013, 0));
    g.add(mesh(new THREE.TorusGeometry(0.1, 0.008, 5, 24).rotateX(Math.PI / 2), 0x6a4a2a, 0.04, 0.012, 0));
    // Mesh of cord across the hoop.
    for (let i = -3; i <= 3; i++) {
      const k = Math.sqrt(1 - (i / 3.6) ** 2) * 0.2;
      g.add(mesh(rod(0.0018, k, 3), 0xd8cfb4, 0.04, 0.012, i * 0.026));
      g.add(mesh(rod(0.0018, k, 3).rotateY(Math.PI / 2), 0xd8cfb4, 0.04 + i * 0.026, 0.012, 0));
    }
    return g;
  },
  fishing_rod: () => {
    const g = group(mesh(rod(0.005, 0.72, 6, 0.014), 0x7a5230, 0, 0.014, 0));
    g.add(mesh(rod(0.017, 0.12, 7), LEATHER, -0.29, 0.017, 0));
    g.add(mesh(C(0.03, 0.03, 0.022, 12), 0x55575c, -0.2, 0.03, 0.024, { shine: METAL }));
    g.add(mesh(rod(0.001, 0.5, 3), 0xe8e8e8, 0.13, 0.016, 0.006).rotateY(-0.02));
    g.add(mesh(S(0.012, 7, 5), 0xd83a2a, 0.36, 0.012, 0.05));
    return g;
  },
  rake: () => {
    const g = group(haft(0.62, 0.012, 0x8a6a42));
    g.add(mesh(B(0.03, 0.025, 0.24), 0x6c6e74, 0.31, 0.015, 0, { shine: METAL }));
    for (let i = 0; i < 6; i++) g.add(mesh(rod(0.004, 0.05, 4), 0x6c6e74, 0.34, 0.008, -0.1 + i * 0.04, { shine: METAL }));
    return g;
  },
  spade: () => {
    const g = group(haft(0.52, 0.014, 0x8a6a42), mesh(rod(0.008, 0.08, 4).rotateY(Math.PI / 2), 0x8a6a42, -0.27, 0.014, 0));
    g.add(mesh(slab([[0, -0.06], [0.11, -0.055], [0.16, 0], [0.11, 0.055], [0, 0.06]], 0.008, 0.004), 0x8a8c92, 0.25, 0.004, 0, { shine: METAL }));
    return g;
  },
  seed_dibber: () => {
    const g = group(mesh(rod(0.014, 0.14, 7, 0.011), 0x8a6a42, 0.02, 0.014, 0), place(mesh(new THREE.ConeGeometry(0.011, 0.05, 7), 0x8a6a42), 0.115, 0.014, 0, 0, 0, -Math.PI / 2));
    g.add(mesh(rod(0.01, 0.09, 6).rotateY(Math.PI / 2), 0x6a4a2a, -0.06, 0.014, 0));
    return g;
  },
};

function bucket(fill: number | null): THREE.Group {
  const g = group(mesh(new THREE.CylinderGeometry(0.095, 0.08, 0.16, 16, 1, true), 0x8a6240, 0, 0.08, 0, { side: THREE.DoubleSide }));
  g.add(mesh(C(0.08, 0.08, 0.008, 16), 0x5a3e24, 0, 0.004, 0));
  for (const y of [0.03, 0.13]) g.add(mesh(new THREE.TorusGeometry(0.09 + (y - 0.03) * 0.06, 0.005, 4, 18).rotateX(Math.PI / 2), 0x55575c, 0, y, 0, { shine: METAL }));
  g.add(place(mesh(new THREE.TorusGeometry(0.09, 0.004, 4, 16, Math.PI), 0x55575c, 0, 0, 0, { shine: METAL }), 0, 0.16, 0, 0, -0.9));
  if (fill !== null) g.add(mesh(C(0.09, 0.09, 0.01, 16), fill, 0, 0.13, 0));
  return g;
}

// --- The catalogue ------------------------------------------------------------

function build(itemId: string): THREE.Group | null {
  const first = itemId.split('_')[0];
  const glyph = /^(\w+)_glyph$/.exec(itemId)?.[1];
  const quest = QUEST_ITEMS[itemId];
  if (quest) return quest();
  if (PRODUCE[itemId]) return PRODUCE[itemId]();
  if (itemId === 'coins') return coins();
  if (itemId.endsWith('_pickaxe')) return pickaxe(metalOf(itemId));
  if (itemId.endsWith('_axe')) return axe(metalOf(itemId));
  if (itemId === 'hammer') return hammer(0x6c6e74);
  if (itemId === 'rock_hammer') return hammer(0x7d7f86, true);
  if (itemId === 'knife') return knife();
  if (itemId.endsWith('logs')) {
    const [bark, wood] = ({ logs: [0x6b4a2b, 0xd9b47c], ashwood_logs: [0x8d857c, 0xece3d2], oak_logs: [0x5e3f24, 0xd6a765], willow_logs: [0x6f5a3a, 0xe0c796], yew_logs: [0x3f2b1a, 0xb08a5c], starwood_logs: [0xd8d0c0, 0xcdf6ef] } as Record<string, [number, number]>)[itemId] ?? [0x6b4a2b, 0xd9b47c];
    return logs(bark, wood, itemId === 'starwood_logs');
  }
  if (itemId === 'coal') return ore(null);
  if (itemId.endsWith('_ore')) return ore(({ copper: 0xd07a3a, tin: 0xd4d8e0, iron: 0x9a5238, gold: 0xf0c840, cobalt: 0x3a5ad0, verdite: 0x2f8a5a, glacite: 0x8fe0ff } as Record<string, number>)[first] ?? 0xcccccc);
  if (itemId.endsWith('_bar')) return bar(metalOf(itemId));
  if (itemId.endsWith('_plank') || itemId === 'plank') return plank(({ oak: 0xa8783e, yew: 0xb0603a } as Record<string, number>)[first] ?? 0xc89a5e);
  if (itemId.endsWith('_dagger')) return blade(metalOf(itemId), 0.2);
  if (itemId.endsWith('_sword')) return blade(metalOf(itemId), 0.4);
  if (itemId === 'cinder_blade') return blade(0x4a1a14, 0.42, { edge: 0xff7a1a, pommel: 0x2a1a14, guard: 0.085 });
  if (itemId === 'duskfang') return blade(0xe2d6be, 0.3, { curve: true, pommel: 0x3a2a40, guard: 0.05, width: 0.03 });
  if (itemId.endsWith('_helm')) return itemId === 'bounty_helm' ? helm(0x4a4a50, 0xc8402a) : helm(metalOf(itemId));
  if (itemId.endsWith('_chainbody')) return chainbody(metalOf(itemId));
  if (itemId.endsWith('_platelegs')) return platelegs(metalOf(itemId));
  if (itemId === 'drakescale_shield') {
    return kiteShield(0xa8401e, 0x5a1e14, 0x3a120c, (g) => {
      for (let i = 0; i < 3; i++) g.add(mesh(new THREE.TorusGeometry(0.07, 0.005, 4, 12, Math.PI).rotateX(-Math.PI / 2), 0x5a1e14, 0, 0.036, -0.08 + i * 0.065));
    });
  }
  if (itemId === 'polished_shield') return kiteShield(0xf4f8fc, 0x9aa6b2, 0xe8eef4);
  if (itemId.endsWith('_shield')) return kiteShield(metalOf(itemId), darker(metalOf(itemId), 0.35), lighter(metalOf(itemId), 0.2));
  if (itemId.endsWith('staff')) {
    const orb = ({ wind: 0xe8f6ff, tide: 0x3d8bff, root: 0x7aa840, ember: 0xff6a1a } as Record<string, number>)[first];
    return staff(orb ?? null);
  }
  if (/^(wizard|starweave)_/.test(itemId)) {
    const [cloth, trim] = first === 'wizard' ? [0x2b3f9e, 0xd8dcf0] : [0x4b2a7a, 0xe0c060];
    const stars = first === 'starweave';
    if (itemId.endsWith('_hat')) return wizardHat(cloth, trim, stars);
    if (itemId.endsWith('_robe')) return robe(cloth, trim, stars);
    return skirt(cloth, trim);
  }
  if (/(short|long)bow/.test(itemId)) {
    const wood = ({ oak: 0xa87a44, willow: 0xc2a265, yew: 0x7a3f22, gloamwood: 0x4a3a6a } as Record<string, number>)[first] ?? 0x8a5a2e;
    return bow(wood, itemId.includes('longbow'), !itemId.endsWith('_u'));
  }
  if (itemId === 'arrow_shaft') return bundle(() => arrow(null, null), FAN);
  if (itemId === 'headless_arrow') return bundle(() => arrow(null), FAN);
  if (itemId.endsWith('_arrow')) return bundle(() => arrow(metalOf(itemId)), FAN);
  if (itemId.endsWith('_arrowheads')) return group(...[[0, 0, 0.3], [0.05, 0.04, 2.2], [-0.045, 0.035, 4.0]].map(([x, z, r]) => place(arrowhead(metalOf(itemId)), x, 0, z, r)));
  if (itemId === 'feathers' || itemId === 'crimson_feathers') {
    const color = itemId === 'feathers' ? 0xe4e0d8 : 0xc8262a;
    return group(place(feather(color), 0, 0, -0.02, 0.2), place(feather(lighter(color, 0.12)), 0.02, 0.006, 0.03, -0.25));
  }
  if (itemId === 'lizard_scales') {
    return group(...[[0, 0, 0.3, 0xd8b050], [0.06, 0.04, 1.4, 0xe8c860], [-0.05, 0.05, 2.5, 0xc8a040]].map(([x, z, r, c]) => {
      const s = mesh(C(0.04, 0.04, 0.008, 10), c, 0, 0.006, 0, { shine: 50 });
      s.scale.set(1.3, 1, 0.9);
      return place(group(s), x, 0, z, r);
    }));
  }
  if (/minnows|perch|pike|fish/.test(itemId)) {
    const raw = itemId.startsWith('raw');
    if (itemId === 'burnt_fish') return fish(0x2a2420, 0x3d3530);
    if (itemId.endsWith('minnows')) {
      const one = () => fish(raw ? 0x8fa9b8 : 0xc99a52, raw ? 0xdfe8ee : 0xf0d6a0, 0.15);
      return group(place(one(), 0, 0, -0.03, 0.3), place(one(), 0.02, 0, 0.04, -0.4), place(one(), -0.06, 0, 0.01, 2.8));
    }
    if (itemId.endsWith('perch')) return fish(raw ? 0x8aa04a : 0xb88442, raw ? 0xe8e0a0 : 0xf0d0a0, 0.26, raw ? 0x3d4a20 : 0x6a4a20);
    return fish(raw ? 0x5f7f52 : 0xa8743a, raw ? 0xd8e0b8 : 0xecc890, 0.38, null, raw ? 0xe8f0c8 : null);
  }
  if (itemId === 'raw_beef') return haunch(0xc23a44, 0xf0d0c4, 0xf4eee4);
  if (itemId === 'beef') return haunch(0x8a4a24, 0xb87838, 0xe8d8b8);
  if (itemId === 'burnt_meat') return haunch(0x2a2018, 0x3a2c22, 0x4a4238);
  if (itemId === 'cowhide') return hide(0xf0ece2, 0x2a2420, [[-0.08, 0.05, 0.04], [0.08, -0.04, 0.05], [-0.1, -0.07, 0.025], [0.12, 0.07, 0.02]]);
  if (itemId === 'wolf_pelt') return hide(0x9aa0a6, 0xe0e4e8, [[0, 0, 0.05], [0.08, 0.02, 0.03], [-0.08, -0.02, 0.03]]);
  const herbName = itemId.replace('grimy_', '');
  if (HERBS[herbName]) return herb(HERBS[herbName], itemId.startsWith('grimy'));
  if (itemId === 'vial') return vial(null, 0);
  if (itemId === 'vial_of_water') return vial(0x9fc8e8, 0.75);
  if (itemId === 'plant_cure') return vial(0x6ad84a, 0.8);
  const unf = /^(\w+)_potion_unf$/.exec(itemId)?.[1];
  if (unf && HERBS[unf]) return vial(mix(HERBS[unf], 0x9ab88a, 0.5), 0.85);
  const potion = /^(\w+)_potion(\d)$/.exec(itemId);
  if (potion && POTIONS[potion[1]]) return vial(POTIONS[potion[1]], Number(potion[2]) / 3.3);
  if (itemId === 'bones') return bones(0xece4cc, 1);
  if (itemId === 'big_bones') return bones(0xe0d6b8, 1.3);
  if (itemId === 'hart_bones') return bones(0xa8a0c0, 1.3, 0xc8b8ff);
  if (itemId === 'drake_bones') return bones(0x5a4a40, 1.3, 0xf08a32);
  if (itemId === 'hart_antler') {
    const tine = (pts: [number, number, number][], r0: number) => mesh(horn(pts.map(([x, y, z]) => new THREE.Vector3(x, y, z)), r0, 0.004, 7), 0xd8d0f0);
    return group(
      tine([[-0.18, 0.02, 0.02], [-0.05, 0.025, -0.01], [0.08, 0.025, 0.02], [0.18, 0.02, 0.08]], 0.018),
      tine([[-0.08, 0.025, -0.005], [-0.04, 0.025, -0.07], [0.0, 0.02, -0.11]], 0.01),
      tine([[0.04, 0.025, 0.008], [0.08, 0.025, -0.05], [0.13, 0.02, -0.08]], 0.009),
      tine([[0.12, 0.022, 0.04], [0.16, 0.022, 0.0]], 0.007),
    );
  }
  if (itemId === 'cow_horn' || itemId === 'scorpion_stinger') {
    const stinger = itemId === 'scorpion_stinger';
    const g = group(mesh(horn([new THREE.Vector3(-0.12, 0.03, 0.03), new THREE.Vector3(0.0, 0.03, -0.02), new THREE.Vector3(0.1, 0.03, 0.03), new THREE.Vector3(0.13, 0.03, 0.08)], stinger ? 0.025 : 0.032, 0.003, 9), stinger ? 0x8a5a2a : 0xe8dcbc, 0, 0, 0, { shine: 40 }));
    if (stinger) g.add(mesh(S(0.03, 9, 7), 0x6a4020, -0.13, 0.03, 0.03, { shine: 40 }));
    else g.add(mesh(new THREE.CircleGeometry(0.031, 9).rotateY(-Math.PI / 2 - 0.4), 0x5a4a2a, -0.121, 0.03, 0.03));
    return g;
  }
  if (itemId === 'spirit_dust') {
    const heap = mesh(new THREE.SphereGeometry(0.12, 12, 6, 0, Math.PI * 2, 0, Math.PI / 2), 0xdfe6f0, 0, 0, 0, { emissive: 0x2a3040 });
    heap.scale.set(1, 0.35, 1);
    return group(heap, ...[[0.03, 0.05, 0.02], [-0.04, 0.04, -0.03], [0.01, 0.06, -0.05]].map(([x, y, z]) => mesh(S(0.008, 5, 4), 0xffffff, x, y, z, { emissive: 0x8a9ab0 })));
  }
  if (itemId === 'aether_shard') {
    const shard = mesh(new THREE.OctahedronGeometry(0.06, 0).scale(1.7, 0.7, 0.8), 0xcfe8ff, 0, 0.04, 0, { emissive: 0x2a4a7a, shine: 100 });
    return group(shard, mesh(new THREE.OctahedronGeometry(0.03, 0).scale(1.6, 0.7, 0.8), 0xb8d8ff, 0.08, 0.02, 0.05, { emissive: 0x2a4a7a, shine: 100 }));
  }
  if (glyph && GLYPH_COLOURS[glyph] !== undefined) return glyphStone(glyph);
  if (itemId === 'bucket') return bucket(null);
  if (itemId === 'compost') return bucket(0x3a2a1a);
  const seed = /^(\w+)_seed$/.exec(itemId)?.[1];
  if (seed && PRODUCE[seed]) return seedPacket(seed);
  if (seed && HERBS[seed]) return herbSeeds(mix(HERBS[seed], MUD, 0.45));
  return null;
}

/** The model for an item; anything without one of its own is a plain sack. */
export function buildItemModel(itemId: string): THREE.Group {
  const g = build(itemId) ?? sack(0xa08454, null);
  g.traverse((o) => {
    o.castShadow = true;
    o.receiveShadow = true;
  });
  return g;
}

/** How wide (at least) an item lies on the ground, in tiles. */
const GROUND_SPAN = 0.5;

/**
 * The model as it lies on the ground: small things are drawn larger, so a
 * pinch of seeds or a few arrowheads can still be seen and clicked from
 * the camera's height.
 */
export function buildGroundItem(itemId: string): THREE.Group {
  const model = buildItemModel(itemId);
  const size = new THREE.Box3().setFromObject(model).getSize(new THREE.Vector3());
  model.scale.setScalar(THREE.MathUtils.clamp(GROUND_SPAN / Math.max(size.x, size.z), 1, 2.5));
  return group(model);
}
