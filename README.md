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

- Left-click a tile (or the minimap) to walk. Clicking a tree walks over and chops it; clicking
  a ground item picks it up. Other objects walk you next to them.
- Right-click for the options menu (Chop down, Walk here, Examine).
- Click an inventory item for Drop or Examine; drag items between slots to rearrange them.
- The ⚙ tab saves, exports and imports your character. It also saves itself every 30 seconds.
- Q/E, A/D or arrow keys rotate the camera; W/S or up/down tilt; middle-drag rotates; wheel zooms.

## Layout

```
shared/   simulation, protocol types, map loading, game data (no DOM, no rendering)
  data/   maps/kelmoor.json (source of truth), skills.json (XP curve), items.json,
          resources.json (levels, XP, respawns), examine.json
client/   Three.js rendering, UI, LocalServer
server/   Node WebSocket server (phase 6)
docs/     PLAN.md: phases, message types, map notes
tools/    kelmoor-viewer.html: the 2D viewer and generator that produced kelmoor.json
```

## Architecture

- `Simulation` (shared) is the only place game rules live. It runs on a fixed 600 ms tick,
  processes queued player intents, and emits messages. It never uses `Math.random`;
  randomness comes from its seeded `Rng`.
- The client talks to a `ServerConnection`. In single-player that is `LocalServer`, which
  runs the simulation in the browser and passes every message through JSON exactly as a
  socket would. Phase 6 swaps in a `NetworkServer` without touching game logic.
- Maps load through the `MapSource` interface. `JsonMapSource` reads `kelmoor.json`
  (rows + legend + areas + npcs); a Tiled or LDtk loader can replace it later.

## Map decisions

`kelmoor.json` is used unchanged. The legend only gives a name and walkable flag, so
`JsonMapSource` decides by name which tiles are objects (trees, rocks, anvils, bank booths,
stalls, tents, ...) and gives each the most common walkable ground around it. Buildings
take their names from the map's `areas`. Open questions about the map (no bridge over the
River Vell, an unreachable corner of the Ashen Waste, missing skill and NPC data) are in
the "Kelmoor map: issues and gaps" doc.
