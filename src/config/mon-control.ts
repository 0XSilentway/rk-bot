import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export type AttackPolicy = -1 | 0 | 1;      // ignore | defensive | auto
export type TeleportPolicy = 0 | 1 | 2;     // never | on_attacked | on_sight

export interface MonRule {
  attack: AttackPolicy;
  teleport: TeleportPolicy;
  skill: number;      // skill id (0 = no skill)
  level: number;      // skill level
}

export interface MonControlDoc {
  default: MonRule;
  entries: Map<string, MonRule>;   // lowercase name → rule
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'mon_control.txt');

let current: MonControlDoc | undefined;
const listeners: Array<(d: MonControlDoc) => void> = [];

/**
 * Parse a mon_control line like:
 *   Steel Chonchon 1 1 11 10
 *   all            0 0  0  0
 * Trailing 4 tokens are numeric (attack, teleport, skill, level).
 * Everything before that is the monster name (may contain spaces).
 */
function parseLine(line: string): { name: string; rule: MonRule } | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const nums = parts.slice(-4).map(Number);
  if (nums.some((n) => !isFinite(n))) return null;
  const name = parts.slice(0, -4).join(' ');
  const attack = nums[0]! as AttackPolicy;
  const teleport = nums[1]! as TeleportPolicy;
  const skill = nums[2]!;
  const level = nums[3]!;
  return { name, rule: { attack, teleport, skill, level } };
}

function loadOnce(): MonControlDoc {
  const text = readFileSync(FILE, 'utf-8');
  const entries = new Map<string, MonRule>();
  let def: MonRule = { attack: 0, teleport: 0, skill: 0, level: 0 };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const parsed = parseLine(line);
    if (!parsed) continue;
    if (parsed.name.toLowerCase() === 'all') def = parsed.rule;
    else entries.set(parsed.name.toLowerCase(), parsed.rule);
  }
  return { default: def, entries };
}

export function loadMonControl(): MonControlDoc {
  if (!current) current = loadOnce();
  return current;
}

export function onMonControlChange(cb: (d: MonControlDoc) => void): void {
  listeners.push(cb);
}

export function watchMonControl(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log(`[mon_control] reloaded (${current.entries.size} rules)`);
        for (const cb of listeners) cb(current);
      } catch (e) {
        console.warn('[mon_control] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

/** Match against loaded rules — exact name first, then substring. */
export function ruleFor(doc: MonControlDoc, name: string | undefined): MonRule {
  if (!name) return doc.default;
  const lower = name.toLowerCase();
  const exact = doc.entries.get(lower);
  if (exact) return exact;
  for (const [k, v] of doc.entries) if (lower.includes(k)) return v;
  return doc.default;
}
