import type { WorldState } from '../state/world';
import type { Actor, Drop } from '../state/actor';
import { loadConfig, watchConfig, onConfigChange, type BotConfig } from '../config/load';
import { loadMonControl, watchMonControl, onMonControlChange, ruleFor, type MonRule } from '../config/mon-control';
import { loadPickup, watchPickup, pickupFlagFor } from '../config/pickupitems';
import { loadAvoid, watchAvoid, avoidRuleFor } from '../config/avoid';
import { loadItemsControl, watchItemsControl } from '../config/items-control';
import { loadShop, watchShop } from '../config/shop';
import { buildAttack, buildMove, buildPickup, buildRespawn, buildSkillTarget, buildUseItem, buildWarp, buildWarpRandom } from '../packet/encode';

type Send = (bytes: Uint8Array) => void;

interface BrainState {
  lastMoveTs: number;
  lastMoveTo?: { x: number; y: number };
  lastCastTs: number;
  lastCastTargetId?: number;
  lastCastSpBefore?: number;
  lastTargetId?: number;   // sticky current target — cleared when it dies or leaves range
  lastPickupTs: Map<number, number>;
  pickupAttempts: Map<number, number>;
  giveupDrops: Set<number>;
  lastActionTs: number;
  lastWingTs: number;
  paused: boolean;
  atHomeForStorage: boolean;
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
    atHomeForStorage: false,
  };

  const cfg0 = loadConfig();
  loadMonControl();
  loadPickup();
  loadAvoid();
  loadItemsControl();
  loadShop();
  watchConfig();
  watchMonControl();
  watchPickup();
  watchAvoid();
  watchItemsControl();
  watchShop();
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

  // 1b) avoid.txt — any sighted player matches → wing (highest priority)
  const av = loadAvoid();
  if (av.players.size > 0 || av.ids.size > 0) {
    for (const a of world.actors.values()) {
      if (a.kind !== 'player' || !a.alive || a.id === self.id) continue;
      const rule = avoidRuleFor(av, a.name, a.id);
      if (rule?.teleport && now - s.lastWingTs >= cfg.wingCooldownMs) {
        console.log(`[avoid] 🕊 wing — player ${a.name ?? a.id.toString(16)} sighted`);
        send(buildUseItem(cfg.flyWingItemID));
        s.lastWingTs = now;
        s.lastActionTs = now;
        return;
      }
    }
  }

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
    if (cfg.useTeleportPacket && self.map) send(buildWarpRandom(self.map));
    else send(buildUseItem(cfg.flyWingItemID));
    s.lastWingTs = now;
    s.lastActionTs = now;
    world.lastHitBy = undefined;
    return;
  }

  // 2b) Inventory full — warp home + pause combat state
  if (world.inventoryFull && !s.atHomeForStorage) {
    if (cfg.homeMap && cfg.homeX && cfg.homeY) {
      console.log(`[brain] 🎒 inv full — warp home ${cfg.homeMap}(${cfg.homeX},${cfg.homeY})`);
      send(buildWarp(cfg.homeMap, cfg.homeX, cfg.homeY));
      s.atHomeForStorage = true;
      s.lastActionTs = now;
      return;
    } else {
      console.warn('[brain] inv full but homeMap not configured — clearing flag');
      world.inventoryFull = false;
    }
  }

  // Skip combat/loot while parked at home waiting for user
  if (s.atHomeForStorage) return;

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
  const picked = pickTarget(world, cfg, self.pos, s);
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

  // 5) In range → cast skill OR basic attack (skill=0 = physical/melee class)
  const effectiveRange = rule.skill === 0 ? cfg.attackMeleeDistance : cfg.attackDistance;
  if (d <= effectiveRange) {
    if (now - s.lastCastTs >= cfg.attackCastDebounce) {
      if (rule.skill === 0) {
        console.log(`[brain] attack ${label} d=${d.toFixed(1)} (basic 0x0B)`);
        send(buildAttack(target.id));
      } else {
        const spBefore = self.sp;
        console.log(`[brain] cast skill=${rule.skill} lv=${rule.level} on ${label} d=${d.toFixed(1)} (SP=${spBefore ?? '?'})`);
        send(buildSkillTarget(target.id, rule.skill, rule.level));
        s.lastCastSpBefore = spBefore;
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
      s.lastCastTs = now;
      s.lastCastTargetId = target.id;
      s.lastActionTs = now;
    }
    return;
  }

  // 6) Move toward
  if (now - s.lastMoveTs < cfg.attackMoveDebounce) return;
  const step = stepToward(self.pos, target.pos, effectiveRange - cfg.attackApproachStopShort);
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
  s: BrainState,
): { actor: Actor; rule: MonRule } | undefined {
  const mc = loadMonControl();
  const selfId = world.self.id;

  // Stick with current target if still valid — avoids flip-flopping when a
  // closer mob wanders in mid-fight.
  if (s.lastTargetId !== undefined) {
    const cur = world.actors.get(s.lastTargetId);
    if (cur && cur.alive && cur.pos && cur.kind === 'monster') {
      const rule = ruleFor(mc, cur.name);
      if (rule.attack !== -1) {
        // keep as target unless very far (>= 2x normal engage range)
        const engage = rule.skill === 0 ? 4 : 20;
        if (dist(selfPos, cur.pos) <= engage) return { actor: cur, rule };
      }
    }
    // current target invalid → clear so we pick fresh
    s.lastTargetId = undefined;
  }

  let best: Actor | undefined;
  let bestRule: MonRule | undefined;
  let bestD = Infinity;
  for (const m of world.actors.values()) {
    if (m.id === selfId || !m.alive || !m.pos) continue;
    if (m.kind !== 'monster') continue;
    const mr = ruleFor(mc, m.name);
    if (mr.attack === -1) continue;
    if (mr.attack === 0) {
      const hit = world.lastHitBy;
      if (!hit || hit.attackerId !== m.id || Date.now() - hit.ts > 5000) continue;
    }
    const d = dist(selfPos, m.pos);
    if (d < bestD) {
      bestD = d;
      best = m;
      bestRule = mr;
    }
  }
  if (!best || !bestRule) return undefined;
  s.lastTargetId = best.id;
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
  const pickup = loadPickup();
  let best: Drop | undefined;
  let bestD = Infinity;
  let bestFlag = -Infinity;
  for (const d of world.drops.values()) {
    if (s.giveupDrops.has(d.dropId)) continue;
    const age = now - d.spawnedTs;
    if (age > cfg.lootMaxAgeMs) continue;
    if (age < 500) continue;
    const dd = dist(selfPos, d.at);
    if (dd > cfg.lootRange) continue;
    const flag = pickupFlagFor(pickup, d.itemId /* itemName TBD from item DB */);
    if (flag === 0 || flag === -1) continue;   // skip / dropInv
    // rush (flag=2) beats normal (flag=1); within same flag, nearest wins
    if (flag > bestFlag || (flag === bestFlag && dd < bestD)) {
      bestFlag = flag;
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

/**
 * Resume brain. If the bot was parked at home for storage, also fire a warp
 * back to the farm spot and clear the inventoryFull flag — user should have
 * finished depositing.
 */
export function resumeBrain(
  s: BrainState,
  world?: import('../state/world').WorldState,
  send?: Send,
): void {
  s.paused = false;
  console.log('[brain] resumed');
  if (s.atHomeForStorage && world && send) {
    const cfg = loadConfig();
    if (cfg.autoReturnAfterResume && cfg.farmMap && cfg.farmX && cfg.farmY) {
      console.log(`[brain] 🔙 return to farm ${cfg.farmMap}(${cfg.farmX},${cfg.farmY})`);
      send(buildWarp(cfg.farmMap, cfg.farmX, cfg.farmY));
    }
    s.atHomeForStorage = false;
    world.inventoryFull = false;
  }
}
