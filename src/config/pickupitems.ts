import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export type PickupFlag = -1 | 0 | 1 | 2; // dropInv | skip | pick | rush

export interface PickupDoc {
  default: PickupFlag;
  byName: Map<string, PickupFlag>;
  byId: Map<number, PickupFlag>;
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'pickupitems.txt');

let current: PickupDoc | undefined;

function parseLine(line: string): { key: string; flag: PickupFlag } | null {
  // last token = flag, everything before = name/id (may contain spaces)
  const parts = line.trim().split(/\s+/);
  if (parts.length < 2) return null;
  const flagStr = parts[parts.length - 1]!;
  const flag = Number(flagStr);
  if (![-1, 0, 1, 2].includes(flag)) return null;
  const key = parts.slice(0, -1).join(' ').replace(/^"|"$/g, '');
  return { key, flag: flag as PickupFlag };
}

function loadOnce(): PickupDoc {
  const text = readFileSync(FILE, 'utf-8');
  const byName = new Map<string, PickupFlag>();
  const byId = new Map<number, PickupFlag>();
  let def: PickupFlag = 1;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.key.toLowerCase() === 'all') { def = p.flag; continue; }
    const asNum = Number(p.key);
    if (isFinite(asNum) && /^\d+$/.test(p.key)) byId.set(asNum, p.flag);
    else byName.set(p.key.toLowerCase(), p.flag);
  }
  return { default: def, byName, byId };
}

export function loadPickup(): PickupDoc {
  if (!current) current = loadOnce();
  return current;
}

export function watchPickup(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log(`[pickupitems] reloaded (${current.byName.size} names, ${current.byId.size} ids)`);
      } catch (e) {
        console.warn('[pickupitems] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

/** Returns the effective pickup flag for a drop. */
export function pickupFlagFor(doc: PickupDoc, itemId: number, name?: string): PickupFlag {
  if (doc.byId.has(itemId)) return doc.byId.get(itemId)!;
  if (name) {
    const lower = name.toLowerCase();
    if (doc.byName.has(lower)) return doc.byName.get(lower)!;
  }
  return doc.default;
}
