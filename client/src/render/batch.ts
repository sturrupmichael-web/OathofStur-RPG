import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

interface BatchEntry {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  matrices: THREE.Matrix4[];
  colors: THREE.Color[];
  cast: boolean;
  receive: boolean;
}

/**
 * Collects many copies of the same small mesh (window frames, grass tufts,
 * shelf jars) and turns each kind into one InstancedMesh, so detail stays cheap.
 */
export class Batcher {
  private readonly entries = new Map<string, BatchEntry>();
  private readonly tmp = new THREE.Object3D();

  /** With a ground function, every item's y is relative to the ground under it. */
  constructor(private readonly groundAt?: (x: number, z: number) => number) {}

  add(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    transform: { position: [number, number, number]; rotationY?: number; rotation?: [number, number, number]; scale?: [number, number, number] | number },
    color = 0xffffff,
    shadows: { cast?: boolean; receive?: boolean; absolute?: boolean } = { cast: true, receive: true },
  ): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { geometry, material, matrices: [], colors: [], cast: shadows.cast ?? false, receive: shadows.receive ?? false };
      this.entries.set(key, entry);
    }
    const t = this.tmp;
    t.position.set(...transform.position);
    if (this.groundAt && !shadows.absolute) t.position.y += this.groundAt(t.position.x, t.position.z);
    if (transform.rotation) t.rotation.set(...transform.rotation);
    else t.rotation.set(0, transform.rotationY ?? 0, 0);
    const s = transform.scale ?? 1;
    if (typeof s === 'number') t.scale.setScalar(s);
    else t.scale.set(...s);
    t.updateMatrix();
    entry.matrices.push(t.matrix.clone());
    entry.colors.push(new THREE.Color(color));
  }

  build(): THREE.Group {
    const group = new THREE.Group();
    for (const e of this.entries.values()) {
      const mesh = new THREE.InstancedMesh(e.geometry, e.material, e.matrices.length);
      e.matrices.forEach((m, i) => {
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, e.colors[i]);
      });
      mesh.castShadow = e.cast;
      mesh.receiveShadow = e.receive;
      group.add(...splitByArea(mesh));
    }
    return group;
  }
}

/**
 * Tiles per side of the squares that world-wide meshes are cut into. The
 * camera skips a square it can't see, so a big map costs what's on screen,
 * not everything in it.
 */
export const AREA = 32;

/** Which AREA square a world point is in, as one number. */
export function areaOf(x: number, z: number): number {
  return Math.floor(z / AREA) * 4096 + Math.floor(x / AREA);
}

/**
 * Cuts an InstancedMesh spread over the map into one per AREA square, so
 * each can be culled on its own. Per-instance `tileOf` (for picking) goes
 * with its instance. The parts share the geometry and material.
 */
export function splitByArea(mesh: THREE.InstancedMesh): THREE.InstancedMesh[] {
  const m = mesh.instanceMatrix.array;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < mesh.count; i++) {
    const key = areaOf(m[i * 16 + 12], m[i * 16 + 14]);
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(i);
  }
  if (buckets.size <= 1) {
    mesh.computeBoundingSphere();
    return [mesh];
  }
  const tileOf = mesh.userData.tileOf as Int32Array | undefined;
  const colors = mesh.instanceColor?.array;
  const parts: THREE.InstancedMesh[] = [];
  for (const list of buckets.values()) {
    const part = new THREE.InstancedMesh(mesh.geometry, mesh.material, list.length);
    part.castShadow = mesh.castShadow;
    part.receiveShadow = mesh.receiveShadow;
    part.name = mesh.name;
    part.userData = { ...mesh.userData };
    if (tileOf) part.userData.tileOf = Int32Array.from(list, (i) => tileOf[i]);
    list.forEach((i, k) => {
      part.instanceMatrix.array.set(m.subarray(i * 16, i * 16 + 16), k * 16);
      if (colors) part.setColorAt(k, new THREE.Color().fromArray(colors, i * 3));
    });
    part.computeBoundingSphere();
    parts.push(part);
  }
  mesh.dispose();
  return parts;
}

/**
 * Axis-aligned boxes merged into one mesh, with UVs in world units so a
 * texture keeps its scale however long a wall runs. No bottom faces.
 */
export class BoxBuilder {
  private readonly positions: number[] = [];
  private readonly normals: number[] = [];
  private readonly uvs: number[] = [];
  private readonly colors: number[] = [];

  get empty(): boolean {
    return this.positions.length === 0;
  }

  box(min: [number, number, number], max: [number, number, number], color: number): void {
    const [x0, y0, z0] = min;
    const [x1, y1, z1] = max;
    const c = new THREE.Color(color);
    // Each face: four corners (counter-clockwise seen from outside), its normal, and which coordinates make u and v.
    const faces: [number[][], [number, number, number], (p: number[]) => [number, number]][] = [
      [[[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], (p) => [-p[2], p[1]]],
      [[[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], (p) => [p[2], p[1]]],
      [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], (p) => [p[0], p[1]]],
      [[[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], (p) => [-p[0], p[1]]],
      [[[x0, y1, z1], [x1, y1, z1], [x1, y1, z0], [x0, y1, z0]], [0, 1, 0], (p) => [p[0], -p[2]]],
    ];
    for (const [corners, normal, uv] of faces) {
      for (const k of [0, 1, 2, 0, 2, 3]) {
        const p = corners[k];
        this.positions.push(p[0], p[1], p[2]);
        this.normals.push(...normal);
        this.uvs.push(...uv(p));
        this.colors.push(c.r, c.g, c.b);
      }
    }
  }

  build(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    return mesh;
  }
}

/** Shared Lambert materials keyed by colour/flags, so batches can share them. */
const materials = new Map<string, THREE.MeshLambertMaterial>();
export function lambert(color = 0xffffff, opts: { emissive?: number; map?: THREE.Texture; flat?: boolean; side?: THREE.Side } = {}): THREE.MeshLambertMaterial {
  const key = `${color}|${opts.emissive ?? 0}|${opts.map?.uuid ?? ''}|${opts.flat ?? false}|${opts.side ?? 0}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshLambertMaterial({
      color,
      emissive: opts.emissive ?? 0x000000,
      map: opts.map ?? null,
      flatShading: opts.flat ?? false,
      side: opts.side ?? THREE.FrontSide,
    });
    materials.set(key, m);
  }
  return m;
}

/**
 * Stops the scene from re-working the place of every object under `root`
 * each frame: for world that never moves, that's most of the objects in the
 * scene. Objects in `moving` (and what's under them) keep updating.
 */
export function freeze(root: THREE.Object3D, moving: THREE.Object3D[] = []): void {
  root.updateMatrixWorld(true);
  root.traverse((o) => (o.matrixAutoUpdate = false));
  for (const m of moving) m.traverse((o) => (o.matrixAutoUpdate = true));
}

/** One material per look, shared by every merged mesh with that look (colours live in the vertices). */
const mergedMaterials = new Map<string, THREE.MeshLambertMaterial | THREE.MeshBasicMaterial>();

/** Everything about a plain material but its colour, or null if it can't be merged by colour. */
function lookOf(m: THREE.Material): string | null {
  if (m.transparent || !m.visible || m.alphaTest) return null;
  const common = [m.side, m.depthWrite, m.depthTest, m.polygonOffset, m.polygonOffsetFactor, m.polygonOffsetUnits];
  if (m instanceof THREE.MeshLambertMaterial && !m.emissiveMap && !m.lightMap && !m.aoMap)
    return ['lambert', m.map?.uuid ?? '', m.emissive.getHex(), m.emissiveIntensity, m.flatShading, m.fog, m.wireframe, ...common].join('|');
  if (m instanceof THREE.MeshBasicMaterial && !m.lightMap && !m.aoMap) return ['basic', m.map?.uuid ?? '', m.fog, m.wireframe, ...common].join('|');
  return null;
}

const tagIds = new WeakMap<object, number>();
let nextTag = 0;
/** A part's userData as text, so only parts tagged alike (say, with the same building) merge. */
function tagsOf(data: Record<string, unknown>): string {
  return Object.keys(data)
    .sort()
    .map((k) => {
      const v = data[k];
      if (v === null || typeof v !== 'object') return `${k}=${String(v)}`;
      if (!tagIds.has(v)) tagIds.set(v, nextTag++);
      return `${k}#${tagIds.get(v)}`;
    })
    .join(',');
}

/**
 * Merges the still parts of a model into as few meshes as it can: parts that
 * differ only in colour share one material, the colour moving into the
 * vertices, which draws exactly the same. Each draw (twice over, counting
 * the shadow pass) costs the browser time whatever its size, so a well with
 * twenty parts drawn as two is much lighter.
 *
 * `keep` subtrees are left alone (parts that move or change), as are
 * skinned or instanced meshes, hidden parts and see-through ones; only parts tagged alike in
 * userData merge, and keep the tags. With `ownMaterials`, only parts with the very same
 * material are merged and keep it (for materials changed later, like a
 * fading roof's). With `byArea`, merged meshes are split by AREA
 * square so the camera can still skip the ones off screen. Merged meshes go
 * straight under `root`.
 */
export function mergeParts(root: THREE.Object3D, opts: { keep?: THREE.Object3D[]; byArea?: boolean; ownMaterials?: boolean } = {}): void {
  const kept = new Set<THREE.Object3D>();
  for (const k of opts.keep ?? []) k.traverse((o) => kept.add(o));
  root.updateMatrixWorld(true);
  const toRoot = root.matrixWorld.clone().invert();
  const groups = new Map<string, { mesh: THREE.Mesh; matrix: THREE.Matrix4 }[]>();
  const walk = (o: THREE.Object3D) => {
    if (kept.has(o) || !o.visible) return;
    for (const c of o.children) walk(c);
    if (!(o instanceof THREE.Mesh) || o instanceof THREE.InstancedMesh || o instanceof THREE.SkinnedMesh || o === root) return;
    if (Array.isArray(o.material) || o.material.transparent || o.geometry.morphAttributes.position) return;
    const matrix = new THREE.Matrix4().multiplyMatrices(toRoot, o.matrixWorld);
    if (matrix.determinant() <= 0) return; // a mirrored part would turn inside out
    const look = opts.ownMaterials ? null : lookOf(o.material);
    // A look-merged part gets colours of its own, so whether it had any doesn't matter.
    const attrs = Object.keys(o.geometry.attributes)
      .filter((a) => ['position', 'normal', 'uv', 'color'].includes(a) && (a !== 'color' || !look))
      .sort()
      .join();
    const p = new THREE.Vector3().setFromMatrixPosition(o.matrixWorld);
    const where = opts.byArea ? areaOf(p.x, p.z) : 0;
    const key = [look ?? `own:${o.material.uuid}`, attrs, o.castShadow, o.receiveShadow, o.renderOrder, o.frustumCulled, where, tagsOf(o.userData)].join('/');
    let list = groups.get(key);
    if (!list) groups.set(key, (list = []));
    list.push({ mesh: o, matrix });
  };
  walk(root);

  for (const list of groups.values()) {
    if (list.length < 2) continue;
    const first = list[0].mesh;
    const look = opts.ownMaterials ? null : lookOf(first.material as THREE.Material);
    const indexed = list.every(({ mesh }) => mesh.geometry.index);
    const parts = list.map(({ mesh, matrix }) => {
      const g = indexed || !mesh.geometry.index ? mesh.geometry.clone() : mesh.geometry.toNonIndexed();
      g.clearGroups();
      for (const name of Object.keys(g.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(name)) g.deleteAttribute(name);
      if (look) {
        // Bake the material's colour into the vertices (on top of any vertex colours it already had).
        const mat = mesh.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial;
        const n = g.attributes.position.count;
        const had = mat.vertexColors ? (g.attributes.color as THREE.BufferAttribute | undefined) : undefined;
        const colors = new Float32Array(n * 3);
        for (let i = 0; i < n; i++) {
          colors[i * 3] = mat.color.r * (had ? had.getX(i) : 1);
          colors[i * 3 + 1] = mat.color.g * (had ? had.getY(i) : 1);
          colors[i * 3 + 2] = mat.color.b * (had ? had.getZ(i) : 1);
        }
        g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      }
      g.applyMatrix4(matrix);
      return g;
    });
    const geometry = mergeGeometries(parts, false);
    parts.forEach((g) => g.dispose());
    if (!geometry) continue;
    let material = first.material as THREE.Material;
    if (look) {
      let shared = mergedMaterials.get(look);
      if (!shared) {
        shared = (first.material as THREE.MeshLambertMaterial | THREE.MeshBasicMaterial).clone();
        shared.color.set(0xffffff);
        shared.vertexColors = true;
        shared.userData = { shared: true };
        mergedMaterials.set(look, shared);
      }
      material = shared;
    }
    const merged = new THREE.Mesh(geometry, material);
    merged.castShadow = first.castShadow;
    merged.receiveShadow = first.receiveShadow;
    merged.renderOrder = first.renderOrder;
    merged.frustumCulled = first.frustumCulled;
    merged.userData = { ...first.userData };
    root.add(merged);
    for (const { mesh } of list) {
      mesh.removeFromParent();
      if (!mesh.geometry.userData.shared) mesh.geometry.dispose();
    }
  }
}
