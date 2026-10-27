import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { shared } from './dispose';

/**
 * Builds a character or creature as one smooth, skinned mesh per material
 * instead of dozens of separate rigid parts. Bones sit where the old pivot
 * groups did, so animation code just rotates them; each vertex follows one
 * bone or a blend of two near a joint, so knees, elbows and necks bend
 * without gaps. Colours are per vertex, so a whole body is a few draw calls.
 *
 * Everything is authored in "body space": the bind pose, standing at the
 * origin facing +Z, with every bone unrotated.
 */

/** Which bones a vertex follows, and how much: [boneIndex, weight] pairs. */
export type Weights = [number, number][];

/** cloth: matte (skin, cloth, leather). metal: shiny (armour, blades). glow: unlit (eyes, embers). */
export type Layer = 'cloth' | 'metal' | 'glow';

/**
 * One ring of a tube: its centre, its two half-sizes across the tube, colour
 * and bone weights. For a tube along y the half-sizes are x and z; along z,
 * x and y; along x, z and y.
 */
export interface Ring {
  c: THREE.Vector3;
  rx: number;
  rz: number;
  color: number;
  w: Weights;
}

export interface TubeOptions {
  /** Points around each ring. */
  radial?: number;
  capStart?: boolean;
  capEnd?: boolean;
  layer?: Layer;
  axis?: 'x' | 'y' | 'z';
  /** Only part of the way round: [centre angle, fraction of a full turn]. Angle 0 faces +z (or +y for a z tube). */
  arc?: [number, number];
  /** Colour per vertex instead of per ring. */
  paint?: (p: THREE.Vector3, ringColor: number) => number;
  /** Bone weights per vertex instead of per ring (a skirt following the thighs). */
  weigh?: (p: THREE.Vector3, ringWeights: Weights) => Weights;
}

interface Piece {
  positions: number[];
  normals: number[];
  colors: number[];
  skinIndex: number[];
  skinWeight: number[];
  indices: number[];
}

const phong = (side: THREE.Side) => shared(new THREE.MeshPhongMaterial({ vertexColors: true, shininess: 60, specular: 0x666666, side }));
const MATERIALS: Record<string, THREE.Material> = {
  cloth: shared(new THREE.MeshLambertMaterial({ vertexColors: true })),
  cloth2: shared(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide })),
  metal: phong(THREE.FrontSide),
  metal2: phong(THREE.DoubleSide),
  glow: shared(new THREE.MeshBasicMaterial({ vertexColors: true })),
};

/** The vertex-coloured material for loose parts (capes) that aren't skinned. */
export function vertexMaterial(layer: Layer, doubleSided = false): THREE.Material {
  return MATERIALS[layer + (doubleSided && layer !== 'glow' ? '2' : '')];
}

/** Gives a plain geometry a single vertex colour, for use with `vertexMaterial`. */
export function paint(geo: THREE.BufferGeometry, color: number | ((p: THREE.Vector3) => number)): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    c.setHex(typeof color === 'number' ? color : color(p.fromBufferAttribute(pos, i)));
    colors.set([c.r, c.g, c.b], i * 3);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return geo;
}

export class SkinBuilder {
  readonly bones: THREE.Bone[] = [];
  /** Bind-pose position of each bone in body space. */
  private readonly at: THREE.Vector3[] = [];
  private readonly pieces = new Map<string, Piece>();
  private readonly color = new THREE.Color();
  /** Pieces that should be seen from inside too (open skirts, hoods). */
  private twoSided = false;
  /** Moves each vertex (and turns its normal) as later pieces are added, after their colours and weights are worked out. */
  place: ((p: THREE.Vector3, n: THREE.Vector3) => void) | null = null;

  /** Adds a bone at `x, y, z` relative to its parent (body space for the first). */
  bone(name: string, parent: number | null, x: number, y: number, z = 0): number {
    const b = new THREE.Bone();
    b.name = name;
    b.position.set(x, y, z);
    const at = new THREE.Vector3(x, y, z);
    if (parent !== null) {
      this.bones[parent].add(b);
      at.add(this.at[parent]);
    }
    this.bones.push(b);
    this.at.push(at);
    return this.bones.length - 1;
  }

  /** Where a bone sits in body space. */
  pos(bone: number): THREE.Vector3 {
    return this.at[bone].clone();
  }

  /** Lets later pieces show their inside faces (open hems and skirts). */
  doubleSided(on = true): this {
    this.twoSided = on;
    return this;
  }

  /**
   * A rigid part: `geo` is in the bone's own space (origin at the joint) and
   * follows that one bone. The geometry is consumed.
   */
  rigid(geo: THREE.BufferGeometry, bone: number, color: number, layer: Layer = 'cloth'): this {
    geo.translate(this.at[bone].x, this.at[bone].y, this.at[bone].z);
    return this.add(geo, () => color, () => [[bone, 1]], layer);
  }

  /** A part already in body space, with colours and weights worked out per vertex. The geometry is consumed. */
  add(geo: THREE.BufferGeometry, color: (p: THREE.Vector3, i: number) => number, weights: (p: THREE.Vector3, i: number) => Weights, layer: Layer = 'cloth'): this {
    if (!geo.attributes.normal || geo.index === null) {
      // Weld seams (sphere edges, warped shapes) so the normals come out smooth.
      geo.deleteAttribute('normal');
      geo.deleteAttribute('uv');
      const welded = mergeVertices(geo, 1e-5);
      geo.dispose();
      geo = welded;
      geo.computeVertexNormals();
    }
    const key = layer + (this.twoSided && layer !== 'glow' ? '2' : '');
    let piece = this.pieces.get(key);
    if (!piece) this.pieces.set(key, (piece = { positions: [], normals: [], colors: [], skinIndex: [], skinWeight: [], indices: [] }));
    const pos = geo.attributes.position;
    const nor = geo.attributes.normal;
    const base = piece.positions.length / 3;
    const p = new THREE.Vector3();
    const n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      p.fromBufferAttribute(pos, i);
      n.fromBufferAttribute(nor, i);
      this.color.setHex(color(p, i));
      piece.colors.push(this.color.r, this.color.g, this.color.b);
      pushWeights(piece, weights(p, i));
      this.place?.(p, n);
      piece.positions.push(p.x, p.y, p.z);
      piece.normals.push(n.x, n.y, n.z);
    }
    const index = geo.index!;
    for (let i = 0; i < index.count; i++) piece.indices.push(base + index.getX(i));
    geo.dispose();
    return this;
  }

  /**
   * A smooth tube through `rings`, each an ellipse around its centre. Vertices
   * take their ring's colour and weights, so a sleeve can turn into a cuff and
   * then a wrist, and an elbow can bend smoothly.
   */
  tube(rings: Ring[], opts: TubeOptions = {}): this {
    const { radial = 20, capStart = true, capEnd = true, layer = 'cloth', axis = 'y', arc, paint: tint, weigh } = opts;
    rings = sharpen(rings);
    const open = !!arc && arc[1] < 1;
    const around = open ? radial + 1 : radial;
    const positions: number[] = [];
    const indices: number[] = [];
    const colors: number[] = [];
    const weights: Weights[] = [];
    const p = new THREE.Vector3();
    const put = (r: Ring, a: number, scale: number) => {
      const u = Math.sin(a) * r.rx * scale;
      const v = Math.cos(a) * r.rz * scale;
      // Cyclic axes keep the winding (and so the outside) the same for every direction.
      if (axis === 'y') p.set(r.c.x + u, r.c.y, r.c.z + v);
      else if (axis === 'z') p.set(r.c.x + u, r.c.y + v, r.c.z);
      else p.set(r.c.x, r.c.y + v, r.c.z + u);
      positions.push(p.x, p.y, p.z);
      colors.push(tint ? tint(p, r.color) : r.color);
      weights.push(weigh ? weigh(p, r.w) : r.w);
    };
    for (const r of rings) {
      for (let k = 0; k < around; k++) {
        const a = open ? arc![0] + (k / radial - 0.5) * arc![1] * Math.PI * 2 : (k / radial) * Math.PI * 2 + (arc?.[0] ?? 0);
        put(r, a, 1);
      }
    }
    const coord = (r: Ring) => (axis === 'y' ? r.c.y : axis === 'z' ? r.c.z : r.c.x);
    const backward = coord(rings[rings.length - 1]) < coord(rings[0]);
    for (let r = 0; r < rings.length - 1; r++) {
      for (let k = 0; k < radial; k++) {
        const a = r * around + k;
        const b = r * around + ((k + 1) % around);
        const c = a + around;
        const d = b + around;
        if (backward) indices.push(a, d, b, a, c, d);
        else indices.push(a, b, d, a, d, c);
      }
    }
    const caps: [number, boolean][] = [];
    if (capStart && !open) caps.push([0, true]);
    if (capEnd && !open) caps.push([rings.length - 1, false]);
    for (const [ri, first] of caps) {
      const r = rings[ri];
      const centre = positions.length / 3;
      positions.push(r.c.x, r.c.y, r.c.z);
      colors.push(tint ? tint(r.c, r.color) : r.color);
      weights.push(weigh ? weigh(r.c, r.w) : r.w);
      for (let k = 0; k < radial; k++) {
        const a = ri * around + k;
        const b = ri * around + ((k + 1) % around);
        if (first !== backward) indices.push(centre, b, a);
        else indices.push(centre, a, b);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.setIndex(indices);
    geo.computeVertexNormals();
    return this.add(geo, (_, i) => colors[i], (_, i) => weights[i], layer);
  }

  /** Finishes the meshes, bound to the skeleton in the pose they were built in. */
  build(parent: THREE.Object3D, rootBone: number, opts: { transparent?: number; shadows?: boolean } = {}): THREE.SkinnedMesh[] {
    parent.add(this.bones[rootBone]);
    parent.updateMatrixWorld(true);
    const skeleton = new THREE.Skeleton(this.bones);
    const meshes: THREE.SkinnedMesh[] = [];
    for (const [key, piece] of this.pieces) {
      if (!piece.indices.length) continue;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(piece.positions, 3));
      geo.setAttribute('normal', new THREE.Float32BufferAttribute(piece.normals, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(piece.colors, 3));
      geo.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(piece.skinIndex, 4));
      geo.setAttribute('skinWeight', new THREE.Float32BufferAttribute(piece.skinWeight, 4));
      geo.setIndex(piece.indices);
      let material = MATERIALS[key];
      if (opts.transparent !== undefined) {
        material = material.clone();
        Object.assign(material, { transparent: true, opacity: opts.transparent, depthWrite: false });
        if (material instanceof THREE.MeshLambertMaterial) material.emissive = new THREE.Color(0x1a3040);
      }
      const mesh = new THREE.SkinnedMesh(geo, material);
      // Bound in the parent's space so a scaled body (goblins, women) scales its skin as well as its bones.
      mesh.bind(skeleton, parent.matrixWorld);
      mesh.castShadow = opts.shadows !== false && opts.transparent === undefined && key !== 'glow';
      // A single sheet shadows itself in stripes, so open cloth only casts.
      mesh.receiveShadow = !key.endsWith('2');
      // Bones move the body around a lot (dying, flying); bounds from the bind pose would cull it wrongly.
      mesh.frustumCulled = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

function pushWeights(piece: Piece, w: Weights): void {
  const top = [...w].sort((a, b) => b[1] - a[1]).slice(0, 4);
  const total = top.reduce((s, [, x]) => s + x, 0) || 1;
  for (let k = 0; k < 4; k++) {
    piece.skinIndex.push(top[k]?.[0] ?? 0);
    piece.skinWeight.push(top[k] ? top[k][1] / total : 0);
  }
}

/**
 * Where neighbouring rings change colour, adds a ring just before the change
 * so the colours meet in a crisp line instead of smearing along the segment.
 */
function sharpen(rings: Ring[]): Ring[] {
  const out: Ring[] = [rings[0]];
  for (let i = 1; i < rings.length; i++) {
    const [a, b] = [rings[i - 1], rings[i]];
    if (a.color !== b.color) {
      const t = 0.85;
      out.push({ c: a.c.clone().lerp(b.c, t), rx: a.rx + (b.rx - a.rx) * t, rz: a.rz + (b.rz - a.rz) * t, color: a.color, w: b.w });
    }
    out.push(b);
  }
  return out;
}

/** Weights that hand over from bone `a` to bone `b` as `t` goes 0 -> 1, smoothly. */
export function blend(a: number, b: number, t: number): Weights {
  const k = THREE.MathUtils.smoothstep(t, 0, 1);
  if (k <= 0) return [[a, 1]];
  if (k >= 1) return [[b, 1]];
  return [
    [a, 1 - k],
    [b, k],
  ];
}

/**
 * Weights along a limb: `joints` run from the root outward as [where, bone],
 * with `where` falling (y down an arm or leg). Each bone owns the stretch
 * below its joint, handing over smoothly across `width` around the next.
 */
export function chain(v: number, joints: [at: number, bone: number][], width: number): Weights {
  let w: Weights = [[joints[0][1], 1]];
  for (let i = 1; i < joints.length; i++) {
    const t = (joints[i][0] + width / 2 - v) / width;
    if (t <= 0) break;
    w = blend(joints[i - 1][1], joints[i][1], t);
  }
  return w;
}

/** A rounded blob: a sphere squashed to these half-sizes. */
export function blob(rx: number, ry: number, rz: number, segments = 16): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, segments, Math.max(6, Math.round(segments * 0.66))).scale(rx, ry, rz);
}

/** A capsule from (0,0,0) to (0,-length,0), like a finger or a horn. */
export function capsule(radius: number, length: number, segments = 10): THREE.BufferGeometry {
  return new THREE.CapsuleGeometry(radius, Math.max(0.0001, length - radius * 2), 4, segments).translate(0, -length / 2, 0);
}

/** Moves every vertex of `geo` by `fn` and returns it with smooth normals (the input is consumed). */
export function warp(geo: THREE.BufferGeometry, fn: (p: THREE.Vector3) => void): THREE.BufferGeometry {
  const pos = geo.attributes.position;
  const p = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    fn(p.fromBufferAttribute(pos, i));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  // Weld seams (sphere edges) so the new normals come out smooth.
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const welded = mergeVertices(geo, 1e-5);
  geo.dispose();
  welded.computeVertexNormals();
  return welded;
}

/** Shorthand for a ring. */
export function ring(x: number, y: number, z: number, rx: number, rz: number, color: number, w: Weights): Ring {
  return { c: new THREE.Vector3(x, y, z), rx, rz, color, w };
}
