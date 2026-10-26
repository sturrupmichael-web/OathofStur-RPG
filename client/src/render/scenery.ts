import * as THREE from 'three';
import type { MapData, WorldGrid } from '@rpg/shared';
import { Batcher, lambert } from './batch';
import { WATER_Y, type Heightmap } from './heightmap';
import { hash2, shade, type Area, type TileInfo } from './palette';

/**
 * Purely decorative ground cover: grass tufts, flowers, mushrooms, pebbles,
 * reeds, lily pads and straw. Kept low and small so it never reads as
 * something that blocks a tile.
 */
export function buildScenery(map: MapData, grid: WorldGrid, info: TileInfo, areas: Area[], tileColors: number[], hm: Heightmap): THREE.Group {
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

  const isWater = (x: number, y: number) => x >= 0 && y >= 0 && x < map.width && y < map.height && info.terrainKey[y * map.width + x] === 'water';
  const flowerColors = [0xffffff, 0xffe14d, 0xb57edc, 0xe8505b, 0x7ab8ff];

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const key = info.terrainKey[i];
      const h = (salt: number) => hash2(x, y, salt);
      const at = (dx: number, dz: number): [number, number, number] => [x + 0.5 + dx, 0, y + 0.5 + dz];

      if (key === 'water') {
        if (info.placementKey[i] || h(30) > 0.07) continue;
        const [px, , pz] = at((h(31) - 0.5) * 0.6, (h(32) - 0.5) * 0.6);
        batch.add('lilypad', pad, lambert(0xffffff, { side: THREE.DoubleSide }), { position: [px, WATER_Y + 0.01, pz], rotationY: h(33) * 6 }, 0x4f8a3a, { ...noShadow, absolute: true });
        if (h(34) < 0.4) batch.add('lily', petal, plain, { position: [px + 0.04, WATER_Y + 0.04, pz], scale: [1, 0.6, 1] }, 0xf5b8d0, { ...noShadow, absolute: true });
        continue;
      }
      if (key === 'dirt_path' || key === 'road') {
        if (h(40) < 0.18) batch.add('pebble', pebble, plain, { position: at((h(41) - 0.5) * 0.8, (h(42) - 0.5) * 0.8), rotationY: h(43) * 6, scale: 0.6 + h(44) * 0.5 }, shade(0x8a8478, 0.9 + h(45) * 0.2), noShadow);
        continue;
      }
      if (key !== 'grass' || grid.blocked[i]) continue;
      const area = areas[i];
      const ground = tileColors[i];

      // Reeds where grass meets the river.
      const shoreDir = [[1, 0], [-1, 0], [0, 1], [0, -1]].find(([dx, dy]) => isWater(x + dx, y + dy));
      if (shoreDir && h(50) < 0.7) {
        for (let k = 0; k < 4; k++) {
          const ox = shoreDir[0] * 0.38 + (shoreDir[0] === 0 ? (h(51 + k) - 0.5) * 0.9 : (h(55 + k) - 0.5) * 0.15);
          const oz = shoreDir[1] * 0.38 + (shoreDir[1] === 0 ? (h(59 + k) - 0.5) * 0.9 : (h(63 + k) - 0.5) * 0.15);
          const tall = 0.7 + h(67 + k) * 0.5;
          const [px, , pz] = at(ox, oz);
          batch.add('reed', reed, plain, { position: [px, 0, pz], scale: [1, tall, 1], rotation: [(h(70 + k) - 0.5) * 0.2, 0, (h(74 + k) - 0.5) * 0.2] }, 0x6f8f3a, noShadow);
          if (k % 2 === 0) batch.add('cattail', cattail, plain, { position: [px, 0.55 * tall, pz] }, 0x6a4526, noShadow);
        }
      }

      if (area === 'pen') {
        for (let k = 0; k < 6; k++) {
          const [px, , pz] = at((h(80 + k) - 0.5) * 0.8, (h(86 + k) - 0.5) * 0.8);
          batch.add('straw', straw, plain, { position: [px, 0.01, pz], rotationY: h(92 + k) * 6 }, 0xe0c060, noShadow);
        }
        continue;
      }

      // Grass tufts take the tile's own colour, so Hollowmere's are ashen.
      const tuftChance = area === 'town' ? 0.25 : area === 'mine' ? 0.2 : 0.55;
      if (h(1) < tuftChance) {
        const cx = (h(2) - 0.5) * 0.6;
        const cz = (h(3) - 0.5) * 0.6;
        for (let k = 0; k < 4; k++) {
          const [px, , pz] = at(cx + (h(4 + k) - 0.5) * 0.14, cz + (h(8 + k) - 0.5) * 0.14);
          batch.add('tuft', blade, plain, { position: [px, 0, pz], rotation: [(h(12 + k) - 0.5) * 0.6, 0, (h(16 + k) - 0.5) * 0.6], scale: [1, 0.7 + h(20 + k) * 0.6, 1] }, shade(ground, 0.8 + h(24 + k) * 0.3), noShadow);
        }
      }
      if ((area === 'grass' || area === 'town') && h(100) < 0.08) {
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
      if ((area === 'mine' || area === 'hollowmere') && h(120) < 0.22) {
        for (let k = 0; k < 2; k++) {
          batch.add('pebble', pebble, plain, { position: at((h(121 + k) - 0.5) * 0.8, (h(123 + k) - 0.5) * 0.8), rotationY: h(125 + k) * 6, scale: 0.6 + h(127 + k) * 0.8 }, shade(area === 'mine' ? 0x8a8478 : 0x55524c, 0.9 + h(129) * 0.2), noShadow);
        }
      }
    }
  }
  return batch.build();
}
