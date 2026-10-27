import * as THREE from 'three';
import type { BodyType } from '@rpg/shared';
import { shared } from './dispose';
import { loadGlb } from './loadGlb';
import type { BodyBones, BodyFrame, HeadFit } from './humanoid';
import femaleGlb from './models/body_female.glb?inline';
import femaleMask from './models/body_female_mask.png?inline';
import maleGlb from './models/body_male.glb?inline';
import maleMask from './models/body_male_mask.png?inline';

/**
 * Sculpted base bodies (made with Tripo from a prompt, then cut down to about
 * 14k triangles), used for players and townsfolk in place of the built-in body.
 * Each comes with no skeleton: it is bound here to the same bones the
 * built-in body uses, placed at the sculpt's own joints, so every walk, skill
 * and fighting pose drives it unchanged. Hair, hats and gear are still built
 * on top by humanoid.ts.
 *
 * The sculpts wear plain grey clothes. A region map (one per body, made
 * offline from the texture) says which texels are skin, shirt, trousers,
 * boots, belt or brows, and the shader recolours each to the chosen look.
 *
 * Add #classic to the page address to see the built-in bodies instead.
 */

/** Regions in the map, in order. 0 keeps the sculpt's own colour (eyes, mouth). */
export const REGIONS = ['keep', 'skin', 'shirt', 'trousers', 'boots', 'belt', 'brows'] as const;
/** A head fit that changes nothing. */
const FIT0: HeadFit = { x: 0, y: 0, z: 0, size: 1, w: 1, h: 1, d: 1, tilt: 0 };
/** Fits for hair and headwear on each sculpt, tuned by eye in the fitting room. */
const fit = (hair: Partial<HeadFit>, hat: Partial<HeadFit> = {}) => ({ hair: { ...FIT0, ...hair }, hat: { ...FIT0, ...hat } });

export type Region = (typeof REGIONS)[number];

interface Source {
  glb: string;
  mask: string;
  /** The sculpt is 1 unit tall; this makes it the height of the built-in body. */
  scale: number;
  /** Joints, in body space after scaling. */
  frame: BodyFrame;
  /** How far the arms and legs are turned out from hanging straight in the sculpt (radians). */
  armOut: number;
  legOut: number;
  /** Below this height (body space) the tunic hangs as a skirt over the thighs. */
  crotch: number;
  /** Average colour of each region in the texture (sRGB), as measured offline. */
  base: [number, number, number][];
}

// Joints were read off front and side views of each sculpt over a grid.
const S = 1.2;
const SOURCES: Record<BodyType, Source> = {
  male: {
    glb: maleGlb,
    mask: maleMask,
    scale: S,
    frame: {
      fit: fit({ size: 0.96 }),
      hipsY: 0.46 * S,
      hipX: 0.065 * S,
      hipJoint: -0.03 * S,
      thigh: 0.195 * S,
      shin: 0.17 * S,
      waist: 0.08 * S,
      neck: 0.26 * S,
      headBase: 0.045 * S,
      shoulderX: 0.135 * S,
      shoulderY: 0.245 * S,
      upperArm: 0.14 * S,
      forearm: 0.11 * S,
      headCentre: [0, 0.07 * S, 0.005 * S],
    },
    armOut: Math.PI / 2,
    legOut: 0,
    crotch: 0.4 * S,
    base: [
      [0.616, 0.559, 0.525],
      [0.928, 0.589, 0.406],
      [0.734, 0.734, 0.732],
      [0.752, 0.755, 0.753],
      [0.287, 0.293, 0.297],
      [0.629, 0.63, 0.625],
      [0.369, 0.155, 0.051],
    ],
  },
  female: {
    glb: femaleGlb,
    mask: femaleMask,
    scale: S,
    frame: {
      fit: fit({ size: 0.94 }),
      hipsY: 0.45 * S,
      hipX: 0.056 * S,
      hipJoint: -0.03 * S,
      thigh: 0.185 * S,
      shin: 0.175 * S,
      waist: 0.1 * S,
      neck: 0.24 * S,
      headBase: 0.05 * S,
      shoulderX: 0.1 * S,
      shoulderY: 0.2 * S,
      upperArm: 0.135 * S,
      forearm: 0.125 * S,
      headCentre: [0, 0.075 * S, -0.005 * S],
    },
    armOut: Math.PI / 2,
    legOut: 0,
    crotch: 0.39 * S,
    base: [
      [0.488, 0.398, 0.375],
      [0.955, 0.604, 0.422],
      [0.649, 0.625, 0.626],
      [0.62, 0.596, 0.596],
      [0.224, 0.166, 0.17],
      [1, 1, 1],
      [0.469, 0.157, 0.037],
    ],
  },
};

interface Prepared {
  geometry: THREE.BufferGeometry;
  map: THREE.Texture | null;
  regions: THREE.Texture;
}

const ready = new Map<BodyType, Prepared>();
let loading: Promise<void> | null = null;

export const bodyModelsEnabled = typeof location === 'undefined' || !/classic/.test(location.hash);

/** Loads both bodies; characters built before this finishes use the built-in body. */
export function loadBodyModels(): Promise<void> {
  if (!bodyModelsEnabled) return Promise.resolve();
  loading ??= Promise.all(
    (Object.keys(SOURCES) as BodyType[]).map(async (kind) => {
      const src = SOURCES[kind];
      try {
        const [gltf, regions] = await Promise.all([loadGlb(src.glb), new THREE.TextureLoader().loadAsync(src.mask)]);
        ready.set(kind, prepare(kind, src, gltf.scene, regions));
      } catch (err) {
        console.warn(`Body model ${kind} failed to load; keeping the built-in body`, err);
      }
    }),
  ).then(() => undefined);
  return loading;
}

/** The joints of a sculpted body, once it has loaded. */
/** The head fits in use, for the fitting room to change live. */
export function headFits(kind: BodyType): { hair: HeadFit; hat: HeadFit } {
  return SOURCES[kind].frame.fit!;
}

export function bodyFrame(kind: BodyType | undefined): BodyFrame | null {
  return kind && ready.has(kind) ? SOURCES[kind].frame : null;
}

/** What each region is recoloured to; leave one out to keep the sculpt's own colour. */
export type Tints = Partial<Record<Region, number>>;

/**
 * Binds a sculpted body to freshly built bones (still in their resting pose)
 * under `parent`, coloured with `tints`. Returns the mesh.
 */
export function attachBodyModel(kind: BodyType, bones: BodyBones, parent: THREE.Object3D, tints: Tints, metal: Partial<Record<Region, boolean>> = {}): THREE.SkinnedMesh {
  const src = SOURCES[kind];
  const p = ready.get(kind)!;
  const list = boneList(bones);
  // Bind with the limbs turned out as they are in the sculpt, then let them hang.
  setBindPose(bones, src, 1);
  parent.updateMatrixWorld(true);
  const mesh = new THREE.SkinnedMesh(p.geometry, tintMaterial(kind, p, tints, metal));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;
  parent.add(mesh);
  mesh.updateMatrixWorld(true);
  mesh.bind(new THREE.Skeleton(list), mesh.matrixWorld);
  setBindPose(bones, src, 0);
  parent.updateMatrixWorld(true);
  return mesh;
}

function setBindPose(bones: BodyBones, src: Source, k: number): void {
  bones.shoulderL.rotation.set(0, 0, -src.armOut * k);
  bones.shoulderR.rotation.set(0, 0, src.armOut * k);
  bones.hipL.rotation.set(0, 0, -src.legOut * k);
  bones.hipR.rotation.set(0, 0, src.legOut * k);
}

/** The bones a body mesh is skinned to, in the order its skinIndex uses. */
const BONE_KEYS = ['hips', 'skirt', 'torso', 'neck', 'head', 'shoulderL', 'shoulderR', 'elbowL', 'elbowR', 'handL', 'handR', 'hipL', 'hipR', 'kneeL', 'kneeR', 'ankleL', 'ankleR'] as const;
type BoneKey = (typeof BONE_KEYS)[number];
const B = Object.fromEntries(BONE_KEYS.map((k, i) => [k, i])) as Record<BoneKey, number>;

function boneList(bones: BodyBones): THREE.Bone[] {
  return BONE_KEYS.map((k) => bones[k]);
}

/** One shader for every body: the texture, recoloured region by region. */
function tintMaterial(kind: BodyType, p: Prepared, tints: Tints, metal: Partial<Record<Region, boolean>>): THREE.Material {
  const base = SOURCES[kind].base;
  const factors = REGIONS.map((r, i) => {
    const tint = tints[r];
    if (tint === undefined || i === 0) return new THREE.Vector3(1, 1, 1);
    // Ratios in linear light, so the texture's shading carries over to the new colour.
    const want = new THREE.Color(tint);
    const have = new THREE.Color().setRGB(...base[i], THREE.SRGBColorSpace);
    return new THREE.Vector3(want.r / Math.max(have.r, 0.02), want.g / Math.max(have.g, 0.02), want.b / Math.max(have.b, 0.02));
  });
  const shine = REGIONS.map((r) => (metal[r] ? 1 : 0));
  const material = new THREE.MeshPhongMaterial({ map: p.map, shininess: 40, specular: 0x000000 });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.regionMap = { value: p.regions };
    shader.uniforms.regionTint = { value: factors };
    shader.uniforms.regionShine = { value: shine };
    shader.uniforms.browBase = { value: new THREE.Color().setRGB(...base[6], THREE.SRGBColorSpace) };
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D regionMap;
uniform vec3 regionTint[${REGIONS.length}];
uniform float regionShine[${REGIONS.length}];
uniform vec3 browBase;`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
int region = int(floor(texture2D(regionMap, vMapUv).r * 255.0 / 32.0 + 0.5));
// Brows take a slightly darker hair colour, darker still where the texture is darker, never lightened (their edges fade into the skin).
if (region == 6) diffuseColor.rgb = browBase * 0.75 * (0.5 + 0.5 * clamp(dot(diffuseColor.rgb, vec3(0.3, 0.59, 0.11)) / dot(browBase, vec3(0.3, 0.59, 0.11)), 0.0, 1.0));
diffuseColor.rgb *= regionTint[region];
float shineHere = regionShine[region];`,
      )
      .replace('#include <specularmap_fragment>', '#include <specularmap_fragment>\nspecularStrength = shineHere;')
      .replace('#include <lights_phong_fragment>', '#include <lights_phong_fragment>\nmaterial.specularColor = vec3(0.3) * shineHere;');
  };
  material.customProgramCacheKey = () => 'tinted-body';
  return material;
}

function prepare(kind: BodyType, src: Source, scene: THREE.Object3D, regions: THREE.Texture): Prepared {
  let found: THREE.Mesh | null = null;
  scene.traverse((o) => o instanceof THREE.Mesh && !found && (found = o));
  const source = found as unknown as THREE.Mesh;
  const geometry = source.geometry.clone();
  source.updateWorldMatrix(true, false);
  geometry.applyMatrix4(source.matrixWorld);
  geometry.scale(src.scale, src.scale, src.scale);
  const map = (source.material as THREE.MeshStandardMaterial).map;
  regions.flipY = false;
  regions.magFilter = THREE.NearestFilter;
  regions.minFilter = THREE.NearestFilter;
  regions.generateMipmaps = false;
  regions.colorSpace = THREE.NoColorSpace;
  skin(geometry, src);
  src.frame.headRadius = headShape(geometry, src.frame);
  src.frame.torso = torsoShape(geometry, src);
  shared(geometry);
  void kind;
  return { geometry, map, regions };
}

/**
 * How far the sculpt's head reaches from its middle in each direction, so
 * hair, hats, hoods and helms can be shaped to it rather than to an egg. A
 * table over latitude and longitude of the furthest head point, smoothed
 * (never inward) so shells come out round; looked up bilinearly.
 */
function headShape(geometry: THREE.BufferGeometry, F: BodyFrame): (u: THREE.Vector3, inner?: boolean) => number {
  const [cx, cy, cz] = F.headCentre ?? [0, 0, 0];
  const centre = new THREE.Vector3(cx, F.hipsY + F.waist + F.neck + F.headBase + cy, cz);
  const LAT = 24;
  const LON = 48;
  const raw = new Float32Array(LAT * LON);
  const pos = geometry.getAttribute('position');
  const d = new THREE.Vector3();
  const cell = (u: THREE.Vector3): [number, number] => [(Math.acos(THREE.MathUtils.clamp(u.y, -1, 1)) / Math.PI) * LAT - 0.5, (((Math.atan2(u.x, u.z) / (2 * Math.PI)) + 1) % 1) * LON - 0.5];
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).sub(centre);
    const r = d.length();
    // The head and the front of the neck under it (for the jaw line), not the shoulders; behind, the
    // neck is left out so shells close under the skull instead of running down it in a strip.
    if (r > 0.17 || (d.y < -0.08 && Math.hypot(d.x, d.z) > 0.075) || (d.y < -0.06 && d.z < 0)) continue;
    d.divideScalar(r);
    const [a, o] = cell(d);
    const k = Math.min(LAT - 1, Math.max(0, Math.round(a))) * LON + ((Math.round(o) + LON) % LON);
    raw[k] = Math.max(raw[k], r);
  }
  // Fill gaps from the cell above (straight down has none).
  for (let a = 1; a < LAT; a++) for (let o = 0; o < LON; o++) if (!raw[a * LON + o]) raw[a * LON + o] = raw[(a - 1) * LON + o];
  for (let o = 0; o < LON; o++) if (!raw[o]) raw[o] = Math.max(...raw.subarray(LON, 2 * LON));
  const filter = (from: Float32Array, pick: (near: number[]) => number) => {
    const out = new Float32Array(LAT * LON);
    for (let a = 0; a < LAT; a++)
      for (let o = 0; o < LON; o++) {
        const near: number[] = [];
        for (let da = -1; da <= 1; da++) for (let dO = -1; dO <= 1; dO++) near.push(from[Math.min(LAT - 1, Math.max(0, a + da)) * LON + ((o + dO + LON) % LON)]);
        out[a * LON + o] = pick(near);
      }
    return out;
  };
  const mean = (near: number[]) => near.reduce((x, y) => x + y) / near.length;
  // Outside: spread each cell to its neighbours first, so smoothing never sinks below the surface.
  const outer = filter(filter(filter(raw, (n) => Math.max(...n)), mean), mean);
  // Inside, for the parts of a shell tucked away: the other way, so the nose and ears don't pull them out past the cheeks.
  const inner = filter(raw, (n) => Math.min(...n));
  const look = (table: Float32Array, u: THREE.Vector3) => {
    const [a, o] = cell(u.clone().normalize());
    const a0 = Math.floor(a);
    const o0 = Math.floor(o);
    const fa = a - a0;
    const fo = o - o0;
    const at = (aa: number, oo: number) => table[Math.min(LAT - 1, Math.max(0, aa)) * LON + ((oo + LON) % LON)];
    return (at(a0, o0) * (1 - fo) + at(a0, o0 + 1) * fo) * (1 - fa) + (at(a0 + 1, o0) * (1 - fo) + at(a0 + 1, o0 + 1) * fo) * fa;
  };
  return (u, tucked = false) => look(tucked ? inner : outer, u);
}

/**
 * The trunk's depth at each height, from the sculpt (with the arms still out
 * to the sides, out of the way), and the height of the tops of the shoulders.
 */
function torsoShape(geometry: THREE.BufferGeometry, src: Source): NonNullable<BodyFrame['torso']> {
  const F = src.frame;
  const STEP = 0.02;
  const n = 80;
  const back = new Float32Array(n);
  const front = new Float32Array(n);
  let shoulderTop = 0;
  const pos = geometry.getAttribute('position');
  const index = geometry.getAttribute('skinIndex');
  const weight = geometry.getAttribute('skinWeight');
  const torsoY = F.hipsY + F.waist;
  const neckY = torsoY + F.neck;
  // Each vertex where it is with the arms hanging, as they will be under the cape.
  const arm = new Map<number, THREE.Matrix4>();
  for (const side of [-1, 1]) {
    const m = new THREE.Matrix4()
      .makeTranslation(side * F.shoulderX, torsoY + F.shoulderY, 0)
      .multiply(new THREE.Matrix4().makeRotationZ(-side * src.armOut))
      .multiply(new THREE.Matrix4().makeTranslation(-side * F.shoulderX, -(torsoY + F.shoulderY), 0));
    for (const bone of side < 0 ? [B.shoulderL, B.elbowL, B.handL] : [B.shoulderR, B.elbowR, B.handR]) arm.set(bone, m);
  }
  const v = new THREE.Vector3();
  const hung = new THREE.Vector3();
  const part = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    hung.set(0, 0, 0);
    for (let j = 0; j < 4; j++) {
      const w = weight.getComponent(i, j);
      if (!w) continue;
      const m = arm.get(index.getComponent(i, j));
      part.copy(v);
      if (m) part.applyMatrix4(m);
      hung.addScaledVector(part, w);
    }
    const x = Math.abs(hung.x);
    const { y, z } = hung;
    // Up to the jaw: the shoulders rise above the neck joint.
    if (y > neckY + F.headBase) continue;
    if (x > F.shoulderX * 0.6 && x < F.shoulderX * 1.3) shoulderTop = Math.max(shoulderTop, y);
    // Everything a cape as wide as the shoulders has to clear.
    if (x > F.shoulderX + 0.04) continue;
    const k = Math.min(n - 1, Math.round(y / STEP));
    back[k] = Math.max(back[k], -z);
    front[k] = Math.max(front[k], z);
  }
  const lerp = (table: Float32Array) => (y: number) => {
    const f = THREE.MathUtils.clamp(y / STEP, 0, n - 1);
    const k = Math.floor(f);
    // The widest of this band and the ones either side, so the cloth clears it.
    const at = (j: number) => Math.max(table[Math.max(0, j - 1)], table[j], table[Math.min(n - 1, j + 1)]);
    return at(k) + (at(Math.min(n - 1, k + 1)) - at(k)) * (f - k);
  };
  return { back: lerp(back), front: lerp(front), shoulderTop };
}

/**
 * Weights for every vertex, worked out from where it sits against the
 * sculpt's joints (with the limbs turned out as in the sculpt): arms along
 * their length, legs down theirs, the tunic's skirt swinging between the
 * hips and thighs like the built-in body's, the trunk, neck and head.
 */
function skin(geometry: THREE.BufferGeometry, src: Source): void {
  const F = src.frame;
  const v = (x: number, y: number, z = 0) => new THREE.Vector3(x, y, z);
  const hipsY = F.hipsY;
  const torsoY = hipsY + F.waist;
  const neckY = torsoY + F.neck;
  const headY = neckY + F.headBase;
  const arms = ([-1, 1] as const).map((side) => {
    const shoulder = v(side * F.shoulderX, torsoY + F.shoulderY);
    const dir = v(side * Math.sin(src.armOut), -Math.cos(src.armOut));
    return { side, shoulder, dir, elbowAt: F.upperArm, wristAt: F.upperArm + F.forearm, bones: side < 0 ? [B.shoulderL, B.elbowL, B.handL] : [B.shoulderR, B.elbowR, B.handR] };
  });
  const legs = ([-1, 1] as const).map((side) => {
    const hip = v(side * F.hipX, hipsY + F.hipJoint);
    const dir = v(side * Math.sin(src.legOut), -Math.cos(src.legOut));
    return { side, hip, dir, kneeAt: F.thigh, ankleAt: F.thigh + F.shin, bones: side < 0 ? [B.hipL, B.kneeL, B.ankleL] : [B.hipR, B.kneeR, B.ankleR] };
  });
  const smooth = THREE.MathUtils.smoothstep;
  const pos = geometry.attributes.position;
  const region = geometry.getAttribute('_region');
  const skinIndex = new Uint16Array(pos.count * 4);
  const skinWeight = new Float32Array(pos.count * 4);
  const p = new THREE.Vector3();
  const rel = new THREE.Vector3();
  type W = [number, number][];
  /** Hands from bone a to bone b as t goes from 0 to 1. */
  const mix = (a: number, b: number, t: number): W => {
    const k = smooth(t, 0, 1);
    return k <= 0 ? [[a, 1]] : k >= 1 ? [[b, 1]] : [[a, 1 - k], [b, k]];
  };
  const along = (t: number, at: [number, number][], width: number): W => {
    let w: W = [[at[0][1], 1]];
    for (let i = 1; i < at.length; i++) {
      const k = (t - (at[i][0] - width / 2)) / width;
      if (k <= 0) break;
      w = mix(at[i - 1][1], at[i][1], k);
    }
    return w;
  };
  for (let n = 0; n < pos.count; n++) {
    p.fromBufferAttribute(pos, n);
    const kind = REGIONS[region ? region.getX(n) : 0];
    let w: W | null = null;

    // Arms: anything out along an arm, past the side of the chest.
    for (const arm of arms) {
      if (Math.sign(p.x) !== arm.side) continue;
      rel.subVectors(p, arm.shoulder);
      const t = rel.dot(arm.dir);
      const off = rel.addScaledVector(arm.dir, -t).length();
      // Wider toward the hand, for thumbs and fingers that stick out.
      if (t < -0.02 || off > 0.1 + 0.08 * smooth(t, 0.15, 0.3) || Math.abs(p.x) < F.shoulderX * 0.7) continue;
      const [sh, el, ha] = arm.bones;
      w = along(t, [[-1, B.torso], [0.04, sh], [arm.elbowAt, el], [arm.wristAt, ha]], 0.06);
      break;
    }

    // Legs, below the crotch, unless it's the tunic hanging over them.
    if (!w && p.y < src.crotch && kind !== 'shirt' && kind !== 'belt') {
      const leg = legs[p.x < 0 ? 0 : 1];
      rel.subVectors(p, leg.hip);
      const t = rel.dot(leg.dir);
      const [hip, knee, ankle] = leg.bones;
      w = along(t, [[-1, B.hips], [0.03, hip], [leg.kneeAt, knee], [leg.ankleAt + 0.02, ankle]], 0.07);
    }

    // The tunic below the waist hangs from the hips, swinging with the thighs toward its hem.
    if (!w && p.y < torsoY - 0.02) {
      const down = THREE.MathUtils.clamp((torsoY - 0.02 - p.y) / 0.2, 0, 1);
      const sideK = THREE.MathUtils.clamp(Math.abs(p.x) / 0.07, 0, 1);
      const thigh = down * 0.6 * sideK;
      w = [
        [B.hips, 1 - down],
        [B.skirt, down * (1 - 0.6 * sideK)],
        [p.x < 0 ? B.hipL : B.hipR, thigh],
      ];
    }

    if (!w) {
      // Trunk, neck and head.
      if (p.y > headY - 0.03) w = mix(B.neck, B.head, (p.y - (headY - 0.03)) / 0.05);
      else if (p.y > neckY - 0.03) w = mix(B.torso, B.neck, (p.y - (neckY - 0.03)) / 0.05);
      else w = mix(B.hips, B.torso, (p.y - (torsoY - 0.03)) / 0.08);
      // The top of the shoulders moves a little with the arm.
      for (const arm of arms) {
        if (Math.sign(p.x) !== arm.side) continue;
        const k = smooth(Math.abs(p.x), F.shoulderX * 0.45, F.shoulderX * 0.95) * smooth(p.y, arm.shoulder.y - 0.1, arm.shoulder.y - 0.02) * (1 - smooth(p.y, arm.shoulder.y + 0.02, arm.shoulder.y + 0.06)) * 0.6;
        if (k > 0) w = [...w.map(([b, x]): [number, number] => [b, x * (1 - k)]), [arm.bones[0], k]];
      }
    }

    const top = w.filter(([, x]) => x > 0).sort((a, b) => b[1] - a[1]).slice(0, 4);
    const sum = top.reduce((s, [, x]) => s + x, 0) || 1;
    top.forEach(([b, x], k) => {
      skinIndex[n * 4 + k] = b;
      skinWeight[n * 4 + k] = x / sum;
    });
  }
  geometry.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(skinIndex, 4));
  geometry.setAttribute('skinWeight', new THREE.Float32BufferAttribute(skinWeight, 4));
}
