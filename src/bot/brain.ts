import type { WorldState } from '../state/world';
import type { Actor, Drop } from '../state/actor';
import { botConfig, matchRule } from './config';
import { buildMove, buildPickup, buildRespawn, buildSkillTarget } from '../packet/encode';

type Send = (bytes: Uint8Array) => void;

interface BrainState {
  lastMoveTs: number;
  lastMoveTo?: { x: number; y: number };
  lastCastTs: number;
  lastPickupTs: Map<number, number>;
  pickupAttempts: Map<number, number>;
  giveupDrops: Set<number>;
  lastTargetId?: number;
  paused: boolean;
}

export function startBrain(world: WorldState, send: Send): BrainState {
  const s: BrainState = {
    lastMoveTs: 0,
    lastCastTs: 0,
    lastPickupTs: new Map(),
    pickupAttempts: new Map(),
    giveupDrops: new Set(),
    paused: !botConfig.enabled,
  };

  setInterval(() => tick(world, send, s), botConfig.tickMs);
  console.log(`[brain] started (tick ${botConfig.tickMs}ms) — enabled=${!s.paused}`);
  return s;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tick(world: WorldState, send: Send, s: BrainState): void {
  if (s.paused) return;
  const self = world.self;
  if (!self.id || !self.pos) return;

  // 1) Dead → respawn
  if (self.dead) {
    if (Date.now() - s.lastCastTs > 3000) {
      console.log('[brain] respawn');
      send(buildRespawn());
      s.lastCastTs = Date.now();
      self.dead = false;
    }
    return;
  }

  // 2) HP too low → disengage (stop attacking)
  const hpPct = self.hp && self.hpMax ? (self.hp / self.hpMax) * 100 : 100;
  if (hpPct < botConfig.disengageHpPct) return;

  // 3) Any drop within range and old enough to have finished bouncing?
  const now = Date.now();
  const drop = pickupTarget(world, self.pos, s, now);
  if (drop) {
    const last = s.lastPickupTs.get(drop.dropId) ?? 0;
    if (now - last > 1500) {
      const attempts = (s.pickupAttempts.get(drop.dropId) ?? 0) + 1;
      s.pickupAttempts.set(drop.dropId, attempts);
      if (attempts > 4) {
        console.log(`[brain] give up on drop 0x${drop.dropId.toString(16)} (${attempts} tries)`);
        s.giveupDrops.add(drop.dropId);
        world.drops.delete(drop.dropId);
        return;
      }
      console.log(
        `[brain] pickup drop 0x${drop.dropId.toString(16)} item=${drop.itemId} try=${attempts}`,
      );
      send(buildPickup(drop.dropId));
      s.lastPickupTs.set(drop.dropId, now);
    }
    return;
  }

  // 4) Find target
  const picked = pickTarget(world, self.pos);
  if (!picked) return;
  const { actor: target, skill } = picked;
  if (!target.pos) return;
  const d = dist(self.pos, target.pos);
  const label = `${target.name ?? '?'}#${target.id.toString(16).slice(-4)}`;

  // 5) In range → cast skill (with debounce)
  if (d <= botConfig.castRangeCells) {
    if (now - s.lastCastTs >= botConfig.castDebounceMs) {
      const spBefore = self.sp;
      console.log(`[brain] cast skill=${skill.id} lv=${skill.level} on ${label} d=${d.toFixed(1)} (SP before=${spBefore ?? '?'})`);
      send(buildSkillTarget(target.id, skill.id, skill.level));
      s.lastCastTs = now;
      s.lastTargetId = target.id;
      // check if cast actually took effect
      setTimeout(() => {
        const spAfter = world.self.sp;
        if (spBefore !== undefined && spAfter !== undefined && spAfter >= spBefore) {
          console.log(`[brain] ⚠️ cast REJECTED (SP unchanged ${spBefore}→${spAfter})`);
        } else if (spBefore !== undefined && spAfter !== undefined) {
          console.log(`[brain] ✓ cast OK (SP ${spBefore}→${spAfter}, -${spBefore - spAfter})`);
        }
      }, 1500);
    }
    return;
  }

  // 6) Out of range → move toward, but stop within range
  if (now - s.lastMoveTs < botConfig.moveDebounceMs) return;
  const step = stepToward(self.pos, target.pos, botConfig.castRangeCells - botConfig.approachStopShortCells);
  if (
    s.lastMoveTo &&
    s.lastMoveTo.x === step.x &&
    s.lastMoveTo.y === step.y &&
    now - s.lastMoveTs < 3000
  ) return;
  console.log(`[brain] move to (${step.x},${step.y}) toward ${label} (d=${d.toFixed(1)})`);
  send(buildMove(step.x, step.y));
  s.lastMoveTs = now;
  s.lastMoveTo = step;
}

function pickTarget(
  world: WorldState,
  selfPos: { x: number; y: number },
): { actor: Actor; skill: { id: number; level: number } } | undefined {
  let best: Actor | undefined;
  let bestD = Infinity;
  const selfId = world.self.id;
  for (const m of world.actors.values()) {
    if (m.id === selfId || !m.alive || !m.pos) continue;
    // ONLY confirmed monsters (kind=1 from 0x06 SPAWN, or flag=3/4 boss from 0x3c batch)
    // avoids InvalidTarget errors from hitting players / warps / self
    if (m.kind !== 'monster') continue;
    if (!botConfig.attackAll && !matchRule(m.name)) continue;
    const d = dist(selfPos, m.pos);
    if (d < bestD) {
      bestD = d;
      best = m;
    }
  }
  if (!best) return undefined;
  const rule = matchRule(best.name);
  const skill = rule ? rule.skill : botConfig.attackAllSkill;
  return { actor: best, skill };
}

function pickupTarget(
  world: WorldState,
  selfPos: { x: number; y: number },
  s: BrainState,
  now: number,
): Drop | undefined {
  let best: Drop | undefined;
  let bestD = Infinity;
  for (const d of world.drops.values()) {
    if (s.giveupDrops.has(d.dropId)) continue;
    const age = now - d.spawnedTs;
    if (age > botConfig.lootMaxAgeMs) continue;
    if (age < 500) continue;
    const dd = dist(selfPos, d.at);
    if (dd > botConfig.lootRangeCells) continue;
    if (dd < bestD) {
      bestD = dd;
      best = d;
    }
  }
  return best;
}

function stepToward(
  from: { x: number; y: number },
  to: { x: number; y: number },
  stopWithin: number,
): { x: number; y: number } {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const d = Math.hypot(dx, dy);
  if (d <= stopWithin) return { x: to.x, y: to.y };
  const ratio = (d - stopWithin) / d;
  return {
    x: Math.round(from.x + dx * ratio),
    y: Math.round(from.y + dy * ratio),
  };
}

export function pauseBrain(s: BrainState): void {
  s.paused = true;
  console.log('[brain] paused');
}
export function resumeBrain(s: BrainState): void {
  s.paused = false;
  console.log('[brain] resumed');
}
