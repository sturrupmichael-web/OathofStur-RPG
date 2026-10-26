import * as THREE from 'three';
import type { MapData } from '@rpg/shared';
import type { Building } from './buildings';
import { CITY_WALL_HEIGHT, WALL_HEIGHT } from './buildings';
import type { Heightmap } from './heightmap';
import { hash2, isBridge, shade, type TileInfo } from './palette';

const SURFACE_BY_KEY: Record<string, 'grass' | 'road' | 'dirt' | 'planks' | 'stone' | 'bed'> = {
  cobblestone: 'road',
  sewer_hatch: 'road',
  stone_floor: 'road',
  wooden_floor: 'planks',
  door: 'planks',
  dirt_path: 'dirt',
  trampled_mud: 'dirt',
  bone_scatter: 'dirt',
  crop_field: 'dirt',
  flower_bed: 'dirt',
  scorched_earth: 'dirt',
  sand: 'dirt',
  ditch: 'dirt',
  city_wall: 'stone',
  building_wall: 'stone',
  water: 'bed',
};
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
  const surfaceFor = (key: string): keyof typeof surfaces => SURFACE_BY_KEY[key] ?? 'grass';
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
      const bridge = isBridge(info, i);
      const surface = bridge ? 'bed' : surfaceFor(key);
      const natural = surface === 'grass' || surface === 'dirt' || surface === 'stone' || surface === 'bed' || key === 'cobblestone';
      const turn = natural ? Math.floor(hash2(x, y, 11) * 4) : 0;
      // Higher ground is a touch lighter and drier; hollows a touch darker.
      const lift = (hm.tileCentre(x, y) - 0.8) * 0.07;
      const tint = surface === 'bed' ? shade(0x5a5a46, 0.9 + hash2(x, y, 3) * 0.2) : shade(tileColors[i], Math.max(0.75, Math.min(1.2, 1 + lift)));
      surfaces[surface].quad(pts, nrm, tint, turn);

      if (key === 'water' || bridge) {
        const level = hm.waterAt(x, y);
        const flat: [number, number, number][] = cornersXY.map(([cx, cy]) => [cx, level, cy]);
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
  const walls = tiledMesh(box, textured(textures.bricks()), size);
  const postGeo = new THREE.BoxGeometry(0.12, 1.15, 0.12);
  postGeo.translate(0, 0.175, 0);
  const posts = tiledMesh(postGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), size);
  const railGeo = new THREE.BoxGeometry(1, 0.06, 0.05);
  const rails = tiledMesh(railGeo, new THREE.MeshLambertMaterial({ color: 0xffffff }), size * 4);
  // Palisade: sharpened logs, three to a tile, with a lashing rail.
  const stakeGeo = new THREE.CylinderGeometry(0.13, 0.15, 1.9, 6);
  stakeGeo.translate(0, 0.55, 0);
  const tipGeo = new THREE.ConeGeometry(0.13, 0.32, 6);
  tipGeo.translate(0, 1.66, 0);
  const stakes = tiledMesh(stakeGeo, textured(textures.planks(), true), size * 3);
  const tips = tiledMesh(tipGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), size * 3);
  const grate = tiledMesh(new THREE.BoxGeometry(0.8, 0.06, 0.8), new THREE.MeshLambertMaterial({ color: 0xffffff, map: grateTexture() }), 8);
  const inBuilding = (x: number, y: number) => buildings.some((b) => x >= b.x0 && x <= b.x1 && y >= b.y0 && y <= b.y1);
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= map.width || y >= map.height ? '' : info.terrainKey[y * map.width + x]);

  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const key = info.terrainKey[i];
      const cx = x + 0.5;
      const cz = y + 0.5;
      const base = hm.tileCentre(x, y);
      // Lowest corner, so solid blocks reach the ground on every side.
      const low = Math.min(hm.corner(x, y), hm.corner(x + 1, y), hm.corner(x, y + 1), hm.corner(x + 1, y + 1));

      if (isBridge(info, i)) {
        for (const side of [-0.46, 0.46]) {
          m.compose(new THREE.Vector3(cx, base + 0.35, cz + side), q.identity(), new THREE.Vector3(1, 1, 1));
          pushInstance(rails, m, 0x5e3f22, i);
          m.compose(new THREE.Vector3(cx - 0.5, base, cz + side), q.identity(), new THREE.Vector3(1, 1, 1));
          pushInstance(posts, m, 0x5e3f22, i);
        }
      }

      if (key === 'building_wall' || key === 'city_wall') {
        // Buildings are warm sandstone; the city wall and ruins are dark granite.
        const city = key === 'city_wall';
        const tone = shade(city ? 0x6e6862 : inBuilding(x, y) ? 0xc4b08e : 0x8a8070, 0.9 + hash2(x, y, 5) * 0.18);
        // Freestanding building walls (ash ruins) are broken off at uneven heights.
        const height = city ? CITY_WALL_HEIGHT : inBuilding(x, y) ? WALL_HEIGHT : 0.5 + hash2(x, y, 6) * 0.9;
        const top = base + height;
        const bottom = low - 0.2;
        m.compose(new THREE.Vector3(cx, (top + bottom) / 2, cz), q.identity(), new THREE.Vector3(1, top - bottom, 1));
        pushInstance(walls, m, tone, i);
      } else if (key === 'fence') {
        m.compose(new THREE.Vector3(cx, base, cz), q.identity(), new THREE.Vector3(1, 1, 1));
        pushInstance(posts, m, 0x7a5432, i);
        const right = at(x + 1, y) === 'fence';
        const down = at(x, y + 1) === 'fence';
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
      } else if (key === 'palisade') {
        for (let k = 0; k < 3; k++) {
          const ox = (hash2(x, y, 40 + k) - 0.5) * 0.5;
          const oz = (hash2(x, y, 43 + k) - 0.5) * 0.5;
          const s = 0.85 + hash2(x, y, 46 + k) * 0.3;
          q.setFromEuler(new THREE.Euler((hash2(x, y, 49 + k) - 0.5) * 0.12, hash2(x, y, 52 + k) * 6, (hash2(x, y, 55 + k) - 0.5) * 0.12));
          m.compose(new THREE.Vector3(cx + ox, low, cz + oz), q, new THREE.Vector3(1, s, 1));
          const tone = shade(0x7a5636, 0.85 + hash2(x, y, 58 + k) * 0.3);
          pushInstance(stakes, m, tone, i);
          pushInstance(tips, m, shade(tone, 1.15), i);
        }
        q.identity();
      } else if (key === 'sewer_hatch') {
        m.compose(new THREE.Vector3(cx, base + 0.02, cz), q.identity(), new THREE.Vector3(1, 1, 1));
        pushInstance(grate, m, 0x8a8c92, i);
      }
    }
  }

  group.add(
    finish(walls, { cast: true, receive: true }),
    finish(posts, { cast: true }),
    finish(rails, { cast: true }),
    finish(stakes, { cast: true, receive: true }),
    finish(tips, { cast: true, receive: true }),
    finish(grate, { receive: true }),
  );

  return { group, ground, pickables: [walls, stakes, tips], waterTexture };
}

/** Round iron sewer grate. */
function grateTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#3a3c40';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#7a7c82';
  ctx.beginPath();
  ctx.arc(32, 32, 30, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#111214';
  for (let k = -3; k <= 3; k++) ctx.fillRect(30 + k * 7, 8, 3, 48);
  ctx.strokeStyle = '#55575c';
  ctx.lineWidth = 4;
  ctx.beginPath();
  ctx.arc(32, 32, 28, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
