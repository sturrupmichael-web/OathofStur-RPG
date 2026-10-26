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
  bank booth, banker or shopkeeper opens the bank or shop; clicking a ground item picks it up.
- Right-click for the options menu (Chop down, Mine, Net, Bait, Smelt, Trade, Walk here, Examine).
- With the bank or a shop open, click inventory items to deposit or sell them.
- Click an inventory item for Drop or Examine; drag items between slots to rearrange them.
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

Characters saved before the region existed (save version 1) are moved by the same offset,
so an old character wakes up where they left off.
