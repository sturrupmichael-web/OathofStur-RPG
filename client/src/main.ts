import { JsonMapSource, WorldGrid, areaAt, type JsonMapFile, type MapSource, type Point } from '@rpg/shared';
import kelmoor from '@rpg/shared/data/maps/kelmoor.json';
import { LocalServer } from './net/LocalServer';
import type { ServerConnection } from './net/ServerConnection';
import { Renderer, type PickResult } from './render/Renderer';
import { ClientState } from './state/ClientState';
import { Hud } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { PointerInput } from './ui/PointerInput';
import './styles.css';

const WORLD_SEED = 20261025;

async function start(): Promise<void> {
  // Swap this for a Tiled/LDtk MapSource later; nothing below depends on the format.
  const mapSource: MapSource = new JsonMapSource('kelmoor', kelmoor as JsonMapFile);
  const map = mapSource.load();
  const grid = new WorldGrid(map);

  const state = new ClientState();
  const server: ServerConnection = new LocalServer(map, WORLD_SEED);
  const hud = new Hud();
  const viewport = document.getElementById('viewport')!;
  const renderer = new Renderer(viewport, map, grid, state);
  const labels = document.getElementById('labels')!;
  const regionLabel = document.getElementById('region')!;

  const walk = (tile: Point) => {
    renderer.showClick(tile);
    server.send({ type: 'walk', x: tile.x, y: tile.y });
  };
  const minimap = new Minimap(
    document.getElementById('minimap') as HTMLCanvasElement,
    map,
    renderer.tileColors,
    renderer.info,
    state,
    walk,
  );

  state.on('self', (self) => hud.renderSelf(self));
  state.on('gameMessage', ({ text, kind }) => hud.addMessage(text, kind));
  server.onMessage((msg) => state.apply(msg, performance.now()));

  /** Human-readable description of whatever is under the cursor. */
  const describe = (pick: PickResult): { action: string; target: string } => {
    if (pick.buildingName !== undefined) return { action: 'Walk into', target: pick.buildingName || 'Hut' };
    if (pick.entityId !== null) {
      const e = state.entities.get(pick.entityId)?.data;
      if (e?.kind === 'player') return { action: 'Walk here', target: `${e.name} (level-${e.combatLevel})` };
      if (e) return { action: 'Walk to', target: e.name };
    }
    const def = map.terrainDefs[map.terrain[pick.tile.y * map.width + pick.tile.x]];
    const name = def.name.charAt(0).toUpperCase() + def.name.slice(1);
    return { action: grid.isWalkable(pick.tile.x, pick.tile.y) ? 'Walk here' : 'Walk to', target: name };
  };

  // --- Pointer (mouse, pen, touch) and keyboard ---------------------------------
  const canvas = renderer.canvas;
  let pointer: { x: number; y: number } | null = null;
  const local = (x: number, y: number) => {
    const rect = canvas.getBoundingClientRect();
    return { x: x - rect.left, y: y - rect.top };
  };

  new PointerInput(canvas, {
    tap: (x, y) => {
      if (hud.consumeMenuDismiss()) return;
      const pick = renderer.pick(x, y);
      if (pick) walk(pick.tile);
    },
    menu: (x, y) => {
      const pick = renderer.pick(x, y);
      if (!pick) return;
      const { target } = describe(pick);
      const at = local(x, y);
      hud.hideTooltip();
      renderer.setHover(pick.tile);
      hud.showMenu(at.x, at.y, [
        { label: 'Walk here', target: pick.entityId !== null || pick.buildingName ? target : undefined, action: () => walk(pick.tile) },
      ]);
    },
    menuCancel: () => hud.hideMenu(),
    hover: (x, y) => {
      pointer = local(x, y);
    },
    hoverEnd: () => {
      pointer = null;
    },
    rotate: (r) => renderer.rig.rotate(r),
    tilt: (r) => renderer.rig.tilt(r),
    zoom: (f) => renderer.rig.zoomBy(f),
  });

  // On-screen camera buttons (shown on touch screens): hold to rotate or zoom.
  const held = new Set<string>();
  document.querySelectorAll<HTMLButtonElement>('#camera-buttons button').forEach((b) => {
    const action = b.dataset.cam!;
    const release = () => held.delete(action);
    b.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (action === 'roofs') renderer.buildings.roofsEnabled = !renderer.buildings.roofsEnabled;
      else held.add(action);
    });
    b.addEventListener('pointerup', release);
    b.addEventListener('pointerleave', release);
    b.addEventListener('pointercancel', release);
  });

  const keys = new Set<string>();
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT') return;
    keys.add(e.key.toLowerCase());
    if (e.key === 'Escape') hud.hideMenu();
    if (e.key.toLowerCase() === 'r') renderer.buildings.roofsEnabled = !renderer.buildings.roofsEnabled;
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
    if (held.has('left')) renderer.rig.rotate(-1.6 * dt);
    if (held.has('right')) renderer.rig.rotate(1.6 * dt);
    if (held.has('in')) renderer.rig.zoomBy(1 + 1.2 * dt);
    if (held.has('out')) renderer.rig.zoomBy(1 - 1.0 * dt);

    renderer.frame(now);
    minimap.draw(now);
    const me = state.player?.data;
    const here = me ? (areaAt(map, me.x, me.y)?.name ?? '') : '';
    if (regionLabel.textContent !== here) regionLabel.textContent = here;

    if (pointer && !hud.menuOpen) {
      const rect = canvas.getBoundingClientRect();
      const pick = renderer.pick(pointer.x + rect.left, pointer.y + rect.top);
      renderer.setHover(pick?.tile ?? null);
      if (pick) {
        const { action, target } = describe(pick);
        hud.showTooltip(pointer.x, pointer.y, action, target);
      } else hud.hideTooltip();
    } else if (!hud.menuOpen) {
      renderer.setHover(null);
      hud.hideTooltip();
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
