import type { ActorKind, Coord } from '../packet/types';

export class Actor {
  id: number;
  kind: ActorKind;
  name?: string;
  pos?: Coord;
  posTo?: Coord;
  lastSeenTs = 0;
  alive = true;

  constructor(id: number, kind: ActorKind, name?: string) {
    this.id = id;
    this.kind = kind;
    this.name = name;
  }
}

export class Drop {
  dropId: number;
  itemId: number;
  amount: number;
  at: Coord;
  spawnedTs: number;

  constructor(dropId: number, itemId: number, amount: number, at: Coord, spawnedTs: number) {
    this.dropId = dropId;
    this.itemId = itemId;
    this.amount = amount;
    this.at = at;
    this.spawnedTs = spawnedTs;
  }
}
