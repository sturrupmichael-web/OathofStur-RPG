import type { Point } from '../map/types';
import type { EntityId } from '../sim/entities';
import type { SkillXp } from '../sim/skills';

/** Bumped whenever a message shape changes, so client and server can refuse a mismatch. */
export const PROTOCOL_VERSION = 1;

// ---------------------------------------------------------------------------
// Client -> server. Intents only: the simulation validates and decides outcomes.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join'; name: string; protocolVersion: number }
  | { type: 'walk'; x: number; y: number };

// ---------------------------------------------------------------------------
// Server -> client.
// ---------------------------------------------------------------------------

/** What any client may see about an entity. Private state never goes here. */
export interface PublicEntity {
  id: EntityId;
  kind: 'player' | 'resource' | 'station' | 'npc';
  x: number;
  y: number;
  name: string;
  defKey?: string;
  combatLevel?: number;
}

/** State only the owning player sees. */
export interface SelfState {
  id: EntityId;
  name: string;
  skills: SkillXp;
  combatLevel: number;
  destination: Point | null;
}

export type GameMessageKind = 'info' | 'warn' | 'examine' | 'quest';

export type ServerMessage =
  | { type: 'welcome'; playerId: EntityId; protocolVersion: number; mapId: string; tick: number; tickMs: number }
  | { type: 'snapshot'; tick: number; entities: PublicEntity[] }
  | { type: 'tick'; tick: number; added: PublicEntity[]; updated: PublicEntity[]; removed: EntityId[] }
  | { type: 'self'; state: SelfState }
  | { type: 'gameMessage'; text: string; kind: GameMessageKind }
  | { type: 'reject'; reason: string };
