# Oath of Stur: plan before code

## Rendering choice
**Three.js with a fixed-pitch orthographic camera (angled top-down, rotatable with Q/E or middle-drag).**
Low-poly procedural meshes give the 2.5D look cheaply, instanced meshes draw all 6,000 tiles in a handful of draw calls, and raycast picking makes click-to-move and right-click menus straightforward, where a hand-rolled isometric canvas would need its own depth sorting and hit-testing.

## Architecture in one paragraph
`/shared` holds a pure TypeScript `Simulation` (no DOM, no Three.js, no `Math.random`). It owns the world, a seeded RNG, entity IDs, and a `step()` that runs every 600 ms: drain queued intents, then run systems in a fixed order (movement, interaction, skilling, combat, AI, respawns, ground-item visibility), then emit events and state deltas. The client talks to a `ServerConnection` interface. Phases 1–5 use `LocalServer` (runs the sim in the browser on a tick timer and passes messages through a JSON-serialise boundary, so nothing can leak by reference). Phase 6 adds `NetworkServer` (WebSocket) and a Node server that hosts the exact same `Simulation`. Map loading goes through a `MapSource` interface; `JsonMapSource` reads maps/kelmoor.json (it replaced the original world.txt + legend.json on 2026-10-26), and a Tiled/LDtk source can drop in later.

## Folder structure
```
/package.json              npm workspaces, scripts: dev, build, test
/tsconfig.base.json
/shared
  /data
    /maps/kelmoor.json                  (copied verbatim, source of truth)
    items.json        names, examine text, value, stackable, equip slot + stats
    skills.json       XP curve parameters, per-action XP
    resources.json    success-rate tuning, tool tiers, fish level splits
    monsters.json     HP, stats, attack speed, wander radius, aggro range, respawn
    drops.json        drop tables per monster
    recipes.json      cooking, smelting, smithing
    shops.json        stock + buy/sell prices
    dialogue.json, quests.json
  /src
    /map       MapSource interface, JsonMapSource, tile/legend types
    /sim       Simulation, World, entities, systems/*, pathfinding (A*), combat formulas
    /protocol  ClientMessage / ServerMessage types, version number
    /save      save schema (versioned) + migrations
    rng.ts     seeded PRNG (state serialisable)
  /test        vitest: pathfinding, XP curve, determinism (same seed + intents = same state)
/client
  index.html, vite.config.ts
  /src
    /net       ServerConnection interface, LocalServer, (phase 6) NetworkServer
    /render    scene, terrain, entity meshes, camera, picking, tick interpolation
    /ui        side-panel tabs, chat box, minimap, context menu, tooltip, popups
    /audio     WebAudio-generated sound effects (phase 5)
/server        (phase 6) Node + ws, hosts Simulation, saves per account
```

## Message types
Every message has `type`. Client messages are intents only; the sim validates everything.

**Client → server**
| type | payload |
|---|---|
| `join` | name, save blob (local) or token (network) |
| `walk` | x, y |
| `interact` | targetId, action (`chop`, `mine`, `fish`, `talk`, `bank`, `use`...) |
| `attack` | targetId |
| `examine` | targetId or tile x,y |
| `pickup` | groundItemId |
| `dialogueChoice` | option index |
| `invMove` / `invDrop` / `invUse` | slot(s), optional target |
| `equip` / `unequip` | inventory slot / equipment slot |
| `bankDeposit` / `bankWithdraw` | itemId, qty |
| `shopBuy` / `shopSell` | shopId, itemId, qty |
| `craft` | recipeId, qty (smelt, smith, cook "make X") |
| `closeInterface` | |
| `chat` | text (phase 6) |
| `requestSave` | |

**Server → client**
| type | payload |
|---|---|
| `welcome` | your playerId, protocol version, tick, map id |
| `snapshot` | full visible state (on join / resync) |
| `tick` | tick number + entity deltas (spawned, moved, changed, removed) |
| `self` | your inventory, equipment, skills, quest state (only when changed) |
| `gameMessage` | text, kind (info, warn, examine, quest) |
| `xpDrop` | skill, amount |
| `levelUp` | skill, new level |
| `hit` | attackerId, targetId, damage, targetHp |
| `animation` | entityId, kind (chop, mine, swing, death...) |
| `dialogue` | npcId, lines, options |
| `openInterface` | bank / shop / craft with its contents |
| `closeInterface` | |
| `chat` | from, text (phase 6) |
| `sound` | id, x, y (phase 5) |
| `saveData` | versioned save blob |
| `reject` | reason (bad intent, rate limit) |

## Phases (stop after each for play-testing)
1. Map loader behind `MapSource`, Simulation + seeded RNG + tick loop, LocalServer, Three.js terrain with readable area colours, camera, click-to-move with A*, hover tooltip, minimap.
2. Inventory, Woodcutting, XP curve + levels, examine, XP drops, level-up popup, localStorage save with export/import.
3. Mining, Fishing, Cooking, Smithing, bank chests, Shopkeeper and Cook Tobin shops.
4. Combat, monster spawns/wander/aggro, equipment, ground items with owner timer, gate requirement, death/respawn.
5. Elder Maren starter quest, Cinder Drake boss, polish, sound effects.
6. Node WebSocket server, multiple players, shared nodes, chat, name login, server-side saves, interpolation.

## Save format
`{ version, playerId, name, position, skills: {skill: xp}, inventory: [{itemId, qty}|null x28], equipment, bank, quests, createdAt, updatedAt }`. XP is stored (levels are derived). The same record maps 1:1 onto a per-account database row later; `version` + migrations keep old saves loading.

## Map and legend: issues I found (nothing changed)
I parsed both files: 60 rows x 100 columns, every character is in the legend, every legend entry is used, and the spawn coordinates match the `P` tile. Every town NPC, station and outside-gate resource is reachable from spawn. These need your call:

1. **Gate "combat 20"**: `combat` isn't one of the nine skills. I'd use a derived combat level (original formula from Attack, Strength, Defence, Hitpoints; a fresh character is level 3). I'd also let players always walk *out* through the gate.
2. **Fishing spots have no `respawnTicks`**. I'd make them non-depleting (or say if you want them to move/deplete).
3. **Each fishing spot lists two fish with one level.** Proposed: minnow 1 / perch 15 (shallow), pike 35 / salmon 50 (deep).
4. **Tools for woodcutting and mining aren't listed** (only fishing has `tool`). I'll assume an axe and pickaxe are required, since the shop sells them.
5. **Base terrain under resources, stations, NPCs and monsters isn't given** (only `P` has `base`). I'll infer: fishing spots sit on water, indoor things on floor, everything else on grass.
6. **`P` has base grass but sits in the middle of the north–south road** (x=42), so spawn would show a one-tile gap in the road. Probably meant `"base": "="`?
7. **Roads cross the river on rows 13 and 30** (x=60–63). I'll render these as bridges.
8. **23 grass tiles in the west forest are sealed in by trees** (e.g. around 18–22,10–14 and 5–6,9–11). Harmless; clicking one walks to the nearest reachable tile.
9. **Elder Maren stands inside the general store** with the Shopkeeper. Intended?
10. **Only the hen has drops, and no monster has HP, stats or respawn time.** I'll fill these in under /shared/data with first-pass numbers.
11. **One monster per spawn character** (8 hens, 14 goblins, 11 marsh wolves, etc.) is how I'll read it.
12. Not a bug, just noting: all yew trees, all starsteel rocks and 3 of the 7 coal rocks are inside Hollowmere, so Woodcutting 60 and Mining 55 content sits behind the combat gate.
13. Bar tiers: bronze (copper + tin), iron, steel (iron + coal), starsteel. These are real metals plus your legend's starsteel; say if you want invented names instead.
