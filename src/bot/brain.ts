import type { WorldState } from '../state/world';
import type { Actor, Drop } from '../state/actor';
import { loadConfig, watchConfig, onConfigChange, type BotConfig } from '../config/load';
import { loadMonControl, watchMonControl, onMonControlChange, ruleFor, type MonRule } from '../config/mon-control';
import { buildMove, buildPickup, buildRespawn, buildSkillTarget, buildUseItem } from '../packet/encode';

type Send = (bytes: Uint8Array) => void;

interface BrainState {
  lastMoveTs: number;
  lastMoveTo?: { x: number; y: number };
  lastCastTs: number;
  lastCastTargetId?: number;
  lastCastSpBefore?: number;
  lastPickupTs: Map<number, number>;
  pickupAttempts: Map<number, number>;
  giveupDrops: Set<number>;
  lastActionTs: number;
  lastWingTs: number;
  paused: boolean;
}

export function startBrain(world: WorldState, send: Send): BrainState {
  const s: BrainState = {
    lastMoveTs: 0,
    lastCastTs: 0,
    lastPickupTs: new Map(),
    pickupAttempts: new Map(),
    giveupDrops: new Set(),
    lastActionTs: Date.now(),
    lastWingTs: 0,
    paused: false,
  };

  const cfg0 = loadConfig();
  loadMonControl();
  watchConfig();
  watchMonControl();
  onConfigChange(() => console.log('[brain] config.txt reloaded'));
  onMonControlChange((d) => console.log(`[brain] mon_control.txt reloaded — ${d.entries.size} rules`));
  s.paused = !cfg0.enabled;

  setInterval(() => tick(world, send, s), cfg0.tickMs);
  console.log(`[brain] started (tick ${cfg0.tickMs}ms) — enabled=${!s.paused}`);
  return s;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function tick(world: WorldState, send: Send, s: BrainState): void {
  if (s.paused) return;
  const cfg = loadConfig();
  const mc = loadMonControl();
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

  const now = Date.now();

  // 2) Emergency wing — 3 triggers (priority: hp > attacked > sight)
  const hpPct = self.hp && self.hpMax ? (self.hp / self.hpMax) * 100 : 100;
  let wingReason = '';

  if (hpPct < cfg.teleportOnHPPct) {
    wingReason = `HP=${hpPct.toFixed(0)}%`;
  } else if (world.lastHitBy && now - world.lastHitBy.ts < 1500) {
    const attacker = world.actors.get(world.lastHitBy.attackerId);
    const rule = ruleFor(mc, attacker?.name);
    if (rule.teleport === 1) wingReason = `attacked by ${attacker?.name ?? '?'} (teleport=1)`;
  }
  if (!wingReason) {
    for (const m of world.actors.values()) {
      if (!m.alive || !m.pos || m.kind !== 'monster') continue;
      const rule = ruleFor(mc, m.name);
      if (rule.teleport !== 2) continue;
      const d = dist(self.pos, m.pos);
      if (d <= cfg.teleportSightRange) {
        wingReason = `sighted ${m.name} @ ${d.toFixed(1)}t (teleport=2)`;
        break;
      }
    }
  }

  if (wingReason && now - s.lastWingTs >= cfg.wingCooldownMs) {
    console.log(`[brain] 🕊 FLY WING — ${wingReason}`);
    send(buildUseItem(cfg.flyWingItemID));
    s.lastWingTs = now;
    s.lastActionTs = now;
    world.lastHitBy = undefined;
    return;
  }

  // 3) Pickup
  const drop = pickupTarget(world, cfg, self.pos, s, now);
  if (drop) {
    const last = s.lastPickupTs.get(drop.dropId) ?? 0;
    if (now - last > 1500) {
      const attempts = (s.pickupAttempts.get(drop.dropId) ?? 0) + 1;
      s.pickupAttempts.set(drop.dropId, attempts);
      if (attempts > 4) {
        console.log(`[brain] give up on drop 0x${drop.dropId.toString(16)}`);
        s.giveupDrops.add(drop.dropId);
        world.drops.delete(drop.dropId);
        return;
      }
      console.log(`[brain] pickup drop 0x${drop.dropId.toString(16)} item=${drop.itemId} try=${attempts}`);
      send(buildPickup(drop.dropId));
      s.lastPickupTs.set(drop.dropId, now);
      s.lastActionTs = now;
    }
    return;
  }

  // 4) Target picking (uses mon_control per-mob rule)
  const picked = pickTarget(world, cfg, self.pos);
  if (!picked) {
    if (cfg.roamAuto && now - s.lastActionTs > cfg.roamIdleMs && now - s.lastMoveTs > 2000) {
      const r = cfg.roamRadius;
      const rx = Math.round(self.pos.x + (Math.random() * 2 - 1) * r);
      const ry = Math.round(self.pos.y + (Math.random() * 2 - 1) * r);
      console.log(`[brain] roam → (${rx},${ry})`);
      send(buildMove(rx, ry));
      s.lastMoveTs = now;
      s.lastMoveTo = { x: rx, y: ry };
      s.lastActionTs = now;
    }
    return;
  }
  const { actor: target, rule } = picked;
  if (!target.pos) return;
  const d = dist(self.pos, target.pos);
  const label = `${target.name ?? '?'}#${target.id.toString(16).slice(-4)}`;

  // 5) In range → cast (debounced)
  if (d <= cfg.attackDistance) {
    if (now - s.lastCastTs >= cfg.attackCastDebounce) {
      const spBefore = self.sp;
      console.log(`[brain] cast skill=${rule.skill} lv=${rule.level} on ${label} d=${d.toFixed(1)} (SP=${spBefore ?? '?'})`);
      send(buildSkillTarget(target.id, rule.skill, rule.level));
      s.lastCastTs = now;
      s.lastCastTargetId = target.id;
      s.lastCastSpBefore = spBefore;
      s.lastActionTs = now;
      setTimeout(() => {
        const spAfter = world.self.sp;
        const still = world.actors.get(target.id);
        if (still && !still.alive) return;
        if (spBefore !== undefined && spAfter !== undefined && spAfter >= spBefore) {
          console.log(`[brain] ⚠️ cast REJECTED (SP unchanged ${spBefore}→${spAfter})`);
        } else if (spBefore !== undefined && spAfter !== undefined) {
          console.log(`[brain] ✓ cast OK (SP ${spBefore}→${spAfter}, -${spBefore - spAfter})`);
        }
      }, 1500);
    }
    return;
  }

  // 6) Move toward
  if (now - s.lastMoveTs < cfg.attackMoveDebounce) return;
  const step = stepToward(self.pos, target.pos, cfg.attackDistance - cfg.attackApproachStopShort);
  if (s.lastMoveTo && s.lastMoveTo.x === step.x && s.lastMoveTo.y === step.y && now - s.lastMoveTs < 3000) return;
  console.log(`[brain] move to (${step.x},${step.y}) toward ${label} (d=${d.toFixed(1)})`);
  send(buildMove(step.x, step.y));
  s.lastMoveTs = now;
  s.lastMoveTo = step;
  s.lastActionTs = now;
}

function pickTarget(
  world: WorldState,
  _cfg: BotConfig,
  selfPos: { x: number; y: number },
): { actor: Actor; rule: MonRule } | undefined {
  const mc = loadMonControl();
  let best: Actor | undefined;
  let bestRule: MonRule | undefined;
  let bestD = Infinity;
  const selfId = world.self.id;
  for (const m of world.actors.values()) {
    if (m.id === selfId || !m.alive || !m.pos) continue;
    if (m.kind !== 'monster') continue;
    const mr = ruleFor(mc, m.name);
    // attack==1: always
    // attack==0: only if this mob has hit us recently (defensive)
    // attack==-1: never
    if (mr.attack === -1) continue;
    if (mr.attack === 0) {
      const hit = world.lastHitBy;
      if (!hit || hit.attackerId !== m.id || Date.now() - hit.ts > 5000) continue;
    }
    if (!mr.skill) continue; // no skill assigned → can't attack
    const d = dist(selfPos, m.pos);
    if (d < bestD) {
      bestD = d;
      best = m;
      bestRule = mr;
    }
  }
  if (!best || !bestRule) return undefined;
  return { actor: best, rule: bestRule };
}

function pickupTarget(
  world: WorldState,
  cfg: BotConfig,
  selfPos: { x: number; y: number },
  s: BrainState,
  now: number,
): Drop | undefined {
  if (!cfg.lootAll) return undefined;
  let best: Drop | undefined;
  let bestD = Infinity;
  for (const d of world.drops.values()) {
    if (s.giveupDrops.has(d.dropId)) continue;
    const age = now - d.spawnedTs;
    if (age > cfg.lootMaxAgeMs) continue;
    if (age < 500) continue;
    const dd = dist(selfPos, d.at);
    if (dd > cfg.lootRange) continue;
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

export function pauseBrain(s: BrainState): void { s.paused = true; console.log('[brain] paused'); }
export function resumeBrain(s: BrainState): void { s.paused = false; console.log('[brain] resumed'); }
