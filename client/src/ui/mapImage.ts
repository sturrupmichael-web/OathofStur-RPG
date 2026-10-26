import type { MapData } from '@rpg/shared';
import type { TileInfo } from '../render/palette';

/** One canvas of the whole world, drawn once and shared by the minimap and the region map. */
export function drawWorldImage(map: MapData, tileColors: number[], info: TileInfo, scale: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = map.width * scale;
  canvas.height = map.height * scale;
  const ctx = canvas.getContext('2d')!;
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const i = y * map.width + x;
      const key = info.placementKey[i];
      let color = '#' + tileColors[i].toString(16).padStart(6, '0');
      const terrain = info.terrainKey[i];
      if (key === 'dead_tree') color = '#5a5048';
      else if (key === 'starwood_tree') color = '#7fd8c8';
      else if (key?.endsWith('tree')) color = '#2b5e27';
      else if (key?.endsWith('rock') || key === 'aether_stone') color = '#b9a27a';
      else if (key === 'hide_tent') color = '#9a7a52';
      else if (key === 'cactus' || key === 'palm_tree') color = '#3f7a42';
      else if (key) color = '#c8c0b0';
      else if (terrain === 'city_wall') color = '#d8d4cc';
      else if (terrain === 'sandstone_wall') color = '#e0c79a';
      else if (terrain === 'building_wall') color = '#efe6d2';
      else if (terrain === 'door') color = '#b0603a';
      else if (terrain === 'fence') color = '#8a6240';
      else if (terrain === 'palisade') color = '#5a3d22';
      else if (terrain === 'ditch') color = '#2e261e';
      else if (terrain === 'lava') color = '#e0541c';
      else if (terrain === 'mountain') color = '#7b736a';
      ctx.fillStyle = color;
      ctx.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  return canvas;
}
