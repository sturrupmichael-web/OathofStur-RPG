import * as THREE from 'three';
import type { MapData, WorldGrid } from '@rpg/shared';
import type { Building } from './buildings';
import { WALL_HEIGHT } from './buildings';
import { hash2, isBridge, shade, type TileInfo } from './palette';
import { textures } from './textures';

export const WATER_TOP = -0.18;

/** Static world geometry built once from map data. */
export interface TerrainLayer {
  group: THREE.Group;
  /** Meshes worth raycasting for clicks (tall things that hide the ground). */
  pickables: THREE.Object3D[];
  /** Scrolled each frame so the river flows. */
  waterTexture: THREE.Texture;
}

/** InstancedMesh that remembers which tile each instance belongs to, for picking. */
function tiledMesh(geo: THREE.BufferGeometry, material: THREE.Material, count: number): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, material, Math.max(1, count));
  mesh.count = 0;
  mesh.userData.tileOf = new Int32Array(Math.max(1, count));
  return mesh;
}

function pushInstance(mesh: THREE.InstancedMesh, matrix: THREE.Matrix4, color: number, tile: number): void {
  const i = mesh.count++;
  mesh.setMatrixAt(i, matrix);
  mesh.setColorAt(i, new THREE.Color(color));
  (mesh.userData.tileOf as Int32Array)[i] = tile;
}

function finish(mesh: THREE.InstancedMesh, shadows: { cast?: boolean; receive?: boolean }): THREE.InstancedMesh {
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  mesh.castShadow = !!shadows.cast;
  mesh.receiveShadow = !!shadows.receive;
  mesh.computeBoundingSphere();
  return mesh;
}

export function buildTerrain(map: MapData, grid: WorldGrid, info: TileInfo, tileColors: number[], buildings: Building[]): TerrainLayer {
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const size = map.width * map.height;
  const textured = (tex: THREE.Texture, flat = false) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, flatShading: flat });

  const box = new THREE.BoxGeometry(1, 1, 1);
  // One ground mesh per surface texture; instance colours carry the area tint.
  const groundByKey: Record<string, THREE.InstancedMesh> = {
    grass: tiledMesh(box, textured(textures.grass()), size),
    road: tiledMesh(box, textured(textures.cobble()), size),
    dirt: tiledMesh(box, textured(textures.dirt()), size),
    planks: tiledMesh(box, textured(textures.planks()), size),
    stone: tiledMesh(box, textured(textures.rock()), size),
  };
  const surfaceFor = (key: string, bridge: boolean) => {
    if (bridge || key === 'floor' || key === 'door') return 'planks';
    if (key === 'road') return 'road';
    if (key === 'dirt_path' || key === 'gate') return 'dirt';
    if (key === 'mountain' || key === 'wall') return 'stone';
    return 'grass';
  };
  const waterTexture = textures.water().clone();
  waterTexture.needsUpdate = true;
  const water = tiledMesh(box, new THREE.MeshLambertMaterial({ color: 0xffffff, map: waterTexture, transparent: true, opacity: 0.93 }), size);
  const mountainBase = tiledMesh(box, textured(textures.rock()), size);
  const peakGeo = new THREE.CylinderGeometry(0.1, 0.62, 1, 5);
  peakGeo.translate(0, 0.5, 0);
  const peaks = tiledMesh(peakGeo, textured(textures.rock(), true), size);
  const snowGeo = new THREE.CylinderGeometry(0.115, 0.26, 0.27, 5);
  snowGeo.translate(0, 0.87, 0);
  const snow = tiledMesh(snowGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), size);
  const walls = tiledMesh(box, textured(textures.bricks()), size);
  const postGeo = new THREE.BoxGeometry(0.12, 0.75, 0.12);
  postGeo.translate(0, 0.375, 0);
  const posts = tiledMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), size);
  const railGeo = new THREE.BoxGeometry(1, 0.06, 0.05);
  const rails = tiledMesh(railGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), size * 4);
  const inBuilding = (x: number, y: number) => buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);

  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? '' : info.terrainKey[y * map.width + x]);
  const fenceLike = (k: string) => k === 'fence' || k === 'gate';

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const key = info.terrainKey[i];
      const cx = x + 0.5;
      const cz = y + 0.5;
      const color = tileColors[i];

      if (key === 'water') {
        m.compose(new THREE.Vector3(cx, WATER_TOP - 0.25, cz), q.identity(), new THREE.Vector3(1, 0.5, 1));
        pushInstance(water, m, color, i);
        continue;
      }

      const bridge = isBridge(map, info, x, y);
      const top = bridge ? 0.06 : 0;
      // Random quarter turns hide texture repeats on natural ground.
      const surface = surfaceFor(key, bridge);
      const turn = surface === 'grass' || surface === 'dirt' || surface === 'stone' ? Math.floor(hash2(x, y, 11) * 4) : bridge ? 1 : 0;
      q.setFromAxisAngle(up, (turn * Math.PI) / 2);
      m.compose(new THREE.Vector3(cx, top - 0.3, cz), q, new THREE.Vector3(1, 0.6, 1));
      pushInstance(groundByKey[surface], m, color, i);
      q.identity();

      if (bridge) {
        // Water shows under the gaps of the bridge rails.
        for (const side of [-0.46, 0.46]) {
          m.compose(new THREE.Vector3(cx, 0.35, cz + side), q.identity(), new THREE.Vector3(1, 1, 1));
          pushInstance(rails, m, 0x5e3f22, i);
        }
      }

      if (key === 'mountain') {
        const h = 0.9 + hash2(x, y, 1) * 1.6;
        const tone = shade(0x766c60, 0.85 + hash2(x, y, 2) * 0.3);
        m.compose(new THREE.Vector3(cx, 0.25, cz), q.identity(), new THREE.Vector3(1, 0.5, 1));
        pushInstance(mountainBase, m, shade(tone, 0.9), i);
        q.setFromAxisAngle(up, hash2(x, y, 3) * Math.PI * 2);
        const s = 0.95 + hash2(x, y, 4) * 0.35;
        m.compose(new THREE.Vector3(cx, 0.45, cz), q, new THREE.Vector3(s, h, s));
        pushInstance(peaks, m, tone, i);
        if (h > 1.9) pushInstance(snow, m, 0xf4f6fa, i);
        q.identity();
      } else if (key === 'wall') {
        // Town buildings are warm sandstone; the southeast boundary wall is dark granite.
        const base = inBuilding(x, y) ? 0xc4b08e : 0x6e6862;
        const tone = shade(base, 0.9 + hash2(x, y, 5) * 0.18);
        m.compose(new THREE.Vector3(cx, WALL_HEIGHT / 2, cz), q.identity(), new THREE.Vector3(1, WALL_HEIGHT, 1));
        pushInstance(walls, m, tone, i);
      } else if (key === 'fence') {
        m.compose(new THREE.Vector3(cx, 0, cz), q.identity(), new THREE.Vector3(1, 1, 1));
        pushInstance(posts, m, 0x7a5432, i);
        const right = fenceLike(at(x + 1, y));
        const down = fenceLike(at(x, y + 1));
        for (const h of [0.3, 0.6]) {
          if (right) {
            m.compose(new THREE.Vector3(cx + 0.5, h, cz), q.identity(), new THREE.Vector3(1, 1, 1));
            pushInstance(rails, m, 0x8a6240, i);
          }
          if (down) {
            q.setFromAxisAngle(up, Math.PI / 2);
            m.compose(new THREE.Vector3(cx, h, cz + 0.5), q, new THREE.Vector3(1, 1, 1));
            pushInstance(rails, m, 0x8a6240, i);
            q.identity();
          }
        }
      } else if (key === 'gate') {
        group.add(buildGate(cx, cz, at(x - 1, y) === 'wall' || at(x + 1, y) === 'wall'));
      }
    }
  }

  // The river bed under bridges.
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      if (!isBridge(map, info, x, y)) continue;
      m.compose(new THREE.Vector3(x + 0.5, WATER_TOP - 0.45, y + 0.5), q.identity(), new THREE.Vector3(1, 0.5, 1));
      pushInstance(water, m, 0x2f6ba5, y * map.width + x);
    }
  }

  for (const g of Object.values(groundByKey)) group.add(finish(g, { receive: true }));
  group.add(
    finish(snow, { cast: true, receive: true }),
    finish(water, { receive: true }),
    finish(mountainBase, { cast: true, receive: true }),
    finish(peaks, { cast: true, receive: true }),
    finish(walls, { cast: true, receive: true }),
    finish(posts, { cast: true }),
    finish(rails, { cast: true }),
  );

  return { group, pickables: [peaks, mountainBase, walls], waterTexture };
}

/** Iron gate: two stone pillars and a row of bars across the opening. */
function buildGate(cx: number, cz: number, alongX: boolean): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x5c5853 });
  const iron = new THREE.MeshLambertMaterial({ color: 0x2c2d33 });
  const brass = new THREE.MeshLambertMaterial({ color: 0xb8913a });
  for (const side of [-0.45, 0.45]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 1.6, 0.22), stone);
    pillar.position.set(side, 0.8, 0);
    const cap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), brass);
    cap.position.set(side, 1.68, 0);
    g.add(pillar, cap);
  }
  for (let b = -0.3; b <= 0.31; b += 0.15) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.05, 1.25, 0.05), iron);
    bar.position.set(b, 0.63, 0);
    g.add(bar);
  }
  const rail = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.07, 0.07), iron);
  rail.position.set(0, 1.0, 0);
  g.add(rail);
  g.position.set(cx, 0, cz);
  if (!alongX) g.rotation.y = Math.PI / 2;
  g.traverse((o) => (o.castShadow = true));
  return g;
}
