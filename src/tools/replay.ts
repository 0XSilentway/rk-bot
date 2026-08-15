import { Database } from 'bun:sqlite';
import { decodeFrame } from '../packet/decode';
import { applyEvent } from '../state/apply';
import { WorldState } from '../state/world';
import { join } from 'node:path';
import { readdirSync } from 'node:fs';

const CAPTURE_DIR = join(import.meta.dir, '..', '..', 'captures');

function latest(): string {
  const files = readdirSync(CAPTURE_DIR)
    .filter(f => f.endsWith('.db') && f.startsWith('session-'))
    .sort();
  const last = files[files.length - 1];
  if (!last) throw new Error('no session db');
  return join(CAPTURE_DIR, last);
}

const arg = process.argv[2];
const path = arg && arg.endsWith('.db') ? arg : latest();
console.log('[replay]', path);
const db = new Database(path);

const world = new WorldState();
let recv = 0;
let unknown = 0;
const opCounts = new Map<number, number>();

const rows = db
  .query(`SELECT ts, bytes FROM frames WHERE dir='recv' AND bytes IS NOT NULL ORDER BY seq`)
  .all() as { ts: number; bytes: Buffer }[];

for (const r of rows) {
  const b = new Uint8Array(r.bytes);
  const ev = decodeFrame(b, r.ts);
  applyEvent(world, ev);
  recv++;
  opCounts.set(ev.op, (opCounts.get(ev.op) ?? 0) + 1);
  if (ev.kind === 'unknown') unknown++;
}

console.log(`\nreplayed ${recv} recv frames, ${unknown} unknown (${((unknown / recv) * 100).toFixed(1)}%)\n`);
console.log('final self state:', world.self);
console.log('actors:', world.actors.size, 'drops:', world.drops.size);
console.log('kills:', world.killsSession, 'exp:', world.expGainedSession, 'loot:', world.lootedSession);

console.log('\ntop actors by name:');
const named = [...world.actors.values()].filter(a => a.name).slice(0, 20);
for (const a of named) {
  console.log(`  id=0x${a.id.toString(16).padStart(8, '0')} kind=${a.kind} name=${a.name} pos=${a.pos ? `(${a.pos.x},${a.pos.y})` : '?'} alive=${a.alive}`);
}

console.log('\nopcode counts:');
[...opCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).forEach(([op, n]) => {
  console.log(`  0x${op.toString(16).padStart(2, '0')}  ${n}`);
});

db.close();
