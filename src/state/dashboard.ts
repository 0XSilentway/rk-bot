import type { WorldState } from './world';

let started = false;
let lastKey = '';

export function startDashboard(world: WorldState, intervalMs = 1000): void {
  if (started) return;
  started = true;
  setInterval(() => {
    const s = world.self;
    const mobs = world.monsters();
    const alive = mobs.filter(m => m.alive).length;
    const named = mobs.filter(m => m.name).slice(0, 4).map(m => `${m.name}#${m.id.toString(16).slice(-4)}`);
    const drops = world.drops.size;
    const idHex = s.id?.toString(16) ?? '?';
    const pos = s.pos ? `(${s.pos.x},${s.pos.y})` : '(?)';
    const hp = s.hp !== undefined && s.hpMax !== undefined ? `${s.hp}/${s.hpMax}` : '?/?';
    const sp = s.sp !== undefined && s.spMax !== undefined ? `${s.sp}/${s.spMax}` : '?/?';
    const map = s.map ?? '?';

    // dedup key excludes evtAge and per-tick jitter
    const key = [idHex, map, pos, hp, sp, alive, drops, world.killsSession, world.lootedSession, world.expGainedSession, named.join(','), s.dead].join('|');
    if (key === lastKey) return;
    lastKey = key;

    const hints: string[] = [];
    if (s.id === undefined) hints.push('[HINT] no self id — attack a mob once');
    else if (!s.pos) hints.push('[HINT] no self pos — click to move 1 step');
    if (mobs.length > 0 && alive > 0 && !mobs.some(m => m.pos && m.name)) {
      hints.push('[HINT] mobs tracked but no name+pos — try "dump" to inspect');
    }
    const line =
      `[world] id=${idHex} map=${map} pos=${pos} HP=${hp} SP=${sp} ` +
      `mobs=${alive} drops=${drops} kills=${world.killsSession} loot=${world.lootedSession} ` +
      `exp+${world.expGainedSession} ${named.length ? '| ' + named.join(' ') : ''}` +
      `${s.dead ? ' [DEAD]' : ''}` +
      (hints.length ? '\n  ' + hints.join('\n  ') : '');
    console.log(line);
  }, intervalMs);
}
