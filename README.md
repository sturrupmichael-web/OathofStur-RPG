# Oath of Stur

A browser RPG with a tile-based world, click-to-move, slow skilling and tick-based
combat. All names, art and lore are original. Art is procedural placeholder geometry.

## Run it

```sh
npm install
npm run dev        # http://localhost:5173
npm test           # simulation tests
npm run typecheck  # game code and tests
npm run build      # static site in client/dist, deploy anywhere
```

### The online world

```sh
npm run build -w client && npm run build -w server
npm start -w server   # http://localhost:8080 plays online against this server
npm run dev:server    # or: server with reload, next to `npm run dev` (Vite joins it on :8080)
```

The server runs one shared `Simulation` and serves the built client from `client/dist`.
Pushes to main deploy it to Fly.io (`fly.toml`, `.github/workflows/deploy.yml`, one machine,
secret `FLY_API_TOKEN`) at https://oath-of-stur.fly.dev. The site's copy of the game starts
solo and can switch to online under ⚙ World; the fly.dev copy starts online.

GitHub Actions runs the typecheck, tests and build on every push to main and every pull request.

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
          resources.json (levels, XP, respawns), recipes.json (smelting, smithing, cooking, fletching),
          shops.json, examine.json
client/   Three.js rendering, UI, LocalServer
server/   Node WebSocket server: GameHost (the shared world), auth (Supabase token check)
docs/     PLAN.md: phases, message types, map notes
tools/    vell-reaches.html: the 2D viewer and generator that produced vell-reaches.json
```

## Architecture

- `Simulation` (shared) is the only place game rules live. It runs on a fixed 600 ms tick,
  processes queued player intents, and emits messages. It never uses `Math.random`;
  randomness comes from its seeded `Rng`.
- The client talks to a `ServerConnection`. In single-player that is `LocalServer`, which
  runs the simulation in the browser and passes every message through JSON exactly as a
  socket would. Online it is `NetworkServer`, a WebSocket to the game server, which
  rejoins by itself after a drop.
- Maps load through the `MapSource` interface. `JsonMapSource` reads `vell-reaches.json`
  (rows + legend + areas + npcs + skills); a Tiled or LDtk loader can replace it later.
- The world is 512 x 384 tiles, so only what is near a player is sent to them
  (`VIEW_RADIUS`), and ground cover is built in 32 x 32 chunks that follow the player.

## Map decisions

The world is The Vell Reaches: 512 x 384 tiles, with Kelmoor inside it at offset
(130, 70), eight towns, the Ashen Waste to the north, desert, swamp, mountains and a south
coast. The generator first builds the original 384 x 288 Reaches with its seeded sequence, then
grows it east and south (Corvane, Frostpeak Mine, Saltmere Fen, the Duskwood, Port Avel)
using only position hashes, so the older land never shifts. A ferry links Saltcombe Docks
and Port Avel across the Saltwind Sea. `tools/vell-reaches.html` is both the viewer and the generator: edit it and
regenerate `shared/data/maps/vell-reaches.json` from its Copy button (or
`window.__REGION.json()`), never by hand. `python3 tools/format-map.py <copied json> shared/data/maps/vell-reaches.json`
lays it out one entry per line so diffs stay readable.

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
- Axes and pickaxes can be wielded, and still work as tools from the weapon slot.

## Quests and bosses

Conversations and quests live in `shared/src/sim/quests.ts`. Talk to anyone (left-click
for people without a shop or bank, or Talk-to in the right-click menu); bankers and
shopkeepers offer their window from the conversation too. Space or a click carries a
conversation on, and number keys pick an option.

- **The First Oath**, from Elder Maren by the fountain in Kelmoor Square, walks a new
  player through the basics: 3 logs, a cooked fish, a bronze bar (she gives you a
  pickaxe), then defeating a goblin. The reward is 300 coins, an iron sword and 150 XP in
  each skill used. Progress is the quest's stage, kept in the save's `quests`.
- **The Cinder Drake** (level 60) lives in the Cinder Pools, far north in the Ashen Waste.
  It attacks anyone nearby, whatever their level. Now and then it breathes fire instead of
  biting, from up to 4 tiles away: fire always lands, for up to 18, and armour does nothing.
  A drakescale shield cuts it to a third. It drops coins, drake scales and food, and
  sometimes a cinder blade (Attack 30) or a drakescale shield (Defence 30).
- **The Gloam Hart** (level 78) sleeps in the Gloaming Glade, deep in the south-east of
  the Duskwood, at the end of the rangers' trail from Vessa's camp. It gores, and throws
  shadow bolts from up to 6 tiles. As its health first drops below two-thirds and again
  below one-third it rears and calls up two gloam shades (level 41); while any shade
  stands, blows pass straight through it. Shades never respawn, and fade when their quarry
  leaves or the hart falls. It drops hart bones, antlers and coins, and sometimes a
  gloamwood longbow (Ranged 50). Vessa's quest **The Gloaming** leads to it.

## Sound

Every sound is synthesised in the browser (`client/src/audio/Sound.ts`), so there are no
audio files. Each work activity has its own sound, timed to when the tool lands, and so do
each monster's attack, hits, misses, eating, deaths, level-ups and quests. Sounds from
other people and monsters get quieter with distance. Options has an on/off switch and
volume, kept in this browser.
