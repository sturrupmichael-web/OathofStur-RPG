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

  add(
    key: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    transform: { position: [number, number, number]; rotationY?: number; rotation?: [number, number, number]; scale?: [number, number, number] | number },
    color = 0xffffff,
    shadows: { cast?: boolean; receive?: boolean } = { cast: true, receive: true },
  ): void {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { geometry, material, matrices: [], colors: [], cast: shadows.cast ?? false, receive: shadows.receive ?? false };
      this.entries.set(key, entry);
    }
    const t = this.tmp;
    t.position.set(...transform.position);
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
