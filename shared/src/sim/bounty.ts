import bountyData from '../../data/bounty.json';
import type { Rng } from '../rng';
import { MONSTERS } from './combat';
import { ITEMS } from './items';
import type { DialoguePage, TalkActions } from './quests';

export interface BountyTaskDef {
  monster: string;
  /** How Hrolf says it, plural: "goblins". */
  name: string;
  minCombat: number;
  maxCombat?: number;
  count: [number, number];
  weight: number;
}

/** A task being worked on: the creature, kills still to go, and how many it started with. */
export interface BountyTask {
  monster: string;
  left: number;
  total: number;
}

/** A player's standing with Hrolf. `done` counts finished tasks, for the tenth-task bonus. */
export interface BountyState {
  task?: BountyTask;
  points: number;
  done: number;
}

export const BOUNTY = bountyData as unknown as {
  xpPerHp: number;
  points: number;
  milestonePoints: number;
  skipCost: number;
  helmBonus: number;
  rewards: { item: string; points: number }[];
  tasks: BountyTaskDef[];
};

export const BOUNTY_TASKS: Readonly<Record<string, BountyTaskDef>> = Object.fromEntries(BOUNTY.tasks.map((t) => [t.monster, t]));

/** The Bounty level a creature asks for (1 for anything ordinary). */
export function bountyLevel(monster: string): number {
  return MONSTERS[monster]?.bounty?.level ?? 1;
}

/** Tasks open to someone of this combat and Bounty level. */
export function eligibleTasks(combat: number, level: number): BountyTaskDef[] {
  return BOUNTY.tasks.filter((t) => combat >= t.minCombat && combat <= (t.maxCombat ?? Infinity) && level >= bountyLevel(t.monster));
}

/** A fresh task, never the same creature twice running when there's a choice. */
export function pickTask(combat: number, level: number, rng: Rng, previous?: string): BountyTask | null {
  let options = eligibleTasks(combat, level);
  if (options.length > 1) options = options.filter((t) => t.monster !== previous);
  if (!options.length) return null;
  let roll = rng.next() * options.reduce((sum, t) => sum + t.weight, 0);
  const def = options.find((t) => (roll -= t.weight) < 0) ?? options[options.length - 1];
  const total = rng.int(def.count[0], def.count[1]);
  return { monster: def.monster, left: total, total };
}

/** Points for finishing a task, counting it: every tenth is worth more. */
export function pointsFor(done: number): number {
  return done % 10 === 0 ? BOUNTY.milestonePoints : BOUNTY.points;
}

/** What talking to Hrolf can do for one player. */
export interface BountyActions {
  task(): BountyTask | null;
  points(): number;
  /** Gives a new task; null when there's nothing the player can take on yet. */
  assign(): BountyTask | null;
  /** Drops the task for skipCost points; false when they can't afford it. */
  skip(): boolean;
  buy(itemId: string): 'ok' | 'points' | 'space';
}

const npc = (text: string): DialoguePage => ({ speaker: 'npc', text });
const you = (text: string): DialoguePage => ({ speaker: 'player', text });

export function taskName(monster: string): string {
  return BOUNTY_TASKS[monster]?.name ?? monster;
}

/** Hrolf, the bounty master in Brakk Village: tasks, points and his rewards. */
export function hrolfTalk(a: TalkActions): DialoguePage[] {
  const b = a.bounty!;
  const options: NonNullable<DialoguePage['options']> = [];
  const task = b.task();
  if (!task) {
    options.push({
      label: 'I need a bounty.',
      then: () => {
        const t = b.assign();
        if (!t) return [you('I need a bounty.'), npc("Nothing on my board you're ready for. Come back with a bit more fight in you.")];
        return [you('I need a bounty.'), npc(`Your bounty is ${t.total} ${taskName(t.monster)}. Come back when they're done.`)];
      },
    });
  } else {
    options.push({ label: 'How am I getting on?', then: () => [you('How am I getting on?'), npc(`You've ${task.left} ${taskName(task.monster)} still to go, out of ${task.total}.`)] });
    options.push({
      label: `Can I have a different bounty? (${BOUNTY.skipCost} points)`,
      then: () => {
        if (!b.skip()) return [you('Can I have a different bounty?'), npc(`That costs ${BOUNTY.skipCost} points, and you've ${b.points()}. Get hunting.`)];
        const t = b.assign();
        return [you('Can I have a different bounty?'), npc(t ? `Fine. ${t.total} ${taskName(t.monster)} instead. Don't make a habit of it.` : "Fine. That one's struck off.")];
      },
    });
  }
  options.push({
    label: 'What can I spend my points on?',
    then: () => [
      {
        speaker: 'npc',
        text: `You've ${b.points()} bounty points.`,
        options: [
          ...BOUNTY.rewards.map((r) => ({
            label: `${ITEMS[r.item].name} (${r.points} points)`,
            then: () => {
              const result = b.buy(r.item);
              if (result === 'points') return [npc(`That's ${r.points} points. You've ${b.points()}.`)];
              if (result === 'space') return [npc("Your pack's full. Make some room first.")];
              return [npc(`One ${ITEMS[r.item].name.toLowerCase()}. Wear it on a bounty and you'll feel the difference.`)];
            },
          })),
          { label: 'Nothing for now.', then: () => [] },
        ],
      },
    ],
  });
  options.push({
    label: 'Tell me about bounties.',
    then: () => [
      npc("I hand out bounties: so many of one creature. Kill them and you learn how they're best hunted. That's Bounty experience."),
      npc("Finish a bounty and you earn points. Every tenth earns a good deal more. Spend them with me."),
      npc('Some creatures want the right kit. Brine slugs need salt to finish, rockmaws a rock hammer. Wear a scent mask near gloom bats, and carry a polished shield against glare lizards.'),
      npc("You'll find all of that in my store, and the slugs, bats, rockmaws and lizards out at Ironcrag. A contract stone tells you how your bounty's going."),
    ],
  });
  if (a.trade) options.push({ label: "Let's see your store.", then: () => (a.trade!(), []) });
  options.push({ label: 'Bye.', then: () => [] });
  const greeting = task ? `Back already? How are those ${taskName(task.monster)} coming along?` : 'Looking for work? I keep a board of bounties for those with the stomach for it.';
  return [{ speaker: 'npc', text: greeting, options }];
}
