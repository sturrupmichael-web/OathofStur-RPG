# Tile RPG

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

- Left-click a tile (or the minimap) to walk. Clicking a tree, rock, NPC or station walks next to it.
- Right-click for the options menu.
- Q/E, A/D or arrow keys rotate the camera; W/S or up/down tilt; middle-drag rotates; wheel zooms.

## Layout

```
shared/   simulation, protocol types, map loading, game data (no DOM, no rendering)
  data/   maps/world.txt + legend.json (source of truth), skills.json, ...
client/   Three.js rendering, UI, LocalServer
server/   Node WebSocket server (phase 6)
docs/     PLAN.md: phases, message types, map notes
```

## Architecture

- `Simulation` (shared) is the only place game rules live. It runs on a fixed 600 ms tick,
  processes queued player intents, and emits messages. It never uses `Math.random`;
  randomness comes from its seeded `Rng`.
- The client talks to a `ServerConnection`. In single-player that is `LocalServer`, which
  runs the simulation in the browser and passes every message through JSON exactly as a
  socket would. Phase 6 swaps in a `NetworkServer` without touching game logic.
- Maps load through the `MapSource` interface. `AsciiMapSource` reads the ASCII map and
  legend; a Tiled or LDtk loader can replace it later.

## Map decisions

The map and legend are used unchanged. Where they were ambiguous, the defaults in
`docs/PLAN.md` ("Map and legend: issues I found") apply. Notably: the gate's "combat 20"
uses a derived combat level, players can always walk out through the gate, and tiles
under resources/NPCs/stations take the terrain around them (fishing spots sit on water).
