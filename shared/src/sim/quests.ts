import type { NpcDef } from '../map/types';
import { hrolfTalk, type BountyActions } from './bounty';
import { FERRY, ferryTalk, type FerryActions } from './ferry';
import { corwinTalk, joryTalk, type HomesteadActions, type SawmillActions } from './homestead';
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
  /** Hrolf's bounties. */
  bounty?: BountyActions;
  /** Corwin's plot. */
  homestead?: HomesteadActions;
  /** Jory's saw. */
  sawmill?: SawmillActions;
  /** The ferry across the Saltwind Sea. */
  ferry?: FerryActions;
}

export type QuestId = 'first_oath' | 'dukes_feast' | 'hull_and_nails' | 'feathers_for_ivy' | 'emirs_seal' | 'nessas_cauldron' | 'restless_barrow' | 'wolf_winter' | 'pikes_lure' | 'the_gloaming';

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
  dukes_feast: {
    id: 'dukes_feast',
    name: "A Feast for the Duke",
    giver: 'cook_hilda',
    start: 'Cook Hilda bustles about the kitchen of Brightwater Castle. She looks like she could use a hand.',
    steps: [
      'Cook Hilda needs 3 cooked beef for the Duke\'s feast. Cows graze in Brightwater Pasture, just north of the castle.',
      'She also needs 3 cooked fish. Minnows from the beach at Saltcombe will do.',
      'The feast is ready. I should tell Duke Aldwin, in the great hall of Brightwater Castle.',
    ],
    rewards: ['1 quest point', '400 coins', 'Iron platelegs', '500 Cooking XP', '200 Fishing XP'],
    reward: { items: [['coins', 400], ['iron_platelegs', 1]], xp: [['cooking', 500], ['fishing', 200]] },
  },
  hull_and_nails: {
    id: 'hull_and_nails',
    name: 'Hull and Nails',
    giver: 'aela',
    start: "Aela the shipwright is staring at a half-built boat on the Saltcombe slipway.",
    steps: [
      'Aela needs 5 oak logs for new planking. Oaks grow at the Lumber Yard, north-east of Kelmoor (Woodcutting 15).',
      'She needs 2 iron bars for nails. Smelt iron ore at a furnace (Smithing 15); Copperback Mine has iron.',
      'The boat is finished. I should see Aela off on her first sail.',
    ],
    rewards: ['1 quest point', '600 coins', 'A steel axe', '500 Woodcutting XP', '400 Smithing XP'],
    reward: { items: [['coins', 600], ['steel_axe', 1]], xp: [['woodcutting', 500], ['smithing', 400]] },
  },
  feathers_for_ivy: {
    id: 'feathers_for_ivy',
    name: 'Feathers for Ivy',
    giver: 'ivy',
    start: 'Ivy the fletcher at Bow & Arrow in Falcrest has a big order she can\'t fill.',
    steps: [
      'Ivy needs 10 crimson feathers. Crimson swifts nest in the Elderglen Hunting Grounds, far to the east.',
      'She wants to see my work: fletch and string a shortbow (Fletching 5) and bring it to her.',
    ],
    rewards: ['1 quest point', '250 coins', 'An oak shortbow', '50 iron arrows', '500 Fletching XP', '400 Ranged XP'],
    reward: { items: [['coins', 250], ['oak_shortbow', 1], ['iron_arrow', 50]], xp: [['fletching', 500], ['ranged', 400]] },
  },
  emirs_seal: {
    id: 'emirs_seal',
    name: "The Emir's Seal",
    giver: 'emir_tarek',
    start: 'Emir Tarek of Qadir paces his palace. Something has gone missing. (Recommended: combat level 30.)',
    steps: [
      'Desert bandits stole the Emir\'s seal. They camp in the dunes south-west of Qadir. Defeat them until one gives it up.',
      'I have the Sunspire seal. I should return it to Emir Tarek in the Palace of the Sunspire.',
    ],
    rewards: ['1 quest point', '1,500 coins', 'A steel shield', '1,000 Attack XP', '1,000 Defence XP'],
    reward: { items: [['coins', 1500], ['steel_shield', 1]], xp: [['attack', 1000], ['defence', 1000]] },
  },
  nessas_cauldron: {
    id: 'nessas_cauldron',
    name: "Nessa's Cauldron",
    giver: 'old_nessa',
    start: 'Old Nessa stirs an empty cauldron in her hut in Hallowmere. She mutters about missing ingredients.',
    steps: [
      'Old Nessa needs 5 piles of ashes and a cowhide. Burn logs with a tinderbox and wait for the fire to go out; cows give hides.',
      'She needs 2 lizard scales. Desert lizards bask in the Sunspire Desert, west of Qadir.',
    ],
    rewards: ['1 quest point', '350 coins', '400 Firemaking XP', '300 Hitpoints XP'],
    reward: { items: [['coins', 350]], xp: [['firemaking', 400], ['hitpoints', 300]] },
  },
  restless_barrow: {
    id: 'restless_barrow',
    name: 'The Restless Barrow',
    giver: 'sister_maud',
    start: 'Sister Maud keeps the Chapel of the Vigil in Corvane. She looks as if she has not slept. (Recommended: combat level 45.)',
    steps: [
      "The barrow-king's guard has risen in the Barrowfield, south across the Saltwind Sea. Sister Maud needs the king's circlet to lay them to rest: defeat barrow wights until one gives it up.",
      "I have the barrow-king's circlet. I should take it to Sister Maud in the Chapel of the Vigil.",
    ],
    rewards: ['1 quest point', '2,000 coins', 'A verdite shield', '2,500 Devotion XP', '1,500 Defence XP'],
    reward: { items: [['coins', 2000], ['verdite_shield', 1]], xp: [['prayer', 2500], ['defence', 1500]] },
  },
  wolf_winter: {
    id: 'wolf_winter',
    name: 'Wolf Winter',
    giver: 'harl',
    start: 'Harl the smith in Corvane is grumbling about the cold coming down off Frostpeak.',
    steps: [
      'Harl wants 6 wolf pelts to line coats for the winter. Frost wolves den in Wolfrun Hollow, east of Frostpeak Mine.',
      'He wants to see if I can work cobalt: smith a cobalt helm (Smithing 53) and bring it to him.',
    ],
    rewards: ['1 quest point', '1,200 coins', 'A cobalt pickaxe', '3,000 Smithing XP', '1,000 Mining XP'],
    reward: { items: [['coins', 1200], ['cobalt_pickaxe', 1]], xp: [['smithing', 3000], ['mining', 1000]] },
  },
  pikes_lure: {
    id: 'pikes_lure',
    name: "Pike's Lucky Lure",
    giver: 'pike',
    start: 'Pike at Avel Tackle in Port Avel has lost something, and he will tell anyone who stands still long enough.',
    steps: [
      "A fen lurker swallowed Pike's lucky lure, line and all. Lurkers lie in Saltmere Fen, up the east road from Port Avel: defeat them until the lure turns up.",
      'I have the lucky lure. Pike will want it back.',
    ],
    rewards: ['1 quest point', '800 coins', '10 cooked pike', '1,500 Fishing XP', '800 Hitpoints XP'],
    reward: { items: [['coins', 800], ['pike', 10]], xp: [['fishing', 1500], ['hitpoints', 800]] },
  },
  the_gloaming: {
    id: 'the_gloaming',
    name: 'The Gloaming',
    giver: 'vessa',
    start: "Vessa keeps the rangers' camp where the road from Port Avel meets the Duskwood. She keeps looking at the trees. (Recommended: combat level 70.)",
    steps: [
      'Vessa\'s ranger Tamsin went into the Duskwood three days ago and never came back. The dusk stalkers hunt where she went: defeat them until I find a trace of her.',
      "I found Tamsin's horn, scored with claw marks. I should take it to Vessa at the rangers' camp.",
      "The Gloam Hart has woken in the Gloaming Glade, deep in the south-east of the Duskwood. Vessa wants it put down. When it calls up its shades, blows pass through it until they fall.",
      'The Gloam Hart is dead. I should tell Vessa.',
    ],
    rewards: ['1 quest point', '3,000 coins', 'A yew longbow', '150 glacite arrows', '3,000 Attack XP', '3,000 Strength XP', '2,000 Ranged XP', '2,000 Woodcutting XP'],
    reward: {
      items: [['coins', 3000], ['yew_longbow', 1], ['glacite_arrow', 150]],
      xp: [['attack', 3000], ['strength', 3000], ['ranged', 2000], ['woodcutting', 2000]],
    },
  },
};

/** Quest items that drop from monsters while the quest waits on them: one chance per kill. */
export const QUEST_DROPS: readonly { monster: string; quest: QuestId; stage: number; item: string; chance: number; message: string }[] = [
  { monster: 'desert_bandit', quest: 'emirs_seal', stage: 1, item: 'sunspire_seal', chance: 0.34, message: "Something gold glints among the bandit's things: the Sunspire seal!" },
  { monster: 'barrow_wight', quest: 'restless_barrow', stage: 1, item: 'barrow_circlet', chance: 0.3, message: 'The wight crumbles, and a tarnished circlet rolls from its helm.' },
  { monster: 'dusk_stalker', quest: 'the_gloaming', stage: 1, item: 'tamsins_horn', chance: 0.3, message: 'Tangled in the stalker\'s fur is a leather strap, and on it a ranger\'s horn.' },
  { monster: 'fen_lurker', quest: 'pikes_lure', stage: 1, item: 'lucky_lure', chance: 0.3, message: 'Something bright catches your eye in the lurker\'s jaws: a brass lure!' },
];

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
  Apothecary: 'Vials, herbs and tonics. Mind the shelf, it wobbles.',
  Librarian: "Quietly, please. The books don't like noise.",
  Barkeep: "What'll it be? The stew's better than it looks.",
  Smith: 'Mind the sparks. And bring me good ore.',
  Swordsmith: 'Every blade here is balanced by hand. Mine.',
  'Combat instructor': 'Pick a fighting style in your Equipment tab. Accurate trains Attack, Aggressive trains Strength, Defensive trains Defence.',
  'Fishing supplier': 'Small nets for the shallows, rods and bait for the deep water.',
  'Sawmill operator': 'Logs in, planks out. And axes for anyone who needs one.',
  'Agility trainer': "Legs like jelly? Good. That means it's working.",
  'Glyphcraft tutor': 'Ah, a visitor. Mind the shards; they bite.',
  'Glyph merchant': 'Glyphs bought and sold. The ones that hum are worth more.',
  'Farming supplier': 'Seeds, tools and compost. Everything grows if you let it.',
  'Farming tools': 'Rakes, spades, dibbers! And a little something for sick plants.',
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

/** Offers a quest: yes starts it at stage 1 with `accept`, no gets a shrug. */
function offer(a: TalkActions, quest: QuestId, ask: string, accept: DialoguePage[], decline: string): DialoguePage {
  return {
    speaker: 'npc',
    text: ask,
    options: [
      { label: 'Yes, I can help.', then: () => (a.setStage(quest, 1), [you("I'll help."), ...accept]) },
      { label: 'Not right now.', then: () => [you('Not right now, sorry.'), npc(decline)] },
    ],
  };
}

/** Cook Hilda: beef and fish for the Duke's table. */
function cookHilda(def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('dukes_feast')) {
    case 0:
      return [
        npc("Out from under my feet! Oh, unless you've come to help. The Duke's holding a feast tonight, and the cows haven't cooked themselves."),
        offer(a, 'dukes_feast', 'Will you fetch me what I need?', [npc('Three cooked beef first. The cows in the pasture just north of the castle will oblige, and my range is right here.')], 'Then mind the pans on your way out.'),
      ];
    case 1:
      if (a.take('beef', 3)) {
        a.setStage('dukes_feast', 2);
        return [you("Three cooked beef."), npc('Lovely and brown. Now three cooked fish. The beach at Saltcombe, south-west of here, is thick with minnows.')];
      }
      return [npc("Three cooked beef. Not raw, not burnt: cooked. Cows are in the pasture north of the castle.")];
    case 2: {
      // Any mix of cooked fish will do.
      const carried = (f: string) => [3, 2, 1].find((n) => a.has(f, n)) ?? 0;
      if (COOKED_FISH.reduce((n, f) => n + carried(f), 0) >= 3) {
        let owed = 3;
        for (const f of COOKED_FISH) while (owed > 0 && a.take(f)) owed--;
        a.setStage('dukes_feast', 3);
        return [you('Three cooked fish.'), npc("That's the feast done! Go and tell His Grace. He's in the great hall, and he does like to hear it from whoever did the work.")];
      }
      return [npc('Three cooked fish, any kind. Minnows from the beach at Saltcombe are easiest.')];
    }
    case 3:
      return [npc("Go on, tell the Duke! He's in the great hall.")];
    default:
      return [npc("The Duke hasn't stopped talking about that feast. Come back any time you're hungry."), ...smallTalk(def, a).filter((p) => p.options)];
  }
}

function dukeAldwin(def: NpcDef, a: TalkActions): DialoguePage[] {
  if (a.stage('dukes_feast') === 3) {
    return [
      you('Your Grace, the feast is ready. I helped Cook Hilda with it.'),
      npc('Did you now! I could smell it from the battlements. Brightwater thanks you.'),
      { speaker: 'npc', text: "Here: coin, and a pair of platelegs from the armoury. A guest who cooks deserves good legs to stand on.", effect: () => a.complete('dukes_feast') },
    ];
  }
  return smallTalk(def, a);
}

/** Aela: oak and iron for a boat. */
function aela(_def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('hull_and_nails')) {
    case 0:
      return [
        npc("Three summers I've been building her, and still no hull. The timber merchant sold me rotten planks and the nail-maker ran off to Qadir."),
        offer(a, 'hull_and_nails', 'You look handy. Could you find me oak and iron?', [npc('Five oak logs to start. The Lumber Yard north-east of Kelmoor has oaks, if your axe is up to it.')], 'Then she stays on the slipway another summer.'),
      ];
    case 1:
      if (a.take('oak_logs', 5)) {
        a.setStage('hull_and_nails', 2);
        return [you('Five oak logs.'), npc('Straight grain, no rot. Now the nails: bring me two iron bars. Iron ore smelts at any furnace, if you know the knack.')];
      }
      return [npc('Five oak logs, from the Lumber Yard north-east of Kelmoor.')];
    case 2:
      if (a.take('iron_bar', 2)) {
        a.setStage('hull_and_nails', 3);
        return [
          you('Two iron bars.'),
          npc("That'll make plenty of nails. Give me a moment..."),
          npc('There. She floats! Come and see her off.'),
        ];
      }
      return [npc('Two iron bars for the nails. Copperback Mine has iron ore, and the Smithy in Kelmoor has a furnace.')];
    case 3:
      return [
        you('She looks seaworthy.'),
        npc("She is, thanks to you. Take this axe: it was my father's, and it's wasted on a boat-builder."),
        { speaker: 'npc', text: "And some coin. If you're ever in Saltcombe and fancy a sail, you know where I'll be.", effect: () => a.complete('hull_and_nails') },
      ];
    default:
      return [npc('Fair winds, friend.')];
  }
}

/** Ivy: crimson feathers, then a bow of your own making. */
function ivy(def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('feathers_for_ivy')) {
    case 0:
      return [
        npc('The Duke of Falcrest wants a hundred arrows fletched in crimson for his guard. A hundred! And I haven\'t a red feather in the shop.'),
        offer(a, 'feathers_for_ivy', 'Could you fetch me some?', [npc('Ten crimson feathers. Crimson swifts nest in the Elderglen Hunting Grounds, far east past Kelmoor. They\'re quick, but they don\'t bite.')], "Then the Duke will have to wait. He won't like it."),
      ];
    case 1:
      if (a.take('crimson_feathers', 10)) {
        a.setStage('feathers_for_ivy', 2);
        return [
          you('Ten crimson feathers.'),
          npc("Perfect. Now, I could use a hand at the bench. Show me you can fletch: carve and string a shortbow and bring it here."),
          ...(a.has('knife') ? [] : [npc("You'll need a knife. Mara at the Kelmoor general store sells them, or I do.")]),
        ];
      }
      return [npc('Ten crimson feathers, from the swifts in the Elderglen Hunting Grounds.')];
    case 2:
      if (a.take('shortbow')) {
        return [
          you('Here, a shortbow I made.'),
          npc('Hm. The limbs are even and the string sits true. Not bad at all.'),
          { speaker: 'npc', text: "Keep this oak one, and these arrows. Come back when you're good enough to work for me.", effect: () => a.complete('feathers_for_ivy') },
        ];
      }
      return [npc('Carve a shortbow from logs with a knife, string it with a bowstring, and bring it to me. You need Fletching level 5.')];
    default:
      return [npc('Those crimson arrows look lovely on the Duke\'s guard.'), ...smallTalk(def, a).filter((p) => p.options)];
  }
}

/** Emir Tarek: the seal the bandits took. */
function emirTarek(_def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('emirs_seal')) {
    case 0:
      return [
        npc('Bandits rode into my palace bold as noon and rode out with the Sunspire seal. Without it, no caravan leaves Qadir.'),
        offer(a, 'emirs_seal', 'Will you bring it back?', [npc("They camp among the dunes south-west of the city. Defeat them until one gives the seal up. They fight hard; bring food.")], 'Then the caravans wait, and Qadir grows poorer.'),
      ];
    case 1:
    case 2:
      if (a.take('sunspire_seal')) {
        return [
          you('Your seal, Emir.'),
          npc('The Sunspire seal! The caravans can move again.'),
          { speaker: 'npc', text: 'Qadir pays its debts. Take this gold, and a shield from my own guard.', effect: () => a.complete('emirs_seal') },
        ];
      }
      if (a.stage('emirs_seal') === 1) return [npc('The bandits camp in the dunes south-west of the city. One of them has my seal.')];
      a.setStage('emirs_seal', 1);
      return [npc('You found it and then lost it? The bandits will have picked it up again. Go back to the dunes.')];
    default:
      return [npc('The caravans run on time again. Qadir remembers its friends.')];
  }
}

/**
 * A quest that waits on a monster's drop: the giver offers it (stage 1), the
 * drop moves it to stage 2, and handing the item over finishes it. A lost
 * item can be found again, so stage 2 without it goes back to 1.
 */
function dropQuest(a: TalkActions, quest: QuestId, item: string, lines: { intro: DialoguePage[]; ask: string; accept: string; decline: string; waiting: string; lost: string; thanks: string[]; reward: string; after: string }): DialoguePage[] {
  switch (a.stage(quest)) {
    case 0:
      return [...lines.intro, offer(a, quest, lines.ask, [npc(lines.accept)], lines.decline)];
    case 1:
    case 2:
      if (a.take(item)) return [...lines.thanks.map((t, i) => (i === 0 ? you(t) : npc(t))), { speaker: 'npc', text: lines.reward, effect: () => a.complete(quest) }];
      if (a.stage(quest) === 1) return [npc(lines.waiting)];
      a.setStage(quest, 1);
      return [npc(lines.lost)];
    default:
      return [npc(lines.after)];
  }
}

/** Sister Maud: the barrow-king's guard won't stay down. */
function sisterMaud(def: NpcDef, a: TalkActions): DialoguePage[] {
  if (a.stage('restless_barrow') >= doneStage(QUESTS.restless_barrow)) return [npc('The Barrowfield sleeps, and so do I, thanks to you.'), ...priest(def)];
  return dropQuest(a, 'restless_barrow', 'barrow_circlet', {
    intro: [
      npc("Forgive me, I've kept the vigil three nights running. The old barrows south of the sea have opened, and the barrow-king's guard walks again."),
      npc("They keep his circlet among them. Bring it here, to the altar, and they'll have nothing left to guard."),
    ],
    ask: 'Will you face them? They are strong, and they do not tire.',
    accept: "The Barrowfield lies east of Port Avel, across the Saltwind Sea. The ferry from Saltcombe is quickest, or take the long road south through the fen. Defeat the wights until one gives up the circlet. Take food, and pray.",
    decline: 'Then I will keep watching. Someone must.',
    waiting: 'The wights guard the circlet in the Barrowfield, east of Port Avel. Defeat them until one gives it up.',
    lost: 'You had it, and now you don\'t? The wights will have taken it back. Return to the Barrowfield.',
    thanks: ["The barrow-king's circlet.", 'Lay it on the altar... there. Can you feel it? The field has gone quiet.'],
    reward: 'The Vigil has little gold, but what we have is yours, and a shield that was given to us long ago. May it serve you better than it served its owner.',
    after: 'The Barrowfield sleeps.',
  });
}

/** Pike: a lurker swallowed his lucky lure. */
function pikeTalk(def: NpcDef, a: TalkActions): DialoguePage[] {
  if (a.stage('pikes_lure') >= doneStage(QUESTS.pikes_lure)) return [npc('Caught a pike the length of my arm this morning. Lucky lure, see?'), ...smallTalk(def, a).filter((p) => p.options)];
  return dropQuest(a, 'pikes_lure', 'lucky_lure', {
    intro: [
      npc("Lost it. Twenty years that lure's been in my family, and a fen lurker took it clean off my line. Line, lure, very nearly my hand."),
      npc("Brass, it is, shaped like a little fish. Never caught nothing without it since."),
    ],
    ask: 'You look like you can handle yourself. Get it back for me?',
    accept: 'The lurkers lie in Saltmere Fen: follow the road east out of town, and where it turns north you\'re in the fen. One of them has it in its belly. Mind their jaws.',
    decline: 'Then I suppose I fish without luck. Like everybody else.',
    waiting: 'One of the fen lurkers in Saltmere Fen has my lure. Keep at them till it turns up.',
    lost: "Dropped it? The lurkers'll swallow anything shiny. Back to the fen with you.",
    thanks: ['Is this your lure?', "That's her! Still sharp, still shining. I could kiss you. I won't."],
    reward: "Here: coin, and the best of today's catch, cooked. And I'll tell everyone in Port Avel who got my lure back.",
    after: 'Every fish in the bay knows that lure. Most of them have met it.',
  });
}

/** Harl: pelts for the winter, and a test of cobalt. */
function harlTalk(def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('wolf_winter')) {
    case 0:
      return [
        npc("Feel that wind? That's Frostpeak telling us winter's early. The wolves come down with it."),
        offer(a, 'wolf_winter', "I need pelts to line the town's coats, and someone to help me with the forge. Interested?", [npc('Six wolf pelts first. The frost wolves den in Wolfrun Hollow, through the mine and out the east side. They hunt in packs, so watch your back.')], 'Then dress warm.'),
      ];
    case 1:
      if (a.take('wolf_pelt', 6)) {
        a.setStage('wolf_winter', 2);
        return [you('Six wolf pelts.'), npc("Thick ones. Corvane won't freeze this year."), npc("Now, cobalt. Most smiths won't touch it; it fights the hammer. Smith me a cobalt helm and I'll know you're the real thing. You'll want Smithing 53 for it.")];
      }
      return [npc('Six wolf pelts. Wolfrun Hollow, east of Frostpeak Mine.')];
    case 2:
      if (a.take('cobalt_helm')) {
        return [
          you('One cobalt helm.'),
          npc('Hm. Even seams, no cracks. You can work cobalt.'),
          { speaker: 'npc', text: "Take this pickaxe: cobalt, my own make. You'll want it for what's in that mountain.", effect: () => a.complete('wolf_winter') },
        ];
      }
      return [npc('A cobalt helm, made by your own hand. Cobalt ore smelts with four coal at Smithing 50; the helm needs 53.')];
    default:
      return [npc('Warmest coats in the Eastmarch, thanks to you.'), ...smallTalk(def, a).filter((p) => p.options)];
  }
}

/** Vessa: a lost ranger, and what took her. */
function vessaTalk(def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('the_gloaming')) {
    case 0:
      return [
        npc("Stay on the road after dark. The Duskwood's been wrong all season: the birds have gone quiet, and the stalkers come right up to the fire."),
        npc('Three days ago I sent Tamsin, my best tracker, in to find out why. She should have been back by the next night.'),
        offer(a, 'the_gloaming', "I can't leave the camp. Will you go in after her?", [npc("Thank you. She'd have gone south-east, where the stalkers are thickest. If they've had her, one of them will be carrying some trace. Her horn, her pack, something. Bring me anything you find.")], 'Then I keep waiting. Keep to the road.'),
      ];
    case 1:
      return [npc('Tamsin went south-east, into the thick of the Duskwood. The stalkers hunt there. Bring me any trace of her you find.')];
    case 2:
      if (a.take('tamsins_horn')) {
        a.setStage('the_gloaming', 3);
        return [
          you('I found this on a dusk stalker.'),
          npc("Her horn. Look at these marks. Those aren't a cat's claws; that's an antler, dragged across it."),
          npc("Old rangers tell of a hart that sleeps under the Duskwood and wakes when the nights grow long. They called it the Gloam Hart. I thought it was a story to keep apprentices on the road."),
          npc("It's no story. Its glade lies deep in the south-east of the wood, past the stalkers. It hurls shadow at you from range, and when it's hurt it calls up shades, and nothing touches it until they fall."),
          npc("Kill it. For Tamsin. Bring food, and a lot of it."),
        ];
      }
      a.setStage('the_gloaming', 1);
      return [npc("You found something of hers and lost it again? Then back into the wood. The stalkers will turn it up a second time.")];
    case 3:
      return [npc('The Gloaming Glade is deep in the south-east of the Duskwood. Break its shades when it calls them, then finish it.')];
    case 4:
      return [
        you('The Gloam Hart is dead.'),
        npc("I heard it. The whole wood heard it. And listen: the birds are back."),
        { speaker: 'npc', text: "Tamsin would've wanted you to have her bow, and her arrows with it. You earned more than that, but it's what rangers have.", effect: () => a.complete('the_gloaming') },
      ];
    default:
      return [npc("The Duskwood's quiet again. The right kind of quiet."), ...smallTalk(def, a).filter((p) => p.options)];
  }
}

/** Old Nessa: odd things for an empty cauldron. */
function oldNessa(_def: NpcDef, a: TalkActions): DialoguePage[] {
  switch (a.stage('nessas_cauldron')) {
    case 0:
      return [
        npc("Heh. Another visitor who wants a potion. Well, the pot's empty, and these old knees won't take me to the desert."),
        offer(a, 'nessas_cauldron', 'Fetch what I need and I might teach you a thing or two.', [npc('Five heaps of ashes and a cowhide, first. Light some logs and let them burn out; the cows will part with a hide.')], 'Suit yourself, dearie.'),
      ];
    case 1:
      if (a.has('ashes', 5) && a.has('cowhide')) {
        a.take('ashes', 5);
        a.take('cowhide');
        a.setStage('nessas_cauldron', 2);
        return [you('Five heaps of ashes, and a hide.'), npc("Good, good. Last thing: two lizard scales. The lizards bask in the desert west of Qadir. Mind their tails.")];
      }
      return [npc('Five heaps of ashes and one cowhide. Ashes are what a fire leaves when it burns out.')];
    case 2:
      if (a.take('lizard_scales', 2)) {
        return [
          you('Two lizard scales.'),
          npc('In they go... and a pinch of ash... and stir.'),
          { speaker: 'npc', text: "There. The pot's warm again. Now, you've earned a lesson: talk to me again and I'll show you how a proper brew is done.", effect: () => a.complete('nessas_cauldron') },
        ];
      }
      return [npc('Two lizard scales, from the desert west of Qadir.')];
    default:
      return [
        {
          speaker: 'npc',
          text: "The cauldron's bubbling nicely, thanks to you. What'll it be, dearie?",
          options: [
            { label: 'Teach me to brew.', then: () => brewingLesson() },
            ...(a.trade ? [{ label: "Let's trade.", then: () => (a.trade!(), []) }] : []),
            { label: 'Just visiting.', then: () => [] },
          ],
        },
      ];
  }
}

/** Old Nessa's lesson: how herbs become potions. */
function brewingLesson(): DialoguePage[] {
  return [
    npc("Herbs come out of the ground filthy. Monsters carry them about, the dirty things. Clean them first; you'll learn a little each time."),
    npc('Drop a clean herb into a vial of water and you have an unfinished potion. Wren the apothecary sells vials, and so do I.'),
    npc('Then one more thing to finish it. Sunleaf takes crimson feathers for an attack potion. Marshwort takes a cow horn, for strength.'),
    npc('Duskroot and a pinch of ashes makes a devotion potion: it gives back prayer points. The priests drink it by the bucket.'),
    npc("The rest you'll work out. Silverfern, hawkweed, emberbloom... Use any of it from your pack to see what it makes."),
  ];
}

/** Priests teach Prayer: bones to bury, altars to pray at. */
function priest(def: NpcDef): DialoguePage[] {
  return [
    {
      speaker: 'npc',
      text: ROLE_LINES[def.role],
      options: [
        {
          label: 'Tell me about Prayer.',
          then: () => [
            npc('The gods are pleased when the dead are given rest. Bury the bones you find on your travels and they will hear your prayers more clearly.'),
            npc('Kneel at an altar like this one and your prayer points will be restored. Offer bones on the altar itself and the gods are twice as pleased.'),
            npc('Open your Prayer book to call on them. Each prayer takes a little of your strength while it lasts, so use them when it matters.'),
          ],
        },
        { label: 'Just passing by.', then: () => [] },
      ],
    },
  ];
}

/** People who teach a skill: what they say about it, and their shop if they have one. */
const LESSONS: Record<string, { ask: string; pages: string[] }[]> = {
  'Agility trainer': [{
    ask: 'Tell me about Agility.',
    pages: [
      'Go round the course: logs, hurdles, nets, the lot. Each obstacle teaches your legs something, and a full lap in order earns a bonus.',
      "Some of them you'll fall off at first. It stings, but you'll fall less as you get better.",
      'Agility brings your run energy back faster. Click the boot by your minimap to run: two steps for every one, until your legs give out.',
      "Once you reach level 30 there's a harder course far to the north, out in the Ashen Waste. Mind the fumes.",
    ],
  }],
  'Glyphcraft tutor': [{
    ask: 'Tell me about Glyphcraft.',
    pages: [
      'The pale stone in the quarry beside my spire is aether stone. Any pickaxe will chip shards off it, and it never runs out.',
      "Carry the shards to a shrine and hold them up to it. The shrine marks every shard you carry with its glyph: wind, thought, tide, root, and many more for the skilled.",
      'The Wind Shrine stands just south of Falcrest, the Thought Shrine just north of it. The rest are further out, and each asks more of you than the last.',
      'With practice a shard takes two marks, then three. Orrin, at Glyph & Robe in Kelmoor, buys glyphs, and they are what every spell is cast with.',
    ],
  }, {
    ask: 'Tell me about Magic.',
    pages: [
      'Every spell takes glyphs. Open your spellbook, pick a combat spell, then pick the creature to throw it at.',
      'Wind Spark wants one wind glyph and one thought glyph. Orrin sells both at Glyph & Robe in Kelmoor, along with staves and robes.',
      "Pick a spell for your staff and it will cast by itself in a fight. An elemental staff stands in for its own glyphs, so a wind staff saves you a great many.",
      "Metal armour gets in the way of a spell; robes help it along. And when you're far from home, Hearth Recall walks you back to Kelmoor for nothing but a little patience.",
    ],
  }],
  'Farming supplier': [{
    ask: 'How do I grow things?',
    pages: [
      'The Brightwater Allotments, south-east of here, have patches anyone may use. They start overgrown, so rake them clear first.',
      'Three seeds go in an allotment, one in a herb patch. Use them on the clear patch, with a seed dibber in your pack.',
      "Crops grow while you get on with other things, even while you're away. Come back, dig them up with a spade, or pick the herbs by hand.",
      'Sometimes a crop falls sick. Pour a plant cure on it before it grows again, or it dies. Compost on the soil before planting keeps them healthier and gives a bigger crop.',
    ],
  }],
};

function teacher(def: NpcDef, a: TalkActions): DialoguePage[] {
  return [
    {
      speaker: 'npc',
      text: ROLE_LINES[def.role],
      options: [
        ...LESSONS[def.role].map((lesson) => ({ label: lesson.ask, then: () => lesson.pages.map((t) => npc(t)) })),
        ...(a.trade ? [{ label: "Let's trade.", then: () => (a.trade!(), []) }] : []),
        { label: 'Just passing by.', then: () => [] },
      ],
    },
  ];
}

const QUEST_TALK: Record<string, (def: NpcDef, a: TalkActions) => DialoguePage[]> = {
  cook_hilda: cookHilda,
  duke_aldwin: dukeAldwin,
  aela,
  ivy,
  emir_tarek: emirTarek,
  old_nessa: oldNessa,
  sister_maud: sisterMaud,
  harl: harlTalk,
  pike: pikeTalk,
  vessa: vessaTalk,
  hrolf: (_def, a) => hrolfTalk(a),
  corwin: (_def, a) => corwinTalk(a),
  jory: (_def, a) => joryTalk(a),
  ...Object.fromEntries(Object.entries(FERRY.crews).map(([key, to]) => [key, (_def: NpcDef, a: TalkActions) => ferryTalk(to)(a)])),
};

/** The conversation you get when you talk to someone. */
export function conversation(def: NpcDef, a: TalkActions): DialoguePage[] {
  if (def.key === 'elder_maren') return elderMaren(a);
  if (def.role === 'Priest' && !QUEST_TALK[def.key]) return priest(def);
  if (LESSONS[def.role]) return teacher(def, a);
  return QUEST_TALK[def.key]?.(def, a) ?? smallTalk(def, a);
}
