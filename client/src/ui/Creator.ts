import * as THREE from 'three';
import {
  BOOT_COLOURS,
  CLOTH_COLOURS,
  HAIR_COLOURS,
  HAIR_STYLES,
  SKIN_TONES,
  cleanName,
  randomAppearance,
  type Appearance,
  type HairStyle,
} from '@rpg/shared';
import { animateCharacter, buildCharacter, styleForLook, type CharacterRig } from '../render/character';
import { disposeModel } from '../render/dispose';

const HAIR_LABELS: Record<HairStyle, string> = { short: 'Short', long: 'Long', bun: 'Bun', ponytail: 'Ponytail', spiky: 'Spiky', none: 'Bald' };

type ColourKey = 'skin' | 'hair' | 'shirt' | 'trousers' | 'boots';
const SWATCHES: { key: ColourKey; label: string; colours: number[] }[] = [
  { key: 'skin', label: 'Skin', colours: SKIN_TONES },
  { key: 'hair', label: 'Hair colour', colours: HAIR_COLOURS },
  { key: 'shirt', label: 'Shirt', colours: CLOTH_COLOURS },
  { key: 'trousers', label: 'Trousers', colours: CLOTH_COLOURS },
  { key: 'boots', label: 'Boots', colours: BOOT_COLOURS },
];

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The character creator: body, hair and clothing colours, with a turning
 * preview lit like the game. Shown once for a new character (with a name to
 * pick) and any time after from Options.
 */
export class Creator {
  private readonly root: HTMLElement;
  private readonly controls: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly nameRow: HTMLElement;
  private readonly title: HTMLElement;
  private readonly cancel: HTMLButtonElement;
  private readonly error: HTMLElement;
  private look: Appearance = randomAppearance({ next: Math.random });
  private first = false;
  private done: ((result: { look: Appearance; name?: string } | null) => void) | null = null;

  private renderer: THREE.WebGLRenderer | null = null;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(26, 0.75, 0.1, 20);
  private rig: CharacterRig | null = null;
  private yaw = 0.35;
  private dragX: number | null = null;
  private last = 0;
  private running = false;

  constructor() {
    this.root = document.createElement('div');
    this.root.id = 'creator';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.innerHTML = `
      <div class="creator-box">
        <div class="creator-title"></div>
        <div class="creator-main">
          <div class="creator-preview"><canvas aria-label="Preview of your character"></canvas><span class="muted">Drag to turn</span></div>
          <div class="creator-controls">
            <label class="creator-name">Name <input maxlength="12" autocomplete="off" spellcheck="false" placeholder="Your name" /></label>
            <p class="creator-error" hidden></p>
          </div>
        </div>
        <div class="creator-foot">
          <button class="creator-random">Random</button>
          <button class="creator-cancel">Cancel</button>
          <button class="creator-done">Done</button>
        </div>
      </div>`;
    document.body.appendChild(this.root);
    this.title = this.root.querySelector('.creator-title')!;
    this.controls = this.root.querySelector('.creator-controls')!;
    this.nameRow = this.root.querySelector('.creator-name')!;
    this.nameInput = this.nameRow.querySelector('input')!;
    this.error = this.root.querySelector('.creator-error')!;
    this.cancel = this.root.querySelector('.creator-cancel')!;

    this.addChoice('Body', [
      ['male', 'Male'],
      ['female', 'Female'],
    ], () => this.look.body, (v) => (this.look.body = v as Appearance['body']));
    this.addChoice('Hair', HAIR_STYLES.map((h) => [h, HAIR_LABELS[h]]), () => this.look.hairStyle, (v) => (this.look.hairStyle = v as HairStyle));
    this.addChoice('Beard', [
      ['no', 'None'],
      ['yes', 'Beard'],
    ], () => (this.look.beard ? 'yes' : 'no'), (v) => (this.look.beard = v === 'yes'));
    for (const s of SWATCHES) this.addSwatches(s.key, s.label, s.colours);

    this.root.querySelector<HTMLButtonElement>('.creator-random')!.onclick = () => {
      this.look = randomAppearance({ next: Math.random });
      this.refresh();
    };
    this.cancel.onclick = () => this.close(null);
    this.root.querySelector<HTMLButtonElement>('.creator-done')!.onclick = () => this.finish();
    this.nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.finish();
    });

    const canvas = this.root.querySelector('canvas')!;
    canvas.addEventListener('pointerdown', (e) => {
      this.dragX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (this.dragX === null) return;
      this.yaw += (e.clientX - this.dragX) * 0.012;
      this.dragX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (this.dragX = null));
    canvas.addEventListener('pointercancel', () => (this.dragX = null));

    this.scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a4030, 0.95));
    const sun = new THREE.DirectionalLight(0xfff1d6, 2.1);
    sun.position.set(-3, 4, 4);
    this.scene.add(sun);
    this.camera.position.set(0, 0.85, 3.1);
    this.camera.lookAt(0, 0.62, 0);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /**
   * Opens the creator on a look (a random one if none) and resolves with the
   * choice, or null if cancelled. `first` asks for a name and can't be cancelled.
   */
  open(opts: { look?: Appearance; first: boolean; name?: string }): Promise<{ look: Appearance; name?: string } | null> {
    this.first = opts.first;
    this.look = { ...(opts.look ?? randomAppearance({ next: Math.random })) };
    this.title.textContent = opts.first ? 'Make your character' : 'Change your look';
    this.nameRow.hidden = !opts.first;
    this.nameInput.value = opts.name && opts.name !== 'Wanderer' ? opts.name : '';
    this.cancel.hidden = opts.first;
    this.error.hidden = true;
    this.root.hidden = false;
    this.refresh();
    this.start();
    if (opts.first) setTimeout(() => this.nameInput.focus(), 50);
    return new Promise((resolve) => (this.done = resolve));
  }

  private finish(): void {
    if (!this.first) return this.close({ look: { ...this.look } });
    const name = cleanName(this.nameInput.value);
    if (!name) {
      this.error.textContent = 'Pick a name of up to 12 letters, starting with a letter.';
      this.error.hidden = false;
      this.nameInput.focus();
      return;
    }
    this.close({ look: { ...this.look }, name });
  }

  private close(result: { look: Appearance; name?: string } | null): void {
    this.root.hidden = true;
    this.running = false;
    const done = this.done;
    this.done = null;
    done?.(result);
  }

  private addChoice(label: string, options: [string, string][], get: () => string, set: (v: string) => void): void {
    const row = this.row(label);
    for (const [value, text] of options) {
      const b = document.createElement('button');
      b.textContent = text;
      b.dataset.value = value;
      b.onclick = () => {
        set(value);
        this.refresh();
      };
      row.appendChild(b);
    }
    this.readers.push(() => row.querySelectorAll<HTMLButtonElement>('button').forEach((b) => b.classList.toggle('on', b.dataset.value === get())));
  }

  private addSwatches(key: ColourKey, label: string, colours: number[]): void {
    const row = this.row(label);
    row.classList.add('swatches');
    colours.forEach((c, i) => {
      const b = document.createElement('button');
      b.style.background = hex(c);
      b.setAttribute('aria-label', `${label} ${i + 1}`);
      b.onclick = () => {
        this.look[key] = i;
        this.refresh();
      };
      row.appendChild(b);
    });
    this.readers.push(() => row.querySelectorAll('button').forEach((b, i) => b.classList.toggle('on', i === this.look[key])));
  }

  private readonly readers: (() => void)[] = [];

  private row(label: string): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'creator-row';
    const name = document.createElement('span');
    name.textContent = label;
    const row = document.createElement('div');
    wrap.append(name, row);
    this.controls.insertBefore(wrap, this.error);
    return row;
  }

  /** Shows the current choice on the buttons and rebuilds the preview. */
  private refresh(): void {
    for (const read of this.readers) read();
    if (this.rig) {
      this.scene.remove(this.rig.root);
      disposeModel(this.rig.root);
    }
    this.rig = buildCharacter(styleForLook(this.look), 7, true);
    this.scene.add(this.rig.root);
  }

  private start(): void {
    const canvas = this.root.querySelector('canvas')!;
    if (!this.renderer) {
      this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    }
    const { clientWidth: w, clientHeight: h } = canvas;
    this.renderer.setSize(w || 210, h || 280, false);
    this.camera.aspect = (w || 210) / (h || 280);
    this.camera.updateProjectionMatrix();
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    const frame = (now: number) => {
      if (!this.running || !this.renderer || !this.rig) return;
      const dt = Math.min(0.1, (now - this.last) / 1000);
      this.last = now;
      if (this.dragX === null) this.yaw += dt * 0.5;
      this.rig.root.rotation.y = this.yaw;
      animateCharacter(this.rig, dt, now, false);
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }
}
