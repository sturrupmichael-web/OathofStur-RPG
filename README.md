# Oath of Stur

A browser RPG with a tile-based world, click-to-move, slow skilling and tick-based
combat. All names, art and lore are original. Art is procedural placeholder geometry.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests
npm run typecheck
npm run build      # static site in client/dist, deploy anywhere
```

## Controls

- Left-click a tile (or the minimap) to walk. The minimap shows the ground around you;
  the Map button, or M, opens the whole region, where you can tap anywhere to walk there
  and pick a skill to see where it is trained.
  Clicking a tree, rock or fishing spot walks over and
  starts gathering; clicking the furnace, anvil or range opens what you can make there; clicking a
  bank booth, banker or shopkeeper opens the bank or shop; clicking a ground item picks it up;
  clicking a monster attacks it.
- Right-click for the options menu (Attack, Chop down, Mine, Net, Bait, Smelt, Trade, Walk here, Examine).
- With the bank or a shop open, click inventory items to deposit or sell them.
- Click an inventory item to Eat, Wield or Wear it, Drop it or Examine it; drag items between slots to rearrange them.
- The Equipment tab shows what you wear and your bonuses (tap an item to take it off), and sets
  your fighting style: Accurate trains Attack, Aggressive trains Strength, Defensive trains Defence.
- The ⚙ tab saves, exports and imports your character. It also saves itself every 30 seconds.
- Q/E, A/D or arrow keys rotate the camera; W/S or up/down tilt; middle-drag rotates; wheel zooms.

## Layout

```
shared/   simulation, protocol types, map loading, game data (no DOM, no rendering)
  data/   maps/vell-reaches.json (source of truth), skills.json (XP curve), items.json,
          resources.json (levels, XP, respawns), recipes.json (smelting, smithing, cooking),
          shops.json, examine.json
client/   Three.js rendering, UI, LocalServer
server/   Node WebSocket server (phase 6)
docs/     PLAN.md: phases, message types, map notes
tools/    vell-reaches.html: the 2D viewer and generator that produced vell-reaches.json
```

## Architecture

- `Simulation` (shared) is the only place game rules live. It runs on a fixed 600 ms tick,
  processes queued player intents, and emits messages. It never uses `Math.random`;
  randomness comes from its seeded `Rng`.
- The client talks to a `ServerConnection`. In single-player that is `LocalServer`, which
  runs the simulation in the browser and passes every message through JSON exactly as a
  socket would. Phase 6 swaps in a `NetworkServer` without touching game logic.
- Maps load through the `MapSource` interface. `JsonMapSource` reads `vell-reaches.json`
  (rows + legend + areas + npcs + skills); a Tiled or LDtk loader can replace it later.
- The world is 384 x 288 tiles, so only what is near a player is sent to them
  (`VIEW_RADIUS`), and ground cover is built in 32 x 32 chunks that follow the player.

## Map decisions

The world is The Vell Reaches: 384 x 288 tiles, with Kelmoor inside it at offset
(130, 70), six towns, the Ashen Waste to the north, desert, swamp, mountains and a south
coast. `tools/vell-reaches.html` is both the viewer and the generator: edit it and
regenerate `shared/data/maps/vell-reaches.json` from its Copy button (or
`window.__REGION.json()`), never by hand.

The legend only gives a name and walkable flag, so `JsonMapSource` decides by name which
tiles are objects (trees, rocks, anvils, bank booths, stalls, tents, ...) and gives each
the most common walkable ground around it. Objects whose skill has not been built yet
(glyph shrines, farming patches, agility obstacles, the homestead gate) load as props you
can examine, and start working in the phase that adds their skill. Buildings and regions
take their names from the map's `areas`; `skills` lists where each skill is trained, which
feeds the region map's skill finder.

Many trees grow to cover 2 x 2 tiles: when loading, a tree takes the square it stands in
over open grass (or over three more trees of its kind), but only where that blocks no way
through and leaves every neighbouring object a reachable side. A test checks that nothing
reachable in the map file becomes unreachable.

Drawing (client only): building walls run down the middle of their tiles, with the outside
ground and the inside floor meeting under them. Halls, shops, inns and many houses have a
timber-framed upper floor, the keep is three storeys with battlements, and Qadir's
sandstone houses have flat roofs. Grass, dirt, sand and rock blend into each other in the
ground shader (`groundBlend.ts`) instead of meeting at tile edges, and shores wander.

Characters saved before the region existed (save version 1) are moved by the same offset,
so an old character wakes up where they left off.

## Combat

Monster stats and drops live in `shared/data/monsters.json`, gear stats in `items.json`
(`equip`), and the rules in `shared/src/sim/combat.ts`:

- Melee only, from straight beside the target (never diagonally). Every weapon and bare
  fists swing every 4 ticks. Each side rolls (level + 8) x (bonus + 64) for attack against
  defence; a hit does 1 to max hit. The chosen style adds 3 to its skill.
- Each point of damage gives 4 XP to the style's skill and 1.33 to Hitpoints. You regain a
  hitpoint a minute, or eat cooked food (3 ticks between bites).
- Monsters roam their area from the map, chase within 8 tiles of it, and fight back.
  Aggressive ones pick on players whose combat level is at most twice theirs.
- Loot goes to whoever did the most damage and only they see it for a minute, as with
  anything you drop. A dead monster comes back at its spawn point after its respawn time.
- When you die you wake at the spawn point with full health, keeping your three most
  valuable items (counted one by one, so coins rarely make the cut). The rest waits where
  you fell for ten minutes, seen only by you.
