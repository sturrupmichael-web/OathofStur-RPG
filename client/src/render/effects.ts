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

/** A spark of magic: a glowing sprite that drifts, shrinks or swells, and fades. */
interface Spark {
  sprite: THREE.Sprite;
  velocity: THREE.Vector3;
  born: number;
  life: number;
  size: number;
  /** How much it swells (above 0) or shrinks over its life. */
  grow: number;
  /** Pulls it down (above 0) or up. */
  gravity: number;
}

/** A spell in flight: a bright core trailing sparks, bursting where it lands. */
interface Bolt {
  core: THREE.Sprite;
  /** A wider, softer glow of the element's colour round the core. */
  halo: THREE.Sprite;
  from: () => THREE.Vector3 | null;
  to: () => THREE.Vector3 | null;
  start: number;
  ms: number;
  color: THREE.Color;
  tier: number;
  /** A miss puffs out instead of bursting. */
  miss: boolean;
  owed: number;
  last: THREE.Vector3 | null;
}

/** Sparks pouring from a spot for a while: a teleport's column, a chant's ring, a glow in the hands. */
interface Fountain {
  at: () => THREE.Vector3 | null;
  color: THREE.Color;
  start: number;
  ms: number;
  rate: number;
  kind: 'rise' | 'ring' | 'hands' | 'fall';
  owed: number;
}

/** What each element looks like in flight. */
export const ELEMENT_COLOURS: Record<string, number> = { wind: 0xdff2ff, tide: 0x3d8bff, root: 0x8fbf4a, ember: 0xff7a1a };

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
  private readonly sparks: Spark[] = [];
  private readonly bolts: Bolt[] = [];
  private readonly fountains: Fountain[] = [];
  private readonly flash = new THREE.PointLight(0xffffff, 0, 5, 1.6);
  private flashUntil = 0;
  private readonly light = new THREE.PointLight(0xff7a2a, 0, 6, 1.6);
  private readonly mouth = new THREE.Vector3();
  private readonly ahead = new THREE.Vector3();
  private readonly turn = new THREE.Quaternion();

  constructor() {
    this.group.add(this.light, this.flash);
  }

  /** Throws a spell from one point to another, landing `ms` after `start`. */
  bolt(from: () => THREE.Vector3 | null, to: () => THREE.Vector3 | null, start: number, ms: number, element: string, tier: number, miss: boolean): void {
    const color = new THREE.Color(ELEMENT_COLOURS[element] ?? 0xffffff);
    const core = this.sprite(THREE.AdditiveBlending);
    core.visible = false;
    core.material.color.copy(color).lerp(new THREE.Color(0xffffff), 0.35);
    core.material.opacity = 1;
    const halo = this.sprite(element === 'wind' ? THREE.AdditiveBlending : THREE.NormalBlending);
    halo.visible = false;
    halo.material.color.copy(color);
    halo.material.opacity = 0.55;
    this.bolts.push({ core, halo, from, to, start, ms, color, tier, miss, owed: 0, last: null });
  }

  /** Sparks pouring from a spot for `ms` from `start`. */
  fountain(at: () => THREE.Vector3 | null, color: number, start: number, ms: number, kind: Fountain['kind'], rate = 60): void {
    this.fountains.push({ at, color: new THREE.Color(color), start, ms, rate, kind, owed: 0 });
  }

  /** A burst of sparks flying out from a point, with a flash of light. */
  burst(at: THREE.Vector3, color: number | THREE.Color, count: number, speed: number, now: number, light = 0): void {
    const c = color instanceof THREE.Color ? color : new THREE.Color(color);
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.3, Math.random() - 0.5).normalize().multiplyScalar(speed * (0.5 + Math.random() * 0.7));
      this.spark(at, v, c, 0.35 + Math.random() * 0.3, 0.09 + Math.random() * 0.06, -0.6, 1.5);
    }
    if (light) {
      this.flash.position.copy(at);
      this.flash.color.copy(c);
      this.flash.intensity = light;
      this.flashUntil = now + 180;
    }
  }

  private sprite(blending: THREE.Blending): THREE.Sprite {
    const s =
      this.spare.pop() ??
      (() => {
        const made = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture(), transparent: true, depthWrite: false }));
        this.group.add(made);
        return made;
      })();
    s.material.blending = blending;
    s.visible = true;
    return s;
  }

  private spark(at: THREE.Vector3, velocity: THREE.Vector3, color: THREE.Color, life: number, size: number, grow: number, gravity: number): void {
    const sprite = this.sprite(THREE.AdditiveBlending);
    sprite.position.copy(at);
    sprite.material.color.copy(color);
    sprite.scale.setScalar(size);
    this.sparks.push({ sprite, velocity, born: performance.now() / 1000, life, size, grow, gravity });
  }

  private updateMagic(now: number, dt: number): void {
    const white = new THREE.Color(0xffffff);
    for (let i = this.bolts.length - 1; i >= 0; i--) {
      const b = this.bolts[i];
      const u = (now - b.start) / b.ms;
      const from = b.from();
      const to = b.to();
      if (u >= 1 || !from || !to) {
        b.core.visible = false;
        b.halo.visible = false;
        this.spare.push(b.core, b.halo);
        this.bolts.splice(i, 1);
        if (to && u >= 1) {
          if (b.miss) this.burst(to, 0x9fb4c8, 10, 1.2, now);
          else this.burst(to, b.color, 14 + b.tier * 8, 1.6 + b.tier * 0.5, now, 2 + b.tier);
        }
        continue;
      }
      if (u < 0) continue;
      // A little wobble on the way, more for the stronger spells.
      const at = from.clone().lerp(to, u);
      at.y += Math.sin(u * Math.PI) * 0.15 + Math.sin(now / 40) * 0.02 * b.tier;
      const size = 0.18 + 0.08 * b.tier;
      b.core.position.copy(at);
      b.core.scale.setScalar(size * (0.9 + Math.sin(now / 30) * 0.12));
      b.core.visible = true;
      b.halo.position.copy(at);
      b.halo.scale.setScalar(size * (2.1 + Math.sin(now / 45) * 0.2));
      b.halo.visible = true;
      // The light travels with the newest spell.
      this.flash.position.copy(at);
      this.flash.color.copy(b.color);
      this.flash.intensity = 1.5 + b.tier * 0.6;
      this.flashUntil = now + 60;
      b.owed += dt * (40 + b.tier * 25);
      for (; b.owed >= 1; b.owed--) {
        const jitter = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(0.4 + 0.2 * b.tier);
        this.spark(at, jitter, Math.random() < 0.3 ? white : b.color, 0.25 + Math.random() * 0.2, size * 0.6, -0.8, 0);
      }
      b.last = at;
    }

    for (let i = this.fountains.length - 1; i >= 0; i--) {
      const f = this.fountains[i];
      const u = (now - f.start) / f.ms;
      const at = f.at();
      if (u >= 1 || !at) {
        this.fountains.splice(i, 1);
        continue;
      }
      if (u < 0) continue;
      f.owed += dt * f.rate;
      for (; f.owed >= 1; f.owed--) {
        const a = Math.random() * Math.PI * 2;
        if (f.kind === 'rise') {
          // A column of light rising round the caster.
          const r = 0.25 + Math.random() * 0.15;
          const p = at.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.3, Math.sin(a) * r));
          this.spark(p, new THREE.Vector3(-Math.sin(a) * 0.4, 1.6 + Math.random() * 1.2, Math.cos(a) * 0.4), f.color, 0.7, 0.1, -0.5, 0);
        } else if (f.kind === 'fall') {
          // Arriving: sparks drift down and out.
          const p = at.clone().add(new THREE.Vector3(Math.cos(a) * 0.15, 1.4 + Math.random() * 0.4, Math.sin(a) * 0.15));
          this.spark(p, new THREE.Vector3(Math.cos(a) * 0.8, -1.4, Math.sin(a) * 0.8), f.color, 0.8, 0.1, -0.6, 0);
        } else if (f.kind === 'ring') {
          // A slow circle of light on the ground that tightens as the chant goes on.
          const r = 0.7 - 0.35 * u;
          const p = at.clone().add(new THREE.Vector3(Math.cos(a) * r, 0.05, Math.sin(a) * r));
          this.spark(p, new THREE.Vector3(-Math.sin(a) * 0.5, 0.25 + u * 0.8, Math.cos(a) * 0.5), f.color, 0.9, 0.07 + 0.04 * u, 0.2, 0);
        } else {
          // A glow between the hands.
          const p = at.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12, (Math.random() - 0.5) * 0.12));
          this.spark(p, new THREE.Vector3(Math.cos(a) * 0.2, 0.5 + Math.random() * 0.4, Math.sin(a) * 0.2), f.color, 0.45, 0.08, -0.4, 0);
        }
      }
    }

    const t = now / 1000;
    for (let i = this.sparks.length - 1; i >= 0; i--) {
      const s = this.sparks[i];
      const age = (performance.now() / 1000 - s.born) / s.life;
      if (age >= 1) {
        s.sprite.visible = false;
        this.spare.push(s.sprite);
        this.sparks.splice(i, 1);
        continue;
      }
      s.sprite.position.addScaledVector(s.velocity, dt);
      s.velocity.y -= s.gravity * dt;
      s.velocity.multiplyScalar(1 - dt * 1.2);
      s.sprite.scale.setScalar(Math.max(0.01, s.size * (1 + s.grow * age)));
      s.sprite.material.opacity = (1 - age) * (0.8 + Math.sin(t * 30 + i) * 0.2);
    }
    this.flash.intensity = now < this.flashUntil ? this.flash.intensity * (1 - dt * 8) : 0;
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
    this.updateMagic(now, dt);
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
