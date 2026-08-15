import { Database } from 'bun:sqlite';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

export interface RawLog {
  event(seq: number, ts: number, kind: string, payload: string): void;
  frame(
    seq: number,
    ts: number,
    wsId: number,
    dir: 'send' | 'recv',
    kind: string,
    bytes: Uint8Array | null,
    text: string | null,
  ): void;
  close(): void;
}

const CAPTURE_DIR = join(import.meta.dir, '..', '..', 'captures');

export function openRawLog(): RawLog {
  mkdirSync(CAPTURE_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const path = join(CAPTURE_DIR, `session-${stamp}.db`);
  const db = new Database(path);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS events (
      seq INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      kind TEXT NOT NULL,
      payload TEXT
    );
    CREATE TABLE IF NOT EXISTS frames (
      seq INTEGER PRIMARY KEY,
      ts INTEGER NOT NULL,
      ws_id INTEGER NOT NULL,
      dir TEXT NOT NULL,
      kind TEXT NOT NULL,
      len INTEGER NOT NULL,
      bytes BLOB,
      text TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_frames_ws ON frames(ws_id, ts);
  `);
  console.log(`[persist] logging to ${path}`);

  const insEvent = db.prepare(
    'INSERT INTO events(seq, ts, kind, payload) VALUES (?, ?, ?, ?)',
  );
  const insFrame = db.prepare(
    'INSERT INTO frames(seq, ts, ws_id, dir, kind, len, bytes, text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  );

  return {
    event(seq, ts, kind, payload) {
      insEvent.run(seq, ts, kind, payload);
    },
    frame(seq, ts, wsId, dir, kind, bytes, text) {
      const len = bytes?.length ?? text?.length ?? 0;
      insFrame.run(seq, ts, wsId, dir, kind, len, bytes, text);
    },
    close() {
      db.close();
    },
  };
}
