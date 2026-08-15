import { Database } from 'bun:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Scan all captured sessions for skill casts (send 0x1D 01).
 * Prints a table of (skill_id, level) → count + example target/timestamp.
 */

const CAPTURE_DIR = join(import.meta.dir, '..', '..', 'captures');

const casts = new Map<string, { skill: number; level: number; count: number; firstTs: number; targets: Set<number> }>();

for (const f of readdirSync(CAPTURE_DIR).filter(x => x.endsWith('.db'))) {
  const path = join(CAPTURE_DIR, f);
  try {
    const db = new Database(path);
    const rows = db
      .query(`SELECT ts, bytes FROM frames WHERE dir='send' AND length(bytes) = 8 AND substr(hex(bytes),1,4)='1D01' ORDER BY seq`)
      .all() as { ts: number; bytes: Buffer }[];
    for (const r of rows) {
      const b = new Uint8Array(r.bytes);
      const target = (b[2]! | (b[3]! << 8) | (b[4]! << 16) | (b[5]! << 24)) >>> 0;
      const skill = b[6]!;
      const level = b[7]!;
      const key = `${skill}-${level}`;
      const entry = casts.get(key) ?? { skill, level, count: 0, firstTs: r.ts, targets: new Set() };
      entry.count++;
      entry.targets.add(target);
      casts.set(key, entry);
    }
    db.close();
  } catch (e) {
    console.warn(`skip ${f}:`, (e as Error).message);
  }
}

console.log(`\n=== SKILL CASTS SCANNED (${casts.size} unique) ===\n`);
console.log('skill_id  level  count  targets  first_seen');
console.log('--------  -----  -----  -------  ' + '-'.repeat(20));
[...casts.values()]
  .sort((a, b) => a.skill - b.skill || a.level - b.level)
  .forEach(c => {
    const date = new Date(c.firstTs).toISOString().slice(0, 19);
    console.log(
      `${c.skill.toString().padStart(8)}  ${c.level.toString().padStart(5)}  ${c.count.toString().padStart(5)}  ${c.targets.size.toString().padStart(7)}  ${date}`,
    );
  });
console.log('');
