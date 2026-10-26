import * as THREE from 'three';
import { hash2 } from './palette';

/**
 * Procedural canvas textures. They are near-white so per-instance colours
 * still tint them (one grass texture serves forest, meadow and Hollowmere).
 * Deterministic: built from hash2, never Math.random.
 */

const SIZE = 128;
const cache = new Map<string, THREE.CanvasTexture>();

function make(key: string, draw: (ctx: CanvasRenderingContext2D, rnd: (n: number) => number) => void, size: [number, number] = [SIZE, SIZE]): THREE.CanvasTexture {
  const cached = cache.get(key);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  [canvas.width, canvas.height] = size;
  const ctx = canvas.getContext('2d')!;
  let n = 0;
  const salt = key.length * 31 + key.charCodeAt(0);
  draw(ctx, (k) => hash2(n++, k, salt));
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}

const grey = (v: number, a = 1) => `rgba(${v | 0},${v | 0},${v | 0},${a})`;

export const textures = {
  grass: () =>
    make('grass', (ctx, r) => {
      ctx.fillStyle = grey(225);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 900; i++) {
        const x = r(1) * SIZE;
        const y = r(2) * SIZE;
        const len = 3 + r(3) * 6;
        ctx.strokeStyle = grey(170 + r(4) * 85, 0.8);
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + (r(5) - 0.5) * 3, y - len);
        ctx.stroke();
      }
    }),

  dirt: () =>
    make('dirt', (ctx, r) => {
      ctx.fillStyle = grey(220);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 500; i++) {
        ctx.fillStyle = grey(150 + r(1) * 105, 0.7);
        const s = 1 + r(2) * 2.5;
        ctx.fillRect(r(3) * SIZE, r(4) * SIZE, s, s);
      }
      for (let i = 0; i < 14; i++) {
        ctx.fillStyle = grey(245);
        ctx.beginPath();
        ctx.ellipse(r(5) * SIZE, r(6) * SIZE, 2 + r(7) * 3, 1.5 + r(8) * 2, r(9) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
    }),

  cobble: () =>
    make('cobble', (ctx, r) => {
      ctx.fillStyle = grey(120);
      ctx.fillRect(0, 0, SIZE, SIZE);
      const cell = 16;
      for (let gy = 0; gy < SIZE / cell; gy++) {
        for (let gx = 0; gx < SIZE / cell; gx++) {
          const ox = (gy % 2) * (cell / 2);
          const cx = gx * cell + ox + (r(1) - 0.5) * 3;
          const cy = gy * cell + cell / 2 + (r(2) - 0.5) * 3;
          ctx.fillStyle = grey(195 + r(3) * 55);
          for (const dx of [0, -SIZE, SIZE]) {
            ctx.beginPath();
            ctx.ellipse(cx + dx, cy, cell * 0.44, cell * 0.4, r(4), 0, Math.PI * 2);
            ctx.fill();
          }
        }
      }
    }),

  planks: () =>
    make('planks', (ctx, r) => {
      const rows = 4;
      const h = SIZE / rows;
      for (let i = 0; i < rows; i++) {
        ctx.fillStyle = grey(200 + r(1) * 50);
        ctx.fillRect(0, i * h, SIZE, h);
        for (let g = 0; g < 7; g++) {
          ctx.strokeStyle = grey(150 + r(2) * 40, 0.5);
          ctx.beginPath();
          const y = i * h + 3 + r(3) * (h - 6);
          ctx.moveTo(0, y);
          ctx.bezierCurveTo(SIZE * 0.3, y + (r(4) - 0.5) * 4, SIZE * 0.7, y + (r(5) - 0.5) * 4, SIZE, y);
          ctx.stroke();
        }
        ctx.fillStyle = grey(90);
        ctx.fillRect(0, i * h, SIZE, 2);
        const seam = (i % 2 ? 0.3 : 0.75) * SIZE;
        ctx.fillRect(seam, i * h, 2, h);
        ctx.fillStyle = grey(70);
        ctx.fillRect(seam - 5, i * h + h / 2 - 1, 2, 2);
        ctx.fillRect(seam + 5, i * h + h / 2 - 1, 2, 2);
      }
    }),

  bricks: () =>
    make('bricks', (ctx, r) => {
      ctx.fillStyle = grey(110);
      ctx.fillRect(0, 0, SIZE, SIZE);
      const bh = 16;
      const bw = 32;
      for (let row = 0; row < SIZE / bh; row++) {
        const off = (row % 2) * (bw / 2);
        for (let col = -1; col <= SIZE / bw; col++) {
          ctx.fillStyle = grey(185 + r(1) * 65);
          ctx.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, bh - 3);
          ctx.fillStyle = grey(255, 0.12);
          ctx.fillRect(col * bw + off + 1.5, row * bh + 1.5, bw - 3, 2);
        }
      }
    }),

  shingles: () =>
    make('shingles', (ctx, r) => {
      ctx.fillStyle = grey(120);
      ctx.fillRect(0, 0, SIZE, SIZE);
      const h = 16;
      const w = 16;
      for (let row = 0; row < SIZE / h; row++) {
        const off = (row % 2) * (w / 2);
        for (let col = -1; col <= SIZE / w; col++) {
          ctx.fillStyle = grey(180 + r(1) * 70);
          ctx.beginPath();
          const x = col * w + off;
          const y = row * h;
          ctx.moveTo(x + 1, y);
          ctx.lineTo(x + w - 1, y);
          ctx.lineTo(x + w - 1, y + h * 0.65);
          ctx.quadraticCurveTo(x + w / 2, y + h + 2, x + 1, y + h * 0.65);
          ctx.closePath();
          ctx.fill();
        }
      }
    }),

  water: () =>
    make('water', (ctx, r) => {
      ctx.fillStyle = grey(230);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 40; i++) {
        ctx.strokeStyle = grey(255, 0.55);
        ctx.lineWidth = 1.5;
        const x = r(1) * SIZE;
        const y = r(2) * SIZE;
        const w = 8 + r(3) * 14;
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.quadraticCurveTo(x + w / 2, y - 3, x + w, y);
        ctx.stroke();
      }
    }),

  rock: () =>
    make('rock', (ctx, r) => {
      ctx.fillStyle = grey(215);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 300; i++) {
        ctx.fillStyle = grey(150 + r(1) * 105, 0.6);
        const s = 2 + r(2) * 5;
        ctx.fillRect(r(3) * SIZE, r(4) * SIZE, s, s * 0.6);
      }
      for (let i = 0; i < 6; i++) {
        ctx.strokeStyle = grey(110, 0.7);
        ctx.beginPath();
        let x = r(5) * SIZE;
        let y = r(6) * SIZE;
        ctx.moveTo(x, y);
        for (let k = 0; k < 4; k++) {
          x += (r(7) - 0.5) * 24;
          y += r(8) * 14;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }),

  rug: (base: string, trim: string) =>
    make(`rug-${base}-${trim}`, (ctx) => {
      ctx.fillStyle = base;
      ctx.fillRect(0, 0, SIZE, SIZE);
      ctx.strokeStyle = trim;
      ctx.lineWidth = 6;
      ctx.strokeRect(8, 8, SIZE - 16, SIZE - 16);
      ctx.lineWidth = 2;
      ctx.strokeRect(18, 18, SIZE - 36, SIZE - 36);
      ctx.fillStyle = trim;
      ctx.beginPath();
      ctx.moveTo(SIZE / 2, 34);
      ctx.lineTo(SIZE - 34, SIZE / 2);
      ctx.lineTo(SIZE / 2, SIZE - 34);
      ctx.lineTo(34, SIZE / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = base;
      ctx.beginPath();
      ctx.arc(SIZE / 2, SIZE / 2, 10, 0, Math.PI * 2);
      ctx.fill();
    }),

  /** Painted shop sign: a symbol and a name. */
  sign: (label: string, symbol: (ctx: CanvasRenderingContext2D) => void) =>
    make(
      `sign-${label}`,
      (ctx) => {
        ctx.fillStyle = '#6b4526';
        ctx.fillRect(0, 0, 256, 128);
        ctx.fillStyle = '#7d532f';
        for (let y = 0; y < 128; y += 32) ctx.fillRect(0, y + 2, 256, 28);
        ctx.strokeStyle = '#3a2412';
        ctx.lineWidth = 8;
        ctx.strokeRect(4, 4, 248, 120);
        ctx.save();
        ctx.translate(64, 64);
        symbol(ctx);
        ctx.restore();
        ctx.fillStyle = '#f3dfae';
        ctx.font = 'bold 30px Georgia, serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, 172, 66, 150);
      },
      [256, 128],
    ),
};
