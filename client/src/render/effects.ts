import * as THREE from 'three';
import { BREATH_FIRE, type CreatureRig } from './creatures';

/** One puff of flame: a sprite that flies out, swells, cools to smoke and fades. */
interface Flame {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  born: number;
  life: number;
}

interface Breath {
  rig: CreatureRig;
  /** Where the fire is aimed (world space), when there is someone to aim at. */
  target: (() => THREE.Vector3 | null) | null;
  start: number;
  ms: number;
  /** Fractional flames owed, so the rate doesn't depend on the frame rate. */
  owed: number;
}

/** An arrow in flight between two points that may move (both ends follow their entities). */
interface Arrow {
  mesh: THREE.Object3D;
  from: () => THREE.Vector3 | null;
  to: () => THREE.Vector3 | null;
  start: number;
  ms: number;
}

const FLAME_LIFE = 0.55;
const FLAMES_PER_SECOND = 110;
const SPEED = 6.5;
const HOT = new THREE.Color(0xfff2a0);
const WARM = new THREE.Color(0xff7a1a);
const SMOKE = new THREE.Color(0x3a2a24);

let flameTexture: THREE.Texture | null = null;

/** A soft round blob, bright in the middle. */
function texture(): THREE.Texture {
  if (flameTexture) return flameTexture;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.4, 'rgba(255,255,255,0.7)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  flameTexture = new THREE.CanvasTexture(c);
  return flameTexture;
}

/**
 * Fire breath: flames pour from a creature's mouth along where its head
 * points, while the breath animation is at the fire part, with an orange
 * light flickering at the mouth.
 */
export class Effects {
  readonly group = new THREE.Group();
  private readonly breaths: Breath[] = [];
  private readonly arrows: Arrow[] = [];
  private readonly spareArrows: THREE.Object3D[] = [];
  private readonly flames: Flame[] = [];
  private readonly spare: THREE.Sprite[] = [];
  private readonly light = new THREE.PointLight(0xff7a2a, 0, 6, 1.6);
  private readonly mouth = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();

  constructor() {
    this.group.add(this.light);
  }

  breathe(rig: CreatureRig, now: number, ms: number, target: (() => THREE.Vector3 | null) | null = null): void {
    if (rig.mouth) this.breaths.push({ rig, target, start: now, ms, owed: 0 });
  }

  /** Looses an arrow at `start` that lands `ms` later. */
  shoot(from: () => THREE.Vector3 | null, to: () => THREE.Vector3 | null, start: number, ms: number): void {
    const mesh = this.spareArrows.pop() ?? this.group.add(arrowModel()).children.at(-1)!;
    mesh.visible = false;
    this.arrows.push({ mesh, from, to, start, ms });
  }

  update(now: number, dt: number): void {
    const t = now / 1000;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      const u = (now - a.start) / a.ms;
      const from = a.from();
      const to = a.to();
      if (u >= 1 || !from || !to) {
        a.mesh.visible = false;
        this.spareArrows.push(a.mesh);
        this.arrows.splice(i, 1);
        continue;
      }
      if (u < 0) continue;
      // A shallow arc: higher for longer shots.
      const lift = from.distanceTo(to) * 0.08;
      const at = (k: number) => from.clone().lerp(to, k).add(new THREE.Vector3(0, Math.sin(k * Math.PI) * lift, 0));
      a.mesh.position.copy(at(u));
      a.mesh.lookAt(at(Math.min(1, u + 0.02)));
      a.mesh.visible = true;
    }
    let glow = 0;
    for (let i = this.breaths.length - 1; i >= 0; i--) {
      const b = this.breaths[i];
      const u = (now - b.start) / b.ms;
      if (u >= 1 || !b.rig.root.parent) {
        this.breaths.splice(i, 1);
        continue;
      }
      if (u < BREATH_FIRE.from || u > BREATH_FIRE.to) continue;
      b.rig.mouth!.getWorldPosition(this.mouth);
      const aim = b.target?.();
      if (aim) this.ahead.subVectors(aim, this.mouth);
      else {
        b.rig.head.getWorldQuaternion(this.turn);
        this.ahead.set(0, 0, 1).applyQuaternion(this.turn);
        // Breathe level with the ground even when the head is tipped down.
        this.ahead.y = Math.max(-0.25, Math.min(0.05, this.ahead.y));
      }
      this.ahead.normalize();
      b.owed += dt * FLAMES_PER_SECOND;
      for (; b.owed >= 1; b.owed--) this.emit(t);
      glow = Math.max(glow, 1);
      this.light.position.copy(this.mouth).addScaledVector(this.ahead, 0.8);
    }
    this.light.intensity = glow ? 3.5 + Math.sin(t * 40) * 0.8 + Math.sin(t * 23) * 0.6 : 0;

    for (let i = this.flames.length - 1; i >= 0; i--) {
      const f = this.flames[i];
      const age = (t - f.born) / f.life;
      if (age >= 1) {
        f.sprite.visible = false;
        this.spare.push(f.sprite);
        this.flames.splice(i, 1);
        continue;
      }
      f.sprite.position.addScaledVector(f.velocity, dt);
      f.velocity.multiplyScalar(1 - dt * 1.8);
      f.velocity.y += dt * 1.6; // heat rises
      const size = 0.18 + age * 0.85;
      f.sprite.scale.set(size, size, size);
      const m = f.sprite.material;
      if (age < 0.45) m.color.copy(HOT).lerp(WARM, age / 0.45);
      else m.color.copy(WARM).lerp(SMOKE, (age - 0.45) / 0.55);
      m.blending = age < 0.6 ? THREE.AdditiveBlending : THREE.NormalBlending;
      m.opacity = (age < 0.6 ? 0.9 : 0.55) * (1 - age);
    }
  }

  private emit(t: number): void {
    const sprite =
      this.spare.pop() ??
      (() => {
        const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending }));
        this.group.add(s);
        return s;
      })();
    sprite.visible = true;
    sprite.position.copy(this.mouth);
    const spread = 0.28;
    const velocity = this.ahead
      .clone()
      .add(new THREE.Vector3((Math.random() - 0.5) * spread, (Math.random() - 0.4) * spread * 0.6, (Math.random() - 0.5) * spread))
      .normalize()
      .multiplyScalar(SPEED * (0.8 + Math.random() * 0.4));
    this.flames.push({ sprite, velocity, born: t, life: FLAME_LIFE * (0.75 + Math.random() * 0.5) });
  }
}

/** Shaft, head and fletching, pointing along +z (so lookAt aims it). */
function arrowModel(): THREE.Group {
  const g = new THREE.Group();
  const lambert = (color: number) => new THREE.MeshLambertMaterial({ color });
  g.add(new THREE.Mesh(new THREE.CylinderGeometry(0.008, 0.008, 0.5, 4).rotateX(Math.PI / 2), lambert(0xb08a5a)));
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.06, 4).rotateX(Math.PI / 2).translate(0, 0, 0.27), lambert(0x8a8c92));
  g.add(head);
  for (const r of [0, Math.PI / 2]) {
    const vane = new THREE.Mesh(new THREE.PlaneGeometry(0.035, 0.09).rotateY(Math.PI / 2).rotateZ(r).translate(0, 0, -0.21), new THREE.MeshLambertMaterial({ color: 0xe8e2d4, side: THREE.DoubleSide }));
    g.add(vane);
  }
  g.visible = false;
  return g;
}
