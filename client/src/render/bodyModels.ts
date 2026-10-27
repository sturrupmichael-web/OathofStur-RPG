import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { BodyType } from '@rpg/shared';
import { shared } from './dispose';
import type { BodyBones, BodyFrame } from './humanoid';
import femaleGlb from './models/body_female.glb?inline';
import femaleMask from './models/body_female_mask.png?inline';
import maleGlb from './models/body_male.glb?inline';
import maleMask from './models/body_male_mask.png?inline';

/**
 * Sculpted base bodies (made with Tripo from a prompt, then cut down to about
 * 7k triangles), used for players and townsfolk in place of the built-in body.
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
      headScale: [1.13, 1.0, 0.86],
    },
    armOut: Math.PI / 2,
    legOut: 0,
    crotch: 0.4 * S,
    base: [
      [0.64, 0.594, 0.565],
      [0.906, 0.593, 0.424],
      [0.736, 0.732, 0.728],
      [0.747, 0.746, 0.743],
      [0.307, 0.307, 0.307],
      [0.636, 0.625, 0.614],
      [0.403, 0.193, 0.091],
    ],
  },
  female: {
    glb: femaleGlb,
    mask: femaleMask,
    scale: S,
    frame: {
      hipsY: 0.45 * S,
      hipX: 0.07 * S,
      hipJoint: -0.03 * S,
      thigh: 0.192 * S,
      shin: 0.162 * S,
      waist: 0.1 * S,
      neck: 0.24 * S,
      headBase: 0.04 * S,
      shoulderX: 0.105 * S,
      shoulderY: 0.205 * S,
      upperArm: 0.14 * S,
      forearm: 0.134 * S,
      headCentre: [0, 0.075 * S, -0.005 * S],
      headScale: [1.2, 1.12, 1.12],
    },
    armOut: 1.2,
    legOut: 0.157,
    crotch: 0.39 * S,
    base: [
      [0.544, 0.442, 0.366],
      [0.907, 0.599, 0.393],
      [0.683, 0.67, 0.653],
      [0.659, 0.624, 0.568],
      [0.226, 0.209, 0.184],
      [1, 1, 1],
      [0.619, 0.32, 0.137],
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
        const [gltf, regions] = await Promise.all([new GLTFLoader().loadAsync(src.glb), new THREE.TextureLoader().loadAsync(src.mask)]);
        ready.set(kind, prepare(kind, src, gltf.scene, regions));
      } catch (err) {
        console.warn(`Body model ${kind} failed to load; keeping the built-in body`, err);
      }
    }),
  ).then(() => undefined);
  return loading;
}

/** The joints of a sculpted body, once it has loaded. */
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
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
uniform sampler2D regionMap;
uniform vec3 regionTint[${REGIONS.length}];
uniform float regionShine[${REGIONS.length}];`,
      )
      .replace(
        '#include <map_fragment>',
        `#include <map_fragment>
int region = int(floor(texture2D(regionMap, vMapUv).r * 255.0 / 32.0 + 0.5));
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
  shared(geometry);
  void kind;
  return { geometry, map, regions };
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
