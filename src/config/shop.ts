import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export interface ShopEntry {
  name: string;
  priceMin: number;
  priceMax: number;
  amount?: number;
}

export interface ShopDoc {
  titles: string[];
  entries: ShopEntry[];
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'shop.txt');

let current: ShopDoc | undefined;

function parsePrice(s: string): { min: number; max: number } {
  const clean = s.replace(/,/g, '');
  const m = clean.match(/^(\d+)(?:\.\.(\d+))?$/);
  if (!m) return { min: 0, max: 0 };
  const min = Number(m[1]);
  const max = m[2] ? Number(m[2]) : min;
  return { min, max };
}

function loadOnce(): ShopDoc {
  const text = readFileSync(FILE, 'utf-8');
  const lines = text.split(/\r?\n/).map(l => l.replace(/#.*$/, '').trimEnd());
  let titleLine = '';
  const entries: ShopEntry[] = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (!titleLine) { titleLine = line; continue; }
    // last token maybe amount (integer without commas); prev token = price(range)
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    let amount: number | undefined;
    let priceIdx = parts.length - 1;
    if (parts.length >= 3) {
      const last = parts[parts.length - 1]!;
      if (/^\d+$/.test(last)) { amount = Number(last); priceIdx = parts.length - 2; }
    }
    const price = parsePrice(parts[priceIdx]!);
    const name = parts.slice(0, priceIdx).join(' ').replace(/^"|"$/g, '');
    entries.push({ name, priceMin: price.min, priceMax: price.max, amount });
  }
  const titles = titleLine.split(';;').map(t => t.trim()).filter(Boolean);
  return { titles, entries };
}

export function loadShop(): ShopDoc {
  if (!current) current = loadOnce();
  return current;
}

export function watchShop(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log(`[shop] reloaded (${current.entries.length} items, ${current.titles.length} titles)`);
      } catch (e) {
        console.warn('[shop] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

/** Pick a random title from the rotation. */
export function pickShopTitle(doc: ShopDoc): string {
  if (doc.titles.length === 0) return '';
  return doc.titles[Math.floor(Math.random() * doc.titles.length)]!;
}

/** Roll a price for an entry (uniform in [min,max]). */
export function rollPrice(entry: ShopEntry): number {
  if (entry.priceMin === entry.priceMax) return entry.priceMin;
  return Math.floor(entry.priceMin + Math.random() * (entry.priceMax - entry.priceMin + 1));
}
