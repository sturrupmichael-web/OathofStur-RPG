import { describe, expect, it } from 'vitest';
import { JsonMapSource, areaAt, type JsonMapFile } from '../src/map/JsonMapSource';
import { WorldGrid } from '../src/sim/grid';
import { kx, ky, loadWorld, loadWorldFile } from './helpers';

describe('JsonMapSource', () => {
  const map = loadWorld();
  const terrainAt = (x: number, y: number) => map.terrainDefs[map.terrain[y * map.width + x]].key;
  const count = (key: string) => map.placements.filter((p) => p.defKey === key).length;

  it('loads the whole 512x384 Vell Reaches region', () => {
    expect(map.width).toBe(512);
    expect(map.height).toBe(384);
    expect(map.terrain).toHaveLength(512 * 384);
    expect(map.terrain.every((t) => t >= 0)).toBe(true);
    expect(map.spawn).toEqual({ x: kx(60), y: ky(49) });
    expect(map.areas).toHaveLength(128);
  });

  it('turns trees, rocks, stations and props into placements', () => {
    // Fewer than the map's tree tiles: some squares of four became one big tree.
    expect(count('tree')).toBe(6349);
    expect(count('dead_tree')).toBe(1523);
    expect(count('oak_tree')).toBe(605);
    expect(count('copper_rock')).toBe(22);
    expect(count('glacite_rock')).toBe(3);
    expect(count('bank_booth')).toBe(41);
    expect(count('anvil')).toBe(6);
    expect(count('hide_tent')).toBe(16);
    expect(count('well')).toBe(6);
    expect(count('boulder')).toBeGreaterThan(150);
    expect(map.defs.scenery.cart.name).toBe('Cart');
    expect(map.defs.resources.coal_rock.skill).toBe('mining');
    expect(map.defs.resources.yew_tree.skill).toBe('woodcutting');
    expect(map.defs.resources.tree.level).toBeUndefined(); // not in the map data
    // Objects whose skill arrives in a later phase are props for now.
    expect(map.defs.scenery.glyph_shrine.name).toBe('Glyph shrine');
  });

  it('grows some trees to cover 2 x 2 tiles without shutting anything off', () => {
    const big = map.placements.filter((p) => p.size === 2);
    expect(big.length).toBeGreaterThan(800);
    expect(new Set(big.map((p) => p.defKey))).toEqual(new Set(['tree', 'dead_tree', 'oak_tree', 'willow_tree', 'yew_tree', 'starwood_tree']));

    // Reachability from spawn, 8-way without cutting corners, as the pathfinder walks.
    const W = map.width;
    const H = map.height;
    const reach = (walkable: (x: number, y: number) => boolean) => {
      const seen = new Uint8Array(W * H);
      const queue = [map.spawn.y * W + map.spawn.x];
      seen[queue[0]] = 1;
      while (queue.length) {
        const i = queue.pop()!;
        const x = i % W;
        const y = (i - x) / W;
        for (let dy = -1; dy <= 1; dy++)
          for (let dx = -1; dx <= 1; dx++) {
            const j = (y + dy) * W + x + dx;
            if (!walkable(x + dx, y + dy) || seen[j]) continue;
            if (dx && dy && (!walkable(x + dx, y) || !walkable(x, y + dy))) continue;
            seen[j] = 1;
            queue.push(j);
          }
      }
      return seen;
    };
    const file = loadWorldFile();
    const inMap = (x: number, y: number) => x >= 0 && y >= 0 && x < W && y < H;
    // People stand on their tile and block it, as in the game.
    const people = new Set(map.placements.filter((p) => p.kind === 'npc').map((p) => p.y * W + p.x));
    const before = reach((x, y) => inMap(x, y) && file.legend[file.rows[y][x]].walkable && !people.has(y * W + x));
    const grid = new WorldGrid(map);
    const after = reach((x, y) => grid.isWalkable(x, y));
    const touches = (seen: Uint8Array, x0: number, y0: number, size: number) => {
      for (let y = y0 - 1; y <= y0 + size; y++) for (let x = x0 - 1; x <= x0 + size; x++) if (inMap(x, y) && seen[y * W + x]) return true;
      return false;
    };
    const cover = new Map<number, (typeof map.placements)[number]>();
    for (const p of map.placements) {
      if (p.kind === 'monster') continue;
      for (let dy = 0; dy < (p.size ?? 1); dy++) for (let dx = 0; dx < (p.size ?? 1); dx++) cover.set((p.y + dy) * W + p.x + dx, p);
    }
    const lost: string[] = [];
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const i = y * W + x;
        if (before[i] && grid.isWalkable(x, y) && !after[i]) lost.push(`ground ${x},${y}`);
        const p = cover.get(i);
        if (!file.legend[file.rows[y][x]].walkable && p && touches(before, x, y, 1) && !touches(after, p.x, p.y, p.size ?? 1)) lost.push(`${p.defKey} ${x},${y}`);
      }
    expect(lost).toEqual([]);
  });

  it('spawns monsters with their level and wander area, and people with their role', () => {
    const monsters = map.placements.filter((p) => p.kind === 'monster');
    const goblins = monsters.filter((p) => p.defKey === 'goblin');
    expect(monsters).toHaveLength(86);
    expect(goblins).toHaveLength(8);
    expect(monsters.filter((p) => p.defKey === 'cinder_drake').map((p) => p.level)).toEqual([60]);
    expect(goblins.every((g) => g.level === 2 && (g.wander?.radius ?? 0) > 0)).toBe(true);

    expect(map.placements.filter((p) => p.kind === 'npc')).toHaveLength(70);
    expect(map.defs.npcs.elder_maren.role).toBe('Village elder');
    expect(map.defs.npcs.mara.role).toBe('Shopkeeper');
    expect(map.defs.npcs.mara.shop).toBe('General Store');
    expect(map.defs.npcs.banker.role).toBe('Banker');
  });

  it('lists where each skill is trained', () => {
    expect(map.skills).toHaveLength(24);
    const mining = map.skills.find((s) => s.name === 'Mining')!;
    expect(mining.sites.length).toBeGreaterThan(3);
    expect(mining.sites.every((s) => s.x >= 0 && s.x < map.width && s.y >= 0 && s.y < map.height)).toBe(true);
  });

  it('gives objects the ground around them', () => {
    expect(terrainAt(kx(39), ky(52))).toBe('stone_floor'); // anvil in the Kelmoor smithy
    expect(terrainAt(kx(60), ky(46))).toBe('water'); // fountain statue
    expect(terrainAt(kx(2), ky(63))).toBe('long_grass'); // Thornwood tree
  });

  it('bridges the River Vell where the east road crosses it', () => {
    for (let y = ky(45); y <= ky(47); y++) for (let x = kx(98); x <= kx(101); x++) expect(terrainAt(x, y)).toBe('bridge');
  });

  it('finds the smallest named area at a tile', () => {
    expect(areaAt(map, kx(39), ky(52))?.name).toBe('Smithy');
    expect(areaAt(map, map.spawn.x, map.spawn.y)?.name).toBe('Kelmoor Square');
    expect(areaAt(map, 203, 120)?.name).toBe('General Store');
    expect(areaAt(map, 340, 230)?.name).toBe('Sunscar Mine');
    expect(areaAt(map, 152, 156)?.name).toBe('Goblin Encampment');
  });

  it('rejects malformed maps with a clear error', () => {
    const base: JsonMapFile = { name: 'bad', width: 2, height: 1, spawn: { x: 0, y: 0 }, legend: { '.': { name: 'Grass', walkable: true } }, rows: ['..'] };
    expect(() => new JsonMapSource('bad', { ...base, rows: ['.?'] }).load()).toThrow(/unknown character '\?'/);
    expect(() => new JsonMapSource('bad', { ...base, rows: ['...'] }).load()).toThrow(/columns/);
    expect(() => new JsonMapSource('bad', { ...base, spawn: { x: 5, y: 0 } }).load()).toThrow(/spawn/);
    const tree = { ...base, legend: { ...base.legend, T: { name: 'Tree', walkable: true } }, rows: ['.T'] };
    expect(() => new JsonMapSource('bad', tree).load()).toThrow(/walkable/);
  });
});
