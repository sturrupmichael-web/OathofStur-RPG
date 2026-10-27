import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { shared } from './dispose';
import brineSlugGlb from './models/brine_slug.glb?inline';
import caveCreeperGlb from './models/cave_creeper.glb?inline';
import cowGlb from './models/cow.glb?inline';
import crimsonSwiftGlb from './models/crimson_swift.glb?inline';
import desertLizardGlb from './models/desert_lizard.glb?inline';
import drakeGlb from './models/cinder_drake.glb?inline';
import glareLizardGlb from './models/glare_lizard.glb?inline';
import gloomBatGlb from './models/gloom_bat.glb?inline';
import rockmawGlb from './models/rockmaw.glb?inline';
import scorpionGlb from './models/scorpion.glb?inline';
import type { CreatureKind, CreatureRig } from './creatures';

/**
 * Sculpted models made with an AI generator (Tripo), shown in place of a
 * creature's built-in meshes. The models come with no skeleton, so each is
 * skinned to the creature's own pivots here: every vertex follows the
 * nearest parts of the built-in model, and the creature's existing walk,
 * attacks and death drive it unchanged.
 *
 * Add #classic to the page address to see the built-in models instead.
 */

interface Source {
  url: string;
  /** Tips, turns, scales and moves the model onto the built-in one (which faces +z). */
  pitch?: number;
  yaw: number;
  scale: number;
  offset: [number, number, number];
  /** A vertex above this height and out to the side of a wing's root is wing, not body. */
  wingAbove?: number;
  /** How far out past a wing's root the wing starts. */
  wingOut?: number;
  /** Keeps the built-in wings (for a model made with its wings folded). */
  keepWings?: boolean;
}

const SOURCES: Partial<Record<CreatureKind, Source>> = {
  // Each was laid over its built-in model by eye in the gallery.
  cinder_drake: { url: drakeGlb, yaw: -Math.PI / 2, scale: 4, offset: [0, 0, -0.65], wingAbove: 1.6 },
  cow: { url: cowGlb, yaw: Math.PI / 2, scale: 1.35, offset: [0, 0, 0.05] },
  desert_lizard: { url: desertLizardGlb, yaw: Math.PI / 2, scale: 1, offset: [0, 0, -0.1] },
  scorpion: { url: scorpionGlb, yaw: Math.PI / 2, scale: 0.8, offset: [0, 0, 0.1] },
  cave_creeper: { url: caveCreeperGlb, yaw: 0, scale: 1.1, offset: [0, 0, -0.18] },
  // Modelled perched with its wings folded: laid level, and it flies on the built-in wings.
  crimson_swift: { url: crimsonSwiftGlb, pitch: 0.8, yaw: 0, scale: 0.5, offset: [0, 0.8, -0.12], keepWings: true },
  brine_slug: { url: brineSlugGlb, yaw: 0, scale: 0.8, offset: [0, 0, -0.1] },
  // Modelled upright with its wings spread; tipped forward into flight.
  gloom_bat: { url: gloomBatGlb, pitch: Math.PI / 2, yaw: 0, scale: 1.1, offset: [0, 1.1, -0.4], wingAbove: 0, wingOut: 0.12 },
  rockmaw: { url: rockmawGlb, yaw: 0, scale: 0.8, offset: [0, 0, 0] },
  glare_lizard: { url: glareLizardGlb, yaw: 0, scale: 1.5, offset: [0, 0, -0.2] },
};

/** A model ready to skin onto any rig of its kind. */
interface Prepared {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Each pivot's rest pose, inverted, relative to the creature's root. */
  inverses: THREE.Matrix4[];
  /** Where fire leaves the mouth, in the head's space. */
  mouth: THREE.Vector3 | null;
}

const ready = new Map<CreatureKind, Prepared>();
const loading = new Set<CreatureKind>();
/** Rigs built before their model loaded, with the built-in meshes to hide once it has. */
const waiting = new Set<{ rig: CreatureRig; parts: THREE.Mesh[] }>();
let builder: ((kind: CreatureKind, seed: number) => CreatureRig) | null = null;
let rest: ((rig: CreatureRig) => void) | null = null;

export const aiModelsEnabled = typeof location === 'undefined' || !/classic/.test(location.hash);

/**
 * Sets how to make a fresh built-in rig (`build`) and put it in its resting
 * pose (`pose`), which is the pose each model is bound in.
 */
export function loadAiModels(build: (kind: CreatureKind, seed: number) => CreatureRig, pose: (rig: CreatureRig) => void): void {
  builder = build;
  rest = pose;
}

/** Loads one kind's model, the first time a creature of that kind appears. */
function load(kind: CreatureKind): void {
  const src = SOURCES[kind];
  if (!src || loading.has(kind)) return;
  loading.add(kind);
  new GLTFLoader().load(
    src.url,
    (gltf) => {
      ready.set(kind, prepare(kind, src, gltf.scene));
      for (const w of [...waiting]) {
        if (w.rig.kind !== kind) continue;
        attach(w.rig, w.parts);
        waiting.delete(w);
      }
    },
    undefined,
    (err) => console.warn(`AI model for ${kind} failed to load; keeping the built-in one`, err),
  );
}

export function hasAiModel(kind: CreatureKind): boolean {
  return aiModelsEnabled && !!SOURCES[kind];
}

/** Puts the AI model on a freshly built rig, now or as soon as it loads. */
export function applyAiModel(rig: CreatureRig): void {
  if (!aiModelsEnabled || !SOURCES[rig.kind]) return;
  const parts: THREE.Mesh[] = [];
  rig.root.traverse((o) => o instanceof THREE.Mesh && parts.push(o));
  if (ready.has(rig.kind)) attach(rig, parts);
  else {
    waiting.add({ rig, parts });
    load(rig.kind);
  }
}

/** The rig's pivots, in a fixed order every rig of a kind shares. */
function bones(rig: CreatureRig): THREE.Object3D[] {
  const out: THREE.Object3D[] = [];
  rig.root.traverse((o) => o instanceof THREE.Group && o !== rig.root && out.push(o));
  return out;
}

function isWithin(o: THREE.Object3D, ancestor: THREE.Object3D): boolean {
  for (let p: THREE.Object3D | null = o; p; p = p.parent) if (p === ancestor) return true;
  return false;
}

function attach(rig: CreatureRig, parts: THREE.Mesh[]): void {
  const p = ready.get(rig.kind)!;
  const mesh = new THREE.SkinnedMesh(p.geometry, p.material);
  mesh.castShadow = true;
  mesh.frustumCulled = false;
  rig.root.add(mesh);
  mesh.bind(new THREE.Skeleton(bones(rig) as THREE.Bone[], p.inverses.map((m) => m.clone())), new THREE.Matrix4());
  const src = SOURCES[rig.kind]!;
  for (const part of parts) if (!(src.keepWings && rig.arms.some((w) => isWithin(part, w)))) part.visible = false;
  if (p.mouth && rig.mouth) rig.mouth.position.copy(p.mouth);
}

function prepare(kind: CreatureKind, src: Source, scene: THREE.Object3D): Prepared {
  // One mesh, laid onto the built-in model.
  let found: THREE.Mesh | null = null;
  scene.traverse((o) => o instanceof THREE.Mesh && !found && (found = o));
  const source = found as unknown as THREE.Mesh;
  const geometry = source.geometry.clone();
  source.updateWorldMatrix(true, false);
  geometry.applyMatrix4(source.matrixWorld);
  geometry.rotateX(src.pitch ?? 0).rotateY(src.yaw).scale(src.scale, src.scale, src.scale).translate(...src.offset);
  if (!geometry.attributes.normal) geometry.computeVertexNormals();
  const map = (source.material as THREE.MeshStandardMaterial).map;
  // Matte, like everything else in the world.
  const material = shared(new THREE.MeshLambertMaterial({ map, color: map ? 0xffffff : 0x3a1a14 }));
  shared(geometry);

  // The built-in model in its resting pose, measured from its root.
  const ref = builder!(kind, 0);
  rest!(ref);
  ref.root.updateMatrixWorld(true);
  const pivots = bones(ref);
  const index = new Map(pivots.map((b, i) => [b, i]));
  const inverses = pivots.map((b) => b.matrixWorld.clone().invert());

  // Sample points over each pivot's own meshes.
  const pts: number[] = [];
  const owner: number[] = [];
  const v = new THREE.Vector3();
  for (const [i, b] of pivots.entries()) {
    for (const child of b.children) {
      if (!(child instanceof THREE.Mesh)) continue;
      const pos = child.geometry.attributes.position;
      const step = Math.max(1, Math.floor(pos.count / 40));
      for (let k = 0; k < pos.count; k += step) {
        v.fromBufferAttribute(pos, k).applyMatrix4(child.matrixWorld);
        pts.push(v.x, v.y, v.z);
        owner.push(i);
      }
    }
  }

  // Wings are raised on the model but folded on the built-in rig, so they're picked by place, not distance.
  // (Arms are pincers on some creatures, which the nearest-part rule handles.)
  const wings = src.wingAbove === undefined && !src.keepWings ? [] : ref.arms.map((w) => index.get(w)!);
  const wingRoot = ref.arms.map((w) => w.getWorldPosition(new THREE.Vector3()));
  const torso = index.get(ref.torso)!;

  const pos = geometry.attributes.position;
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const best = new Map<number, number>();
  for (let n = 0; n < pos.count; n++) {
    v.fromBufferAttribute(pos, n);
    best.clear();
    const out = src.wingOut ?? 0.05;
    const wing = src.wingAbove !== undefined && v.y > src.wingAbove ? wingRoot.findIndex((w) => Math.sign(w.x) === Math.sign(v.x) && Math.abs(v.x) > Math.abs(w.x) + out) : -1;
    if (wing >= 0) {
      // Fully the wing's out along it, shared with the shoulders near its root.
      const k = THREE.MathUtils.smoothstep(Math.abs(v.x) - Math.abs(wingRoot[wing].x), out, out + 0.3);
      skinIndex.set([wings[wing], torso, 0, 0], n * 4);
      skinWeight.set([k, 1 - k, 0, 0], n * 4);
      continue;
    }
    // Otherwise the nearest few pivots, the closest weighted most.
    for (let k = 0; k < owner.length; k++) {
      const b = owner[k];
      if (wings.includes(b)) continue;
      const dx = pts[k * 3] - v.x, dy = pts[k * 3 + 1] - v.y, dz = pts[k * 3 + 2] - v.z;
      const d = dx * dx + dy * dy + dz * dz;
      if (d < (best.get(b) ?? Infinity)) best.set(b, d);
    }
    const top = [...best.entries()].sort((a, b) => a[1] - b[1]).slice(0, 3);
    const nearest = Math.sqrt(top[0][1]);
    const w = top.map(([, d]) => Math.max(0, 1 - (Math.sqrt(d) - nearest) / 0.12) ** 2);
    const sum = w.reduce((a, b) => a + b, 0);
    top.forEach(([b], k) => {
      skinIndex[n * 4 + k] = b;
      skinWeight[n * 4 + k] = w[k] / sum;
    });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));

  // The mouth: the front-most point of the head, a little in from the tip.
  let mouth: THREE.Vector3 | null = null;
  if (ref.mouth) {
    const head = index.get(ref.head)!;
    let front = -Infinity;
    const tip = new THREE.Vector3();
    for (let n = 0; n < pos.count; n++) {
      if (skinIndex[n * 4] !== head || skinWeight[n * 4] < 0.5) continue;
      v.fromBufferAttribute(pos, n);
      if (v.z > front) (front = v.z), tip.copy(v);
    }
    if (front > -Infinity) mouth = tip.add(new THREE.Vector3(0, -0.05, -0.08)).applyMatrix4(inverses[head]);
  }
  return { geometry, material, inverses, mouth };
}
