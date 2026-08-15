import { readFileSync, watch } from 'node:fs';
import { join } from 'node:path';

export interface AvoidRule {
  disconnect: boolean;
  teleport: boolean;
  disconnectOnChat?: boolean;
}

export interface AvoidDoc {
  players: Map<string, AvoidRule>;   // lower-case substring
  ids: Map<number, AvoidRule>;
  jobs: Map<string, AvoidRule>;      // lower-case job name
}

const FILE = join(import.meta.dir, '..', '..', 'control', 'avoid.txt');

let current: AvoidDoc | undefined;

function parseSection(section: 'Players' | 'ID' | 'Jobs', line: string, doc: AvoidDoc): void {
  const parts = line.trim().split(/\s+/);
  if (section === 'ID') {
    if (parts.length < 3) return;
    const id = Number(parts[0]);
    if (!isFinite(id)) return;
    doc.ids.set(id, { disconnect: parts[1] === '1', teleport: parts[2] === '1' });
    return;
  }
  // Players / Jobs: key ... 3 numeric flags at end
  if (parts.length < 4) return;
  const flags = parts.slice(-3);
  const key = parts.slice(0, -3).join(' ').toLowerCase();
  const rule: AvoidRule = {
    disconnect: flags[0] === '1',
    teleport: flags[1] === '1',
    disconnectOnChat: flags[2] === '1',
  };
  if (section === 'Players') doc.players.set(key, rule);
  else doc.jobs.set(key, rule);
}

function loadOnce(): AvoidDoc {
  const text = readFileSync(FILE, 'utf-8');
  const doc: AvoidDoc = { players: new Map(), ids: new Map(), jobs: new Map() };
  let section: 'Players' | 'ID' | 'Jobs' | null = null;
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/#.*$/, '').trim();
    if (!line) continue;
    const sec = line.match(/^\[(Players|ID|Jobs)\]$/);
    if (sec) { section = sec[1] as 'Players' | 'ID' | 'Jobs'; continue; }
    if (!section) continue;
    parseSection(section, line, doc);
  }
  return doc;
}

export function loadAvoid(): AvoidDoc {
  if (!current) current = loadOnce();
  return current;
}

export function watchAvoid(): void {
  let debounce: ReturnType<typeof setTimeout> | undefined;
  watch(FILE, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      try {
        current = loadOnce();
        console.log(`[avoid] reloaded (${current.players.size} players, ${current.ids.size} ids, ${current.jobs.size} jobs)`);
      } catch (e) {
        console.warn('[avoid] reload failed:', (e as Error).message);
      }
    }, 200);
  });
}

/** Check if a sighted player matches any rule. Substring match on name. */
export function avoidRuleFor(doc: AvoidDoc, name: string | undefined, actorId: number): AvoidRule | undefined {
  if (doc.ids.has(actorId)) return doc.ids.get(actorId);
  if (!name) return undefined;
  const lower = name.toLowerCase();
  const exact = doc.players.get(lower);
  if (exact) return exact;
  for (const [k, v] of doc.players) if (lower.includes(k)) return v;
  return undefined;
  // NOTE: [Jobs] section requires job info per player — not yet decoded from
  // spawn packet. Left as parser support only; enable when 0x06 sub decodes.
}
