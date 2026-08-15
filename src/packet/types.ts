export type Coord = { x: number; y: number };
export type ActorKind = 'player' | 'monster' | 'npc' | 'item' | 'unknown';

export type StatType = 'hp' | 'sp' | 'other';

export interface DecodedBase {
  op: number;
  ts: number;
  raw: Uint8Array;
}

export interface EvSpawn extends DecodedBase {
  kind: 'spawn';
  actorId: number;
  actorKind: ActorKind;
  name?: string;
  at?: Coord;
}

export interface EvMove extends DecodedBase {
  kind: 'move';
  actorId: number;
  to: Coord;
}

export interface EvPos extends DecodedBase {
  kind: 'pos';
  actorId: number;
  at: Coord;
}

export interface EvDespawn extends DecodedBase {
  kind: 'despawn';
  actorId: number;
  reason?: number;
}

export interface EvAction extends DecodedBase {
  kind: 'action';
  actorId: number;
  action: number; // 3 = mob died
}

export interface EvDamage extends DecodedBase {
  kind: 'damage';
  victimId: number;
  damage: number;
}

export interface EvAttackResult extends DecodedBase {
  kind: 'attack_result';
  attackerId: number;
  victimId: number;
  damage?: number;
}

export interface EvStat extends DecodedBase {
  kind: 'stat';
  actorId: number;
  statType: number;
  cur: number;
  max: number;
}

export interface EvSp extends DecodedBase {
  kind: 'sp';
  cur: number;
  max: number;
}

export interface EvExp extends DecodedBase {
  kind: 'exp';
  baseTotal: number;
  baseGained: number;
  jobTotal: number;
  jobGained: number;
}

export interface EvDrop extends DecodedBase {
  kind: 'drop';
  dropId: number;
  at: Coord; // float32 LE decoded
  itemId: number;
  amount: number;
}

export interface EvPickupBcast extends DecodedBase {
  kind: 'pickup_bcast';
  dropId: number;
  actorId: number;
}

export interface EvDeath extends DecodedBase {
  kind: 'death';
  actorId: number;
}

export interface EvMapName extends DecodedBase {
  kind: 'map_name';
  name: string;
}

export interface EvSelectChar extends DecodedBase {
  kind: 'select_char';
  playerId: number;
  mapName?: string;
}

export interface EvSkillResult extends DecodedBase {
  kind: 'skill_result';
  srcId: number;
  dstId: number;
  skillId: number;
  damage?: number;
}

export interface EvUnknown extends DecodedBase {
  kind: 'unknown';
}

export type PacketEvent =
  | EvSpawn
  | EvMove
  | EvPos
  | EvDespawn
  | EvAction
  | EvDamage
  | EvAttackResult
  | EvStat
  | EvSp
  | EvExp
  | EvDrop
  | EvPickupBcast
  | EvDeath
  | EvMapName
  | EvSelectChar
  | EvSkillResult
  | EvUnknown;
