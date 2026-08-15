import type { WorldState } from '../state/world';
import type { Actor, Drop } from '../state/actor';
import { loadConfig, watchConfig, onConfigChange, type BotConfig, type SkillRule } from '../config/load';
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
  watchConfig();
  onConfigChange(c => console.log('[brain] config reloaded — skills:', c.skills.length, 'mon_control keys:', Object.keys(c.mon_control).length));
  s.paused = !cfg0.enabled;

  setInterval(() => tick(world, send, s), cfg0.tick_ms);
  console.log(`[brain] started (tick ${cfg0.tick_ms}ms) — enabled=${!s.paused}`);
  return s;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function matchSkill(cfg: BotConfig, name: string | undefined): SkillRule | undefined {
  if (!name) return undefined;
  const lower = name.toLowerCase();
  for (const rule of cfg.skills) {
    for (const m of rule.match) {
      if (m === '*' || lower.includes(m.toLowerCase())) return rule;
    }
  }
  return undefined;
}

function policyFor(cfg: BotConfig, name: string | undefined): 'auto' | 'skip' | 'if_attacked' {
  if (!name) return cfg.mon_control.default;
  // exact-name lookup first, then default
  return cfg.mon_control[name] ?? cfg.mon_control.default;
}

function tick(world: WorldState, send: Send, s: BrainState): void {
  if (s.paused) return;
  const cfg = loadConfig();
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

  // 2) Emergency wing — recently hit OR HP low
  const hpPct = self.hp && self.hpMax ? (self.hp / self.hpMax) * 100 : 100;
  const hitRecently = world.lastHitByMobTs !== undefined && now - world.lastHitByMobTs < 1500;
  const shouldWing =
    (hpPct < cfg.emergency.hp_pct_threshold) || (cfg.emergency.wing_on_hit && hitRecently);
  if (shouldWing && now - s.lastWingTs >= cfg.emergency.wing_cooldown_ms) {
    console.log(`[brain] 🕊 FLY WING (HP=${hpPct.toFixed(0)}% hit=${hitRecently ? 'yes' : 'no'})`);
    send(buildUseItem(cfg.emergency.fly_wing_item_id));
    s.lastWingTs = now;
    s.lastActionTs = now;
    return;
  }

  // 3) Pickup any drop in range
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

  // 4) Find target — only mobs whose policy is 'auto'
  const picked = pickTarget(world, cfg, self.pos);
  if (!picked) {
    if (cfg.roam.enabled && now - s.lastActionTs > cfg.roam.idle_ms && now - s.lastMoveTs > 2000) {
      const r = cfg.roam.radius_tiles;
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
  const { actor: target, skill } = picked;
  if (!target.pos) return;
  const d = dist(self.pos, target.pos);
  const label = `${target.name ?? '?'}#${target.id.toString(16).slice(-4)}`;

  // 5) In range → cast (debounced)
  if (d <= cfg.combat.cast_range_cells) {
    if (now - s.lastCastTs >= cfg.combat.cast_debounce_ms) {
      const spBefore = self.sp;
      console.log(`[brain] cast skill=${skill.id} lv=${skill.level} on ${label} d=${d.toFixed(1)} (SP=${spBefore ?? '?'})`);
      send(buildSkillTarget(target.id, skill.id, skill.level));
      s.lastCastTs = now;
      s.lastCastTargetId = target.id;
      s.lastCastSpBefore = spBefore;
      s.lastActionTs = now;
      setTimeout(() => {
        const spAfter = world.self.sp;
        const still = world.actors.get(target.id);
        if (still && (!still.alive)) return;
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
  if (now - s.lastMoveTs < cfg.combat.move_debounce_ms) return;
  const step = stepToward(self.pos, target.pos, cfg.combat.cast_range_cells - cfg.combat.approach_stop_short);
  if (s.lastMoveTo && s.lastMoveTo.x === step.x && s.lastMoveTo.y === step.y && now - s.lastMoveTs < 3000) return;
  console.log(`[brain] move to (${step.x},${step.y}) toward ${label} (d=${d.toFixed(1)})`);
  send(buildMove(step.x, step.y));
  s.lastMoveTs = now;
  s.lastMoveTo = step;
  s.lastActionTs = now;
}

function pickTarget(
  world: WorldState,
  cfg: BotConfig,
  selfPos: { x: number; y: number },
): { actor: Actor; skill: { id: number; level: number } } | undefined {
  let best: Actor | undefined;
  let bestSkill: { id: number; level: number } | undefined;
  let bestD = Infinity;
  const selfId = world.self.id;
  for (const m of world.actors.values()) {
    if (m.id === selfId || !m.alive || !m.pos) continue;
    if (m.kind !== 'monster') continue;
    const policy = policyFor(cfg, m.name);
    if (policy === 'skip') continue;
    const rule = matchSkill(cfg, m.name);
    if (!rule) continue; // no skill = can't attack this mob → skip
    const d = dist(selfPos, m.pos);
    if (d < bestD) {
      bestD = d;
      best = m;
      bestSkill = rule.skill;
    }
  }
  if (!best || !bestSkill) return undefined;
  return { actor: best, skill: bestSkill };
}

function pickupTarget(
  world: WorldState,
  cfg: BotConfig,
  selfPos: { x: number; y: number },
  s: BrainState,
  now: number,
): Drop | undefined {
  if (cfg.loot.default === 'skip') return undefined;
  let best: Drop | undefined;
  let bestD = Infinity;
  for (const d of world.drops.values()) {
    if (s.giveupDrops.has(d.dropId)) continue;
    const age = now - d.spawnedTs;
    if (age > cfg.loot.max_age_ms) continue;
    if (age < 500) continue;
    const dd = dist(selfPos, d.at);
    if (dd > cfg.loot.range_cells) continue;
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
