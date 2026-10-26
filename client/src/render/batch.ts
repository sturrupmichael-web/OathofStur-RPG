import * as THREE from 'three';

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
      mesh.computeBoundingSphere();
      group.add(mesh);
    }
    return group;
  }
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
