import type { WorldState } from './world';

let started = false;
let last = '';

export function startDashboard(world: WorldState, intervalMs = 1000): void {
  if (started) return;
  started = true;
  setInterval(() => {
    const now = Date.now();
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
    const age = world.lastEventTs > 0 ? ((now - world.lastEventTs) / 1000).toFixed(1) : 'n/a';
    const line =
      `[world] id=${idHex} map=${map} pos=${pos} HP=${hp} SP=${sp} ` +
      `mobs=${alive} drops=${drops} kills=${world.killsSession} loot=${world.lootedSession} ` +
      `exp+${world.expGainedSession} evtAge=${age}s ${named.length ? '| ' + named.join(' ') : ''}` +
      `${s.dead ? ' [DEAD]' : ''}`;
    if (line !== last) {
      console.log(line);
      last = line;
    }
  }, intervalMs);
}
