import * as THREE from 'three';
import type { MapData, WorldGrid } from '@rpg/shared';
import { Batcher, lambert } from './batch';
import type { Heightmap } from './heightmap';
import { hash2, isWaterKey, shade, type Area, type TileInfo } from './palette';

/** A rectangle of tiles, x0..x1 and y0..y1 inclusive. */
export interface TileRect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/**
 * Purely decorative ground cover: grass tufts, flowers, mushrooms, pebbles,
 * reeds, lily pads and straw. Kept low and small so it never reads as
 * something that blocks a tile. Built per patch of map, so a region-sized
 * world only pays for the ground near the player (see SceneryChunks).
 */
export function buildScenery(
  map: MapData,
  grid: WorldGrid,
  info: TileInfo,
  areas: Area[],
  tileColors: number[],
  hm: Heightmap,
  rect: TileRect = { x0: 0, y0: 0, x1: map.width - 1, y1: map.height - 1 },
): THREE.Group {
  const batch = new Batcher((x, z) => hm.groundAt(x, z));
  const blade = new THREE.ConeGeometry(0.035, 0.2, 3);
  blade.translate(0, 0.1, 0);
  const petal = new THREE.IcosahedronGeometry(0.04, 0);
  const stem = new THREE.CylinderGeometry(0.008, 0.008, 0.14, 3);
  stem.translate(0, 0.07, 0);
  const pebble = new THREE.DodecahedronGeometry(0.06, 0);
  const capGeo = new THREE.SphereGeometry(0.07, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2);
  const reed = new THREE.CylinderGeometry(0.012, 0.016, 0.55, 4);
  reed.translate(0, 0.275, 0);
  const cattail = new THREE.CapsuleGeometry(0.025, 0.08, 2, 6);
  const pad = new THREE.CircleGeometry(0.16, 10, 0.3, Math.PI * 2 - 0.6).rotateX(-Math.PI / 2);
  const straw = new THREE.BoxGeometry(0.22, 0.015, 0.03);
  const plain = lambert();
  const noShadow = { cast: false, receive: true };

  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && isWaterKey(info.terrainKey[y * map.width + x]);
  const flowerColors = [0xffffff, 0xffe14d, 0xb57edc, 0xe8505b, 0x7ab8ff];
  const bedColors = [0xe8505b, 0xffe14d, 0xb57edc, 0xff9a40, 0xffffff];
  const wheat = new THREE.CylinderGeometry(0.01, 0.012, 0.42, 3);
  wheat.translate(0, 0.21, 0);
  const ear = new THREE.CapsuleGeometry(0.022, 0.07, 2, 4);
  const cabbage = new THREE.IcosahedronGeometry(0.1, 0);
  const leaf = new THREE.ConeGeometry(0.025, 0.2, 3).translate(0, 0.1, 0);
  const leek = new THREE.CylinderGeometry(0.022, 0.026, 0.16, 5).translate(0, 0.08, 0);
  const furrow = new THREE.BoxGeometry(0.92, 0.04, 0.16);
  const bone = new THREE.CylinderGeometry(0.014, 0.014, 0.2, 4).rotateZ(Math.PI / 2);
  const knob = new THREE.SphereGeometry(0.025, 5, 3);
  const skull = new THREE.SphereGeometry(0.06, 7, 5);
  const puddle = new THREE.CircleGeometry(0.2, 10).rotateX(-Math.PI / 2);

  for (let y = rect.y0; y <= rect.y1; y++) {
    for (let x = rect.x0; x <= rect.x1; x++) {
      const i = y * map.width + x;
      const key = info.terrainKey[i];
      const h = (salt: number) => hash2(x, y, salt);
      const at = (dx: number, dz: number): [number, number, number] => [x + 0.5 + dx, 0, y + 0.5 + dz];
      const pebbles = (n: number, chance: number, color: number) => {
        if (h(40) >= chance) return;
        for (let k = 0; k < n; k++) batch.add('pebble', pebble, plain, { position: at((h(41 + k) - 0.5) * 0.8, (h(44 + k) - 0.5) * 0.8), rotationY: h(47 + k) * 6, scale: 0.6 + h(50 + k) * 0.6 }, shade(color, 0.9 + h(53 + k) * 0.2), noShadow);
      };
      if (info.placementKey[i]) continue;

      switch (key) {
        case 'water': {
          // Lilies on ponds and the river, not in the fountain.
          if (areas[i] === 'town' || h(30) > 0.07) continue;
          const [px, , pz] = at((h(31) - 0.5) * 0.6, (h(32) - 0.5) * 0.6);
          const level = hm.waterAt(x, y);
          batch.add('lilypad', pad, lambert(0xffffff, { side: THREE.DoubleSide }), { position: [px, level + 0.01, pz], rotationY: h(33) * 6 }, 0x4f8a3a, { ...noShadow, absolute: true });
          if (h(34) < 0.4) batch.add('lily', petal, plain, { position: [px + 0.04, level + 0.04, pz], scale: [1, 0.6, 1] }, 0xf5b8d0, { ...noShadow, absolute: true });
          continue;
        }
        case 'dirt_path':
          pebbles(1, 0.18, 0x8a8478);
          continue;
        case 'cobblestone':
          pebbles(1, 0.06, 0x8a8478);
          continue;
        case 'sand':
          pebbles(2, 0.15, 0xb8a888);
          continue;
        case 'sandstone_paving':
          pebbles(1, 0.05, 0xb8a06e);
          continue;
        case 'swamp':
          // Rushes and muddy puddles.
          if (h(150) < 0.3) batch.add('puddle', puddle, plain, { position: at((h(151) - 0.5) * 0.6, (h(152) - 0.5) * 0.6), scale: [0.8 + h(153), 1, 0.6 + h(154) * 0.7] }, 0x2f3a24, noShadow);
          for (let k = 0; k < 3; k++) {
            if (h(155 + k) > 0.55) continue;
            batch.add('reed', reed, plain, { position: at((h(158 + k) - 0.5) * 0.8, (h(161 + k) - 0.5) * 0.8), scale: [1, 0.7 + h(164 + k) * 0.6, 1], rotation: [(h(167 + k) - 0.5) * 0.3, 0, (h(170 + k) - 0.5) * 0.3] }, 0x6a7a3a, noShadow);
          }
          continue;
        case 'lava':
          // Cooling crust: a few dark clinkers on the glow.
          for (let k = 0; k < 2; k++) if (h(180 + k) < 0.4) batch.add('clinker', pebble, plain, { position: at((h(183 + k) - 0.5) * 0.7, (h(186 + k) - 0.5) * 0.7), scale: 1 + h(189 + k) }, 0x2a1a16, noShadow);
          continue;
        case 'scorched_earth':
          pebbles(2, 0.3, 0x3e3a36);
          if (h(60) < 0.04) {
            // Charred stump
            batch.add('stump', new THREE.CylinderGeometry(0.08, 0.12, 0.22, 6).translate(0, 0.11, 0), plain, { position: at((h(61) - 0.5) * 0.5, (h(62) - 0.5) * 0.5), rotationY: h(63) * 6 }, 0x2a2622);
          }
          continue;
        case 'trampled_mud':
          if (h(70) < 0.2) batch.add('puddle', puddle, plain, { position: at((h(71) - 0.5) * 0.5, (h(72) - 0.5) * 0.5), scale: [1 + h(73), 1, 0.6 + h(74) * 0.6] }, 0x3e3226, noShadow);
          continue;
        case 'bone_scatter':
          for (let k = 0; k < 3; k++) {
            const [px, , pz] = at((h(80 + k) - 0.5) * 0.7, (h(83 + k) - 0.5) * 0.7);
            const yaw = h(86 + k) * 6;
            batch.add('bone', bone, plain, { position: [px, 0.02, pz], rotationY: yaw }, 0xe8e0c8, noShadow);
            for (const e of [-0.1, 0.1]) batch.add('bone-end', knob, plain, { position: [px + Math.cos(yaw) * e, 0.025, pz - Math.sin(yaw) * e] }, 0xe8e0c8, noShadow);
          }
          batch.add('skull', skull, plain, { position: at(0.15, -0.1), scale: [1, 0.85, 1.15], rotationY: h(89) * 6 }, 0xf0e8d4);
          continue;
        case 'flower_bed':
          for (let k = 0; k < 9; k++) {
            const [px, , pz] = at(((k % 3) - 1) * 0.3 + (h(90 + k) - 0.5) * 0.1, (Math.floor(k / 3) - 1) * 0.3 + (h(100 + k) - 0.5) * 0.1);
            batch.add('stem', stem, plain, { position: [px, 0, pz] }, 0x4a7a2a, noShadow);
            batch.add('flower', petal, plain, { position: [px, 0.15, pz], scale: 1.3 }, bedColors[Math.floor(h(110 + k) * bedColors.length)], noShadow);
          }
          continue;
        case 'crop_field':
          // Rows of wheat running east-west.
          for (const row of [-0.25, 0.25]) {
            for (let k = 0; k < 4; k++) {
              const [px, , pz] = at(-0.36 + k * 0.24 + (h(120 + k) - 0.5) * 0.06, row + (h(124 + k) - 0.5) * 0.06);
              const tilt: [number, number, number] = [(h(128 + k) - 0.5) * 0.25, 0, (h(132 + k) - 0.5) * 0.25];
              batch.add('wheat', wheat, plain, { position: [px, 0, pz], rotation: tilt }, 0xa89a4a, noShadow);
              batch.add('ear', ear, plain, { position: [px + tilt[2] * -0.4, 0.44, pz + tilt[0] * 0.4], rotation: tilt }, 0xe0c060, noShadow);
            }
          }
          continue;
        case 'vegetable_garden': {
          // Two rows of one crop per tile: cabbages, carrot tops or leeks.
          const crop = Math.floor(hash2(Math.floor(x / 2), y, 7) * 3);
          for (const row of [-0.22, 0.22]) {
            for (let k = 0; k < 3; k++) {
              const [px, , pz] = at(-0.3 + k * 0.3 + (h(140 + k) - 0.5) * 0.05, row + (h(144 + k) - 0.5) * 0.05);
              if (crop === 0) batch.add('cabbage', cabbage, plain, { position: [px, 0.07, pz], scale: [1, 0.8, 1], rotationY: h(148 + k) * 6 }, shade(0x7aa84a, 0.9 + h(150 + k) * 0.2), noShadow);
              else if (crop === 1)
                for (let n = 0; n < 3; n++) batch.add('carrot-top', leaf, plain, { position: [px + (n - 1) * 0.03, 0, pz], rotation: [(n - 1) * 0.35, 0, (h(152 + n) - 0.5) * 0.4] }, 0x5a9a3a, noShadow);
              else {
                batch.add('leek', leek, plain, { position: [px, 0, pz] }, 0xe8ecd8, noShadow);
                batch.add('leek-leaf', leaf, plain, { position: [px, 0.14, pz], rotation: [0.3, h(156 + k) * 6, 0], scale: [1.4, 1, 1.4] }, 0x4a8a4a, noShadow);
              }
            }
            // A furrow of dark earth along the row.
            const [fx, , fz] = at(0, row);
            batch.add('furrow', furrow, plain, { position: [fx, 0.0, fz] }, 0x4a3420, noShadow);
          }
          continue;
        }
        case 'grass':
        case 'long_grass':
          break;
        default:
          continue;
      }
      if (grid.blocked[i]) continue;
      const area = areas[i];
      const ground = tileColors[i];
      const long = key === 'long_grass';

      // Reeds where grass meets water.
      const shoreDir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => isWater(x + dx, y + dy));
      if (shoreDir && area !== 'town' && h(50) < 0.7) {
        const level = hm.waterAt(x + shoreDir[0], y + shoreDir[1]);
        for (let k = 0; k < 4; k++) {
          const ox = shoreDir[0] * 0.38 + (shoreDir[0] === 0 ? (h(51 + k) - 0.5) * 0.9 : (h(55 + k) - 0.5) * 0.15);
          const oz = shoreDir[1] * 0.38 + (shoreDir[1] === 0 ? (h(59 + k) - 0.5) * 0.9 : (h(63 + k) - 0.5) * 0.15);
          const tall = 0.7 + h(67 + k) * 0.5;
          const [px, , pz] = at(ox, oz);
          const base = Math.min(hm.groundAt(px, pz), level + 0.05);
          batch.add('reed', reed, plain, { position: [px, base, pz], scale: [1, tall, 1], rotation: [(h(70 + k) - 0.5) * 0.2, 0, (h(74 + k) - 0.5) * 0.2] }, 0x6f8f3a, { ...noShadow, absolute: true });
          if (k % 2 === 0) batch.add('cattail', cattail, plain, { position: [px, base + 0.55 * tall, pz] }, 0x6a4526, { ...noShadow, absolute: true });
        }
      }

      if (area === 'farm' && h(140) < 0.15) {
        for (let k = 0; k < 6; k++) {
          const [px, , pz] = at((h(80 + k) - 0.5) * 0.8, (h(86 + k) - 0.5) * 0.8);
          batch.add('straw', straw, plain, { position: [px, 0.01, pz], rotationY: h(92 + k) * 6 }, 0xe0c060, noShadow);
        }
      }

      // Tufts take the tile's own colour; long grass is thicker and taller.
      const tuftChance = long ? 0.95 : area === 'town' ? 0.25 : area === 'ash' ? 0.2 : 0.5;
      const tufts = long ? 2 : 1;
      for (let t = 0; t < tufts; t++) {
        if (h(1 + t * 200) >= tuftChance) continue;
        const cx = (h(2 + t * 200) - 0.5) * 0.7;
        const cz = (h(3 + t * 200) - 0.5) * 0.7;
        for (let k = 0; k < (long ? 6 : 4); k++) {
          const [px, , pz] = at(cx + (h(4 + k + t * 200) - 0.5) * 0.18, cz + (h(8 + k + t * 200) - 0.5) * 0.18);
          const tall = (long ? 1.3 : 0.7) + h(20 + k + t * 200) * 0.6;
          batch.add('tuft', blade, plain, { position: [px, 0, pz], rotation: [(h(12 + k) - 0.5) * 0.6, 0, (h(16 + k) - 0.5) * 0.6], scale: [1, tall, 1] }, shade(ground, 0.8 + h(24 + k) * 0.3), noShadow);
        }
      }
      if ((area === 'grass' || area === 'town' || area === 'farm') && h(100) < 0.08) {
        const color = flowerColors[Math.floor(h(101) * flowerColors.length)];
        for (let k = 0; k < 3; k++) {
          const [px, , pz] = at((h(102 + k) - 0.5) * 0.7, (h(105 + k) - 0.5) * 0.7);
          batch.add('stem', stem, plain, { position: [px, 0, pz] }, 0x4a7a2a, noShadow);
          batch.add('flower', petal, plain, { position: [px, 0.15, pz] }, color, noShadow);
        }
      }
      if (area === 'forest' && h(110) < 0.06) {
        const [px, , pz] = at((h(111) - 0.5) * 0.6, (h(112) - 0.5) * 0.6);
        batch.add('mush-stem', new THREE.CylinderGeometry(0.02, 0.025, 0.08, 5).translate(0, 0.04, 0), plain, { position: [px, 0, pz] }, 0xeee6d0, noShadow);
        batch.add('mush-cap', capGeo, plain, { position: [px, 0.07, pz] }, h(113) < 0.5 ? 0xc0392b : 0x8a5a3a, noShadow);
      }
    }
  }
  return batch.build();
}
