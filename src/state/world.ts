import { Actor, Drop } from './actor';
import type { Coord } from '../packet/types';

export class WorldState {
  self = {
    id: undefined as number | undefined,
    pos: undefined as Coord | undefined,
    hp: undefined as number | undefined,
    hpMax: undefined as number | undefined,
    sp: undefined as number | undefined,
    spMax: undefined as number | undefined,
    map: undefined as string | undefined,
    baseExp: undefined as number | undefined,
    jobExp: undefined as number | undefined,
    dead: false,
  };

  actors = new Map<number, Actor>();
  drops = new Map<number, Drop>();

  // rolling event counters for dashboard
  killsSession = 0;
  expGainedSession = 0;
  lootedSession = 0;
  lastEventTs = 0;

  getOrCreate(id: number, kind: Actor['kind'] = 'unknown'): Actor {
    let a = this.actors.get(id);
    if (!a) {
      a = new Actor(id, kind);
      this.actors.set(id, a);
    }
    return a;
  }

  removeActor(id: number): void {
    this.actors.delete(id);
  }

  monsters(): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) if (a.kind === 'monster' && a.alive) out.push(a);
    return out;
  }

  livingDrops(): Drop[] {
    return [...this.drops.values()];
  }
}
