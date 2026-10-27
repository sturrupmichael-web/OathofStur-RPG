import homesteadData from '../../data/homestead.json';
import { ITEMS } from './items';
import type { DialoguePage, TalkActions } from './quests';

/** What built furniture does when used. Most furniture is only for show (and the XP). */
export type FurnitureUse = 'range' | 'altar' | 'tools' | 'rest' | 'portal' | 'pool';

export interface FurnitureTier {
  name: string;
  level: number;
  xp: number;
  materials: [string, number][];
  /** Tool racks: what can be taken from them. */
  tools?: string[];
  /** Beds: the share of hitpoints a rest brings back. */
  heal?: number;
  /** Altars: Prayer XP per bone, times the bone's own. */
  multiplier?: number;
  /** Portals: the places they open to. */
  to?: string[];
}

export interface FurnitureDef {
  kind: string;
  /** What the spot is called while empty: "Chair space". */
  space: string;
  use?: FurnitureUse;
  tiers: FurnitureTier[];
}

export interface RoomDef {
  id: string;
  name: string;
  level: number;
  coins: number;
}

export interface SpotDef {
  room: string;
  kind: string;
}

/**
 * One player's homestead: whether they own the plot, which rooms they have
 * built, and the tier built at each spot ("x,y"), 1 for the first.
 */
export interface HomesteadState {
  owned: boolean;
  rooms: string[];
  built: Record<string, number>;
}

export const HOMESTEAD = homesteadData as unknown as {
  plotPrice: number;
  buildTicks: number;
  lampBonus: number;
  planks: { logs: string; plank: string; fee: number }[];
};

export const ROOMS: Readonly<Record<string, RoomDef>> = Object.fromEntries(
  Object.entries(homesteadData.rooms).map(([id, r]) => [id, { id, ...r }]),
);

export const FURNITURE: Readonly<Record<string, FurnitureDef>> = Object.fromEntries(
  Object.entries(homesteadData.furniture).map(([kind, f]) => [kind, { kind, ...f } as FurnitureDef]),
);

/** Build spots by tile, "x,y". */
export const SPOTS: Readonly<Record<string, SpotDef>> = homesteadData.spots;

export const PORTALS: Readonly<Record<string, { name: string; x: number; y: number }>> = homesteadData.portals;

export function newHomestead(): HomesteadState {
  return { owned: false, rooms: [], built: {} };
}

/** The garden comes with the plot; every other room is built. */
export function roomBuilt(home: HomesteadState, room: string): boolean {
  return home.owned && (room === 'garden' || home.rooms.includes(room));
}

/** What a build spot holds for this player: the furniture's tier (0 when empty) and whether its room is built. */
export function spotState(home: HomesteadState, key: string): { def: SpotDef; tier: number; room: boolean } | null {
  const def = SPOTS[key];
  if (!def) return null;
  const room = roomBuilt(home, def.room);
  return { def, tier: room ? home.built[key] ?? 0 : 0, room };
}

/** The name a spot shows: what's built there, or the empty space. */
export function spotName(kind: string, tier: number): string {
  const f = FURNITURE[kind];
  return tier > 0 ? f.tiers[tier - 1].name : f.space;
}

/** What talking to Corwin can do. */
export interface HomesteadActions {
  owned(): boolean;
  buyPlot(): 'ok' | 'coins' | 'owned';
}

/** What Jory's saw can do: turn every log of a kind carried into planks, for a fee each. */
export interface SawmillActions {
  make(logs: string): { made: number; short?: 'logs' | 'coins' };
}

const npc = (text: string): DialoguePage => ({ speaker: 'npc', text });
const you = (text: string): DialoguePage => ({ speaker: 'player', text });

/** Corwin, the estate agent in Falcrest: sells the plot, and building supplies. */
export function corwinTalk(a: TalkActions): DialoguePage[] {
  const h = a.homestead!;
  const price = HOMESTEAD.plotPrice.toLocaleString('en-GB');
  const options: NonNullable<DialoguePage['options']> = [];
  if (!h.owned()) {
    options.push({
      label: 'I want to buy some land.',
      then: () => [
        you('I want to buy some land.'),
        {
          speaker: 'npc',
          text: `There's a fine plot just outside the south gate, fenced and with a house already standing. ${price} coins and it's yours.`,
          options: [
            {
              label: `Buy it (${price} coins).`,
              then: () => {
                const result = h.buyPlot();
                if (result === 'coins') return [npc(`It's ${price} coins, I'm afraid. Come back when your purse is heavier.`)];
                return [
                  npc("Done! Here's the gate key; the plot's yours. The house is bare for now: you'll have to fit out each room before you can build in it."),
                  npc('Click a space in the house to see what can go there. Bring a hammer, a saw, and planks: Jory at the Kelmoor sawmill will cut them from your logs.'),
                ];
              },
            },
            { label: 'Not yet.', then: () => [you('Not yet.'), npc("It'll be here. Land always is.")] },
          ],
        },
      ],
    });
  }
  options.push({
    label: 'Tell me about Homesteading.',
    then: () => [
      npc(`Buy the plot outside the south gate (${price} coins) and you have a house to make your own. Only you can open its gate.`),
      npc("Each room has to be fitted out first: that costs coins, and some want more skill than others. Then click any space in it to build: chairs, a stove, a bed, an altar..."),
      npc('You need a hammer and a saw, and the materials: planks, nails, cloth and bricks. I sell all of those. Jory at the Kelmoor sawmill cuts planks from logs for a fee, oak and yew too.'),
      npc('Better pieces need more skill and finer wood. And a good many of them earn their keep: a stove to cook on, a bed to rest in, an altar for your bones, a portal to travel by.'),
    ],
  });
  if (a.trade) options.push({ label: "Let's trade.", then: () => (a.trade!(), []) });
  options.push({ label: 'Just looking.', then: () => [] });
  const greeting = h.owned() ? 'Ah, our landowner! How is the house coming along?' : 'Corwin, estate agent. Looking to put down roots?';
  return [{ speaker: 'npc', text: greeting, options }];
}

/** Jory, at the Kelmoor sawmill: planks cut from logs, and his axes. */
export function joryTalk(a: TalkActions): DialoguePage[] {
  const s = a.sawmill!;
  const options: NonNullable<DialoguePage['options']> = HOMESTEAD.planks.map((p) => ({
    label: `${ITEMS[p.plank].name}s (${p.fee} coins a log)`,
    then: () => {
      const { made, short } = s.make(p.logs);
      const logs = ITEMS[p.logs].name.toLowerCase();
      if (!made) return [npc(short === 'coins' ? `That's ${p.fee} coins a log, and you can't cover even one.` : `You've no ${logs} on you. Bring me some and I'll cut them.`)];
      const cut = `${made} ${ITEMS[p.plank].name.toLowerCase()}${made > 1 ? 's' : ''}`;
      return [npc(short === 'coins' ? `There you go: ${cut}. That's all your coins would stretch to.` : `There you go: ${cut}, nice and square.`)];
    },
  }));
  if (a.trade) options.push({ label: "Let's trade.", then: () => (a.trade!(), []) });
  options.push({ label: 'Just passing by.', then: () => [] });
  return [{ speaker: 'npc', text: "Logs in, planks out. Want me to cut what you're carrying?", options }];
}
