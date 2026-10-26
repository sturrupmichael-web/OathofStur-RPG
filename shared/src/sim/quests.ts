import type { NpcDef } from '../map/types';
import type { SkillId } from './skills';

/**
 * Conversations and quests. A conversation is a list of pages; a page with
 * options branches into whatever its chosen option returns. Anything a
 * conversation changes (taking items, moving a quest on) happens through
 * `TalkActions`, when the pages are worked out or when a page with an
 * `effect` is shown, so the simulation stays the only thing that changes state.
 */
export interface DialoguePage {
  speaker: 'npc' | 'player';
  text: string;
  options?: { label: string; then: () => DialoguePage[] }[];
  /** Runs as the page is shown. Only for things that can't fail, like finishing a quest. */
  effect?: () => void;
}

/** What a conversation can do to the world. The simulation implements it for one player and one NPC. */
export interface TalkActions {
  playerName: string;
  stage(quest: QuestId): number;
  setStage(quest: QuestId, stage: number): void;
  has(itemId: string, qty?: number): boolean;
  /** Carrying or wielding any tool for a skill. */
  hasTool(skill: SkillId): boolean;
  /** Takes items if they are all there; false (taking nothing) if not. */
  take(itemId: string, qty?: number): boolean;
  /** Gives items; what doesn't fit lands at the player's feet. */
  give(itemId: string, qty?: number): void;
  complete(quest: QuestId): void;
  /** Opens this NPC's shop or bank, for people who have one. */
  trade?: () => void;
  bank?: () => void;
}

export type QuestId = 'first_oath';

export interface QuestDef {
  id: QuestId;
  name: string;
  /** NPC key of whoever gives it. */
  giver: string;
  /** Journal line before it starts. */
  start: string;
  /** Journal line for each stage from 1; the stage after the last step is done. */
  steps: string[];
  rewards: string[];
  /** Applied on completion through the actions, so the list above stays in step with what you get. */
  reward: { items: [string, number][]; xp: [SkillId, number][] };
}

export const QUESTS: Readonly<Record<QuestId, QuestDef>> = {
  first_oath: {
    id: 'first_oath',
    name: 'The First Oath',
    giver: 'elder_maren',
    start: 'Elder Maren waits by the fountain in Kelmoor Square. She may have work for a newcomer.',
    steps: [
      'Elder Maren wants 3 logs. Trees grow in Kelmoor Park, just south-east of the square.',
      'She wants a cooked fish. Net some minnows where the river runs east of Kelmoor, then cook them on the range in the Blue Gull Inn.',
      'She wants a bronze bar. Mine copper and tin ore at Copperback Mine, south-east of town, then smelt them at the furnace in the Smithy, west of the square.',
      'She wants me to defeat a goblin at the Goblin Encampment, south-west of Kelmoor.',
      "The goblin is beaten. I should tell Elder Maren.",
    ],
    rewards: ['1 quest point', '300 coins', 'An iron sword', '150 XP each in Woodcutting, Fishing, Cooking, Mining, Smithing and Attack'],
    reward: {
      items: [['coins', 300], ['iron_sword', 1]],
      xp: [['woodcutting', 150], ['fishing', 150], ['cooking', 150], ['mining', 150], ['smithing', 150], ['attack', 150]],
    },
  },
};

export const QUEST_IDS = Object.keys(QUESTS) as QuestId[];

/** The stage a quest reaches when it's finished. */
export function doneStage(quest: QuestDef): number {
  return quest.steps.length + 1;
}

export interface QuestView {
  id: QuestId;
  name: string;
  status: 'not_started' | 'in_progress' | 'done';
  /** Journal lines so far: finished steps are crossed off. */
  steps: { text: string; done: boolean }[];
  rewards: string[];
}

export function questView(id: QuestId, stage: number): QuestView {
  const q = QUESTS[id];
  const done = stage >= doneStage(q);
  const status = done ? 'done' : stage > 0 ? 'in_progress' : 'not_started';
  const steps = stage === 0 ? [{ text: q.start, done: false }] : q.steps.slice(0, Math.min(stage, q.steps.length)).map((text, i) => ({ text, done: done || i < stage - 1 }));
  return { id, name: q.name, status, steps, rewards: q.rewards };
}

const COOKED_FISH = ['minnows', 'perch', 'pike'];

const npc = (text: string): DialoguePage => ({ speaker: 'npc', text });
const you = (text: string): DialoguePage => ({ speaker: 'player', text });

/** Elder Maren: the starter quest, then advice about the drake. */
function elderMaren(a: TalkActions): DialoguePage[] {
  const stage = a.stage('first_oath');
  switch (stage) {
    case 0:
      return [
        npc("Welcome to Kelmoor, traveller. I'm Maren, elder of this town."),
        npc('Everyone who settles in the Reaches swears the old oath: to work the land, feed the hungry, forge what is needed, and stand against what threatens us.'),
        {
          speaker: 'npc',
          text: "Words are cheap, though. Will you prove yourself before you swear it?",
          options: [
            {
              label: "Yes, I'll prove myself.",
              then: () => {
                a.setStage('first_oath', 1);
                return [
                  you("I'm ready. What do you need?"),
                  npc('Start with the land. Bring me three logs. There are trees in Kelmoor Park, just south-east of here, and your axe will do the rest.'),
                ];
              },
            },
            { label: 'Not right now.', then: () => [you('Not right now, thank you.'), npc("The fountain isn't going anywhere, and neither am I.")] },
          ],
        },
      ];
    case 1:
      if (a.take('logs', 3)) {
        a.setStage('first_oath', 2);
        return [
          you("I've brought the logs."),
          npc("Good, honest wood. That's the land worked. Now feed the hungry: bring me a cooked fish."),
          npc('Net some minnows where the river runs east of town, then cook them on the range in the Blue Gull Inn, just south of here.'),
        ];
      }
      return [
        npc('Three logs, from the trees in Kelmoor Park. Chop a tree and keep at it until you have three.'),
        ...(a.hasTool('woodcutting') ? [] : [npc("No axe? Jory at the sawmill sells them, north-east of the square.")]),
      ];
    case 2: {
      const fish = COOKED_FISH.find((f) => a.has(f));
      if (fish && a.take(fish)) {
        a.setStage('first_oath', 3);
        const gift = !a.hasTool('mining');
        if (gift) a.give('bronze_pickaxe');
        return [
          you("Here's a cooked fish."),
          npc('Still warm. The hungry are fed. Now forge what is needed: bring me a bronze bar.'),
          npc(
            gift
              ? 'Take this pickaxe. Mine copper and tin at Copperback Mine, south-east of town, then smelt one of each at the furnace in the Smithy, west of the square.'
              : 'Mine copper and tin at Copperback Mine, south-east of town, then smelt one of each at the furnace in the Smithy, west of the square.',
          ),
        ];
      }
      return [
        npc('A cooked fish, if you please. Raw ones are no good to anyone.'),
        npc('Net minnows where the river runs east of town and cook them on the range in the Blue Gull Inn.'),
        ...(a.has('small_net') ? [] : [npc('Lost your net? Dunstan in Brightwater sells them.')]),
      ];
    }
    case 3: {
      if (a.take('bronze_bar')) {
        a.setStage('first_oath', 4);
        return [
          you("Here's a bronze bar I made."),
          npc("Fine work. That's three of four. The last part of the oath is the hardest: stand against what threatens us."),
          npc('Goblins have camped south-west of town and raid our fields. Defeat one of them, then come back to me. Take some food in case it goes badly.'),
        ];
      }
      const lost = !a.hasTool('mining');
      if (lost) a.give('bronze_pickaxe');
      return [
        npc('One bronze bar. Smelt one copper ore and one tin ore at the furnace in the Smithy.'),
        npc(lost ? "You've lost the pickaxe? Here's another. Copperback Mine is south-east of town." : 'Copperback Mine, south-east of town, has both ores.'),
      ];
    }
    case 4:
      return [npc('Defeat a goblin at the camp south-west of town, then come back. Eat if you get hurt.')];
    case 5:
      return [
        you('The goblin is beaten.'),
        npc("Then you've worked the land, fed the hungry, forged what was needed and stood your ground. Raise your right hand."),
        npc("Say it with me: I'll take only what I need, give what I can, and stand when others can't."),
        { speaker: 'player', text: "I'll take only what I need, give what I can, and stand when others can't.", effect: () => a.complete('first_oath') },
        npc(`Then welcome, ${a.playerName}, to the Reaches. Take this sword and some coin. Use them well.`),
      ];
    default:
      return [
        npc(`Keep your oath, ${a.playerName}.`),
        {
          speaker: 'npc',
          text: 'And keep clear of the Cinder Pools, far north in the Ashen Waste. A drake nests there.',
          options: [
            {
              label: 'Tell me about the drake.',
              then: () => [
                npc("The Cinder Drake. It's beaten better fighters than you or me. It bites hard, and when it breathes, armour does nothing."),
                npc("They say a shield of its own scales turns the fire. Somebody would have to kill it first to get one, mind."),
                npc('If you go, take plenty of food, and wait until you can hold your own against a level 60.'),
              ],
            },
            { label: 'Goodbye.', then: () => [you('Goodbye, Elder.')] },
          ],
        },
      ];
  }
}

/** What people say when you talk to them, by what they do. */
const ROLE_LINES: Record<string, string> = {
  Banker: 'Good day. Your valuables are safe with us.',
  'Trade clerk': 'Buying or selling? The Bourse never sleeps.',
  Shopkeeper: "Have a look around. If I haven't got it, you don't need it.",
  'Stall holder': 'Fresh today! Well, fresh-ish.',
  Priest: 'May the dawn find you well, traveller.',
  Librarian: "Quietly, please. The books don't like noise.",
  Barkeep: "What'll it be? The stew's better than it looks.",
  Smith: 'Mind the sparks. And bring me good ore.',
  Swordsmith: 'Every blade here is balanced by hand. Mine.',
  'Combat instructor': 'Pick a fighting style in your Equipment tab. Accurate trains Attack, Aggressive trains Strength, Defensive trains Defence.',
  'Fishing supplier': 'Small nets for the shallows, rods and bait for the deep water.',
  'Sawmill operator': 'Logs in, planks out. And axes for anyone who needs one.',
};

function smallTalk(def: NpcDef, a: TalkActions): DialoguePage[] {
  const greeting = ROLE_LINES[def.role] ?? (def.role.startsWith('Ruler') || def.role.startsWith('Lord') ? 'Well met. Kelmoor and its neighbours are glad of capable folk.' : 'Lovely day in the Reaches, isn\'t it?');
  const options: NonNullable<DialoguePage['options']> = [];
  if (a.trade) options.push({ label: "Let's trade.", then: () => (a.trade!(), []) });
  if (a.bank) options.push({ label: "I'd like to use my bank.", then: () => (a.bank!(), []) });
  if (!options.length) return [npc(greeting)];
  options.push({ label: 'Just passing by.', then: () => [] });
  return [{ speaker: 'npc', text: greeting, options }];
}

/** The conversation you get when you talk to someone. */
export function conversation(def: NpcDef, a: TalkActions): DialoguePage[] {
  if (def.key === 'elder_maren') return elderMaren(a);
  return smallTalk(def, a);
}
