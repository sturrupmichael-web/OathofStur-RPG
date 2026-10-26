import * as THREE from 'three';
import type { MapData } from '@rpg/shared';
import { textures } from './textures';

/** The natural ground layers the blend shader mixes between. */
export const LAYERS = { grass: 0, dirt: 1, stone: 2 } as const;
export type Layer = keyof typeof LAYERS;
/** Marks a tile drawn by another surface (roads, floors, water) that the blend ignores. */
const OTHER = 255;

/**
 * Packs each tile's ground colour and layer into a map-sized texture: rgb is
 * the tint, alpha the layer (or OTHER). The colour is softened toward its
 * neighbours first, so meadow fades into forest floor and grass yellows
 * toward the desert over a couple of tiles instead of at a tile edge.
 */
export function buildTileTexture(map: MapData, tint: (i: number) => number, layer: (i: number) => Layer | null): THREE.DataTexture {
  const { width: W, height: H } = map;
  const rgb = new Float32Array(W * H * 3);
  const layers = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const l = layer(i);
    layers[i] = l === null ? OTHER : LAYERS[l];
    const c = tint(i);
    rgb[i * 3] = (c >> 16) & 255;
    rgb[i * 3 + 1] = (c >> 8) & 255;
    rgb[i * 3 + 2] = c & 255;
  }
  const R = 2;
  const kernel: number[] = [];
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) kernel.push(Math.exp(-(dx * dx + dy * dy) / 2.2));
  const data = new Uint8Array(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      if (layers[i] !== OTHER) {
        let k = 0;
        for (let dy = -R; dy <= R; dy++)
          for (let dx = -R; dx <= R; dx++, k++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const j = ny * W + nx;
            if (layers[j] === OTHER) continue;
            const w = kernel[k];
            r += rgb[j * 3] * w;
            g += rgb[j * 3 + 1] * w;
            b += rgb[j * 3 + 2] * w;
            n += w;
          }
      }
      // Half the tile's own colour, half its surroundings.
      const mix = (own: number, around: number) => Math.round(n ? own * 0.5 + (around / n) * 0.5 : own);
      data[i * 4] = mix(rgb[i * 3], r);
      data[i * 4 + 1] = mix(rgb[i * 3 + 1], g);
      data[i * 4 + 2] = mix(rgb[i * 3 + 2], b);
      data[i * 4 + 3] = layers[i];
    }
  }
  const tex = new THREE.DataTexture(data, W, H, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Lambert material for the natural ground. Instead of one texture and colour
 * per tile, each pixel looks up the four nearest tiles through a little
 * noise and mixes their layers (grass, dirt, rock) and colours with a soft,
 * ragged edge, so biomes and paths meet like ground rather than like tiles.
 * Vertex colours still carry the light/dark lift from the heightmap.
 */
export function blendedGroundMaterial(tiles: THREE.DataTexture, width: number, height: number): THREE.MeshLambertMaterial {
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, vertexColors: true, map: textures.grass() });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uTiles = { value: tiles };
    shader.uniforms.uMapSize = { value: new THREE.Vector2(width, height) };
    shader.uniforms.uGrass = { value: textures.grass() };
    shader.uniforms.uDirt = { value: textures.dirt() };
    shader.uniforms.uRock = { value: textures.rock() };
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vGround;')
      .replace('#include <project_vertex>', '#include <project_vertex>\nvGround = (modelMatrix * vec4(transformed, 1.0)).xz;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
varying vec2 vGround;
uniform sampler2D uTiles;
uniform vec2 uMapSize;
uniform sampler2D uGrass;
uniform sampler2D uDirt;
uniform sampler2D uRock;
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), f.x), mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
vec4 gTile(vec2 cell) {
  ivec2 c = ivec2(clamp(cell, vec2(0.0), uMapSize - 1.0));
  return texelFetch(uTiles, c, 0);
}`,
      )
      .replace(
        '#include <map_fragment>',
        `{
  // Wobble the lookup so boundaries wander instead of following tile edges.
  vec2 warp = vec2(gNoise(vGround * 1.9), gNoise(vGround * 1.9 + 17.3)) - 0.5;
  warp += (vec2(gNoise(vGround * 4.7 + 5.1), gNoise(vGround * 4.7 + 41.7)) - 0.5) * 0.4;
  vec2 q = vGround + warp * 0.6 - 0.5;
  vec2 base = floor(q);
  vec2 f = smoothstep(0.2, 0.8, fract(q));
  vec3 tint = vec3(0.0);
  vec3 layer = vec3(0.0);
  float total = 0.0;
  for (int k = 0; k < 4; k++) {
    vec2 o = vec2(float(k & 1), float(k >> 1));
    vec4 t = gTile(base + o);
    if (t.a > 0.99) continue;
    float w = (o.x > 0.5 ? f.x : 1.0 - f.x) * (o.y > 0.5 ? f.y : 1.0 - f.y);
    int l = int(t.a * 255.0 + 0.5);
    tint += t.rgb * w;
    layer += vec3(l == 0 ? w : 0.0, l == 1 ? w : 0.0, l == 2 ? w : 0.0);
    total += w;
  }
  if (total < 0.001) {
    vec4 t = gTile(floor(vGround));
    int l = int(t.a * 255.0 + 0.5);
    tint = t.rgb;
    layer = vec3(l == 0 ? 1.0 : 0.0, l == 1 ? 1.0 : 0.0, l == 2 ? 1.0 : 0.0);
    total = 1.0;
  }
  tint /= total;
  layer /= total;
  vec2 uv = vGround;
  vec3 tex = texture2D(uGrass, uv).rgb * layer.x + texture2D(uDirt, uv).rgb * layer.y + texture2D(uRock, uv).rgb * layer.z;
  // Broad, slow variation so the repeat of the texture doesn't show.
  float broad = 0.88 + 0.24 * gNoise(vGround * 0.23);
  diffuseColor.rgb *= tint * tex * broad;
}`,
      );
  };
  return material;
}
