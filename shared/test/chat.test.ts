import { describe, expect, it } from 'vitest';
import type { ServerMessage } from '../src/protocol/messages';
import { HAIR_STYLES } from '../src/sim/appearance';
import { CHAT_MAX, CHAT_RANGE, cleanChat, decentName, filterChat } from '../src/sim/chat';
import { Simulation } from '../src/sim/Simulation';
import { addPlayer, loadWorld, run } from './helpers';

const map = loadWorld();
const chats = (log: ServerMessage[]) => log.filter((m): m is Extract<ServerMessage, { type: 'chat' }> => m.type === 'chat');

describe('Chat', () => {
  it('tidies lines and masks rude words, leaving ordinary ones alone', () => {
    expect(cleanChat('  hello\n\u0000 there ')).toBe('hello there');
    expect(cleanChat('   ')).toBeNull();
    expect(cleanChat('x'.repeat(200))).toHaveLength(CHAT_MAX);
    expect(filterChat('what the fuck')).toBe('what the ****');
    expect(filterChat('sh1t happens')).toBe('**** happens');
    expect(filterChat('a classic spicy cockatrice')).toBe('a classic spicy cockatrice');
    expect(decentName('Brann')).toBe(true);
    expect(decentName('Dickens')).toBe(true);
    expect(decentName('Fuckface')).toBe(false);
  });

  it('is heard by players nearby, not far away, and not too fast', () => {
    const sim = new Simulation({ map, seed: 51 });
    const at = map.spawn;
    const a = addPlayer(sim, { at });
    const near = addPlayer(sim, { at: { x: at.x + 2, y: at.y } });
    const far = addPlayer(sim, { at: { x: at.x + CHAT_RANGE + 20, y: at.y } });
    for (const p of [a, near, far]) sim.drain(p.id);
    sim.queueIntent(a.id, { type: 'chat', text: 'anyone selling oak logs?' });
    sim.queueIntent(a.id, { type: 'chat', text: 'hello?' });
    run(sim, 1);
    expect(chats(sim.drain(near.id))).toEqual([{ type: 'chat', fromId: a.id, from: a.name, text: 'anyone selling oak logs?' }]);
    expect(chats(sim.drain(far.id))).toHaveLength(0);
    const own = sim.drain(a.id);
    expect(chats(own)).toHaveLength(1);
    expect(own.some((m) => m.type === 'gameMessage' && m.text.includes('too fast'))).toBe(true);
  });

  it("won't take a rude name", () => {
    const sim = new Simulation({ map, seed: 52 });
    const p = sim.getEntity(sim.addPlayer('Wanderer'))!;
    sim.queueIntent(p.id, { type: 'setLook', look: { body: 'male', skin: 0, hairStyle: HAIR_STYLES[0], hair: 0, beard: false, shirt: 0, trousers: 0, boots: 0 }, name: 'Sh1tlord' });
    run(sim, 1);
    expect(p.name).toBe('Wanderer');
  });
});
