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

  /** Any actor that isn't obviously self / npc / player and is alive with a position. */
  targets(): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) {
      if (a.id === this.self.id) continue;
      if (!a.alive) continue;
      // NPCs never attack us; treat only spawn-confirmed npc as non-target
      if (a.kind === 'npc') continue;
      out.push(a);
    }
    return out;
  }

  /** Only actors explicitly known to be monsters (via 0x06 SPAWN kind=1). */
  monsters(): Actor[] {
    const out: Actor[] = [];
    for (const a of this.actors.values()) if (a.kind === 'monster' && a.alive) out.push(a);
    return out;
  }

  livingDrops(): Drop[] {
    return [...this.drops.values()];
  }
}
