import * as THREE from 'three';
import type { MapData, Point, WorldGrid } from '@rpg/shared';
import type { Heightmap } from './heightmap';
import type { Area, TileInfo } from './palette';
import { buildScenery } from './scenery';

/** Tiles per chunk. Matches the region viewer's 32 x 32 chunks. */
const CHUNK = 32;
/**
 * Chunks kept built around the player's own chunk, in each direction. One ring
 * covers the view at normal zoom; a zoomed-out camera sees further and asks
 * for two.
 */
const KEEP = 1;

/**
 * Ground cover for a region-sized map. Tufts and pebbles are cheap on their
 * own but there are hundreds of thousands of them, so each 32 x 32 chunk is
 * built when the player comes near and thrown away when they leave. Only the
 * ground is chunked; terrain, buildings and objects are built once.
 */
export class SceneryChunks {
  readonly group = new THREE.Group();
  private readonly chunks = new Map<string, THREE.Group>();
  private readonly cols: number;
  private readonly rows: number;
  private last = '';
  private lastKeep = 0;

  constructor(
    private readonly map: MapData,
    private readonly grid: WorldGrid,
    private readonly info: TileInfo,
    private readonly areas: Area[],
    private readonly tileColors: number[],
    private readonly hm: Heightmap,
  ) {
    this.cols = Math.ceil(map.width / CHUNK);
    this.rows = Math.ceil(map.height / CHUNK);
  }

  /** Builds what is near `centre` and frees the rest. Cheap when nothing moved. */
  update(centre: Point, wide = false): void {
    const keep = wide ? KEEP + 1 : KEEP;
    const cx = Math.floor(centre.x / CHUNK);
    const cy = Math.floor(centre.y / CHUNK);
    const at = `${cx},${cy}`;
    if (at === this.last && keep === this.lastKeep) return;
    this.last = at;
    this.lastKeep = keep;

    for (let y = cy - keep; y <= cy + keep; y++) {
      for (let x = cx - keep; x <= cx + keep; x++) {
        if (x < 0 || y < 0 || x >= this.cols || y >= this.rows) continue;
        const key = `${x},${y}`;
        if (this.chunks.has(key)) continue;
        const group = buildScenery(this.map, this.grid, this.info, this.areas, this.tileColors, this.hm, {
          x0: x * CHUNK,
          y0: y * CHUNK,
          x1: Math.min(this.map.width - 1, (x + 1) * CHUNK - 1),
          y1: Math.min(this.map.height - 1, (y + 1) * CHUNK - 1),
        });
        this.chunks.set(key, group);
        this.group.add(group);
      }
    }

    for (const [key, group] of this.chunks) {
      const [x, y] = key.split(',').map(Number);
      if (Math.abs(x - cx) <= keep && Math.abs(y - cy) <= keep) continue;
      this.group.remove(group);
      // Geometries and materials are shared between chunks, so only the
      // per-chunk instance buffers are released here.
      group.traverse((o) => {
        if (o instanceof THREE.InstancedMesh) o.dispose();
      });
      this.chunks.delete(key);
    }
  }
}
