import type { PacketEvent } from '../packet/types';
import { Drop } from './actor';
import type { WorldState } from './world';

const STAT_HP = 0;
const STAT_SP = 1;

// Auto-detect playerId: if same victim id appears in ≥3 attack_result packets
// where victim != attacker, assume that's us. (Fallback if 0x03 select_char miss.)
const victimHits = new Map<number, number>();

export function applyEvent(world: WorldState, ev: PacketEvent): void {
  world.lastEventTs = ev.ts;

  switch (ev.kind) {
    case 'select_char':
      world.self.id = ev.playerId;
      if (ev.mapName) world.self.map = ev.mapName;
      return;

    case 'map_name':
      world.self.map = ev.name;
      return;

    case 'spawn': {
      const a = world.getOrCreate(ev.actorId, ev.actorKind);
      a.kind = ev.actorKind;
      if (ev.name) a.name = ev.name;
      a.alive = true;
      a.lastSeenTs = ev.ts;
      return;
    }

    case 'move': {
      const a = world.getOrCreate(ev.actorId);
      a.posTo = ev.to;
      // start-of-move: pos still current; snap after MOVE_UPDATE arrives without a follow
      a.pos = a.pos ?? ev.to;
      a.lastSeenTs = ev.ts;
      if (ev.actorId === world.self.id) world.self.pos = ev.to;
      return;
    }

    case 'pos': {
      const a = world.getOrCreate(ev.actorId);
      a.pos = ev.at;
      a.posTo = undefined;
      a.lastSeenTs = ev.ts;
      if (ev.actorId === world.self.id) world.self.pos = ev.at;
      return;
    }

    case 'despawn': {
      const a = world.actors.get(ev.actorId);
      if (a) a.alive = false;
      // hard-remove after grace (Phase later); keep for now for anti-flicker
      return;
    }

    case 'action': {
      // action=3 = entity died. Kind detection from spawn is unreliable, so
      // count kills for any non-self actor.
      if (ev.action === 3 && ev.actorId !== world.self.id) {
        const a = world.actors.get(ev.actorId);
        if (a) a.alive = false;
        world.killsSession++;
      }
      return;
    }

    case 'damage': {
      const a = world.actors.get(ev.victimId);
      if (a) a.lastSeenTs = ev.ts;
      return;
    }

    case 'attack_result': {
      // fallback playerId discovery
      if (world.self.id === undefined && ev.victimId && ev.victimId !== ev.attackerId) {
        const n = (victimHits.get(ev.victimId) ?? 0) + 1;
        victimHits.set(ev.victimId, n);
        if (n >= 3) {
          world.self.id = ev.victimId;
          console.log(`[state] auto-detected playerId = 0x${ev.victimId.toString(16)} via 0x0B repeats`);
        }
      }
      return;
    }

    case 'stat': {
      if (ev.statType === STAT_HP) {
        if (ev.actorId === world.self.id || world.self.id === undefined) {
          world.self.hp = ev.cur;
          world.self.hpMax = ev.max;
        }
      } else if (ev.statType === STAT_SP) {
        if (ev.actorId === world.self.id || world.self.id === undefined) {
          world.self.sp = ev.cur;
          world.self.spMax = ev.max;
        }
      }
      return;
    }

    case 'sp':
      world.self.sp = ev.cur;
      world.self.spMax = ev.max;
      return;

    case 'exp':
      world.self.baseExp = ev.baseTotal;
      world.self.jobExp = ev.jobTotal;
      world.expGainedSession += ev.baseGained;
      return;

    case 'drop':
      world.drops.set(ev.dropId, new Drop(ev.dropId, ev.itemId, ev.amount, ev.at, ev.ts));
      return;

    case 'pickup_bcast':
      world.drops.delete(ev.dropId);
      if (ev.actorId === world.self.id) world.lootedSession++;
      return;

    case 'death':
      if (ev.actorId === world.self.id) world.self.dead = true;
      return;

    case 'skill_result':
    case 'unknown':
      return;
  }
}
