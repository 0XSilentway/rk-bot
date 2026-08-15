import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

/**
 * OpenKore-style flat key-value file (control/config.txt).
 * Every non-comment line is: `<key>  <value>` with any whitespace.
 */
export interface BotConfig {
  enabled: boolean;
  tickMs: number;
  attackDistance: number;
  attackMeleeDistance: number;
  attackApproachStopShort: number;
  attackMoveDebounce: number;
  attackCastDebounce: number;
  useTeleportPacket: boolean;
  flyWingItemID: number;
  teleportOnHPPct: number;
  wingCooldownMs: number;
  teleportSightRange: number;
  homeMap: string;
  homeX: number;
  homeY: number;
  farmMap: string;
  farmX: number;
  farmY: number;
  autoReturnAfterResume: boolean;
  lootAll: boolean;
  lootMaxAgeMs: number;
  lootRange: number;
  roamAuto: boolean;
  roamIdleMs: number;
  roamRadius: number;
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'config.txt');

let current: BotConfig | undefined;
const listeners: Array<(c: BotConfig) => void> = [];

function parseTxt(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const m = line.match(/^(\S+)\s+(.+)$/);
    if (!m) continue;
    out[m[1]!] = m[2]!.trim();
  }
  return out;
}

function toBool(v: string | undefined, def: boolean): boolean {
  if (v === undefined) return def;
  const s = v.toLowerCase();
  return s === '1' || s === 'true' || s === 'yes' || s === 'on';
}
function toNum(v: string | undefined, def: number): number {
  if (v === undefined) return def;
  const n = Number(v);
  return isFinite(n) ? n : def;
}

function loadOnce(): BotConfig {
  const raw = readFileSync(FILE, 'utf-8');
  const kv = parseTxt(raw);
  return {
    enabled: toBool(kv.enabled, true),
    tickMs: toNum(kv.tickMs, 500),
    attackDistance: toNum(kv.attackDistance, 9),
    attackMeleeDistance: toNum(kv.attackMeleeDistance, 2),
    attackApproachStopShort: toNum(kv.attackApproachStopShort, 2),
    attackMoveDebounce: toNum(kv.attackMoveDebounce, 400),
    attackCastDebounce: toNum(kv.attackCastDebounce, 2500),
    useTeleportPacket: toBool(kv.useTeleportPacket, true),
    flyWingItemID: toNum(kv.flyWingItemID, 601),
    teleportOnHPPct: toNum(kv.teleportOnHPPct, 30),
    wingCooldownMs: toNum(kv.wingCooldownMs, 4000),
    teleportSightRange: toNum(kv.teleportSightRange, 12),
    homeMap: kv.homeMap ?? '',
    homeX: toNum(kv.homeX, 0),
    homeY: toNum(kv.homeY, 0),
    farmMap: kv.farmMap ?? '',
    farmX: toNum(kv.farmX, 0),
    farmY: toNum(kv.farmY, 0),
    autoReturnAfterResume: toBool(kv.autoReturnAfterResume, true),
    lootAll: toBool(kv.lootAll, true),
    lootMaxAgeMs: toNum(kv.lootMaxAgeMs, 30000),
    lootRange: toNum(kv.lootRange, 12),
    roamAuto: toBool(kv.roamAuto, false),
    roamIdleMs: toNum(kv.roamIdleMs, 4000),
    roamRadius: toNum(kv.roamRadius, 15),
  };
}

export function loadConfig(): BotConfig {
  if (!current) current = loadOnce();
  return current;
}

export function onConfigChange(cb: (c: BotConfig) => void): void {
  listeners.push(cb);
}

export function watchConfig(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log('[config] reloaded ' + FILE);
        for (const cb of listeners) cb(current);
      } catch (e) {
        console.warn('[config] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}
