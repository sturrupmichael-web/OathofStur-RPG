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

export type RugPattern = 'medallion' | 'stripes' | 'checks' | 'lattice' | 'plain';

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

  /** Lime plaster for timber-framed upper floors: near white, softly mottled. */
  plaster: () =>
    make('plaster', (ctx, r) => {
      ctx.fillStyle = grey(236);
      ctx.fillRect(0, 0, SIZE, SIZE);
      for (let i = 0; i < 260; i++) {
        ctx.fillStyle = grey(205 + r(1) * 50, 0.35);
        ctx.beginPath();
        ctx.ellipse(r(2) * SIZE, r(3) * SIZE, 2 + r(4) * 7, 1.5 + r(5) * 5, r(6) * 3, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 4; i++) {
        ctx.strokeStyle = grey(190, 0.4);
        ctx.beginPath();
        let x = r(7) * SIZE;
        let y = r(8) * SIZE;
        ctx.moveTo(x, y);
        for (let k = 0; k < 3; k++) {
          x += (r(9) - 0.5) * 16;
          y += r(10) * 10;
          ctx.lineTo(x, y);
        }
        ctx.stroke();
      }
    }),

  /** Straw thatch: layered courses of fine stalks, in grey for tinting. */
  thatch: () =>
    make('thatch', (ctx, r) => {
      ctx.fillStyle = grey(150);
      ctx.fillRect(0, 0, SIZE, SIZE);
      const h = 21;
      for (let row = 0; row * h < SIZE + h; row++) {
        const y = row * h - 4;
        for (let i = 0; i < 160; i++) {
          const x = r(1) * SIZE;
          const len = h * (0.7 + r(1) * 0.5);
          ctx.strokeStyle = grey(165 + r(1) * 80);
          ctx.lineWidth = 1 + r(1);
          ctx.beginPath();
          ctx.moveTo(x, y);
          ctx.lineTo(x + (r(1) - 0.5) * 3, y + len);
          ctx.stroke();
        }
        // The shadowed lip of each course.
        ctx.fillStyle = 'rgba(0,0,0,0.22)';
        ctx.fillRect(0, y + h - 3, SIZE, 3);
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

  /**
   * A woven rug: base, trim and accent colours in one of several patterns,
   * drawn at the rug's own shape (`tall` is its depth over its width).
   */
  rug: (base: string, trim: string, accent: string, pattern: RugPattern, tall: number) => {
    const h = Math.round(SIZE * Math.min(2, Math.max(0.5, tall)));
    return make(
      `rug-${base}-${trim}-${accent}-${pattern}-${h}`,
      (ctx) => {
        const W = SIZE;
        ctx.fillStyle = base;
        ctx.fillRect(0, 0, W, h);
        const diamond = (cx: number, cy: number, rx: number, ry: number, colour: string) => {
          ctx.fillStyle = colour;
          ctx.beginPath();
          ctx.moveTo(cx, cy - ry);
          ctx.lineTo(cx + rx, cy);
          ctx.lineTo(cx, cy + ry);
          ctx.lineTo(cx - rx, cy);
          ctx.closePath();
          ctx.fill();
        };
        if (pattern === 'medallion') {
          diamond(W / 2, h / 2, W / 2 - 34, h / 2 - 34, trim);
          diamond(W / 2, h / 2, W / 4 - 12, h / 4 - 12, accent);
          ctx.fillStyle = base;
          ctx.beginPath();
          ctx.arc(W / 2, h / 2, 6, 0, Math.PI * 2);
          ctx.fill();
        } else if (pattern === 'stripes') {
          // Bands across the short way, wide and narrow.
          for (let y = 22, i = 0; y < h - 22; y += 14, i++) {
            ctx.fillStyle = i % 3 === 2 ? accent : trim;
            ctx.fillRect(20, y, W - 40, i % 3 === 2 ? 3 : 6);
          }
        } else if (pattern === 'checks') {
          const n = 6;
          const cw = (W - 40) / n;
          const ch = (h - 40) / Math.max(2, Math.round(n * (h / W)));
          for (let y = 20, j = 0; y < h - 21; y += ch, j++)
            for (let i = 0; i < n; i++)
              if ((i + j) % 2) {
                ctx.fillStyle = (i + j) % 4 === 1 ? trim : accent;
                ctx.fillRect(20 + i * cw, y, cw, ch);
              }
        } else if (pattern === 'lattice') {
          // Rows of small diamonds, like a kilim.
          for (let y = 30, j = 0; y < h - 24; y += 18, j++)
            for (let x = 30 + (j % 2) * 11; x < W - 24; x += 22) diamond(x, y, 7, 7, j % 2 ? accent : trim);
        } else {
          // Plain field with a scatter of flecks.
          ctx.fillStyle = accent;
          for (let i = 0; i < 40; i++) ctx.fillRect(24 + ((i * 37) % (W - 48)), 24 + ((i * 53) % (h - 48)), 3, 3);
        }
        // Border, and a fringe at the two short ends.
        ctx.strokeStyle = trim;
        ctx.lineWidth = 6;
        ctx.strokeRect(8, 8, W - 16, h - 16);
        ctx.strokeStyle = accent;
        ctx.lineWidth = 2;
        ctx.strokeRect(16, 16, W - 32, h - 32);
        ctx.fillStyle = '#e8dcc0';
        for (let x = 4; x < W - 4; x += 5) {
          ctx.fillRect(x, 0, 2, 5);
          ctx.fillRect(x, h - 5, 2, 5);
        }
      },
      [SIZE, h],
    );
  },

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
