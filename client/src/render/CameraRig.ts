import * as THREE from 'three';

/**
 * Angled top-down orthographic camera that follows a target. Yaw rotates
 * freely; pitch and zoom are clamped so the world always reads as 2.5D.
 */
export class CameraRig {
  readonly camera: THREE.OrthographicCamera;
  readonly target = new THREE.Vector3();
  yaw = Math.PI / 4;
  pitch = 0.9;
  zoom = 1;
  private aspect = 1;
  private readonly baseTiles = 20;

  constructor() {
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 300);
  }

  resize(width: number, height: number): void {
    this.aspect = width / Math.max(1, height);
    this.applyProjection();
  }

  rotate(delta: number): void {
    this.yaw += delta;
  }

  tilt(delta: number): void {
    this.pitch = THREE.MathUtils.clamp(this.pitch + delta, 0.55, 1.35);
  }

  zoomBy(factor: number): void {
    this.zoom = THREE.MathUtils.clamp(this.zoom * factor, 0.45, 4);
    this.applyProjection();
  }

  /** Ease toward `follow` (world coordinates) and place the camera. */
  update(follow: THREE.Vector3, snap = false): void {
    if (snap) this.target.copy(follow);
    else this.target.lerp(follow, 0.18);
    const dist = 80;
    const offset = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(dist);
    this.camera.position.copy(this.target).add(offset);
    this.camera.lookAt(this.target);
  }

  private applyProjection(): void {
    const halfH = this.baseTiles / 2 / this.zoom;
    const halfW = halfH * this.aspect;
    Object.assign(this.camera, { left: -halfW, right: halfW, top: halfH, bottom: -halfH });
    this.camera.updateProjectionMatrix();
  }
}
