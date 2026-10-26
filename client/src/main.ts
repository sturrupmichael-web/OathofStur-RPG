import {
  ITEMS,
  JsonMapSource,
  RESOURCE_DATA,
  SELL_RATE,
  WorldGrid,
  areaAt,
  isBanker,
  shopForNpc,
  type EntityId,
  type JsonMapFile,
  type MapSource,
  type Point,
  type PublicEntity,
} from '@rpg/shared';
import vellReaches from '@rpg/shared/data/maps/vell-reaches.json';
import { LocalServer } from './net/LocalServer';
import type { ServerConnection } from './net/ServerConnection';
import { Renderer, type PickResult } from './render/Renderer';
import { ClientState } from './state/ClientState';
import { CombatOverlay } from './ui/CombatOverlay';
import { Hud } from './ui/Hud';
import { Minimap } from './ui/Minimap';
import { WorldMap } from './ui/WorldMap';
import { PointerInput } from './ui/PointerInput';
import { clearLocal, downloadSave, loadLocal, readSaveFile, storeLocal } from './ui/saves';
import './styles.css';

const WORLD_SEED = 20261025;

async function start(): Promise<void> {
  // Swap this for a Tiled/LDtk MapSource later; nothing below depends on the format.
  const mapSource: MapSource = new JsonMapSource('vell-reaches', vellReaches as unknown as JsonMapFile);
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

  const worldMap = new WorldMap(map, minimap.worldImage, state, walk);
  const combat = new CombatOverlay(document.getElementById('combat-layer')!, state, renderer);
  state.on('self', (self) => {
    hud.renderSelf(self);
    hud.renderEquipment(self);
    hud.renderInventory(self.inventory);
    hud.renderWindow(self);
  });
  state.on('gameMessage', ({ text, kind }) => hud.addMessage(text, kind));
  state.on('xpDrop', ({ skill, amount }) => hud.showXpDrop(skill, amount));
  state.on('levelUp', ({ skill, level }) => hud.showLevelUp(skill, level));
  server.onMessage((msg) => state.apply(msg, performance.now()));

  /** Display name, allowing for stumps and empty rocks. */
  const nameOf = (e: PublicEntity) => {
    if (e.kind === 'item' && e.qty && e.qty > 1) return `${e.name} (${e.qty})`;
    if (e.depleted) return e.defKey?.endsWith('rock') ? 'Rocks' : `${e.name} stump`;
    return e.name;
  };

  const GATHER_LABELS = { chop: 'Chop down', mine: 'Mine', net: 'Net', rod: 'Bait' } as const;
  const STATION_LABELS: Record<string, string> = { furnace: 'Smelt', anvil: 'Smith', range: 'Cook', bank_booth: 'Bank' };
  /** What each person offers, from the role the map gives them. */
  const NPC_ACTIONS: Record<string, string> = Object.fromEntries(
    Object.values(map.defs.npcs).flatMap((n): [string, string][] => {
      if (isBanker(n)) return [[n.key, 'Bank']];
      if (shopForNpc(n.key)) return [[n.key, 'Trade']];
      return [];
    }),
  );

  /** The left-click action on an entity, if it has one besides walking. */
  const primaryAction = (e: PublicEntity | undefined): { label: string; run: () => void } | null => {
    if (!e) return null;
    if (e.kind === 'monster') return e.dead ? null : { label: 'Attack', run: () => server.send({ type: 'attack', targetId: e.id }) };
    const use = (action: 'gather' | 'take' | 'use') => () => server.send({ type: 'interact', targetId: e.id, action });
    if (e.kind === 'item') return { label: 'Take', run: use('take') };
    const data = e.kind === 'resource' && e.defKey ? RESOURCE_DATA[e.defKey] : undefined;
    if (data && !e.depleted) return { label: GATHER_LABELS[data.verb], run: use('gather') };
    if (e.kind === 'station' && e.defKey && STATION_LABELS[e.defKey]) return { label: STATION_LABELS[e.defKey], run: use('use') };
    const npcAction = e.kind === 'npc' && e.defKey ? NPC_ACTIONS[e.defKey] : undefined;
    if (npcAction) return { label: npcAction, run: use('use') };
    return null;
  };

  /** Fishing spots are ripples on the water, so a click on that tile counts as clicking the spot. */
  const entityAt = (pick: PickResult): EntityId | null => {
    if (pick.entityId !== null) return pick.entityId;
    for (const view of state.entities.values()) {
      const d = view.data;
      if (d.kind === 'resource' && d.x === pick.tile.x && d.y === pick.tile.y) return d.id;
    }
    return null;
  };

  /** Human-readable description of whatever is under the cursor. */
  const describe = (pick: PickResult): { action: string; target: string } => {
    if (pick.buildingName !== undefined) return { action: 'Walk into', target: pick.buildingName || 'Hut' };
    const id = entityAt(pick);
    if (id !== null) {
      const e = state.entities.get(id)?.data;
      if (e?.kind === 'player') return { action: 'Walk here', target: `${e.name} (level-${e.combatLevel})` };
      if (e?.kind === 'monster') return { action: e.dead ? 'Walk here' : 'Attack', target: `${e.name} (level-${e.combatLevel})` };
      const primary = primaryAction(e);
      if (e && primary) return { action: primary.label, target: nameOf(e) };
      if (e) return { action: e.kind === 'item' ? 'Walk here' : 'Walk to', target: nameOf(e) };
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
      if (!pick) return;
      const id = entityAt(pick);
      const primary = id !== null ? primaryAction(state.entities.get(id)?.data) : null;
      if (primary) {
        renderer.showClick(pick.tile);
        primary.run();
      } else walk(pick.tile);
    },
    menu: (x, y) => {
      const pick = renderer.pick(x, y);
      if (!pick) return;
      const { target } = describe(pick);
      hud.hideTooltip();
      renderer.setHover(pick.tile);
      const id = entityAt(pick);
      const e = id !== null ? state.entities.get(id)?.data : undefined;
      const primary = primaryAction(e);
      const options = [];
      if (primary) options.push({ label: primary.label, target, action: primary.run });
      options.push({ label: 'Walk here', target: e?.kind === 'player' || pick.buildingName ? target : undefined, action: () => walk(pick.tile) });
      if (e && e.id !== state.playerId) options.push({ label: 'Examine', target, action: () => server.send({ type: 'examine', targetId: e.id }) });
      hud.showMenu(x, y, options);
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

  // --- Inventory --------------------------------------------------------------
  hud.inventoryHandlers = {
    open: (slot, x, y) => {
      const stack = state.self?.inventory[slot];
      if (!stack) return;
      const name = ITEMS[stack.itemId]?.name ?? stack.itemId;
      const examine = { label: 'Examine', target: name, action: () => server.send({ type: 'examineItem', slot }) };
      const ui = state.self?.ui;
      hud.hideTooltip();
      if (ui?.kind === 'bank') {
        const deposit = (qty: number) => () => server.send({ type: 'bankDeposit', slot, qty });
        hud.showMenu(x, y, [
          { label: 'Deposit-1', target: name, action: deposit(1) },
          { label: 'Deposit-5', target: name, action: deposit(5) },
          { label: 'Deposit-All', target: name, action: deposit(100_000) },
          examine,
        ]);
      } else if (ui?.kind === 'shop') {
        const sell = (qty: number) => () => server.send({ type: 'shopSell', slot, qty });
        const price = Math.floor((ITEMS[stack.itemId]?.value ?? 0) * SELL_RATE);
        const buys = stack.itemId !== 'coins' && (ui.buys === 'all' || ui.buys.includes(stack.itemId));
        const value = () => hud.addMessage(buys ? `${name}: the shop will pay ${price} coin${price === 1 ? '' : 's'} each.` : `The shop won't buy ${name.toLowerCase()}.`);
        hud.showMenu(x, y, [
          ...(buys ? [{ label: 'Sell 1', target: name, action: sell(1) }, { label: 'Sell 5', target: name, action: sell(5) }, { label: 'Sell All', target: name, action: sell(100_000) }] : []),
          { label: 'Value', target: name, action: value },
          examine,
        ]);
      } else {
        const item = ITEMS[stack.itemId];
        const use = item?.heals
          ? [{ label: 'Eat', target: name, action: () => server.send({ type: 'eat', slot }) }]
          : item?.equip
            ? [{ label: item.equip.slot === 'weapon' ? 'Wield' : 'Wear', target: name, action: () => server.send({ type: 'equip', slot }) }]
            : [];
        hud.showMenu(x, y, [...use, { label: 'Drop', target: name, action: () => server.send({ type: 'invDrop', slot }) }, examine]);
      }
    },
    move: (from, to) => server.send({ type: 'invMove', from, to }),
  };

  hud.equipmentHandlers = {
    unequip: (slot) => server.send({ type: 'unequip', slot }),
    setStyle: (style) => server.send({ type: 'setAttackStyle', style }),
    examine: (itemId) => hud.addMessage(ITEMS[itemId]?.examine ?? '', 'examine'),
  };

  // --- Bank, shop and crafting windows -----------------------------------------
  hud.windowHandlers = {
    close: () => server.send({ type: 'closeInterface' }),
    withdraw: (index, qty) => server.send({ type: 'bankWithdraw', index, qty }),
    depositAll: () => server.send({ type: 'bankDepositAll' }),
    buy: (itemId, qty) => server.send({ type: 'shopBuy', itemId, qty }),
    craft: (recipeId, qty) => server.send({ type: 'craft', recipeId, qty }),
    examine: (itemId) => hud.addMessage(ITEMS[itemId]?.examine ?? '', 'examine'),
  };

  // --- Saving ---------------------------------------------------------------------
  // The browser keeps one character. It saves every 30 seconds, when the tab
  // is hidden or closed, and on request; export/import move it between devices.
  const saveStatus = document.getElementById('save-status')!;
  let savingEnabled = true;
  let exportNext = false;
  const requestSave = () => {
    if (savingEnabled) server.send({ type: 'requestSave' });
  };
  state.on('saveData', (save) => {
    if (!savingEnabled) return;
    const ok = storeLocal(save);
    const time = new Date(save.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    saveStatus.textContent = ok
      ? `Saved in this browser at ${time}. It also saves every 30 seconds and when you close the tab.`
      : "This browser won't let the game save (private browsing?). Use Export to keep your progress.";
    if (exportNext) {
      exportNext = false;
      downloadSave(save);
    }
  });
  setInterval(requestSave, 30_000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') requestSave();
  });
  window.addEventListener('pagehide', requestSave);
  document.getElementById('save-now')!.addEventListener('click', requestSave);
  document.getElementById('save-export')!.addEventListener('click', () => {
    exportNext = true;
    requestSave();
  });
  document.getElementById('save-import')!.addEventListener('change', async (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = '';
    if (!file) return;
    const save = await readSaveFile(file);
    if (!save) {
      hud.addMessage("That file isn't an Oath of Stur save.", 'warn');
      saveStatus.textContent = "That file isn't an Oath of Stur save.";
      return;
    }
    savingEnabled = false;
    storeLocal(save);
    location.reload();
  });
  const reset = document.getElementById('save-reset') as HTMLButtonElement;
  let resetArmed: ReturnType<typeof setTimeout> | null = null;
  reset.addEventListener('click', () => {
    if (!resetArmed) {
      reset.textContent = 'Click again to delete this character';
      resetArmed = setTimeout(() => {
        reset.textContent = 'Start a new character';
        resetArmed = null;
      }, 4000);
      return;
    }
    savingEnabled = false;
    clearLocal();
    location.reload();
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
    if (e.key === 'Escape') {
      if (worldMap.isOpen) worldMap.hide();
      else if (!hud.menuOpen && state.self?.ui) server.send({ type: 'closeInterface' });
      hud.hideMenu();
    }
    if (e.key.toLowerCase() === 'r') renderer.buildings.roofsEnabled = !renderer.buildings.roofsEnabled;
    if (e.key.toLowerCase() === 'm') worldMap.toggle();
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
    combat.update(now);
    minimap.draw(now);
    worldMap.draw();
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
      const pos = renderer.screenPosition(view.data.id, 1.5, now);
      if (pos) label.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
    }
    for (const label of [...labels.children] as HTMLElement[]) {
      if (!state.entities.has(Number(label.dataset.id))) label.remove();
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Test hook for automated browser checks: only with #debug in the address.
  if (location.hash === '#debug') Object.assign(window, { __oath: { state, renderer, send: (m: Parameters<ServerConnection['send']>[0]) => server.send(m) } });

  await server.connect('Wanderer', loadLocal());
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
