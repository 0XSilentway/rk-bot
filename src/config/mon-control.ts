import { parse } from 'yaml';
import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export type AttackPolicy = 0 | 1 | 2;   // ignore | auto | if_attacked
export type TeleportPolicy = 0 | 1 | 2; // never | on_attacked | on_sight

export interface MonRule {
  attack: AttackPolicy;
  teleport: TeleportPolicy;
}

export interface MonControlDoc {
  teleport_range: number;
  default: MonRule;
  entries: Map<string, MonRule>;  // lowercase name → rule
}

const FILE = join(import.meta.dir, '..', '..', 'config', 'mon_control.yaml');

let current: MonControlDoc | undefined;
const listeners: Array<(d: MonControlDoc) => void> = [];

function loadOnce(): MonControlDoc {
  const raw = parse(readFileSync(FILE, 'utf-8')) as Record<string, unknown>;
  const teleport_range = (raw.teleport_range as number) ?? 12;
  const def = (raw.default as MonRule) ?? { attack: 0, teleport: 0 };
  const entries = new Map<string, MonRule>();
  for (const [k, v] of Object.entries(raw)) {
    if (k === 'teleport_range' || k === 'default') continue;
    if (v && typeof v === 'object' && 'attack' in v && 'teleport' in v) {
      entries.set(k.toLowerCase(), v as MonRule);
    }
  }
  return { teleport_range, default: def, entries };
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
        console.log(`[mon_control] reloaded (${current.entries.size} mob rules)`);
        for (const cb of listeners) cb(current);
      } catch (e) {
        console.warn('[mon_control] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

/** Substring match against loaded rules (case-insensitive). Returns default if no match. */
export function ruleFor(doc: MonControlDoc, name: string | undefined): MonRule {
  if (!name) return doc.default;
  const lower = name.toLowerCase();
  // exact match first
  const exact = doc.entries.get(lower);
  if (exact) return exact;
  // substring: any key that appears in name
  for (const [k, v] of doc.entries) if (lower.includes(k)) return v;
  return doc.default;
}
