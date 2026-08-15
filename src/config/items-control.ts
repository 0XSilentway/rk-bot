import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export interface ItemRule {
  keep: number;
  store: boolean;
  sell: boolean;
}

export interface ItemsDoc {
  default: ItemRule;
  byName: Map<string, ItemRule>;
  byId: Map<number, ItemRule>;
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'items_control.txt');

let current: ItemsDoc | undefined;

function parseLine(line: string): { key: string; rule: ItemRule } | null {
  const parts = line.trim().split(/\s+/);
  if (parts.length < 4) return null;
  const flags = parts.slice(-3);
  const keep = Number(flags[0]);
  if (!isFinite(keep)) return null;
  const rule: ItemRule = { keep, store: flags[1] === '1', sell: flags[2] === '1' };
  const key = parts.slice(0, -3).join(' ').replace(/^"|"$/g, '');
  return { key, rule };
}

function loadOnce(): ItemsDoc {
  const text = readFileSync(FILE, 'utf-8');
  const byName = new Map<string, ItemRule>();
  const byId = new Map<number, ItemRule>();
  let def: ItemRule = { keep: 0, store: true, sell: false };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const p = parseLine(line);
    if (!p) continue;
    if (p.key.toLowerCase() === 'all') { def = p.rule; continue; }
    if (/^\d+$/.test(p.key)) byId.set(Number(p.key), p.rule);
    else byName.set(p.key.toLowerCase(), p.rule);
  }
  return { default: def, byName, byId };
}

export function loadItemsControl(): ItemsDoc {
  if (!current) current = loadOnce();
  return current;
}

export function watchItemsControl(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log(`[items_control] reloaded (${current.byName.size} names, ${current.byId.size} ids)`);
      } catch (e) {
        console.warn('[items_control] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

export function itemRuleFor(doc: ItemsDoc, itemId: number, name?: string): ItemRule {
  if (doc.byId.has(itemId)) return doc.byId.get(itemId)!;
  if (name && doc.byName.has(name.toLowerCase())) return doc.byName.get(name.toLowerCase())!;
  return doc.default;
}
