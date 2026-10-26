export interface PointerHandlers {
  /** Left click or a quick tap. Coordinates are client (page) pixels. */
  tap(x: number, y: number): void;
  /** Right click, or press-and-hold on a touch screen. */
  menu(x: number, y: number): void;
  /** A held finger started dragging after all: take the menu back. */
  menuCancel(): void;
  /** Mouse hover; null when the mouse leaves. Touch never hovers. */
  hover(x: number, y: number): void;
  hoverEnd(): void;
  rotate(radians: number): void;
  tilt(radians: number): void;
  zoom(factor: number): void;
}

interface Tracked {
  x: number;
  y: number;
  startX: number;
  startY: number;
  type: string;
  button: number;
}

const LONG_PRESS_MS = 450;
const TAP_SLOP = 10;

/**
 * Turns mouse, pen and touch input into game gestures:
 * tap/click to walk, hold/right-click for options, drag to rotate and tilt,
 * pinch/wheel to zoom, two-finger twist to rotate.
 */
export class PointerInput {
  private readonly pointers = new Map<number, Tracked>();
  private longPress: ReturnType<typeof setTimeout> | null = null;
  /** Set once a gesture becomes a drag, pinch or long press, so release isn't a tap. */
  private consumed = false;
  private pinch: { dist: number; angle: number } | null = null;
  private lastType = 'mouse';
  private longPressed = false;

  constructor(
    private readonly el: HTMLElement,
    private readonly h: PointerHandlers,
  ) {
    el.addEventListener('pointerdown', (e) => this.down(e));
    el.addEventListener('pointermove', (e) => this.move(e));
    el.addEventListener('pointerup', (e) => this.up(e));
    el.addEventListener('pointercancel', (e) => this.cancel(e));
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') h.hoverEnd();
    });
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      // Touch browsers fire this on long press too; that case is handled by our timer.
      if (this.lastType === 'mouse') h.menu(e.clientX, e.clientY);
    });
    el.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        h.zoom(e.deltaY > 0 ? 0.9 : 1.1);
      },
      { passive: false },
    );
  }

  private down(e: PointerEvent): void {
    this.lastType = e.pointerType;
    if (e.button === 1) e.preventDefault();
    this.el.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, type: e.pointerType, button: e.button });
    if (this.pointers.size === 1) {
      this.consumed = false;
      this.longPressed = false;
      if (e.pointerType !== 'mouse') {
        this.longPress = setTimeout(() => {
          this.longPress = null;
          const p = this.pointers.get(e.pointerId);
          if (!p || this.consumed) return;
          this.consumed = true;
          this.longPressed = true;
          navigator.vibrate?.(12);
          this.h.menu(p.x, p.y);
        }, LONG_PRESS_MS);
      }
    } else {
      this.cancelLongPress();
      this.consumed = true;
      this.pinch = this.twoFinger();
    }
  }

  private move(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) {
      if (e.pointerType === 'mouse') this.h.hover(e.clientX, e.clientY);
      return;
    }
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;

    if (this.pointers.size >= 2) {
      const now = this.twoFinger();
      if (now && this.pinch) {
        if (this.pinch.dist > 0) this.h.zoom(now.dist / this.pinch.dist);
        let turn = now.angle - this.pinch.angle;
        if (turn > Math.PI) turn -= Math.PI * 2;
        if (turn < -Math.PI) turn += Math.PI * 2;
        this.h.rotate(-turn);
      }
      this.pinch = now;
      return;
    }

    const far = Math.hypot(p.x - p.startX, p.y - p.startY) > TAP_SLOP;
    if (far && !this.consumed) {
      this.consumed = true;
      this.cancelLongPress();
    }
    // On a busy frame the hold timer can fire before the first move arrives.
    if (far && this.longPressed) {
      this.longPressed = false;
      this.h.menuCancel();
    }
    // Touch drags always steer the camera; the mouse uses middle button or shift-drag.
    const steer = p.type !== 'mouse' || p.button === 1 || (p.button === 0 && e.shiftKey);
    if (this.consumed && steer) {
      this.h.rotate(-dx * 0.008);
      this.h.tilt(dy * 0.005);
    }
    if (p.type === 'mouse' && !this.consumed) this.h.hover(e.clientX, e.clientY);
  }

  private up(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    if (this.pointers.size < 2) this.pinch = null;
    if (!p) return;
    const isPrimary = p.type !== 'mouse' || p.button === 0;
    if (this.pointers.size === 0 && !this.consumed && isPrimary) this.h.tap(e.clientX, e.clientY);
    if (this.pointers.size === 0) this.consumed = false;
  }

  private cancel(e: PointerEvent): void {
    this.pointers.delete(e.pointerId);
    this.cancelLongPress();
    this.pinch = null;
    this.consumed = this.pointers.size > 0;
  }

  private cancelLongPress(): void {
    if (this.longPress) clearTimeout(this.longPress);
    this.longPress = null;
  }

  private twoFinger(): { dist: number; angle: number } | null {
    const [a, b] = [...this.pointers.values()];
    if (!a || !b) return null;
    return { dist: Math.hypot(b.x - a.x, b.y - a.y), angle: Math.atan2(b.y - a.y, b.x - a.x) };
  }
}
