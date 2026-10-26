import type { Point } from '../map/types';
import type { EntityId } from '../sim/entities';
import type { Inventory } from '../sim/items';
import type { SaveData } from '../sim/save';
import type { SkillId, SkillXp } from '../sim/skills';

/** Bumped whenever a message shape changes, so client and server can refuse a mismatch. */
export const PROTOCOL_VERSION = 2;

// ---------------------------------------------------------------------------
// Client -> server. Intents only: the simulation validates and decides outcomes.
// ---------------------------------------------------------------------------

export type ClientMessage =
  | { type: 'join'; name: string; protocolVersion: number; save?: SaveData | null }
  | { type: 'walk'; x: number; y: number }
  /** Use a world object: chop a tree, take a ground item. */
  | { type: 'interact'; targetId: EntityId; action: 'gather' | 'take' }
  | { type: 'examine'; targetId: EntityId }
  | { type: 'examineItem'; slot: number }
  | { type: 'invDrop'; slot: number }
  | { type: 'invMove'; from: number; to: number }
  | { type: 'requestSave' };

// ---------------------------------------------------------------------------
// Server -> client.
// ---------------------------------------------------------------------------

/** What any client may see about an entity. Private state never goes here. */
export interface PublicEntity {
  id: EntityId;
  kind: 'player' | 'resource' | 'station' | 'scenery' | 'npc' | 'item';
  x: number;
  y: number;
  name: string;
  defKey?: string;
  combatLevel?: number;
  /** Resources: used up and waiting to grow back (a stump). */
  depleted?: boolean;
  /** Players: the tile they are working on (chopping), so others see the swing. */
  workingOn?: Point;
  /** Ground items: how many. */
  qty?: number;
}

/** State only the owning player sees. */
export interface SelfState {
  id: EntityId;
  name: string;
  skills: SkillXp;
  combatLevel: number;
  destination: Point | null;
  inventory: Inventory;
}

export type GameMessageKind = 'info' | 'warn' | 'examine' | 'quest' | 'levelup';

export type ServerMessage =
  | { type: 'welcome'; playerId: EntityId; protocolVersion: number; mapId: string; tick: number; tickMs: number }
  | { type: 'snapshot'; tick: number; entities: PublicEntity[] }
  | { type: 'tick'; tick: number; added: PublicEntity[]; updated: PublicEntity[]; removed: EntityId[] }
  | { type: 'self'; state: SelfState }
  | { type: 'gameMessage'; text: string; kind: GameMessageKind }
  | { type: 'xpDrop'; skill: SkillId; amount: number }
  | { type: 'levelUp'; skill: SkillId; level: number }
  | { type: 'saveData'; save: SaveData }
  | { type: 'reject'; reason: string };
