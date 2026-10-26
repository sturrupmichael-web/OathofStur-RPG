import * as THREE from 'three';

/** Marks a geometry or material that many models share, so disposeModel leaves it alone. */
export function shared<T extends THREE.BufferGeometry | THREE.Material>(resource: T): T {
  resource.userData.shared = true;
  return resource;
}

/**
 * Frees the GPU buffers of a model that is no longer shown: its own
 * geometries and materials, not shared ones. Textures all come from caches,
 * so they stay.
 */
export function disposeModel(root: THREE.Object3D): void {
  root.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    if (o instanceof THREE.SkinnedMesh) o.skeleton.dispose();
    if (!o.geometry.userData.shared) o.geometry.dispose();
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (!m.userData.shared) m.dispose();
  });
}
