import { AsciiMapSource, WorldGrid, type AsciiLegend, type MapSource, type Point } from '@rpg/shared';
import worldText from '@rpg/shared/data/maps/world.txt?raw';
import legend from '@rpg/shared/data/maps/legend.json';
import { LocalServer } from './net/LocalServer';
import type { ServerConnection } from './net/ServerConnection';
import { Renderer, type PickResult } from './render/Renderer';
import { ClientState } from './state/ClientState';
import { Hud } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import './styles.css';

const WORLD_SEED = 20261025;

async function start(): Promise<void> {
  // Swap this for a Tiled/LDtk MapSource later; nothing below depends on the format.
  const mapSource: MapSource = new AsciiMapSource('world', worldText, legend as AsciiLegend);
  const map = mapSource.load();
  const grid = new WorldGrid(map);

  const state = new ClientState();
  const server: ServerConnection = new LocalServer(map, WORLD_SEED);
  const hud = new Hud();
  const viewport = document.getElementById('viewport')!;
  const renderer = new Renderer(viewport, map, grid, state);
  const labels = document.getElementById('labels')!;

  const walk = (tile: Point) => {
    renderer.showClick(tile);
    server.send({ type: 'walk', x: tile.x, y: tile.y });
  };
  const minimap = new Minimap(
    document.getElementById('minimap') as HTMLCanvasElement,
    map,
    renderer.terrain.tileColors,
    renderer.terrain.info,
    state,
    walk,
  );

  state.on('self', (self) => hud.renderSelf(self));
  state.on('gameMessage', ({ text, kind }) => hud.addMessage(text, kind));
  server.onMessage((msg) => state.apply(msg, performance.now()));

  /** Human-readable description of whatever is under the cursor. */
  const describe = (pick: PickResult): { action: string; target: string } => {
    if (pick.entityId !== null) {
      const e = state.entities.get(pick.entityId)?.data;
      if (e?.kind === 'player') return { action: 'Walk here', target: `${e.name} (level-${e.combatLevel})` };
      if (e) return { action: 'Walk to', target: e.name };
    }
    const def = map.terrainDefs[map.terrain[pick.tile.y * map.width + pick.tile.x]];
    const name = def.name.charAt(0).toUpperCase() + def.name.slice(1);
    return { action: grid.isWalkable(pick.tile.x, pick.tile.y) ? 'Walk here' : 'Walk to', target: name };
  };

  // --- Mouse and keyboard ----------------------------------------------------
  const canvas = renderer.canvas;
  let pointer: { x: number; y: number } | null = null;
  let drag: { x: number; y: number; button: number; moved: boolean } | null = null;

  canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    pointer = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    if (drag) {
      const dx = e.clientX - drag.x;
      if (Math.abs(dx) > 3 || Math.abs(e.clientY - drag.y) > 3) drag.moved = true;
      if (drag.button === 1 || (drag.button === 0 && drag.moved && e.shiftKey)) {
        renderer.rig.rotate(-e.movementX * 0.01);
        renderer.rig.tilt(e.movementY * 0.005);
      }
    }
  });
  canvas.addEventListener('pointerleave', () => {
    pointer = null;
  });
  canvas.addEventListener('pointerdown', (e) => {
    drag = { x: e.clientX, y: e.clientY, button: e.button, moved: false };
    if (e.button === 1) e.preventDefault();
  });
  canvas.addEventListener('pointerup', (e) => {
    const wasClick = drag && !drag.moved && drag.button === 0 && e.button === 0;
    drag = null;
    if (!wasClick || hud.menuOpen) return;
    const pick = renderer.pick(e.clientX, e.clientY);
    if (pick) walk(pick.tile);
  });
  canvas.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const pick = renderer.pick(e.clientX, e.clientY);
    if (!pick) return;
    const { target } = describe(pick);
    const rect = canvas.getBoundingClientRect();
    hud.hideTooltip();
    hud.showMenu(e.clientX - rect.left, e.clientY - rect.top, [
      { label: 'Walk here', target: pick.entityId !== null ? target : undefined, action: () => walk(pick.tile) },
    ]);
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      renderer.rig.zoomBy(e.deltaY > 0 ? 0.9 : 1.1);
    },
    { passive: false },
  );

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (e.key === 'Escape') hud.hideMenu();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.key.toLowerCase()));
  window.addEventListener('blur', () => keys.clear());

  // --- Frame loop --------------------------------------------------------------
  let last = performance.now();
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (keys.has('arrowleft') || keys.has('q') || keys.has('a')) renderer.rig.rotate(-1.6 * dt);
    if (keys.has('arrowright') || keys.has('e') || keys.has('d')) renderer.rig.rotate(1.6 * dt);
    if (keys.has('arrowup') || keys.has('w')) renderer.rig.tilt(0.8 * dt);
    if (keys.has('arrowdown') || keys.has('s')) renderer.rig.tilt(-0.8 * dt);

    renderer.frame(now);
    minimap.draw(now);

    if (pointer && !hud.menuOpen && !drag?.moved) {
      const rect = canvas.getBoundingClientRect();
      const pick = renderer.pick(pointer.x + rect.left, pointer.y + rect.top);
      renderer.setHover(pick?.tile ?? null);
      if (pick) {
        const { action, target } = describe(pick);
        hud.showTooltip(pointer.x, pointer.y, action, target);
      } else hud.hideTooltip();
    } else {
      renderer.setHover(null);
      if (!pointer) hud.hideTooltip();
    }

    // Name and combat level above each player.
    for (const view of state.entities.values()) {
      if (view.data.kind !== 'player') continue;
      let label = labels.querySelector<HTMLElement>(`[data-id="${view.data.id}"]`);
      if (!label) {
        label = document.createElement('div');
        label.className = 'label';
        label.dataset.id = String(view.data.id);
        labels.appendChild(label);
      }
      label.textContent = `${view.data.name} (level-${view.data.combatLevel})`;
      const pos = renderer.screenPosition(view.data.id, 1.45, now);
      if (pos) label.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
    }
    for (const label of [...labels.children] as HTMLElement[]) {
      if (!state.entities.has(Number(label.dataset.id))) label.remove();
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  await server.connect('Wanderer');
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
