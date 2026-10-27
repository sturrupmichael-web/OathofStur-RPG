import type { DialoguePage, TalkActions } from './quests';

export type FerryStop = 'saltcombe' | 'port_avel';

/** The ferry across the Saltwind Sea: one boat each way, a fare, and where it lands. */
export const FERRY: {
  fare: number;
  ticks: number;
  stops: Record<FerryStop, { name: string; x: number; y: number }>;
  crews: Record<string, FerryStop>;
} = {
  fare: 20,
  /** Ticks on the water. */
  ticks: 5,
  stops: {
    saltcombe: { name: 'Saltcombe Docks', x: 158, y: 260 },
    port_avel: { name: 'Port Avel', x: 200, y: 318 },
  },
  /** Who runs each crossing, by NPC key, and where they take you. */
  crews: { ferrywoman_nell: 'port_avel', ferryman_hob: 'saltcombe' },
};


export interface FerryActions {
  cross(to: FerryStop): 'ok' | 'coins';
}

const npc = (text: string): DialoguePage => ({ speaker: 'npc', text });
const you = (text: string): DialoguePage => ({ speaker: 'player', text });

/** Nell at Saltcombe and Hob at Port Avel: the crossing, for the fare. */
export function ferryTalk(to: FerryStop) {
  return (a: TalkActions): DialoguePage[] => {
    const stop = FERRY.stops[to];
    return [
      {
        speaker: 'npc',
        text: `Ferry to ${stop.name}! ${FERRY.fare} coins, and she sails as soon as you're aboard.`,
        options: [
          {
            label: `Take me to ${stop.name} (${FERRY.fare} coins).`,
            then: () => {
              if (a.ferry!.cross(to) === 'coins') return [you(`Take me to ${stop.name}.`), npc(`That's ${FERRY.fare} coins. No coin, no crossing.`)];
              return [];
            },
          },
          { label: 'Where does it go?', then: () => [you('Where does it go?'), npc(`Across the Saltwind Sea to ${stop.name}. Quicker than the long road round by the fen, and drier.`)] },
          { label: 'No thanks.', then: () => [] },
        ],
      },
    ];
  };
}
