import {
  FURNITURE,
  ITEMS,
  JsonMapSource,
  MAX_LEVEL,
  OBSTACLE_KINDS,
  QUESTS,
  RESOURCE_DATA,
  SKILLS,
  SELL_RATE,
  SPELL_BY_ID,
  type SpellDef,
  WorldGrid,
  areaAt,
  isBanker,
  obstacleAt,
  packStations,
  shopForNpc,
  type EntityId,
  type FurnitureUse,
  type InteractAction,
  type JsonMapFile,
  type MapSource,
  type Point,
  type PublicEntity,
  type SaveData,
  type SelfState,
  countItem,
  xpForLevel,
} from '@rpg/shared';
import vellReaches from '@rpg/shared/data/maps/vell-reaches.json';
import { Sound, type SoundName } from './audio/Sound';
import { account } from './net/account';
import { CloudSave, type CloudStatus } from './net/cloudSave';
import { LocalServer } from './net/LocalServer';
import type { ServerConnection } from './net/ServerConnection';
import { summary } from './net/syncRules';
import { missileFlight } from './render/EntityLayer';
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

/** The sound of setting off over each kind of agility obstacle. */
const CROSS_SOUNDS: Record<string, SoundName> = {
  log: 'balance',
  hurdle: 'jump',
  net: 'climb',
  rope: 'rope_swing',
  stones: 'jump',
  pipe: 'crawl',
  bars: 'climb',
  wall: 'climb',
};

/** Asks which character to keep when this browser and the cloud save both changed. */
function chooseSave(local: SaveData, cloud: SaveData): Promise<'local' | 'cloud'> {
  const box = document.getElementById('save-choice')!;
  const describe = (s: SaveData) => {
    const sum = summary(s);
    const when = new Date(sum.savedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' });
    return `Total level ${sum.totalLevel}\n${sum.quests} quest${sum.quests === 1 ? '' : 's'} done\nSaved ${when}`;
  };
  const sides = box.querySelectorAll<HTMLButtonElement>('.save-choice-sides button');
  sides.forEach((b) => (b.querySelector('span')!.textContent = describe(b.dataset.side === 'cloud' ? cloud : local)));
  document.getElementById('save-choice-export')!.onclick = () => downloadSave(local);
  box.hidden = false;
  return new Promise((resolve) =>
    sides.forEach((b) =>
      (b.onclick = () => {
        box.hidden = true;
        resolve(b.dataset.side as 'local' | 'cloud');
      }),
    ),
  );
}

const cloud = new CloudSave();

async function start(): Promise<void> {
  // Back from Google with a sign-in, or not; then which character to play.
  account.init();
  const startSave = await cloud.pick(loadLocal(), chooseSave);

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
    hud.renderQuests(self.quests, self.questPoints);
    talkAnimations(self.ui);
  });
  state.on('questComplete', ({ name, rewards, questPoints }) => hud.showQuestComplete(name, rewards, questPoints));

  // --- Sound ------------------------------------------------------------------
  const sound = new Sound();
  // Browsers keep audio locked until the player clicks or presses a key.
  for (const type of ['pointerdown', 'keydown'] as const) window.addEventListener(type, () => sound.unlock(), true);
  const soundToggle = document.getElementById('sound-toggle') as HTMLButtonElement;
  const soundVolume = document.getElementById('sound-volume') as HTMLInputElement;
  const showSound = () => {
    soundToggle.textContent = sound.enabled ? 'Sound on' : 'Sound off';
    soundToggle.setAttribute('aria-pressed', String(sound.enabled));
    soundVolume.value = String(Math.round(sound.volume * 100));
  };
  showSound();
  soundToggle.addEventListener('click', () => {
    sound.set(!sound.enabled, sound.volume);
    showSound();
    sound.play('click');
  });
  soundVolume.addEventListener('input', () => sound.set(sound.enabled, Number(soundVolume.value) / 100));
  soundVolume.addEventListener('change', () => sound.play('click'));

  /** Quieter the further away it happens; silent past 15 tiles. */
  const near = (id: EntityId) => {
    const me = state.player;
    const it = state.entities.get(id);
    if (!me || !it) return 0;
    if (id === me.data.id) return 1;
    const d = Math.hypot(it.toX - me.toX, it.toY - me.toY);
    return Math.max(0, 1 - d / 15) * 0.8;
  };
  const ANIM_SOUNDS: Record<string, SoundName> = {
    punch: 'punch',
    stab: 'swing',
    slash: 'swing',
    swing: 'swing',
    eat: 'eat',
    bite: 'bite',
    sting: 'sting',
    peck: 'peck',
    butt: 'moo',
    wail: 'wail',
    breath: 'breath',
    shoot: 'shoot',
    drink: 'drink',
    bury: 'bury',
    scatter: 'scatter',
    pray: 'pray',
    spread: 'spread',
    pour: 'pour',
    teleport: 'teleport',
    arrive: 'arrive',
    gild: 'gild',
    forge: 'forge',
    bash: 'swing',
  };
  state.on('animation', ({ entityId, kind }) => {
    const e = state.entities.get(entityId)?.data;
    if (!e) return;
    if (kind === 'death') sound.play(e.kind === 'player' ? 'death' : 'monster_death', near(entityId));
    else if (kind === 'bite' && e.defKey === 'cinder_drake') sound.play('roar', near(entityId));
    else if (ANIM_SOUNDS[kind]) sound.play(ANIM_SOUNDS[kind], near(entityId));
  });
  // Bigger hits land with a deeper thud.
  state.on('hit', (hit) => {
    const { targetId, damage, maxHp } = hit;
    const land = () =>
      hit.spell
        ? sound.play(damage > 0 ? 'spell_hit' : 'splash', near(targetId))
        : damage > 0
          ? sound.play('hit', near(targetId), 1.15 - Math.min(0.45, damage / Math.max(1, maxHp)))
          : sound.play('miss', near(targetId));
    const flight = missileFlight(state, hit);
    // The spell's own sound as it leaves the hand.
    if (hit.spell && flight) setTimeout(() => sound.play(`cast_${hit.spell!.element}` as SoundName, near(hit.attackerId)), flight.loose);
    if (flight) setTimeout(land, flight.loose + flight.ms);
    else land();
  });
  renderer.entities.onImpact = (id, activity) => sound.play(activity as SoundName, near(id) * (id === state.playerId ? 0.8 : 0.5));
  // A fire catching nearby.
  state.on('added', (v) => v.data.kind === 'station' && v.data.defKey === 'fire' && sound.play('ignite', near(v.data.id)));
  // Agility: a sound for each obstacle as someone sets off over it, and a thump if they fall.
  state.on('tick', () => {
    for (const view of state.entities.values()) {
      const c = view.data.crossing;
      const key = c ? `${c.from.x},${c.from.y},${c.obstacle}` : undefined;
      if (key && view.crossSound !== key) sound.play(CROSS_SOUNDS[c!.obstacle], near(view.data.id));
      view.crossSound = key;
      if (c?.fall && !view.fellSound && state.crossProgress(view, performance.now()) > 0) {
        view.fellSound = true;
        setTimeout(() => sound.play('fall', near(view.data.id)), c.ms * 0.7);
      }
      if (!c) view.fellSound = false;
    }
  });
  // A shrine's chime as the glyphs take.
  state.on('gameMessage', ({ text }) => text.startsWith('The shrine marks your shards') && sound.play('inscribe_done'));
  state.on('levelUp', () => sound.play('levelup'));
  state.on('questComplete', () => sound.play('quest_complete'));
  state.on('gameMessage', ({ text, kind }) => {
    if (kind === 'quest' && !text.startsWith('Congratulations')) sound.play('quest');
  });
  let coins: number | null = null;
  let praying: readonly string[] | null = null;
  state.on('self', (self) => {
    const now = countItem(self.inventory, 'coins');
    if (coins !== null && now > coins) sound.play('coins');
    coins = now;
    // A chime as a prayer comes on, a falling one as they go off.
    if (praying && self.prayers.some((p) => !praying!.includes(p))) sound.play('prayer_on');
    else if (praying && praying.some((p) => !(self.prayers as string[]).includes(p))) sound.play('prayer_off');
    praying = self.prayers;
  });

  // Whoever is speaking gestures as each page of a conversation appears, and the person turns to you.
  let lastPage = '';
  const talkAnimations = (ui: SelfState['ui']) => {
    const key = ui?.kind === 'dialogue' ? `${ui.npcId}:${ui.text}` : '';
    if (key === lastPage) return;
    lastPage = key;
    if (ui?.kind !== 'dialogue' || state.playerId === null) return;
    renderer.entities.face(ui.npcId, state.playerId);
    renderer.entities.face(state.playerId, ui.npcId);
    renderer.entities.play(ui.speaker === 'npc' ? ui.npcId : state.playerId, 'talk', performance.now());
  };
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
  /** What clicking a farming patch does, from how it looks to you. */
  const patchAction = (e: PublicEntity): string => {
    const p = e.patch!;
    if (p.dead) return 'Clear';
    if (p.crop && p.stage === p.stages) return e.name === 'Herb patch' ? 'Pick' : 'Harvest';
    if (p.diseased) return 'Cure';
    if (!p.crop && p.weeds > 0) return 'Rake';
    return 'Inspect';
  };
  const STATION_LABELS: Record<string, string> = { furnace: 'Smelt', anvil: 'Smith', range: 'Cook', fire: 'Cook', campfire: 'Cook', bank_booth: 'Bank', altar: 'Pray' };
  /** What each person offers, from the role the map gives them. */
  const NPC_ACTIONS: Record<string, string> = Object.fromEntries(
    Object.values(map.defs.npcs).flatMap((n): [string, string][] => {
      if (isBanker(n)) return [[n.key, 'Bank']];
      if (shopForNpc(n.key)) return [[n.key, 'Trade']];
      return [];
    }),
  );

  /** What built homestead furniture does, as its left-click. */
  const FURNITURE_LABELS: Record<FurnitureUse, string> = { range: 'Cook-on', altar: 'Offer-bones', tools: 'Take-tools', rest: 'Rest', portal: 'Enter', pool: 'Drink-from' };

  /** The left-click action on an entity, if it has one besides walking. */
  const primaryAction = (e: PublicEntity | undefined): { label: string; run: () => void } | null => {
    if (!e) return null;
    if (e.kind === 'monster') return e.dead ? null : { label: 'Attack', run: () => server.send({ type: 'attack', targetId: e.id }) };
    const use = (action: 'gather' | 'take' | 'use' | 'talk') => () => server.send({ type: 'interact', targetId: e.id, action });
    const use_ = (action: InteractAction) => () => server.send({ type: 'interact', targetId: e.id, action });
    if (e.kind === 'item') return { label: 'Take', run: use('take') };
    const data = e.kind === 'resource' && e.defKey ? RESOURCE_DATA[e.defKey] : undefined;
    if (data && !e.depleted) return { label: GATHER_LABELS[data.verb], run: use('gather') };
    if (e.kind === 'station' && e.defKey && STATION_LABELS[e.defKey]) return { label: STATION_LABELS[e.defKey], run: use('use') };
    const obstacle = e.defKey === 'agility_obstacle' ? obstacleAt(e.x, e.y) : undefined;
    if (obstacle) return { label: OBSTACLE_KINDS[obstacle.type].verb, run: () => server.send({ type: 'interact', targetId: e.id, action: 'cross' }) };
    if (e.defKey === 'glyph_shrine') return { label: 'Inscribe', run: () => server.send({ type: 'interact', targetId: e.id, action: 'inscribe' }) };
    if (e.patch) return { label: patchAction(e), run: () => server.send({ type: 'interact', targetId: e.id, action: 'farm' }) };
    if (e.defKey === 'homestead_gate') return { label: 'Open', run: () => server.send({ type: 'interact', targetId: e.id, action: 'enter' }) };
    if (e.spot) {
      const use = e.spot.tier ? FURNITURE[e.spot.kind]?.use : undefined;
      if (use) return { label: FURNITURE_LABELS[use], run: use === 'altar' ? use_('offer') : use_('use') };
      return { label: 'Build', run: use_('build') };
    }
    const npcAction = e.kind === 'npc' && e.defKey ? NPC_ACTIONS[e.defKey] : undefined;
    if (npcAction) return { label: npcAction, run: use('use') };
    if (e.kind === 'npc') return { label: 'Talk-to', run: use('talk') };
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

  /**
   * "Use" on an item picks it up on the cursor: the next thing clicked in the
   * world has it used on it (seeds on a patch, shards on a shrine).
   */
  let using: { slot: number; itemId: string; name: string } | null = null;
  const stopUsing = () => {
    using = null;
    hud.setUsing(null);
  };
  /**
   * A spell picked from the spellbook waits on the cursor the same way: a
   * combat spell for a creature to throw it at, an item spell for something
   * in the pack.
   */
  let casting: SpellDef | null = null;
  const stopCasting = () => {
    casting = null;
    hud.setCasting(null);
  };
  /** A creature a spell could be thrown at, under the cursor. */
  const castTarget = (pick: PickResult): PublicEntity | undefined => {
    const id = entityAt(pick);
    const e = id !== null ? state.entities.get(id)?.data : undefined;
    return e?.kind === 'monster' && !e.dead ? e : undefined;
  };
  /** The entity a use would land on: anything but yourself and the ground. */
  const useTarget = (pick: PickResult): PublicEntity | undefined => {
    const id = entityAt(pick);
    const e = id !== null ? state.entities.get(id)?.data : undefined;
    return e && e.id !== state.playerId ? e : undefined;
  };

  /** Human-readable description of whatever is under the cursor. */
  const describe = (pick: PickResult): { action: string; target: string } => {
    if (casting) {
      const e = casting.kind === 'combat' ? castTarget(pick) : undefined;
      return { action: `Cast ${casting.name} ->`, target: e ? `${e.name} (level-${e.combatLevel})` : '' };
    }
    if (using) {
      const e = useTarget(pick);
      return { action: `Use ${using.name} ->`, target: e ? nameOf(e) : '' };
    }
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
      if (casting) {
        const spell = casting;
        const target = spell.kind === 'combat' ? castTarget(pick) : undefined;
        stopCasting();
        if (target) {
          renderer.showClick(pick.tile);
          server.send({ type: 'cast', spell: spell.id, targetId: target.id });
        }
        return;
      }
      if (using) {
        const target = useTarget(pick);
        const slot = using.slot;
        stopUsing();
        if (target) {
          renderer.showClick(pick.tile);
          server.send({ type: 'useOn', slot, targetId: target.id });
        }
        return;
      }
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
      if (casting) {
        const spell = casting;
        if (spell.kind === 'combat' && e?.kind === 'monster' && !e.dead) {
          options.push({ label: `Cast ${spell.name} ->`, target, action: () => (stopCasting(), server.send({ type: 'cast', spell: spell.id, targetId: e.id })) });
        }
        options.push({ label: 'Cancel', target: undefined, action: stopCasting });
        hud.showMenu(x, y, options);
        return;
      }
      const useOn = using && e && e.id !== state.playerId ? { slot: using.slot, label: `Use ${using.name} ->` } : null;
      if (useOn) options.push({ label: useOn.label, target, action: () => (stopUsing(), server.send({ type: 'useOn', slot: useOn.slot, targetId: e!.id })) });
      if (using) {
        options.push({ label: 'Cancel', target: undefined, action: stopUsing });
        hud.showMenu(x, y, options);
        return;
      }
      if (primary) options.push({ label: primary.label, target, action: primary.run });
      if (e?.kind === 'station' && e.defKey === 'altar') {
        options.push({ label: 'Offer-bones', target, action: () => server.send({ type: 'interact', targetId: e.id, action: 'offer' }) });
      }
      // Built furniture: pray at a homestead altar, look at what else could go there, or take it down.
      if (e?.spot?.tier) {
        const act = (label: string, action: InteractAction) => options.push({ label, target, action: () => server.send({ type: 'interact', targetId: e.id, action }) });
        if (FURNITURE[e.spot.kind]?.use === 'altar') act('Pray', 'use');
        if (primary?.label !== 'Build') act('Build', 'build');
        act('Remove', 'remove');
      }
      if (e?.kind === 'npc' && primary?.label !== 'Talk-to') {
        options.push({ label: 'Talk-to', target, action: () => server.send({ type: 'interact', targetId: e.id, action: 'talk' }) });
      }
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
      if (using) return stopUsing();
      if (casting) {
        const spell = casting;
        stopCasting();
        if (spell.kind === 'item' && stack) server.send({ type: 'cast', spell: spell.id, slot });
        return;
      }
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
        for (const station of packStations(stack.itemId).reverse()) {
          use.unshift({ label: station === 'fletching' ? 'Fletch' : 'Mix', target: name, action: () => server.send({ type: 'useItem', slot, station }) });
        }
        if (item?.burn) use.unshift({ label: 'Light', target: name, action: () => server.send({ type: 'light', slot }) });
        if (item?.bury) use.unshift({ label: stack.itemId === 'ashes' ? 'Scatter' : 'Bury', target: name, action: () => server.send({ type: 'bury', slot }) });
        if (item?.clean) use.unshift({ label: 'Clean', target: name, action: () => server.send({ type: 'clean', slot }) });
        if (item?.drink) use.unshift({ label: 'Drink', target: name, action: () => server.send({ type: 'drink', slot }) });
        if (stack.itemId === 'contract_stone') use.unshift({ label: 'Check', target: name, action: () => server.send({ type: 'useItem', slot }) });
        const pickUp = { label: 'Use', target: name, action: () => ((using = { slot, itemId: stack.itemId, name }), hud.setUsing(slot)) };
        hud.showMenu(x, y, [...use, pickUp, { label: 'Drop', target: name, action: () => server.send({ type: 'invDrop', slot }) }, examine]);
      }
    },
    move: (from, to) => server.send({ type: 'invMove', from, to }),
  };

  hud.runHandlers = {
    toggle: () => {
      sound.play('click');
      server.send({ type: 'setRun', on: !state.self?.run });
    },
  };
  // Picking something else up, or the item leaving the pack, drops the use.
  state.on('self', (self) => {
    if (using && self.inventory[using.slot]?.itemId !== using.itemId) stopUsing();
  });

  hud.spellHandlers = {
    select: (id) => {
      const spell = SPELL_BY_ID[id];
      if (!spell) return;
      stopUsing();
      if (casting?.id === id) return stopCasting();
      sound.play('click');
      if (spell.kind === 'teleport') {
        stopCasting();
        server.send({ type: 'cast', spell: id });
        return;
      }
      casting = spell;
      hud.setCasting(id);
      // Item spells: over to the pack to pick what to cast it on.
      const pack = document.querySelector<HTMLButtonElement>('.tab[data-tab="inventory"]');
      if (spell.kind === 'item' && pack && !pack.classList.contains('active')) pack.click();
    },
    autocast: (id) => {
      sound.play('autocast');
      server.send({ type: 'setAutocast', spell: id });
    },
  };

  hud.prayerHandlers = {
    toggle: (prayer) => server.send({ type: 'togglePrayer', prayer }),
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
    build: (tier) => server.send({ type: 'build', tier }),
    buildRoom: () => server.send({ type: 'buildRoom' }),
    removeFurniture: () => server.send({ type: 'removeFurniture' }),
  };

  hud.dialogueHandlers = {
    choose: (option) => {
      sound.play('click');
      server.send({ type: 'dialogueChoice', option });
    },
  };

  // --- Saving ---------------------------------------------------------------------
  // The browser keeps one character. It saves every 30 seconds, when the tab
  // is hidden or closed, and on request; export/import move it between devices.
  const saveStatus = document.getElementById('save-status')!;
  let savingEnabled = true;
  let exportNext = false;
  let maxNext = false;
  let signInNext = false;
  const requestSave = () => {
    if (savingEnabled) server.send({ type: 'requestSave' });
  };
  state.on('saveData', (save) => {
    if (!savingEnabled) return;
    const ok = storeLocal(save);
    void cloud.push(save);
    if (signInNext) {
      // Saved in this browser first, so nothing is lost on the trip to Google and back.
      savingEnabled = false;
      account.signIn();
      return;
    }
    const time = new Date(save.updatedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    saveStatus.textContent = ok
      ? `Saved in this browser at ${time}. It also saves every 30 seconds and when you close the tab.`
      : "This browser won't let the game save (private browsing?). Use Export to keep your progress.";
    if (exportNext) {
      exportNext = false;
      downloadSave(save);
    }
    if (maxNext) {
      // Dev shortcut: every skill to the top level, then restart on full health and prayer.
      maxNext = false;
      for (const { id } of SKILLS) save.skills[id] = Math.max(save.skills[id] ?? 0, xpForLevel(MAX_LEVEL));
      delete save.hp;
      delete save.prayer;
      savingEnabled = false;
      storeLocal(save);
      location.reload();
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
  // Testing shortcut, only shown with #dev in the address.
  const devMax = document.getElementById('dev-max') as HTMLButtonElement;
  devMax.hidden = location.hash !== '#dev';
  devMax.addEventListener('click', () => {
    maxNext = true;
    requestSave();
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
    // Signed in, the cloud copy goes too, or it would come straight back on reload.
    void cloud.remove().finally(() => location.reload());
  });

  // --- Cloud save (Google sign-in) -----------------------------------------------
  const cloudStatus = document.getElementById('cloud-status')!;
  const signInButton = document.getElementById('cloud-signin') as HTMLButtonElement;
  const signOutButton = document.getElementById('cloud-signout') as HTMLButtonElement;
  const CLOUD_TEXT: Record<CloudStatus, string> = {
    off: '',
    syncing: 'Syncing with your cloud save...',
    synced: 'Your character is saved to the cloud too, and follows you to any device you sign in on.',
    offline: "Can't reach the cloud right now. Your progress is safe in this browser and syncs when it can.",
    conflict: 'Your cloud save changed on another device. Reload the page to choose which character to keep.',
  };
  const showCloud = (status: CloudStatus) => {
    const user = account.user;
    signInButton.hidden = !!user || !account.available;
    signOutButton.hidden = !user;
    reset.textContent = user ? 'Start a new character (also deletes the cloud save)' : 'Start a new character';
    if (user) cloudStatus.textContent = `Signed in as ${user.email || 'a Google account'}. ${CLOUD_TEXT[status]}`;
    else if (!account.available) cloudStatus.textContent = 'Cloud saves work on the game page at michaelsturrup.com/oathofstur/, not in this preview.';
    else cloudStatus.textContent = account.lastError ? `Sign-in didn't finish: ${account.lastError}` : 'Sign in with Google to keep your character in the cloud and play it on any device.';
  };
  cloud.onStatus = showCloud;
  showCloud(cloud.status);
  signInButton.addEventListener('click', () => {
    signInNext = true;
    requestSave();
  });
  signOutButton.addEventListener('click', () => {
    requestSave();
    account.signOut();
    cloud.reset();
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
      if (using) stopUsing();
      else if (casting) stopCasting();
      else if (worldMap.isOpen) worldMap.hide();
      else if (!hud.menuOpen && state.self?.ui) server.send({ type: 'closeInterface' });
      hud.hideMenu();
    }
    // Conversations: space carries on, number keys pick an option.
    const talk = hud.dialogueOpen;
    if (talk && !talk.options && (e.key === ' ' || e.key === 'Enter')) {
      e.preventDefault();
      hud.dialogueHandlers.choose(0);
      return;
    }
    if (talk?.options && /^[1-9]$/.test(e.key) && Number(e.key) <= talk.options.length) {
      hud.dialogueHandlers.choose(Number(e.key) - 1);
      return;
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
    // A marker over whoever has a quest for you, until it's done.
    for (const view of state.entities.values()) {
      const d = view.data;
      if (d.kind !== 'npc') continue;
      const quest = state.self?.quests.find((q) => QUESTS[q.id].giver === d.defKey);
      let marker = labels.querySelector<HTMLElement>(`[data-id="${d.id}"]`);
      if (!quest || quest.status === 'done') {
        marker?.remove();
        continue;
      }
      if (!marker) {
        marker = document.createElement('div');
        marker.className = 'quest-marker';
        marker.dataset.id = String(d.id);
        marker.title = quest.name;
        labels.appendChild(marker);
      }
      marker.textContent = quest.status === 'not_started' ? '!' : '?';
      const pos = renderer.screenPosition(d.id, 2.05, now);
      if (pos) marker.style.transform = `translate(${pos.x}px, ${pos.y}px) translate(-50%, -100%)`;
    }
    for (const label of [...labels.children] as HTMLElement[]) {
      if (!state.entities.has(Number(label.dataset.id))) label.remove();
    }

    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);

  // Test hook for automated browser checks: only with #debug in the address.
  if (location.hash === '#debug') Object.assign(window, { __oath: { state, renderer, send: (m: Parameters<ServerConnection['send']>[0]) => server.send(m) } });

  await server.connect('Wanderer', startSave);
}

start().catch((err) => {
  console.error(err);
  document.body.textContent = `Failed to start: ${err instanceof Error ? err.message : String(err)}`;
});
