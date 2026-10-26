import * as THREE from 'three';
import type { MapData } from '@rpg/shared';
import type { Building } from './buildings';
import { WALL_HEIGHT } from './buildings';
import { WATER_Y, type Heightmap } from './heightmap';
import { hash2, isBridge, shade, type TileInfo } from './palette';
import { textures } from './textures';

/** Static world geometry built once from map data. */
export interface TerrainLayer {
  group: THREE.Group;
  /** The ground surface, raycast to find the tile under the cursor. */
  ground: THREE.Mesh[];
  /** Tall things that can hide the ground behind them. */
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

/** Accumulates textured, vertex-coloured quads for one ground surface. */
class SurfaceBuilder {
  private positions: number[] = [];
  private normals: number[] = [];
  private uvs: number[] = [];
  private colors: number[] = [];

  /** Quad corners in order NW, NE, SW, SE. */
  quad(p: [number, number, number][], n: [number, number, number][], color: number, turn: number): void {
    const c = new THREE.Color(color);
    const baseUv: [number, number][] = [
      [0, 1],
      [1, 1],
      [0, 0],
      [1, 0],
    ];
    const uv = baseUv.map(([u, v]) => {
      let uu = u;
      let vv = v;
      for (let k = 0; k < turn; k++) [uu, vv] = [vv, 1 - uu];
      return [uu, vv];
    });
    for (const k of [0, 2, 1, 1, 2, 3]) {
      this.positions.push(...p[k]);
      this.normals.push(...n[k]);
      this.uvs.push(...uv[k]);
      this.colors.push(c.r, c.g, c.b);
    }
  }

  build(material: THREE.Material): THREE.Mesh {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(this.positions, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(this.normals, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(this.uvs, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(this.colors, 3));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    return mesh;
  }
}

export function buildTerrain(map: MapData, info: TileInfo, tileColors: number[], buildings: Building[], hm: Heightmap): TerrainLayer {
  const group = new THREE.Group();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const up = new THREE.Vector3(0, 1, 0);
  const size = map.width * map.height;
  const textured = (tex: THREE.Texture, flat = false) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, flatShading: flat });
  const groundMaterial = (tex: THREE.Texture) => new THREE.MeshLambertMaterial({ color: 0xffffff, map: tex, vertexColors: true });

  // Smooth ground: one mesh per surface texture, vertex colours carry the area tint.
  const surfaces = {
    grass: new SurfaceBuilder(),
    road: new SurfaceBuilder(),
    dirt: new SurfaceBuilder(),
    planks: new SurfaceBuilder(),
    stone: new SurfaceBuilder(),
    bed: new SurfaceBuilder(),
  };
  const surfaceFor = (key: string): keyof typeof surfaces => {
    if (key === 'floor' || key === 'door') return 'planks';
    if (key === 'road') return 'road';
    if (key === 'dirt_path' || key === 'gate') return 'dirt';
    if (key === 'mountain' || key === 'wall') return 'stone';
    if (key === 'water') return 'bed';
    return 'grass';
  };
  const normalAt = (cx: number, cy: number): [number, number, number] => {
    const dx = (hm.corner(cx + 1, cy) - hm.corner(cx - 1, cy)) / 2;
    const dz = (hm.corner(cx, cy + 1) - hm.corner(cx, cy - 1)) / 2;
    const v = new THREE.Vector3(-dx, 1, -dz).normalize();
    return [v.x, v.y, v.z];
  };

  const waterTexture = textures.water().clone();
  waterTexture.needsUpdate = true;
  const water = new SurfaceBuilder();
  const deck = new SurfaceBuilder();

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const key = info.terrainKey[i];
      const cornersXY: [number, number][] = [
        [x, y],
        [x + 1, y],
        [x, y + 1],
        [x + 1, y + 1],
      ];
      const pts = cornersXY.map(([cx, cy]) => [cx, hm.corner(cx, cy), cy] as [number, number, number]);
      const nrm = cornersXY.map(([cx, cy]) => normalAt(cx, cy));
      const bridge = isBridge(map, info, x, y);
      const surface = bridge ? 'bed' : surfaceFor(key);
      const natural = surface === 'grass' || surface === 'dirt' || surface === 'stone' || surface === 'bed';
      const turn = natural ? Math.floor(hash2(x, y, 11) * 4) : 0;
      // Higher ground is a touch lighter and drier; hollows a touch darker.
      const lift = (hm.tileCentre(x, y) - 0.8) * 0.07;
      const tint = surface === 'bed' ? shade(0x5a5a46, 0.9 + hash2(x, y, 3) * 0.2) : shade(tileColors[i], Math.max(0.75, Math.min(1.2, 1 + lift)));
      surfaces[surface].quad(pts, nrm, tint, turn);

      if (key === 'water' || bridge) {
        const flat: [number, number, number][] = cornersXY.map(([cx, cy]) => [cx, WATER_Y, cy]);
        water.quad(flat, flat.map(() => [0, 1, 0]), bridge ? 0x2f6ba5 : tileColors[i], 0);
      }
      if (bridge) {
        const h = hm.groundAt(x + 0.5, y + 0.5);
        const flat: [number, number, number][] = cornersXY.map(([cx, cy]) => [cx, h, cy]);
        deck.quad(flat, flat.map(() => [0, 1, 0]), tileColors[i], 1);
      }
    }
  }

  // Skirt around the map edge so it reads as a slab of land, not a sheet.
  const skirt = new SurfaceBuilder();
  const edge = (ax: number, ay: number, bx: number, by: number, n: [number, number, number]) => {
    const a = hm.corner(ax, ay);
    const b = hm.corner(bx, by);
    skirt.quad(
      [
        [ax, a, ay],
        [bx, b, by],
        [ax, -2.5, ay],
        [bx, -2.5, by],
      ],
      [n, n, n, n],
      0x5a5249,
      0,
    );
  };
  for (let x = 0; x < map.width; x++) {
    edge(x + 1, 0, x, 0, [0, 0, -1]);
    edge(x, map.height, x + 1, map.height, [0, 0, 1]);
  }
  for (let y = 0; y < map.height; y++) {
    edge(0, y, 0, y + 1, [-1, 0, 0]);
    edge(map.width, y + 1, map.width, y, [1, 0, 0]);
  }

  const ground = [
    surfaces.grass.build(groundMaterial(textures.grass())),
    surfaces.road.build(groundMaterial(textures.cobble())),
    surfaces.dirt.build(groundMaterial(textures.dirt())),
    surfaces.planks.build(groundMaterial(textures.planks())),
    surfaces.stone.build(groundMaterial(textures.rock())),
    surfaces.bed.build(groundMaterial(textures.dirt())),
    deck.build(groundMaterial(textures.planks())),
  ];
  const skirtMaterial = groundMaterial(textures.rock());
  skirtMaterial.side = THREE.DoubleSide;
  group.add(...ground, skirt.build(skirtMaterial));
  const waterMesh = water.build(new THREE.MeshLambertMaterial({ color: 0xffffff, map: waterTexture, vertexColors: true, transparent: true, opacity: 0.85 }));
  waterMesh.receiveShadow = true;
  group.add(waterMesh);

  // Raised features. Each extends well below its tile so slopes never show a gap.
  const box = new THREE.BoxGeometry(1, 1, 1);
  const mountainBase = tiledMesh(box, textured(textures.rock()), size);
  const peakGeo = new THREE.CylinderGeometry(0.1, 0.62, 1, 5);
  peakGeo.translate(0, 0.5, 0);
  const peaks = tiledMesh(peakGeo, textured(textures.rock(), true), size);
  const snowGeo = new THREE.CylinderGeometry(0.115, 0.26, 0.27, 5);
  snowGeo.translate(0, 0.87, 0);
  const snow = tiledMesh(snowGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), size);
  const walls = tiledMesh(box, textured(textures.bricks()), size);
  const postGeo = new THREE.BoxGeometry(0.12, 1.15, 0.12);
  postGeo.translate(0, 0.175, 0);
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
      const base = hm.tileCentre(x, y);
      // Lowest corner, so solid blocks reach the ground on every side.
      const low = Math.min(hm.corner(x, y), hm.corner(x + 1, y), hm.corner(x, y + 1), hm.corner(x + 1, y + 1));

      if (isBridge(map, info, x, y)) {
        for (const side of [-0.46, 0.46]) {
          m.compose(new THREE.Vector3(cx, base + 0.35, cz + side), q.identity(), new THREE.Vector3(1, 1, 1));
          pushInstance(rails, m, 0x5e3f22, i);
          m.compose(new THREE.Vector3(cx - 0.5, base, cz + side), q.identity(), new THREE.Vector3(1, 1, 1));
          pushInstance(posts, m, 0x5e3f22, i);
        }
      }

      if (key === 'mountain') {
        const h = 0.9 + hash2(x, y, 1) * 1.6;
        const tone = shade(0x766c60, 0.85 + hash2(x, y, 2) * 0.3);
        const top = base + 0.35;
        m.compose(new THREE.Vector3(cx, (top + low - 0.3) / 2, cz), q.identity(), new THREE.Vector3(1, top - low + 0.3, 1));
        pushInstance(mountainBase, m, shade(tone, 0.9), i);
        q.setFromAxisAngle(up, hash2(x, y, 3) * Math.PI * 2);
        const s = 0.95 + hash2(x, y, 4) * 0.35;
        m.compose(new THREE.Vector3(cx, top, cz), q, new THREE.Vector3(s, h, s));
        pushInstance(peaks, m, tone, i);
        if (h > 1.9) pushInstance(snow, m, 0xf4f6fa, i);
        q.identity();
      } else if (key === 'wall') {
        // Town buildings are warm sandstone; the southeast boundary wall is dark granite.
        const tone = shade(inBuilding(x, y) ? 0xc4b08e : 0x6e6862, 0.9 + hash2(x, y, 5) * 0.18);
        const top = base + WALL_HEIGHT;
        const bottom = low - 0.2;
        m.compose(new THREE.Vector3(cx, (top + bottom) / 2, cz), q.identity(), new THREE.Vector3(1, top - bottom, 1));
        pushInstance(walls, m, tone, i);
      } else if (key === 'fence') {
        m.compose(new THREE.Vector3(cx, base, cz), q.identity(), new THREE.Vector3(1, 1, 1));
        pushInstance(posts, m, 0x7a5432, i);
        const right = fenceLike(at(x + 1, y));
        const down = fenceLike(at(x, y + 1));
        for (const h of [0.3, 0.6]) {
          if (right) {
            const mid = (base + hm.tileCentre(x + 1, y)) / 2;
            m.compose(new THREE.Vector3(cx + 0.5, mid + h, cz), q.identity(), new THREE.Vector3(1, 1, 1));
            pushInstance(rails, m, 0x8a6240, i);
          }
          if (down) {
            const mid = (base + hm.tileCentre(x, y + 1)) / 2;
            q.setFromAxisAngle(up, Math.PI / 2);
            m.compose(new THREE.Vector3(cx, mid + h, cz + 0.5), q, new THREE.Vector3(1, 1, 1));
            pushInstance(rails, m, 0x8a6240, i);
            q.identity();
          }
        }
      } else if (key === 'gate') {
        const gate = buildGate(cx, cz, at(x - 1, y) === 'wall' || at(x + 1, y) === 'wall');
        gate.position.y = base;
        group.add(gate);
      }
    }
  }

  group.add(
    finish(snow, { cast: true, receive: true }),
    finish(mountainBase, { cast: true, receive: true }),
    finish(peaks, { cast: true, receive: true }),
    finish(walls, { cast: true, receive: true }),
    finish(posts, { cast: true }),
    finish(rails, { cast: true }),
  );

  return { group, ground, pickables: [peaks, mountainBase, walls], waterTexture };
}

/** Iron gate: two stone pillars and a row of bars across the opening. */
function buildGate(cx: number, cz: number, alongX: boolean): THREE.Group {
  const g = new THREE.Group();
  const stone = new THREE.MeshLambertMaterial({ color: 0x5c5853 });
  const iron = new THREE.MeshLambertMaterial({ color: 0x2c2d33 });
  const brass = new THREE.MeshLambertMaterial({ color: 0xb8913a });
  for (const side of [-0.45, 0.45]) {
    const pillar = new THREE.Mesh(new THREE.BoxGeometry(0.22, 2.0, 0.22), stone);
    pillar.position.set(side, 0.6, 0);
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
