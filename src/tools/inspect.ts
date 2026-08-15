import { Database } from 'bun:sqlite';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

const CAPTURE_DIR = join(import.meta.dir, '..', '..', 'captures');

function latestDb(): string {
  const files = readdirSync(CAPTURE_DIR)
    .filter(f => f.startsWith('session-') && f.endsWith('.db'))
    .sort();
  const last = files[files.length - 1];
  if (!last) throw new Error('no session db in captures/');
  return join(CAPTURE_DIR, last);
}

const arg = process.argv[2];
const dbPath = arg && arg.endsWith('.db') ? arg : latestDb();
console.log('[inspect]', dbPath);
const db = new Database(dbPath, { readonly: true });

const totalRow = db.query('SELECT COUNT(*) as n FROM frames').get() as { n: number };
console.log(`\ntotal frames: ${totalRow.n}`);

const byDir = db.query('SELECT dir, COUNT(*) as n FROM frames GROUP BY dir').all() as { dir: string; n: number }[];
console.log('by dir:', byDir);

console.log('\n=== top 30 opcode groups (dir, len, op) ===');
const rows = db
  .query(
    `SELECT dir, len, substr(hex(bytes),1,4) as op, COUNT(*) as n
     FROM frames WHERE bytes IS NOT NULL
     GROUP BY dir, len, op ORDER BY n DESC LIMIT 30`,
  )
  .all() as { dir: string; len: number; op: string; n: number }[];
for (const r of rows) console.log(r);

console.log('\n=== send timeline (skip ping 04) ===');
const sends = db
  .query(
    `SELECT seq, ts, len, hex(bytes) as full FROM frames
     WHERE dir='send' AND hex(bytes) != '04' ORDER BY seq`,
  )
  .all() as { seq: number; ts: number; len: number; full: string }[];
if (sends.length > 0) {
  const t0 = sends[0]!.ts;
  for (const s of sends) {
    const rel = ((s.ts - t0) / 1000).toFixed(2);
    console.log(`+${rel.padStart(7)}s  seq=${s.seq}  len=${s.len}  ${s.full}`);
  }
}

const ascii = db
  .query(
    `SELECT seq, dir, len, hex(bytes) as h, bytes FROM frames
     WHERE bytes IS NOT NULL AND len BETWEEN 8 AND 100 ORDER BY seq`,
  )
  .all() as { seq: number; dir: string; len: number; h: string; bytes: Buffer }[];

console.log('\n=== frames with printable ASCII (>= 4 chars run) ===');
for (const f of ascii) {
  const b = new Uint8Array(f.bytes);
  let run = '';
  let out = '';
  for (const c of b) {
    if (c >= 0x20 && c <= 0x7e) {
      run += String.fromCharCode(c);
    } else {
      if (run.length >= 4) out += `[${run}]`;
      run = '';
    }
  }
  if (run.length >= 4) out += `[${run}]`;
  if (out) console.log(`seq=${f.seq} dir=${f.dir} len=${f.len} :: ${out}`);
}

db.close();
